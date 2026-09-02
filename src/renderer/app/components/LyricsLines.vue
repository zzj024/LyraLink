<script setup lang="ts">
import { computed } from "vue";
import { usePlayerStore } from "../stores/player.js";
import { useViewStore } from "../stores/view.js";
import { displayArtist } from "../format.js";

const player = usePlayerStore();
const view = useViewStore();
const track = computed(() => view.selectedTrack);
const activeIndex = computed(() => player.activeLyricIndex);
const lines = computed(() => track.value?.lyrics?.lines || []);

function seekTo(index: number) {
  const line = lines.value[index];
  if (line && player.playingTrack?.id === track.value?.id) player.seekTo(Math.max(0, line.start - 0.4));
}
</script>

<template>
  <div class="lyrics-lines" :style="{ '--active': String(activeIndex) }">
    <div
      v-for="(line, index) in lines"
      :key="`${index}-${line.start}`"
      class="lyric-line"
      :class="{ on: index === activeIndex }"
      @click="seekTo(index)"
    >{{ line.text }}</div>
    <div v-if="!lines.length" class="lyrics-none">暂无歌词</div>
  </div>
</template>

<style scoped>
.lyrics-lines { display: flex; flex-direction: column; gap: 4px; overflow-y: auto; max-height: 100%; padding: 4px 2px; }
.lyric-line {
  color: var(--ink-3); font-size: 15px; line-height: 1.8; cursor: pointer;
  transition: color 0.2s, transform 0.2s, font-size 0.2s;
}
.lyric-line:hover { color: var(--ink-2); }
.lyric-line.on { color: var(--accent); font-size: 19px; font-weight: 700; }
.lyrics-none { color: var(--ink-3); font-size: 13px; }
</style>
