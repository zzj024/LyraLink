import type {
  AppSettings, AudioFolder, AudioSegment, DeletedTrack, LyricLine, MediaPreview, Playlist, Track, TrackUpdate
} from "../shared/types.js";
import { selectCollectionTracks } from "./collection.js";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = byId<HTMLTextAreaElement>("link-input");
const status = byId<HTMLDivElement>("status");
const statusText = byId<HTMLSpanElement>("status-text");
const previewCard = byId<HTMLElement>("preview");
const importButton = byId<HTMLButtonElement>("import-button");
const audio = byId<HTMLAudioElement>("audio");
const syncSeek = byId<HTMLInputElement>("sync-seek");
const playerSeek = byId<HTMLInputElement>("player-seek");

let tracks: Track[] = [];
let folders: AudioFolder[] = [];
let playlists: Playlist[] = [];
let deletedTracks: DeletedTrack[] = [];
let activeCollection = "all";
let libraryQuery = "";
let librarySort = "newest";
let pendingCoverPath: string | null = null;
let playMode: "list" | "repeat" | "shuffle" = "list";
let editingFolderId: string | null = null;
let playlistPickerTrackId: string | null = null;
const selectedLibraryIds = new Set<string>();
let settings: AppSettings = {
  confirmedAuthorized: false,
  trashRetentionDays: 30,
  onboardingCompleted: false
};
let selectedTrack: Track | null = null;
let playingTrack: Track | null = null;
let playbackOrder: string[] = [];
let pendingRestoreTime = 0;
let lastPersistedSecond = -1;
let toastTimer = 0;
let syncTexts: string[] = [];
let syncTimes: number[] = [];
let syncIndex = 0;
let syncStarted = false;
let reviewLines: LyricLine[] = [];
let reviewIndex = -1;
let lyricsManualScrollUntil = 0;
interface DraftSegment extends AudioSegment { id: string }
let draftSegments: DraftSegment[] = [];
let selectedDraftId = "";
let splitMetadataInitialized = false;
let splitHistory: DraftSegment[][] = [];
let splitFuture: DraftSegment[][] = [];
let splitDirty = false;
let previewSelectedOnly = false;
let playNextQueue: string[] = [];
interface ViewHistoryEntry { name: string; collection?: string }
let viewHistory: ViewHistoryEntry[] = [];
let viewHistoryIndex = -1;
const libraryScrollPositions = new Map<string, number>();
let songInfoReturnFocus: HTMLElement | null = null;
interface UiTask {
  id: string;
  title: string;
  message: string;
  status: string;
  time: string;
  detail?: string;
  percent?: number;
}
let taskHistory: UiTask[] = [];

function persistTaskHistory(): void {
  localStorage.setItem("linkAudioTasks", JSON.stringify(taskHistory.slice(0, 20)));
}

function loadTaskHistory(): void {
  try {
    const stored = JSON.parse(localStorage.getItem("linkAudioTasks") || "[]") as UiTask[];
    taskHistory = stored.slice(0, 20).map((task) => task.status === "running"
      ? { ...task, status: "error", message: "应用在任务完成前关闭，请重新提交任务。" }
      : task);
  } catch {
    taskHistory = [];
  }
}

function renderTaskHistory(): void {
  const container = byId("task-history");
  container.replaceChildren();
  byId("active-downloads-card").classList.toggle("hidden", !taskHistory.length);
  for (const task of taskHistory.slice(0, 20)) {
    const row = document.createElement("div");
    row.className = "task-row";
    row.style.setProperty("--task-progress", `${Math.max(0, Math.min(100, task.percent || 0))}%`);
    row.classList.toggle("task-running", task.status === "running");
    row.classList.toggle("task-complete", task.status === "complete");
    row.classList.toggle("task-error", task.status === "error");
    const content = document.createElement("div");
    const summary = document.createElement("span");
    summary.textContent = `${task.status === "error" ? "失败" : task.status === "complete" ? "完成" : "进行中"} · ${task.title || task.message}`;
    const message = document.createElement("small");
    message.textContent = task.message;
    const progress = document.createElement("div");
    progress.className = "task-progress";
    const bar = document.createElement("div");
    bar.style.width = `${Math.max(0, Math.min(100, task.percent || 0))}%`;
    progress.append(bar);
    content.append(summary, message, progress);
    const time = document.createElement("small");
    time.textContent = new Date(task.time).toLocaleString();
    row.title = task.detail || task.message;
    row.append(content, time);
    container.append(row);
  }
}

function recordTask(
  message: string,
  status: "running" | "complete" | "error",
  detail?: string,
  id: string = crypto.randomUUID(),
  title = "后台任务",
  percent?: number
): void {
  const existing = taskHistory.find((task) => task.id === id);
  if (existing) {
    existing.message = message;
    existing.status = status;
    existing.detail = detail || existing.detail;
    existing.title = title || existing.title;
    existing.percent = percent ?? existing.percent;
    existing.time = new Date().toISOString();
  } else {
    taskHistory.unshift({
      id, title, message, status, detail, percent, time: new Date().toISOString()
    });
  }
  taskHistory = taskHistory.slice(0, 20);
  persistTaskHistory();
  renderTaskHistory();
}

function showStatus(message: string, kind: "working" | "success" | "error" = "working"): void {
  status.classList.remove("hidden", "success", "error");
  status.classList.add(kind);
  statusText.textContent = message;
  if (!byId("import-view").classList.contains("active")) {
    const toast = byId("app-toast");
    toast.textContent = message;
    toast.className = `app-toast ${kind}`;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.add("hidden"), kind === "error" ? 6000 : 3200);
  }
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();
}

function showConfirm(title: string, message: string, confirmText = "确认"): Promise<boolean> {
  const modal = byId("confirm-modal");
  byId("confirm-title").textContent = title;
  byId("confirm-message").textContent = message;
  byId<HTMLButtonElement>("confirm-ok").textContent = confirmText;
  modal.classList.remove("hidden");
  byId<HTMLButtonElement>("confirm-cancel").focus();
  return new Promise<boolean>((resolve) => {
    function cleanup(result: boolean): void {
      modal.classList.add("hidden");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      modal.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKey);
      resolve(result);
    }
    function onOk(): void { cleanup(true); }
    function onCancel(): void { cleanup(false); }
    function onBackdrop(e: MouseEvent): void { if (e.target === modal) cleanup(false); }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") cleanup(false);
      if (e.key === "Enter") cleanup(true);
    }
    const okBtn = byId<HTMLButtonElement>("confirm-ok");
    const cancelBtn = byId<HTMLButtonElement>("confirm-cancel");
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    modal.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey);
  });
}

function setPlayerControlsEnabled(enabled: boolean): void {
  for (const id of ["player-previous", "player-toggle", "player-next", "player-lyrics-open"]) {
    byId<HTMLButtonElement>(id).disabled = !enabled;
  }
  playerSeek.disabled = !enabled;
  byId("player").classList.toggle("empty-player", !enabled);
  document.querySelector<HTMLElement>(".now-playing")!
    .setAttribute("aria-disabled", String(!enabled));
}

function updatePlaybackVisualState(): void {
  const isPlaying = !audio.paused && Boolean(audio.src);
  const detailMatchesPlayingTrack = Boolean(
    selectedTrack && playingTrack?.id === selectedTrack.id
  );
  document.body.classList.toggle("is-playing", isPlaying);
  byId("detail-view").classList.toggle(
    "playing",
    isPlaying && detailMatchesPlayingTrack
  );
  const detailPlay = byId<HTMLButtonElement>("detail-play");
  const detailIsPlaying = isPlaying && detailMatchesPlayingTrack;
  detailPlay.textContent = detailIsPlaying ? "Ⅱ 暂停" : "▶ 播放";
  detailPlay.setAttribute("aria-label", detailIsPlaying ? "暂停当前歌曲" : "播放当前歌曲");
}

function reportPlaybackError(error?: unknown): void {
  const detail = error ? friendlyError(error) : "";
  byId("player").classList.add("has-error");
  byId("player-author").textContent = detail
    ? `播放失败：${detail}`
    : "播放失败，请检查文件是否存在或格式是否受支持";
  byId("player-toggle").setAttribute("aria-label", "重新播放");
  updatePlaybackVisualState();
}

function resumeAudio(): void {
  if (!audio.src) {
    setPlayerControlsEnabled(false);
    byId("player-author").textContent = "请先从音乐库选择一首歌曲";
    return;
  }
  void audio.play().catch(reportPlaybackError);
}

function stopPlayback(): void {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  playingTrack = null;
  playbackOrder = [];
  playNextQueue = [];
  byId("player-title").textContent = "暂未播放歌曲";
  byId("player-author").textContent = "从音乐库选择一首歌曲";
  byId("player-cover").removeAttribute("src");
  byId("player-current").textContent = "00:00";
  byId("player-duration").textContent = "00:00";
  playerSeek.value = "0";
  byId("player").classList.remove("has-error");
  localStorage.removeItem("linkAudioLastTrackId");
  localStorage.removeItem("linkAudioLastPosition");
  setPlayerControlsEnabled(false);
  updatePlaybackVisualState();
  renderQueuePanel();
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "时长未知";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

function formatPlayerTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "00:00";
  const minutes = Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, "0");
  const rest = Math.floor(Math.max(0, seconds) % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

function displayTitle(value: string, maxLength = Number.POSITIVE_INFINITY): string {
  const normalized = value.trim();
  const characters = Array.from(normalized);
  return characters.length > maxLength ? `${characters.slice(0, maxLength).join("")}…` : normalized;
}

function displayArtist(value: string | null | undefined): string {
  const normalized = value?.trim();
  return !normalized || normalized === "未知作者" ? "未知歌手" : normalized;
}

function showPreview(preview: MediaPreview): void {
  const cover = byId<HTMLImageElement>("preview-cover");
  if (preview.thumbnail) {
    cover.src = preview.thumbnail;
    cover.classList.remove("no-cover");
  } else {
    cover.removeAttribute("src");
    cover.classList.add("no-cover");
  }
  byId("preview-platform").textContent = preview.platform === "local" ? "本地音频" : "哔哩哔哩";
  byId("preview-title").textContent = preview.title;
  byId("preview-meta").textContent = `${displayArtist(preview.author)} · ${formatDuration(preview.duration)}`;
  previewCard.classList.remove("hidden");
}

async function importAudio(): Promise<void> {
  const rawInput = input.value.trim();
  if (!rawInput) {
    showStatus("请先粘贴链接。", "error");
    input.focus();
    return;
  }
  if (!settings.confirmedAuthorized) {
    showView("settings");
    const settingsStatus = byId("settings-status");
    settingsStatus.classList.remove("hidden", "success");
    settingsStatus.classList.add("error");
    byId("settings-status-text").textContent = "请先完成合法使用确认。";
    return;
  }
  const foundUrls = rawInput.match(/https?:\/\/[^\s]+/g);
  const requests = [...new Set(foundUrls?.length ? foundUrls : [rawInput])];
  input.value = "";
  importButton.disabled = true;
  showStatus(`已提交 ${requests.length} 个下载任务，可以继续添加链接。`);
  await Promise.allSettled(requests.map(async (requestedInput) => {
    const taskId = crypto.randomUUID();
    recordTask("等待读取链接信息…", "running", undefined, taskId, requestedInput, 0);
    try {
      const track = await window.linkAudio.importAudio({ input: requestedInput, taskId });
      showPreview(track);
    } catch (error) {
      recordTask("导入音频失败", "error", friendlyError(error), taskId, requestedInput);
    }
  }));
  tracks = await window.linkAudio.listTracks();
  renderLibrary();
  const failed = taskHistory.filter((task) =>
    requests.includes(task.title) && task.status === "error").length;
  showStatus(
    failed ? `${requests.length - failed} 个完成，${failed} 个失败；可在本页任务记录中查看。`
      : `${requests.length} 个下载任务全部完成。`,
    failed ? "error" : "success"
  );
}

async function importLocalAudio(): Promise<void> {
  try {
    const imported = await window.linkAudio.importLocalAudio();
    await finishLocalImport(imported);
  } catch (error) {
    showStatus(friendlyError(error), "error");
  }
}

async function importLocalFolder(): Promise<void> {
  try {
    await finishLocalImport(await window.linkAudio.importLocalFolder());
  } catch (error) {
    showStatus(friendlyError(error), "error");
  }
}

async function finishLocalImport(imported: Track[]): Promise<void> {
  if (!imported.length) return;
  tracks = await window.linkAudio.listTracks();
  showView("library", "all");
  renderLibrary();
  showStatus(`已导入 ${imported.length} 首本地音频。`, "success");
}

async function importDroppedAudio(files: FileList): Promise<void> {
  const supported = /\.(mp3|m4a|aac|wav|flac|ogg|opus|webm)$/i;
  const paths = [...files]
    .filter((file) => supported.test(file.name))
    .map((file) => window.linkAudio.getPathForFile(file))
    .filter(Boolean);
  if (!paths.length) {
    showStatus("拖入的文件中没有受支持的音频格式。", "error");
    return;
  }
  try {
    await finishLocalImport(await window.linkAudio.importLocalPaths(paths));
  } catch (error) {
    showStatus(friendlyError(error), "error");
  }
}

function renderSettings(): void {
  byId<HTMLInputElement>("settings-authorization").checked = settings.confirmedAuthorized;
  byId<HTMLInputElement>("settings-trash-days").value = String(settings.trashRetentionDays);
  byId<HTMLSelectElement>("settings-play-mode").value = settings.defaultPlayMode || "list";
  byId<HTMLInputElement>("settings-remember-volume").checked = settings.rememberVolume !== false;
  byId<HTMLSelectElement>("settings-default-sort").value = settings.defaultSort || "newest";
  byId<HTMLInputElement>("settings-show-source").checked = settings.showSourceColumn !== false;
  byId<HTMLSelectElement>("settings-theme").value = settings.theme || "light";
}

async function saveSettings(): Promise<void> {
  const settingsStatus = byId("settings-status");
  if (!byId<HTMLInputElement>("settings-authorization").checked) {
    settingsStatus.classList.remove("hidden", "success");
    settingsStatus.classList.add("error");
    byId("settings-status-text").textContent = "请先确认你有权保存和处理这些内容。";
    return;
  }
  const trashRetentionDays = Number(byId<HTMLInputElement>("settings-trash-days").value);
  if (!Number.isFinite(trashRetentionDays) || trashRetentionDays < 0 || trashRetentionDays > 3650) {
    settingsStatus.classList.remove("hidden", "success");
    settingsStatus.classList.add("error");
    byId("settings-status-text").textContent = "回收站保留天数应为 0 到 3650 之间的数字。";
    return;
  }
  settings = await window.linkAudio.saveSettings({
    ...settings,
    confirmedAuthorized: true,
    trashRetentionDays,
    onboardingCompleted: true,
    theme: byId<HTMLSelectElement>("settings-theme").value as "light" | "dark"
  });
  applyTheme();
  settingsStatus.classList.remove("hidden", "error");
  settingsStatus.classList.add("success");
  byId("settings-status-text").textContent = "设置已保存在本机。";
}

function applyPlayModeSetting(): void {
  const mode = settings.defaultPlayMode || "list";
  playMode = mode;
  const labels: Record<string, string> = { list: "列表循环", repeat: "单曲循环", shuffle: "随机播放" };
  byId("player-mode").textContent = labels[mode] || "列表循环";
}

function applyLibrarySettings(): void {
  librarySort = settings.defaultSort || "newest";
  byId<HTMLSelectElement>("library-sort").value = librarySort;
  const sourceCol = document.querySelectorAll<HTMLElement>(".track-source, .track-list-header > span:nth-child(6)");
  sourceCol.forEach((el) => { el.style.display = settings.showSourceColumn === false ? "none" : ""; });
}

function applyTheme(): void {
  const theme = settings.theme || "light";
  document.documentElement.setAttribute("data-theme", theme);
  byId<HTMLSelectElement>("settings-theme").value = theme;
}

function getPlayableCollectionTracks(): Track[] {
  return selectCollectionTracks({
    tracks,
    folders,
    playlists,
    activeCollection,
    query: libraryQuery,
    sort: librarySort
  });
}

function loadPlayerTrack(track: Track): void {
  selectedTrack = track;
  playingTrack = track;
  byId("player-title").textContent = displayTitle(track.title);
  byId("player-title").title = track.title;
  byId("player-author").textContent = displayArtist(track.author);
  const playerCover = byId<HTMLImageElement>("player-cover");
  if (track.thumbnail) playerCover.src = track.thumbnail;
  else playerCover.removeAttribute("src");
  if (audio.src !== track.fileUrl) audio.src = track.fileUrl;
  byId("player").classList.remove("hidden", "has-error");
  setPlayerControlsEnabled(true);
  localStorage.setItem("linkAudioLastTrackId", track.id);
  if (byId("detail-view").classList.contains("active")) {
    openDetail(track);
  }
}

function play(track: Track, resetPlaybackContext = false): void {
  if (resetPlaybackContext) {
    playbackOrder = getPlayableCollectionTracks().map((item) => item.id);
  }
  if (!playbackOrder.includes(track.id)) {
    playbackOrder = [track.id, ...playbackOrder.filter((id) => id !== track.id)];
  }
  loadPlayerTrack(track);
  renderQueuePanel();
  if (byId("library-view").classList.contains("active")) renderLibrary();
  resumeAudio();
}

function playRelative(direction: -1 | 1): void {
  if (direction === 1 && playNextQueue.length) {
    const queued = tracks.find((track) => track.id === playNextQueue.shift());
    if (queued) {
      play(queued);
      return;
    }
  }
  const queue = playbackOrder
    .map((id) => tracks.find((track) => track.id === id))
    .filter((item): item is Track => Boolean(item));
  if (!queue.length) return;
  const currentIndex = playingTrack
    ? queue.findIndex((track) => track.id === playingTrack!.id)
    : -1;
  let nextIndex: number;
  if (playMode === "shuffle" && queue.length > 1) {
    do nextIndex = Math.floor(Math.random() * queue.length);
    while (nextIndex === currentIndex);
  } else {
    nextIndex = (currentIndex + direction + queue.length) % queue.length;
  }
  play(queue[nextIndex]);
}

function cyclePlayMode(): void {
  playMode = playMode === "list" ? "repeat" : playMode === "repeat" ? "shuffle" : "list";
  byId("player-mode").textContent =
    playMode === "list" ? "列表循环" : playMode === "repeat" ? "单曲循环" : "随机播放";
  localStorage.setItem("linkAudioPlayMode", playMode);
}

function renderQueuePanel(): void {
  const container = byId("play-queue-list");
  const orderedTracks = playbackOrder
    .map((id) => tracks.find((track) => track.id === id))
    .filter((track): track is Track => Boolean(track));
  const currentIndex = playingTrack
    ? orderedTracks.findIndex((track) => track.id === playingTrack!.id)
    : -1;
  const upcoming = currentIndex >= 0
    ? [...orderedTracks.slice(currentIndex + 1), ...orderedTracks.slice(0, currentIndex)]
    : orderedTracks;
  const explicitNext = playNextQueue
    .map((id) => tracks.find((track) => track.id === id))
    .filter((track): track is Track => Boolean(track));
  const seen = new Set<string>();
  const queue = [playingTrack, ...explicitNext, ...upcoming]
    .filter((track): track is Track => Boolean(track))
    .filter((track) => {
      if (seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    });
  container.replaceChildren();
  byId("play-queue-count").textContent = `${queue.length} 首`;
  byId("play-queue-empty").classList.toggle("hidden", queue.length > 0);
  const clearQueue = byId<HTMLButtonElement>("play-queue-clear");
  clearQueue.disabled = queue.every((track) => track.id === playingTrack?.id);
  clearQueue.title = clearQueue.disabled ? "当前没有待播歌曲" : "清除当前歌曲之后的待播歌曲";
  queue.forEach((track, index) => {
    const row = document.createElement("div");
    row.className = `queue-row${index === 0 && playingTrack?.id === track.id ? " playing" : ""}`;
    row.draggable = track.id !== playingTrack?.id;
    row.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/linkaudio-queue-track-id", track.id);
    });
    if (track.id !== playingTrack?.id) {
      row.addEventListener("dragover", (event) => event.preventDefault());
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        const movingId = event.dataTransfer?.getData("text/linkaudio-queue-track-id");
        if (!movingId || movingId === track.id) return;
        const reordered = queue.map((item) => item.id).filter((id) => id !== movingId);
        reordered.splice(Math.max(1, reordered.indexOf(track.id)), 0, movingId);
        playbackOrder = reordered;
        playNextQueue = [];
        renderQueuePanel();
      });
    }
    const marker = document.createElement("span");
    marker.className = "queue-marker";
    marker.textContent = index === 0 && playingTrack?.id === track.id ? "≋" : "⋮⋮";
    const copy = document.createElement("button");
    copy.className = "queue-copy";
    const title = document.createElement("strong");
    title.textContent = displayTitle(track.title);
    title.title = track.title;
    const meta = document.createElement("small");
    meta.textContent = displayArtist(track.author);
    copy.append(title, meta);
    copy.addEventListener("click", () => play(track));
    const duration = document.createElement("time");
    duration.textContent = formatDuration(track.duration);
    const removeButton = document.createElement("button");
    removeButton.className = "queue-remove";
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", `从队列移除 ${track.title}`);
    removeButton.disabled = track.id === playingTrack?.id;
    removeButton.addEventListener("click", () => {
      playNextQueue = playNextQueue.filter((id) => id !== track.id);
      playbackOrder = playbackOrder.filter((id) => id !== track.id);
      renderQueuePanel();
    });
    row.append(marker, copy, duration, removeButton);
    container.append(row);
  });
  localStorage.setItem("linkAudioPlaybackOrder", JSON.stringify(playbackOrder));
  localStorage.setItem("linkAudioPlayNextQueue", JSON.stringify(playNextQueue));
}

