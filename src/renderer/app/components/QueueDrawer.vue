<script setup lang="ts">
import { computed, ref } from "vue";
import { useLibraryStore } from "../stores/library.js";
import { usePlayerStore } from "../stores/player.js";
import { useViewStore } from "../stores/view.js";
import { formatDuration } from "../format.js";

const player = usePlayerStore();
const view = useViewStore();
const library = useLibraryStore();

const rows = computed(() => player.queueRows);
const historyRows = computed(() =>
  player.playHistory
    .map((id) => library.tracks.find((track) => track.id === id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t))
);
const playlists = computed(() => library.playlists);
const tab = ref<"queue" | "history" | "playlist">("queue");
const dragId = ref("");

function onDragStart(row: { track: { id: string } }, event: DragEvent) {
  dragId.value = row.track.id;
  event.dataTransfer?.setData("text/linkaudio-queue-track-id", row.track.id);
}
function onDrop(targetId: string, event: DragEvent) {
  event.preventDefault();
  const movingId = dragId.value || event.dataTransfer?.getData("text/linkaudio-queue-track-id") || "";
  dragId.value = "";
  if (!movingId || movingId === targetId) return;
  player.reorderQueue(rows.value.map((r) => r.track.id), movingId, targetId);
}
function playRow(track: (typeof rows.value)[number]["track"]) {
  player.play(track);
}
function playPlaylistOrder(trackIds: string[]) {
  player.playPlaylist(trackIds);
  view.queuePanelOpen = false;
}

// 定位到当前播放歌曲：滚动到可见并短暂高亮
const queueListEl = ref<HTMLElement | null>(null);
const locating = ref(false);
const hasCurrent = computed(() => rows.value.some((row) => row.isCurrent));
function locateCurrent() {
  const row = queueListEl.value?.querySelector<HTMLElement>('[data-current="true"]');
  if (!row) return;
  row.scrollIntoView({ block: "center", behavior: "smooth" });
  locating.value = true;
  window.setTimeout(() => (locating.value = false), 1400);
}
</script>

<template>
  <aside v-if="view.queuePanelOpen" class="queue" aria-label="播放队列">
    <header>
      <b>播放队列</b><small class="num">{{ rows.length }} 首</small>
      <div class="ops">
        <span
          :title="rows.every((r) => r.isCurrent) ? '当前没有待播歌曲' : '清除当前歌曲之后的待播歌曲'"
          @click="player.clearUpcoming"
        >清除待播</span>
        <span aria-label="关闭" @click="view.queuePanelOpen = false">✕</span>
      </div>
    </header>
    <div class="tabs">
      <button class="tab" :class="{ on: tab === 'queue' }" @click="tab = 'queue'">播放队列</button>
      <button class="tab" :class="{ on: tab === 'history' }" @click="tab = 'history'">历史播放</button>
      <button class="tab" :class="{ on: tab === 'playlist' }" @click="tab = 'playlist'">歌单</button>
    </div>

    <div v-if="tab === 'queue'" ref="queueListEl" class="queue-list">
      <div
        v-for="row in rows"
        :key="row.track.id"
        class="qrow"
        :class="{ now: row.isCurrent, played: row.isPlayed, flash: locating && row.isCurrent }"
        :data-current="row.isCurrent"
        :draggable="!row.isCurrent"
        @dragstart="onDragStart(row, $event)"
        @dragover.prevent
        @drop="onDrop(row.track.id, $event)"
      >
        <span class="grip">{{ row.isCurrent ? "≋" : "⋮⋮" }}</span>
        <button class="qcopy" :title="row.track.title" @click="playRow(row.track)">
          <b class="ellip">{{ row.track.title }}</b>
          <small class="ellip">{{ row.track.author }}</small>
        </button>
        <time class="num">{{ formatDuration(row.track.duration) }}</time>
        <button class="rm" :disabled="row.isCurrent" :aria-label="`从队列移除 ${row.track.title}`" @click="player.removeFromQueue(row.track.id)">✕</button>
      </div>
      <div v-if="!rows.length" class="queue-empty">播放队列是空的</div>
      <button
        v-if="hasCurrent"
        class="locate-btn"
        aria-label="定位到当前播放歌曲"
        title="定位到当前播放歌曲"
        @click="locateCurrent"
      >◎</button>
    </div>

    <div v-else-if="tab === 'history'" class="queue-list">
      <div v-for="(track, index) in historyRows" :key="track.id" class="qrow">
        <span class="grip num">{{ index + 1 }}</span>
        <button class="qcopy" :title="track.title" @click="player.play(track)">
          <b class="ellip">{{ track.title }}</b>
          <small class="ellip">{{ track.author }}</small>
        </button>
        <time class="num">{{ formatDuration(track.duration) }}</time>
        <span></span>
      </div>
      <div v-if="!historyRows.length" class="queue-empty">还没有播放记录</div>
    </div>

    <div v-else class="queue-list">
      <button
        v-for="playlist in playlists"
        :key="playlist.id"
        class="pl-row"
        @click="playPlaylistOrder(playlist.trackIds)"
      >
        <span class="pl-ico">♫</span>
        <div class="pl-copy">
          <b class="ellip">{{ playlist.name }}</b>
          <small class="num">{{ playlist.trackIds.length }} 首 · 按歌单顺序播放</small>
        </div>
        <span class="pl-go">▶</span>
      </button>
      <div v-if="!playlists.length" class="queue-empty">还没有歌单，可在音乐库中创建</div>
    </div>
  </aside>
