<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useLibraryStore } from "../stores/library.js";
import { useModalsStore } from "../stores/modals.js";
import { useViewStore } from "../stores/view.js";
import { toast } from "../ui.js";

const modals = useModalsStore();
const library = useLibraryStore();
const view = useViewStore();
const picked = ref("");
const creating = ref(false);
const newName = ref("");
const error = ref("");

watch(
  () => modals.playlistPicker.open,
  (open) => {
    if (open) {
      picked.value = "";
      creating.value = false;
      newName.value = "";
      error.value = "";
    }
  }
);

const trackLabel = computed(() =>
  modals.playlistPicker.track ? `${modals.playlistPicker.track.title}` : ""
);

async function save() {
  const track = modals.playlistPicker.track;
  if (!track) return;
  try {
    let targetId = picked.value;
    if (creating.value) {
      const newNamed = newName.value.trim();
      if (!newNamed) {
        error.value = "请输入歌单名称。";
        return;
      }
      await window.linkAudio.createPlaylist(newNamed);
      library.playlists = await window.linkAudio.listPlaylists();
      targetId = library.playlists.find((p) => p.name === newNamed)?.id || "";
    }
    const playlist = library.playlists.find((p) => p.id === targetId);
    if (!playlist) {
      error.value = "请选择一个歌单。";
      return;
    }
    if (playlist.trackIds.includes(track.id)) {
      error.value = `已在歌单"${playlist.name}"中。`;
      return;
    }
    library.playlists = await window.linkAudio.updatePlaylist(playlist.id, [...playlist.trackIds, track.id]);
    if (`playlist:${playlist.id}` === view.activeCollection) view.showView("library", view.activeCollection, false);
    toast(`已收藏到"${playlist.name}"。`, "success");
    modals.closePlaylistPicker();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<template>
  <n-modal
    :show="modals.playlistPicker.open"
    preset="card"
    style="width: 400px"
    title="收藏到歌单"
    :bordered="false"
    @mask-click="modals.closePlaylistPicker"
    @after-leave="modals.closePlaylistPicker"
    @close="modals.closePlaylistPicker"
  >
    <p class="hint muted">{{ trackLabel }}</p>
    <div class="picker">
      <button
        v-for="playlist in library.playlists"
        :key="playlist.id"
        class="opt"
        :class="{ on: picked === playlist.id }"
        @click="picked = playlist.id; creating = false"
      >
        <span>{{ playlist.name }}</span>
        <span class="muted num">{{ playlist.trackIds.length }} 首</span>
      </button>
      <button class="opt new" :class="{ on: creating }" @click="creating = true; picked = ''">
        <span>＋ 新建歌单</span>
      </button>
      <input v-if="creating" v-model="newName" class="inp" placeholder="歌单名称" @keydown.enter="save" />
    </div>
    <p v-if="error" class="err">{{ error }}</p>
    <template #footer>
      <div class="acts">
        <button class="btn secondary" @click="modals.closePlaylistPicker">取消</button>
        <button class="btn primary" @click="save">保存</button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.hint { margin: 0 0 12px; font-size: 12.5px; }
.picker { border: 1px solid var(--line); border-radius: 10px; overflow: hidden auto; max-height: 240px; }
.opt {
  display: flex; justify-content: space-between; width: 100%; padding: 9px 12px;
  font-size: 12.5px; color: var(--ink-2); background: transparent; border: 0;
  border-bottom: 1px solid var(--line); cursor: pointer; text-align: left;
}
.opt:last-of-type { border-bottom: 0; }
.opt:hover { background: var(--row-hover); color: var(--ink); }
.opt.on { color: var(--accent); background: var(--accent-soft); }
.inp {
  width: 100%; padding: 8px 12px; border-radius: 0 0 10px 10px; border: 1px solid var(--line-strong);
  border-top: 0; background: var(--bg); color: var(--ink); font-size: 13px; outline: none;
}
.err { color: var(--danger); font-size: 12px; }
.acts { display: flex; justify-content: flex-end; gap: 9px; }
</style>
