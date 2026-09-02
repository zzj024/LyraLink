import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { AudioFolder, DeletedTrack, Playlist, Track, TrackUpdate } from "../../../shared/types.js";
import { selectCollectionTracks } from "../../collection.js";
import { useViewStore } from "./view.js";
import { usePlayerStore } from "./player.js";

export type LibrarySort = "newest" | "title" | "author" | "duration";

export const useLibraryStore = defineStore("library", () => {
  const tracks = ref<Track[]>([]);
  const folders = ref<AudioFolder[]>([]);
  const playlists = ref<Playlist[]>([]);
  const deletedTracks = ref<DeletedTrack[]>([]);
  const query = ref("");
  const sort = ref<LibrarySort>((localStorage.getItem("linkAudioSort") as LibrarySort) || "newest");
  const selectedIds = ref(new Set<string>());

  const view = useViewStore();

  const collectionTracks = computed<(Track | DeletedTrack)[]>(() => {
    const collection = view.activeCollection;
    if (collection === "trash") {
      const q = query.value.trim().toLowerCase();
      let list = [...deletedTracks.value];
      if (q) list = list.filter((t) => `${t.title} ${t.author}`.toLowerCase().includes(q));
      return list.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    }
    return selectCollectionTracks({
      tracks: tracks.value,
      folders: folders.value,
      playlists: playlists.value,
      activeCollection: collection,
      query: query.value,
      sort: sort.value
    });
  });

  const activePlaylist = computed(() =>
    playlists.value.find((p) => `playlist:${p.id}` === view.activeCollection)
  );
  const activeFolder = computed(() => folders.value.find((f) => f.id === view.activeCollection));
  const isTrash = computed(() => view.activeCollection === "trash");

  function clearSelectionIf(collection?: string) {
    if (!collection || collection !== view.activeCollection) selectedIds.value = new Set();
  }

  function clearSelection() {
    selectedIds.value = new Set();
  }

  function toggleSelected(id: string, on?: boolean) {
    const next = new Set(selectedIds.value);
    const shouldSelect = on ?? !next.has(id);
    if (shouldSelect) next.add(id);
    else next.delete(id);
    selectedIds.value = next;
  }

  function selectAllVisible(visible: Array<{ id: string }>, checked: boolean) {
    const next = new Set(selectedIds.value);
    for (const item of visible) {
      if (checked) next.add(item.id);
      else next.delete(item.id);
    }
    selectedIds.value = next;
  }

  function pruneSelection() {
    const visible = new Set(collectionTracks.value.map((t) => t.id));
    const next = new Set([...selectedIds.value].filter((id) => visible.has(id)));
    selectedIds.value = next;
  }

  async function refreshTracks() {
    tracks.value = await window.linkAudio.listTracks();
  }

  async function refreshAll() {
    [tracks.value, folders.value, playlists.value, deletedTracks.value] = await Promise.all([
      window.linkAudio.listTracks(),
      window.linkAudio.listFolders(),
      window.linkAudio.listPlaylists(),
      window.linkAudio.listDeletedTracks()
    ]);
  }

  function applyUpdatedTrack(updated: Track) {
    tracks.value = tracks.value.map((t) => (t.id === updated.id ? updated : t));
    if (view.selectedTrack?.id === updated.id) view.selectedTrack = updated;
    usePlayerStore().syncUpdatedTrack(updated);
  }

  async function updateTrack(id: string, update: TrackUpdate) {
    // update 可能携带 reactive 数组（如 track.folderIds），IPC 结构化克隆不接受
    // Proxy，这里深拷贝成纯对象再发送
    const plain = JSON.parse(JSON.stringify(update)) as TrackUpdate;
    const updated = await window.linkAudio.updateTrack(id, plain);
    applyUpdatedTrack(updated);
    return updated;
  }

  async function reloadDeleted() {
    deletedTracks.value = await window.linkAudio.listDeletedTracks();
  }

  return {
    tracks, folders, playlists, deletedTracks, query, sort, selectedIds,
    collectionTracks, activePlaylist, activeFolder, isTrash,
    clearSelectionIf, clearSelection, toggleSelected, selectAllVisible, pruneSelection,
    refreshTracks, refreshAll, applyUpdatedTrack, updateTrack, reloadDeleted
  };
});
