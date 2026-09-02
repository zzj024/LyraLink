<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { LyricLine, Track } from "../../../shared/types.js";
import { useLibraryStore } from "../stores/library.js";
import { useModalsStore } from "../stores/modals.js";
import { usePlayerStore } from "../stores/player.js";
import { cleanLyrics, displayTitle, formatSyncTime } from "../format.js";
import { toast } from "../ui.js";

interface ReviewLine extends LyricLine {}

const modals = useModalsStore();
const library = useLibraryStore();
const player = usePlayerStore();

const track = computed<Track | null>(() => modals.lyrics.track);
const step = computed(() => modals.workbenchStep);
const mode = ref<"prepare" | "match-choice" | "manual-sync" | "ai-matching" | "review">("prepare");

const lyricsText = ref("");
const lineCount = ref(0);
const aiMessage = ref("");
const aiError = ref(false);
const candidates = ref<Array<{ id: string; provider: string; title: string; author: string; album: string | null; duration: number | null; mode: "synced" | "plain" }>>([]);
const candidatesLoading = ref(false);
const candidatesMessage = ref("");
const keyword = ref("");

/** 歌词源一览（与主进程 collectLyricsCandidates 对应） */
const LYRICS_PROVIDERS = ["LRCLIB", "LrcAPI", "网易云", "QQ音乐", "酷狗音乐"];

// 手动打轴
const syncTexts = ref<string[]>([]);
const syncTimes = ref<number[]>([]);
const syncIndex = ref(0);
const syncStarted = ref(false);

// AI / 校验
const reviewLines = ref<ReviewLine[]>([]);
const reviewSource = ref<"manual" | "ai" | "online">("manual");
const reviewIndex = ref(0);
const reviewTextInput = ref("");
const shiftAmount = ref(0.5);

const total = computed(() => player.audio.duration || track.value?.duration || 1);
const isPlaying = computed(() => player.isPlaying);

watch(
  () => modals.lyrics.open,
  (open) => {
    if (open && track.value) {
      lyricsText.value = (track.value.lyrics?.lines || []).map((line) => line.text).join("\n");
      lineCount.value = (track.value.lyrics?.lines || []).length;
      mode.value = "prepare";
      candidates.value = [];
      candidatesMessage.value = "";
      syncTimes.value = [];
      syncIndex.value = 0;
      syncStarted.value = false;
    }
  }
);

function updateLineCount() {
  lineCount.value = cleanLyrics(lyricsText.value).length;
}

function rememberLyricsVersion(target: Track) {
  if (!target.lyrics) return;
  localStorage.setItem(`linkAudioLyricsPrevious:${target.id}`, JSON.stringify(target.lyrics));
}

async function searchCandidates() {
  if (!track.value) return;
  const cleaned = keyword.value.trim();
  if (!cleaned) {
    candidatesMessage.value = "请先输入歌名或歌手关键词。";
    return;
  }
  candidatesLoading.value = true;
  candidatesMessage.value = "";
  try {
    candidates.value = await window.linkAudio.searchLyricsByKeyword(track.value.id, cleaned);
    if (!candidates.value.length) candidatesMessage.value = "各歌词源都没有找到匹配结果，换个关键词试试。";
  } catch (error) {
    candidates.value = [];
    candidatesMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    candidatesLoading.value = false;
  }
}

async function applyCandidate(candidateId: string) {
  if (!track.value) return;
  candidatesLoading.value = true;
  try {
    const result = await window.linkAudio.applyOnlineLyrics(track.value.id, candidateId);
    if (result.mode === "synced") {
      // 命中 LRC 歌词文件：直接解析时间轴进入逐句校验，省去手动打轴
      const synced: LyricLine[] = result.text.split(/\r?\n/).map((raw): LyricLine | null => {
        const match = raw.match(/^\[(\d{2,3}):(\d{2}(?:\.\d{1,3})?)\](.*)$/);
        if (!match) return null;
        return {
          start: Number(match[1]) * 60 + Number(match[2]),
          end: null,
          text: match[3].trim()
        };
      }).filter((line): line is LyricLine => Boolean(line && line.text));
      if (synced.length) {
        lyricsText.value = synced.map((line) => line.text).join("\n");
        updateLineCount();
        toast(`已载入 ${result.provider} 的带时间轴歌词，直接进入校验。`, "success");
        openAiReview(synced, "online");
        return;
      }
    }
    lyricsText.value = result.text;
    updateLineCount();
    candidatesMessage.value = `已载入 ${result.provider} 的纯文本歌词，保存前不会改动原歌词。`;
  } catch (error) {
    candidatesMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    candidatesLoading.value = false;
  }
}

