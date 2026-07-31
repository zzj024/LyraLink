export type Platform = "bilibili" | "local";

export interface AppSettings {
  confirmedAuthorized: boolean;
  trashRetentionDays: number;
  onboardingCompleted: boolean;
  defaultPlayMode?: "list" | "repeat" | "shuffle";
  rememberVolume?: boolean;
  defaultSort?: "newest" | "title" | "author" | "duration";
  showSourceColumn?: boolean;
  theme?: "light" | "dark";
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

export interface LyricsTrack {
  source: "manual" | "ai";
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
}

export interface ImportProgress {
  stage: "parsing" | "downloading" | "saving" | "complete" | "error";
  message: string;
  percent?: number;
  taskId?: string;
  title?: string;
}

export interface LinkAudioApi {
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
  saveLyrics(id: string, lines: LyricLine[], source?: "manual" | "ai"): Promise<Track>;
  alignLyrics(id: string, texts: string[]): Promise<LyricLine[]>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  onProgress(listener: (progress: ImportProgress) => void): () => void;
}
