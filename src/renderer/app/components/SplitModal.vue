<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { AudioSegment, Track } from "../../../shared/types.js";
import { useLibraryStore } from "../stores/library.js";
import { useModalsStore } from "../stores/modals.js";
import { usePlayerStore } from "../stores/player.js";
import { useViewStore } from "../stores/view.js";
import { formatSyncTime } from "../format.js";
import { toast } from "../ui.js";

interface SegmentDraft {
  id: string;
  start: number;
  end: number;
  title: string;
  author: string;
}

const modals = useModalsStore();
const library = useLibraryStore();
const player = usePlayerStore();
const view = useViewStore();

const step = ref<"timeline" | "metadata">("timeline");
const segments = ref<SegmentDraft[]>([]);
const selectedId = ref("");
const history = ref<SegmentDraft[][]>([]);
const future = ref<SegmentDraft[][]>([]);
const error = ref("");
const quality = ref<"accurate" | "fast">("accurate");
const saving = ref(false);
const taskText = ref("");
const taskPercent = ref(0);
const previewPlaying = computed(() => player.isPlaying);
const playhead = computed(() => player.currentTime);
const track = computed<Track | null>(() => modals.split.track);
const total = computed(() => player.audio.duration || track.value?.duration || 0);
const zoom = ref(1);

const canvas = ref<HTMLCanvasElement | null>(null);
let metaInitialized = false;

const selected = computed(() => segments.value.find((s) => s.id === selectedId.value));

watch(
  () => modals.split.open,
  async (open) => {
    if (open && track.value) {
      player.loadPlayerTrack(track.value);
      player.audio.pause();
      const duration = total.value || 1;
      segments.value = [
        { id: draftId(), start: 0, end: duration, title: track.value.title, author: track.value.author }
      ];
      selectedId.value = segments.value[0].id;
      metaInitialized = false;
      history.value = [];
      future.value = [];
      error.value = "";
      step.value = "timeline";
      saving.value = false;
      await nextTick();
      void drawWaveform();
    }
  }
);

function draftId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneDrafts(): SegmentDraft[] {
  return segments.value.map((segment) => ({ ...segment }));
}

function rememberState() {
  history.value.push(cloneDrafts());
  if (history.value.length > 100) history.value.shift();
  future.value = [];
}

function undo() {
  const previous = history.value.pop();
  if (!previous) return;
  future.value.push(cloneDrafts());
  segments.value = previous;
  selectedId.value = segments.value[0]?.id || "";
}
function redo() {
  const next = future.value.pop();
  if (!next) return;
  history.value.push(cloneDrafts());
  segments.value = next;
  selectedId.value = segments.value[0]?.id || "";
}

async function drawWaveform() {
  if (!track.value || !canvas.value) return;
  const context = canvas.value.getContext("2d");
  if (!context) return;
  const styles = getComputedStyle(document.documentElement);
  const bg = styles.getPropertyValue("--elevated").trim() || "#22231f";
  const wave = styles.getPropertyValue("--accent").trim() || "#e7ff57";
  const w = (canvas.value.width = canvas.value.clientWidth * 2);
  const h = (canvas.value.height = canvas.value.clientHeight * 2);
  context.clearRect(0, 0, w, h);
  context.fillStyle = bg;
  context.fillRect(0, 0, w, h);
  try {
    const response = await fetch(track.value.fileUrl);
    const data = await response.arrayBuffer();
    const audioContext = new AudioContext();
    const buffer = await audioContext.decodeAudioData(data);
    const channel = buffer.getChannelData(0);
    const stepCount = Math.max(1, Math.floor(channel.length / w));
    context.strokeStyle = wave;
    context.lineWidth = 1;
    context.beginPath();
    for (let x = 0; x < w; x += 1) {
      let minimum = 1;
      let maximum = -1;
      const start = x * stepCount;
      for (let offset = 0; offset < stepCount; offset += 1) {
        const sample = channel[start + offset] || 0;
        minimum = Math.min(minimum, sample);
        maximum = Math.max(maximum, sample);
      }
      context.moveTo(x, ((1 + minimum) * h) / 2);
      context.lineTo(x, ((1 + maximum) * h) / 2);
    }
    context.stroke();
    await audioContext.close();
  } catch {
    context.fillStyle = "#8a8378";
    context.font = "22px sans-serif";
    context.fillText("无法生成波形，仍可使用时间轴裁切", 40, h / 2);
  }
}

function splitAtPlayhead() {
  const position = player.currentTime;
  const index = segments.value.findIndex(
    (segment) => position > segment.start + 0.05 && position < segment.end - 0.05
  );
  if (index < 0) {
    error.value = "请把播放头移动到某个片段内部再切开。";
    return;
  }
  rememberState();
  const source = segments.value[index];
  const left: SegmentDraft = { ...source, id: draftId(), end: position };
  const right: SegmentDraft = { ...source, id: draftId(), start: position };
  segments.value.splice(index, 1, left, right);
  selectedId.value = right.id;
  error.value = "";
}

