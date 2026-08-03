import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ImportProgress, LyricLine } from "../shared/types.js";
import { TrackLibrary } from "./library.js";

function run(
  command: string,
  args: string[],
  onStderr?: (text: string) => void,
  onChild?: (child: ChildProcess) => void
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PATH: `${path.dirname(command)}${path.delimiter}${process.env.PATH || ""}`
      }
    });
    onChild?.(child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr = (stderr + text).slice(-30_000);
      onStderr?.(text);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `AI 进程退出，代码 ${code}`));
    });
  });
}

export class AiLyricsService {
  private readonly runtimeDirectory: string;
  private readonly modelDirectory: string;
  private activeChild: ChildProcess | null = null;
  private canceled = false;

  constructor(
    private readonly library: TrackLibrary,
    private readonly dataDirectory: string,
    private readonly scriptPath: string,
    private readonly report: (progress: ImportProgress) => void,
    offlineDirectory?: string
  ) {
    const offlineRuntime = offlineDirectory ? path.join(offlineDirectory, "ai-runtime") : "";
    const offlineModels = offlineDirectory ? path.join(offlineDirectory, "ai-models") : "";
    this.runtimeDirectory = offlineRuntime && existsSync(offlineRuntime)
      ? offlineRuntime
      : path.join(dataDirectory, "ai-runtime");
    this.modelDirectory = offlineModels && existsSync(offlineModels)
      ? offlineModels
      : path.join(dataDirectory, "ai-models");
  }

  private get pythonPath(): string {
    const portableWindowsPython = path.join(this.runtimeDirectory, "python.exe");
    if (process.platform === "win32" && existsSync(portableWindowsPython)) {
      return portableWindowsPython;
    }
    return process.platform === "win32"
      ? path.join(this.runtimeDirectory, "Scripts", "python.exe")
      : path.join(this.runtimeDirectory, "bin", "python");
  }

  private async ensureRuntime(): Promise<void> {
    try {
      await access(this.pythonPath);
    } catch {
      this.report({ stage: "downloading", message: "正在创建本地 AI 运行环境…", percent: 3 });
      await run("python", ["-m", "venv", this.runtimeDirectory]);
    }

    try {
      await run(this.pythonPath, ["-c", "import faster_whisper"]);
    } catch {
      this.report({
        stage: "downloading",
        message: "首次使用：正在安装本地 AI 组件，可能需要几分钟…",
        percent: 7
      });
      await run(this.pythonPath, [
        "-m", "pip", "install", "--disable-pip-version-check", "faster-whisper"
      ]);
    }
  }

  cancel(): boolean {
    if (!this.activeChild) return false;
    this.canceled = true;
    this.activeChild.kill();
    return true;
  }

  async align(trackId: string, texts: string[]): Promise<LyricLine[]> {
    if (this.activeChild) throw new Error("已有 AI 匹配任务正在运行。");
    this.canceled = false;
    const track = (await this.library.list()).find((item) => item.id === trackId);
    if (!track) throw new Error("没有找到要匹配歌词的音频。");
    if (!texts.length) throw new Error("请先粘贴歌词。");

    console.log("[ai-align] 开始 AI 歌词匹配");
    console.log("[ai-align] pythonPath:", this.pythonPath);
    console.log("[ai-align] scriptPath:", this.scriptPath);
    console.log("[ai-align] modelDirectory:", this.modelDirectory);
    console.log("[ai-align] track.filePath:", track.filePath);
    console.log("[ai-align] pythonPath exists:", existsSync(this.pythonPath));
    console.log("[ai-align] scriptPath exists:", existsSync(this.scriptPath));
    console.log("[ai-align] trackFile exists:", existsSync(track.filePath));

    await this.ensureRuntime();
    await mkdir(this.modelDirectory, { recursive: true });
    const tempDirectory = path.join(this.dataDirectory, "ai-temp");
    await mkdir(tempDirectory, { recursive: true });
    const lyricsPath = path.join(tempDirectory, `${crypto.randomUUID()}.json`);
    await writeFile(lyricsPath, JSON.stringify(texts), "utf8");
    this.report({ stage: "parsing", message: "正在启动本地 AI…", percent: 10 });

    try {
      let progressBuffer = "";
      const { stdout } = await run(this.pythonPath, [
        this.scriptPath,
        "--audio", track.filePath,
        "--lyrics", lyricsPath,
        "--model", "small",
        "--model-dir", this.modelDirectory
      ], (chunk) => {
        progressBuffer += chunk;
        const parts = progressBuffer.split(/\r\n|\r|\n/);
        progressBuffer = parts.pop() ?? "";
        for (const line of parts) {
          const explicit = line.match(/LINKAUDIO_PROGRESS:(\d+):(.*)/);
          if (explicit) {
            const percent = Math.min(100, Number(explicit[1]));
            this.report({
              stage: percent < 45 ? "downloading" : "parsing",
              message: explicit[2].trim(),
              percent
            });
            continue;
          }
          const download = line.match(/(\d{1,3})%/);
          if (download) {
            const percent = Math.min(100, Number(download[1]));
            this.report({
              stage: "downloading",
              message: `首次模型下载中… ${percent}%`,
              percent: 15 + Math.round(percent * 0.3)
            });
          }
        }
      }, (child) => { this.activeChild = child; });
      const result = JSON.parse(stdout) as { lines: LyricLine[] };
      if (!Array.isArray(result.lines) || !result.lines.length) {
        throw new Error("AI 没有生成有效的歌词时间轴。");
      }
      this.report({ stage: "complete", message: "AI 歌词匹配完成。", percent: 100 });
      return result.lines;
    } catch (error) {
      if (this.canceled) throw new Error("已取消 AI 歌词匹配。");
      const detail = error instanceof Error ? (error.stack || error.message) : String(error);
      console.error("[ai-align] AI 匹配失败:", detail);
      const errorLog = [
        new Date().toISOString(),
        "=== AI 匹配错误详情 ===",
        "pythonPath: " + this.pythonPath,
        "scriptPath: " + this.scriptPath,
        "modelDirectory: " + this.modelDirectory,
        "trackId: " + trackId,
        "trackFile: " + track.filePath,
        "pythonPath exists: " + existsSync(this.pythonPath),
        "scriptPath exists: " + existsSync(this.scriptPath),
        "trackFile exists: " + existsSync(track.filePath),
        "",
        "错误详情:",
        detail
      ].join("\n");
      await writeFile(
        path.join(this.dataDirectory, "ai-last-error.log"),
        errorLog,
        "utf8"
      );
      this.report({
        stage: "error",
        message: `AI 匹配失败：${detail}`
      });
      throw new Error(`AI 匹配失败：${detail}`);
    } finally {
      this.activeChild = null;
      await rm(lyricsPath, { force: true });
    }
  }
}
