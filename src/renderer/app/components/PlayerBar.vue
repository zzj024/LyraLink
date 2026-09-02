<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { usePlayerStore } from "../stores/player.js";
import { useViewStore } from "../stores/view.js";
import { formatPlayerTime } from "../format.js";
import { toast } from "../ui.js";

const player = usePlayerStore();
const view = useViewStore();
// 主进程是桌面歌词可见性的唯一事实来源：无论从词按钮、托盘还是歌词窗关闭，
// 都通过 desktop-lyrics:visibility 广播同步，避免按钮状态与窗口实际状态脱节
const desktopLyricsVisible = ref(false);

const seeking = ref(false);
const bubbleVisible = ref(false);
const bubbleLeft = ref(0);
const bubbleText = ref("00:00");

const title = computed(() =>
  player.previewMode ? player.previewTitle : player.playingTrack ? player.displayTrackTitle : "暂未播放歌曲"
);
const author = computed(() => {
  if (player.hasError) return "播放失败，请检查文件是否存在或格式是否受支持";
  return player.previewMode ? player.previewAuthor : player.playingTrack ? player.displayTrackAuthor : "从音乐库选择一首歌曲";
});
const cover = computed(() => (player.previewMode ? player.previewCover : player.playingTrack?.thumbnail) || null);

const seekMax = computed(() => (player.duration > 0 ? player.duration : 1));
const seekFill = computed(() => ({ "--range-fill": `${player.progress}%` } as Record<string, string>));
const volumeFill = computed(() => ({ "--range-fill": `${volumeModel.value * 100}%` } as Record<string, string>));
const volumeModel = ref(Number(localStorage.getItem("linkAudioVolume") ?? 1));
player.audio.volume = volumeModel.value;

function onSeekInput(event: Event) {
  player.seekTo(Number((event.target as HTMLInputElement).value));
}
function onVolumeInput(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  volumeModel.value = value;
  player.setVolume(value);
  localStorage.setItem("linkAudioVolume", String(value));
}
function onSeekMove(event: MouseEvent) {
  if (!player.controlsEnabled) return;
  const target = event.currentTarget as HTMLElement;
  const input = target.querySelector("input")!;
  const rect = input.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  bubbleText.value = formatPlayerTime(ratio * seekMax.value);
  bubbleLeft.value = ratio * rect.width;
  bubbleVisible.value = true;
}
function openNowPlaying() {
  if (player.playingTrack) view.openDetail(player.playingTrack);
  else if (player.previewMode) toast("在线试听不进曲库，下载后再查看歌曲详情。");
}
function openDesktopLyrics() {
  if (desktopLyricsVisible.value) {
    window.linkAudio.hideDesktopLyrics();
    return;
  }
  if (!player.playingTrack) {
    toast("先播放一首歌曲，桌面歌词才有内容可显示。");
    return;
  }
  player.updateDesktopLyrics();
  void window.linkAudio.openDesktopLyrics();
}
function toggleQueue() {
  view.queuePanelOpen = !view.queuePanelOpen;
}
let unsubscribeVisibility: (() => void) | null = null;
onMounted(() => {
  unsubscribeVisibility = window.linkAudio.onDesktopLyricsVisibility((visible) => {
    desktopLyricsVisible.value = visible;
  });
});
onBeforeUnmount(() => {
  unsubscribeVisibility?.();
});
</script>

