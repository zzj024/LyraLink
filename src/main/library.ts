import crypto from "node:crypto";
import { access, copyFile, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AudioFolder, DeletedTrack, LyricLine, Playlist, Track, TrackUpdate } from "../shared/types.js";

interface StoredTrack extends Omit<Track, "fileUrl"> {}

export class TrackLibrary {
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly indexPath: string;
  private readonly foldersPath: string;
  private readonly trashIndexPath: string;
  private readonly playlistsPath: string;
  private readonly trashDirectory: string;
  readonly mediaDirectory: string;

  constructor(readonly dataDirectory: string) {
    this.indexPath = path.join(dataDirectory, "library.json");
    this.foldersPath = path.join(dataDirectory, "folders.json");
    this.trashIndexPath = path.join(dataDirectory, "trash.json");
    this.playlistsPath = path.join(dataDirectory, "playlists.json");
    this.trashDirectory = path.join(dataDirectory, "trash");
    this.mediaDirectory = path.join(dataDirectory, "media");
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.mediaDirectory, { recursive: true }),
      mkdir(this.trashDirectory, { recursive: true })
    ]);
  }

  private async safeWrite(filePath: string, value: unknown): Promise<void> {
    const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    const backupPath = `${filePath}.bak`;
    try {
      await writeFile(temporaryPath, JSON.stringify(value, null, 2), "utf8");
      try {
        await copyFile(filePath, backupPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await rm(filePath, { force: true });
      await rename(temporaryPath, filePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  private async readJson<T>(filePath: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await readFile(filePath, "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
      try {
        return JSON.parse(await readFile(`${filePath}.bak`, "utf8")) as T;
      } catch {
        throw error;
      }
    }
  }

  async list(): Promise<Track[]> {
    await this.initialize();
    try {
      const stored = await this.readJson<StoredTrack[]>(this.indexPath, []);
      return stored
        .map((track) => ({
          ...track,
          coverPath: track.coverPath || null,
          lyrics: track.lyrics || null,
          favorite: track.favorite || false,
          folderIds: track.folderIds || [],
          sourceTrackId: track.sourceTrackId || null,
          contentHash: track.contentHash || null,
          thumbnail: track.coverPath ? pathToFileURL(track.coverPath).href : track.thumbnail,
          fileUrl: pathToFileURL(track.filePath).href
        }))
        .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async add(track: StoredTrack): Promise<Track> {
    return this.serializeMutation(async () => {
      const tracks = await this.list();
      const next = [track, ...tracks.map(({ fileUrl: _fileUrl, ...item }) => item)];
      await this.safeWrite(this.indexPath, next);
      return {
        ...track,
        thumbnail: track.coverPath ? pathToFileURL(track.coverPath).href : track.thumbnail,
        fileUrl: pathToFileURL(track.filePath).href
      };
    });
  }

  async addMany(newTracks: StoredTrack[]): Promise<Track[]> {
    return this.serializeMutation(async () => {
      const tracks = await this.list();
      await this.safeWrite(
        this.indexPath,
        [...newTracks, ...tracks.map(({ fileUrl: _fileUrl, ...item }) => item)]
      );
      return newTracks.map((track) => ({
        ...track,
        thumbnail: track.coverPath ? pathToFileURL(track.coverPath).href : track.thumbnail,
        fileUrl: pathToFileURL(track.filePath).href
      }));
    });
  }

  private async serializeMutation<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue;
    let release = () => {};
    this.mutationQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }

  private async writeTracks(tracks: Track[]): Promise<void> {
    await this.safeWrite(
      this.indexPath,
      tracks.map(({ fileUrl: _fileUrl, ...track }) => track)
    );
  }

  async update(id: string, update: TrackUpdate): Promise<Track> {
    const tracks = await this.list();
    const target = tracks.find((track) => track.id === id);
    if (!target) throw new Error("没有找到要编辑的音频。");
    const folders = await this.listFolders();
    const validFolderIds = new Set(folders.map((folder) => folder.id));
    let updated = {
      ...target,
      title: update.title.trim() || target.title,
      author: update.author.trim() || "未知作者",
      favorite: Boolean(update.favorite),
      folderIds: [...new Set(update.folderIds)].filter((folderId) => validFolderIds.has(folderId))
    };
    const previousCover = target.coverPath;
    if (update.coverSourcePath) {
      updated = await this.copyCoverForTrack(updated, update.coverSourcePath);
    }
    await this.writeTracks(tracks.map((track) => track.id === id ? updated : track));
    if (update.coverSourcePath && previousCover && previousCover !== updated.coverPath) {
      await rm(previousCover, { force: true });
    }
    return updated;
  }

  private async copyCoverForTrack(target: Track, sourcePath: string): Promise<Track> {
    const extension = path.extname(sourcePath).toLowerCase() || ".jpg";
    const destination = path.join(this.mediaDirectory, `${target.id}.cover${extension}`);
    await copyFile(sourcePath, destination);
    return {
      ...target,
      coverPath: destination,
      thumbnail: `${pathToFileURL(destination).href}?v=${Date.now()}`
    };
  }

  async listFolders(): Promise<AudioFolder[]> {
    return this.readJson<AudioFolder[]>(this.foldersPath, []);
  }

  async createFolder(name: string): Promise<AudioFolder[]> {
    const cleanName = name.trim();
    if (!cleanName) throw new Error("文件夹名称不能为空。");
    const folders = await this.listFolders();
    if (folders.some((folder) => folder.name.toLowerCase() === cleanName.toLowerCase())) {
      throw new Error("已经存在同名文件夹。");
    }
    const next = [...folders, { id: crypto.randomUUID(), name: cleanName, createdAt: new Date().toISOString() }];
    await this.safeWrite(this.foldersPath, next);
    return next;
  }

  async renameFolder(id: string, name: string): Promise<AudioFolder[]> {
    const cleanName = name.trim();
    if (!cleanName) throw new Error("文件夹名称不能为空。");
    const folders = await this.listFolders();
    if (!folders.some((folder) => folder.id === id)) throw new Error("没有找到该文件夹。");
    if (folders.some((folder) => folder.id !== id && folder.name.toLowerCase() === cleanName.toLowerCase())) {
      throw new Error("已经存在同名文件夹。");
    }
    const next = folders.map((folder) => folder.id === id ? { ...folder, name: cleanName } : folder);
    await this.safeWrite(this.foldersPath, next);
    return next;
  }

  async deleteFolder(id: string): Promise<{ folders: AudioFolder[]; tracks: Track[] }> {
    const folders = (await this.listFolders()).filter((folder) => folder.id !== id);
    await this.safeWrite(this.foldersPath, folders);
    const tracks = (await this.list()).map((track) => ({
      ...track,
      folderIds: track.folderIds.filter((folderId) => folderId !== id)
    }));
    await this.writeTracks(tracks);
    return { folders, tracks };
  }

  async listPlaylists(): Promise<Playlist[]> {
    return this.readJson<Playlist[]>(this.playlistsPath, []);
  }

  async createPlaylist(name: string): Promise<Playlist[]> {
    const cleanName = name.trim();
    if (!cleanName) throw new Error("歌单名称不能为空。");
    const playlists = await this.listPlaylists();
    if (playlists.some((item) => item.name.toLowerCase() === cleanName.toLowerCase())) {
      throw new Error("已经存在同名歌单。");
    }
    const now = new Date().toISOString();
    const next = [...playlists, {
      id: crypto.randomUUID(), name: cleanName, trackIds: [], createdAt: now, updatedAt: now
    }];
    await this.safeWrite(this.playlistsPath, next);
    return next;
  }

  async renamePlaylist(id: string, name: string): Promise<Playlist[]> {
    const cleanName = name.trim();
    if (!cleanName) throw new Error("歌单名称不能为空。");
    const playlists = await this.listPlaylists();
    const next = playlists.map((item) => item.id === id
      ? { ...item, name: cleanName, updatedAt: new Date().toISOString() }
      : item);
    await this.safeWrite(this.playlistsPath, next);
    return next;
  }

  async deletePlaylist(id: string): Promise<Playlist[]> {
    const next = (await this.listPlaylists()).filter((item) => item.id !== id);
    await this.safeWrite(this.playlistsPath, next);
    return next;
  }

  async updatePlaylist(id: string, trackIds: string[]): Promise<Playlist[]> {
    const validIds = new Set((await this.list()).map((track) => track.id));
    const playlists = await this.listPlaylists();
    const next = playlists.map((item) => item.id === id ? {
      ...item,
      trackIds: [...new Set(trackIds)].filter((trackId) => validIds.has(trackId)),
      updatedAt: new Date().toISOString()
    } : item);
    await this.safeWrite(this.playlistsPath, next);
    return next;
  }

  async cleanTrash(retentionDays: number): Promise<DeletedTrack[]> {
    if (retentionDays <= 0) return this.listDeleted();
    const cutoff = Date.now() - retentionDays * 86_400_000;
    let remaining = await this.listDeleted();
    for (const item of [...remaining]) {
      if (new Date(item.deletedAt).getTime() < cutoff) {
        remaining = await this.permanentlyDelete(item.id);
      }
    }
    return remaining;
  }

  async backupTo(destination: string): Promise<void> {
    const target = path.join(destination, `LinkAudio-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    const relative = path.relative(this.dataDirectory, target);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      throw new Error("备份位置不能位于 LinkAudio 当前数据目录中。");
    }
    await cp(this.dataDirectory, target, { recursive: true, force: false, errorOnExist: true });
    await writeFile(path.join(target, "backup-manifest.json"), JSON.stringify({
      app: "LinkAudio", version: 1, createdAt: new Date().toISOString()
    }, null, 2), "utf8");
  }

  async restoreFrom(source: string): Promise<void> {
    if (path.resolve(source) === path.resolve(this.dataDirectory)) {
      throw new Error("不能用当前正在使用的数据目录恢复自身。");
    }
    const manifest = JSON.parse(await readFile(path.join(source, "backup-manifest.json"), "utf8")) as {
      app?: string;
    };
    if (manifest.app !== "LinkAudio") throw new Error("选择的文件夹不是 LinkAudio 备份。");
    const safety = `${this.dataDirectory}.before-restore`;
    await rm(safety, { recursive: true, force: true });
    await cp(this.dataDirectory, safety, { recursive: true });
    try {
      await rm(this.dataDirectory, { recursive: true, force: true });
      await cp(source, this.dataDirectory, { recursive: true });
      await rm(path.join(this.dataDirectory, "backup-manifest.json"), { force: true });
    } catch (error) {
      await rm(this.dataDirectory, { recursive: true, force: true });
      await cp(safety, this.dataDirectory, { recursive: true });
      throw error;
    }
  }

  async delete(id: string): Promise<Track[]> {
    const tracks = await this.list();
    const target = tracks.find((track) => track.id === id);
    if (!target) return tracks;

    const trashFilePath = path.join(this.trashDirectory, `${target.id}${path.extname(target.filePath)}`);
    let trashCoverPath: string | null = null;
    let audioMoved = false;
    let coverMoved = false;
    const deleted = await this.listDeleted();
    try {
      const audioExists = await access(target.filePath).then(() => true).catch(() => false);
      if (audioExists) {
        await rename(target.filePath, trashFilePath);
        audioMoved = true;
      }
      if (target.coverPath &&
          await access(target.coverPath).then(() => true).catch(() => false)) {
        trashCoverPath = path.join(this.trashDirectory, `${target.id}.cover${path.extname(target.coverPath)}`);
        await rename(target.coverPath, trashCoverPath);
        coverMoved = true;
      }
      const stored: DeletedTrack = {
        ...target,
        filePath: audioExists ? trashFilePath : target.filePath,
        fileUrl: pathToFileURL(audioExists ? trashFilePath : target.filePath).href,
        coverPath: trashCoverPath,
        thumbnail: trashCoverPath ? pathToFileURL(trashCoverPath).href : target.thumbnail,
        deletedAt: new Date().toISOString()
      };
      await this.safeWrite(
        this.trashIndexPath,
        [stored, ...deleted].map(({ fileUrl: _fileUrl, ...track }) => track)
      );
      const remaining = tracks.filter((track) => track.id !== id);
      await this.writeTracks(remaining);
      return remaining;
    } catch (error) {
      try {
        if (audioMoved && await access(trashFilePath).then(() => true).catch(() => false)) {
          await rename(trashFilePath, target.filePath);
        }
        if (coverMoved && trashCoverPath && target.coverPath &&
            await access(trashCoverPath).then(() => true).catch(() => false)) {
          await rename(trashCoverPath, target.coverPath);
        }
        await this.safeWrite(
          this.trashIndexPath,
          deleted.map(({ fileUrl: _fileUrl, ...track }) => track)
        );
      } catch {
        // Keep the original failure; backup indexes remain available for recovery.
      }
      throw error;
    }
  }

  async listDeleted(): Promise<DeletedTrack[]> {
    const stored = await this.readJson<DeletedTrack[]>(this.trashIndexPath, []);
    return stored.map((track) => ({
      ...track,
      fileUrl: pathToFileURL(track.filePath).href,
      thumbnail: track.coverPath ? pathToFileURL(track.coverPath).href : track.thumbnail
    }));
  }

  async restore(id: string): Promise<{ tracks: Track[]; deleted: DeletedTrack[] }> {
    const deleted = await this.listDeleted();
    const target = deleted.find((track) => track.id === id);
    if (!target) throw new Error("回收站中没有找到该音频。");
    if (!await access(target.filePath).then(() => true).catch(() => false)) {
      throw new Error("原音频文件已经不存在，无法恢复；可以将这条记录永久删除。");
    }
    const restoredFile = path.join(this.mediaDirectory, path.basename(target.filePath));
    await rename(target.filePath, restoredFile);
    let restoredCover: string | null = null;
    if (target.coverPath) {
      restoredCover = path.join(this.mediaDirectory, path.basename(target.coverPath));
      await rename(target.coverPath, restoredCover);
    }
    const { deletedAt: _deletedAt, fileUrl: _fileUrl, ...rest } = target;
    const restored = {
      ...rest,
      filePath: restoredFile,
      coverPath: restoredCover,
      thumbnail: restoredCover ? pathToFileURL(restoredCover).href : target.thumbnail,
      importedAt: new Date().toISOString()
    } as StoredTrack;
    await this.add(restored);
    const remaining = deleted.filter((track) => track.id !== id);
    await this.safeWrite(
      this.trashIndexPath,
      remaining.map(({ fileUrl: _discard, ...track }) => track)
    );
    return { tracks: await this.list(), deleted: remaining };
  }

  async permanentlyDelete(id: string): Promise<DeletedTrack[]> {
    const deleted = await this.listDeleted();
    const target = deleted.find((track) => track.id === id);
    if (!target) return deleted;
    await rm(target.filePath, { force: true });
    if (target.coverPath) await rm(target.coverPath, { force: true });
    const remaining = deleted.filter((track) => track.id !== id);
    await this.safeWrite(
      this.trashIndexPath,
      remaining.map(({ fileUrl: _discard, ...track }) => track)
    );
    return remaining;
  }

  async saveLyrics(id: string, lines: LyricLine[], source: "manual" | "ai" | "online" = "manual"): Promise<Track> {
    const tracks = await this.list();
    const target = tracks.find((track) => track.id === id);
    if (!target) throw new Error("没有找到要保存歌词的音频。");

    const updated: Track = {
      ...target,
      lyrics: {
        source,
        updatedAt: new Date().toISOString(),
        lines
      }
    };
    const next = tracks.map((track) => track.id === id ? updated : track);
    await this.writeTracks(next);
    return updated;
  }

  async importLrc(id: string, content: string): Promise<Track> {
    const entries: Array<{ start: number; text: string }> = [];
    for (const line of content.split(/\r?\n/)) {
      const matches = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
      const text = line.replace(/\[[^\]]+\]/g, "").trim();
      if (!text) continue;
      for (const match of matches) {
        const fraction = match[3] ? Number(`0.${match[3].padEnd(3, "0").slice(0, 3)}`) : 0;
        entries.push({ start: Number(match[1]) * 60 + Number(match[2]) + fraction, text });
      }
    }
    entries.sort((a, b) => a.start - b.start);
    if (!entries.length) throw new Error("没有在文件中找到有效的 LRC 时间标签。");
    return this.saveLyrics(id, entries.map((entry, index) => ({
      text: entry.text,
      start: entry.start,
      end: entries[index + 1]?.start ?? null
    })), "manual");
  }

  async exportLrc(id: string): Promise<string> {
    const track = (await this.list()).find((item) => item.id === id);
    if (!track?.lyrics?.lines.length) throw new Error("这首音频还没有可导出的歌词。");
    const format = (seconds: number): string => {
      const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
      const rest = (seconds % 60).toFixed(2).padStart(5, "0");
      return `[${minutes}:${rest}]`;
    };
    return track.lyrics.lines.map((line) => `${format(line.start)}${line.text}`).join("\n");
  }
}
