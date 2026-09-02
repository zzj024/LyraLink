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
  () => modals.folder.open,
  (open) => {
    if (open) {
      name.value = modals.folder.editing?.name || "";
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
    if (modals.folder.editing) {
      library.folders = await window.linkAudio.renameFolder(modals.folder.editing.id, trimmed);
      toast("文件夹已重命名。", "success");
    } else {
      library.folders = await window.linkAudio.createFolder(trimmed);
      toast(`文件夹"${trimmed}"已创建。`, "success");
    }
    modals.closeFolder();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<template>
  <n-modal
    :show="modals.folder.open"
    preset="card"
    style="width: 380px"
    title="新建文件夹"
    :bordered="false"
    @mask-click="modals.closeFolder"
    @after-leave="modals.closeFolder"
    @close="modals.closeFolder"
  >
    <div class="field">
      <label class="muted">文件夹名称</label>
      <input v-model="name" class="inp" maxlength="40" placeholder="例如：通勤、古风、待整理" data-autofocus @keydown.enter="save" />
      <p v-if="error" class="err">{{ error }}</p>
    </div>
    <template #footer>
      <div class="acts">
        <button class="btn secondary" @click="modals.closeFolder">取消</button>
        <button class="btn primary" @click="save">{{ modals.folder.editing ? "保存" : "创建文件夹" }}</button>
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
