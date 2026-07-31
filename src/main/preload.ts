import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { ImportProgress, ImportRequest, LinkAudioApi } from "../shared/types.js";

const api: LinkAudioApi = {
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
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  onProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ImportProgress) => listener(progress);
    ipcRenderer.on("media:progress", handler);
    return () => ipcRenderer.removeListener("media:progress", handler);
  }
};

contextBridge.exposeInMainWorld("linkAudio", api);
