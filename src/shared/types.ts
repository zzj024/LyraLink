export type Platform = "bilibili" | "netease" | "joox" | "local";

export interface CustomThemeConfig {
  id: string;
  name: string;
  accent: string;
  surface: string;
  mode: "dark" | "light";
}

export interface AppSettings {
  confirmedAuthorized: boolean;
  trashRetentionDays: number;
  onboardingCompleted: boolean;
  defaultPlayMode?: "list" | "repeat" | "shuffle";
  rememberVolume?: boolean;
  defaultSort?: "newest" | "title" | "author" | "duration";
  showSourceColumn?: boolean;
  theme?: string;
  closeBehavior?: "tray" | "taskbar" | "exit";
  customTheme?: {
    accent: string;
    surface: string;
    sidebar: string;
  };
  /** 用户创建的多个自定义主题 */
  customThemes?: CustomThemeConfig[];
  /** 预设主题的用户修改（按主题 id 记录颜色覆盖） */
  themeOverrides?: Record<string, { accent: string; surface: string }>;
}

export interface ParsedLink {
  platform: Platform;
  url: string;
}

export interface MediaPreview {
  platform: Platform;
  url: string;
  title: string;
  author: string;
  duration: number | null;
  thumbnail: string | null;
}

export interface LyricLine {
  start: number;
  end: number | null;
  text: string;
  confidence?: number;
}

export interface OnlineSearchResult extends MediaPreview {
  /** Canonical platform page URL, used by the existing authorized download flow. */
  id: string;
}

export interface OnlineSearchPage {
  items: OnlineSearchResult[];
  page: number;
  hasMore: boolean;
}

export interface OnlineLyricsCandidate {
  id: string;
  provider: string;
  title: string;
  author: string;
  album: string | null;
  duration: number | null;
  mode: "synced" | "plain";
}

export interface DesktopLyricsState {
  title: string;
  author: string;
  coverUrl: string;
  currentLine: string;
  nextLine: string;
  hasLyrics: boolean;
  isPlaying: boolean;
  playMode: "list" | "repeat" | "shuffle";
  locked: boolean;
}

export type DesktopLyricsAction = "previous" | "toggle" | "next" | "cycle-mode";

export interface LyricsTrack {
  source: "manual" | "ai" | "online";
  updatedAt: string;
  lines: LyricLine[];
}

