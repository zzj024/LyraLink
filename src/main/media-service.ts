import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { youtubeDl } from "youtube-dl-exec";
import type {
  ImportProgress,
  MediaPreview,
  ParsedLink,
  Track
} from "../shared/types.js";
import { parseSupportedLink } from "./adapters/platform.js";
import { TrackLibrary } from "./library.js";

interface YtDlpMetadata {
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  thumbnail?: string;
  webpage_url?: string;
}

function safeFileName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 90) || "未命名音频";
}

function fileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function runFfmpeg(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let output = "";
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.on("error", reject);
    child.on("close", () => resolve(output));
  });
}

async function probeLocal(command: string, filePath: string): Promise<{
  title: string | null; author: string | null; duration: number | null;
}> {
  const output = await runFfmpeg(command, ["-hide_banner", "-i", filePath]);
  const durationMatch = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const metadata = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(title|artist)\s*:\s*(.+)$/i);
    if (match && !metadata.has(match[1].toLowerCase())) {
      metadata.set(match[1].toLowerCase(), match[2].trim());
    }
  }
  return {
    title: metadata.get("title") || null,
    author: metadata.get("artist") || null,
    duration: durationMatch
      ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
      : null
  };
}

async function downloadCover(url: string | null, destination: string): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return null;
    await writeFile(destination, Buffer.from(await response.arrayBuffer()));
    return destination;
  } catch {
    return null;
  }
}

export class MediaService {
  private readonly activeImports = new Set<string>();
  constructor(
    private readonly library: TrackLibrary,
    private readonly report: (progress: ImportProgress) => void,
    private readonly ffmpegCommand = "ffmpeg"
  ) {}

  private async metadata(parsed: ParsedLink): Promise<MediaPreview> {
    const raw = await youtubeDl(parsed.url, {
      dumpSingleJson: true,
      noWarnings: true,
      noPlaylist: true,
      skipDownload: true
    }) as unknown as YtDlpMetadata;

    return {
      platform: parsed.platform,
      url: raw.webpage_url || parsed.url,
      title: raw.title?.trim() || "未命名音频",
      author: raw.uploader?.trim() || raw.channel?.trim() || "未知作者",
      duration: typeof raw.duration === "number" ? raw.duration : null,
      thumbnail: raw.thumbnail || null
    };
  }

  async importAudio(input: string, confirmedAuthorized: boolean, taskId?: string): Promise<Track> {
    if (!confirmedAuthorized) throw new Error("请先在设置中确认你有权保存和处理该内容。");

    let downloadedPath: string | null = null;
    let downloadedCover: string | null = null;
    let saved = false;
    let activeKey: string | null = null;
    try {
      const parsed = parseSupportedLink(input);
      activeKey = parsed.url;
      if (this.activeImports.has(activeKey)) throw new Error("这个链接已经在下载队列中。");
      this.activeImports.add(activeKey);
      const duplicate = (await this.library.list()).find((track) =>
        track.platform === parsed.platform && track.url === parsed.url);
      if (duplicate) throw new Error(`“${duplicate.title}”已经在音乐库中。`);
      this.report({ stage: "parsing", message: "正在读取视频信息…", taskId, title: input });
      const preview = await this.metadata(parsed);
      const id = crypto.randomUUID();
      const baseName = `${safeFileName(preview.title)}-${id.slice(0, 8)}`;
      const outputTemplate = path.join(this.library.mediaDirectory, `${baseName}.%(ext)s`);

      this.report({
        stage: "downloading", message: "正在获取最高质量原始音轨，不进行二次转码…",
        taskId, title: preview.title, percent: 15
      });
      const download = youtubeDl.exec(parsed.url, {
        format: "bestaudio/best",
        noPlaylist: true,
        noWarnings: true,
        output: outputTemplate
      });
      let progressBuffer = "";
      download.stderr?.on("data", (chunk) => {
        progressBuffer = (progressBuffer + String(chunk)).slice(-4000);
        const matches = [...progressBuffer.matchAll(/\[download\]\s+(\d+(?:\.\d+)?)%/g)];
        const latest = matches.at(-1);
        if (!latest) return;
        const downloadPercent = Math.max(0, Math.min(100, Number(latest[1])));
        this.report({
          stage: "downloading",
          message: `正在下载音频… ${downloadPercent.toFixed(1)}%`,
          taskId,
          title: preview.title,
          percent: 15 + Math.round(downloadPercent * 0.7)
        });
      });
      await download;

      const downloadedFile = (await readdir(this.library.mediaDirectory))
        .find((name) => name.startsWith(`${baseName}.`) && !name.endsWith(".part"));
      if (!downloadedFile) {
        throw new Error("下载完成后没有找到原始音频文件。");
      }
      const filePath = path.join(this.library.mediaDirectory, downloadedFile);
      downloadedPath = filePath;
      const coverPath = await downloadCover(
        preview.thumbnail,
        path.join(this.library.mediaDirectory, `${baseName}.cover.jpg`)
      );
      downloadedCover = coverPath;
      this.report({
        stage: "saving", message: "正在写入本地音频库…",
        taskId, title: preview.title, percent: 90
      });
      const track = await this.library.add({
        ...preview,
        id,
        filePath,
        coverPath,
        lyrics: null,
        favorite: false,
        folderIds: [],
        sourceTrackId: null,
        importedAt: new Date().toISOString()
      });
      saved = true;
      this.report({
        stage: "complete", message: "音频已经导入，可以播放了。",
        taskId, title: preview.title, percent: 100
      });
      return track;
    } catch (error) {
      if (!saved) {
        if (downloadedPath) await rm(downloadedPath, { force: true });
        if (downloadedCover) await rm(downloadedCover, { force: true });
      }
      const message = error instanceof Error ? error.message : "导入失败";
      this.report({ stage: "error", message, taskId, title: input });
      throw new Error(toFriendlyError(message));
    } finally {
      if (activeKey) this.activeImports.delete(activeKey);
    }
  }