function deleteSelected() {
  if (!selectedId.value) return;
  rememberState();
  segments.value = segments.value.filter((segment) => segment.id !== selectedId.value);
  selectedId.value = segments.value[0]?.id || "";
  if (!segments.value.length) error.value = "所有片段都已删除。可以取消后重新开始，或返回原音频。";
  else error.value = "";
}

function nudge(delta: number) {
  player.nudge(delta);
}

function selectSegment(segment: SegmentDraft) {
  selectedId.value = segment.id;
  player.seekTo(segment.start);
}

function togglePreview() {
  player.toggle();
}

function toMetadata() {
  if (!segments.value.length) {
    error.value = "请至少保留一个片段。";
    return;
  }
  player.audio.pause();
  if (!metaInitialized) {
    segments.value = segments.value.map((segment, index) => ({
      ...segment,
      title:
        segments.value.length === 1 ? track.value!.title : `${track.value!.title} ${index + 1}`,
      author: track.value!.author
    }));
    metaInitialized = true;
  }
  error.value = "";
  step.value = "metadata";
}

async function save() {
  if (!track.value) return;
  try {
    if (segments.value.some((segment) => !segment.title.trim())) throw new Error("每个片段都需要填写名称。");
    saving.value = true;
    taskText.value = "正在生成…";
    taskPercent.value = 0;
    const payload: AudioSegment[] = segments.value.map((segment) => ({
      start: segment.start,
      end: segment.end,
      title: segment.title.trim(),
      author: segment.author.trim(),
      mode: quality.value
    }));
    const created = await window.linkAudio.splitTrack(track.value.id, payload);
    await library.refreshTracks();
    modals.closeSplit();
    if (created[0]) view.openDetail(created[0]);
    toast(`已生成 ${created.length} 个片段。`, "success");
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    step.value = "metadata";
  } finally {
    saving.value = false;
  }
}

function onKeydown(event: KeyboardEvent) {
  if (step.value !== "timeline") return;
  if (event.code === "Space") {
    event.preventDefault();
    player.toggle();
  } else if (event.code === "Enter") {
    event.preventDefault();
    splitAtPlayhead();
  } else if (event.code === "Delete" || event.code === "Backspace") {
    event.preventDefault();
    deleteSelected();
  }
}
</script>

