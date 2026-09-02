<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import type { Track } from "../../../shared/types.js";
import { useLibraryStore } from "../stores/library.js";
import { usePlayerStore } from "../stores/player.js";
import { useSettingsStore } from "../stores/settings.js";
import { useSearchStore } from "../stores/search.js";
import { useViewStore } from "../stores/view.js";
import { useModalsStore } from "../stores/modals.js";
import { displayArtist, displayTitle, formatDuration, platformColor, platformLabel } from "../format.js";
import { confirmDialog, toast } from "../ui.js";

const library = useLibraryStore();
const player = usePlayerStore();
const view = useViewStore();
const modals = useModalsStore();
const settings = useSettingsStore();
const search = useSearchStore();

const searchInput = ref<HTMLInputElement | null>(null);
const searchValue = ref("");
const showGlobalResults = ref(false);

const visible = computed(() => library.collectionTracks);
const isTrash = computed(() => library.isTrash);
const playlist = computed(() => library.activePlaylist);
const count = computed(() => `${visible.value.length} 首`);
const heading = computed(() => {
  if (view.activeCollection === "favorites") return "我喜欢的音乐";
  if (view.activeCollection === "trash") return "回收站";
  return playlist.value?.name || "音乐库";
});

const emptyIcon = ref("♫");
const emptyTitle = ref("");
const emptyCopy = ref("");
/** 本地搜索无结果时记住关键词，供空态里的在线兜底按钮使用 */
const lastQuery = ref("");

function searchOnline(query: string, tab: "bilibili" | "netease") {
  void search.searchFromLibrary(query, tab);
  view.showView("import");
}
watch(
  [() => view.activeCollection, () => library.query],
  () => {
    const q = library.query.trim();
    lastQuery.value = q;
    if (q) {
      emptyIcon.value = "⌕";
      emptyTitle.value = "没有找到匹配的歌曲";
      emptyCopy.value = `没有找到"${displayTitle(q, 28)}"，请试试其他关键词。`;
    } else if (isTrash.value) {
      emptyIcon.value = "♲";
      emptyTitle.value = "回收站为空";
      emptyCopy.value = "移入回收站的歌曲会暂时保留在这里。";
    } else if (view.activeCollection === "favorites") {
      emptyIcon.value = "♥";
      emptyTitle.value = "还没有喜欢的音乐";
      emptyCopy.value = "点击歌曲旁的爱心，把喜欢的歌曲收集到这里。";
    } else if (playlist.value) {
      emptyIcon.value = "♫";
      emptyTitle.value = "歌单中还没有歌曲";
      emptyCopy.value = "从歌曲的更多菜单中选择“收藏到歌单”。";
    } else if (library.activeFolder) {
      emptyIcon.value = "▰";
      emptyTitle.value = "文件夹中还没有歌曲";
      emptyCopy.value = "选择歌曲后，可通过批量工具栏加入这个文件夹。";
    } else {
      emptyIcon.value = "♫";
      emptyTitle.value = "音乐库还是空的";
      emptyCopy.value = "从左侧「导入音乐」导入本地文件，或在「下载」页从 B 站下载。";
    }
  },
  { immediate: true }
);

const showPlayAll = computed(() => !isTrash.value && (visible.value.length > 0 || view.activeCollection === "all"));
const showClearSearch = computed(() => !!library.query.trim());
const showGoLibrary = computed(
  () => !library.query.trim() && view.activeCollection !== "all" && !isTrash.value
);

watch(searchValue, (value) => {
  library.query = value;
});
function onSearchKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    if (showGlobalResults.value) {
      showGlobalResults.value = false;
      return;
    }
    clearSearch();
  } else if (event.key === "Enter") {
    const first = globalResults.value[0];
    if (first) {
      event.preventDefault();
      void playGlobalResult(first);
    }
  } else if (event.key === "ArrowDown") {
    showGlobalResults.value = true;
  }
}
function clearSearch() {
  searchValue.value = "";
  library.query = "";
  showGlobalResults.value = false;
}

