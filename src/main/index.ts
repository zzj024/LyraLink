import { app, BrowserWindow, dialog, ipcMain, Menu, screen, session, shell, Tray } from "electron";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import type { AppSettings, AudioSegment, DesktopLyricsAction, DesktopLyricsState, ImportRequest, LyricLine, TrackUpdate } from "../shared/types.js";
import { AudioEditService } from "./audio-edit-service.js";
import { AiLyricsService } from "./ai-lyrics-service.js";
import { migrateLegacyUserData } from "./legacy-migration.js";
import { TrackLibrary } from "./library.js";
import { MediaService } from "./media-service.js";
import { SettingsStore } from "./settings.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
// GPU shader 磁盘缓存目录在某些 Windows 环境下会因权限/占用反复报
// "Unable to move the cache: 拒绝访问"；该缓存只是加速着色器编译，直接禁用无副作用。
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
const supportedAudioExtensions = new Set([
  ".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus", ".webm"
]);
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let closeBehavior: NonNullable<AppSettings["closeBehavior"]> = "tray";
let tray: Tray | null = null;
let trayMenuWindow: BrowserWindow | null = null;
let desktopLyricsWindow: BrowserWindow | null = null;
let desktopLyricsCompactHeight = 126;
let desktopLyricsSettingsOpen = false;
let desktopLyricsHoverTimer: NodeJS.Timeout | null = null;
let desktopLyricsBounds: { x: number; y: number; width: number; height: number } | null = null;
let desktopLyricsBoundsSaveTimer: NodeJS.Timeout | null = null;
let desktopLyricsState: DesktopLyricsState = {
  title: "LyraLink", author: "", coverUrl: "", currentLine: "正在等待播放", nextLine: "", hasLyrics: false,
  isPlaying: false, playMode: "list", locked: false
};

function notifyDesktopLyricsVisibility(visible: boolean): void {
  mainWindow?.webContents.send("desktop-lyrics:visibility", visible);
}

function sendDesktopLyricsState(): void {
  desktopLyricsWindow?.webContents.send("desktop-lyrics:state", desktopLyricsState);
  trayMenuWindow?.webContents.send("desktop-lyrics:state", desktopLyricsState);
  tray?.setToolTip(desktopLyricsState.title === "LyraLink"
    ? "LyraLink" : `LyraLink · ${desktopLyricsState.title}`);
}

function createTrayMenuWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 330, height: 372, frame: false, transparent: true, resizable: false,
    show: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(currentDirectory, "preload.cjs"),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  window.setAlwaysOnTop(true, "pop-up-menu");
  window.on("blur", () => window.hide());
  window.on("closed", () => { trayMenuWindow = null; });
  window.webContents.once("did-finish-load", sendDesktopLyricsState);
  void window.loadFile(path.join(currentDirectory, "../renderer/tray-menu.html"));
  trayMenuWindow = window;
  return window;
}

function showTrayMenu(): void {
  const window = trayMenuWindow && !trayMenuWindow.isDestroyed()
    ? trayMenuWindow : createTrayMenuWindow();
  if (window.isVisible()) {
    window.hide();
    return;
  }
  const point = screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(point).workArea;
  const [width, height] = window.getSize();
  const x = Math.max(area.x + 8, Math.min(point.x - width + 18, area.x + area.width - width - 8));
  const y = Math.max(area.y + 8, Math.min(point.y - height - 10, area.y + area.height - height - 8));
  window.setPosition(x, y, false);
  window.show();
  window.focus();
  sendDesktopLyricsState();
}

function restoreMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function sendPlayerAction(action: DesktopLyricsAction): void {
  mainWindow?.webContents.send("desktop-lyrics:action", action);
}

function createTray(): void {
  if (tray) return;
  // 打包后 resources 目录由 extraResources 提供 icon.ico；开发态直接取源码目录
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "icon.ico")
    : path.join(process.cwd(), "resources", "icon.ico");
  tray = new Tray(iconPath);
  tray.setToolTip("LyraLink");
  tray.on("double-click", restoreMainWindow);
  tray.on("right-click", showTrayMenu);
}

function stopDesktopLyricsHoverTracking(): void {
  if (desktopLyricsHoverTimer) clearInterval(desktopLyricsHoverTimer);
  desktopLyricsHoverTimer = null;
}

function startDesktopLyricsHoverTracking(): void {
  stopDesktopLyricsHoverTracking();
  desktopLyricsHoverTimer = setInterval(() => {
    const window = desktopLyricsWindow;
    if (!window || window.isDestroyed() || !window.isVisible()) {
      stopDesktopLyricsHoverTracking();
      return;
    }
    const point = screen.getCursorScreenPoint();
    const bounds = window.getBounds();
    const inside = point.x >= bounds.x && point.x < bounds.x + bounds.width
      && point.y >= bounds.y && point.y < bounds.y + bounds.height;
    if (inside) return;
    window.webContents.send("desktop-lyrics:pointer-leave");
    if (!desktopLyricsState.locked) window.setIgnoreMouseEvents(true, { forward: true });
    stopDesktopLyricsHoverTracking();
  }, 70);
}