</template>

<style scoped>
.queue {
  position: absolute; right: 0; top: 0; bottom: 0; width: min(320px, 92vw); z-index: 30;
  display: flex; flex-direction: column;
  background: var(--panel);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-left: 1px solid var(--line);
  box-shadow: -18px 0 40px rgba(0, 0, 0, 0.35);
}
.queue header {
  display: flex; align-items: center; gap: 8px; padding: 15px 16px 11px;
  border-bottom: 1px solid var(--line);
}
.queue header b { font-size: 14px; }
.queue header small { color: var(--ink-3); }
.queue header .ops { margin-left: auto; display: flex; gap: 4px; color: var(--ink-3); font-size: 12px; }
.queue header .ops span { cursor: pointer; padding: 3px 7px; border-radius: 7px; }
.queue header .ops span:hover { background: var(--row-hover); color: var(--ink); }
.tabs { display: flex; gap: 4px; padding: 8px 10px 4px; }
.tab {
  flex: 1; padding: 6px 0; border-radius: 9px; border: 1px solid transparent;
  background: transparent; color: var(--ink-3); font-size: 12px; cursor: pointer;
}
.tab:hover { color: var(--ink); background: var(--row-hover); }
.tab.on { background: var(--accent-soft); color: var(--accent); border-color: var(--accent-soft-2); font-weight: 600; }
.queue-list { flex: 1; overflow-y: auto; padding: 6px; }
.qrow {
  display: grid; grid-template-columns: 16px minmax(0, 1fr) auto 22px; align-items: center; gap: 8px;
  padding: 8px 10px; min-height: 46px; border-radius: 10px; margin: 1px 4px; font-size: 12.5px;
  border: 1px solid transparent;
}
.qrow:hover { background: var(--row-hover); }
.qrow .grip { color: var(--ink-3); text-align: center; font-size: 11px; }
.qrow:not(.now) .grip { opacity: 0; transition: opacity 0.15s; }
.qrow:hover .grip { opacity: 1; }
.qcopy { min-width: 0; border: 0; background: transparent; text-align: left; color: var(--ink); cursor: pointer; padding: 0; }
.qcopy b { display: block; font-weight: 600; font-size: 12.5px; }
.qcopy small { display: block; color: var(--ink-3); font-size: 11px; margin-top: 2px; }
.qrow time { color: var(--ink-3); font-size: 11px; }
.qrow .rm { border: 0; background: transparent; color: var(--ink-3); opacity: 0; cursor: pointer; }
.qrow:hover .rm, .qrow .rm:disabled { opacity: 0.5; }
.qrow .rm:hover:not(:disabled) { color: var(--danger); opacity: 1; }
.qrow.played { opacity: 0.5; }
.qrow.now { background: var(--accent-soft); border-color: var(--accent-soft-2); }
.qrow.now b { color: var(--accent); }
.qrow.now .grip { color: var(--accent); opacity: 1; }
.qrow.now.flash { box-shadow: 0 0 0 2px var(--accent); }
.queue-empty { text-align: center; color: var(--ink-3); padding: 30px 0; font-size: 12.5px; }
/* 定位浮标：列表很长时一键回到当前播放歌曲 */
.locate-btn {
  position: sticky; bottom: 12px; margin: 6px 10px 4px auto; display: grid; place-items: center;
  width: 38px; height: 38px; border-radius: 50%; border: 1px solid var(--line-strong);
  background: var(--panel-solid); color: var(--accent); font-size: 15px; cursor: pointer;
  box-shadow: var(--shadow-lg); transition: all 0.15s; z-index: 5;
}
.locate-btn:hover { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.pl-row {
  display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; align-items: center; gap: 10px;
  width: 100%; padding: 9px 10px; border-radius: 10px; border: 1px solid transparent; margin: 1px 4px;
  background: transparent; color: var(--ink); cursor: pointer; text-align: left;
}
.pl-row:hover { background: var(--accent-soft); border-color: var(--accent-soft-2); }
.pl-ico {
  width: 34px; height: 34px; border-radius: 9px; background: var(--elevated);
  display: grid; place-items: center; color: var(--accent); font-size: 14px;
}
.pl-copy { min-width: 0; }
.pl-copy b { display: block; font-size: 12.5px; font-weight: 600; }
.pl-copy small { color: var(--ink-3); font-size: 11px; }
.pl-go { color: var(--ink-3); font-size: 12px; }
</style>