export interface Track extends MediaPreview {
  id: string;
  filePath: string;
  fileUrl: string;
  coverPath: string | null;
  lyrics: LyricsTrack | null;
  favorite: boolean;
  folderIds: string[];
  sourceTrackId?: string | null;
  contentHash?: string | null;
  importedAt: string;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AudioFolder {
  id: string;
  name: string;
  createdAt: string;
}

export interface TrackUpdate {
  title: string;
  author: string;
  favorite: boolean;
  folderIds: string[];
  coverSourcePath?: string | null;
}

export interface AudioSegment {
  title: string;
  author?: string;
  start: number;
  end: number;
  mode?: "accurate" | "fast";
}

export interface CoverSelection {
  sourcePath: string;
  previewUrl: string;
}

export interface DeletedTrack extends Track {
  deletedAt: string;
}

export interface ImportRequest {
  input: string;
  taskId?: string;
  /** 搜索结果里已有的元数据，避免导入时二次请求（Joox 等聚合源使用） */
  meta?: {
    title?: string;
    author?: string;
    duration?: number | null;
    thumbnail?: string | null;
  };
}

export interface ImportProgress {
  stage: "parsing" | "downloading" | "saving" | "complete" | "error";
  message: string;
  percent?: number;
  taskId?: string;
  title?: string;
}

export interface LinkAudioApi {
  searchBilibili(query: string, page: number): Promise<OnlineSearchPage>;
  searchNetease(query: string, page: number): Promise<OnlineSearchPage>;
  searchJoox(query: string, page: number): Promise<OnlineSearchPage>;
  resolveNeteasePreview(songId: string): Promise<string>;
  resolveStreamPreview(url: string): Promise<string>;
  resolveBilibiliPreview(url: string): Promise<string>;
  importAudio(request: ImportRequest): Promise<Track>;
  listTracks(): Promise<Track[]>;
  deleteTrack(id: string): Promise<Track[]>;
  listDeletedTracks(): Promise<DeletedTrack[]>;
  restoreTrack(id: string): Promise<{ tracks: Track[]; deleted: DeletedTrack[] }>;
  permanentlyDeleteTrack(id: string): Promise<DeletedTrack[]>;
  updateTrack(id: string, update: TrackUpdate): Promise<Track>;
  chooseTrackCover(): Promise<CoverSelection | null>;
  saveCroppedCover(dataUrl: string): Promise<CoverSelection>;
  splitTrack(id: string, segments: AudioSegment[]): Promise<Track[]>;
  cancelSplit(): Promise<boolean>;
  cancelAiAlignment(): Promise<boolean>;
  importLocalAudio(): Promise<Track[]>;
  importLocalFolder(): Promise<Track[]>;
  importLocalPaths(paths: string[]): Promise<Track[]>;
  getPathForFile(file: File): string;
  exportTrack(id: string): Promise<boolean>;
  revealTrack(id: string): Promise<boolean>;
  importLrc(id: string): Promise<Track | null>;
  exportLrc(id: string): Promise<boolean>;
  fetchBilibiliLyrics(id: string): Promise<Track>;
  autoMatchLyrics(id: string): Promise<{ track: Track; mode: "synced" | "ai"; provider: string }>;
  searchOnlineLyrics(id: string): Promise<OnlineLyricsCandidate[]>;
  searchLyricsByKeyword(id: string, keyword: string): Promise<OnlineLyricsCandidate[]>;
  applyOnlineLyrics(id: string, candidateId: string): Promise<{ text: string; mode: "synced" | "plain"; provider: string }>;
  backupLibrary(): Promise<boolean>;
  restoreLibraryBackup(): Promise<boolean>;
  cleanTrash(): Promise<DeletedTrack[]>;
  listPlaylists(): Promise<Playlist[]>;
  createPlaylist(name: string): Promise<Playlist[]>;
  renamePlaylist(id: string, name: string): Promise<Playlist[]>;
  deletePlaylist(id: string): Promise<Playlist[]>;
  updatePlaylist(id: string, trackIds: string[]): Promise<Playlist[]>;
  listFolders(): Promise<AudioFolder[]>;
  createFolder(name: string): Promise<AudioFolder[]>;
  renameFolder(id: string, name: string): Promise<AudioFolder[]>;
  deleteFolder(id: string): Promise<{ folders: AudioFolder[]; tracks: Track[] }>;
  saveLyrics(id: string, lines: LyricLine[], source?: "manual" | "ai" | "online"): Promise<Track>;
  alignLyrics(id: string, texts: string[]): Promise<LyricLine[]>;
  chooseWallpaper(): Promise<{ path: string; url: string } | null>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  openDesktopLyrics(): Promise<void>;
  updateDesktopLyrics(state: DesktopLyricsState): void;
  hideDesktopLyrics(): void;
  setDesktopLyricsLocked(locked: boolean): void;
  setDesktopLyricsSettingsOpen(open: boolean): void;
  setDesktopLyricsClickThrough(ignore: boolean): void;
  setDesktopLyricsCompactHeight(height: number): void;
  controlDesktopLyrics(action: DesktopLyricsAction): void;
  onDesktopLyricsUpdate(listener: (state: DesktopLyricsState) => void): () => void;
  onDesktopLyricsAction(listener: (action: DesktopLyricsAction) => void): () => void;
  onDesktopLyricsReveal(listener: () => void): () => void;
  onDesktopLyricsPointerLeave(listener: () => void): () => void;
  onDesktopLyricsVisibility(listener: (visible: boolean) => void): () => void;
  minimizeWindow(): void;
  toggleMaximizeWindow(): void;
  closeWindow(): void;
  onWindowMaximizedChange(listener: (maximized: boolean) => void): () => void;
  showMainWindow(): void;
  hideTrayMenu(): void;
  quitApp(): void;
  onProgress(listener: (progress: ImportProgress) => void): () => void;
}
