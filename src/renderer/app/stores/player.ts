import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { DesktopLyricsState, Track } from "../../../shared/types.js";
import { selectCollectionTracks } from "../../collection.js";
import { displayArtist, displayTitle } from "../format.js";
import { useLibraryStore } from "./library.js";
import { useViewStore } from "./view.js";

export type PlayMode = "list" | "shuffle" | "repeat";

export const PLAY_MODE_LABELS = {
  list: { icon: "⇢", label: "顺序播放" },
  shuffle: { icon: "⤮", label: "随机播放" },
  repeat: { icon: "⟳", label: "单曲循环" }
} as const;

export const usePlayerStore = defineStore("player", () => {
  const audio = new Audio();

  const playingTrack = ref<Track | null>(null);
  const isPlaying = ref(false);
  const hasError = ref(false);
  const controlsEnabled = ref(false);
  const currentTime = ref(0);
  const duration = ref(0);
  const maximized = ref(false);

  /** 展示用标题/歌手/封面：播放曲库歌曲时跟随曲目，在线预览时用临时值 */
  const displayTrackTitle = computed(() => displayTitle(playingTrack.value?.title ?? ""));
  const displayTrackAuthor = computed(() => displayArtist(playingTrack.value?.author));
  const previewMode = ref(false);
  const previewTitle = ref("暂未播放歌曲");
  const previewAuthor = ref("从音乐库选择一首歌曲");
  const previewCover = ref<string | null>(null);

  const playMode = ref<PlayMode>((localStorage.getItem("linkAudioPlayMode") as PlayMode) || "list");
  const playbackOrder = ref<string[]>(JSON.parse(localStorage.getItem("linkAudioPlaybackOrder") || "[]"));
  const playNextQueue = ref<string[]>(JSON.parse(localStorage.getItem("linkAudioPlayNextQueue") || "[]"));
  /** 历史播放记录：最近播放在前，去重，最多 100 条 */
  const playHistory = ref<string[]>(JSON.parse(localStorage.getItem("linkAudioPlayHistory") || "[]"));

  const library = useLibraryStore();
  const view = useViewStore();

  let pendingRestoreTime = 0;
  let lastPersistedSecond = -1;
  let onlinePreviewDuration: number | null = null;

  const playModeInfo = computed(() => PLAY_MODE_LABELS[playMode.value]);
  const progress = computed(() =>
    duration.value > 0 ? Math.min(100, (currentTime.value / duration.value) * 100) : 0
  );
  const activeLyricIndex = computed(() => {
    const lines = playingTrack.value?.lyrics?.lines || [];
    let index = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].start <= currentTime.value) index = i;
      else break;
    }
    return index;
  });

  function persistOrder() {
    localStorage.setItem("linkAudioPlaybackOrder", JSON.stringify(playbackOrder.value));
    localStorage.setItem("linkAudioPlayNextQueue", JSON.stringify(playNextQueue.value));
  }

  /** 桌面歌词展示用：去掉 B站字幕/分享歌词里带的说话人前缀（如“西恩：”） */
  function stripSpeakerPrefix(text: string): string {
    return text.replace(/^[^\s：:]{1,12}[：:]\s*/, "").trim() || text.trim();
  }

  function updateDesktopLyrics() {
    const lines = playingTrack.value?.lyrics?.lines || [];
    const activeIndex = activeLyricIndex.value;
    const state: DesktopLyricsState = {
      title: playingTrack.value?.title || "LyraLink",
      author: playingTrack.value?.author || "",
      coverUrl: playingTrack.value?.thumbnail || "",
      currentLine:
        activeIndex >= 0
          ? stripSpeakerPrefix(lines[activeIndex].text)
          : playingTrack.value
            ? lines.length
              ? "♪ 前奏"
              : "纯音乐 · 暂无歌词"
            : "正在等待播放",
      nextLine: activeIndex >= 0 ? stripSpeakerPrefix(lines[activeIndex + 1]?.text || "") : "",
      hasLyrics: lines.length > 0,
      isPlaying: !audio.paused && Boolean(playingTrack.value),
      playMode: playMode.value,
      locked: false
    };
    window.linkAudio.updateDesktopLyrics(state);
  }

  /** 编辑歌曲信息后同步刷新播放条/桌面歌词 */
  function syncUpdatedTrack(updated: Track) {
    if (playingTrack.value?.id === updated.id) {
      playingTrack.value = updated;
      updateDesktopLyrics();
    }
  }

  function loadPlayerTrack(track: Track) {
    playingTrack.value = track;
    previewMode.value = false;
    onlinePreviewDuration = null;
    hasError.value = false;
    controlsEnabled.value = true;
    if (audio.src !== track.fileUrl) {
      audio.src = track.fileUrl;
      currentTime.value = 0;
      duration.value = track.duration ?? 0;
    }
    view.selectedTrack = track;
    localStorage.setItem("linkAudioLastTrackId", track.id);
    recordHistory(track.id);
  }

  function recordHistory(id: string) {
    playHistory.value = [id, ...playHistory.value.filter((item) => item !== id)].slice(0, 100);
    localStorage.setItem("linkAudioPlayHistory", JSON.stringify(playHistory.value));
  }

  function setMode(mode: PlayMode) {
    playMode.value = mode;
    localStorage.setItem("linkAudioPlayMode", mode);
    updateDesktopLyrics();
  }

  /** 按歌单顺序播放整个歌单 */
  function playPlaylist(trackIds: string[]) {
    if (!trackIds.length) return;
    const first = library.tracks.find((track) => track.id === trackIds[0]);
    if (!first) return;
    playbackOrder.value = [...trackIds];
    playNextQueue.value = [];
    loadPlayerTrack(first);
    persistOrder();
    resumeAudio();
  }

  function play(track: Track, resetPlaybackContext = false) {
    if (resetPlaybackContext) {
      playbackOrder.value = selectCollectionTracks({
        tracks: library.tracks,
        folders: library.folders,
        playlists: library.playlists,
        activeCollection: view.activeCollection === "trash" ? "all" : view.activeCollection,
        query: library.query,
        sort: library.sort
      }).map((t) => t.id);
    }
    if (!playbackOrder.value.includes(track.id)) {
      playbackOrder.value = [track.id, ...playbackOrder.value.filter((id) => id !== track.id)];
    }
    loadPlayerTrack(track);
    persistOrder();
    resumeAudio();
  }

  function resumeAudio() {
    if (!audio.src) return;
    void audio.play().catch(() => {
      hasError.value = true;
    });
  }

  function pause() {
    audio.pause();
  }

  function toggle() {
    if (audio.paused) resumeAudio();
    else audio.pause();
  }

  function stop() {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    playingTrack.value = null;
    previewMode.value = false;
    playbackOrder.value = [];
    playNextQueue.value = [];
    currentTime.value = 0;
    duration.value = 0;
    hasError.value = false;
    controlsEnabled.value = false;
    localStorage.removeItem("linkAudioLastTrackId");
    localStorage.removeItem("linkAudioLastPosition");
    persistOrder();
    updateDesktopLyrics();
  }

  function playRelative(direction: -1 | 1) {
    if (direction === 1 && playNextQueue.value.length) {
      const queuedId = playNextQueue.value.shift()!;
      const queued = library.tracks.find((track) => track.id === queuedId);
      if (queued) {
        play(queued);
        return;
      }
    }
    const queue = playbackOrder.value
      .map((id) => library.tracks.find((track) => track.id === id))
      .filter((t): t is Track => Boolean(t));
    if (!queue.length) return;
    const currentIndex = playingTrack.value
      ? queue.findIndex((track) => track.id === playingTrack.value!.id)
      : -1;
    let nextIndex: number;
    if (playMode.value === "shuffle" && queue.length > 1) {
      do nextIndex = Math.floor(Math.random() * queue.length);
      while (nextIndex === currentIndex);
    } else {
      nextIndex = (currentIndex + direction + queue.length) % queue.length;
    }
    play(queue[nextIndex]);
  }

  function cyclePlayMode() {
    playMode.value = playMode.value === "list" ? "shuffle" : playMode.value === "shuffle" ? "repeat" : "list";
    localStorage.setItem("linkAudioPlayMode", playMode.value);
    updateDesktopLyrics();
  }

  function seekTo(seconds: number) {
    audio.currentTime = seconds;
    currentTime.value = seconds;
  }

  function nudge(delta: number) {
    seekTo(Math.min(audio.duration || Infinity, Math.max(0, audio.currentTime + delta)));
  }

  function setVolume(volume: number) {
    audio.volume = volume;
  }

  /** 队列展示顺序：已播在上（置灰）→ 当前曲 → 待播在下 */
  const queueRows = computed(() => {
    const ordered = playbackOrder.value
      .map((id) => library.tracks.find((track) => track.id === id))
      .filter((t): t is Track => Boolean(t));
    const currentIndex = playingTrack.value
      ? ordered.findIndex((track) => track.id === playingTrack.value!.id)
      : -1;
    const history = currentIndex >= 0 ? ordered.slice(0, currentIndex) : [];
    const upcoming = currentIndex >= 0 ? ordered.slice(currentIndex + 1) : ordered;
    const explicitNext = playNextQueue.value
      .map((id) => library.tracks.find((track) => track.id === id))
      .filter((t): t is Track => Boolean(t));
    const seen = new Set<string>();
    return [...history, playingTrack.value, ...explicitNext, ...upcoming]
      .filter((t): t is Track => Boolean(t))
      .filter((track) => {
        if (seen.has(track.id)) return false;
        seen.add(track.id);
        return true;
      })
      .map((track) => {
        const orderIndex = ordered.findIndex((item) => item.id === track.id);
        return {
          track,
          isCurrent: playingTrack.value?.id === track.id,
          isPlayed: currentIndex >= 0 && orderIndex < currentIndex && playingTrack.value?.id !== track.id
        };
      });
  });

  function reorderQueue(queueIds: string[], movingId: string, targetId: string) {
    const reordered = queueIds.filter((id) => id !== movingId);
    const insertAt = Math.max(
      reordered.indexOf(playingTrack.value?.id ?? "") + 1,
      reordered.indexOf(targetId)
    );
    reordered.splice(insertAt, 0, movingId);
    playbackOrder.value = reordered;
    playNextQueue.value = [];
    persistOrder();
  }

  function clearUpcoming() {
    playNextQueue.value = [];
    playbackOrder.value = playingTrack.value ? [playingTrack.value.id] : [];
    persistOrder();
  }

  function removeFromQueue(id: string) {
    playNextQueue.value = playNextQueue.value.filter((queued) => queued !== id);
    playbackOrder.value = playbackOrder.value.filter((queued) => queued !== id);
    persistOrder();
  }

  function enqueueNext(track: Track) {
    playNextQueue.value = [...playNextQueue.value.filter((id) => id !== track.id), track.id];
    persistOrder();
  }

  /** B 站在线预览（不进曲库播放队列） */
  function loadPreview(
    streamUrl: string,
    title: string,
    author: string,
    thumbnail: string | null,
    duration: number | null,
    badge = "B站预览"
  ) {
    playingTrack.value = null;
    view.selectedTrack = null;
    previewMode.value = true;
    onlinePreviewDuration = duration;
    playbackOrder.value = [];
    playNextQueue.value = [];
    previewTitle.value = displayTitle(title);
    previewAuthor.value = `${displayArtist(author)} · ${badge}`;
    previewCover.value = thumbnail;
    audio.src = streamUrl;
    controlsEnabled.value = true;
    hasError.value = false;
    void audio.play().catch(() => {
      hasError.value = true;
    });
  }

  function setupAudioListeners() {
    audio.addEventListener("loadedmetadata", () => {
      duration.value =
        Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : onlinePreviewDuration || 0;
      if (pendingRestoreTime > 0) {
        audio.currentTime = Math.min(pendingRestoreTime, Math.max(0, (audio.duration || 0) - 0.1));
        pendingRestoreTime = 0;
      }
      updateDesktopLyrics();
    });
    audio.addEventListener("timeupdate", () => {
      currentTime.value = audio.currentTime;
      const currentSecond = Math.floor(audio.currentTime);
      if (playingTrack.value && currentSecond !== lastPersistedSecond) {
        lastPersistedSecond = currentSecond;
        localStorage.setItem("linkAudioLastPosition", String(audio.currentTime));
      }
      updateDesktopLyrics();
    });
    audio.addEventListener("play", () => {
      isPlaying.value = true;
      hasError.value = false;
      updateDesktopLyrics();
    });
    audio.addEventListener("pause", () => {
      isPlaying.value = false;
      updateDesktopLyrics();
    });
    audio.addEventListener("error", () => {
      if (audio.src) hasError.value = true;
    });
    audio.addEventListener("ended", () => {
      if (playMode.value === "repeat") {
        audio.currentTime = 0;
        resumeAudio();
      } else if (playMode.value === "shuffle") {
        playRelative(1);
      } else {
        const queue = playbackOrder.value
          .map((id) => library.tracks.find((track) => track.id === id))
          .filter((t): t is Track => Boolean(t));
        const currentIndex = playingTrack.value
          ? queue.findIndex((track) => track.id === playingTrack.value!.id)
          : -1;
        if (currentIndex >= 0 && currentIndex < queue.length - 1) play(queue[currentIndex + 1]);
      }
    });
  }

  /** 启动时恢复上次播放曲目与进度（暂停态） */
  function restoreLastSession() {
    const lastId = localStorage.getItem("linkAudioLastTrackId");
    if (!lastId) return;
    const track = library.tracks.find((item) => item.id === lastId);
    if (!track) return;
    playingTrack.value = track;
    controlsEnabled.value = true;
    audio.src = track.fileUrl;
    pendingRestoreTime = Number(localStorage.getItem("linkAudioLastPosition") || 0);
    if (pendingRestoreTime > 0) {
      audio.currentTime = pendingRestoreTime;
      currentTime.value = pendingRestoreTime;
    }
    duration.value = track.duration ?? 0;
  }

  return {
    audio,
    playingTrack, isPlaying, hasError, controlsEnabled, currentTime, duration, maximized,
    displayTrackTitle, displayTrackAuthor, previewMode, previewTitle, previewAuthor, previewCover,
    playMode, playbackOrder, playNextQueue, playHistory,
    playModeInfo, progress, activeLyricIndex, queueRows,
    play, resumeAudio, pause, toggle, stop, playRelative, cyclePlayMode, setMode, playPlaylist,
    seekTo, nudge, setVolume, loadPlayerTrack, syncUpdatedTrack,
    reorderQueue, clearUpcoming, removeFromQueue, enqueueNext,
    loadPreview, setupAudioListeners, restoreLastSession, updateDesktopLyrics
  };
});