function startManualSync() {
  syncTexts.value = cleanLyrics(lyricsText.value);
  if (!syncTexts.value.length) {
    lineCount.value = -1; // 显示错误提示
    return;
  }
  syncTimes.value = [];
  syncIndex.value = 0;
  syncStarted.value = false;
  mode.value = "manual-sync";
  modals.workbenchStep = "match";
  if (track.value) player.play(track.value);
  player.audio.currentTime = 0;
}

function tapLine() {
  if (!syncTexts.value.length) return;
  if (!syncStarted.value) {
    syncStarted.value = true;
    syncTimes.value = [player.audio.currentTime];
  } else if (syncIndex.value + 1 < syncTexts.value.length) {
    syncIndex.value += 1;
    syncTimes.value = [...syncTimes.value];
    syncTimes.value[syncIndex.value] = player.audio.currentTime;
  }
}

function undoSync() {
  if (!syncTimes.value.length) return;
  const next = [...syncTimes.value];
  next.pop();
  syncTimes.value = next;
  syncStarted.value = syncTimes.value.length > 0;
  syncIndex.value = syncStarted.value ? syncTimes.value.length - 1 : 0;
  player.audio.currentTime = syncTimes.value[syncTimes.value.length - 1] || 0;
}

const lastLineStarted = computed(() => syncStarted.value && syncIndex.value === syncTexts.value.length - 1);
const canSaveSync = computed(() => syncTimes.value.length === syncTexts.value.length && syncTexts.value.length > 0);

async function saveSync() {
  if (!track.value || !canSaveSync.value) return;
  const lines: LyricLine[] = syncTexts.value.map((text, index) => ({
    text,
    start: syncTimes.value[index],
    end: index + 1 < syncTimes.value.length ? syncTimes.value[index + 1] : player.audio.duration || null,
    confidence: 1
  }));
  try {
    rememberLyricsVersion(track.value);
    const updated = await window.linkAudio.saveLyrics(track.value.id, lines, "manual");
    library.applyUpdatedTrack(updated);
    toast("手动匹配歌词已保存。", "success");
    modals.closeLyrics();
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  }
}

function openAiReview(lines: LyricLine[] | undefined, source: "manual" | "ai" | "online" = "manual") {
  if (!lines?.length) return;
  reviewLines.value = lines.map((line) => ({ ...line }));
  reviewSource.value = source;
  reviewIndex.value = Math.max(0, reviewLines.value.findIndex((line) => (line.confidence ?? 1) < 0.6));
  mode.value = "review";
  modals.workbenchStep = "review";
  if (track.value) player.loadPlayerTrack(track.value);
  player.audio.pause();
}

function startAiAlignment() {
  const texts = cleanLyrics(lyricsText.value);
  if (!track.value || !texts.length) {
    aiMessage.value = "请先准备歌词文本。";
    aiError.value = true;
    return;
  }
  aiMessage.value = "AI 正在对齐歌词…";
  aiError.value = false;
  mode.value = "ai-matching";
  window.linkAudio
    .alignLyrics(track.value.id, texts)
    .then((lines) => {
      openAiReview(lines, "ai");
      toast("AI 对齐完成，请逐句校验。", "success");
    })
    .catch((error) => {
      mode.value = "match-choice";
      aiMessage.value = error instanceof Error ? error.message : String(error);
      aiError.value = true;
    });
}

function cancelAi() {
  void window.linkAudio.cancelAiAlignment();
  mode.value = "match-choice";
}