// 全局搜索联想（本地曲库）
const globalResults = computed(() => {
  const q = library.query.trim().toLowerCase();
  if (!q) return [];
  return library.tracks
    .filter((t) => `${t.title} ${t.author}`.toLowerCase().includes(q))
    .slice(0, 8);
});
async function playGlobalResult(track: Track) {
  showGlobalResults.value = false;
  player.play(track, true);
}
function onSearchFocus() {
  showGlobalResults.value = globalResults.value.length > 0;
}

// 播放全部
function playAll() {
  const first = visible.value[0];
  if (first && !isTrash.value) player.play(first as Track, true);
}

// 行为
function playRow(track: Track) {
  player.play(track, true);
}
function openDetailRow(track: Track) {
  view.openDetail(track);
}
async function toggleFavorite(track: Track) {
  await library.updateTrack(track.id, {
    title: track.title,
    author: track.author,
    favorite: !track.favorite,
    folderIds: track.folderIds
  });
}
function queueNext(track: Track) {
  player.enqueueNext(track);
  toast(`"${track.title}"将在下一首播放。`, "success");
}
async function removeFromLibrary(track: Track) {
  const ok = await confirmDialog({
    title: "移入回收站",
    message: `将"${track.title}"移入回收站？`,
    confirmText: "移入回收站",
    danger: true
  });
  if (!ok) return;
  try {
    const result = await window.linkAudio.deleteTrack(track.id);
    library.tracks = result;
    if (player.playingTrack?.id === track.id) player.stop();
    toast(`已将"${track.title}"移入回收站。`, "success");
  } catch (error) {
    toast(`移入回收站失败：${error instanceof Error ? error.message : String(error)}`, "error");
  }
}
async function restoreRow(track: Track) {
  try {
    const result = await window.linkAudio.restoreTrack(track.id);
    library.tracks = result.tracks;
    library.deletedTracks = result.deleted;
  } catch (error) {
    toast(`恢复失败：${error instanceof Error ? error.message : String(error)}`, "error");
  }
}
async function permanentlyDeleteRow(track: Track) {
  const ok = await confirmDialog({
    title: "永久删除",
    message: `永久删除"${track.title}"？此操作无法恢复。`,
    confirmText: "永久删除",
    danger: true
  });
  if (!ok) return;
  try {
    library.deletedTracks = await window.linkAudio.permanentlyDeleteTrack(track.id);
  } catch (error) {
    toast(`永久删除失败：${error instanceof Error ? error.message : String(error)}`, "error");
  }
}
async function removeFromPlaylist(track: Track) {
  const current = playlist.value;
  if (!current) return;
  library.playlists = await window.linkAudio.updatePlaylist(
    current.id,
    current.trackIds.filter((id) => id !== track.id)
  );
}