  async importLocal(filePaths: string[]): Promise<Track[]> {
    const copiedFiles: string[] = [];
    const batchHashes = new Set<string>();
    try {
      const prepared = [];
      for (const sourcePath of filePaths) {
        const contentHash = await fileHash(sourcePath);
        if (batchHashes.has(contentHash)) {
          throw new Error(`“${path.basename(sourcePath)}”在本次选择中重复。`);
        }
        batchHashes.add(contentHash);
        const existingTracks = await this.library.list();
        let duplicate = existingTracks.find((track) => track.contentHash === contentHash);
        if (!duplicate) {
          for (const track of existingTracks.filter((item) => !item.contentHash)) {
            if (existsSync(track.filePath) && await fileHash(track.filePath) === contentHash) {
              duplicate = track;
              break;
            }
          }
        }
        if (duplicate) throw new Error(`“${path.basename(sourcePath)}”与音乐库中的“${duplicate.title}”重复。`);
        const id = crypto.randomUUID();
        const extension = path.extname(sourcePath).toLowerCase();
        const probed = await probeLocal(this.ffmpegCommand, sourcePath).catch(() => ({
          title: null, author: null, duration: null
        }));
        const title = probed.title || path.basename(sourcePath, extension);
        const baseName = `${safeFileName(title)}-${id.slice(0, 8)}`;
        const filePath = path.join(this.library.mediaDirectory, `${baseName}${extension}`);
        await copyFile(sourcePath, filePath);
        copiedFiles.push(filePath);
        const coverPath = path.join(this.library.mediaDirectory, `${baseName}.cover.jpg`);
        await runFfmpeg(this.ffmpegCommand, [
          "-hide_banner", "-loglevel", "error", "-y", "-i", sourcePath,
          "-an", "-frames:v", "1", coverPath
        ]).catch(() => "");
        const savedCover = existsSync(coverPath) ? coverPath : null;
        if (savedCover) copiedFiles.push(savedCover);
        prepared.push({
          platform: "local" as const,
          url: "",
          title,
          author: probed.author || "未知作者",
          duration: probed.duration,
          thumbnail: null,
          id,
          filePath,
          coverPath: savedCover,
          lyrics: null,
          favorite: false,
          folderIds: [],
          sourceTrackId: null,
          contentHash,
          importedAt: new Date().toISOString()
        });
      }
      return this.library.addMany(prepared);
    } catch (error) {
      await Promise.all(copiedFiles.map((file) => rm(file, { force: true })));
      throw error;
    }
  }
}

function toFriendlyError(message: string): string {
  if (/unsupported url/i.test(message)) return "平台暂时无法解析这个链接，可能是链接类型尚未支持。";
  if (/private|login|sign in/i.test(message)) return "该内容需要登录或不是公开内容。";
  if (/network|timed out|unable to download|connection/i.test(message)) return "网络连接失败，请稍后重试。";
  return message;
}