function desktopLyricsBoundsPath(): string {
  return path.join(app.getPath("userData"), "desktop-lyrics-bounds.json");
}

function loadDesktopLyricsBounds(): void {
  try {
    const raw = JSON.parse(readFileSync(desktopLyricsBoundsPath(), "utf8")) as
      { x: number; y: number; width: number; height: number } | null;
    if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)
      && raw.width >= 420 && raw.height >= 100) {
      desktopLyricsBounds = raw;
    }
  } catch {
    desktopLyricsBounds = null;
  }
}

function rememberDesktopLyricsBounds(): void {
  const window = desktopLyricsWindow;
  if (!window || window.isDestroyed() || !window.isVisible()) return;
  desktopLyricsBounds = window.getBounds();
  if (desktopLyricsBoundsSaveTimer) clearTimeout(desktopLyricsBoundsSaveTimer);
  desktopLyricsBoundsSaveTimer = setTimeout(() => {
    try {
      writeFileSync(desktopLyricsBoundsPath(), JSON.stringify(desktopLyricsBounds));
    } catch {
      // 位置记忆失败不影响功能
    }
  }, 600);
}

// 默认停靠位置：优先落在主窗口之外（正下方留白 → 正上方留白），
// 都放不下时退回工作区底部居中，避免盖住主窗口底部的播放栏
function placeDesktopLyricsDefault(window: BrowserWindow): void {
  if (desktopLyricsBounds) {
    const area = screen.getDisplayNearestPoint({ x: desktopLyricsBounds.x, y: desktopLyricsBounds.y }).workArea;
    const x = Math.max(area.x, Math.min(desktopLyricsBounds.x, area.x + area.width - desktopLyricsBounds.width));
    const y = Math.max(area.y, Math.min(desktopLyricsBounds.y, area.y + area.height - desktopLyricsBounds.height));
    window.setBounds({ ...desktopLyricsBounds, x, y });
    return;
  }
  const [width, height] = window.getSize();
  const area = screen.getPrimaryDisplay().workArea;
  const centerX = area.x + Math.round((area.width - width) / 2);
  const bottomY = area.y + area.height - height - 12;
  const mainBounds = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
    ? mainWindow.getBounds() : null;
  const overlapsMain = mainBounds
    && centerX < mainBounds.x + mainBounds.width && centerX + width > mainBounds.x
    && bottomY < mainBounds.y + mainBounds.height && bottomY + height > mainBounds.y;
  if (overlapsMain && mainBounds) {
    // 主窗口下方有足够留白时贴底放下，否则放到主窗口上方
    if (area.y + area.height - (mainBounds.y + mainBounds.height) >= height + 12) {
      window.setPosition(centerX, area.y + area.height - height - 12);
      return;
    }
    if (mainBounds.y - area.y >= height + 12) {
      window.setPosition(centerX, mainBounds.y - height - 12);
      return;
    }
  }
  window.setPosition(centerX, bottomY);
}