// 批量
const bulkCount = computed(() => library.selectedIds.size);
const allVisibleSelected = computed(
  () => visible.value.length > 0 && visible.value.every((t) => library.selectedIds.has(t.id))
);
function toggleSelectAll(event: Event) {
  library.selectAllVisible(visible.value, (event.target as HTMLInputElement).checked);
}
const bulkPlaylists = computed(() => library.playlists);
const bulkPlaylistId = ref("");
async function bulkFavorite() {
  const selected = library.tracks.filter((t) => library.selectedIds.has(t.id));
  const next = !selected.length || !selected.every((t) => t.favorite);
  for (const track of selected) {
    await library.updateTrack(track.id, {
      title: track.title, author: track.author, favorite: next, folderIds: track.folderIds
    });
  }
}
async function bulkAddPlaylist() {
  const current = library.playlists.find((p) => p.id === bulkPlaylistId.value);
  if (!current || !library.selectedIds.size) return;
  library.playlists = await window.linkAudio.updatePlaylist(current.id, [
    ...current.trackIds,
    ...library.selectedIds
  ]);
  library.clearSelection();
}
async function bulkRestore() {
  if (!isTrash.value || !library.selectedIds.size) return;
  let restored = 0;
  let failed = 0;
  for (const id of [...library.selectedIds]) {
    try {
      const result = await window.linkAudio.restoreTrack(id);
      library.tracks = result.tracks;
      library.deletedTracks = result.deleted;
      restored++;
    } catch {
      failed++;
    }
  }
  library.clearSelection();
  if (failed === 0) toast(`已恢复 ${restored} 首歌曲到音乐库。`, "success");
  else toast(`恢复完成：${restored} 首成功，${failed} 首失败。`, "error");
}
async function bulkDelete() {
  if (!library.selectedIds.size) return;
  const permanent = isTrash.value;
  const ok = await confirmDialog({
    title: permanent ? "永久删除" : "移入回收站",
    message: permanent
      ? `永久删除选中的 ${library.selectedIds.size} 首歌曲？此操作无法恢复。`
      : `将选中的 ${library.selectedIds.size} 首歌曲移入回收站？`,
    confirmText: permanent ? "永久删除" : "移入回收站",
    danger: true
  });
  if (!ok) return;
  const ids = [...library.selectedIds];
  if (player.playingTrack && ids.includes(player.playingTrack.id)) player.stop();
  let deleted = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      if (permanent) await window.linkAudio.permanentlyDeleteTrack(id);
      else {
        const result = await window.linkAudio.deleteTrack(id);
        library.tracks = result;
      }
      deleted++;
    } catch {
      failed++;
    }
  }
  await library.reloadDeleted();
  library.clearSelection();
  await library.refreshTracks();
  if (failed === 0) {
    toast(permanent ? `已永久删除 ${deleted} 首歌曲。` : `已移入回收站 ${deleted} 首歌曲。`, "success");
  } else {
    toast(`操作完成：${deleted} 首成功，${failed} 首失败。`, "error");
  }
}

// 回收站
async function emptyTrash() {
  if (!library.deletedTracks.length) return;
  const ok = await confirmDialog({
    title: "清空回收站",
    message: `永久删除回收站里的全部 ${library.deletedTracks.length} 首歌曲？此操作无法恢复。`,
    confirmText: "全部永久删除",
    danger: true
  });
  if (!ok) return;
  let emptied = 0;
  for (const track of library.deletedTracks) {
    try {
      library.deletedTracks = await window.linkAudio.permanentlyDeleteTrack(track.id);
      emptied++;
    } catch {
      toast(`永久删除"${track.title}"失败，已停止清空。`, "error");
      break;
    }
  }
  library.clearSelection();
  if (emptied) toast(`已清空回收站，永久删除 ${emptied} 首歌曲。`, "success");
}
const retentionHint = computed(() => {
  const days = settings.settings.trashRetentionDays;
  return days > 0 ? `回收站内容保留 ${days} 天，到期自动清理。` : "回收站内容不会自动清理。";
});

// 更多菜单
const menuTrackId = ref("");
function toggleMenu(trackId: string) {
  menuTrackId.value = menuTrackId.value === trackId ? "" : trackId;
}
function menuFor(track: Track) {
  return [
    { label: "收藏到歌单", action: () => modals.openPlaylistPicker(track) },
    { label: "打开黑胶视图", action: () => view.openDetail(track) },
    { label: "下一首播放", action: () => queueNext(track) },
    playlist.value
      ? { label: "从歌单移除", action: () => void removeFromPlaylist(track) }
      : { label: "移入回收站", action: () => void removeFromLibrary(track) }
  ];
}

// 行拖拽到歌单
function onRowDropToPlaylist(target: Track, event: DragEvent) {
  event.preventDefault();
  const movingId = event.dataTransfer?.getData("text/linkaudio-track-id");
  const current = playlist.value;
  if (!movingId || !current || movingId === target.id) return;
  const order = current.trackIds.filter((id) => id !== movingId);
  order.splice(Math.max(0, order.indexOf(target.id)), 0, movingId);
  void window.linkAudio.updatePlaylist(current.id, order).then((result) => {
    library.playlists = result;
  });
}

// 导入入口（空态引导）
function goImport() {
  view.showView("import");
}

