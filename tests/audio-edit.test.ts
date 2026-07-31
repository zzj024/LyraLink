import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { AudioEditService } from "../src/main/audio-edit-service.js";
import { TrackLibrary } from "../src/main/library.js";

const run = promisify(execFile);

test("splits audio non-destructively and shifts copied lyrics", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "link-audio-test-"));
  try {
    const library = new TrackLibrary(directory);
    await library.initialize();
    const sourcePath = path.join(library.mediaDirectory, "source.wav");
    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3", sourcePath
    ]);
    await library.add({
      id: "source",
      platform: "bilibili",
      url: "https://www.bilibili.com/video/test",
      title: "组合音频",
      author: "测试作者",
      duration: 3,
      thumbnail: null,
      filePath: sourcePath,
      coverPath: null,
      lyrics: {
        source: "manual",
        updatedAt: new Date().toISOString(),
        lines: [{ text: "第二段歌词", start: 1.2, end: 2.2 }]
      },
      favorite: true,
      folderIds: [],
      sourceTrackId: null,
      importedAt: new Date().toISOString()
    });

    const editor = new AudioEditService(library);
    const [segment] = await editor.split("source", [{
      title: "裁切结果",
      start: 1,
      end: 2.5
    }]);

    assert.equal(segment.title, "裁切结果");
    assert.equal(segment.duration, 1.5);
    assert.equal(segment.favorite, true);
    assert.equal(segment.sourceTrackId, "source");
    assert.ok((await stat(segment.filePath)).size > 0);
    assert.equal(segment.lyrics?.lines[0].start, 0.2);
    assert.equal(segment.lyrics?.lines[0].end, 1.2);
    assert.ok((await stat(sourcePath)).size > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
