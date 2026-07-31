import assert from "node:assert/strict";
import test from "node:test";
import { selectCollectionTracks } from "../src/renderer/collection.js";
import type { Track } from "../src/shared/types.js";

function track(
  id: string,
  title: string,
  options: { favorite?: boolean; folderIds?: string[]; importedAt?: string } = {}
): Track {
  return {
    id,
    platform: "local",
    url: "",
    title,
    author: `${title}歌手`,
    duration: 180,
    thumbnail: null,
    filePath: `C:\\music\\${id}.mp3`,
    fileUrl: `file:///C:/music/${id}.mp3`,
    coverPath: null,
    lyrics: null,
    favorite: options.favorite || false,
    folderIds: options.folderIds || [],
    sourceTrackId: null,
    contentHash: id,
    importedAt: options.importedAt || "2026-01-01T00:00:00.000Z"
  };
}

const tracks = [
  track("all-first", "音乐库第一首", { importedAt: "2026-03-01T00:00:00.000Z" }),
  track("favorite", "收藏歌曲", { favorite: true, importedAt: "2026-02-01T00:00:00.000Z" }),
  track("folder", "通勤歌曲", { folderIds: ["commute"] })
];

test("selects only favorites for favorite playback", () => {
  const result = selectCollectionTracks({
    tracks,
    folders: [{ id: "commute", name: "通勤", createdAt: "2026-01-01T00:00:00.000Z" }],
    playlists: [],
    activeCollection: "favorites",
    query: "",
    sort: "newest"
  });
  assert.deepEqual(result.map((item) => item.id), ["favorite"]);
});

test("keeps manual playlist order and ignores missing ids", () => {
  const result = selectCollectionTracks({
    tracks,
    folders: [],
    playlists: [{
      id: "road",
      name: "路上",
      trackIds: ["folder", "missing", "favorite"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }],
    activeCollection: "playlist:road",
    query: "",
    sort: "title"
  });
  assert.deepEqual(result.map((item) => item.id), ["folder", "favorite"]);
});

test("filters the visible collection by song or artist", () => {
  const result = selectCollectionTracks({
    tracks,
    folders: [{ id: "commute", name: "通勤", createdAt: "2026-01-01T00:00:00.000Z" }],
    playlists: [],
    activeCollection: "commute",
    query: "通勤歌曲歌手",
    sort: "newest"
  });
  assert.deepEqual(result.map((item) => item.id), ["folder"]);
});
