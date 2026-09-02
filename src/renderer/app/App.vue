<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import { darkTheme, dateZhCN, zhCN } from "naive-ui";
import { computed } from "vue";
import TitleBar from "./components/TitleBar.vue";
import SideBar from "./components/SideBar.vue";
import PlayerBar from "./components/PlayerBar.vue";
import QueueDrawer from "./components/QueueDrawer.vue";
import LibraryView from "./views/LibraryView.vue";
import ImportView from "./views/ImportView.vue";
import SearchView from "./views/SearchView.vue";
import TasksView from "./views/TasksView.vue";
import SettingsView from "./views/SettingsView.vue";
import DetailView from "./views/DetailView.vue";
import FolderModal from "./components/FolderModal.vue";
import PlaylistModal from "./components/PlaylistModal.vue";
import PlaylistPickerModal from "./components/PlaylistPickerModal.vue";
import TrackEditorModal from "./components/TrackEditorModal.vue";
import SplitModal from "./components/SplitModal.vue";
import LyricsWorkbench from "./components/LyricsWorkbench.vue";
import ThemeEditorModal from "./components/ThemeEditorModal.vue";
import SongInfoPanel from "./components/SongInfoPanel.vue";
import { activeAccent, naiveOverridesFor, themeMode } from "./theme.js";
import { useLibraryStore } from "./stores/library.js";
import { usePlayerStore } from "./stores/player.js";
import { useSearchStore } from "./stores/search.js";
import { useSettingsStore } from "./stores/settings.js";
import { useTaskStore } from "./stores/tasks.js";
import { useViewStore } from "./stores/view.js";
import { toast } from "./ui.js";

const view = useViewStore();
const library = useLibraryStore();
const player = usePlayerStore();
const search = useSearchStore();
const settings = useSettingsStore();
const tasks = useTaskStore();

const naiveTheme = computed(() => (themeMode.value === "dark" ? darkTheme : null));
const naiveOverrides = computed(() => naiveOverridesFor(themeMode.value, activeAccent.value));

const SUPPORTED_AUDIO = /\.(mp3|m4a|aac|wav|flac|ogg|opus|webm)$/i;
function onDragOver(event: DragEvent) {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  document.body.dataset.dragging = "true";
}
function onDragLeave(event: DragEvent) {
  if (event.relatedTarget) return;
  document.body.dataset.dragging = "false";
}
async function onDrop(event: DragEvent) {
  document.body.dataset.dragging = "false";
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault();
  const paths = [...event.dataTransfer.files]
    .filter((file) => SUPPORTED_AUDIO.test(file.name))
    .map((file) => window.linkAudio.getPathForFile(file))
    .filter(Boolean);
  if (!paths.length) {
    toast("拖入的文件中没有受支持的音频格式。", "error");
    return;
  }
  try {
    const imported = await window.linkAudio.importLocalPaths(paths);
    if (imported.length) {
      await library.refreshTracks();
      toast(`已导入 ${imported.length} 个音频文件。`, "success");
    }
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  }
}

function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement;
  const inInput = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
  const anyModal = document.querySelector(".n-modal, .n-card.modal-root");
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    view.showView("library", view.activeCollection);
    window.dispatchEvent(new CustomEvent("linkaudio:focus-search"));
    return;
  }
  if (event.key === "Escape") {
    if (document.querySelector(".n-modal")) return; // Naive UI 自带 Esc 关闭
    if (view.songInfoOpen) {
      view.songInfoOpen = false;
      return;
    }
    if (view.showingLyrics) {
      view.showingLyrics = false;
      return;
    }
    if (view.queuePanelOpen) {
      view.queuePanelOpen = false;
      return;
    }
    return;
  }
  if (inInput || anyModal) return;
  if (event.code === "MediaPlayPause" || event.code === "Space") {
    if (!player.playingTrack) return;
    event.preventDefault();
    player.toggle();
  } else if (event.code === "MediaTrackNext" || ((event.ctrlKey || event.metaKey) && event.code === "ArrowRight")) {
    event.preventDefault();
    player.playRelative(1);
  } else if (event.code === "MediaTrackPrevious" || ((event.ctrlKey || event.metaKey) && event.code === "ArrowLeft")) {
    event.preventDefault();
    player.playRelative(-1);
  }
}

function onWindowKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement;
  const inInput = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
  if (inInput || document.querySelector(".n-modal")) return;
  // 空格播放/暂停只在 onKeydown 里处理一次；这里若再响应会双触发互相抵消
  if (event.code === "ArrowLeft" && player.audio.src) {
    event.preventDefault();
    player.nudge(-5);
  } else if (event.code === "ArrowRight" && player.audio.src) {
    event.preventDefault();
    player.nudge(5);
  }
}

let unsubscribe: Array<() => void> = [];

onMounted(async () => {
  document.title = "LyraLink";
  player.setupAudioListeners();
  await settings.load();
  // 启动设置应用：默认排序 / 默认播放模式 / 首次使用引导
  library.sort = settings.settings.defaultSort || "newest";
  if (!localStorage.getItem("linkAudioPlayMode") && settings.settings.defaultPlayMode) {
    player.playMode = settings.settings.defaultPlayMode;
  }
  if (!settings.settings.onboardingCompleted) {
    view.showView("settings");
    toast("首次使用：请阅读本地处理说明，设置回收站保留时间，并完成合法使用确认。", "warning");
  }
  await library.refreshAll();
  player.restoreLastSession();
  window.linkAudio.onProgress((progress) => tasks.applyProgress(progress));
  unsubscribe.push(
    window.linkAudio.onWindowMaximizedChange((value) => {
      player.maximized = value;
    })
  );
  unsubscribe.push(
    window.linkAudio.onDesktopLyricsAction((action) => {
      if (action === "previous") player.playRelative(-1);
      else if (action === "next") player.playRelative(1);
      else if (action === "toggle") player.toggle();
      else if (action === "cycle-mode") player.cyclePlayMode();
    })
  );
  document.addEventListener("keydown", onKeydown);
  window.addEventListener("keydown", onWindowKeydown);
  document.addEventListener("click", onGlobalClick);
  document.addEventListener("dragover", onDragOver);
  document.addEventListener("dragleave", onDragLeave);
  document.addEventListener("drop", onDrop);
});

function onGlobalClick(event: MouseEvent) {
  const target = event.target as HTMLElement;
  // 点击播放队列面板与其开关按钮以外的区域时自动收起
  if (!target.closest(".queue") && !target.closest("[aria-label='打开播放队列']")) {
    if (view.queuePanelOpen) view.queuePanelOpen = false;
  }
  if (!target.closest(".acts, .row-menu")) {
    // 行内菜单收起由 LibraryView 自己处理
  }
}

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
  window.removeEventListener("keydown", onWindowKeydown);
  document.removeEventListener("click", onGlobalClick);
  document.removeEventListener("dragover", onDragOver);
  document.removeEventListener("dragleave", onDragLeave);
  document.removeEventListener("drop", onDrop);
  for (const off of unsubscribe) off();
});
</script>

<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="naiveOverrides" :locale="zhCN" :date-locale="dateZhCN">
    <n-message-provider>
      <n-dialog-provider>
        <div class="app-shell" :data-view="view.current" :class="{ 'sidebar-collapsed': view.sidebarCollapsed }">
          <TitleBar />
          <div class="app-body">
            <SideBar />
            <main class="app-main">
              <LibraryView v-if="view.current === 'library'" />
              <ImportView v-else-if="view.current === 'import'" />
              <SearchView v-else-if="view.current === 'search'" />
              <TasksView v-else-if="view.current === 'tasks'" />
              <SettingsView v-else-if="view.current === 'settings'" />
              <DetailView v-else-if="view.current === 'detail'" />
            </main>
          </div>
          <PlayerBar />
          <QueueDrawer />
          <SongInfoPanel />
          <FolderModal />
          <PlaylistModal />
          <PlaylistPickerModal />
          <TrackEditorModal />
          <SplitModal />
          <LyricsWorkbench />
          <ThemeEditorModal />
        </div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style>
.app-shell {
  height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr auto;
  background: var(--bg);
  background-image: var(--bg-glow);
}
.app-shell > * { position: relative; z-index: 1; }
.app-body {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  min-height: 0;
  position: relative;
}
.app-main {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  position: relative;
}
body[data-dragging="true"] .app-shell { outline: 2px dashed var(--accent); outline-offset: -6px; }
</style>
