import assert from "node:assert/strict";
import { mkdtemp, readdir, stat, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TrackLibrary } from "../src/main/library.js";

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "link-audio-library-"));
  const library = new TrackLibrary(directory);
  await library.initialize();
  const filePath = path.join(library.mediaDirectory, "song.m4a");
  await writeFile(filePath, "audio");
  const track = await library.add({
    id: "song",
    platform: "local",
    url: "",
    title: "测试歌曲",
    author: "测试作者",
    duration: 10,
    thumbnail: null,
    filePath,
    coverPath: null,
    lyrics: null,
    favorite: false,
    folderIds: [],
    sourceTrackId: null,
    importedAt: new Date().toISOString()
  });
  return { directory, library, track, filePath };
}

test("moves deleted audio to trash and restores it", async () => {
  const { directory, library, track, filePath } = await fixture();
  try {
    assert.equal((await library.delete(track.id)).length, 0);
    const [deleted] = await library.listDeleted();
    assert.equal(deleted.id, track.id);
    await assert.rejects(stat(filePath));

    const restored = await library.restore(track.id);
    assert.equal(restored.deleted.length, 0);
    assert.equal(restored.tracks[0].title, "测试歌曲");
    assert.ok((await stat(restored.tracks[0].filePath)).size > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("removes a stale library record even when its audio file is already missing", async () => {
  const { directory, library, track, filePath } = await fixture();
  try {
    await rm(filePath, { force: true });
    assert.equal((await library.delete(track.id)).length, 0);
    assert.equal((await library.listDeleted())[0].id, track.id);
    await assert.rejects(
      library.restore(track.id),
      /原音频文件已经不存在/
    );
    assert.equal((await library.permanentlyDelete(track.id)).length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("imports and exports timed LRC lyrics", async () => {
  const { directory, library, track } = await fixture();
  try {
    const updated = await library.importLrc(track.id, "[00:01.20]第一句\n[00:03.50]第二句");
    assert.equal(updated.lyrics?.lines[0].start, 1.2);
    assert.equal(updated.lyrics?.lines[0].end, 3.5);
    assert.match(await library.exportLrc(track.id), /\[00:01\.20\]第一句/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("falls back to the previous library backup when JSON is corrupted", async () => {
  const { directory, library, track } = await fixture();
  try {
    await library.update(track.id, {
      title: "修改后的名称",
      author: track.author,
      favorite: false,
      folderIds: []
    });
    await writeFile(path.join(directory, "library.json"), "{broken", "utf8");
    const recovered = await library.list();
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].title, "测试歌曲");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("keeps playlist order and removes invalid track ids", async () => {
  const { directory, library, track } = await fixture();
  try {
    const [playlist] = await library.createPlaylist("通勤");
    const updated = await library.updatePlaylist(playlist.id, ["missing", track.id, track.id]);
    assert.deepEqual(updated[0].trackIds, [track.id]);
    assert.equal((await library.renamePlaylist(playlist.id, "晚上"))[0].name, "晚上");
    assert.equal((await library.deletePlaylist(playlist.id)).length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("backs up and restores the complete library", async () => {
  const { directory, library, track } = await fixture();
  const backupRoot = await mkdtemp(path.join(os.tmpdir(), "link-audio-backups-"));
  try {
    await library.backupTo(backupRoot);
    const backup = path.join(backupRoot, (await readdir(backupRoot))[0]);
    await library.update(track.id, {
      title: "恢复前被修改",
      author: track.author,
      favorite: false,
      folderIds: []
    });
    await library.restoreFrom(backup);
    assert.equal((await library.list())[0].title, "测试歌曲");
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(`${directory}.before-restore`, { recursive: true, force: true });
    await rm(backupRoot, { recursive: true, force: true });
  }
});