function openDetail(track: Track): void {
  selectedTrack = track;
  const cover = byId<HTMLImageElement>("detail-cover");
  const lyricsCover = byId<HTMLImageElement>("lyrics-cover");
  if (track.thumbnail) {
    cover.src = track.thumbnail;
    cover.classList.remove("no-cover");
    lyricsCover.src = track.thumbnail;
    lyricsCover.classList.remove("no-cover");
  } else {
    cover.removeAttribute("src");
    cover.classList.add("no-cover");
    lyricsCover.removeAttribute("src");
    lyricsCover.classList.add("no-cover");
  }
  byId("detail-title").textContent = track.title;
  byId("detail-title").title = track.title;
  byId("lyrics-song-title").textContent = displayTitle(track.title, 28);
  byId("lyrics-song-title").title = track.title;
  byId("lyrics-song-author").textContent = displayArtist(track.author);
  byId("detail-source").textContent = track.platform === "local" ? "本地音乐" : "哔哩哔哩";
  byId("detail-meta").textContent = `${displayArtist(track.author)} · ${formatDuration(track.duration)}`;
  byId("song-info-title").textContent = track.title;
  byId("song-info-author").textContent = displayArtist(track.author);
  byId("song-info-source").textContent = track.platform === "local" ? "本地音乐" : "哔哩哔哩";
  byId("song-info-duration").textContent = formatDuration(track.duration);
  byId("edit-lyrics").textContent = track.lyrics ? "编辑歌词" : "添加歌词";
  const exportLrc = byId<HTMLButtonElement>("export-lrc");
  exportLrc.disabled = !track.lyrics?.lines.length;
  exportLrc.title = exportLrc.disabled ? "这首歌曲还没有可导出的歌词" : "";
  const wasShowingLyrics = document.body.classList.contains("showing-lyrics");
  if (!wasShowingLyrics) {
    document.body.classList.remove("showing-lyrics");
  }
  byId("song-info-panel").classList.add("hidden");
  byId("song-info-toggle").setAttribute("aria-expanded", "false");
  songInfoReturnFocus = null;
  byId("detail-more-menu").classList.add("hidden");
  renderLyrics(track);
  showView("detail");
  updatePlaybackVisualState();
}

function applyUpdatedTrack(updated: Track): void {
  tracks = tracks.map((track) => track.id === updated.id ? updated : track);
  if (selectedTrack?.id === updated.id) selectedTrack = updated;
  if (playingTrack?.id === updated.id) {
    playingTrack = updated;
    byId("player-title").textContent = displayTitle(updated.title);
    byId("player-title").title = updated.title;
    byId("player-author").textContent = displayArtist(updated.author);
    const cover = byId<HTMLImageElement>("player-cover");
    if (updated.thumbnail) cover.src = updated.thumbnail;
    else cover.removeAttribute("src");
  }
}

function replaceTrack(updated: Track): void {
  applyUpdatedTrack(updated);
  renderLibrary();
  openDetail(updated);
}

function renderFolderOptions(): void {
  const container = byId("track-folder-options");
  container.replaceChildren();
  for (const folder of folders) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = folder.id;
    checkbox.checked = selectedTrack?.folderIds.includes(folder.id) || false;
    label.append(checkbox, document.createTextNode(folder.name));
    container.append(label);
  }
  if (!folders.length) container.textContent = "还没有自定义文件夹";
}

function openTrackEditor(): void {
  if (!selectedTrack) return;
  byId<HTMLInputElement>("track-title-input").value = selectedTrack.title;
  byId<HTMLInputElement>("track-author-input").value = selectedTrack.author;
  byId<HTMLInputElement>("track-favorite-input").checked = selectedTrack.favorite;
  pendingCoverPath = null;
  byId("cover-crop-controls").classList.add("hidden");
  byId<HTMLInputElement>("cover-zoom").value = "1";
  byId<HTMLInputElement>("cover-x").value = "0";
  byId<HTMLInputElement>("cover-y").value = "0";
  const cover = byId<HTMLImageElement>("track-cover-preview");
  cover.style.transform = "";
  if (selectedTrack.thumbnail) cover.src = selectedTrack.thumbnail;
  else cover.removeAttribute("src");
  renderFolderOptions();
  byId("track-editor-error").classList.add("hidden");
  byId("track-editor-modal").classList.remove("hidden");
}

async function saveTrackEditor(): Promise<void> {
  if (!selectedTrack) return;
  const checked = [...byId("track-folder-options").querySelectorAll<HTMLInputElement>("input:checked")]
    .map((input) => input.value);
  try {
    if (pendingCoverPath && !byId("cover-crop-controls").classList.contains("hidden")) {
      const image = byId<HTMLImageElement>("track-cover-preview");
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 600;
      canvas.height = 600;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("无法处理封面图片。");
      const zoom = Number(byId<HTMLInputElement>("cover-zoom").value);
      const scale = Math.max(600 / image.naturalWidth, 600 / image.naturalHeight) * zoom;
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      const xRange = Math.max(0, width - 600) / 2;
      const yRange = Math.max(0, height - 600) / 2;
      const x = (600 - width) / 2 +
        xRange * Number(byId<HTMLInputElement>("cover-x").value) / 100;
      const y = (600 - height) / 2 +
        yRange * Number(byId<HTMLInputElement>("cover-y").value) / 100;
      context.drawImage(image, x, y, width, height);
      pendingCoverPath = (await window.linkAudio.saveCroppedCover(
        canvas.toDataURL("image/png")
      )).sourcePath;
    }
    const updated = await window.linkAudio.updateTrack(selectedTrack.id, {
      title: byId<HTMLInputElement>("track-title-input").value,
      author: byId<HTMLInputElement>("track-author-input").value,
      favorite: byId<HTMLInputElement>("track-favorite-input").checked,
      folderIds: checked,
      coverSourcePath: pendingCoverPath
    });
    byId("track-editor-modal").classList.add("hidden");
    replaceTrack(updated);
  } catch (error) {
    const message = byId("track-editor-error");
    message.textContent = friendlyError(error);
    message.classList.remove("hidden");
  }
}

function draftId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function splitDuration(): number {
  return audio.duration || selectedTrack?.duration || 0;
}

function cloneDrafts(value = draftSegments): DraftSegment[] {
  return value.map((segment) => ({ ...segment }));
}

function rememberSplitState(): void {
  splitHistory.push(cloneDrafts());
  if (splitHistory.length > 100) splitHistory.shift();
  splitFuture = [];
  splitDirty = true;
}

function undoSplit(): void {
  const previous = splitHistory.pop();
  if (!previous) return;
  splitFuture.push(cloneDrafts());
  draftSegments = previous;
  selectedDraftId = draftSegments[0]?.id || "";
  renderDraftTimeline();
}

function redoSplit(): void {
  const next = splitFuture.pop();
  if (!next) return;
  splitHistory.push(cloneDrafts());
  draftSegments = next;
  selectedDraftId = draftSegments[0]?.id || "";
  renderDraftTimeline();
}

async function drawWaveform(): Promise<void> {
  if (!selectedTrack) return;
  const canvas = byId<HTMLCanvasElement>("waveform-canvas");
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#eeebe4";
  context.fillRect(0, 0, canvas.width, canvas.height);
  try {
    const response = await fetch(selectedTrack.fileUrl);
    const data = await response.arrayBuffer();
    const audioContext = new AudioContext();
    const buffer = await audioContext.decodeAudioData(data);
    const channel = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(channel.length / canvas.width));
    context.strokeStyle = "#667421";
    context.lineWidth = 1;
    context.beginPath();
    for (let x = 0; x < canvas.width; x += 1) {
      let minimum = 1;
      let maximum = -1;
      const start = x * step;
      for (let offset = 0; offset < step; offset += 1) {
        const sample = channel[start + offset] || 0;
        minimum = Math.min(minimum, sample);
        maximum = Math.max(maximum, sample);
      }
      context.moveTo(x, (1 + minimum) * canvas.height / 2);
      context.lineTo(x, (1 + maximum) * canvas.height / 2);
    }
    context.stroke();
    await audioContext.close();
  } catch {
    context.fillStyle = "#8a8378";
    context.font = "14px sans-serif";
    context.fillText("无法生成波形，仍可使用时间轴裁切", 20, 65);
  }
}

