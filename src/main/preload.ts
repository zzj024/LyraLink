import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { DesktopLyricsAction, DesktopLyricsState, ImportProgress, ImportRequest, LinkAudioApi } from "../shared/types.js";

const api: LinkAudioApi = {
  searchBilibili: (query, page) => ipcRenderer.invoke("media:search-bilibili", query, page),
  searchNetease: (query, page) => ipcRenderer.invoke("media:search-netease", query, page),
  searchJoox: (query, page) => ipcRenderer.invoke("media:search-joox", query, page),
  resolveNeteasePreview: (songId) => ipcRenderer.invoke("media:resolve-netease-preview", songId),
  resolveStreamPreview: (url) => ipcRenderer.invoke("media:resolve-stream-preview", url),
  resolveBilibiliPreview: (url) => ipcRenderer.invoke("media:resolve-bilibili-preview", url),
  importAudio: (request: ImportRequest) => ipcRenderer.invoke("media:import", request),
  listTracks: () => ipcRenderer.invoke("library:list"),
  deleteTrack: (id) => ipcRenderer.invoke("library:delete", id),
  listDeletedTracks: () => ipcRenderer.invoke("library:list-deleted"),
  restoreTrack: (id) => ipcRenderer.invoke("library:restore", id),
  permanentlyDeleteTrack: (id) => ipcRenderer.invoke("library:permanently-delete", id),
  updateTrack: (id, update) => ipcRenderer.invoke("library:update", id, update),
  chooseTrackCover: () => ipcRenderer.invoke("library:choose-cover"),
  saveCroppedCover: (dataUrl) => ipcRenderer.invoke("library:save-cropped-cover", dataUrl),
  splitTrack: (id, segments) => ipcRenderer.invoke("audio:split", id, segments),
  cancelSplit: () => ipcRenderer.invoke("audio:cancel-split"),
  cancelAiAlignment: () => ipcRenderer.invoke("ai:cancel"),
  importLocalAudio: () => ipcRenderer.invoke("media:import-local"),
  importLocalFolder: () => ipcRenderer.invoke("media:import-local-folder"),
  importLocalPaths: (paths) => ipcRenderer.invoke("media:import-local-paths", paths),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  exportTrack: (id) => ipcRenderer.invoke("media:export", id),
  revealTrack: (id) => ipcRenderer.invoke("media:reveal", id),
  importLrc: (id) => ipcRenderer.invoke("lyrics:import-lrc", id),
  exportLrc: (id) => ipcRenderer.invoke("lyrics:export-lrc", id),
  fetchBilibiliLyrics: (id) => ipcRenderer.invoke("lyrics:fetch-bilibili", id),
  autoMatchLyrics: (id) => ipcRenderer.invoke("lyrics:auto-match", id),
  searchOnlineLyrics: (id) => ipcRenderer.invoke("lyrics:search-online", id),
  searchLyricsByKeyword: (id, keyword) => ipcRenderer.invoke("lyrics:search-by-keyword", id, keyword),
  applyOnlineLyrics: (id, candidateId) => ipcRenderer.invoke("lyrics:apply-online", id, candidateId),
  backupLibrary: () => ipcRenderer.invoke("library:backup"),
  restoreLibraryBackup: () => ipcRenderer.invoke("library:restore-backup"),
  cleanTrash: () => ipcRenderer.invoke("library:clean-trash"),
  listPlaylists: () => ipcRenderer.invoke("playlists:list"),
  createPlaylist: (name) => ipcRenderer.invoke("playlists:create", name),
  renamePlaylist: (id, name) => ipcRenderer.invoke("playlists:rename", id, name),
  deletePlaylist: (id) => ipcRenderer.invoke("playlists:delete", id),
  updatePlaylist: (id, trackIds) => ipcRenderer.invoke("playlists:update", id, trackIds),
  listFolders: () => ipcRenderer.invoke("folders:list"),
  createFolder: (name) => ipcRenderer.invoke("folders:create", name),
  renameFolder: (id, name) => ipcRenderer.invoke("folders:rename", id, name),
  deleteFolder: (id) => ipcRenderer.invoke("folders:delete", id),
  saveLyrics: (id, lines, source) => ipcRenderer.invoke("library:save-lyrics", id, lines, source),
  alignLyrics: (id, texts) => ipcRenderer.invoke("ai:align-lyrics", id, texts),
  chooseWallpaper: () => ipcRenderer.invoke("app:choose-wallpaper"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  openDesktopLyrics: () => ipcRenderer.invoke("desktop-lyrics:open"),
  updateDesktopLyrics: (state) => ipcRenderer.send("desktop-lyrics:update", state),
  hideDesktopLyrics: () => ipcRenderer.send("desktop-lyrics:hide"),
  setDesktopLyricsLocked: (locked) => ipcRenderer.send("desktop-lyrics:lock", locked),
  setDesktopLyricsSettingsOpen: (open) => ipcRenderer.send("desktop-lyrics:settings", open),
  setDesktopLyricsClickThrough: (ignore) => ipcRenderer.send("desktop-lyrics:click-through", ignore),
  setDesktopLyricsCompactHeight: (height) => ipcRenderer.send("desktop-lyrics:compact-height", height),
  controlDesktopLyrics: (action) => ipcRenderer.send("desktop-lyrics:control", action),
  onDesktopLyricsUpdate: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopLyricsState) => listener(state);
    ipcRenderer.on("desktop-lyrics:state", handler);
    return () => ipcRenderer.removeListener("desktop-lyrics:state", handler);
  },
  onDesktopLyricsAction: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, action: DesktopLyricsAction) => listener(action);
    ipcRenderer.on("desktop-lyrics:action", handler);
    return () => ipcRenderer.removeListener("desktop-lyrics:action", handler);
  },
  onDesktopLyricsReveal: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("desktop-lyrics:reveal", handler);
    return () => ipcRenderer.removeListener("desktop-lyrics:reveal", handler);
  },
  onDesktopLyricsPointerLeave: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent) => listener();
    ipcRenderer.on("desktop-lyrics:pointer-leave", handler);
    return () => ipcRenderer.removeListener("desktop-lyrics:pointer-leave", handler);
  },
  onDesktopLyricsVisibility: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, visible: boolean) => listener(visible);
    ipcRenderer.on("desktop-lyrics:visibility", handler);
    return () => ipcRenderer.removeListener("desktop-lyrics:visibility", handler);
  },
  minimizeWindow: () => ipcRenderer.send("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.send("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.send("window:close"),
  onWindowMaximizedChange: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => listener(maximized);
    ipcRenderer.on("window:maximized-change", handler);
    return () => ipcRenderer.removeListener("window:maximized-change", handler);
  },
  showMainWindow: () => ipcRenderer.send("window:show-main"),
  hideTrayMenu: () => ipcRenderer.send("tray-menu:hide"),
  quitApp: () => ipcRenderer.send("app:quit"),
  onProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ImportProgress) => listener(progress);
    ipcRenderer.on("media:progress", handler);
    return () => ipcRenderer.removeListener("media:progress", handler);
  }
};

contextBridge.exposeInMainWorld("linkAudio", api);
