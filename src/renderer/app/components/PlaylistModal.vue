<script setup lang="ts">
import { ref, watch } from "vue";
import { useLibraryStore } from "../stores/library.js";
import { useModalsStore } from "../stores/modals.js";
import { toast } from "../ui.js";

const modals = useModalsStore();
const library = useLibraryStore();
const name = ref("");
const error = ref("");

watch(
  () => modals.playlist.open,
  (open) => {
    if (open) {
      name.value = "";
      error.value = "";
    }
  }
);

async function save() {
  const trimmed = name.value.trim();
  if (!trimmed) {
    error.value = "名称不能为空。";
    return;
  }
  try {
    library.playlists = await window.linkAudio.createPlaylist(trimmed);
    toast(`歌单"${trimmed}"已创建。`, "success");
    modals.closePlaylist();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<template>
  <n-modal
    :show="modals.playlist.open"
    preset="card"
    style="width: 380px"
    title="新建歌单"
    :bordered="false"
    @mask-click="modals.closePlaylist"
    @after-leave="modals.closePlaylist"
    @close="modals.closePlaylist"
  >
    <div class="field">
      <label class="muted">名称</label>
      <input v-model="name" class="inp" maxlength="40" placeholder="例如：跑步、学习、睡前" @keydown.enter="save" />
      <p v-if="error" class="err">{{ error }}</p>
    </div>
    <template #footer>
      <div class="acts">
        <button class="btn secondary" @click="modals.closePlaylist">取消</button>
        <button class="btn primary" @click="save">创建</button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.field { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; }
.inp {
  padding: 9px 12px; border-radius: 10px; border: 1px solid var(--line-strong);
  background: var(--bg); color: var(--ink); font-size: 13px; outline: none;
}
.inp:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.err { color: var(--danger); font-size: 12px; margin: 4px 0 0; }
.acts { display: flex; justify-content: flex-end; gap: 9px; }
</style>
