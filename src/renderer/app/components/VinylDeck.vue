<script setup lang="ts">
import { computed } from "vue";
import { usePlayerStore } from "../stores/player.js";
import { useViewStore } from "../stores/view.js";
import { displayArtist } from "../format.js";

const player = usePlayerStore();
const view = useViewStore();

const track = computed(() => view.selectedTrack);
const playingThis = computed(
  () => player.isPlaying && player.playingTrack?.id === track.value?.id
);
const backdrop = computed(() =>
  track.value?.thumbnail ? `url("${track.value.thumbnail}")` : "none"
);

function toggleDetailPlay() {
  if (!track.value) return;
  if (player.playingTrack?.id === track.value.id && !player.audio.paused) player.pause();
  else player.play(track.value);
}
function onDiscClick() {
  view.showingLyrics = true;
}
function onDiscDblclick() {
  view.showingLyrics = false;
  if (player.playingTrack?.id === track.value?.id) player.toggle();
  else if (track.value) player.play(track.value);
}
</script>

<template>
  <div v-if="track" class="vinyl-deck" :class="{ playing: playingThis }">
    <div class="deck-glow" :style="{ backgroundImage: backdrop }"></div>
    <button
      class="vinyl-record"
      :title="`${track.title}（单击查看歌词，双击播放 / 暂停）`"
      aria-label="显示歌词"
      @click="onDiscClick"
      @dblclick="onDiscDblclick"
    >
      <span class="sheen"></span>
      <span class="vinyl-cover">
        <img v-if="track.thumbnail" :src="track.thumbnail" alt="" />
      </span>
      <span class="hole"></span>
    </button>
    <svg class="tonearm" viewBox="0 0 200 264" aria-hidden="true">
      <defs>
        <linearGradient id="tonearm-metal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ffffff" />
          <stop offset="0.55" stop-color="#e7e9ec" />
          <stop offset="1" stop-color="#b7bcc4" />
        </linearGradient>
      </defs>
      <g class="tonearm-swing">
        <path d="M 30 38 L 92 152" fill="none" stroke="url(#tonearm-metal)" stroke-width="7" stroke-linecap="round" />
        <g transform="rotate(52 94 156)">
          <rect x="92" y="147" width="44" height="18" rx="4.5" fill="url(#tonearm-metal)" />
        </g>
      </g>
      <rect x="26" y="12" width="8" height="14" rx="3" fill="url(#tonearm-metal)" stroke="rgba(70,74,82,.35)" />
      <circle cx="30" cy="30" r="10" fill="url(#tonearm-metal)" stroke="rgba(70,74,82,.4)" />
      <circle cx="30" cy="30" r="3.2" fill="#83878f" />
    </svg>
    <div class="deck-caption">
      <b class="ellip">{{ track.title }}</b>
      <small class="ellip">{{ displayArtist(track.author) }}</small>
    </div>
  </div>
</template>

<style scoped>
.vinyl-deck { position: relative; width: min(330px, 44vw); }
.deck-glow {
  position: absolute; inset: -12%; z-index: 0; border-radius: 50%;
  background-size: cover; background-position: center;
  filter: blur(90px) saturate(1.3); opacity: 0.28; pointer-events: none;
}
.vinyl-record {
  position: relative; display: block; width: 100%; aspect-ratio: 1;
  padding: 0; border: 0; border-radius: 50%; cursor: pointer; z-index: 1;
  background:
    repeating-radial-gradient(circle, transparent 0 4.5px, rgba(255, 255, 255, 0.05) 5.5px 6.5px),
    radial-gradient(circle, #2c2d2a 0 17%, #0b0c0b 17.5% 62%, #1d1e1c 62.5% 96%, #262724 96.5% 100%);
  box-shadow: 0 34px 70px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.06), 0 0 60px var(--accent-soft);
  animation: vinyl-spin 20s linear infinite;
  animation-play-state: paused;
}
.vinyl-deck.playing .vinyl-record { animation-play-state: running; }
@keyframes vinyl-spin { to { transform: rotate(360deg); } }
.sheen {
  position: absolute; inset: 1.5%; border-radius: 50%; pointer-events: none;
  background: conic-gradient(from 10deg, transparent 0 38%, rgba(255, 255, 255, 0.1) 45%, rgba(255, 255, 255, 0.02) 50%, transparent 57% 78%, rgba(255, 255, 255, 0.06) 84%, transparent 90% 100%);
}
.vinyl-cover {
  position: absolute; inset: 19%; overflow: hidden; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, var(--accent), rgba(44, 45, 42, 0.9));
  box-shadow: 0 0 0 7px rgba(8, 9, 8, 0.75), 0 0 0 8px rgba(255, 255, 255, 0.08);
}
.vinyl-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.hole {
  position: absolute; left: 47.2%; top: 47.2%; width: 5.6%; height: 5.6%; border-radius: 50%;
  background: #0d0e0c; box-shadow: 0 0 0 2.5px rgba(240, 240, 235, 0.8);
}
.tonearm {
  position: absolute; z-index: 4; top: -82px; right: -5px;
  width: 200px; height: 264px; pointer-events: none; overflow: visible;
  filter: drop-shadow(0 12px 14px rgba(0, 0, 0, 0.5));
}
.tonearm-swing {
  transform-box: view-box; transform-origin: 30px 30px;
  transform: rotate(-30deg);
  transition: transform 0.8s cubic-bezier(0.4, 0, 0.2, 1);
}
.vinyl-deck.playing .tonearm-swing { transform: rotate(0deg); }
.deck-caption { text-align: center; margin-top: 20px; position: relative; z-index: 1; }
.deck-caption b { display: block; font-size: 14px; }
.deck-caption small { color: var(--ink-3); font-size: 12px; }
</style>