// Ctrl+F 聚焦
function focusSearch() {
  searchInput.value?.focus();
}
onMounted(() => {
  window.addEventListener("linkaudio:focus-search", focusSearch);
  document.addEventListener("click", closeMenusOnClick);
});
onBeforeUnmount(() => {
  window.removeEventListener("linkaudio:focus-search", focusSearch);
  document.removeEventListener("click", closeMenusOnClick);
});
function closeMenusOnClick(event: MouseEvent) {
  if (!(event.target as HTMLElement).closest(".acts, .row-menu")) menuTrackId.value = "";
}
function onRowClick(track: Track, event: MouseEvent) {
  void track;
  if ((event.target as HTMLElement).closest("button, input, select, .row-menu")) return;
  document.querySelectorAll(".trow.selected").forEach((row) => row.classList.remove("selected"));
  (event.currentTarget as HTMLElement).classList.add("selected");
}

// 来源列显示（设置项）
const showSource = computed(() => settings.settings.showSourceColumn !== false);
</script>

<template>
  <section class="library">
    <header class="lib-head">
      <div class="row">
        <h3>{{ heading }}</h3>
        <span class="count-pill num">{{ count }}</span>
        <div v-if="!isTrash" class="head-tools">
          <div class="searchbar">
            <input
              ref="searchInput"
              v-model="searchValue"
              type="search"
              placeholder="搜索歌曲或歌手"
              @focus="onSearchFocus"
              @keydown="onSearchKeydown"
            />
            <div v-if="showGlobalResults && globalResults.length" class="global-results">
              <button
                v-for="item in globalResults"
                :key="item.id"
                class="global-result"
                @click="playGlobalResult(item)"
              >
                <b class="ellip">{{ displayTitle(item.title) }}</b>
                <small>{{ displayArtist(item.author) }} · {{ formatDuration(item.duration) }}</small>
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>

    <!-- 歌曲列表 / 空态 -->
    <div>
      <div v-if="showPlayAll || visible.length" class="toolbar">
        <button v-if="showPlayAll" class="btn primary" :disabled="!visible.length" @click="playAll">▶ 播放全部</button>
        <span class="spacer"></span>
        <select v-if="!isTrash" v-model="library.sort" class="sel" aria-label="排序" @change="library.pruneSelection()">
          <option value="newest">最近导入</option>
          <option value="title">按歌名</option>
          <option value="author">按歌手</option>
          <option value="duration">按时长</option>
        </select>
      </div>

      <div v-if="bulkCount" class="bulkbar">
        <span class="cnt">已选 {{ bulkCount }} 首</span>
        <span class="sep"></span>
        <button class="lnk" @click="bulkFavorite">加入喜欢</button>
        <select v-model="bulkPlaylistId" class="lnk-select">
          <option value="">选择歌单</option>
          <option v-for="item in bulkPlaylists" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select>
        <button class="lnk" :disabled="!bulkPlaylistId" @click="bulkAddPlaylist">加入歌单</button>
        <span class="spacer"></span>
        <button v-if="isTrash" class="lnk" @click="bulkRestore">恢复所选</button>
        <button class="lnk danger" @click="bulkDelete">{{ isTrash ? "永久删除" : "移入回收站" }}</button>
      </div>

      <div v-if="isTrash && library.deletedTracks.length" class="trashbar">
        <span>{{ retentionHint }}</span>
        <button class="btn danger sm" @click="emptyTrash">清空回收站</button>
      </div>

      <div v-if="visible.length" class="thead">
        <span><input type="checkbox" :checked="allVisibleSelected" aria-label="选择当前列表全部歌曲" @change="toggleSelectAll" /></span>
        <span>#</span><span></span><span>歌曲</span><span>歌手</span>
        <span v-if="showSource">来源</span><span style="text-align: right">时长</span><span style="text-align: right">操作</span>
      </div>

      <div class="tlist" role="list">
        <article
          v-for="(track, index) in visible"
          :key="track.id"
          class="trow"
          role="listitem"
          :aria-label="`歌曲：${displayTitle(track.title)}，歌手：${displayArtist(track.author)}`"
          :class="{ playing: player.playingTrack?.id === track.id, 'trash-track': isTrash }"
          :tabindex="isTrash ? -1 : 0"
          :draggable="!isTrash"
          @click="onRowClick(track, $event)"
          @dblclick="!isTrash && (player.play(track as Track, true), openDetailRow(track as Track))"
          @keydown.enter="!isTrash && (player.play(track as Track, true), openDetailRow(track as Track))"
          @dragstart="event => event.dataTransfer?.setData('text/linkaudio-track-id', track.id)"
          @dragover="playlist && $event.preventDefault()"
          @drop="playlist && onRowDropToPlaylist(track as Track, $event)"
          @contextmenu.prevent="menuTrackId = track.id"
        >
          <span><input
            type="checkbox"
            class="rowcb"
            :checked="library.selectedIds.has(track.id)"
            :aria-label="`选择歌曲：${track.title}`"
            @click.stop
            @change="library.toggleSelected(track.id, ($event.target as HTMLInputElement).checked)"
          /></span>
          <span class="idx num">{{ String(index + 1).padStart(2, "0") }}</span>
          <img v-if="track.thumbnail" class="cov" :src="track.thumbnail" alt="" loading="lazy" />
          <span v-else class="cov cov-empty">♪</span>
          <div class="tt">
            <b class="ellip" :title="track.title">
              <span v-if="player.playingTrack?.id === track.id" class="eq"><i></i><i></i><i></i></span>{{ displayTitle(track.title) }}
            </b>
            <small>{{ track.lyrics ? "已匹配歌词" : "暂无歌词" }}</small>
          </div>
          <span class="artist ellip" :title="displayArtist(track.author)">{{ displayArtist(track.author) }}</span>
          <span
            v-if="showSource"
            class="src-badge"
            :style="{ '--dot': platformColor(track.platform) }"
          ><i></i>{{ platformLabel(track.platform) }}</span>
          <span class="dur num">{{ formatDuration(track.duration) }}</span>
          <div v-if="isTrash" class="acts" style="opacity: 1">
            <button class="icon-btn" :title="`恢复'${track.title}'`" @click.stop="restoreRow(track as Track)">↶</button>
            <button class="icon-btn" title="永久删除" @click.stop="permanentlyDeleteRow(track as Track)">✕</button>
          </div>
          <div v-else class="acts">
            <button
              class="icon-btn fav"
              :class="{ on: track.favorite }"
              :aria-label="track.favorite ? `取消喜欢${track.title}` : `喜欢${track.title}`"
              :title="track.favorite ? `取消喜欢'${track.title}'` : `喜欢'${track.title}'`"
              @click.stop="toggleFavorite(track as Track)"
            >{{ track.favorite ? "♥" : "♡" }}</button>
            <button
              class="icon-btn"
              :aria-label="`播放${track.title}`"
              :title="`播放'${track.title}'`"
              @click.stop="playRow(track as Track)"
            >▶</button>
            <button
              class="icon-btn"
              title="收藏到歌单"
              :aria-label="`收藏${track.title}到歌单`"
              @click.stop="modals.openPlaylistPicker(track as Track)"
            >⊕</button>
            <button class="icon-btn" aria-label="更多操作" @click.stop="toggleMenu(track.id)">⋯</button>
            <div v-if="menuTrackId === track.id" class="row-menu" @click.stop>
              <button
                v-for="item in menuFor(track as Track)"
                :key="item.label"
                class="row-menu-item"
                :class="{ danger: item.label.includes('移除') || item.label.includes('回收站') }"
                @click="item.action(); menuTrackId = ''"
              >{{ item.label }}</button>
            </div>
          </div>
        </article>
      </div>

      <div v-if="!visible.length" class="empty">
        <span>{{ emptyIcon }}</span>
        <h4>{{ emptyTitle }}</h4>
        <p>{{ emptyCopy }}</p>
        <div class="empty-actions">
          <button v-if="showClearSearch" class="btn secondary sm" @click="clearSearch">清除搜索</button>
          <button v-if="lastQuery && !isTrash" class="btn primary sm" @click="searchOnline(lastQuery, 'bilibili')">去 B站 搜索「{{ displayTitle(lastQuery, 12) }}」</button>
          <button v-if="lastQuery && !isTrash" class="btn secondary sm" @click="searchOnline(lastQuery, 'netease')">去网易云搜索</button>
          <button v-if="view.activeCollection === 'all'" class="btn primary sm" @click="goImport">去导入音乐</button>
          <button v-if="showGoLibrary" class="btn secondary sm" @click="view.showView('library', 'all')">去音乐库挑几首</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script lang="ts">
