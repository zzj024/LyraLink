<script setup lang="ts">
import { computed, ref } from "vue";
import type { Track } from "../../../shared/types.js";
import { useLibraryStore } from "../stores/library.js";
import { usePlayerStore } from "../stores/player.js";
import { useModalsStore } from "../stores/modals.js";
import { useViewStore } from "../stores/view.js";
import VinylDeck from "../components/VinylDeck.vue";
import LyricsLines from "../components/LyricsLines.vue";
import { displayArtist, displayTitle, formatDuration, platformColor, platformLabel } from "../format.js";
import { confirmDialog, toast } from "../ui.js";

const view = useViewStore();
const modals = useModalsStore();
const library = useLibraryStore();
const player = usePlayerStore();

const track = computed(() => view.selectedTrack);
const playingThis = computed(() => player.isPlaying && player.playingTrack?.id === track.value?.id);
const menuOpen = ref(false);

const moreMenu = computed(() => [
  { key: "playlist", label: "收藏到歌单", run: () => track.value && modals.openPlaylistPicker(track.value) },
  { key: "edit-lyrics", label: track.value?.lyrics ? "编辑歌词" : "添加歌词", run: () => track.value && modals.openLyrics(track.value) },
  { key: "import-lrc", label: "导入 LRC", run: () => void importLrc() },
  { key: "song-info", label: "查看歌曲信息", run: () => (view.songInfoOpen = true) },
  { key: "edit-track", label: "编辑信息", run: () => track.value && modals.openTrackEditor(track.value) },
  { key: "split", label: "裁切 / 拆分", run: () => track.value && modals.openSplit(track.value) },
  { key: "export-track", label: "导出音频", run: () => void exportTrack() },
  { key: "export-lrc", label: "导出 LRC", run: () => void exportLrc() },
  { key: "reveal", label: "打开位置", run: () => track.value && void window.linkAudio.revealTrack(track.value.id) },
  { key: "delete", label: "移入回收站", run: () => void removeTrack(), danger: true }
]);

async function importLrc() {
  if (!track.value) return;
  try {
    const updated = await window.linkAudio.importLrc(track.value.id);
    if (updated) {
      library.applyUpdatedTrack(updated);
      toast("LRC 歌词已导入。", "success");
    }
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  }
}
async function exportTrack() {
  if (!track.value) return;
  try {
    if (await window.linkAudio.exportTrack(track.value.id)) toast("音频已导出。", "success");
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  }
}
async function exportLrc() {
  if (!track.value) return;
  try {
    if (await window.linkAudio.exportLrc(track.value.id)) toast("LRC 已导出。", "success");
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  }
}
async function removeTrack() {
  if (!track.value) return;
  const ok = await confirmDialog({
    title: "移入回收站",
    message: `将"${track.value.title}"移入回收站？`,
    confirmText: "移入回收站",
    danger: true
  });
  if (!ok) return;
  const result = await window.linkAudio.deleteTrack(track.value.id);
  library.tracks = result;
  if (player.playingTrack?.id === track.value.id) player.stop();
  toast("已移入回收站。", "success");
  view.backToLibrary();
}

function togglePlay() {
  if (!track.value) return;
  if (player.playingTrack?.id === track.value.id && !player.audio.paused) player.pause();
  else player.play(track.value);
}
void togglePlay;
function runMenuItem(item: (typeof moreMenu.value)[number]) {
  menuOpen.value = false;
  item.run();
}
</script>