<template>
  <footer class="playerbar" :class="{ 'has-error': player.hasError }">
    <div class="np" :aria-disabled="!player.controlsEnabled">
      <button
        class="np-open"
        :aria-label="`查看${title}的黑胶视图`"
        :title="player.playingTrack ? '打开黑胶视图' : '播放歌曲后可打开黑胶视图'"
        @click="openNowPlaying"
      >
        <img v-if="cover" class="cover" :src="cover" alt="" />
        <span v-else class="cover cover-empty">♪</span>
        <div class="np-text" style="min-width: 0">
          <b class="ellip" :title="title">{{ title }}</b>
          <small class="ellip" :class="{ 'err-text': player.hasError }">{{ author }}</small>
        </div>
      </button>
    </div>

    <div class="pc">
      <div class="btns">
        <button class="skip" :disabled="!player.controlsEnabled" aria-label="上一首" @click="player.playRelative(-1)">⏮</button>
        <button
          class="play"
          :disabled="!player.controlsEnabled"
          :aria-label="player.isPlaying ? '暂停' : '播放'"
          @click="player.toggle"
        >
          {{ player.isPlaying ? "⏸" : "▶" }}
        </button>
        <button class="skip" :disabled="!player.controlsEnabled" aria-label="下一首" @click="player.playRelative(1)">⏭</button>
        <button
          class="mode-btn"
          :title="`播放模式：${player.playModeInfo.label}（点击切换）`"
          :aria-label="`播放模式：${player.playModeInfo.label}，点击切换`"
          @click="player.cyclePlayMode()"
        >{{ player.playModeInfo.icon }}</button>
      </div>
      <div class="seekrow">
        <time class="num">{{ formatPlayerTime(player.currentTime) }}</time>
        <div
          class="seek"
          @mousemove="onSeekMove"
          @mouseleave="bubbleVisible = false"
        >
          <input
            class="seek-input"
            type="range"
            min="0"
            :max="seekMax"
            step="0.1"
            :value="player.currentTime"
            :disabled="!player.controlsEnabled"
            aria-label="播放进度"
            :style="seekFill"
            @input="onSeekInput"
          />
          <span class="bubble num" :class="{ hidden: !bubbleVisible }" :style="{ left: bubbleLeft + 'px' }">{{ bubbleText }}</span>
        </div>
        <time class="num">{{ formatPlayerTime(player.duration) }}</time>
      </div>
    </div>

    <div class="pt">
      <span class="lbl">音量</span>
      <input
        class="vol-input"
        type="range"
        min="0"
        max="1"
        step="0.02"
        :value="volumeModel"
        aria-label="音量"
        :style="volumeFill"
        @input="onVolumeInput"
      />
      <button
        class="chipbtn"
        :class="{ on: desktopLyricsVisible }"
        :disabled="!player.controlsEnabled"
        :aria-label="desktopLyricsVisible ? '关闭桌面歌词' : '打开桌面歌词'"
        :title="desktopLyricsVisible ? '关闭桌面歌词' : '打开桌面歌词'"
        @click="openDesktopLyrics"
      >
        词
      </button>
      <button
        class="chipbtn"
        :class="{ on: view.queuePanelOpen }"
        aria-label="打开播放队列"
        title="播放队列"
        @click="toggleQueue"
      >
        ☷
      </button>
    </div>
  </footer>
</template>

