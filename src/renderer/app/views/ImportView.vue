<script setup lang="ts">
import { computed, ref } from "vue";
import type { MediaPreview } from "../../../shared/types.js";
import { useLibraryStore } from "../stores/library.js";
import { useTaskStore } from "../stores/tasks.js";
import { useViewStore } from "../stores/view.js";
import { previewMeta } from "../format.js";
import { toast } from "../ui.js";

const input = ref("");
const status = ref<{ text: string; kind: "working" | "success" | "error" } | null>(null);
const preview = ref<MediaPreview | null>(null);
const tasks = useTaskStore();
const library = useLibraryStore();
const view = useViewStore();

const canImport = computed(() => input.value.trim().length > 0);

function parseBilibili(value: string): string | null {
  const patterns = [/https?:\/\/www\.bilibili\.com\/video\/(BV[\w]+)/i, /(BV[\w]{10,})/i];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return `https://www.bilibili.com/video/${match[1]}`;
  }
  return null;
}

async function doImport() {
  const raw = input.value.trim();
  if (!raw) return;
  const url = parseBilibili(raw) || raw;
  status.value = { text: "正在解析链接…", kind: "working" };
  try {
    const track = await window.linkAudio.importAudio({ input: url, taskId: crypto.randomUUID() });
    status.value = { text: `导入完成：${track.title}`, kind: "success" };
    preview.value = track;
    input.value = "";
    await library.refreshTracks();
  } catch (error) {
    status.value = { text: error instanceof Error ? error.message : String(error), kind: "error" };
  }
}

function importLocalFiles() {
  void window.linkAudio.importLocalAudio().then(async (imported) => {
    if (!imported.length) return;
    await library.refreshTracks();
    preview.value = imported[0];
    toast(`已导入 ${imported.length} 个本地音频。`, "success");
  });
}
function importLocalFolder() {
  void window.linkAudio.importLocalFolder().then(async (imported) => {
    if (!imported.length) return;
    await library.refreshTracks();
    preview.value = imported[0];
    toast(`已从文件夹导入 ${imported.length} 个音频。`, "success");
  });
}
</script>

<template>
  <section class="import-view">
    <header class="iv-head">
      <h3>导入音乐</h3>
    </header>

    <!-- 链接导入 -->
    <div class="card">
      <label class="card-label" for="import-input">导入音乐链接（B 站 / Joox / 网易云）</label>
      <textarea
        id="import-input"
        v-model="input"
        rows="4"
        placeholder="例如：https://www.bilibili.com/video/BV..."
      ></textarea>
      <div class="import-foot">
        <span class="src-badge"><i></i>哔哩哔哩</span>
        <span class="src-badge joox"><i></i>Joox</span>
        <span class="src-badge netease"><i></i>网易云</span>
        <span style="flex: 1"></span>
        <button class="btn primary" :disabled="!canImport" @click="doImport">导入音频 →</button>
      </div>
      <div v-if="status" class="status" :class="status.kind">
        <span class="dot"></span>{{ status.text }}
      </div>
    </div>

    <!-- 导入本地音频 -->
    <div class="card">
      <label class="card-label">导入本地音频</label>
      <div class="local-grid">
        <button class="local-box" @click="importLocalFiles">
          <span class="local-ico">♪</span>
          <b>导入本地文件</b>
          <small>选择一个或多个音频文件</small>
        </button>
        <button class="local-box" @click="importLocalFolder">
          <span class="local-ico">▤</span>
          <b>导入本地文件夹</b>
          <small>扫描整个文件夹中的音频</small>
        </button>
      </div>
      <div class="search-redirect">
        <span>想找新歌？</span>
        <button class="btn primary sm" @click="view.showView('search')">去在线搜索 →</button>
      </div>
    </div>

    <!-- 导入预览 -->
    <div v-if="preview" class="card preview-card">
      <img v-if="preview.thumbnail" class="pv-cover" :src="preview.thumbnail" alt="" />
      <span v-else class="pv-cover placeholder">♪</span>
      <div class="pv-copy">
        <b class="ellip">{{ preview.title }}</b>
        <small class="muted">{{ previewMeta(preview) }}</small>
      </div>
    </div>
  </section>
</template>

<style scoped>
.import-view { max-width: 1060px; margin: 0 auto; padding: 30px 28px 60px; }
.iv-head h3 { margin: 0 0 16px; font-size: 28px; font-weight: 800; }
.card {
  border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--panel-solid);
  padding: 20px; margin-bottom: 18px; box-shadow: var(--shadow-sm);
}
.card-label { display: block; font-size: 13px; font-weight: 600; color: var(--ink); margin-bottom: 10px; }
textarea {
  width: 100%; resize: vertical; border-radius: 12px; border: 1px solid var(--line-strong);
  background: var(--bg); color: var(--ink); padding: 12px 14px; font: inherit; outline: none;
}
textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.import-foot { display: flex; align-items: center; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
.src-badge {
  display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--ink-2);
  padding: 2px 9px; border: 1px solid var(--line-strong); border-radius: 999px;
}
.src-badge i { width: 6px; height: 6px; border-radius: 50%; background: #fb7299; }
.src-badge.netease i { background: #dd001b; }
.src-badge.joox i { background: #00d26a; }
.status { display: flex; align-items: center; gap: 9px; margin-top: 12px; font-size: 13px; }
.status .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.status.working .dot { background: var(--warning); }
.status.success .dot { background: var(--success); }
.status.error { color: var(--danger); }
.status.error .dot { background: var(--danger); }
.local-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.local-box {
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  padding: 22px 16px; border: 1px dashed var(--line-strong); border-radius: var(--r-md);
  background: var(--bg); color: var(--ink); cursor: pointer; transition: all 0.15s;
}
.local-box:hover { border-color: var(--accent); background: var(--accent-soft); }
.local-ico { font-size: 22px; color: var(--accent); }
.local-box b { font-size: 13.5px; }
.local-box small { color: var(--ink-3); font-size: 11.5px; }
.search-redirect { display: flex; align-items: center; gap: 12px; margin-top: 14px; color: var(--ink-2); font-size: 12.5px; }
.preview-card { display: flex; align-items: center; gap: 14px; }
.pv-cover { width: 72px; height: 54px; border-radius: 10px; object-fit: cover; flex: none; }
.pv-cover.placeholder { display: grid; place-items: center; background: var(--elevated); color: var(--ink-3); }
.pv-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pv-copy small { font-size: 11px; }
.pv-copy b { font-size: 14px; }
.muted { color: var(--ink-3); }
</style>