<template>
  <section v-if="track" class="detail-view" :class="{ playing: playingThis }">
    <div class="detail-topbar">
      <div class="dt-left">
        <button class="back-pill" @click="view.backToLibrary">
          <span class="back-ico">←</span><span>音乐库</span>
        </button>
        <h3 class="ellip" :title="track.title">{{ displayTitle(track.title) }}</h3>
        <p class="muted">{{ displayArtist(track.author) }} · {{ formatDuration(track.duration) }}</p>
        <span class="src-badge" :style="{ '--dot': platformColor(track.platform) }"><i></i>{{ platformLabel(track.platform) }}</span>
      </div>
      <div class="dt-actions">
        <button class="btn secondary" aria-label="更多操作" title="更多操作" @click="menuOpen = !menuOpen">⋯</button>
        <div v-if="menuOpen" class="more-menu">
          <button
            v-for="item in moreMenu"
            :key="item.key"
            class="menu-item"
            :class="{ danger: item.danger }"
            @click="runMenuItem(item)"
          >{{ item.label }}</button>
        </div>
      </div>
    </div>

    <div class="detail-stage">
      <div class="stage-vinyl" :style="{ backgroundImage: track.thumbnail ? `url('${track.thumbnail}')` : 'none' }"></div>
      <div class="vinyl-wrap" :class="{ 'showing-lyrics': view.showingLyrics }">
        <VinylDeck />
      </div>
      <div class="lyrics-side" :class="{ open: view.showingLyrics }">
        <button class="lyrics-exit" @click="view.backToLibrary"><span class="back-ico">←</span><span>音乐库</span></button>
        <div class="lyrics-art">
          <div class="mini-wrap">
            <button class="mini-disc" :class="{ spinning: playingThis }" aria-label="返回唱片" title="返回唱片" @click="view.showingLyrics = false">
              <img v-if="track.thumbnail" :src="track.thumbnail" alt="" />
              <span v-else class="mini-disc-label">♪</span>
            </button>
            <svg class="tonearm-mini" viewBox="0 0 200 264" aria-hidden="true">
              <g class="tonearm-swing" :class="{ down: playingThis }">
                <path d="M 30 38 L 92 152" fill="none" stroke="#e7e9ec" stroke-width="7" stroke-linecap="round" />
                <g transform="rotate(52 94 156)"><rect x="92" y="147" width="44" height="18" rx="4.5" fill="#e7e9ec" /></g>
              </g>
              <circle cx="30" cy="30" r="10" fill="#e7e9ec" />
              <circle cx="30" cy="30" r="3.2" fill="#83878f" />
            </svg>
          </div>
          <div class="mini-caption">
            <b class="ellip">{{ displayTitle(track.title, 28) }}</b>
            <small class="ellip">{{ displayArtist(track.author) }}</small>
          </div>
        </div>
        <div class="lyrics-body">
          <div v-if="!track.lyrics" class="no-lyrics">
            <span>词</span>
            <h4>暂时没有歌词</h4>
            <p class="muted">粘贴歌词，然后跟随音乐按空格完成同步。</p>
            <button class="btn primary sm" @click="modals.openLyrics(track)">添加歌词</button>
          </div>
          <LyricsLines v-else />
        </div>
      </div>
    </div>

    <transition name="fade">
      <aside v-if="view.songInfoOpen" class="song-info" role="dialog" aria-label="歌曲信息">
        <div class="si-head"><h4>歌曲信息</h4><button class="btn ghost sm" @click="view.songInfoOpen = false">×</button></div>
        <dl>
          <div><dt>歌名</dt><dd class="ellip">{{ track.title }}</dd></div>
          <div><dt>歌手</dt><dd class="ellip">{{ displayArtist(track.author) }}</dd></div>
          <div><dt>来源</dt><dd>{{ platformLabel(track.platform) }}</dd></div>
          <div><dt>时长</dt><dd class="num">{{ formatDuration(track.duration) }}</dd></div>
        </dl>
      </aside>
    </transition>
  </section>
</template>