function selectReviewLine(index: number) {
  reviewIndex.value = index;
  if (track.value) {
    player.loadPlayerTrack(track.value);
    player.audio.currentTime = reviewLines.value[index].start;
  }
}

function clampReviewStart(index: number, value: number) {
  const previous = index > 0 ? reviewLines.value[index - 1].start + 0.05 : 0;
  const next = index + 1 < reviewLines.value.length ? reviewLines.value[index + 1].start - 0.05 : Infinity;
  return Math.max(previous, Math.min(next, value));
}

function rebuildEnds() {
  reviewLines.value = reviewLines.value.map((line, index) => ({
    ...line,
    end: index + 1 < reviewLines.value.length ? reviewLines.value[index + 1].start : player.audio.duration || line.end
  }));
}

function adjustReviewLine(delta: number) {
  const line = reviewLines.value[reviewIndex.value];
  if (!line) return;
  line.start = clampReviewStart(reviewIndex.value, line.start + delta);
  line.confidence = 1;
  rebuildEnds();
  player.audio.currentTime = line.start;
}

function setReviewToCurrentTime() {
  const line = reviewLines.value[reviewIndex.value];
  if (!line) return;
  const previous = reviewIndex.value > 0 ? reviewLines.value[reviewIndex.value - 1].start + 0.05 : 0;
  line.start = Math.max(previous, player.audio.currentTime);
  line.confidence = 1;
  rebuildEnds();
}

function tapReviewLine() {
  const currentIndex = reviewIndex.value;
  const line = reviewLines.value[currentIndex];
  if (!line) return;
  const previous = currentIndex > 0 ? reviewLines.value[currentIndex - 1].start + 0.05 : 0;
  line.start = Math.max(previous, player.audio.currentTime);
  line.confidence = 1;
  rebuildEnds();
  if (currentIndex + 1 < reviewLines.value.length) reviewIndex.value = currentIndex + 1;
}

function shiftAll(delta: number) {
  const duration = player.audio.duration || track.value?.duration || Infinity;
  const minimum = reviewLines.value.length ? -reviewLines.value[0].start : 0;
  const maximum = reviewLines.value.length ? duration - reviewLines.value[reviewLines.value.length - 1].start : 0;
  const safeDelta = Math.max(minimum, Math.min(maximum, delta));
  reviewLines.value = reviewLines.value.map((line) => ({ ...line, start: line.start + safeDelta }));
  rebuildEnds();
}

async function saveReview() {
  if (!track.value) return;
  if (reviewLines.value.some((line) => !line.text.trim())) {
    toast("歌词文字不能为空，请补充后再保存。", "error");
    return;
  }
  const lines = reviewLines.value.map((line) => ({ ...line, text: line.text.trim() }));
  try {
    rememberLyricsVersion(track.value);
    const updated = await window.linkAudio.saveLyrics(track.value.id, lines, reviewSource.value);
    library.applyUpdatedTrack(updated);
    toast("歌词已保存。", "success");
    modals.closeLyrics();
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  }
}

function onSyncKeydown(event: KeyboardEvent) {
  if (mode.value !== "manual-sync") return;
  if (event.code === "Space") {
    event.preventDefault();
    tapLine();
  } else if (event.code === "Backspace") {
    event.preventDefault();
    undoSync();
  } else if (event.code === "ArrowLeft") {
    event.preventDefault();
    player.nudge(event.shiftKey ? -2 : -2);
  } else if (event.code === "ArrowRight") {
    event.preventDefault();
    player.nudge(2);
  }
}
function onReviewKeydown(event: KeyboardEvent) {
  if (mode.value !== "review") return;
  if (event.code === "Space") {
    event.preventDefault();
    if (reviewIndex.value >= 0 && reviewLines.value[reviewIndex.value]?.confidence === undefined) tapReviewLine();
    else tapReviewLine();
  } else if (event.code === "ArrowLeft") {
    event.preventDefault();
    adjustReviewLine(event.shiftKey ? -1 : -0.2);
  } else if (event.code === "ArrowRight") {
    event.preventDefault();
    adjustReviewLine(event.shiftKey ? 1 : 0.2);
  } else if (event.code === "Enter") {
    event.preventDefault();
    setReviewToCurrentTime();
  }
}