<template>
  <n-modal
    :show="modals.split.open"
    preset="card"
    style="width: min(860px, 94vw)"
    :title="`裁切 / 拆分 · ${track?.title || ''}`"
    :bordered="false"
    :auto-focus="false"
    @close="modals.closeSplit"
    @mask-click="modals.closeSplit"
    @keydown="onKeydown"
  >
    <template v-if="step === 'timeline'">
      <p class="hint muted">空格播放或暂停，Enter 在播放头位置切开，Delete 删除所选片段。这里只记录剪辑方案，不会修改音频文件。</p>
      <div class="preview-row">
        <button class="btn primary sm" @click="togglePreview">{{ previewPlaying ? "⏸" : "▶" }}</button>
        <span class="num">{{ formatSyncTime(playhead) }}</span>
        <input class="range" type="range" min="0" :max="total || 1" step="0.01" :value="playhead" aria-label="试听进度" @input="player.seekTo(Number(($event.target as HTMLInputElement).value))" />
        <span class="num">{{ formatSyncTime(total) }}</span>
      </div>
      <div class="wave-wrap">
        <canvas ref="canvas" class="waveform"></canvas>
        <div class="playhead" :style="{ left: `${total ? (playhead / total) * 100 : 0}%` }"></div>
      </div>
      <div class="timeline" @dragover.prevent>
        <button
          v-for="(segment, index) in segments"
          :key="segment.id"
          class="tl-seg"
          :class="{ on: segment.id === selectedId }"
          :style="{ left: `${(segment.start / (total || 1)) * 100}%`, width: `${((segment.end - segment.start) / (total || 1)) * 100}%` }"
          :title="`${formatSyncTime(segment.start)} — ${formatSyncTime(segment.end)}`"
          @click="selectSegment(segment)"
        >
          <strong>{{ index + 1 }}</strong>
          <span class="num">{{ formatSyncTime(segment.end - segment.start) }}</span>
        </button>
      </div>
      <div class="tools">
        <span class="muted num">{{ selected ? `${formatSyncTime(selected.start)} — ${formatSyncTime(selected.end)}` : "未选择" }}</span>
        <span style="flex: 1"></span>
        <button class="btn ghost sm" :disabled="!history.length" @click="undo">↶ 撤销</button>
        <button class="btn ghost sm" :disabled="!future.length" @click="redo">↷ 重做</button>
        <button class="btn ghost sm" :disabled="!selected" @click="deleteSelected">删除片段</button>
      </div>
      <div class="tools">
        <div class="nudge">
          <button class="btn ghost sm" @click="nudge(-5)">⏮5s</button>
          <button class="btn ghost sm" @click="nudge(-1)">◀1s</button>
          <button class="btn ghost sm" @click="nudge(1)">1s▶</button>
          <button class="btn ghost sm" @click="nudge(5)">5s⏭</button>
          <input
            class="inp num"
            style="width: 90px"
            type="number"
            step="0.01"
            :value="playhead.toFixed(2)"
            @change="player.seekTo(Number(($event.target as HTMLInputElement).value) || 0)"
          />
          <span class="sel-label">缩放</span>
          <input v-model="zoom" class="range zoom" type="range" min="1" max="4" step="0.5" />
        </div>
      </div>
      <p v-if="error" class="err">{{ error }}</p>
    </template>

    <template v-else>
      <p class="hint muted">每个保留片段都会生成一首新歌曲。默认沿用原封面和歌手，可分别修改歌名与歌手。</p>
      <div class="meta-list" :style="{ transform: `scale(${zoom})`, transformOrigin: 'top left' }">
        <article v-for="(segment, index) in segments" :key="segment.id" class="meta-card">
          <img v-if="track?.thumbnail" class="meta-cover" :src="track.thumbnail" alt="" />
          <div class="meta-fields">
            <small class="muted">片段 {{ index + 1 }} · {{ formatSyncTime(segment.start) }} — {{ formatSyncTime(segment.end) }}</small>
            <label>名称<input v-model="segment.title" class="inp" /></label>
            <label>歌手<input v-model="segment.author" class="inp" /></label>
          </div>
        </article>
      </div>
      <div class="quality">
        <span class="muted">导出质量</span>
        <select v-model="quality" class="inp" style="width: 160px">
          <option value="accurate">精准（较慢）</option>
          <option value="fast">快速（近似）</option>
        </select>
      </div>
      <p v-if="error" class="err">{{ error }}</p>
    </template>

    <template #footer>
      <div v-if="step === 'timeline'" class="acts">
        <button class="btn secondary" @click="modals.closeSplit">取消</button>
        <button class="btn primary" @click="toMetadata">下一步：填写片段信息</button>
      </div>
      <div v-else class="acts" style="justify-content: space-between">
        <button class="btn secondary" @click="step = 'timeline'">← 返回时间轴</button>
        <div style="display: flex; gap: 9px; align-items: center">
          <span v-if="saving" class="muted num">{{ taskText }} {{ taskPercent }}%</span>
          <button class="btn primary" :disabled="saving" @click="save">{{ saving ? "正在生成…" : "确认并生成全部片段" }}</button>
        </div>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.hint { margin: 0 0 12px; font-size: 12.5px; }
.preview-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.range { flex: 1; accent-color: var(--accent); }
.range.zoom { flex: 0 0 120px; }
.wave-wrap { position: relative; border-radius: 10px; overflow: hidden; border: 1px solid var(--line); }
.waveform { width: 100%; height: 110px; display: block; }
.playhead {
  position: absolute; top: 0; bottom: 0; width: 2px; background: var(--accent);
  box-shadow: 0 0 8px var(--accent); pointer-events: none;
}
.timeline { position: relative; height: 52px; margin-top: 10px; background: var(--bg); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
.tl-seg {
  position: absolute; top: 5px; bottom: 5px; border: 1px solid var(--line-strong);
  border-radius: 8px; background: var(--elevated); color: var(--ink); cursor: pointer;
  display: flex; flex-direction: column; align-items: flex-start; justify-content: center;
  padding: 0 8px; overflow: hidden; font-size: 11px;
}
.tl-seg:hover { border-color: var(--accent); }
.tl-seg.on { border-color: var(--accent); background: var(--accent-soft); }
.tl-seg strong { font-size: 12px; }
.tools { display: flex; align-items: center; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.nudge { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.sel-label { color: var(--ink-3); font-size: 12px; margin-left: 10px; }
.inp {
  padding: 7px 10px; border-radius: 9px; border: 1px solid var(--line-strong);
  background: var(--bg); color: var(--ink); font-size: 12.5px; outline: none;
}
.inp:focus { border-color: var(--accent); }
.err { color: var(--danger); font-size: 12.5px; margin-top: 10px; }
.acts { display: flex; justify-content: flex-end; gap: 9px; }
.meta-list { display: flex; flex-direction: column; gap: 12px; max-height: 340px; overflow: auto; padding-right: 4px; }
.meta-card { display: grid; grid-template-columns: 72px 1fr; gap: 14px; border: 1px solid var(--line); border-radius: 12px; padding: 12px; }
.meta-cover { width: 72px; height: 72px; border-radius: 10px; object-fit: cover; }
.meta-fields { display: flex; flex-direction: column; gap: 8px; }
.meta-fields label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--ink-2); }
.quality { display: flex; align-items: center; gap: 10px; margin-top: 14px; font-size: 12.5px; }
</style>