function renderDraftTimeline(): void {
  const duration = splitDuration();
  const container = byId("timeline-segments");
  container.replaceChildren();
  for (const [index, segment] of draftSegments.entries()) {
    const button = document.createElement("button");
    button.className = "timeline-segment";
    button.classList.toggle("selected", segment.id === selectedDraftId);
    button.style.left = `${(segment.start / duration) * 100}%`;
    button.style.width = `${((segment.end - segment.start) / duration) * 100}%`;
    button.innerHTML = `<strong>${index + 1}</strong><span>${formatSyncTime(segment.end - segment.start)}</span>`;
    button.title = `${formatSyncTime(segment.start)} — ${formatSyncTime(segment.end)}`;
    button.addEventListener("click", () => {
      selectedDraftId = segment.id;
      audio.currentTime = segment.start;
      previewSelectedOnly = true;
      renderDraftTimeline();
    });
    container.append(button);
  }
  const selected = draftSegments.find((segment) => segment.id === selectedDraftId);
  byId("selected-segment-range").textContent = selected
    ? `${formatSyncTime(selected.start)} — ${formatSyncTime(selected.end)}`
    : "未选择";
  byId<HTMLButtonElement>("delete-segment").disabled = !selected;
  byId<HTMLButtonElement>("split-undo").disabled = splitHistory.length === 0;
  byId<HTMLButtonElement>("split-redo").disabled = splitFuture.length === 0;
  byId<HTMLInputElement>("playhead-time-input").value = audio.currentTime.toFixed(2);
}

function splitAtPlayhead(): void {
  const errorElement = byId("split-error");
  const position = audio.currentTime;
  const index = draftSegments.findIndex((segment) =>
    position > segment.start + 0.05 && position < segment.end - 0.05);
  if (index < 0) {
    errorElement.textContent = "请把播放头移动到某个片段内部再切开。";
    errorElement.classList.remove("hidden");
    return;
  }
  rememberSplitState();
  const source = draftSegments[index];
  const left: DraftSegment = { ...source, id: draftId(), end: position };
  const right: DraftSegment = { ...source, id: draftId(), start: position };
  draftSegments.splice(index, 1, left, right);
  selectedDraftId = right.id;
  errorElement.classList.add("hidden");
  renderDraftTimeline();
}

function deleteSelectedDraft(): void {
  const errorElement = byId("split-error");
  if (!selectedDraftId) return;
  rememberSplitState();
  draftSegments = draftSegments.filter((segment) => segment.id !== selectedDraftId);
  selectedDraftId = draftSegments[0]?.id || "";
  if (!draftSegments.length) {
    errorElement.textContent = "所有片段都已删除。可以取消后重新开始，或返回原音频。";
    errorElement.classList.remove("hidden");
  } else {
    errorElement.classList.add("hidden");
  }
  renderDraftTimeline();
}

function openSplitEditor(): void {
  if (!selectedTrack) return;
  play(selectedTrack);
  audio.pause();
  const duration = splitDuration();
  draftSegments = [{
    id: draftId(),
    start: 0,
    end: duration,
    title: selectedTrack.title,
    author: selectedTrack.author
  }];
  selectedDraftId = draftSegments[0].id;
  splitMetadataInitialized = false;
  splitHistory = [];
  splitFuture = [];
  splitDirty = false;
  previewSelectedOnly = false;
  byId<HTMLInputElement>("split-preview-seek").max = String(duration);
  byId("split-total-time").textContent = formatSyncTime(duration);
  byId("split-timeline-step").classList.remove("hidden");
  byId("split-metadata-step").classList.add("hidden");
  byId("split-error").classList.add("hidden");
  byId("split-modal").classList.remove("hidden");
  renderDraftTimeline();
  void drawWaveform();
}

function openSegmentMetadata(): void {
  if (!selectedTrack || !draftSegments.length) {
    const errorElement = byId("split-error");
    errorElement.textContent = "请至少保留一个片段。";
    errorElement.classList.remove("hidden");
    return;
  }
  audio.pause();
  const container = byId("segment-metadata-list");
  container.replaceChildren();
  for (const [index, segment] of draftSegments.entries()) {
    if (!splitMetadataInitialized) {
      segment.title = draftSegments.length === 1
        ? selectedTrack.title
        : `${selectedTrack.title} ${index + 1}`;
      segment.author = selectedTrack.author;
    }
    const card = document.createElement("article");
    card.className = "segment-metadata-card";
    const cover = document.createElement("img");
    cover.alt = "";
    if (selectedTrack.thumbnail) cover.src = selectedTrack.thumbnail;
    const fields = document.createElement("div");
    fields.innerHTML = `
      <small>片段 ${index + 1} · ${formatSyncTime(segment.start)} — ${formatSyncTime(segment.end)}</small>
      <label>名称<input data-field="title" data-index="${index}" value=""></label>
      <label>歌手<input data-field="author" data-index="${index}" value=""></label>`;
    fields.querySelector<HTMLInputElement>('[data-field="title"]')!.value = segment.title;
    fields.querySelector<HTMLInputElement>('[data-field="author"]')!.value = segment.author || "";
    card.append(cover, fields);
    container.append(card);
  }
  splitMetadataInitialized = true;
  byId("split-metadata-error").classList.add("hidden");
  byId("split-timeline-step").classList.add("hidden");
  byId("split-metadata-step").classList.remove("hidden");
}

async function saveSplit(): Promise<void> {
  if (!selectedTrack) return;
  const errorElement = byId("split-metadata-error");
  const saveButton = byId<HTMLButtonElement>("split-save");
  try {
    const segments = draftSegments.map((segment, index) => ({
      start: segment.start,
      end: segment.end,
      title: byId("segment-metadata-list")
        .querySelector<HTMLInputElement>(`[data-field="title"][data-index="${index}"]`)!.value.trim(),
      author: byId("segment-metadata-list")
        .querySelector<HTMLInputElement>(`[data-field="author"][data-index="${index}"]`)!.value.trim(),
      mode: byId<HTMLSelectElement>("split-quality").value as "accurate" | "fast"
    }));
    if (segments.some((segment) => !segment.title)) throw new Error("每个片段都需要填写名称。");
    saveButton.disabled = true;
    saveButton.textContent = "正在生成…";
    byId("split-cancel-task").classList.remove("hidden");
    byId("split-task-status").classList.remove("hidden");
    const created = await window.linkAudio.splitTrack(selectedTrack.id, segments);
    tracks = await window.linkAudio.listTracks();
    renderLibrary();
    byId("split-modal").classList.add("hidden");
    splitDirty = false;
    if (created[0]) openDetail(created[0]);
  } catch (error) {
    errorElement.textContent = friendlyError(error);
    errorElement.classList.remove("hidden");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "确认并生成全部片段";
    byId("split-cancel-task").classList.add("hidden");
    if (!byId("split-modal").classList.contains("hidden")) {
      byId("split-task-status").classList.add("hidden");
    }
  }
}

function renderLyrics(track: Track): void {
  const container = byId("lyrics-lines");
  const empty = byId("lyrics-empty");
  container.replaceChildren();
  const lines = track.lyrics?.lines || [];
  empty.classList.toggle("hidden", lines.length > 0);
  container.classList.toggle("hidden", lines.length === 0);
  for (const [index, line] of lines.entries()) {
    const element = document.createElement("p");
    element.className = "lyric-line";
    if (line.confidence !== undefined && line.confidence < 0.6) {
      element.classList.add("low-confidence");
    }
    element.dataset.index = String(index);
    element.textContent = line.text;
    element.addEventListener("click", () => {
      if (!selectedTrack) return;
      const sameTrack = audio.src === selectedTrack.fileUrl;
      play(selectedTrack);
      const previewTime = line.start;
      if (sameTrack || audio.readyState > 0) audio.currentTime = previewTime;
      else audio.addEventListener("loadedmetadata", () => { audio.currentTime = previewTime; }, { once: true });
    });
    container.append(element);
  }
}

function cleanLyrics(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line
      .replace(/\[(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.:]\d+)?\]/g, "")
      .replace(/^\s*\d+[.、)]\s*/, "")
      .trim())
    .filter(Boolean);
}

function updateLineCount(): void {
  const count = cleanLyrics(byId<HTMLTextAreaElement>("lyrics-input").value).length;
  byId("line-count").textContent = `${count} 行歌词`;
  byId<HTMLButtonElement>("ai-align").disabled = count === 0;
  byId<HTMLButtonElement>("start-sync").disabled = count === 0;
}

function lyricsVersionKey(trackId: string): string {
  return `linkAudioLyricsPrevious:${trackId}`;
}

function rememberLyricsVersion(track: Track): void {
  if (!track.lyrics) return;
  localStorage.setItem(lyricsVersionKey(track.id), JSON.stringify(track.lyrics));
}

function updateLyricsWorkbenchStep(step: "text" | "match" | "review"): void {
  byId("lyrics-step-text").classList.toggle("active", step === "text");
  byId("lyrics-step-match").classList.toggle("active", step === "match");
  byId("lyrics-step-review").classList.toggle("active", step === "review");
}

function openLyricsModal(): void {
  if (!selectedTrack) return;
  const existing = selectedTrack.lyrics?.lines.map((line) => line.text).join("\n") || "";
  byId<HTMLTextAreaElement>("lyrics-input").value = existing;
  byId("lyrics-workbench-title").textContent = selectedTrack.title;
  byId("lyrics-modal").classList.remove("hidden");
  byId("ai-status").classList.add("hidden");
  byId("restore-lyrics-version").classList.toggle(
    "hidden",
    !localStorage.getItem(lyricsVersionKey(selectedTrack.id))
  );

  // An AI timeline is already persisted on the track. Reopen that timeline
  // instead of resetting the button and making the user run recognition again.
  if (selectedTrack.lyrics?.source === "ai" && selectedTrack.lyrics.lines.length) {
    openAiReview();
    return;
  }

  byId("paste-step").classList.remove("hidden");
  byId("sync-step").classList.add("hidden");
  byId("review-step").classList.add("hidden");
  updateLyricsWorkbenchStep("text");
  const aiButton = byId<HTMLButtonElement>("ai-align");
  aiButton.dataset.completed = "false";
  aiButton.textContent = "AI 自动匹配";
  updateLineCount();
  requestAnimationFrame(() => byId<HTMLTextAreaElement>("lyrics-input").focus());
}

function closeLyricsModal(): void {
  byId("lyrics-modal").classList.add("hidden");
}

function updateAiProgress(message: string, percent?: number, error = false): void {
  const status = byId("ai-status");
  status.classList.toggle("error", error);
  byId("ai-status-text").textContent = message;
  if (typeof percent === "number") {
    const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
    byId("ai-progress-percent").textContent = `${safePercent}%`;
    byId<HTMLElement>("ai-progress-bar").style.width = `${safePercent}%`;
  }
}

function clampReviewStart(index: number, value: number): number {
  const previous = index > 0 ? reviewLines[index - 1].start + 0.05 : 0;
  const next = index + 1 < reviewLines.length
    ? reviewLines[index + 1].start - 0.05
    : (audio.duration || selectedTrack?.duration || Infinity);
  return Math.max(previous, Math.min(next, value));
}

function rebuildReviewEnds(): void {
  reviewLines = reviewLines.map((line, index) => ({
    ...line,
    end: index + 1 < reviewLines.length
      ? reviewLines[index + 1].start
      : (audio.duration || selectedTrack?.duration || line.end)
  }));
}

function renderReview(): void {
  const container = byId("review-lines");
  container.replaceChildren();
  reviewLines.forEach((line, index) => {
    const button = document.createElement("button");
    button.className = "review-line";
    if ((line.confidence ?? 1) < 0.6) button.classList.add("low-confidence");
    if (index === reviewIndex) button.classList.add("selected");
    const time = document.createElement("time");
    time.textContent = formatSyncTime(line.start);
    const text = document.createElement("span");
    text.textContent = line.text;
    const note = document.createElement("em");
    const confidence = line.confidence ?? 1;
    note.textContent = confidence === 0
      ? "未找到位置 · 已估算"
      : confidence < 0.6
        ? "建议试听"
        : "匹配良好";
    button.append(time, text, note);
    button.addEventListener("click", () => {
      reviewIndex = index;
      if (selectedTrack) {
        play(selectedTrack);
        audio.currentTime = line.start;
      }
      renderReview();
    });
    container.append(button);
  });
  const editor = byId("review-editor");
  editor.classList.toggle("hidden", reviewIndex < 0);
  if (reviewIndex >= 0) {
    byId("review-current-text").textContent = reviewLines[reviewIndex].text;
    byId("review-current-time").textContent = formatSyncTime(reviewLines[reviewIndex].start);
    container.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  }
}

function openAiReview(lines: LyricLine[] | undefined = selectedTrack?.lyrics?.lines): void {
  if (!selectedTrack || !lines?.length) return;
  reviewLines = lines.map((line) => ({ ...line }));
  reviewIndex = reviewLines.findIndex((line) => (line.confidence ?? 1) < 0.6);
  if (reviewIndex < 0) reviewIndex = 0;
  byId("paste-step").classList.add("hidden");
  byId("sync-step").classList.add("hidden");
  byId("review-step").classList.remove("hidden");
  updateLyricsWorkbenchStep("review");
  play(selectedTrack);
  audio.pause();
  byId<HTMLInputElement>("review-seek").max = String(audio.duration || selectedTrack.duration || 1);
  renderReview();
}

function returnToLyricsInput(): void {
  if (!selectedTrack) return;
  byId<HTMLTextAreaElement>("lyrics-input").value =
    selectedTrack.lyrics?.lines.map((line) => line.text).join("\n") || "";
  byId("review-step").classList.add("hidden");
  byId("sync-step").classList.add("hidden");
  byId("paste-step").classList.remove("hidden");
  updateLyricsWorkbenchStep("text");
  byId("ai-status").classList.add("hidden");
  const aiButton = byId<HTMLButtonElement>("ai-align");
  aiButton.dataset.completed = "false";
  aiButton.textContent = "重新 AI 匹配";
  updateLineCount();
}

function restartWithManualSync(): void {
  returnToLyricsInput();
  startSync();
}

function adjustReviewLine(delta: number): void {
  if (reviewIndex < 0) return;
  reviewLines[reviewIndex].start = clampReviewStart(
    reviewIndex,
    reviewLines[reviewIndex].start + delta
  );
  reviewLines[reviewIndex].confidence = 1;
  rebuildReviewEnds();
  audio.currentTime = reviewLines[reviewIndex].start;
  renderReview();
}

function setReviewToCurrentTime(): void {
  if (reviewIndex < 0) return;
  const previous = reviewIndex > 0 ? reviewLines[reviewIndex - 1].start + 0.05 : 0;
  reviewLines[reviewIndex].start = Math.max(previous, audio.currentTime);
  reviewLines[reviewIndex].confidence = 1;
  rebuildReviewEnds();
  renderReview();
}

function tapReviewLine(): void {
  if (reviewIndex < 0) return;
  const currentIndex = reviewIndex;
  const previous = currentIndex > 0 ? reviewLines[currentIndex - 1].start + 0.05 : 0;
  reviewLines[currentIndex].start = Math.max(previous, audio.currentTime);
  reviewLines[currentIndex].confidence = 1;
  rebuildReviewEnds();
  if (currentIndex + 1 < reviewLines.length) reviewIndex = currentIndex + 1;
  renderReview();
}

function shiftAllReviewLines(delta: number): void {
  const duration = audio.duration || selectedTrack?.duration || Infinity;
  const minimum = reviewLines.length ? -reviewLines[0].start : 0;
  const maximum = reviewLines.length ? duration - reviewLines[reviewLines.length - 1].start : 0;
  const safeDelta = Math.max(minimum, Math.min(maximum, delta));
  reviewLines = reviewLines.map((line) => ({ ...line, start: line.start + safeDelta }));
  rebuildReviewEnds();
  renderReview();
}

async function saveReview(): Promise<void> {
  if (!selectedTrack) return;
  rememberLyricsVersion(selectedTrack);
  const updated = await window.linkAudio.saveLyrics(selectedTrack.id, reviewLines, "ai");
  applyUpdatedTrack(updated);
  renderLyrics(updated);
  closeLyricsModal();
}

function formatSyncTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const rest = (seconds % 60).toFixed(1).padStart(4, "0");
  return `${minutes}:${rest}`;
}

function renderSync(): void {
  byId("sync-position").textContent = `${Math.min(syncIndex + 1, syncTexts.length)} / ${syncTexts.length}`;
  byId("sync-current").textContent = syncTexts[syncIndex] || "全部歌词已完成";
  byId("sync-current").classList.toggle("singing", syncStarted);
  const upcoming = byId("sync-upcoming");
  upcoming.replaceChildren();
  for (const text of syncTexts.slice(syncIndex + 1, syncIndex + 4)) {
    const line = document.createElement("p");
    line.textContent = text;
    upcoming.append(line);
  }
  const lastLineStarted = syncStarted && syncIndex === syncTexts.length - 1;
  byId<HTMLButtonElement>("tap-line").disabled = lastLineStarted;
  byId("tap-line").textContent = !syncStarted
    ? "唱到这句开头时，按空格"
    : lastLineStarted
      ? "最后一句已标记，可以保存"
      : "下一句开始时，按空格";
  byId<HTMLButtonElement>("save-lyrics").disabled = syncTimes.length !== syncTexts.length;
}

function startSync(): void {
  syncTexts = cleanLyrics(byId<HTMLTextAreaElement>("lyrics-input").value);
  if (!syncTexts.length) {
    byId("line-count").textContent = "请至少粘贴一行歌词";
    return;
  }
  syncTimes = [];
  syncIndex = 0;
  syncStarted = false;
  byId("paste-step").classList.add("hidden");
  byId("sync-step").classList.remove("hidden");
  updateLyricsWorkbenchStep("match");
  if (selectedTrack) {
    play(selectedTrack);
    audio.currentTime = 0;
  }
  syncSeek.value = "0";
  syncSeek.max = String(audio.duration || selectedTrack?.duration || 1);
  byId("sync-duration").textContent = formatSyncTime(audio.duration || selectedTrack?.duration || 0);
  renderSync();
}

function tapCurrentLine(): void {
  if (!syncTexts.length) return;
  if (!syncStarted) {
    syncStarted = true;
    syncTimes[0] = audio.currentTime;
  } else if (syncIndex + 1 < syncTexts.length) {
    syncIndex += 1;
    syncTimes[syncIndex] = audio.currentTime;
  }
  renderSync();
}

function undoSync(): void {
  if (!syncTimes.length) return;
  syncTimes.pop();
  syncStarted = syncTimes.length > 0;
  syncIndex = syncStarted ? syncTimes.length - 1 : 0;
  audio.currentTime = syncTimes[syncTimes.length - 1] || 0;
  renderSync();
}

async function saveLyrics(): Promise<void> {
  if (!selectedTrack || syncTimes.length !== syncTexts.length) return;
  const lines: LyricLine[] = syncTexts.map((text, index) => ({
    text,
    start: syncTimes[index],
    end: index + 1 < syncTimes.length ? syncTimes[index + 1] : (audio.duration || null)
  }));
  rememberLyricsVersion(selectedTrack);
  const updated = await window.linkAudio.saveLyrics(selectedTrack.id, lines);
  applyUpdatedTrack(updated);
  renderLyrics(updated);
  byId("edit-lyrics").textContent = "编辑歌词";
  closeLyricsModal();
}

async function alignLyricsWithAi(): Promise<void> {
  if (!selectedTrack) return;
  const aiButton = byId<HTMLButtonElement>("ai-align");
  if (aiButton.dataset.completed === "true") {
    aiButton.dataset.completed = "false";
    aiButton.textContent = "AI 自动匹配";
    openAiReview();
    return;
  }
  const texts = cleanLyrics(byId<HTMLTextAreaElement>("lyrics-input").value);
  if (!texts.length) {
    byId("line-count").textContent = "请至少粘贴一行歌词";
    return;
  }
  const aiStatus = byId("ai-status");
  aiStatus.classList.remove("hidden", "error");
  updateLyricsWorkbenchStep("match");
  updateAiProgress("正在准备本地 AI…", 0);
  aiButton.disabled = true;
  byId("cancel-ai").classList.remove("hidden");
  byId<HTMLButtonElement>("start-sync").disabled = true;
  try {
    const lines = await window.linkAudio.alignLyrics(selectedTrack.id, texts);
    const reviewCount = lines.filter((line) => (line.confidence ?? 1) < 0.6).length;
    updateAiProgress(
      `匹配完成：共 ${lines.length} 行，${reviewCount} 行建议手动检查。保存后才会替换当前版本。`,
      100
    );
    openAiReview(lines);
  } catch (error) {
    aiStatus.classList.add("error");
    byId("ai-status-text").textContent = friendlyError(error);
    updateLyricsWorkbenchStep("text");
  } finally {
    aiButton.disabled = false;
    byId("cancel-ai").classList.add("hidden");
    byId<HTMLButtonElement>("start-sync").disabled = false;
  }
}

function updateActiveLyric(): void {
  if (!selectedTrack?.lyrics || byId("detail-view").classList.contains("active") === false) return;
  let index = -1;
  for (let lineIndex = 0; lineIndex < selectedTrack.lyrics.lines.length; lineIndex += 1) {
    if (selectedTrack.lyrics.lines[lineIndex].start <= audio.currentTime) index = lineIndex;
    else break;
  }
  document.querySelectorAll(".lyric-line").forEach((element, elementIndex) => {
    element.classList.toggle("active", elementIndex === index);
    if (elementIndex === index && Date.now() >= lyricsManualScrollUntil) {
      element.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });
}

async function remove(id: string, ask = true): Promise<void> {
  const target = tracks.find((track) => track.id === id);
  if (ask && !await showConfirm("移入回收站", `将"${target?.title || "这首音频"}"移入回收站？之后可以恢复。`)) {
    return;
  }
  if (playingTrack?.id === id) {
    stopPlayback();
  }
  playbackOrder = playbackOrder.filter((trackId) => trackId !== id);
  playNextQueue = playNextQueue.filter((trackId) => trackId !== id);
  renderQueuePanel();
  if (selectedTrack?.id === id) selectedTrack = null;
  try {
    tracks = await window.linkAudio.deleteTrack(id);
    deletedTracks = await window.linkAudio.listDeletedTracks();
    renderLibrary();
    showView("library", activeCollection);
    showStatus("已移入回收站。", "success");
  } catch (error) {
    showStatus(
      `移入回收站失败：${friendlyError(error)}`,
      "error"
    );
  }
}

function openPlaylistPicker(track: Track): void {
  playlistPickerTrackId = track.id;
  byId("playlist-picker-track").textContent = `选择要收藏"${displayTitle(track.title, 36)}"的歌单`;
  byId("playlist-picker-error").classList.add("hidden");
  const options = byId("playlist-picker-options");
  options.replaceChildren();
  if (!playlists.length) {
    const empty = document.createElement("p");
    empty.className = "playlist-picker-empty";
    empty.textContent = "还没有歌单，请先新建一个歌单。";
    options.append(empty);
  } else {
    for (const playlist of playlists) {
      const label = document.createElement("label");
      label.className = "playlist-picker-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = playlist.id;
      checkbox.checked = playlist.trackIds.includes(track.id);
      const copy = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = playlist.name;
      const count = document.createElement("small");
      count.textContent = `${playlist.trackIds.length} 首`;
      copy.append(name, count);
      label.append(checkbox, copy);
      options.append(label);
    }
  }
  byId("playlist-picker-modal").classList.remove("hidden");
}

function renderLibrary(): void {
  const list = byId("track-list");
  const empty = byId("empty-library");
  const folder = folders.find((item) => item.id === activeCollection);
  const playlist = playlists.find((item) => `playlist:${item.id}` === activeCollection);
  const isTrash = activeCollection === "trash";
  const normalizedQuery = libraryQuery.trim();
  let visibleTracks: Array<Track | DeletedTrack>;
  if (isTrash) {
    let trashTracks = [...deletedTracks];
    const query = normalizedQuery.toLowerCase();
    if (query) {
      trashTracks = trashTracks.filter((track) =>
        `${track.title} ${track.author}`.toLowerCase().includes(query));
    }
    trashTracks.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    visibleTracks = trashTracks;
  } else {
    visibleTracks = getPlayableCollectionTracks();
  }
  const visibleIds = new Set(visibleTracks.map((track) => track.id));
  for (const id of selectedLibraryIds) {
    if (!visibleIds.has(id)) selectedLibraryIds.delete(id);
  }
  byId("library-title").textContent = activeCollection === "favorites"
    ? "我喜欢的音乐"
    : activeCollection === "trash"
      ? "回收站"
      : playlist?.name || folder?.name || "我的音乐";
  byId("track-count").textContent = `${visibleTracks.length} 首`;
  const playAll = byId<HTMLButtonElement>("play-all");
  playAll.disabled = isTrash || visibleTracks.length === 0;
  byId("library-toolbar").classList.toggle("hidden", isTrash);
  for (const id of ["library-import-local", "library-import-folder", "library-import-link"]) {
    byId(id).classList.toggle("hidden", activeCollection !== "all");
  }
  byId<HTMLInputElement>("library-search").placeholder =
    isTrash ? "搜索回收站" : "搜索歌曲或歌手";
  list.replaceChildren();
  empty.classList.toggle("hidden", visibleTracks.length > 0);
  byId("bulk-toolbar").classList.toggle("hidden", selectedLibraryIds.size === 0);

  const emptyIcon = byId("empty-library-icon");
  const emptyTitle = byId("empty-library-title");
  const emptyCopy = byId("empty-library-copy");
  if (normalizedQuery) {
    emptyIcon.textContent = "⌕";
    emptyTitle.textContent = "没有找到匹配的歌曲";
    emptyCopy.textContent = `没有找到"${displayTitle(normalizedQuery, 28)}"，请试试其他关键词。`;
  } else if (isTrash) {
    emptyIcon.textContent = "♲";
    emptyTitle.textContent = "回收站为空";
    emptyCopy.textContent = "移入回收站的歌曲会暂时保留在这里。";
  } else if (activeCollection === "favorites") {
    emptyIcon.textContent = "♥";
    emptyTitle.textContent = "还没有喜欢的音乐";
    emptyCopy.textContent = "点击歌曲旁的爱心，把喜欢的歌曲收集到这里。";
  } else if (playlist) {
    emptyIcon.textContent = "♫";
    emptyTitle.textContent = "歌单中还没有歌曲";
    emptyCopy.textContent = "从歌曲的更多菜单中选择“收藏到歌单”。";
  } else if (folder) {
    emptyIcon.textContent = "▰";
    emptyTitle.textContent = "文件夹中还没有歌曲";
    emptyCopy.textContent = "选择歌曲后，可通过批量工具栏加入这个文件夹。";
  } else {
    emptyIcon.textContent = "♫";
    emptyTitle.textContent = "还没有导入音频";
    emptyCopy.textContent = "导入第一首本地音乐或哔哩哔哩音频。";
  }

  byId("track-list-header").classList.toggle("hidden", visibleTracks.length === 0);
  byId("track-list-header").classList.toggle("trash-mode", isTrash);

  for (const [index, track] of visibleTracks.entries()) {
    const item = document.createElement("article");
    const isPlaying = !isTrash && playingTrack?.id === track.id;
    item.className = `track${isTrash ? " trash-track" : ""}${isPlaying ? " playing" : ""}`;
    item.dataset.trackId = track.id;
    if (isPlaying) item.setAttribute("aria-current", "true");
    item.draggable = !isTrash;
    item.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/linkaudio-track-id", track.id);
    });
    if (playlist) {
      item.addEventListener("dragover", (event) => event.preventDefault());
      item.addEventListener("drop", async (event) => {
        event.preventDefault();
        const movingId = event.dataTransfer?.getData("text/linkaudio-track-id");
        if (!movingId || movingId === track.id) return;
        const order = playlist.trackIds.filter((id) => id !== movingId);
        order.splice(Math.max(0, order.indexOf(track.id)), 0, movingId);
        playlists = await window.linkAudio.updatePlaylist(playlist.id, order);
        renderPlaylistNavigation();
        renderLibrary();
      });
    }
    const select = document.createElement("input");
    select.type = "checkbox";
    select.className = "track-select";
    select.checked = selectedLibraryIds.has(track.id);
    select.title = `选择"${track.title}"`;
    select.setAttribute("aria-label", `选择歌曲：${track.title}`);
    select.classList.remove("hidden");
    select.addEventListener("change", () => {
      if (select.checked) selectedLibraryIds.add(track.id);
      else selectedLibraryIds.delete(track.id);
      renderBulkState();
    });
    const order = document.createElement("span");
    order.className = "track-index";
    order.textContent = String(index + 1).padStart(2, "0");
    const cover = document.createElement("img");
    cover.alt = "";
    if (track.thumbnail) {
      cover.src = track.thumbnail;
      cover.addEventListener("error", () => cover.removeAttribute("src"), { once: true });
    }
    const info = document.createElement("div");
    info.className = "track-info";
    const title = document.createElement("strong");
    title.textContent = displayTitle(track.title);
    title.title = track.title;
    const meta = document.createElement("small");
    meta.textContent = track.lyrics ? "已匹配歌词" : "暂无歌词";
    info.append(title, meta);
    const author = document.createElement("span");
    author.className = "track-author";
    author.textContent = displayArtist(track.author);
    author.title = displayArtist(track.author);
    const source = document.createElement("span");
    source.className = "track-source";
    source.textContent = track.platform === "local" ? "本地音乐" : "哔哩哔哩";
    const duration = document.createElement("time");
    duration.className = "track-duration";
    duration.textContent = formatDuration(track.duration);
    if (!isTrash) {
      item.tabIndex = 0;
      item.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).closest("button, input, select")) return;
        document.querySelectorAll(".track.selected")
          .forEach((row) => row.classList.remove("selected"));
        item.classList.add("selected");
      });
      item.addEventListener("dblclick", (event) => {
        if ((event.target as HTMLElement).closest("button, input, select")) return;
        play(track, true);
        openDetail(track);
      });
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          play(track, true);
          openDetail(track);
        }
      });
    }
    const playButton = document.createElement("button");
    playButton.className = "icon-button play";
    if (isTrash) {
      playButton.textContent = "↶";
      playButton.title = `恢复"${track.title}"`;
      playButton.setAttribute("aria-label", `恢复歌曲：${track.title}`);
      playButton.addEventListener("click", async () => {
        try {
          const result = await window.linkAudio.restoreTrack(track.id);
          tracks = result.tracks;
          deletedTracks = result.deleted;
          renderLibrary();
        } catch (error) {
          showStatus(`恢复失败：${friendlyError(error)}`, "error");
        }
      });
    } else {
      playButton.textContent = "▶";
      playButton.title = `播放"${track.title}"`;
      playButton.setAttribute("aria-label", `播放歌曲：${track.title}`);
      playButton.addEventListener("click", () => play(track, true));
    }
    const deleteButton = document.createElement("button");
    deleteButton.className = "icon-button delete";
    deleteButton.textContent = "×";
    deleteButton.title = playlist ? `从歌单移除"${track.title}"`
      : isTrash ? `永久删除"${track.title}"` : `将"${track.title}"移入回收站`;
    deleteButton.setAttribute(
      "aria-label",
      playlist ? `从歌单移除：${track.title}`
        : isTrash ? `永久删除歌曲：${track.title}` : `移入回收站：${track.title}`
    );
    deleteButton.addEventListener("click", async () => {
      if (playlist) {
        playlists = await window.linkAudio.updatePlaylist(
          playlist.id, playlist.trackIds.filter((id) => id !== track.id)
        );
        renderPlaylistNavigation();
        renderLibrary();
        return;
      }
      if (!isTrash) return void remove(track.id);
      if (!await showConfirm("永久删除", `永久删除"${track.title}"？此操作无法恢复。`, "永久删除")) return;
      try {
        deletedTracks = await window.linkAudio.permanentlyDeleteTrack(track.id);
        renderLibrary();
      } catch (error) {
        showStatus(`永久删除失败：${friendlyError(error)}`, "error");
      }
    });
    const queueButton = document.createElement("button");
    queueButton.className = "icon-button";
    queueButton.textContent = "+";
    queueButton.title = `下一首播放"${track.title}"`;
    queueButton.setAttribute("aria-label", `下一首播放：${track.title}`);
    queueButton.classList.toggle("hidden", isTrash);
    queueButton.addEventListener("click", () => {
      playNextQueue = [...playNextQueue.filter((id) => id !== track.id), track.id];
      renderQueuePanel();
      showStatus(`"${track.title}"将在下一首播放。`, "success");
    });
    const favoriteButton = document.createElement("button");
    favoriteButton.className = `icon-button favorite${track.favorite ? " active" : ""}`;
    favoriteButton.textContent = track.favorite ? "♥" : "♡";
    favoriteButton.title = track.favorite ? `取消喜欢"${track.title}"` : `喜欢"${track.title}"`;
    favoriteButton.setAttribute(
      "aria-label",
      track.favorite ? `取消喜欢：${track.title}` : `加入喜欢：${track.title}`
    );
    favoriteButton.classList.toggle("hidden", isTrash);
    favoriteButton.addEventListener("click", async () => {
      const updated = await window.linkAudio.updateTrack(track.id, {
        title: track.title,
        author: track.author,
        favorite: !track.favorite,
        folderIds: track.folderIds
      });
      applyUpdatedTrack(updated);
      renderLibrary();
    });
    if (isTrash) {
      item.append(select, order, cover, info, author, source, duration, playButton, deleteButton);
    } else {
      const actionWrap = document.createElement("div");
      actionWrap.className = "track-action-wrap";
      const moreButton = document.createElement("button");
      moreButton.className = "icon-button more";
      moreButton.textContent = "···";
      moreButton.title = "更多操作";
      moreButton.setAttribute("aria-label", `更多操作：${track.title}`);
      moreButton.setAttribute("aria-haspopup", "menu");
      moreButton.setAttribute("aria-expanded", "false");
      const menu = document.createElement("div");
      menu.className = "track-action-menu hidden";
      menu.setAttribute("role", "menu");
      const playlistButton = document.createElement("button");
      playlistButton.textContent = "收藏到歌单";
      playlistButton.addEventListener("click", () => openPlaylistPicker(track));
      const infoButton = document.createElement("button");
      infoButton.textContent = "查看歌曲信息";
      infoButton.addEventListener("click", () => openDetail(track));
      const queueMenuButton = document.createElement("button");
      queueMenuButton.textContent = "下一首播放";
      queueMenuButton.addEventListener("click", () => queueButton.click());
      const removeMenuButton = document.createElement("button");
      removeMenuButton.textContent = playlist ? "从歌单移除" : "移入回收站";
      removeMenuButton.className = "danger-text";
      removeMenuButton.addEventListener("click", () => deleteButton.click());
      for (const button of [playlistButton, infoButton, queueMenuButton, removeMenuButton]) {
        button.setAttribute("role", "menuitem");
      }
      menu.append(playlistButton, infoButton, queueMenuButton, removeMenuButton);
      moreButton.addEventListener("click", () => {
        const shouldOpen = menu.classList.contains("hidden");
        closeTrackActionMenus();
        if (shouldOpen) openTrackActionMenu(menu, moreButton);
      });
      item.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        openTrackActionMenu(menu, moreButton);
        moreButton.focus();
      });
      actionWrap.append(moreButton, menu);
      item.append(
        select, order, cover, info, author, source, duration,
        favoriteButton, playButton, actionWrap
      );
    }
    list.append(item);
  }
  renderBulkState();
}

