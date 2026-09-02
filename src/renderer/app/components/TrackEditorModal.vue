<script setup lang="ts">
import { ref, watch } from "vue";
import type { CoverSelection } from "../../../shared/types.js";
import { useLibraryStore } from "../stores/library.js";
import { useModalsStore } from "../stores/modals.js";
import { toast } from "../ui.js";

const modals = useModalsStore();
const library = useLibraryStore();

const title = ref("");
const author = ref("");
const favorite = ref(false);
const folderIds = ref<string[]>([]);
const cover = ref<CoverSelection | null>(null);
const error = ref("");

watch(
  () => modals.trackEditor.open,
  (open) => {
    if (open) {
      const track = modals.trackEditor.track;
      title.value = track?.title || "";
      author.value = track?.author || "";
      favorite.value = track?.favorite || false;
      folderIds.value = [...(track?.folderIds || [])];
      cover.value = null;
      error.value = "";
    }
  }
);

async function chooseCover() {
  try {
    cover.value = await window.linkAudio.chooseTrackCover();
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), "error");
  }
}

async function save() {
  const track = modals.trackEditor.track;
  if (!track) return;
  if (!title.value.trim()) {
    error.value = "歌名不能为空。";
    return;
  }
  try {
    await library.updateTrack(track.id, {
      title: title.value.trim(),
      author: author.value.trim(),
      favorite: favorite.value,
      folderIds: [...folderIds.value],
      coverSourcePath: cover.value?.sourcePath
    });
    toast("歌曲信息已保存。", "success");
    modals.closeTrackEditor();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}
function toggleFolder(id: string, on: boolean) {
  folderIds.value = on ? [...folderIds.value, id] : folderIds.value.filter((f) => f !== id);
}
</script>

<template>
  <n-modal
    :show="modals.trackEditor.open"
    preset="card"
    style="width: 440px"
    title="编辑歌曲信息"
    :bordered="false"
    @mask-click="modals.closeTrackEditor"
    @after-leave="modals.closeTrackEditor"
    @close="modals.closeTrackEditor"
  >
    <div class="grid">
      <div class="cover-col">
        <img v-if="cover?.previewUrl" class="cover" :src="cover.previewUrl" alt="" />
        <img v-else-if="modals.trackEditor.track?.thumbnail" class="cover" :src="modals.trackEditor.track!.thumbnail!" alt="" />
        <span v-else class="cover placeholder">♪</span>
        <button class="btn secondary sm" @click="chooseCover">选择封面</button>
      </div>
      <div class="fields">
        <label>歌名<input v-model="title" class="inp" /></label>
        <label>歌手<input v-model="author" class="inp" /></label>
        <label class="checkline"><input v-model="favorite" type="checkbox" /> 加入喜欢</label>
      </div>
    </div>
    <div class="folders">
      <span class="muted">所在文件夹</span>
      <div class="folder-list">
        <label v-for="folder in library.folders" :key="folder.id" class="folder-chip" :class="{ on: folderIds.includes(folder.id) }">
          <input
            type="checkbox"
            :checked="folderIds.includes(folder.id)"
            @change="toggleFolder(folder.id, ($event.target as HTMLInputElement).checked)"
          />
          {{ folder.name }}
        </label>
        <span v-if="!library.folders.length" class="muted" style="font-size: 12px">暂无文件夹，可在侧栏新建。</span>
      </div>
    </div>
    <p v-if="error" class="err">{{ error }}</p>
    <template #footer>
      <div class="acts">
        <button class="btn secondary" @click="modals.closeTrackEditor">取消</button>
        <button class="btn primary" @click="save">保存信息</button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: 120px 1fr; gap: 18px; }
.cover-col { display: flex; flex-direction: column; gap: 8px; align-items: center; }
.cover { width: 116px; height: 116px; border-radius: 12px; object-fit: cover; box-shadow: var(--shadow-sm); }
.cover.placeholder { display: grid; place-items: center; background: var(--elevated); color: var(--ink-3); }
.fields { display: flex; flex-direction: column; gap: 12px; }
.fields label { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: var(--ink-2); }
.fields label.checkline { flex-direction: row; align-items: center; }
.inp {
  padding: 9px 12px; border-radius: 10px; border: 1px solid var(--line-strong);
  background: var(--bg); color: var(--ink); font-size: 13px; outline: none;
}
.inp:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.folders { margin-top: 16px; display: flex; flex-direction: column; gap: 8px; font-size: 12.5px; }
.folder-list { display: flex; flex-wrap: wrap; gap: 8px; }
.folder-chip {
  display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px;
  border: 1px solid var(--line-strong); border-radius: 999px; cursor: pointer; font-size: 12px;
}
.folder-chip.on { border-color: var(--accent); background: var(--accent-soft); color: var(--ink); }
.folder-chip input { accent-color: var(--accent); }
.err { color: var(--danger); font-size: 12px; margin-top: 10px; }
.acts { display: flex; justify-content: flex-end; gap: 9px; }
</style>
