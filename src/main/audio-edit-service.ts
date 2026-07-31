import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, statSync } from "node:fs";
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { AudioSegment, ImportProgress, Track } from "../shared/types.js";
import { TrackLibrary } from "./library.js";

const require = createRequire(import.meta.url);
let bundledFfmpeg: string | null = null;
try {
  bundledFfmpeg = require("ffmpeg-static") as string | null;
} catch {
  bundledFfmpeg = null;
}

function ffmpegCommand(preferred?: string): string {
  if (preferred && existsSync(preferred) && statSync(preferred).size > 0) return preferred;
  if (bundledFfmpeg && existsSync(bundledFfmpeg) && statSync(bundledFfmpeg).size > 0) {
    return bundledFfmpeg;
  }
  return "ffmpeg";
}

function safeName(value: string): string {
  return value.normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 80) || "未命名片段";
}

function milliseconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export class AudioEditService {
  private activeChild: ChildProcess | null = null;
  private canceled = false;

  constructor(
    private readonly library: TrackLibrary,
    private readonly report: (progress: ImportProgress) => void = () => {},
    private readonly preferredFfmpeg?: string
  ) {}

  private run(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const command = ffmpegCommand(this.preferredFfmpeg);
      const child = spawn(command, args, { windowsHide: true });
      this.activeChild = child;
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-20_000); });
      child.on("error", (error) => {
        const code = (error as NodeJS.ErrnoException).code;
        reject(new Error(code === "ENOENT"
          ? "安装包中没有找到 FFmpeg，无法处理音频。请重新安装完整离线版本。"
          : error.message));
      });
      child.on("close", (code) => {
        this.activeChild = null;
        if (this.canceled) reject(new Error("已取消生成音频。"));
        else if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `FFmpeg 退出，代码 ${code}`));
      });
    });
  }

  cancel(): boolean {
    if (!this.activeChild) return false;
    this.canceled = true;
    this.activeChild.kill();
    return true;
  }

  async exportWithMetadata(track: Track, destination: string): Promise<void> {
    if (this.activeChild) throw new Error("已有音频任务正在运行。");
    this.canceled = false;
    const extension = path.extname(destination).toLowerCase();
    const temporary = path.join(
      path.dirname(destination),
      `.${path.basename(destination)}.${crypto.randomUUID()}.tmp${extension}`
    );
    const metadata = [
      "-metadata", `title=${track.title}`,
      "-metadata", `artist=${track.author}`
    ];
    const supportsCover = Boolean(track.coverPath && [".mp3", ".m4a", ".mp4", ".flac"].includes(extension));
    const base = ["-hide_banner", "-loglevel", "error", "-y", "-i", track.filePath];
    try {
      if (supportsCover && track.coverPath) {
        const coverArgs = [
          ...base, "-i", track.coverPath, "-map", "0:a:0", "-map", "1:v:0",
          "-c:a", "copy", "-c:v", "mjpeg", "-disposition:v:0", "attached_pic",
          ...metadata, temporary
        ];
        try {
          await this.run(coverArgs);
        } catch {
          await rm(temporary, { force: true });
          await this.run([...base, "-map", "0:a:0", "-c:a", "copy", ...metadata, temporary]);
        }
      } else {
        await this.run([...base, "-map", "0:a:0", "-c:a", "copy", ...metadata, temporary]);
      }
      await rm(destination, { force: true });
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async split(trackId: string, segments: AudioSegment[]): Promise<Track[]> {
    if (this.activeChild) throw new Error("已有音频任务正在运行。");
    const source = (await this.library.list()).find((track) => track.id === trackId);
    if (!source) throw new Error("没有找到要裁切的音频。");
    if (!segments.length) throw new Error("请至少添加一个裁切区间。");
    const duration = source.duration || Number.POSITIVE_INFINITY;
    for (const segment of segments) {
      if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) ||
          segment.start < 0 || segment.end <= segment.start || segment.end > duration + 0.1) {
        throw new Error(`“${segment.title || "未命名片段"}”的开始或结束时间无效。`);
      }
    }

    this.canceled = false;
    const taskId = crypto.randomUUID();
    const temporaryDirectory = path.join(this.library.mediaDirectory, `.split-${taskId}`);
    await mkdir(temporaryDirectory, { recursive: true });
    const finalFiles: string[] = [];
    try {
      const prepared = [];
      for (const [index, segment] of segments.entries()) {
        this.report({
          stage: "saving",
          message: `正在生成片段 ${index + 1} / ${segments.length}…`,
          percent: Math.round((index / segments.length) * 90)
        });
        const id = crypto.randomUUID();
        const base = `${safeName(segment.title)}-${id.slice(0, 8)}`;
        const fast = segment.mode === "fast";
        const extension = fast ? (path.extname(source.filePath) || ".m4a") : ".m4a";
        const temporaryFile = path.join(temporaryDirectory, `${base}${extension}`);
        const finalFile = path.join(this.library.mediaDirectory, `${base}${extension}`);
        const seekArgs = [
          "-hide_banner", "-loglevel", "error", "-y",
          "-ss", segment.start.toFixed(3), "-to", segment.end.toFixed(3),
          "-i", source.filePath, "-vn"
        ];
        await this.run(fast
          ? [...seekArgs, "-c:a", "copy", temporaryFile]
          : [...seekArgs, "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", temporaryFile]);

        let temporaryCover: string | null = null;
        let finalCover: string | null = null;
        if (source.coverPath) {
          const coverExtension = path.extname(source.coverPath) || ".jpg";
          temporaryCover = path.join(temporaryDirectory, `${base}.cover${coverExtension}`);
          finalCover = path.join(this.library.mediaDirectory, `${base}.cover${coverExtension}`);
          await copyFile(source.coverPath, temporaryCover);
        }
        const lyrics = source.lyrics ? {
          ...source.lyrics,
          updatedAt: new Date().toISOString(),
          lines: source.lyrics.lines
            .filter((line) => line.start < segment.end && (line.end ?? segment.end) > segment.start)
            .map((line) => ({
              ...line,
              start: milliseconds(Math.max(0, line.start - segment.start)),
              end: line.end === null
                ? null
                : milliseconds(Math.min(segment.end, line.end) - segment.start)
            }))
        } : null;
        prepared.push({
          temporaryFile, finalFile, temporaryCover, finalCover,
          track: {
            platform: source.platform,
            url: source.url,
            title: segment.title.trim() || "未命名片段",
            author: segment.author?.trim() || source.author,
            duration: segment.end - segment.start,
            thumbnail: source.thumbnail,
            id,
            filePath: finalFile,
            coverPath: finalCover,
            lyrics,
            favorite: source.favorite,
            folderIds: [...source.folderIds],
            sourceTrackId: source.id,
            importedAt: new Date().toISOString()
          }
        });
      }

      for (const item of prepared) {
        await rename(item.temporaryFile, item.finalFile);
        finalFiles.push(item.finalFile);
        if (item.temporaryCover && item.finalCover) {
          await rename(item.temporaryCover, item.finalCover);
          finalFiles.push(item.finalCover);
        }
      }
      const created = await this.library.addMany(prepared.map((item) => item.track));
      this.report({ stage: "complete", message: `已生成 ${created.length} 个音频片段。`, percent: 100 });
      return created;
    } catch (error) {
      await Promise.all(finalFiles.map((file) => rm(file, { force: true })));
      this.report({
        stage: "error",
        message: error instanceof Error ? error.message : "生成音频失败"
      });
      throw error;
    } finally {
      this.activeChild = null;
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}