function closeTrackActionMenus(except?: HTMLElement): void {
  document.querySelectorAll<HTMLElement>(".track-action-menu").forEach((menu) => {
    if (menu === except) return;
    menu.classList.add("hidden");
    menu.parentElement?.querySelector<HTMLButtonElement>(".icon-button.more")
      ?.setAttribute("aria-expanded", "false");
  });
}

function openTrackActionMenu(menu: HTMLElement, button: HTMLButtonElement): void {
  closeTrackActionMenus(menu);
  menu.classList.remove("hidden", "open-up");
  const playerTop = byId("player").getBoundingClientRect().top;
  const buttonRect = button.getBoundingClientRect();
  if (buttonRect.bottom + menu.offsetHeight + 8 > playerTop) {
    menu.classList.add("open-up");
  }
  button.setAttribute("aria-expanded", "true");
}

function renderGlobalSearch(query: string): void {
  const container = byId("global-search-results");
  const normalized = query.trim().toLowerCase();
  container.replaceChildren();
  if (!normalized) {
    container.classList.add("hidden");
    return;
  }
  const matches = activeCollection === "trash"
    ? []
    : getPlayableCollectionTracks().slice(0, 8);
  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "global-search-empty";
    empty.textContent = "当前列表中没有匹配的歌曲";
    container.append(empty);
  }
  for (const track of matches) {
    const button = document.createElement("button");
    button.className = "global-search-result";
    const cover = document.createElement(track.thumbnail ? "img" : "span");
    cover.className = track.thumbnail ? "" : "global-search-result-cover";
    if (cover instanceof HTMLImageElement) {
      cover.src = track.thumbnail!;
      cover.alt = "";
      cover.addEventListener("error", () => {
        const fallback = document.createElement("span");
        fallback.className = "global-search-result-cover";
        fallback.setAttribute("aria-hidden", "true");
        cover.replaceWith(fallback);
      }, { once: true });
    }
    const copy = document.createElement("span");
    copy.className = "global-search-result-copy";
    const title = document.createElement("strong");
    title.textContent = displayTitle(track.title);
    title.title = track.title;
    const meta = document.createElement("small");
    meta.textContent =
      `${displayArtist(track.author)} · ${track.platform === "local" ? "本地音乐" : "哔哩哔哩"}`;
    copy.append(title, meta);
    const duration = document.createElement("span");
    duration.textContent = formatDuration(track.duration);
    button.append(cover, copy, duration);
    button.setAttribute("aria-label", `查看歌曲详情：${track.title}，${displayArtist(track.author)}`);
    button.addEventListener("click", () => {
      openDetail(track);
      container.classList.add("hidden");
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        container.classList.add("hidden");
        byId<HTMLInputElement>("library-search").focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const results = [...container.querySelectorAll<HTMLButtonElement>(".global-search-result")];
      const currentIndex = results.indexOf(button);
      if (event.key === "ArrowDown") {
        results[Math.min(results.length - 1, currentIndex + 1)]?.focus();
      } else if (currentIndex <= 0) {
        byId<HTMLInputElement>("library-search").focus();
      } else {
        results[currentIndex - 1]?.focus();
      }
    });
    container.append(button);
  }
  container.classList.remove("hidden");
}

function renderBulkState(): void {
  const hasSelection = selectedLibraryIds.size > 0;
  const isTrash = activeCollection === "trash";
  byId("bulk-toolbar").classList.toggle("hidden", !hasSelection);
  byId("bulk-toolbar").classList.toggle("trash-mode", activeCollection === "trash");
  byId("bulk-delete").textContent = isTrash ? "永久删除" : "移入回收站";
  byId("bulk-count").textContent = selectedLibraryIds.size
    ? `已选择 ${selectedLibraryIds.size} 首`
    : "未选择歌曲";
  const visibleCheckboxes = [...document.querySelectorAll<HTMLInputElement>("#track-list .track-select")];
  const allVisibleSelected =
    visibleCheckboxes.length > 0 && visibleCheckboxes.every((checkbox) => checkbox.checked);
  const someVisibleSelected = visibleCheckboxes.some((checkbox) => checkbox.checked);
  for (const id of ["bulk-select-all", "header-select-all"]) {
    const checkbox = byId<HTMLInputElement>(id);
    checkbox.checked = allVisibleSelected;
    checkbox.indeterminate = someVisibleSelected && !allVisibleSelected;
  }
  const selectedTracks = tracks.filter((track) => selectedLibraryIds.has(track.id));
  const allFavorites = selectedTracks.length > 0 && selectedTracks.every((track) => track.favorite);
  byId("bulk-favorite").textContent = allFavorites ? "取消喜欢" : "加入喜欢";
  byId<HTMLButtonElement>("bulk-favorite").disabled = !hasSelection || isTrash;
  const select = byId<HTMLSelectElement>("bulk-folder");
  const value = select.value;
  select.replaceChildren(new Option("选择文件夹", ""));
  for (const folder of folders) select.append(new Option(folder.name, folder.id));
  select.value = folders.some((folder) => folder.id === value) ? value : "";
  select.disabled = isTrash || !hasSelection || folders.length === 0;
  byId<HTMLButtonElement>("bulk-add-folder").disabled =
    select.disabled || !select.value;
  const playlistSelect = byId<HTMLSelectElement>("bulk-playlist");
  const playlistValue = playlistSelect.value;
  playlistSelect.replaceChildren(new Option("选择歌单", ""));
  for (const playlist of playlists) playlistSelect.append(new Option(playlist.name, playlist.id));
  playlistSelect.value = playlists.some((playlist) => playlist.id === playlistValue)
    ? playlistValue : "";
  playlistSelect.disabled = isTrash || !hasSelection || playlists.length === 0;
  byId<HTMLButtonElement>("bulk-add-playlist").disabled =
    playlistSelect.disabled || !playlistSelect.value;
  byId<HTMLButtonElement>("bulk-restore").disabled = !isTrash || !hasSelection;
  byId<HTMLButtonElement>("bulk-delete").disabled = !hasSelection;
}

async function updateSelectedTracks(action: (track: Track) => TrackUpdate): Promise<void> {
  for (const id of selectedLibraryIds) {
    const track = tracks.find((item) => item.id === id);
    if (track) await window.linkAudio.updateTrack(id, action(track));
  }
  tracks = await window.linkAudio.listTracks();
  selectedLibraryIds.clear();
  renderLibrary();
}

function renderFolderNavigation(): void {
  const container = byId("folder-nav");
  container.replaceChildren();
  for (const folder of folders) {
    const row = document.createElement("div");
    row.className = "folder-row";
    const button = document.createElement("button");
    button.className = "nav-item folder-item";
    button.dataset.view = "library";
    button.dataset.collection = folder.id;
    button.innerHTML = `<span>▰</span>`;
    button.append(document.createTextNode(folder.name));
    button.title = `打开文件夹：${folder.name}`;
    button.addEventListener("click", () => {
      closeMobileSidebar();
      showView("library", folder.id);
    });
    button.addEventListener("dragover", (event) => event.preventDefault());
    button.addEventListener("drop", async (event) => {
      event.preventDefault();
      const trackId = event.dataTransfer?.getData("text/linkaudio-track-id");
      const track = tracks.find((item) => item.id === trackId);
      if (!track) return;
      await window.linkAudio.updateTrack(track.id, {
        title: track.title, author: track.author, favorite: track.favorite,
        folderIds: [...new Set([...track.folderIds, folder.id])]
      });
      tracks = await window.linkAudio.listTracks();
      renderLibrary();
    });
    const renameButton = document.createElement("button");
    renameButton.className = "folder-action";
    renameButton.textContent = "✎";
    renameButton.title = `重命名文件夹：${folder.name}`;
    renameButton.setAttribute("aria-label", `重命名文件夹：${folder.name}`);
    renameButton.addEventListener("click", () => openFolderModal(folder));
    const removeButton = document.createElement("button");
    removeButton.className = "folder-action";
    removeButton.textContent = "×";
    removeButton.title = `删除文件夹：${folder.name}`;
    removeButton.setAttribute("aria-label", `删除文件夹：${folder.name}`);
    removeButton.addEventListener("click", async () => {
      if (!await showConfirm("删除文件夹", `删除文件夹"${folder.name}"？歌曲本身不会删除。`, "删除")) return;
      const result = await window.linkAudio.deleteFolder(folder.id);
      folders = result.folders;
      tracks = result.tracks;
      if (activeCollection === folder.id) activeCollection = "all";
      renderFolderNavigation();
      renderLibrary();
    });
    row.append(button, renameButton, removeButton);
    container.append(row);
  }
  renderPlaylistNavigation();
}

function renderPlaylistNavigation(): void {
  const container = byId("playlist-nav");
  container.replaceChildren();
  for (const playlist of playlists) {
    const row = document.createElement("div");
    row.className = "folder-row";
    const button = document.createElement("button");
    button.className = "nav-item folder-item";
    button.dataset.view = "library";
    button.dataset.collection = `playlist:${playlist.id}`;
    button.innerHTML = "<span>☷</span>";
    button.append(document.createTextNode(playlist.name));
    button.title = `打开歌单：${playlist.name}`;
    button.addEventListener("click", () => {
      closeMobileSidebar();
      showView("library", `playlist:${playlist.id}`);
    });
    button.addEventListener("dragover", (event) => event.preventDefault());
    button.addEventListener("drop", async (event) => {
      event.preventDefault();
      const id = event.dataTransfer?.getData("text/linkaudio-track-id");
      if (!id) return;
      playlists = await window.linkAudio.updatePlaylist(
        playlist.id, [...playlist.trackIds.filter((trackId) => trackId !== id), id]
      );
      renderPlaylistNavigation();
      renderLibrary();
    });
    const remove = document.createElement("button");
    remove.className = "folder-action";
    remove.textContent = "×";
    remove.title = `删除歌单：${playlist.name}`;
    remove.setAttribute("aria-label", `删除歌单：${playlist.name}`);
    remove.addEventListener("click", async () => {
      if (!await showConfirm("删除歌单", `删除歌单"${playlist.name}"？歌曲本身不会删除。`, "删除")) return;
      playlists = await window.linkAudio.deletePlaylist(playlist.id);
      if (activeCollection === `playlist:${playlist.id}`) activeCollection = "all";
      renderPlaylistNavigation();
      renderLibrary();
    });
    row.append(button, remove);
    container.append(row);
  }
}

function updateNavigationButtons(): void {
  byId<HTMLButtonElement>("nav-back").disabled = viewHistoryIndex <= 0;
  byId<HTMLButtonElement>("nav-forward").disabled =
    viewHistoryIndex < 0 || viewHistoryIndex >= viewHistory.length - 1;
}

function libraryScrollKey(): string {
  return `${activeCollection}\u0000${libraryQuery}\u0000${librarySort}`;
}

function rememberLibraryScroll(): void {
  if (!byId("library-view").classList.contains("active")) return;
  const main = document.querySelector<HTMLElement>("main")!;
  libraryScrollPositions.set(libraryScrollKey(), main.scrollTop);
}

function restoreLibraryScroll(): void {
  const main = document.querySelector<HTMLElement>("main")!;
  const target = libraryScrollPositions.get(libraryScrollKey()) || 0;
  requestAnimationFrame(() => {
    main.scrollTop = target;
  });
}