const tapButtonText = computed(() =>
  !syncStarted.value ? "唱到这句开头时，按空格" : lastLineStarted.value ? "最后一句已标记，可以保存" : "下一句开始时，按空格"
);
const currentLine = computed(() => syncTexts.value[syncIndex.value] || "全部歌词已完成");
const upcomingLines = computed(() => syncTexts.value.slice(syncIndex.value + 1, syncIndex.value + 4));
</script>

<template>
  <n-modal
    :show="modals.lyrics.open"
    preset="card"
    style="width: min(980px, 96vw)"
    :bordered="false"
    :auto-focus="false"
    @close="modals.closeLyrics"
    @mask-click="modals.closeLyrics"
  >
    <template #header>
      <div class="wb-header">
        <span class="wb-cover">词</span>
        <div><b>{{ displayTitle(track?.title || "", 28) }}</b><small class="muted">歌词工作台</small></div>
        <div class="steps">
          <button class="step" :class="{ on: step === 'prepare' }">1 准备歌词</button>
          <button class="step" :class="{ on: step === 'match' }" :disabled="mode === 'prepare'">2 选择模式</button>
          <button class="step" :class="{ on: step === 'review' }" :disabled="mode !== 'review'">3 校验</button>
        </div>
        <button class="btn secondary sm" @click="modals.closeLyrics">退出</button>
      </div>
    </template>

    <!-- 步骤 1：准备歌词 -->
    <div v-if="mode === 'prepare'">
      <div class="search-stage">
        <div class="ss-head">
          <div>
            <span class="stage-no">01</span>
            <div>
              <h4>搜索歌词版本</h4>
              <p class="muted">输入歌名或歌手关键词，在多个歌词源中查找；带时间轴的版本可直接跳到校验。</p>
            </div>
          </div>
        </div>
        <div class="ss-search">
          <input
            v-model="keyword"
            class="inp"
            placeholder="例如：成都 赵雷"
            @keydown.enter="searchCandidates"
          />
          <button class="btn primary sm" :disabled="candidatesLoading || !keyword.trim()" @click="searchCandidates">搜索歌词</button>
          <button v-if="candidates.length" class="btn ghost sm" :disabled="candidatesLoading" @click="candidates = []; candidatesMessage = ''">清除结果</button>
        </div>
        <div class="provider-legend">
          <span class="muted">搜索源：</span>
          <span v-for="provider in LYRICS_PROVIDERS" :key="provider" class="provider-chip">{{ provider }}</span>
        </div>
        <p v-if="candidatesMessage" class="ss-message">{{ candidatesMessage }}</p>
        <div v-if="candidates.length" class="candidates">
          <button v-for="candidate in candidates" :key="candidate.id" class="candidate" :disabled="candidatesLoading" @click="applyCandidate(candidate.id)">
            <b class="ellip">{{ candidate.title }}<em class="cand-mode" :class="{ synced: candidate.mode === 'synced' }">{{ candidate.mode === "synced" ? "LRC 带时间轴" : "纯文本" }}</em></b>
            <small>{{ candidate.author }} · {{ candidate.provider }}<template v-if="candidate.album"> · {{ candidate.album }}</template></small>
          </button>
        </div>
      </div>

      <div class="wb-main">
        <section class="wb-content">
          <div class="sec-title">
            <span class="stage-no">02</span>
            <div><h4>编辑歌词文本</h4><p class="muted">每句单独一行。可以修改错字；LRC 标签和网页序号会自动清理。</p></div>
          </div>
          <textarea v-model="lyricsText" rows="12" class="lyrics-input" @input="updateLineCount"></textarea>
          <p class="line-count muted" :class="{ err: lineCount < 0 }">
            {{ lineCount < 0 ? "请至少粘贴一行歌词" : `${lineCount} 行歌词` }}
          </p>
        </section>
        <aside class="wb-tools">
          <div class="sec-title compact">
            <span class="stage-no ok">✓</span>
            <div><h4>准备完成</h4><p class="muted">确认歌词完整、错字已经修改，再进入匹配。</p></div>
          </div>
          <button class="btn primary block" @click="modals.workbenchStep = 'match'; mode = 'match-choice'">进入匹配</button>
        </aside>
      </div>
    </div>

    <!-- 步骤 2：选择匹配方式 -->
    <div v-else-if="mode === 'match-choice'" @keydown="onSyncKeydown">
      <div class="methods">
        <section class="method-card recommended">
          <h4>手动打轴</h4>
          <p class="muted">跟着音乐按空格逐句打点，最精准。</p>
          <button class="btn primary" @click="startManualSync">开始手动打点</button>
        </section>
        <section class="method-card">
          <h4>AI 自动对齐</h4>
          <p class="muted">调用本机 AI 服务自动匹配时间轴，完成后逐句校验。</p>
          <button class="btn secondary" :disabled="!track?.lyrics && lineCount <= 0" @click="startAiAlignment">AI 对齐</button>
          <p v-if="aiMessage" class="ai-msg" :class="{ err: aiError }">{{ aiMessage }}</p>
        </section>
      </div>
    </div>

    <!-- AI 对齐中 -->
    <div v-else-if="mode === 'ai-matching'" class="ai-view">
      <div class="spinner"></div>
      <h4>AI 正在对齐歌词</h4>
      <p class="muted">请稍候。完成后会自动进入校验页面，原歌词在保存前不会被替换。</p>
      <button class="btn secondary sm" @click="cancelAi">取消</button>
    </div>

    <!-- 手动打轴 -->
    <div v-else-if="mode === 'manual-sync'" @keydown="onSyncKeydown" tabindex="0">
      <div class="sync-grid">
        <div class="sync-left">
          <small class="muted num">{{ Math.min(syncIndex + 1, syncTexts.length) }} / {{ syncTexts.length }}</small>
          <div class="sync-current" :class="{ singing: syncStarted }">{{ currentLine }}</div>
          <div class="sync-upcoming">
            <p v-for="text in upcomingLines" :key="text">{{ text }}</p>
          </div>
        </div>
        <div class="sync-right">
          <button class="tap-btn" :disabled="lastLineStarted" @click="tapLine">{{ tapButtonText }}</button>
          <div class="sync-ops">
            <button class="btn secondary sm" @click="player.toggle">{{ isPlaying ? "暂停" : "继续播放" }}</button>
            <button class="btn secondary sm" :disabled="!syncTimes.length" @click="undoSync">撤销上一句</button>
          </div>
          <input class="range" type="range" min="0" :max="total" step="0.1" :value="player.currentTime" aria-label="打轴进度" @input="player.seekTo(Number(($event.target as HTMLInputElement).value))" />
          <div class="sync-times muted num">{{ formatSyncTime(player.currentTime) }} / {{ formatSyncTime(total) }}</div>
          <button class="btn primary block" :disabled="!canSaveSync" @click="saveSync">保存歌词</button>
          <button class="btn ghost sm block" @click="mode = 'match-choice'">← 返回方式选择</button>
        </div>
      </div>
    </div>

    <!-- 逐句校验 -->
    <div v-else-if="mode === 'review'" @keydown="onReviewKeydown" tabindex="0">
      <div class="review-grid">
        <div class="review-lines">
          <button
            v-for="(line, index) in reviewLines"
            :key="index"
            class="review-line"
            :class="{ on: index === reviewIndex, low: (line.confidence ?? 1) < 0.6 }"
            @click="selectReviewLine(index)"
          >
            <time class="num">{{ formatSyncTime(line.start) }}</time>
            <span class="ellip">{{ line.text }}</span>
            <em>{{ (line.confidence ?? 1) === 0 ? "未找到位置 · 已估算" : (line.confidence ?? 1) < 0.6 ? "建议试听" : "匹配良好" }}</em>
          </button>
        </div>
        <div class="review-editor">
          <template v-if="reviewLines[reviewIndex]">
            <small class="muted">当前句 · {{ formatSyncTime(reviewLines[reviewIndex].start) }}</small>
            <input v-model="reviewLines[reviewIndex].text" class="inp" />
            <div class="review-ops">
              <button class="btn secondary sm" @click="adjustReviewLine(-0.2)">← 0.2s</button>
              <button class="btn secondary sm" @click="adjustReviewLine(0.2)">0.2s →</button>
              <button class="btn primary sm" @click="setReviewToCurrentTime">对齐到播放位置</button>
              <button class="btn secondary sm" @click="tapReviewLine">标记并下一句</button>
            </div>
            <div class="review-seek">
              <button class="btn ghost sm" @click="player.toggle">{{ isPlaying ? "⏸" : "▶" }}</button>
              <input class="range" type="range" min="0" :max="total" step="0.1" :value="player.currentTime" @input="player.seekTo(Number(($event.target as HTMLInputElement).value))" />
            </div>
            <div class="review-ops">
              <span class="muted">整体偏移</span>
              <input v-model.number="shiftAmount" class="inp num shift-input" type="number" step="0.1" min="-30" max="30" />
              <span class="muted">秒</span>
              <button class="btn secondary sm" @click="shiftAll(-Math.abs(shiftAmount || 0.5))">整体提前</button>
              <button class="btn secondary sm" @click="shiftAll(Math.abs(shiftAmount || 0.5))">整体延后</button>
            </div>
          </template>
          <div class="review-save">
            <button class="btn primary block" @click="saveReview">保存校验结果</button>
          </div>
        </div>
      </div>
    </div>
  </n-modal>
