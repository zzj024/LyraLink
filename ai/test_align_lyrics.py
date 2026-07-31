import unittest

from align_lyrics import align_lines, normalize, sequence_mapping


def recognized(text, start=0.0, step=1.0, probability=0.9):
    return [
        {
            "char": char,
            "start": start + index * step,
            "end": start + (index + 1) * step,
            "probability": probability,
        }
        for index, char in enumerate(normalize(text))
    ]


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
        lines = ["天地玄黄", "宇宙洪荒", "天地玄黄", "日月盈昃"]
        result = align_lines(lines, recognized("天地玄黄宇宙洪荒天地玄黄日月盈昃"), 40.0)

        starts = [line["start"] for line in result]
        self.assertEqual(starts, sorted(starts))
        self.assertGreater(starts[2], starts[1])
        self.assertGreater(result[2]["confidence"], 0.8)

    def test_missing_middle_lines_are_interpolated_as_one_interval(self):
        lines = ["第一句歌词", "完全漏掉甲", "完全漏掉乙", "最后一句歌词"]
        heard = recognized("第一句歌词最后一句歌词", step=2.0)
        result = align_lines(lines, heard, 30.0)

        self.assertEqual(result[1]["confidence"], 0.0)
        self.assertEqual(result[2]["confidence"], 0.0)
        self.assertGreater(result[1]["start"], result[0]["start"])
        self.assertGreater(result[2]["start"], result[1]["start"])
        self.assertLess(result[2]["start"], result[3]["start"])

    def test_missing_trailing_lines_do_not_collapse_at_duration(self):
        lines = ["识别成功", "尾部漏掉甲", "尾部漏掉乙", "尾部漏掉丙"]
        result = align_lines(lines, recognized("识别成功"), 40.0)

        starts = [line["start"] for line in result]
        self.assertEqual(starts, sorted(starts))
        self.assertEqual(len(starts), len(set(starts)))
        self.assertLess(starts[-1], 40.0)


if __name__ == "__main__":
    unittest.main()