function updateDetailScale(): void {
  const detail = byId("detail-view");
  if (!detail.classList.contains("active")) return;
  const main = document.querySelector<HTMLElement>("main")!;
  const baseWidth = 1180;
  const baseHeight = 620;
  const scale = Math.min(main.clientWidth / baseWidth, main.clientHeight / baseHeight);
  detail.style.setProperty("--detail-scale", String(Math.max(0.55, scale)));
  detail.style.setProperty("--detail-offset-x", `${Math.max(0, (main.clientWidth - baseWidth * scale) / 2)}px`);
  detail.style.setProperty("--detail-offset-y", `${Math.max(0, (main.clientHeight - baseHeight * scale) / 2)}px`);
}

function showView(name: string, collection?: string, recordHistory = true): void {
  rememberLibraryScroll();
  closeTrackActionMenus();
  byId("detail-more-menu").classList.add("hidden");
  byId("detail-more-toggle").setAttribute("aria-expanded", "false");
  byId("global-search-results").classList.add("hidden");
  if (name !== "library" || (collection && collection !== activeCollection)) {
    selectedLibraryIds.clear();
  }
  if (name === "library" && collection) activeCollection = collection;
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
  byId(`${name}-view`).classList.add("active");
  document.body.classList.toggle("detail-active", name === "detail");
  if (name === "detail") {
    document.querySelector<HTMLElement>("main")!.scrollTop = 0;
    requestAnimationFrame(updateDetailScale);
  }
  const selector = name === "library"
    ? `[data-view="library"][data-collection="${activeCollection}"]`
    : `[data-view="${name}"]`;
  document.querySelector<HTMLElement>(selector)?.classList.add("active");
  if (name === "library") {
    renderLibrary();
    restoreLibraryScroll();
  }
  if (recordHistory) {
    const effectiveCollection = name === "library" ? activeCollection : collection;
    const current = viewHistory[viewHistoryIndex];
    if (!current || current.name !== name || current.collection !== effectiveCollection) {
      viewHistory = viewHistory.slice(0, viewHistoryIndex + 1);
      viewHistory.push({ name, collection: effectiveCollection });
      viewHistoryIndex = viewHistory.length - 1;
    }
  }
  updateNavigationButtons();
}

importButton.addEventListener("click", () => void importAudio());
input.addEventListener("input", () => {
  importButton.disabled = input.value.trim().length === 0;
  if (!importButton.disabled) status.classList.add("hidden");
});
byId("import-local-button").addEventListener("click", () => void importLocalAudio());
byId("clear-task-history").addEventListener("click", () => {
  taskHistory = taskHistory.filter((task) => task.status === "running");
  persistTaskHistory();
  renderTaskHistory();
});
byId("save-settings").addEventListener("click", () => void saveSettings());
/* Settings section navigation */
for (const btn of document.querySelectorAll<HTMLButtonElement>(".settings-sections button[data-settings-section]")) {
  btn.addEventListener("click", () => {
    const section = btn.dataset.settingsSection;
    document.querySelectorAll(".settings-sections button").forEach((b) => { b.classList.remove("active"); b.removeAttribute("aria-current"); });
    btn.classList.add("active");
    btn.setAttribute("aria-current", "page");
    for (const id of ["settings-general", "settings-playback", "settings-library"]) {
      byId(id).classList.toggle("hidden", id !== `settings-${section}`);
    }
  });
}
/* Playback settings save */
byId("save-settings-playback").addEventListener("click", async () => {
  settings = await window.linkAudio.saveSettings({
    ...settings,
    defaultPlayMode: byId<HTMLSelectElement>("settings-play-mode").value as AppSettings["defaultPlayMode"],
    rememberVolume: byId<HTMLInputElement>("settings-remember-volume").checked
  });
  applyPlayModeSetting();
  showStatus("播放设置已保存。", "success");
});
/* Library settings save */
byId("save-settings-library").addEventListener("click", async () => {
  settings = await window.linkAudio.saveSettings({
    ...settings,
    defaultSort: byId<HTMLSelectElement>("settings-default-sort").value as AppSettings["defaultSort"],
    showSourceColumn: byId<HTMLInputElement>("settings-show-source").checked
  });
  applyLibrarySettings();
  showStatus("音乐库设置已保存。", "success");
});
byId("backup-library").addEventListener("click", async () => {
  try {
    if (await window.linkAudio.backupLibrary()) {
      byId("settings-status").classList.remove("hidden", "error");
      byId("settings-status").classList.add("success");
      byId("settings-status-text").textContent = "音乐、封面、歌词、文件夹和设置已完整备份。";
    }
  } catch (error) {
    byId("settings-status").classList.remove("hidden", "success");
    byId("settings-status").classList.add("error");
    byId("settings-status-text").textContent = friendlyError(error);
  }
});
byId("restore-library").addEventListener("click", async () => {
  if (!await showConfirm("恢复备份", "恢复备份会替换当前音乐库。程序会先保留一份恢复前副本，是否继续？", "继续恢复")) return;
  try {
    if (!await window.linkAudio.restoreLibraryBackup()) return;
    tracks = await window.linkAudio.listTracks();
    deletedTracks = await window.linkAudio.listDeletedTracks();
    folders = await window.linkAudio.listFolders();
    playlists = await window.linkAudio.listPlaylists();
    renderFolderNavigation();
    renderLibrary();
    byId("settings-status").classList.remove("hidden", "error");
    byId("settings-status").classList.add("success");
    byId("settings-status-text").textContent = "音乐库已经恢复。";
  } catch (error) {
    byId("settings-status").classList.remove("hidden", "success");
    byId("settings-status").classList.add("error");
    byId("settings-status-text").textContent = friendlyError(error);
  }
});
byId("clean-trash").addEventListener("click", async () => {
  deletedTracks = await window.linkAudio.cleanTrash();
  renderLibrary();
  byId("settings-status").classList.remove("hidden", "error");
  byId("settings-status").classList.add("success");
  byId("settings-status-text").textContent = "过期的回收站内容已经清理。";
});
byId("back-to-library").addEventListener("click", () => showView("library"));
byId("detail-play").addEventListener("click", () => {
  if (!selectedTrack) return;
  if (playingTrack?.id === selectedTrack.id && !audio.paused) audio.pause();
  else play(selectedTrack);
});
byId("vinyl-record").addEventListener("click", () => {
  document.body.classList.add("showing-lyrics");
});
byId("back-to-vinyl").addEventListener("click", () => {
  document.body.classList.remove("showing-lyrics");
});
function closeSongInfoPanel(restoreFocus = true): void {
  const panel = byId("song-info-panel");
  if (panel.classList.contains("hidden")) return;
  panel.classList.add("hidden");
  byId("song-info-toggle").setAttribute("aria-expanded", "false");
  if (restoreFocus) songInfoReturnFocus?.focus();
  songInfoReturnFocus = null;
}
byId("song-info-toggle").setAttribute("aria-expanded", "false");
byId("song-info-toggle").addEventListener("click", () => {
  songInfoReturnFocus = byId("detail-more-toggle");
  byId("song-info-panel").classList.remove("hidden");
  byId("song-info-toggle").setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => byId<HTMLButtonElement>("song-info-close").focus());
});
byId("song-info-close").addEventListener("click", () => closeSongInfoPanel());
byId("detail-more-toggle").setAttribute("aria-haspopup", "menu");
byId("detail-more-toggle").setAttribute("aria-expanded", "false");
byId("detail-more-toggle").addEventListener("click", () => {
  const menu = byId("detail-more-menu");
  const shouldOpen = menu.classList.contains("hidden");
  closeTrackActionMenus();
  menu.classList.toggle("hidden", !shouldOpen);
  byId("detail-more-toggle").setAttribute("aria-expanded", String(shouldOpen));
});
byId("edit-track").addEventListener("click", openTrackEditor);
byId("split-track").addEventListener("click", openSplitEditor);
byId("export-track").addEventListener("click", () =>
  selectedTrack && void window.linkAudio.exportTrack(selectedTrack.id));
byId("reveal-track").addEventListener("click", () =>
  selectedTrack && void window.linkAudio.revealTrack(selectedTrack.id));
byId("delete-track-detail").addEventListener("click", () =>
  selectedTrack && void remove(selectedTrack.id));
byId("track-editor-cancel").addEventListener("click", () =>
  byId("track-editor-modal").classList.add("hidden"));
byId("track-editor-save").addEventListener("click", () => void saveTrackEditor());
byId("choose-cover").addEventListener("click", async () => {
  const selection = await window.linkAudio.chooseTrackCover();
  if (!selection) return;
  pendingCoverPath = selection.sourcePath;
  const cover = byId<HTMLImageElement>("track-cover-preview");
  cover.src = selection.previewUrl;
  byId("cover-crop-controls").classList.remove("hidden");
});
for (const id of ["cover-zoom", "cover-x", "cover-y"]) {
  byId<HTMLInputElement>(id).addEventListener("input", () => {
    const zoom = Number(byId<HTMLInputElement>("cover-zoom").value);
    const x = Number(byId<HTMLInputElement>("cover-x").value) * 0.35;
    const y = Number(byId<HTMLInputElement>("cover-y").value) * 0.35;
    byId<HTMLImageElement>("track-cover-preview").style.transform =
      `translate(${x}%, ${y}%) scale(${zoom})`;
  });
}
byId("split-cancel").addEventListener("click", async () => {
  if (splitDirty && !await showConfirm("放弃裁切", "放弃当前尚未保存的裁切方案？", "放弃")) return;
  audio.pause();
  byId("split-modal").classList.add("hidden");
});
byId("split-save").addEventListener("click", () => void saveSplit());
byId("split-next").addEventListener("click", openSegmentMetadata);
byId("split-back").addEventListener("click", () => {
  draftSegments.forEach((segment, index) => {
    segment.title = byId("segment-metadata-list")
      .querySelector<HTMLInputElement>(`[data-field="title"][data-index="${index}"]`)?.value ||
      segment.title;
    segment.author = byId("segment-metadata-list")
      .querySelector<HTMLInputElement>(`[data-field="author"][data-index="${index}"]`)?.value ||
      segment.author;
  });
  byId("split-metadata-step").classList.add("hidden");
  byId("split-timeline-step").classList.remove("hidden");
  renderDraftTimeline();
});
byId("split-at-playhead").addEventListener("click", splitAtPlayhead);
byId("split-undo").addEventListener("click", undoSplit);
byId("split-redo").addEventListener("click", redoSplit);
byId("delete-segment").addEventListener("click", deleteSelectedDraft);
byId("split-cancel-task").addEventListener("click", () => void window.linkAudio.cancelSplit());
byId("split-preview-play").addEventListener("click", () => {
  if (audio.paused) resumeAudio();
  else audio.pause();
});
byId<HTMLInputElement>("split-preview-seek").addEventListener("input", (event) => {
  audio.currentTime = Number((event.currentTarget as HTMLInputElement).value);
  previewSelectedOnly = false;
});
function nudgePlayhead(delta: number): void {
  audio.currentTime = Math.max(0, Math.min(splitDuration(), audio.currentTime + delta));
  byId<HTMLInputElement>("playhead-time-input").value = audio.currentTime.toFixed(2);
}
byId("nudge-back-large").addEventListener("click", () => nudgePlayhead(-0.5));
byId("nudge-back").addEventListener("click", () => nudgePlayhead(-0.1));
byId("nudge-forward").addEventListener("click", () => nudgePlayhead(0.1));
byId("nudge-forward-large").addEventListener("click", () => nudgePlayhead(0.5));
byId<HTMLInputElement>("playhead-time-input").addEventListener("change", (event) => {
  audio.currentTime = Math.max(0, Math.min(
    splitDuration(),
    Number((event.currentTarget as HTMLInputElement).value) || 0
  ));
});
byId<HTMLInputElement>("timeline-zoom").addEventListener("input", (event) => {
  const zoom = Number((event.currentTarget as HTMLInputElement).value);
  byId<HTMLElement>("audio-timeline").style.width = `${zoom * 100}%`;
  byId<HTMLCanvasElement>("waveform-canvas").style.width = `${zoom * 100}%`;
});
function openFolderModal(folder?: AudioFolder): void {
  editingFolderId = folder?.id || null;
  byId<HTMLInputElement>("folder-name-input").value = folder?.name || "";
  byId("folder-modal").querySelector("h2")!.textContent = folder ? "重命名文件夹" : "新建文件夹";
  byId("folder-save").textContent = folder ? "保存名称" : "创建文件夹";
  byId("folder-error").classList.add("hidden");
  byId("folder-modal").classList.remove("hidden");
  byId<HTMLInputElement>("folder-name-input").focus();
}

async function createFolder(): Promise<void> {
  const input = byId<HTMLInputElement>("folder-name-input");
  const name = input.value.trim();
  if (!name) {
    byId("folder-error").textContent = "请输入文件夹名称。";
    byId("folder-error").classList.remove("hidden");
    input.focus();
    return;
  }
  try {
    folders = editingFolderId
      ? await window.linkAudio.renameFolder(editingFolderId, name)
      : await window.linkAudio.createFolder(name);
    renderFolderNavigation();
    byId("folder-modal").classList.add("hidden");
  } catch (error) {
    const errorElement = byId("folder-error");
    errorElement.textContent = friendlyError(error);
    errorElement.classList.remove("hidden");
    input.focus();
  }
}
byId("create-folder").addEventListener("click", () => openFolderModal());
function openPlaylistModal(): void {
  byId<HTMLInputElement>("playlist-name-input").value = "";
  byId("playlist-error").classList.add("hidden");
  byId<HTMLButtonElement>("playlist-save").disabled = true;
  byId("playlist-modal").classList.remove("hidden");
  byId<HTMLInputElement>("playlist-name-input").focus();
}
byId("create-playlist").addEventListener("click", openPlaylistModal);
byId("playlist-cancel").addEventListener("click", () =>
  byId("playlist-modal").classList.add("hidden"));