export default { name: "LibraryView" };
</script>

<style scoped>
.library { padding-bottom: 40px; }
.lib-head { padding: 22px 26px 0; }
.eyebrow { color: var(--ink-3); font-size: 11.5px; letter-spacing: 1px; margin: 0; }
.lib-head .row { display: flex; align-items: center; gap: 14px; margin-top: 2px; }
.lib-head h3 { margin: 0; font-size: 26px; font-weight: 800; }
.count-pill { padding: 3px 10px; border-radius: 999px; font-size: 11.5px; color: var(--ink-2); border: 1px solid var(--line-strong); background: var(--panel-solid); }
.head-tools { margin-left: auto; }
.searchbar {
  position: relative; display: flex; align-items: center; gap: 8px; padding: 5px 6px 5px 12px;
  border: 1px solid var(--line-strong); border-radius: 12px; background: var(--panel-solid); width: 360px;
}
.searchbar input {
  flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--ink);
  font-size: 13px; padding: 5px 2px;
}
.searchbar input::placeholder { color: var(--ink-3); }
.global-results {
  position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 40;
  background: var(--elevated); border: 1px solid var(--line-strong); border-radius: 12px;
  box-shadow: var(--shadow-lg); overflow: hidden; padding: 4px;
}
.global-result {
  display: block; width: 100%; text-align: left; padding: 8px 10px; border: 0; border-radius: 8px;
  background: transparent; color: var(--ink); cursor: pointer;
}
.global-result:hover { background: var(--accent-soft); }
.global-result b { display: block; font-size: 12.5px; font-weight: 600; }
.global-result small { color: var(--ink-3); font-size: 11px; }

