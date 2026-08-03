import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import type { AppSettings, AudioSegment, ImportRequest, LyricLine, TrackUpdate } from "../shared/types.js";
import { AudioEditService } from "./audio-edit-service.js";
import { AiLyricsService } from "./ai-lyrics-service.js";
import { TrackLibrary } from "./library.js";
import { MediaService } from "./media-service.js";
import { SettingsStore } from "./settings.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const supportedAudioExtensions = new Set([
  ".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus", ".webm"
]);
let mainWindow: BrowserWindow | null = null;

async function collectAudioFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collectAudioFiles(entryPath));
    else if (entry.isFile() && supportedAudioExtensions.has(path.extname(entry.name).toLowerCase())) {
      result.push(entryPath);
    }
  }
  return result;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#f4f0e8",
    icon: app.isPackaged ? undefined : path.join(process.cwd(), "resources", "icon.ico"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(currentDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  void mainWindow.loadFile(path.join(currentDirectory, "../renderer/index.html"));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const dataDirectory = path.join(app.getPath("userData"), "library");
  const offlineDirectory = app.isPackaged
    ? path.join(process.resourcesPath, "offline")
    : path.join(process.cwd(), "resources", "offline");
  const library = new TrackLibrary(dataDirectory);
  const settingsStore = new SettingsStore(dataDirectory);
  await library.initialize();

  const mediaService = new MediaService(
    library,
    (progress) => mainWindow?.webContents.send("media:progress", progress),
    existsSync(path.join(offlineDirectory, "bin", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"))
      ? path.join(offlineDirectory, "bin", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")
      : "ffmpeg",
    app.isPackaged
      ? path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "node_modules",
        "youtube-dl-exec",
        "bin",
        process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"
      )
      : path.join(process.cwd(), "node_modules", "youtube-dl-exec", "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp")
  );
  const audioEditService = new AudioEditService(
    library,
    (progress) => mainWindow?.webContents.send("media:progress", progress),
    path.join(offlineDirectory, "bin", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")
  );
  const aiScriptPath = app.isPackaged
    ? path.join(process.resourcesPath, "ai", "align_lyrics.py")
    : path.join(process.cwd(), "ai", "align_lyrics.py");
  console.log("[init] AI script path:", aiScriptPath);
  console.log("[init] Script exists:", existsSync(aiScriptPath));
  const aiLyricsService = new AiLyricsService(
    library,
    dataDirectory,
    aiScriptPath,
    (progress) => mainWindow?.webContents.send("media:progress", progress),
    offlineDirectory
  );

  ipcMain.handle("media:import", async (_event, request: ImportRequest) => {
    const settings = await settingsStore.get();
    return mediaService.importAudio(request.input, settings.confirmedAuthorized, request.taskId);
  });
  ipcMain.handle("library:list", () => library.list());
  ipcMain.handle("library:delete", (_event, id: string) => library.delete(id));
  ipcMain.handle("library:list-deleted", () => library.listDeleted());
  ipcMain.handle("library:restore", (_event, id: string) => library.restore(id));
  ipcMain.handle("library:permanently-delete", (_event, id: string) =>
    library.permanentlyDelete(id));
  ipcMain.handle("library:update", (_event, id: string, update: TrackUpdate) =>
    library.update(id, update));
  ipcMain.handle("library:choose-cover", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择歌曲封面",
      properties: ["openFile"],
      filters: [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp"] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return {
      sourcePath: result.filePaths[0],
      previewUrl: pathToFileURL(result.filePaths[0]).href
    };
  });
  ipcMain.handle("library:save-cropped-cover", async (_event, dataUrl: string) => {
    if (!/^data:image\/png;base64,/.test(dataUrl)) throw new Error("封面图片格式无效。");
    const destination = path.join(dataDirectory, `cover-edit-${Date.now()}.png`);
    await writeFile(destination, Buffer.from(dataUrl.split(",")[1], "base64"));
    return { sourcePath: destination, previewUrl: pathToFileURL(destination).href };
  });
  ipcMain.handle("audio:split", (_event, id: string, segments: AudioSegment[]) =>
    audioEditService.split(id, segments));
  ipcMain.handle("audio:cancel-split", () => audioEditService.cancel());
  ipcMain.handle("media:import-local", async () => {
    const result = await dialog.showOpenDialog({
      title: "导入本地音频",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "音频", extensions: ["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "webm"] }]
    });
    if (result.canceled) return [];
    return mediaService.importLocal(result.filePaths);
  });
  ipcMain.handle("media:import-local-folder", async () => {
    const result = await dialog.showOpenDialog({
      title: "导入音乐文件夹",
      properties: ["openDirectory"]
    });
    if (result.canceled || !result.filePaths[0]) return [];
    const filePaths = await collectAudioFiles(result.filePaths[0]);
    if (!filePaths.length) throw new Error("所选文件夹中没有受支持的音频文件。");
    return mediaService.importLocal(filePaths);
  });
  ipcMain.handle("media:import-local-paths", async (_event, filePaths: string[]) => {
    const acceptedPaths = [...new Set(filePaths)].filter((filePath) =>
      path.isAbsolute(filePath) &&
      existsSync(filePath) &&
      supportedAudioExtensions.has(path.extname(filePath).toLowerCase())
    );
    if (!acceptedPaths.length) throw new Error("没有找到可导入的音频文件。");
    return mediaService.importLocal(acceptedPaths);
  });
  ipcMain.handle("media:export", async (_event, id: string) => {
    const track = (await library.list()).find((item) => item.id === id);
    if (!track) throw new Error("没有找到要导出的音频。");
    const result = await dialog.showSaveDialog({
      title: "导出音频",
      defaultPath: `${track.title}${path.extname(track.filePath)}`
    });
    if (result.canceled || !result.filePath) return false;
    await audioEditService.exportWithMetadata(track, result.filePath);
    return true;
  });
  ipcMain.handle("media:reveal", async (_event, id: string) => {
    const track = (await library.list()).find((item) => item.id === id);
    if (!track) return false;
    shell.showItemInFolder(track.filePath);
    return true;
  });
  ipcMain.handle("lyrics:import-lrc", async (_event, id: string) => {
    const result = await dialog.showOpenDialog({
      title: "导入 LRC 歌词",
      properties: ["openFile"],
      filters: [{ name: "LRC 歌词", extensions: ["lrc"] }, { name: "文本", extensions: ["txt"] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return library.importLrc(id, await readFile(result.filePaths[0], "utf8"));
  });
  ipcMain.handle("lyrics:export-lrc", async (_event, id: string) => {
    const track = (await library.list()).find((item) => item.id === id);
    if (!track) throw new Error("没有找到音频。");
    if (!track.lyrics?.lines.length) throw new Error("这首歌曲还没有可导出的歌词。");
    const result = await dialog.showSaveDialog({
      title: "导出 LRC 歌词",
      defaultPath: `${track.title}.lrc`,
      filters: [{ name: "LRC 歌词", extensions: ["lrc"] }]
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, await library.exportLrc(id), "utf8");
    return true;
  });
  ipcMain.handle("library:backup", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择备份保存位置",
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || !result.filePaths[0]) return false;
    await library.backupTo(result.filePaths[0]);
    return true;
  });
  ipcMain.handle("library:restore-backup", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择 LyraLink 备份文件夹",
      properties: ["openDirectory"]
    });
    if (result.canceled || !result.filePaths[0]) return false;
    await library.restoreFrom(result.filePaths[0]);
    return true;
  });
  ipcMain.handle("library:clean-trash", async () => {
    const settings = await settingsStore.get();
    return library.cleanTrash(settings.trashRetentionDays);
  });
  ipcMain.handle("playlists:list", () => library.listPlaylists());
  ipcMain.handle("playlists:create", (_event, name: string) => library.createPlaylist(name));
  ipcMain.handle("playlists:rename", (_event, id: string, name: string) =>
    library.renamePlaylist(id, name));
  ipcMain.handle("playlists:delete", (_event, id: string) => library.deletePlaylist(id));
  ipcMain.handle("playlists:update", (_event, id: string, trackIds: string[]) =>
    library.updatePlaylist(id, trackIds));
  ipcMain.handle("folders:list", () => library.listFolders());
  ipcMain.handle("folders:create", (_event, name: string) => library.createFolder(name));
  ipcMain.handle("folders:rename", (_event, id: string, name: string) =>
    library.renameFolder(id, name));
  ipcMain.handle("folders:delete", (_event, id: string) => library.deleteFolder(id));
  ipcMain.handle(
    "library:save-lyrics",
    (_event, id: string, lines: LyricLine[], source?: "manual" | "ai") =>
      library.saveLyrics(id, lines, source)
  );
  ipcMain.handle("ai:align-lyrics", (_event, id: string, texts: string[]) =>
    aiLyricsService.align(id, texts));
  ipcMain.handle("ai:cancel", () => aiLyricsService.cancel());
  ipcMain.handle("settings:get", () => settingsStore.get());
  ipcMain.handle("settings:save", (_event, settings: AppSettings) => settingsStore.save(settings));

  createWindow();
  const settings = await settingsStore.get();
  void library.cleanTrash(settings.trashRetentionDays);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