byId("playlist-save").addEventListener("click", async () => {
  const input = byId<HTMLInputElement>("playlist-name-input");
  const name = input.value.trim();
  if (!name) {
    byId("playlist-error").textContent = "请输入歌单名称。";
    byId("playlist-error").classList.remove("hidden");
    input.focus();
    return;
  }
  try {
    playlists = await window.linkAudio.createPlaylist(name);
    byId("playlist-modal").classList.add("hidden");
    renderPlaylistNavigation();
    renderBulkState();
    if (playlistPickerTrackId) {
      const target = tracks.find((track) => track.id === playlistPickerTrackId);
      if (target) openPlaylistPicker(target);
    }
  } catch (error) {
    byId("playlist-error").textContent = friendlyError(error);
    byId("playlist-error").classList.remove("hidden");
    input.focus();
  }
});
byId<HTMLInputElement>("playlist-name-input").addEventListener("input", (event) => {
  const hasName = (event.currentTarget as HTMLInputElement).value.trim().length > 0;
  byId<HTMLButtonElement>("playlist-save").disabled = !hasName;
  if (hasName) byId("playlist-error").classList.add("hidden");
});
byId<HTMLInputElement>("playlist-name-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !byId<HTMLButtonElement>("playlist-save").disabled) {
    event.preventDefault();
    byId<HTMLButtonElement>("playlist-save").click();
  }
});
byId("playlist-picker-cancel").addEventListener("click", () => {
  playlistPickerTrackId = null;
  byId("playlist-picker-modal").classList.add("hidden");
});
byId("playlist-picker-new").addEventListener("click", () => {
  byId("playlist-picker-modal").classList.add("hidden");
  openPlaylistModal();
});
byId("playlist-picker-save").addEventListener("click", async () => {
  const trackId = playlistPickerTrackId;
  if (!trackId) return;
  const error = byId("playlist-picker-error");
  const save = byId<HTMLButtonElement>("playlist-picker-save");
  try {
    save.disabled = true;
    const checked = new Set(
      Array.from(
        byId("playlist-picker-options").querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')
      ).map((input) => input.value)
    );
    let currentPlaylists = playlists;
    for (const original of playlists) {
      const current = currentPlaylists.find((item) => item.id === original.id) || original;
      const contains = current.trackIds.includes(trackId);
      const shouldContain = checked.has(current.id);
      if (contains === shouldContain) continue;
      currentPlaylists = await window.linkAudio.updatePlaylist(
        current.id,
        shouldContain
          ? [...current.trackIds, trackId]
          : current.trackIds.filter((id) => id !== trackId)
      );
    }
    playlists = currentPlaylists;
    renderPlaylistNavigation();
    renderLibrary();
    playlistPickerTrackId = null;
    byId("playlist-picker-modal").classList.add("hidden");
    showStatus("歌单收藏已更新。", "success");
  } catch (reason) {
    error.textContent = friendlyError(reason);
    error.classList.remove("hidden");
  } finally {
    save.disabled = false;
  }
});
byId("folder-cancel").addEventListener("click", () =>
  byId("folder-modal").classList.add("hidden"));
byId("folder-save").addEventListener("click", () => void createFolder());
byId<HTMLInputElement>("folder-name-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter") void createFolder();
});
byId("edit-lyrics").addEventListener("click", openLyricsModal);
byId("empty-add-lyrics").addEventListener("click", openLyricsModal);
byId("import-lrc").addEventListener("click", async () => {
  if (!selectedTrack) return;
  try {
    const updated = await window.linkAudio.importLrc(selectedTrack.id);
    if (updated) replaceTrack(updated);
  } catch (error) {
    showStatus(`导入歌词失败：${friendlyError(error)}`, "error");
  }
});
byId("export-lrc").addEventListener("click", async () => {
  if (!selectedTrack?.lyrics?.lines.length) {
    showStatus("这首歌曲还没有可导出的歌词。", "error");
    return;
  }
  try {
    if (await window.linkAudio.exportLrc(selectedTrack.id)) {
      showStatus("LRC 歌词已导出。", "success");
    }
  } catch (error) {
    showStatus(`导出歌词失败：${friendlyError(error)}`, "error");
  }
});
byId<HTMLTextAreaElement>("lyrics-input").addEventListener("input", updateLineCount);
byId("start-sync").addEventListener("click", startSync);
byId("ai-align").addEventListener("click", () => void alignLyricsWithAi());
byId("cancel-ai").addEventListener("click", () => void window.linkAudio.cancelAiAlignment());
byId("tap-line").addEventListener("click", tapCurrentLine);
byId("undo-sync").addEventListener("click", undoSync);
byId("sync-back").addEventListener("click", () => {
  byId("sync-step").classList.add("hidden");
  byId("paste-step").classList.remove("hidden");
});
byId("save-lyrics").addEventListener("click", () => void saveLyrics());
byId("review-toggle-play").addEventListener("click", () => {
  if (audio.paused) resumeAudio();
  else audio.pause();
});
byId<HTMLInputElement>("review-seek").addEventListener("input", (event) => {
  audio.currentTime = Number((event.currentTarget as HTMLInputElement).value);
});
byId("review-earlier").addEventListener("click", () => adjustReviewLine(-0.2));
byId("review-later").addEventListener("click", () => adjustReviewLine(0.2));
byId("review-set-current").addEventListener("click", setReviewToCurrentTime);
byId("shift-all-earlier").addEventListener("click", () => shiftAllReviewLines(-0.5));
byId("shift-all-later").addEventListener("click", () => shiftAllReviewLines(0.5));
byId("review-cancel").addEventListener("click", closeLyricsModal);
byId("review-realign").addEventListener("click", async () => {
  if (!await showConfirm("重新匹配",
    "将保留当前已保存歌词，仅重新计算新的匹配结果。只有确认并保存后才会替换当前版本。是否继续？", "继续"
  )) return;
  returnToLyricsInput();
  byId<HTMLButtonElement>("ai-align").textContent = "开始再次智能匹配";
});
byId("restore-lyrics-version").addEventListener("click", async () => {
  if (!selectedTrack) return;
  const stored = localStorage.getItem(lyricsVersionKey(selectedTrack.id));
  if (!stored || !await showConfirm("恢复歌词", "恢复上次保存的歌词版本？当前版本会作为可恢复版本保留。", "恢复")) return;
  try {
    const previous = JSON.parse(stored) as {
      source: "manual" | "ai";
      lines: LyricLine[];
    };
    const current = selectedTrack.lyrics;
    const updated = await window.linkAudio.saveLyrics(
      selectedTrack.id,
      previous.lines,
      previous.source
    );
    if (current) localStorage.setItem(lyricsVersionKey(selectedTrack.id), JSON.stringify(current));
    applyUpdatedTrack(updated);
    renderLyrics(updated);
    openAiReview(updated.lyrics?.lines);
  } catch (error) {
    window.alert(friendlyError(error));
  }
});
byId("review-manual").addEventListener("click", restartWithManualSync);
byId("review-save").addEventListener("click", () => void saveReview());
for (const eventName of ["wheel", "touchstart", "pointerdown"] as const) {
  byId("lyrics-lines").addEventListener(eventName, () => {
    lyricsManualScrollUntil = Date.now() + 5000;
  }, { passive: true });
}
document.querySelectorAll(".modal-cancel").forEach((button) => button.addEventListener("click", closeLyricsModal));
document.querySelectorAll<HTMLElement>(".nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    closeMobileSidebar();
    showView(item.dataset.view || "import", item.dataset.collection);
  });
});
function closeMobileSidebar(): void {
  document.querySelector(".app-shell")!.classList.remove("sidebar-mobile-open");
  syncSidebarToggle();
}
function syncSidebarToggle(): void {
  const shell = document.querySelector(".app-shell")!;
  const compactWindow = window.matchMedia("(max-width: 1020px)").matches;
  const expanded = compactWindow
    ? shell.classList.contains("sidebar-mobile-open")
    : !shell.classList.contains("sidebar-collapsed");
  byId("sidebar-toggle").setAttribute("aria-label", expanded ? "收起侧栏" : "展开侧栏");
  byId("sidebar-toggle").setAttribute("aria-expanded", String(expanded));
  byId("sidebar-toggle").querySelector("span")!.textContent = expanded ? "«" : "»";
  byId("sidebar-toggle").querySelector("b")!.textContent = expanded ? "收起侧栏" : "展开侧栏";
}
byId("sidebar-toggle").addEventListener("click", () => {
  const shell = document.querySelector(".app-shell")!;
  if (window.matchMedia("(max-width: 1020px)").matches) {
    shell.classList.toggle("sidebar-mobile-open");
    syncSidebarToggle();
    return;
  }
  const collapsed = shell.classList.toggle("sidebar-collapsed");
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  localStorage.setItem("linkAudioSidebarCollapsed", String(collapsed));
  syncSidebarToggle();
});
document.querySelector<HTMLElement>(".topbar-settings")!.addEventListener("click", () =>
  showView("settings"));
byId("nav-back").addEventListener("click", () => {
  if (viewHistoryIndex <= 0) return;
  viewHistoryIndex -= 1;
  const entry = viewHistory[viewHistoryIndex];
  showView(entry.name, entry.collection, false);
});
byId("nav-forward").addEventListener("click", () => {
  if (viewHistoryIndex >= viewHistory.length - 1) return;
  viewHistoryIndex += 1;
  const entry = viewHistory[viewHistoryIndex];
  showView(entry.name, entry.collection, false);
});
byId("library-import-local").addEventListener("click", () => void importLocalAudio());
byId("library-import-folder").addEventListener("click", () => void importLocalFolder());
byId("library-import-link").addEventListener("click", () => {
  showView("import");
  requestAnimationFrame(() => input.focus());
});
byId("play-all").addEventListener("click", () => {
  const first = getPlayableCollectionTracks()[0];
  if (first) play(first, true);
});
byId<HTMLInputElement>("library-search").addEventListener("input", (event) => {
  libraryQuery = (event.currentTarget as HTMLInputElement).value;
  libraryScrollPositions.set(libraryScrollKey(), 0);
  renderLibrary();
  document.querySelector<HTMLElement>("main")!.scrollTop = 0;
  renderGlobalSearch(libraryQuery);
});
byId<HTMLInputElement>("library-search").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    const results = byId("global-search-results");
    if (!results.classList.contains("hidden")) {
      event.preventDefault();
      results.classList.add("hidden");
      (event.currentTarget as HTMLInputElement).focus();
      return;
    }
    (event.currentTarget as HTMLInputElement).value = "";
    libraryQuery = "";
    libraryScrollPositions.set(libraryScrollKey(), 0);
    renderLibrary();
    results.classList.add("hidden");
  } else if (event.key === "Enter") {
    const firstResult = document.querySelector<HTMLButtonElement>(".global-search-result");
    if (firstResult) {
      event.preventDefault();
      firstResult.click();
    }
  } else if (event.key === "ArrowDown") {
    const firstResult = document.querySelector<HTMLButtonElement>(".global-search-result");
    if (firstResult) {
      event.preventDefault();
      firstResult.focus();
    }
  }
});
document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (!target.closest(".search-shell")) {
    byId("global-search-results").classList.add("hidden");
  }
  if (!target.closest("#play-queue-panel, #player-queue-toggle")) {
    byId("play-queue-panel").classList.add("hidden");
  }
  if (!target.closest(".detail-actions")) {
    byId("detail-more-menu").classList.add("hidden");
    byId("detail-more-toggle").setAttribute("aria-expanded", "false");
  }
  if (!target.closest(".track-action-wrap")) {
    closeTrackActionMenus();
  }
  if (!target.closest("#song-info-panel, #song-info-toggle")) {
    closeSongInfoPanel(false);
  }
  if (target.closest(".detail-more-menu button, .track-action-menu button")) {
    byId("detail-more-menu").classList.add("hidden");
    byId("detail-more-toggle").setAttribute("aria-expanded", "false");
    closeTrackActionMenus();
  }
});
document.addEventListener("dragover", (event) => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  document.body.classList.add("dragging-audio");
});
document.addEventListener("dragleave", (event) => {
  if (!(event.relatedTarget instanceof Node)) {
    document.body.classList.remove("dragging-audio");
  }
});
document.addEventListener("drop", (event) => {
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault();
  document.body.classList.remove("dragging-audio");
  void importDroppedAudio(event.dataTransfer.files);
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const openModal = document.querySelector<HTMLElement>(".modal:not(.hidden)");
  if (openModal) {
    const cancelSelectors: Record<string, string> = {
      "folder-modal": "#folder-cancel",
      "playlist-modal": "#playlist-cancel",
      "playlist-picker-modal": "#playlist-picker-cancel",
      "track-editor-modal": "#track-editor-cancel",
      "split-modal": "#split-cancel",
      "lyrics-modal": ".modal-cancel"
    };
    openModal.querySelector<HTMLButtonElement>(cancelSelectors[openModal.id])?.click();
    return;
  }
  if (!byId("song-info-panel").classList.contains("hidden")) {
    event.preventDefault();
    closeSongInfoPanel();
    return;
  }
  byId("detail-more-menu").classList.add("hidden");
  byId("detail-more-toggle").setAttribute("aria-expanded", "false");
  byId("global-search-results").classList.add("hidden");
  closeTrackActionMenus();
});
let lastNonModalFocus: HTMLElement | null = null;
document.addEventListener("focusin", (event) => {
  const target = event.target;
  if (target instanceof HTMLElement && !target.closest(".modal")) {
    lastNonModalFocus = target;
  }
});
document.querySelectorAll<HTMLElement>(".modal").forEach((modal) => {
  const heading = modal.querySelector<HTMLElement>("h2");
  if (heading) {
    heading.id ||= `${modal.id}-title`;
    modal.setAttribute("aria-labelledby", heading.id);
  }
  let previousFocus: HTMLElement | null = null;
  const observer = new MutationObserver(() => {
    if (!modal.classList.contains("hidden")) {
      previousFocus = lastNonModalFocus;
      window.setTimeout(() => {
        const autofocus = modal.querySelector<HTMLElement>("[data-autofocus]");
        const firstFocusable = modal.querySelector<HTMLElement>(
          "input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])"
        );
        (autofocus || firstFocusable)?.focus();
      });
    } else {
      previousFocus?.focus();
      previousFocus = null;
    }
  });
  observer.observe(modal, { attributes: true, attributeFilter: ["class"] });
  modal.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = [...modal.querySelectorAll<HTMLElement>(
      "input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])"
    )].filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
});
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    showView("library", activeCollection);
    byId<HTMLInputElement>("library-search").focus();
    return;
  }
  if (!byId("lyrics-modal").classList.contains("hidden") ||
      !byId("split-modal").classList.contains("hidden") ||
      document.querySelector(".modal:not(.hidden)")) return;
  const target = event.target as HTMLElement;
  if (target.closest("input, textarea, select, button, [contenteditable='true']")) return;
  if (event.code === "MediaPlayPause" || event.code === "Space") {
    if (!playingTrack) return;
    event.preventDefault();
    if (audio.paused) resumeAudio();
    else audio.pause();
  } else if (event.code === "MediaTrackNext" ||
      ((event.ctrlKey || event.metaKey) && event.code === "ArrowRight")) {
    event.preventDefault();
    playRelative(1);
  } else if (event.code === "MediaTrackPrevious" ||
      ((event.ctrlKey || event.metaKey) && event.code === "ArrowLeft")) {
    event.preventDefault();
    playRelative(-1);
  }
});
byId<HTMLSelectElement>("library-sort").addEventListener("change", (event) => {
  librarySort = (event.currentTarget as HTMLSelectElement).value;
  libraryScrollPositions.set(libraryScrollKey(), 0);
  renderLibrary();
  document.querySelector<HTMLElement>("main")!.scrollTop = 0;
});
byId("bulk-favorite").addEventListener("click", () => {
  const selectedTracks = tracks.filter((track) => selectedLibraryIds.has(track.id));
  const nextFavorite = !selectedTracks.length ||
    !selectedTracks.every((track) => track.favorite);
  void updateSelectedTracks((track) => ({
    title: track.title, author: track.author, favorite: nextFavorite, folderIds: track.folderIds
  }));
});
for (const id of ["bulk-folder", "bulk-playlist"]) {
  byId(id).addEventListener("change", renderBulkState);
}
byId("bulk-add-folder").addEventListener("click", () => {
  const folderId = byId<HTMLSelectElement>("bulk-folder").value;
  if (!folderId) return;
  void updateSelectedTracks((track) => ({
    title: track.title,
    author: track.author,
    favorite: track.favorite,
    folderIds: [...new Set([...track.folderIds, folderId])]
  }));
});
byId("bulk-add-playlist").addEventListener("click", async () => {
  const playlistId = byId<HTMLSelectElement>("bulk-playlist").value;
  const playlist = playlists.find((item) => item.id === playlistId);
  if (!playlist || !selectedLibraryIds.size) return;
  playlists = await window.linkAudio.updatePlaylist(
    playlist.id, [...playlist.trackIds, ...selectedLibraryIds]
  );
  selectedLibraryIds.clear();
  renderPlaylistNavigation();
  renderLibrary();
});
byId("bulk-restore").addEventListener("click", async () => {
  if (activeCollection !== "trash" || !selectedLibraryIds.size) return;
  let restored = 0;
  let failed = 0;
  for (const id of [...selectedLibraryIds]) {
    try {
      const result = await window.linkAudio.restoreTrack(id);
      tracks = result.tracks;
      deletedTracks = result.deleted;
      restored++;
    } catch {
      failed++;
    }
  }
  selectedLibraryIds.clear();
  renderLibrary();
  if (failed === 0) {
    showStatus(`已恢复 ${restored} 首歌曲到音乐库。`, "success");
  } else {
    showStatus(`恢复完成：${restored} 首成功，${failed} 首失败。`, "error");
  }
});
byId("bulk-delete").addEventListener("click", async () => {
  const permanent = activeCollection === "trash";
  if (!selectedLibraryIds.size) return;
  if (!await showConfirm(
    permanent ? "永久删除" : "移入回收站",
    permanent
      ? `永久删除选中的 ${selectedLibraryIds.size} 首歌曲？此操作无法恢复。`
      : `将选中的 ${selectedLibraryIds.size} 首歌曲移入回收站？`,
    permanent ? "永久删除" : "移入回收站"
  )) return;
  const deletingIds = [...selectedLibraryIds];
  if (playingTrack && selectedLibraryIds.has(playingTrack.id)) stopPlayback();
  if (selectedTrack && selectedLibraryIds.has(selectedTrack.id)) selectedTrack = null;
  playbackOrder = playbackOrder.filter((id) => !selectedLibraryIds.has(id));
  playNextQueue = playNextQueue.filter((id) => !selectedLibraryIds.has(id));
  let deleted = 0;
  let failed = 0;
  for (const id of deletingIds) {
    try {
      if (permanent) await window.linkAudio.permanentlyDeleteTrack(id);
      else await window.linkAudio.deleteTrack(id);
      deleted++;
    } catch {
      failed++;
    }
  }
  selectedLibraryIds.clear();
  tracks = await window.linkAudio.listTracks();
  deletedTracks = await window.linkAudio.listDeletedTracks();
  renderQueuePanel();
  renderLibrary();
  if (failed === 0) {
    showStatus(permanent ? `已永久删除 ${deleted} 首歌曲。` : `已移入回收站 ${deleted} 首歌曲。`, "success");
  } else {
    showStatus(`操作完成：${deleted} 首成功，${failed} 首失败。`, "error");
  }
});
function setAllVisibleSelected(checked: boolean): void {
  document.querySelectorAll<HTMLInputElement>("#track-list .track-select").forEach((checkbox) => {
    checkbox.checked = checked;
    const id = checkbox.closest<HTMLElement>(".track")?.dataset.trackId;
    if (!id) return;
    if (checked) selectedLibraryIds.add(id);
    else selectedLibraryIds.delete(id);
  });
  renderBulkState();
}
for (const id of ["bulk-select-all", "header-select-all"]) {
  byId<HTMLInputElement>(id).addEventListener("change", (event) =>
    setAllVisibleSelected((event.currentTarget as HTMLInputElement).checked));
}
byId("player-previous").addEventListener("click", () => playRelative(-1));
byId("player-next").addEventListener("click", () => playRelative(1));
byId("player-toggle").addEventListener("click", () => {
  if (audio.paused) resumeAudio();
  else audio.pause();
});
byId("player-mode").addEventListener("click", cyclePlayMode);
document.querySelector<HTMLElement>(".now-playing")!.addEventListener("click", () => {
  if (playingTrack) openDetail(playingTrack);
});
window.addEventListener("resize", () => {
  updateDetailScale();
  if (!window.matchMedia("(max-width: 1020px)").matches) {
    document.querySelector(".app-shell")!.classList.remove("sidebar-mobile-open");
  }
  syncSidebarToggle();
});
byId("player-queue-toggle").addEventListener("click", () => {
  renderQueuePanel();
  byId("play-queue-panel").classList.toggle("hidden");
});
byId("play-queue-close").addEventListener("click", () =>
  byId("play-queue-panel").classList.add("hidden"));
