import type { AudioFolder, Playlist, Track } from "../shared/types.js";

export interface CollectionSelection {
  tracks: Track[];
  folders: AudioFolder[];
  playlists: Playlist[];
  activeCollection: string;
  query: string;
  sort: string;
}

export function selectCollectionTracks(options: CollectionSelection): Track[] {
  const folder = options.folders.find((item) => item.id === options.activeCollection);
  const playlist = options.playlists.find(
    (item) => `playlist:${item.id}` === options.activeCollection
  );
  let visibleTracks = options.activeCollection === "favorites"
    ? options.tracks.filter((track) => track.favorite)
    : playlist
      ? playlist.trackIds.map((id) => options.tracks.find((track) => track.id === id))
          .filter((item): item is Track => Boolean(item))
      : folder
        ? options.tracks.filter((track) => track.folderIds.includes(folder.id))
        : options.tracks;
  const query = options.query.trim().toLowerCase();
  if (query) {
    visibleTracks = visibleTracks.filter((track) =>
      `${track.title} ${track.author}`.toLowerCase().includes(query)
    );
  }
  if (playlist) return visibleTracks;
  return [...visibleTracks].sort((a, b) => {
    if (options.sort === "title") return a.title.localeCompare(b.title, "zh-CN");
    if (options.sort === "author") return a.author.localeCompare(b.author, "zh-CN");
    if (options.sort === "duration") return (b.duration || 0) - (a.duration || 0);
    return b.importedAt.localeCompare(a.importedAt);
  });
}