.toolbar { display: flex; align-items: center; gap: 9px; padding: 16px 26px 12px; }
.toolbar .spacer, .bulkbar .spacer { flex: 1; }
.sel {
  display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px;
  border: 1px solid var(--line-strong); border-radius: 10px; font-size: 12.5px;
  background: var(--panel-solid); color: var(--ink);
}
.bulkbar {
  display: flex; align-items: center; gap: 10px; margin: 0 26px 10px;
  padding: 8px 14px; border-radius: 12px; font-size: 12.5px;
  background: var(--accent-soft); border: 1px solid var(--accent-soft-2); color: var(--ink);
}
.bulkbar .cnt { font-weight: 700; }
.bulkbar .sep { width: 1px; height: 16px; background: var(--line-strong); }
.bulkbar .lnk { color: var(--ink-2); cursor: pointer; padding: 2px 6px; border-radius: 6px; border: 0; background: transparent; font-size: 12.5px; }
.bulkbar .lnk:hover:not(:disabled) { background: var(--row-hover); color: var(--ink); }
.bulkbar .lnk.danger { color: var(--danger); }
.lnk-select {
  background: var(--panel-solid); color: var(--ink); border: 1px solid var(--line-strong);
  border-radius: 8px; font-size: 12px; padding: 3px 6px;
}
.trashbar {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  margin: 0 26px 12px; padding: 10px 16px; border-radius: 12px;
  border: 1px solid var(--line); background: var(--panel-solid); color: var(--ink-2); font-size: 13px;
}
.thead, .trow {
  display: grid; grid-template-columns: 44px 40px 52px minmax(0, 1fr) 150px 92px 64px 150px;
  align-items: center; gap: 8px; padding: 0 26px;
}
.thead { height: 36px; color: var(--ink-3); font-size: 11.5px; letter-spacing: 0.5px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--bg); z-index: 2; }
.tlist { position: relative; }
.trow {
  height: 56px; cursor: default; border-bottom: 1px solid var(--line);
  transition: background 0.12s; position: relative;
}
.trow:focus { outline: none; background: var(--row-hover); }
.trow:hover { background: var(--row-hover); }
.trow.selected { background: var(--row-hover); }
.trow.playing { background: var(--accent-soft); }
.trow.playing::before {
  content: ""; position: absolute; left: 0; top: 14%; bottom: 14%; width: 3px;
  border-radius: 0 3px 3px 0; background: var(--accent);
}
.trow.playing .tt b { color: var(--accent); }
.trow .idx { color: var(--ink-3); font-size: 12px; }
.cov { width: 40px; height: 40px; border-radius: 9px; object-fit: cover; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3); }
.cov-empty { display: grid; place-items: center; background: var(--elevated); color: var(--ink-3); }
.tt { min-width: 0; }
.tt b { display: flex; align-items: center; font-size: 13.5px; font-weight: 600; min-width: 0; }
.tt small { color: var(--ink-3); font-size: 11.5px; }
.artist, .dur { color: var(--ink-2); font-size: 12.5px; }
.dur { text-align: right; padding-right: 6px; }
.src-badge {
  justify-self: start; display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; color: var(--ink-2); padding: 2px 9px;
  border: 1px solid var(--line-strong); border-radius: 999px;
}
.src-badge i { width: 6px; height: 6px; border-radius: 50%; background: var(--dot, var(--ink-3)); }
.acts { display: flex; gap: 2px; justify-content: flex-end; opacity: 0; transition: opacity 0.15s; position: relative; }
.trow:hover .acts, .trow.playing .acts, .trash-track .acts { opacity: 1; }
.icon-btn {
  width: 30px; height: 30px; display: grid; place-items: center; border-radius: 9px;
  color: var(--ink-2); cursor: pointer; font-size: 13px; border: 0; background: transparent;
}
.icon-btn:hover { background: var(--accent-soft); color: var(--ink); }
.icon-btn.fav.on { color: var(--accent); }
.icon-btn.dl { color: #9fb54a; }
.icon-btn.add { color: #d4879f; }
.eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 13px; margin-right: 7px; }
.eq i { width: 3px; background: var(--accent); border-radius: 2px; animation: eq 1s ease-in-out infinite; }
.eq i:nth-child(2) { animation-delay: 0.25s; }
.eq i:nth-child(3) { animation-delay: 0.5s; }
@keyframes eq { 0%, 100% { height: 4px; } 50% { height: 13px; } }
.rowcb { accent-color: var(--accent); width: 15px; height: 15px; }
.row-menu {
  position: absolute; right: 0; top: calc(100% - 6px); z-index: 45; min-width: 140px;
  background: var(--elevated); border: 1px solid var(--line-strong); border-radius: 10px;
  box-shadow: var(--shadow-lg); padding: 4px;
}
.row-menu-item {
  display: block; width: 100%; text-align: left; padding: 7px 10px; font-size: 12.5px;
  border: 0; border-radius: 7px; background: transparent; color: var(--ink); cursor: pointer;
}
.row-menu-item:hover { background: var(--accent-soft); }
.row-menu-item.danger { color: var(--danger); }
.row-menu-item.danger:hover { background: var(--danger-soft); }
.empty { padding: 70px 20px; text-align: center; color: var(--ink-2); }
.empty > span {
  width: 60px; height: 60px; display: grid; place-items: center; margin: 0 auto 16px;
  border: 1px solid var(--line-strong); border-radius: 50%;
}
.empty h4 { margin: 0 0 7px; font-size: 19px; color: var(--ink); }
.empty p { margin: 0; font-size: 13px; }
.empty-actions { display: flex; justify-content: center; gap: 10px; margin-top: 20px; }

</style>
