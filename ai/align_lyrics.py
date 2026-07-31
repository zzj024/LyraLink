import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path


def progress(percent: int, message: str):
    print(f"LINKAUDIO_PROGRESS:{percent}:{message}", file=sys.stderr, flush=True)


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).lower()
    return "".join(char for char in text if char.isalnum() or "\u4e00" <= char <= "\u9fff")


def expand_words(words):
    characters = []
    for word in words:
        normalized = normalize(word.word)
        if not normalized:
            continue
        start = float(word.start or 0)
        end = float(word.end or start)
        step = max(0.001, (end - start) / len(normalized))
        for index, char in enumerate(normalized):
            characters.append({
                "char": char,
                "start": start + step * index,
                "end": start + step * (index + 1),
                "probability": float(word.probability or 0),
            })
    return characters


def sequence_mapping(expected_text, recognized_text):
    """Globally align two transcripts while preserving their reading order.

    SequenceMatcher is optimized for finding matching blocks, not transcripts.
    With a repeated chorus it can lock onto a late, long block and discard most
    of the earlier song. A global edit alignment scores the complete transcript,
    so insertions and recognition gaps do not reset the rest of the timeline.
    """
    expected_length = len(expected_text)
    recognized_length = len(recognized_text)
    if not expected_length or not recognized_length:
        return {}

    gap_score = -0.8
    mismatch_score = -1.2
    previous = [index * gap_score for index in range(recognized_length + 1)]
    directions = [bytearray(recognized_length + 1) for _ in range(expected_length + 1)]
    for column in range(1, recognized_length + 1):
        directions[0][column] = 2  # Skip a recognized character.

    for row in range(1, expected_length + 1):
        current = [row * gap_score] + [0.0] * recognized_length
        directions[row][0] = 1  # Skip an expected character.
        expected_char = expected_text[row - 1]
        for column in range(1, recognized_length + 1):
            is_match = expected_char == recognized_text[column - 1]
            diagonal = previous[column - 1] + (2.0 if is_match else mismatch_score)
            skip_expected = previous[column] + gap_score
            skip_recognized = current[column - 1] + gap_score
            best = max(diagonal, skip_expected, skip_recognized)
            current[column] = best
            if diagonal == best:
                directions[row][column] = 3
            elif skip_expected == best:
                directions[row][column] = 1
            else:
                directions[row][column] = 2
        previous = current

    mapping = {}
    row = expected_length
    column = recognized_length
    while row > 0 or column > 0:
        direction = directions[row][column]
        if direction == 3:
            if expected_text[row - 1] == recognized_text[column - 1]:
                mapping[row - 1] = column - 1
            row -= 1
            column -= 1
        elif direction == 1:
            row -= 1
        else:
            column -= 1
    return mapping


def align_lines(lines, recognized, duration):
    expected_chars = []
    line_ranges = []
    for line_index, text in enumerate(lines):
        start_index = len(expected_chars)
        expected_chars.extend({"char": char, "line": line_index} for char in normalize(text))
        line_ranges.append((start_index, len(expected_chars)))

    expected_text = "".join(item["char"] for item in expected_chars)
    recognized_text = "".join(item["char"] for item in recognized)
    mapping = sequence_mapping(expected_text, recognized_text)

    raw_starts = []
    confidences = []
    for start_index, end_index in line_ranges:
        matched = [mapping[index] for index in range(start_index, end_index) if index in mapping]
        line_length = max(1, end_index - start_index)
        coverage = len(matched) / line_length
        # A single common character is not a reliable timing anchor. Treat weak
        # matches as gaps and let neighboring reliable lines determine the time.
        if matched and (len(matched) >= 2 or line_length == 1) and coverage >= 0.18:
            times = [recognized[index]["start"] for index in matched]
            probabilities = [recognized[index]["probability"] for index in matched]
            raw_starts.append(min(times))
            probability = sum(probabilities) / max(1, len(probabilities))
            confidences.append(round(min(1.0, coverage * 0.75 + probability * 0.25), 3))
        else:
            raw_starts.append(None)
            confidences.append(0.0)

    # Fill every contiguous missing section as one interval. The old per-line
    # fallback pushed long missing sections to the end of the track, causing many
    # lyrics to collapse onto nearly the same timestamp.
    index = 0
    while index < len(raw_starts):
        if raw_starts[index] is not None:
            index += 1
            continue
        run_start = index
        while index < len(raw_starts) and raw_starts[index] is None:
            index += 1
        run_end = index
        previous = run_start - 1 if run_start > 0 else None
        following = run_end if run_end < len(raw_starts) else None
        left_time = float(raw_starts[previous]) if previous is not None else 0.0
        right_time = float(raw_starts[following]) if following is not None else duration
        count = run_end - run_start
        for offset, line_index in enumerate(range(run_start, run_end)):
            if previous is None and following is not None:
                ratio = offset / max(1, count)
            elif previous is not None and following is not None:
                ratio = (offset + 1) / (count + 1)
            else:
                ratio = (offset + 1) / (count + 1)
            raw_starts[line_index] = left_time + max(0.0, right_time - left_time) * ratio

    starts = []
    for value in raw_starts:
        value = max(0.0, min(float(value), duration))
        if starts:
            value = max(value, starts[-1] + 0.05)
        starts.append(round(value, 3))

    result = []
    for index, text in enumerate(lines):
        result.append({
            "text": text,
            "start": starts[index],
            "end": starts[index + 1] if index + 1 < len(starts) else round(duration, 3),
            "confidence": confidences[index],
        })
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--lyrics", required=True)
    parser.add_argument("--model", default="small")
    parser.add_argument("--model-dir", required=True)
    args = parser.parse_args()

    from faster_whisper import WhisperModel

    lines = json.loads(Path(args.lyrics).read_text(encoding="utf-8"))
    prompt = "\n".join(lines)[:4000]
    local_model = Path(args.model_dir) / args.model
    model_source = str(local_model) if (local_model / "model.bin").exists() else args.model
    progress(15, "正在准备本地语音识别模型…")
    model = WhisperModel(
        model_source,
        device="cpu",
        compute_type="int8",
        download_root=args.model_dir,
    )
    progress(45, "模型准备完成，正在分析音频…")
    segments, info = model.transcribe(
        args.audio,
        initial_prompt=prompt,
        word_timestamps=True,
        vad_filter=False,
        condition_on_previous_text=False,
        beam_size=5,
    )
    words = []
    duration = float(info.duration or 0)
    last_percent = 45
    for segment in segments:
        words.extend(segment.words or [])
        if duration > 0:
            current_percent = min(88, 45 + int((float(segment.end) / duration) * 43))
            if current_percent > last_percent:
                progress(current_percent, f"正在识别人声… {current_percent}%")
                last_percent = current_percent
    recognized = expand_words(words)
    progress(92, "识别完成，正在将歌词与音频对齐…")
    result = align_lines(lines, recognized, duration)
    progress(100, "AI 歌词匹配完成")
    print(json.dumps({
        "lines": result,
        "recognizedCharacters": len(recognized),
        "duration": duration,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