</template>

<style scoped>
.wb-header { display: flex; align-items: center; gap: 14px; }
.wb-cover {
  width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center;
  background: var(--accent); color: var(--on-accent); font-weight: 700;
}
.wb-header b { display: block; font-size: 14px; }
.wb-header small { font-size: 11px; display: block; }
.steps { display: flex; gap: 6px; margin-left: 10px; }
.step {
  padding: 5px 12px; border-radius: 999px; border: 1px solid var(--line-strong);
  background: transparent; color: var(--ink-3); font-size: 12px; cursor: pointer;
}
.step.on { background: var(--accent-soft); color: var(--ink); border-color: var(--accent-soft-2); font-weight: 600; }
.step:disabled { opacity: 0.5; cursor: not-allowed; }
.search-stage { border: 1px solid var(--line); border-radius: 14px; padding: 16px; margin-bottom: 16px; }
.ss-head { display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; }
.ss-head h4 { margin: 0 0 3px; font-size: 15px; }
.ss-head p { margin: 0; font-size: 12px; }
.ss-head > div:first-child { display: flex; gap: 12px; }
.ss-actions { display: flex; gap: 8px; flex: none; }
.stage-no {
  width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center;
  background: var(--accent); color: var(--on-accent); font-weight: 700; font-size: 12px; flex: none;
}
.stage-no.ok { background: var(--accent-soft-2); color: var(--ink); }
.ss-message { margin: 12px 0 0; font-size: 12.5px; color: var(--ink-2); }
.ss-search { display: flex; align-items: center; gap: 9px; margin-top: 12px; }
.ss-search .inp { flex: 1; min-width: 0; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--line-strong); background: var(--bg); color: var(--ink); font-size: 13px; outline: none; }
.ss-search .inp:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.provider-legend { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 10px; font-size: 11.5px; }
.provider-chip {
  padding: 2px 10px; border-radius: 999px; border: 1px solid var(--line-strong);
  color: var(--ink-2); background: var(--bg);
}
.candidates { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; max-height: 180px; overflow: auto; }
.candidate {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left;
  padding: 8px 12px; border-radius: 10px; border: 1px solid var(--line);
  background: var(--bg); color: var(--ink); cursor: pointer;
}
.candidate:hover { border-color: var(--accent); background: var(--accent-soft); }
.candidate b { font-size: 12.5px; max-width: 100%; display: flex; align-items: center; gap: 8px; }
.cand-mode {
  font-style: normal; font-size: 10.5px; padding: 1px 7px; border-radius: 999px;
  border: 1px solid var(--line-strong); color: var(--ink-3); flex: none;
}
.cand-mode.synced { color: var(--accent); border-color: var(--accent-soft-2); background: var(--accent-soft); }
.candidate small { color: var(--ink-3); font-size: 11px; }
.shift-input { width: 72px; }
.wb-main { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 18px; }
.wb-content { min-width: 0; }
.sec-title { display: flex; gap: 12px; margin-bottom: 12px; }
.sec-title h4 { margin: 0 0 2px; font-size: 15px; }
.sec-title p { margin: 0; font-size: 12px; }
.lyrics-input {
  width: 100%; resize: vertical; border-radius: 12px; border: 1px solid var(--line-strong);
  background: var(--bg); color: var(--ink); padding: 12px 14px; font: inherit; outline: none;
}
.lyrics-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.line-count { margin: 8px 0 0; font-size: 11.5px; }
.line-count.err { color: var(--danger); }
.wb-tools { display: flex; flex-direction: column; gap: 9px; border-left: 1px solid var(--line); padding-left: 16px; }
.block { width: 100%; }
.methods { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.method-card { border: 1px solid var(--line); border-radius: 14px; padding: 20px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.method-card h4 { margin: 0; font-size: 15px; }
.method-card p { margin: 0; font-size: 12.5px; }
.method-card.recommended { border-color: var(--accent-soft-2); background: var(--accent-soft); }
.ai-msg { font-size: 12px; color: var(--ink-2); }
.ai-msg.err { color: var(--danger); }
.ai-view { display: grid; place-items: center; gap: 10px; padding: 50px 0; text-align: center; }
.ai-view h4 { margin: 0; }
.spinner {
  width: 36px; height: 36px; border-radius: 50%;
  border: 3px solid var(--line-strong); border-top-color: var(--accent);
  animation: spin 0.9s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.sync-grid { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 20px; align-items: stretch; }
.sync-left { border: 1px solid var(--line); border-radius: 14px; padding: 22px; display: flex; flex-direction: column; gap: 10px; justify-content: center; }
.sync-current { font-size: 22px; font-weight: 700; min-height: 34px; }
.sync-current.singing { color: var(--accent); }
.sync-upcoming p { margin: 0; color: var(--ink-3); font-size: 14px; }
.sync-right { display: flex; flex-direction: column; gap: 10px; }
.tap-btn {
  padding: 14px; border-radius: 12px; border: 1px solid var(--accent-soft-2);
  background: var(--accent-soft); color: var(--ink); font-size: 13.5px; font-weight: 600; cursor: pointer;
}
.tap-btn:hover:not(:disabled) { background: var(--accent-soft-2); }
.tap-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.sync-ops { display: flex; gap: 8px; }
.range { width: 100%; accent-color: var(--accent); }
.sync-times { text-align: center; font-size: 12px; }
.review-grid { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 18px; }
.review-lines { max-height: 420px; overflow: auto; display: flex; flex-direction: column; gap: 4px; padding-right: 4px; }
.review-line {
  display: grid; grid-template-columns: 62px minmax(0, 1fr) auto; align-items: center; gap: 10px;
  padding: 7px 10px; border-radius: 9px; border: 0; background: transparent; color: var(--ink-2);
  cursor: pointer; text-align: left; font-size: 13px;
}
.review-line:hover { background: var(--row-hover); }
.review-line.on { background: var(--accent-soft); color: var(--ink); }
.review-line time { color: var(--ink-3); font-size: 11px; }
.review-line em { color: var(--ink-3); font-size: 11px; font-style: normal; }
.review-line.low em { color: var(--warning); }
.review-editor { display: flex; flex-direction: column; gap: 10px; border-left: 1px solid var(--line); padding-left: 16px; }
.review-ops { display: flex; flex-wrap: wrap; gap: 7px; }
.review-seek { display: flex; align-items: center; gap: 8px; }
.review-save { margin-top: auto; }
</style>