function createDesktopLyricsWindow(): BrowserWindow {
  loadDesktopLyricsBounds();
  const window = new BrowserWindow({
    width: 660, height: desktopLyricsCompactHeight, minWidth: 420, minHeight: 100,
    frame: false, transparent: true, alwaysOnTop: true, resizable: true,
    skipTaskbar: true, hasShadow: false, backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(currentDirectory, "preload.cjs"),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  window.setAlwaysOnTop(true, "floating");
  placeDesktopLyricsDefault(window);
  window.on("close", (event) => { event.preventDefault(); window.hide(); });
  window.on("hide", () => notifyDesktopLyricsVisibility(false));
  window.on("show", () => notifyDesktopLyricsVisibility(true));
  window.on("moved", rememberDesktopLyricsBounds);
  window.on("resized", rememberDesktopLyricsBounds);
  window.webContents.once("did-finish-load", () => {
    sendDesktopLyricsState();
    window.webContents.send("desktop-lyrics:reveal");
  });
  void window.loadFile(path.join(currentDirectory, "../renderer/desktop-lyrics.html"));
  desktopLyricsWindow = window;
  return window;
}

function showDesktopLyrics(): void {
  const window = desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()
    ? desktopLyricsWindow : createDesktopLyricsWindow();
  desktopLyricsState.locked = false;
  desktopLyricsSettingsOpen = false;
  window.setIgnoreMouseEvents(false);
  const [width] = window.getSize();
  window.setSize(width, desktopLyricsCompactHeight);
  // showInactive 不抢焦点：桌面歌词是悬浮展示，不应打断用户正在输入的窗口
  window.showInactive();
  sendDesktopLyricsState();
  window.webContents.send("desktop-lyrics:reveal");
  notifyDesktopLyricsVisibility(true);
}

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

// 首次最小化到托盘时用系统气泡告知用户：程序没有退出，音乐还在播
function notifyTrayHideOnce(): void {
  const markerPath = path.join(app.getPath("userData"), ".tray-hint-shown");
  if (!tray || existsSync(markerPath)) return;
  try {
    writeFileSync(markerPath, new Date().toISOString());
  } catch {
    return;
  }
  try {
    tray.displayBalloon({
      title: "LyraLink 还在运行",
      content: "窗口已最小化到系统托盘，播放不会停止。双击托盘图标可重新打开窗口。",
      iconType: "info"
    });
  } catch {
    // 部分系统不支持气泡通知，忽略即可
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#f4f0e8",
    frame: false,
    icon: app.isPackaged ? undefined : path.join(process.cwd(), "resources", "icon.ico"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(currentDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  // 开发模式：设置 VITE_DEV_SERVER_URL 时从 Vite dev server 加载（支持 HMR）；
  // 生产始终从 dist/renderer 以 file:// 加载。
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  void (devServerUrl
    ? mainWindow.loadURL(devServerUrl)
    : mainWindow.loadFile(path.join(currentDirectory, "../renderer/index.html")));
  mainWindow.on("closed", () => {
    stopDesktopLyricsHoverTracking();
    if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) desktopLyricsWindow.destroy();
    desktopLyricsWindow = null;
    notifyDesktopLyricsVisibility(false);
  });
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    if (closeBehavior === "exit") {
      isQuitting = true;
      app.quit();
    } else if (closeBehavior === "taskbar") mainWindow?.minimize();
    else {
      mainWindow?.hide();
      notifyTrayHideOnce();
    }
  });
  const reportMaximizedState = () => {
    if (!mainWindow) return;
    mainWindow.webContents.send("window:maximized-change", mainWindow.isMaximized());
  };
  mainWindow.on("maximize", reportMaximizedState);
  mainWindow.on("unmaximize", reportMaximizedState);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
}

// 兜底：网络流中断等异步异常（如 undici "terminated"）只记日志，
// 不允许把整个应用打成崩溃弹窗
process.on("uncaughtException", (error) => {
  console.error("[main] 捕获未处理异常（应用继续运行）:", error);
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (/\.bilivideo\.com$/i.test(new URL(details.url).hostname)) {
      details.requestHeaders.Referer = "https://www.bilibili.com/";
      details.requestHeaders["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
    }
    callback({ requestHeaders: details.requestHeaders });
  });
  const dataDirectory = path.join(app.getPath("userData"), "library");
  const migratedFrom = await migrateLegacyUserData(app.getPath("userData"));
  if (migratedFrom) console.log("[migration] 已从旧版本数据目录迁移:", migratedFrom);
  const offlineDirectory = app.isPackaged
    ? path.join(process.resourcesPath, "offline")
    : path.join(process.cwd(), "resources", "offline");
  const library = new TrackLibrary(dataDirectory);
  const settingsStore = new SettingsStore(dataDirectory);
  await library.initialize();
  const initialSettings = await settingsStore.get();
  closeBehavior = initialSettings.closeBehavior || "tray";

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
    return mediaService.importAudio(request.input, settings.confirmedAuthorized, request.taskId, request.meta);
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
  ipcMain.handle("app:choose-wallpaper", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择壁纸图片",
      properties: ["openFile"],
      filters: [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp", "bmp"] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return { path: result.filePaths[0], url: pathToFileURL(result.filePaths[0]).href };
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
    (_event, id: string, lines: LyricLine[], source?: "manual" | "ai" | "online") =>
      library.saveLyrics(id, lines, source)
  );
  ipcMain.handle("ai:align-lyrics", (_event, id: string, texts: string[]) =>
    aiLyricsService.align(id, texts));
  ipcMain.handle("ai:cancel", () => aiLyricsService.cancel());
  ipcMain.handle("settings:get", () => settingsStore.get());
  ipcMain.handle("settings:save", async (_event, settings: AppSettings) => {
    const saved = await settingsStore.save(settings);
    closeBehavior = saved.closeBehavior || "tray";
    return saved;
  });
  ipcMain.handle("media:search-bilibili", (_event, query: string, page: number) =>
    mediaService.searchBilibili(query, page));
  ipcMain.handle("media:search-netease", (_event, query: string, page: number) =>
    mediaService.searchNetease(query, page));
  ipcMain.handle("media:search-joox", (_event, query: string, page: number) =>
    mediaService.searchJoox(query, page));
  ipcMain.handle("media:resolve-netease-preview", (_event, songId: string) =>
    mediaService.resolveNeteasePreview(songId));
  ipcMain.handle("media:resolve-stream-preview", (_event, url: string) =>
    mediaService.resolveStreamPreview(url));
  ipcMain.handle("media:resolve-bilibili-preview", (_event, url: string) =>
    mediaService.resolveBilibiliPreview(url));
  ipcMain.handle("lyrics:fetch-bilibili", (_event, id: string) =>
    mediaService.importBilibiliLyrics(id));
  ipcMain.handle("lyrics:auto-match", async (_event, id: string) => {
    const result = await mediaService.lookupOnlineLyrics(id);
    if (result.synced) {
      return { track: await library.saveLyrics(id, result.synced, "online"), mode: "synced" as const, provider: result.provider };
    }
    const lines = await aiLyricsService.align(id, result.plain || []);
    return { track: await library.saveLyrics(id, lines, "ai"), mode: "ai" as const, provider: result.provider };
  });
  ipcMain.handle("lyrics:search-online", (_event, id: string) => mediaService.searchOnlineLyrics(id));
  ipcMain.handle("lyrics:search-by-keyword", (_event, id: string, keyword: string) =>
    mediaService.searchLyricsByKeyword(id, keyword));
  ipcMain.handle("lyrics:apply-online", async (_event, id: string, candidateId: string) => {
    const result = await mediaService.resolveOnlineLyricsCandidate(id, candidateId);
    if (result.synced?.length) {
      // 直接命中 LRC 歌词文件：带时间轴返回，工作台可跳过打轴直接校验
      const text = result.synced
        .map((line) => {
          const minutes = Math.floor(line.start / 60).toString().padStart(2, "0");
          const seconds = (line.start % 60).toFixed(2).padStart(5, "0");
          return `[${minutes}:${seconds}]${line.text}`;
        })
        .join("\n");
      return { text, mode: "synced" as const, provider: result.provider };
    }
    const plain = result.plain || [];
    if (!plain.length) throw new Error("该歌词版本没有可编辑的文本。");
    return { text: plain.join(String.fromCharCode(10)), mode: "plain" as const, provider: result.provider };
  });
  ipcMain.handle("desktop-lyrics:open", showDesktopLyrics);
  ipcMain.on("desktop-lyrics:update", (_event, state: DesktopLyricsState) => {
    desktopLyricsState = { ...state, locked: desktopLyricsState.locked };
    sendDesktopLyricsState();
  });
  ipcMain.on("desktop-lyrics:hide", () => desktopLyricsWindow?.hide());  ipcMain.on("desktop-lyrics:lock", (_event, locked: boolean) => {
    desktopLyricsState.locked = Boolean(locked);
    desktopLyricsWindow?.setIgnoreMouseEvents(desktopLyricsState.locked, { forward: true });
    sendDesktopLyricsState();
  });
  ipcMain.on("desktop-lyrics:settings", (_event, open: boolean) => {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
    desktopLyricsSettingsOpen = Boolean(open);
    const [width] = desktopLyricsWindow.getSize();
    desktopLyricsWindow.setSize(width, desktopLyricsSettingsOpen ? 360 : desktopLyricsCompactHeight, true);
  });
  ipcMain.on("desktop-lyrics:compact-height", (_event, height: number) => {
    desktopLyricsCompactHeight = Math.max(100, Math.min(180, Math.round(Number(height) || 126)));
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed() || desktopLyricsSettingsOpen) return;
    const [width] = desktopLyricsWindow.getSize();
    desktopLyricsWindow.setSize(width, desktopLyricsCompactHeight);
  });
  ipcMain.on("desktop-lyrics:click-through", (_event, ignore: boolean) => {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed() || desktopLyricsState.locked) return;
    const shouldIgnore = Boolean(ignore);
    desktopLyricsWindow.setIgnoreMouseEvents(shouldIgnore, { forward: true });
    if (shouldIgnore) stopDesktopLyricsHoverTracking();
    else startDesktopLyricsHoverTracking();
  });
  ipcMain.on("desktop-lyrics:control", (_event, action: DesktopLyricsAction) => {
    mainWindow?.webContents.send("desktop-lyrics:action", action);
  });
  ipcMain.on("window:minimize", () => mainWindow?.minimize());
  ipcMain.on("window:toggle-maximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on("window:close", () => mainWindow?.close());
  ipcMain.on("window:show-main", restoreMainWindow);
  ipcMain.on("tray-menu:hide", () => trayMenuWindow?.hide());
  ipcMain.on("app:quit", () => { isQuitting = true; app.quit(); });

  createWindow();
  createTray();
  void library.cleanTrash(initialSettings.trashRetentionDays);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => { isQuitting = true; });
