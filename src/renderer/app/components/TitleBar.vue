<script setup lang="ts">
import { ref } from "vue";
import { usePlayerStore } from "../stores/player.js";

const player = usePlayerStore();
const isMax = ref(false);
void isMax;

function minimize() {
  void window.linkAudio.minimizeWindow();
}
function toggleMaximize() {
  void window.linkAudio.toggleMaximizeWindow();
}
function close() {
  window.linkAudio.closeWindow();
}
function onTitlebarDblclick(event: MouseEvent) {
  if (!(event.target instanceof Element && event.target.closest("button"))) {
    void window.linkAudio.toggleMaximizeWindow();
  }
}
</script>

<template>
  <header class="app-titlebar" @dblclick="onTitlebarDblclick">
    <div class="titlebar-brand">
      <span class="mark">L</span>
      <strong>LyraLink</strong>
    </div>
    <div class="titlebar-actions">
      <button class="win-btn" aria-label="最小化" title="最小化" @click="minimize">
        <svg viewBox="0 0 12 12"><path d="M2 8.5h8" /></svg>
      </button>
      <button class="win-btn" :aria-label="player.maximized ? '还原' : '最大化'" :title="player.maximized ? '还原' : '最大化'" @click="toggleMaximize">
        <svg v-if="!player.maximized" viewBox="0 0 12 12"><rect x="2.5" y="2.5" width="7" height="7" /></svg>
        <svg v-else viewBox="0 0 12 12"><path d="M4.5 3V1.8h5.7v5.7H9M1.8 4.5h5.7v5.7H1.8z" /></svg>
      </button>
      <button class="win-btn close" aria-label="关闭" title="关闭" @click="close">
        <svg viewBox="0 0 12 12"><path d="m2.5 2.5 7 7m0-7-7 7" /></svg>
      </button>
    </div>
  </header>
</template>

<style scoped>
.app-titlebar {
  display: flex; align-items: center; justify-content: space-between;
  height: 40px; padding-left: 14px;
  background: var(--panel);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-bottom: 1px solid var(--line);
  user-select: none;
}
.titlebar-brand { display: flex; align-items: center; gap: 9px; -webkit-app-region: drag; flex: 1; height: 100%; }
.titlebar-brand .mark {
  width: 20px; height: 20px; border-radius: 6px; display: grid; place-items: center;
  background: var(--accent); color: var(--on-accent); font-weight: 800; font-size: 12px;
}
.titlebar-brand strong { font-size: 13px; }
.titlebar-brand small { font-size: 11px; }
.titlebar-actions { display: flex; height: 100%; }
.win-btn {
  width: 46px; height: 100%; border: 0; background: transparent; color: var(--ink-2);
  display: grid; place-items: center; cursor: pointer;
}
.win-btn svg { width: 12px; height: 12px; stroke: currentColor; stroke-width: 1.2; fill: none; }
.win-btn:hover { background: var(--row-hover); color: var(--ink); }
.win-btn.close:hover { background: var(--danger); color: #fff; }
</style>
