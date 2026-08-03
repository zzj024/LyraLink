import unittest
from types import SimpleNamespace

from align_lyrics import align_lines, normalize, sequence_mapping


def make_words(text, start=0.0, step=1.0, probability=0.9):
    """Create word-level SimpleNamespace objects mimicking Whisper output.

    Splits text into 2-character words (more realistic for Whisper).
    """
    chars = normalize(text)
    offset = start
    result = []
    i = 0
    while i < len(chars):
        # Take 2 characters per word (like real Whisper output).
        word_text = chars[i:i+2]
        result.append(SimpleNamespace(
            word=word_text,
            start=offset,
            end=offset + step * 0.8,
            probability=probability,
        ))
        offset += step
        i += 2
    return result


class SequenceMappingTests(unittest.TestCase):
    def test_skips_hallucinated_repeated_chorus_before_real_transcript(self):
        lines = ["春风吹过山岗", "我们走向远方", "星光落在肩上", "再次走向远方"]
        expected = "".join(normalize(line) for line in lines)
        hallucination = normalize(lines[-1])
        transcript = hallucination + expected

        mapping = sequence_mapping(expected, transcript)

        self.assertEqual(mapping[0], len(hallucination))
        self.assertEqual(mapping[len(expected) - 1], len(transcript) - 1)

    def test_repeated_lines_receive_distinct_increasing_times(self):
        # Simulate Whisper output with multi-character words (realistic).
        words = [
            SimpleNamespace(word="天地玄黄", start=0.0, end=3.5, probability=0.9),
            SimpleNamespace(word="宇宙洪荒", start=4.0, end=7.5, probability=0.9),
            SimpleNamespace(word="天地玄黄", start=8.0, end=11.5, probability=0.9),
            SimpleNamespace(word="日月盈昃", start=12.0, end=15.5, probability=0.9),
        ]
        lines = ["天地玄黄", "宇宙洪荒", "天地玄黄", "日月盈昃"]
        result = align_lines(lines, words, 16.0)

        starts = [line["start"] for line in result]
        self.assertEqual(starts, sorted(starts))
        self.assertGreater(starts[2], starts[1])
        self.assertGreater(result[2]["confidence"], 0.0)

    def test_missing_middle_lines_are_interpolated_as_one_interval(self):
        lines = ["第一句歌词", "完全漏掉甲", "完全漏掉乙", "最后一句歌词"]
        words = make_words("第一句歌词最后一句歌词", step=2.0)
        result = align_lines(lines, words, 30.0)

        self.assertEqual(result[1]["confidence"], 0.0)
        self.assertEqual(result[2]["confidence"], 0.0)
        self.assertGreater(result[1]["start"], result[0]["start"])
        self.assertGreater(result[2]["start"], result[1]["start"])
        self.assertLess(result[2]["start"], result[3]["start"])

    def test_missing_trailing_lines_do_not_collapse_at_duration(self):
        lines = ["识别成功", "尾部漏掉甲", "尾部漏掉乙", "尾部漏掉丙"]
        words = make_words("识别成功")
        result = align_lines(lines, words, 40.0)

        starts = [line["start"] for line in result]
        self.assertEqual(starts, sorted(starts))
        self.assertEqual(len(starts), len(set(starts)))
        self.assertLess(starts[-1], 40.0)

    def test_lines_have_non_overlapping_time_ranges(self):
        lines = ["第一句", "第二句", "第三句"]
        words = make_words("第一句第二句第三句", step=1.0)
        result = align_lines(lines, words, 20.0)

        for i in range(len(result) - 1):
            self.assertLessEqual(result[i]["end"], result[i + 1]["start"])

    def test_offset_shifts_all_times(self):
        lines = ["天地玄黄", "宇宙洪荒"]
        words = make_words("天地玄黄宇宙洪荒", step=1.0)
        result_no = align_lines(lines, words, 20.0)
        result_off = align_lines(lines, words, 20.0, offset=3.0)

        for i in range(len(lines)):
            self.assertAlmostEqual(
                result_off[i]["start"],
                result_no[i]["start"] + 3.0,
                delta=0.1,
            )


if __name__ == "__main__":
    unittest.main()
