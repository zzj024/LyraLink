import argparse
import json
import random
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


def estimate_offset(whisper_times, lrc_times, threshold=1.5):
    """Estimate timing offset using RANSAC.

    Given Whisper word start times and corresponding LRC ground-truth times,
    compute the offset to add to Whisper times so they match LRC times.

    Returns the offset value, or 0.0 if too few pairs.
    """
    if len(whisper_times) < 5 or len(whisper_times) != len(lrc_times):
        return 0.0

    offsets = sorted(lrc - w for w, lrc in zip(whisper_times, lrc_times))
    n = len(offsets)

    # Quick path: if the data is already tight, just return the median.
    median = offsets[n // 2]
    inliers = sum(1 for o in offsets if abs(o - median) < threshold)
    if inliers / n > 0.8:
        return median

    # RANSAC
    best_offset = median
    best_inliers = inliers
    sample_size = max(3, n // 3)

    for _ in range(100):
        sample = random.sample(offsets, sample_size)
        candidate = sorted(sample)[len(sample) // 2]
        count = sum(1 for o in offsets if abs(o - candidate) < threshold)
        if count > best_inliers:
            best_inliers = count
            best_offset = candidate

    return best_offset


def _build_char_to_word_start(recognized):
    """Map each recognized character index to the start time of its word."""
    char_to_word_start = {}
    word_start = 0.0
    word_start_idx = -1
    prev_end = 0.0
    for i, char_info in enumerate(recognized):
        if i == 0 or char_info["start"] > prev_end + 0.05:
            if word_start_idx >= 0:
                for j in range(word_start_idx, i):
                    char_to_word_start[j] = word_start
            word_start = char_info["start"]
            word_start_idx = i
        prev_end = char_info["end"]
    for j in range(word_start_idx, len(recognized)):
        char_to_word_start[j] = word_start
    return char_to_word_start


def align_lines(lines, recognized_words, duration, offset=0.0):
    """Align known lyrics to Whisper word timestamps.

    For each lyrics line, finds the best matching Whisper word after the
    previous match (order enforcement for repeated lines).

    recognized_words: list of Whisper word objects with .word, .start, .end,
                      .probability attributes.
    offset: timing offset to add (from estimate_offset / RANSAC).
    """
    n = len(lines)
    raw_starts = [None] * n
    confidences = [0.0] * n
    prev_match_time = -1.0

    for i, line_text in enumerate(lines):
        line_norm = normalize(line_text)
        if not line_norm:
            continue

        best_time = None
        best_score = -1
        best_prob = 0.0

        for word in recognized_words:
            word_start = float(word.start)
            # Only consider words after the previous match.
            if word_start < prev_match_time - 1.0:
                continue
            word_norm = normalize(word.word)
            if not word_norm:
                continue
            score = 0
            for j in range(min(len(line_norm), len(word_norm))):
                if line_norm[j] == word_norm[j]:
                    score += 1
                else:
                    break
            if score >= 2 and score > best_score:
                best_score = score
                best_time = word_start
                best_prob = float(word.probability or 0)

        line_length = max(1, len(line_norm))
        coverage = best_score / line_length
        if best_time is not None and best_score >= 2 and coverage >= 0.18:
            raw_starts[i] = best_time
            prev_match_time = best_time
            confidences[i] = round(min(1.0, coverage * 0.75 + best_prob * 0.25), 3)

    # Fill every contiguous missing section as one interval.

    # Fill every contiguous missing section as one interval.
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
        for off, line_index in enumerate(range(run_start, run_end)):
            if previous is None and following is not None:
                ratio = off / max(1, count)
            elif previous is not None and following is not None:
                ratio = (off + 1) / (count + 1)
            else:
                ratio = (off + 1) / (count + 1)
            raw_starts[line_index] = left_time + max(0.0, right_time - left_time) * ratio

    # Apply offset correction and build result.
    starts = []
    for value in raw_starts:
        value = max(0.0, min(float(value) + offset, duration))
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
    progress(92, "识别完成，正在将歌词与音频对齐…")
    result = align_lines(lines, words, duration)
    progress(100, "AI 歌词匹配完成")
    print(json.dumps({
        "lines": result,
        "recognizedCharacters": len(recognized),
        "duration": duration,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