<style scoped>
.detail-view {
  height: 620px; min-height: 620px; position: relative;
  display: flex; flex-direction: column; overflow: hidden;
  transition: transform 0.5s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.4s ease;
}
.detail-topbar { display: flex; align-items: flex-start; justify-content: space-between; padding: 20px 26px 8px; gap: 16px; }
.dt-left h3 { margin: 6px 0 2px; font-size: 22px; font-weight: 800; max-width: 560px; }
.dt-left p { margin: 0 0 6px; font-size: 12.5px; }
.src-badge {
  display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--ink-2);
  padding: 2px 9px; border: 1px solid var(--line-strong); border-radius: 999px;
}
.src-badge i { width: 6px; height: 6px; border-radius: 50%; background: var(--dot, var(--ink-3)); }
.dt-actions { display: flex; gap: 9px; position: relative; }
.more-menu {
  position: absolute; right: 0; top: calc(100% + 6px); z-index: 60; min-width: 160px;
  background: var(--elevated); border: 1px solid var(--line-strong); border-radius: 12px;
  box-shadow: var(--shadow-lg); padding: 5px;
}
.menu-item {
  display: block; width: 100%; text-align: left; padding: 8px 11px; font-size: 13px;
  border: 0; border-radius: 8px; background: transparent; color: var(--ink); cursor: pointer;
}
.menu-item:hover { background: var(--accent-soft); }
.menu-item.danger { color: var(--danger); }
.menu-item.danger:hover { background: var(--danger-soft); }
.detail-stage {
  flex: 1; position: relative; display: grid; place-items: center;
  background: transparent;
}
.stage-vinyl {
  position: absolute; inset: -10%; background-size: cover; background-position: center;
  filter: blur(90px) saturate(1.3); opacity: 0.22; pointer-events: none;
}
/* 歌词页与唱片页共用同一底色，避免出现两种深色分割 */
.lyrics-side { background: transparent; }
.vinyl-wrap { position: relative; z-index: 2; transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s; }
.vinyl-wrap.showing-lyrics { transform: translateX(-120px) scale(0.8); opacity: 0; pointer-events: none; }
.lyrics-side {
  position: absolute; inset: 0; z-index: 3; display: grid; align-content: start;
  grid-template-columns: 42% 1fr; padding: 60px 30px 30px;
  opacity: 0; pointer-events: none; transform: scale(0.92);
  transition: opacity 0.45s cubic-bezier(0.4, 0, 0.2, 1), transform 0.45s cubic-bezier(0.4, 0, 0.2, 1);
}
.lyrics-side.open { opacity: 1; pointer-events: auto; transform: scale(1); }
.lyrics-exit {
  position: absolute; top: 16px; left: 22px; z-index: 5;
  display: inline-flex; align-items: center; gap: 7px;
  padding: 6px 14px 6px 8px; border-radius: 999px;
  border: 1px solid var(--line-strong); background: var(--panel-solid);
  color: var(--ink-2); font-size: 12.5px; cursor: pointer; transition: all 0.15s;
}
.lyrics-exit:hover { color: var(--ink); border-color: var(--accent); background: var(--accent-soft); }
.lyrics-exit .back-ico {
  width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center;
  background: var(--accent); color: var(--on-accent); font-size: 11px; font-weight: 700;
}
/* 顶栏返回音乐库：胶囊 + 圆形箭头徽标 */
.back-pill {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 5px 14px 5px 6px; border-radius: 999px; margin-bottom: 6px;
  border: 1px solid var(--line-strong); background: var(--panel-solid);
  color: var(--ink-2); font-size: 12.5px; cursor: pointer; transition: all 0.15s;
}
.back-pill:hover { color: var(--ink); border-color: var(--accent); background: var(--accent-soft); transform: translateX(-2px); }
.back-pill .back-ico {
  width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center;
  background: var(--accent); color: var(--on-accent); font-size: 12px; font-weight: 700;
}
.lyrics-art { display: grid; place-items: center; justify-items: center; gap: 14px; position: relative; }
.mini-wrap { position: relative; width: 190px; height: 190px; }
.mini-disc {
  width: 190px; height: 190px; border-radius: 50%; border: 0; padding: 0; cursor: pointer; overflow: hidden;
  background: repeating-radial-gradient(circle, #0f100e 0 5px, #272824 6px 8px);
  box-shadow: 0 24px 50px rgba(0, 0, 0, 0.45); display: grid; place-items: center; color: var(--ink-3);
  animation: spin 24s linear infinite; animation-play-state: paused;
}
.mini-disc img { width: 62%; height: 62%; border-radius: 50%; object-fit: cover; }
/* 无封面：显示一张完整的唱片Label盘面，而不是中心一个小小的 ♪ */
.mini-disc-label {
  width: 62%; height: 62%; border-radius: 50%;
  display: grid; place-items: center; font-size: 44px; color: rgba(24, 26, 18, 0.8);
  background: radial-gradient(circle at 35% 30%, var(--accent), rgba(44, 45, 42, 0.9));
  box-shadow: 0 0 0 6px rgba(8, 9, 8, 0.75), 0 0 0 7px rgba(255, 255, 255, 0.08);
}
.mini-disc.spinning { animation-play-state: running; }
@keyframes spin { to { transform: rotate(360deg); } }
.tonearm-mini {
  position: absolute; z-index: 2; top: -46px; right: -8px; width: 128px; height: auto; overflow: visible;
  filter: drop-shadow(0 8px 10px rgba(0, 0, 0, 0.45)); pointer-events: none;
}
/* 旋转基准必须是唱臂底座（30,30），否则起落臂会绕错误的原点摆动 */
.tonearm-mini .tonearm-swing {
  transform-box: view-box; transform-origin: 30px 30px;
  transform: rotate(-30deg);
  transition: transform 0.8s cubic-bezier(0.4, 0, 0.2, 1);
}
.tonearm-mini .tonearm-swing.down { transform: rotate(0deg); }
.mini-caption { text-align: center; max-width: 240px; }
.mini-caption b { display: block; font-size: 13.5px; }
.mini-caption small { color: var(--ink-3); font-size: 11.5px; }
.lyrics-body { min-width: 0; max-height: 100%; overflow-y: auto; padding-right: 8px; }
.no-lyrics { display: grid; justify-items: center; align-content: center; gap: 8px; height: 100%; text-align: center; }
.no-lyrics span {
  width: 54px; height: 54px; display: grid; place-items: center; border-radius: 50%;
  border: 1px solid var(--line-strong); color: var(--ink-2);
}
.no-lyrics h4 { margin: 0; font-size: 18px; }
.no-lyrics p { margin: 0; font-size: 12.5px; }
.song-info {
  position: absolute; right: 22px; top: 70px; z-index: 70; width: 300px;
  background: var(--elevated); border: 1px solid var(--line-strong); border-radius: var(--r-md);
  box-shadow: var(--shadow-lg); padding: 16px;
}
.si-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.si-head h4 { margin: 0; font-size: 15px; }
.song-info dl { margin: 0; }
.song-info dl div { display: flex; gap: 12px; padding: 7px 0; border-bottom: 1px dashed var(--line); }
.song-info dt { color: var(--ink-3); font-size: 12px; width: 40px; flex: none; }
.song-info dd { margin: 0; font-size: 12.5px; min-width: 0; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