<style scoped>
.playerbar {
  display: grid; grid-template-columns: 230px minmax(0, 1fr) 220px; align-items: center; gap: 18px;
  height: 78px; padding: 0 20px;
  background: var(--panel);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-top: 1px solid var(--line);
}
.playerbar.has-error .np small { color: var(--danger); }
.np { display: flex; align-items: center; gap: 12px; min-width: 0; }
.np-open {
  display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1;
  border: 0; background: transparent; color: inherit; font: inherit; text-align: left;
  padding: 0; cursor: pointer; border-radius: 10px;
}
.np-open:hover b { color: var(--accent); }
.np .cover {
  width: 46px; height: 46px; border-radius: 50%; flex: none; object-fit: cover;
  box-shadow: 0 0 0 1px var(--line-strong), 0 6px 16px rgba(0, 0, 0, 0.45);
  animation: none;
}
.np.is-playing-animation .cover { animation: spin 20s linear infinite; }
.cover-empty {
  display: grid; place-items: center; background: var(--elevated); color: var(--ink-3);
}
@keyframes spin { to { transform: rotate(360deg); } }
.np b { display: block; font-size: 13px; }
.np small { color: var(--ink-3); font-size: 11.5px; display: block; }
.err-text { color: var(--danger) !important; }
.pc { display: flex; flex-direction: column; align-items: center; gap: 5px; min-width: 0; }
.btns { display: flex; align-items: center; gap: 14px; }
.skip { border: 0; background: transparent; color: var(--ink-2); font-size: 15px; cursor: pointer; padding: 4px; }
.skip:hover:not(:disabled) { color: var(--ink); }
.skip:disabled { opacity: 0.35; cursor: not-allowed; }
.play {
  width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center;
  background: var(--accent); color: var(--on-accent); font-size: 15px; cursor: pointer; border: 0;
  box-shadow: 0 6px 20px var(--accent-soft-2); transition: transform 0.12s;
}
.play:hover:not(:disabled) { transform: scale(1.06); }
.play:disabled { opacity: 0.4; cursor: not-allowed; }
.mode-btn {
  width: 32px; height: 28px; border: 1px solid var(--line-strong); border-radius: 999px;
  background: var(--bg); color: var(--ink-2); font-size: 13px; cursor: pointer;
  display: grid; place-items: center; transition: background 0.12s, color 0.12s;
}
.mode-btn:hover { color: var(--accent); background: var(--accent-soft); }
.seekrow { display: flex; align-items: center; gap: 10px; width: 100%; max-width: 660px; }
.seekrow time { color: var(--ink-3); font-size: 11px; }
.seek { position: relative; flex: 1; height: 16px; display: flex; align-items: center; }
.seek-input {
  -webkit-appearance: none; appearance: none; width: 100%; height: 100%;
  background: transparent; cursor: pointer; margin: 0;
}
.seek-input::-webkit-slider-runnable-track {
  height: 4px; border-radius: 2px;
  background: linear-gradient(to right, var(--accent) var(--range-fill, 0%), var(--line-strong) var(--range-fill, 0%));
}
.seek-input::-webkit-slider-thumb {
  -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; margin-top: -4px;
  background: #fff; box-shadow: 0 1px 5px rgba(0, 0, 0, 0.5); opacity: 0; transition: opacity 0.15s;
}
.seek:hover .seek-input::-webkit-slider-thumb,
.seek-input:focus-visible::-webkit-slider-thumb,
.seek-input:active::-webkit-slider-thumb { opacity: 1; }
.bubble {
  position: absolute; bottom: 18px; transform: translateX(-50%); pointer-events: none;
  padding: 2px 8px; border-radius: 7px; font-size: 11px; white-space: nowrap;
  background: var(--elevated); border: 1px solid var(--line-strong); color: var(--ink);
  box-shadow: var(--shadow-sm);
}
.bubble.hidden { display: none; }
.pt { display: flex; align-items: center; justify-content: flex-end; gap: 10px; color: var(--ink-2); }
.pt .lbl { font-size: 11px; color: var(--ink-3); }
.vol-input {
  -webkit-appearance: none; appearance: none; width: 86px; height: 14px; background: transparent; cursor: pointer;
}
.vol-input::-webkit-slider-runnable-track {
  height: 4px; border-radius: 2px;
  background: linear-gradient(to right, var(--accent) var(--range-fill, 0%), var(--line-strong) var(--range-fill, 0%));
}
.vol-input::-webkit-slider-thumb {
  -webkit-appearance: none; width: 10px; height: 10px; border-radius: 50%; margin-top: -3px;
  background: #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}
.chipbtn {
  width: 30px; height: 30px; display: grid; place-items: center; border-radius: 9px; cursor: pointer;
  color: var(--ink-2); border: 1px solid transparent; background: transparent; font-size: 12px;
}
.chipbtn:hover:not(:disabled) { background: var(--row-hover); color: var(--ink); }
.chipbtn.on { color: var(--accent); border-color: var(--line-strong); background: var(--accent-soft); }
.chipbtn:disabled { opacity: 0.35; cursor: not-allowed; }
</style>