byId("play-queue-clear").addEventListener("click", () => {
  playNextQueue = [];
  playbackOrder = playingTrack ? [playingTrack.id] : [];
  renderQueuePanel();
});
byId("player-lyrics-open").addEventListener("click", () => {
  if (!playingTrack) return;
  openDetail(playingTrack);
  document.body.classList.add("showing-lyrics");
});
playerSeek.addEventListener("input", () => { audio.currentTime = Number(playerSeek.value); });
byId<HTMLInputElement>("player-volume").addEventListener("input", (event) => {
  audio.volume = Number((event.currentTarget as HTMLInputElement).value);
  localStorage.setItem("linkAudioVolume", String(audio.volume));
});

window.linkAudio.onProgress((progress) => {
  showStatus(
    progress.message,
    progress.stage === "error" ? "error" : progress.stage === "complete" ? "success" : "working"
  );
  if (progress.taskId) {
    const taskStatus = progress.stage === "complete" ? "complete"
      : progress.stage === "error" ? "error" : "running";
    recordTask(
      progress.message, taskStatus, progress.stage === "error" ? progress.message : undefined,
      progress.taskId, progress.title || "链接下载", progress.percent
    );
  }
  if (!byId("lyrics-modal").classList.contains("hidden")) {
    byId("ai-status").classList.remove("hidden");
    updateAiProgress(progress.message, progress.percent, progress.stage === "error");
  }
  if (!byId("split-modal").classList.contains("hidden")) {
    byId("split-task-status").classList.remove("hidden");
    byId("split-task-text").textContent = progress.message;
    const percent = Math.max(0, Math.min(100, progress.percent || 0));
    byId("split-task-percent").textContent = `${percent}%`;
    byId<HTMLElement>("split-task-bar").style.width = `${percent}%`;
  }
});

audio.addEventListener("timeupdate", () => {
  byId("sync-time").textContent = formatSyncTime(audio.currentTime);
  syncSeek.value = String(audio.currentTime);
  playerSeek.value = String(audio.currentTime);
  byId("player-current").textContent = formatPlayerTime(audio.currentTime);
  if (playingTrack && audio.src === playingTrack.fileUrl) {
    const currentSecond = Math.floor(audio.currentTime);
    if (currentSecond !== lastPersistedSecond) {
      lastPersistedSecond = currentSecond;
      localStorage.setItem("linkAudioLastPosition", String(audio.currentTime));
    }
  }
  updateActiveLyric();
  if (!byId("review-step").classList.contains("hidden")) {
    byId<HTMLInputElement>("review-seek").value = String(audio.currentTime);
    byId("review-time").textContent = formatSyncTime(audio.currentTime);
  }
  if (!byId("split-modal").classList.contains("hidden")) {
    byId<HTMLInputElement>("split-preview-seek").value = String(audio.currentTime);
    byId("split-preview-time").textContent = formatSyncTime(audio.currentTime);
    const duration = splitDuration();
    byId<HTMLElement>("timeline-playhead").style.left =
      `${duration ? Math.min(100, (audio.currentTime / duration) * 100) : 0}%`;
    byId<HTMLInputElement>("playhead-time-input").value = audio.currentTime.toFixed(2);
    const selected = draftSegments.find((segment) => segment.id === selectedDraftId);
    if (!audio.paused && previewSelectedOnly && selected && audio.currentTime >= selected.end) {
      audio.pause();
      audio.currentTime = selected.end;
    } else if (!audio.paused && !previewSelectedOnly) {
      const inside = draftSegments.some((segment) =>
        audio.currentTime >= segment.start && audio.currentTime < segment.end);
      if (!inside) {
        const next = draftSegments.find((segment) => segment.start > audio.currentTime);
        if (next) audio.currentTime = next.start;
        else audio.pause();
      }
    }
  }
});

audio.addEventListener("loadedmetadata", () => {
  syncSeek.max = String(audio.duration || 1);
  byId("sync-duration").textContent = formatSyncTime(audio.duration || 0);
  byId<HTMLInputElement>("review-seek").max = String(audio.duration || 1);
  playerSeek.max = String(audio.duration || 1);
  byId("player-duration").textContent = formatPlayerTime(audio.duration || 0);
  if (pendingRestoreTime > 0) {
    audio.currentTime = Math.min(pendingRestoreTime, Math.max(0, (audio.duration || 0) - .1));
    pendingRestoreTime = 0;
  }
});

syncSeek.addEventListener("input", () => {
  audio.currentTime = Number(syncSeek.value);
  byId("sync-time").textContent = formatSyncTime(audio.currentTime);
});

byId("sync-toggle-play").addEventListener("click", () => {
  if (audio.paused) resumeAudio();
  else audio.pause();
});

audio.addEventListener("play", () => {
  byId("player").classList.remove("has-error");
  byId("sync-toggle-play").textContent = "暂停";
  byId("review-toggle-play").textContent = "Ⅱ";
  byId("review-toggle-play").setAttribute("aria-label", "暂停");
  byId("split-preview-play").textContent = "Ⅱ";
  byId("split-preview-play").setAttribute("aria-label", "暂停");
  byId("player-toggle").textContent = "Ⅱ";
  byId("player-toggle").setAttribute("aria-label", "暂停");
  updatePlaybackVisualState();
});

audio.addEventListener("pause", () => {
  byId("sync-toggle-play").textContent = "继续播放";
  byId("review-toggle-play").textContent = "▶";
  byId("review-toggle-play").setAttribute("aria-label", "播放");
  byId("split-preview-play").textContent = "▶";
  byId("split-preview-play").setAttribute("aria-label", "播放");
  byId("player-toggle").textContent = "▶";
  byId("player-toggle").setAttribute("aria-label", "播放");
  updatePlaybackVisualState();
});

audio.addEventListener("error", () => {
  if (audio.src) reportPlaybackError();
});

audio.addEventListener("ended", () => {
  if (playMode === "repeat") {
    audio.currentTime = 0;
    resumeAudio();
  } else {
    playRelative(1);
  }
});

/* Global player shortcuts — only when no modal is open and focus is not in an input */
window.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement;
  const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
  const anyModalOpen = document.querySelector(".modal:not(.hidden)");
  if (isInput || anyModalOpen) return;
  if (event.code === "Space") {
    event.preventDefault();
    if (audio.src) {
      if (audio.paused) resumeAudio();
      else audio.pause();
    }
  } else if (event.code === "ArrowLeft" && audio.src) {
    event.preventDefault();
    audio.currentTime = Math.max(0, audio.currentTime - 5);
  } else if (event.code === "ArrowRight" && audio.src) {
    event.preventDefault();
    audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + 5);
  }
});

window.addEventListener("keydown", (event) => {
  const splitting = !byId("split-modal").classList.contains("hidden") &&
    !byId("split-timeline-step").classList.contains("hidden");
  if (splitting) {
    if (event.code === "Space") {
      event.preventDefault();
      if (audio.paused) resumeAudio();
      else audio.pause();
    } else if (event.code === "Enter") {
      event.preventDefault();
      splitAtPlayhead();
    } else if (event.code === "Delete" || event.code === "Backspace") {
      event.preventDefault();
      deleteSelectedDraft();
    }
    return;
  }
  const reviewing = !byId("review-step").classList.contains("hidden") &&
    !byId("lyrics-modal").classList.contains("hidden");
  if (reviewing) {
    if (event.code === "Space") {
      event.preventDefault();
      tapReviewLine();
    } else if (event.code === "ArrowLeft") {
      event.preventDefault();
      adjustReviewLine(event.shiftKey ? -1 : -0.2);
    } else if (event.code === "ArrowRight") {
      event.preventDefault();
      adjustReviewLine(event.shiftKey ? 1 : 0.2);
    } else if (event.code === "Enter") {
      event.preventDefault();
      setReviewToCurrentTime();
    }
    return;
  }
  const syncing = !byId("sync-step").classList.contains("hidden") &&
    !byId("lyrics-modal").classList.contains("hidden");
  if (!syncing) return;
  if (event.code === "Space") {
    event.preventDefault();
    tapCurrentLine();
  } else if (event.code === "Backspace") {
    event.preventDefault();
    undoSync();
  } else if (event.code === "ArrowLeft") {
    event.preventDefault();
    audio.currentTime = Math.max(0, audio.currentTime - 2);
  } else if (event.code === "ArrowRight") {
    event.preventDefault();
    audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + 2);
  }
});

window.addEventListener("beforeunload", (event) => {
  if (splitDirty && !byId("split-modal").classList.contains("hidden")) {
    event.preventDefault();
    event.returnValue = "";
  }
});

settings = await window.linkAudio.getSettings();
if (localStorage.getItem("linkAudioSidebarCollapsed") === "true") {
  document.querySelector(".app-shell")!.classList.add("sidebar-collapsed");
  document.body.classList.add("sidebar-collapsed");
}
syncSidebarToggle();
loadTaskHistory();
renderTaskHistory();
renderSettings();
applyTheme();
applyPlayModeSetting();
applyLibrarySettings();
if (!settings.onboardingCompleted) {
  showView("settings");
  byId("settings-status").classList.remove("hidden", "success", "error");
  byId("settings-status-text").textContent =
    "首次使用：请阅读本地处理说明，设置回收站保留时间，并完成合法使用确认。";
} else {
  showView("library", "all");
}
tracks = await window.linkAudio.listTracks();
deletedTracks = await window.linkAudio.listDeletedTracks();
folders = await window.linkAudio.listFolders();
playlists = await window.linkAudio.listPlaylists();
const savedVolume = Number(localStorage.getItem("linkAudioVolume"));
if (Number.isFinite(savedVolume)) {
  audio.volume = Math.max(0, Math.min(1, savedVolume));
  byId<HTMLInputElement>("player-volume").value = String(audio.volume);
}
const savedPlayMode = localStorage.getItem("linkAudioPlayMode");
if (savedPlayMode === "list" || savedPlayMode === "repeat" || savedPlayMode === "shuffle") {
  playMode = savedPlayMode;
  byId("player-mode").textContent =
    playMode === "list" ? "列表循环" : playMode === "repeat" ? "单曲循环" : "随机播放";
}
const lastTrackId = localStorage.getItem("linkAudioLastTrackId");
const lastTrack = tracks.find((track) => track.id === lastTrackId);
if (lastTrack) {
  const parseStoredIds = (key: string): string[] => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  };
  const validTrackIds = new Set(tracks.map((track) => track.id));
  playbackOrder = parseStoredIds("linkAudioPlaybackOrder")
    .filter((id) => validTrackIds.has(id));
  if (!playbackOrder.includes(lastTrack.id)) playbackOrder.unshift(lastTrack.id);
  if (!playbackOrder.length) playbackOrder = tracks.map((track) => track.id);
  playNextQueue = parseStoredIds("linkAudioPlayNextQueue")
    .filter((id) => validTrackIds.has(id) && id !== lastTrack.id);
  pendingRestoreTime = Math.max(0, Number(localStorage.getItem("linkAudioLastPosition")) || 0);
  loadPlayerTrack(lastTrack);
  renderQueuePanel();
} else {
  setPlayerControlsEnabled(false);
}
updatePlaybackVisualState();
renderFolderNavigation();
renderLibrary();
