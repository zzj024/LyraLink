<script setup lang="ts">
import { computed } from "vue";
import { useViewStore } from "../stores/view.js";
import { displayArtist, formatDuration, platformLabel } from "../format.js";

const view = useViewStore();
const track = computed(() => view.selectedTrack);
</script>

<template>
  <transition name="fade">
    <aside v-if="view.songInfoOpen && track" class="song-info" role="dialog" aria-label="歌曲信息">
      <div class="si-head"><h4>歌曲信息</h4><button class="btn ghost sm" @click="view.songInfoOpen = false">×</button></div>
      <dl>
        <div><dt>歌名</dt><dd class="ellip">{{ track.title }}</dd></div>
        <div><dt>歌手</dt><dd class="ellip">{{ displayArtist(track.author) }}</dd></div>
        <div><dt>来源</dt><dd>{{ platformLabel(track.platform) }}</dd></div>
        <div><dt>时长</dt><dd class="num">{{ formatDuration(track.duration) }}</dd></div>
      </dl>
    </aside>
  </transition>
</template>

<style scoped>
.song-info {
  position: fixed; right: 30px; top: 120px; z-index: 90; width: 300px;
  background: var(--elevated); border: 1px solid var(--line-strong); border-radius: var(--r-md);
  box-shadow: var(--shadow-lg); padding: 16px;
}
.si-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.si-head h4 { margin: 0; font-size: 15px; }
dl { margin: 0; }
dl div { display: flex; gap: 12px; padding: 7px 0; border-bottom: 1px dashed var(--line); }
dt { color: var(--ink-3); font-size: 12px; width: 40px; flex: none; }
dd { margin: 0; font-size: 12.5px; min-width: 0; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
