import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { Readable } from "node:stream";
import path from "node:path";
import { create as createYoutubeDl } from "youtube-dl-exec";
import type {
  ImportProgress,
  ImportRequest,
  LyricLine,
  LyricsTrack,
  MediaPreview,
  OnlineLyricsCandidate,
  OnlineSearchPage,
  OnlineSearchResult,
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

interface BilibiliSearchResponse {
  code: number;
  message?: string;
  data?: {
    page?: number;
    numPages?: number;
    result?: Array<{
      aid?: number;
      bvid?: string;
      arcurl?: string;
      title?: string;
      author?: string;
      duration?: string;
      pic?: string;
    }>;
  };
}

interface BilibiliPageResponse {
  code: number;
  data?: Array<{ cid: number; page: number }>;
}

interface BilibiliPlayerResponse {
  code: number;
  data?: {
    subtitle?: {
      subtitles?: Array<{
        lan?: string;
        lan_doc?: string;
        subtitle_url?: string;
        ai_type?: number;
      }>;
    };
  };
}

interface BilibiliSubtitleFile {
  body?: Array<{ from?: number; to?: number; content?: string }>;
}

interface LrclibLyricsResponse {
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

interface LrclibSearchResponse extends LrclibLyricsResponse {
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string | null;
  duration?: number | null;
}

interface PlatformSongMatch {
  id: string;
  title: string;
  author: string;
  album: string | null;
  duration: number | null;
  hash?: string;
}

interface NeteaseSearchResponse {
  result?: {
    songs?: Array<{
      id?: number;
      name?: string;
      duration?: number;
      artists?: Array<{ name?: string }>;
      album?: { name?: string; picUrl?: string };
    }>;
    songCount?: number;
  };
}

interface NeteaseMediaResponse {
  data?: Array<{ id?: number; url?: string | null; code?: number; type?: string }>;
}

interface NeteaseDetailResponse {
  songs?: Array<{
    id?: number;
    name?: string;
    duration?: number;
    artists?: Array<{ name?: string }>;
    al?: { name?: string; picUrl?: string };
  }>;
}

interface JooxSearchItem {
  id?: string;
  name?: string;
  artist?: string[];
  album?: string;
  pic_id?: string;
  lyric_id?: string;
}

const bilibiliHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  Referer: "https://www.bilibili.com/"
};

const neteaseRefererHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  Referer: "https://music.163.com/"
};

/** 从网易云页面链接或裸 ID 中解析歌曲 ID */
function parseNeteaseSongId(input: string): string | null {
  const match = input.match(/music\.163\.com\/(?:#\/)?song\?(?:.*&)?id=(\d+)/i)
    || input.match(/^(\d{6,})$/);
  return match?.[1] ?? null;
}

/** Joox 搜索结果的自定义链接：gdstudio-joox:<id>|<picId>|<lyricId> */
function parseJooxId(input: string): string | null {
  return input.match(/^gdstudio-joox:(.+)$/i)?.[1] ?? null;
}

function parseBilibiliDuration(value?: string): number | null {
  if (!value) return null;
  const parts = value.split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function plainBilibiliTitle(value?: string): string {
  return decodeHtmlEntities((value || "未命名视频").replace(/<[^>]+>/g, "").trim());
}

// B站接口返回的标题里带有 HTML 实体（如 &quot;），展示前解码一次
function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    quot: '"', amp: "&", lt: "<", gt: ">", apos: "'", nbsp: " ", "#39": "'"
  };
  return value.replace(/&(quot|amp|lt|gt|apos|nbsp|#39);/g, (_, entity: string) => named[entity] ?? _);
}

function parseLrcLyrics(value: string): LyricLine[] {
  const entries: Array<{ start: number; text: string }> = [];
  for (const line of value.split(/\r?\n/)) {
    const timestamps = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const text = line.replace(/\[[^\]]+\]/g, "").trim();
    if (!text) continue;
    for (const timestamp of timestamps) {
      const fraction = timestamp[3]
        ? Number(`0.${timestamp[3].padEnd(3, "0").slice(0, 3)}`) : 0;
      entries.push({ start: Number(timestamp[1]) * 60 + Number(timestamp[2]) + fraction, text });
    }
  }
  entries.sort((left, right) => left.start - right.start);
  return entries.map((entry, index) => ({
    text: entry.text,
    start: entry.start,
    end: entries[index + 1]?.start ?? null,
    confidence: 1
  }));
}

function parsePlainLyrics(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function plainLyricsFromLrc(value: string): string[] {
  const synced = parseLrcLyrics(value);
  if (synced.length) return synced.map((line) => line.text);
  return value.split(/\r?\n/)
    .map((line) => line.replace(/\[[^\]]+\]/g, "").trim())
    .filter(Boolean);
}

function normalizeSongField(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s·・\-—_.,，。'"“”‘’()[\]（）【】]/g, "");
}

function rankPlatformMatches(matches: PlatformSongMatch[], track: Track): PlatformSongMatch[] {
  const title = normalizeSongField(track.title);
  const author = normalizeSongField(track.author);
  return matches.map((match) => {
    const matchTitle = normalizeSongField(match.title);
    const matchAuthor = normalizeSongField(match.author);
    let score = matchTitle === title ? 8 : matchTitle.includes(title) || title.includes(matchTitle) ? 3 : 0;
    score += matchAuthor === author ? 7 : matchAuthor.includes(author) || author.includes(matchAuthor) ? 3 : 0;
    if (track.duration && match.duration) {
      const difference = Math.abs(track.duration - match.duration);
      score += difference <= 3 ? 5 : difference <= 10 ? 3 : difference <= 25 ? 1 : 0;
    }
    return { match, score };
  }).filter((entry) => entry.score >= 6)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.match);
}

function platformRequest(url: string | URL, referer: string): Promise<Response> {
  return fetch(url, {
    signal: AbortSignal.timeout(5000),
    headers: {
      "User-Agent": bilibiliHeaders["User-Agent"],
      Referer: referer
    }
  });
}

async function fetchBilibiliLyrics(videoUrl: string): Promise<LyricsTrack | null> {
  try {
    const parsedUrl = new URL(videoUrl);
    const bvid = parsedUrl.pathname.match(/\/video\/(BV[\w]+)/i)?.[1];
    const aid = parsedUrl.pathname.match(/\/video\/av(\d+)/i)?.[1];
    if (!bvid && !aid) return null;
    const identity = bvid ? `bvid=${encodeURIComponent(bvid)}` : `aid=${aid}`;
    const pagePayload = await fetch(
      `https://api.bilibili.com/x/player/pagelist?${identity}`,
      { headers: bilibiliHeaders }
    ).then((response) => response.json()) as BilibiliPageResponse;
    const cid = pagePayload.data?.[0]?.cid;
    if (!cid) return null;
    const infoUrl = new URL("https://api.bilibili.com/x/player/wbi/v2");
    infoUrl.searchParams.set("cid", String(cid));
    if (bvid) infoUrl.searchParams.set("bvid", bvid);
    else if (aid) infoUrl.searchParams.set("aid", aid);
    const infoPayload = await fetch(infoUrl, { headers: bilibiliHeaders })
      .then((response) => response.json()) as BilibiliPlayerResponse;
    const subtitles = infoPayload.data?.subtitle?.subtitles || [];
    const subtitle = subtitles.find((item) => item.subtitle_url) ?? subtitles[0];
    if (!subtitle?.subtitle_url) return null;
    const subtitleUrl = subtitle.subtitle_url.startsWith("//")
      ? `https:${subtitle.subtitle_url}` : subtitle.subtitle_url;
    const file = await fetch(subtitleUrl, { headers: bilibiliHeaders })
      .then((response) => response.json()) as BilibiliSubtitleFile;
    const lines = (file.body || [])
      .filter((item) => item.content?.trim())
      .map((item) => ({
        text: item.content!.trim(),
        start: Number(item.from) || 0,
        end: Number(item.to) || null
      }));
    if (!lines.length) return null;
    return { source: "online", updatedAt: new Date().toISOString(), lines };
  } catch (error) {
    console.warn("[bilibili] 字幕获取失败:", error);
    return null;
  }
}

function directNetworkEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // A stale system proxy (commonly 127.0.0.1:7892 after a proxy app exits)
  // makes yt-dlp fail before it can contact the source website. Downloads
  // should work without requiring a local proxy service to be running.
  for (const name of [
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"
  ]) {
    delete env[name];
  }
  return env;
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
  private readonly youtubeDl;
  private readonly ytDlpCommand: string;
  private previewServer: Server | null = null;
  private previewPort: number | null = null;
  private readonly previewLinks = new Map<string, string>();
  private readonly previewStreams = new Map<string, { urls: string[]; headers?: Record<string, string> }>();
  private readonly onlineLyricsCache = new Map<string, {
    trackId: string;
    provider: string;
    synced?: LyricLine[];
    plain?: string[];
  }>();
  constructor(
    private readonly library: TrackLibrary,
    private readonly report: (progress: ImportProgress) => void,
    private readonly ffmpegCommand = "ffmpeg",
    ytDlpCommand?: string
  ) {
    // electron-builder moves executables out of app.asar. An explicit path
    // avoids trying to spawn the virtual app.asar path in packaged builds.
    this.ytDlpCommand = ytDlpCommand || "yt-dlp";
    this.youtubeDl = createYoutubeDl(this.ytDlpCommand);
  }

  private async metadata(parsed: ParsedLink): Promise<MediaPreview> {
    try {
      const raw = await this.youtubeDl(parsed.url, {
        dumpSingleJson: true,
        noWarnings: true,
        noPlaylist: true,
        skipDownload: true
      }, { env: directNetworkEnvironment() }) as unknown as YtDlpMetadata;

      return {
        platform: parsed.platform,
        url: raw.webpage_url || parsed.url,
        title: raw.title?.trim() || "未命名音频",
        author: raw.uploader?.trim() || raw.channel?.trim() || "未知作者",
        duration: typeof raw.duration === "number" ? raw.duration : null,
        thumbnail: raw.thumbnail || null
      };
    } catch (error) {
      const errDetail = error instanceof Error ? error.message : String(error);
      console.error("[metadata] 获取视频信息失败:", errDetail);
      throw new Error(`获取视频信息失败: ${errDetail}`);
    }
  }

  async importAudio(input: string, confirmedAuthorized: boolean, taskId?: string, meta?: ImportRequest["meta"]): Promise<Track> {
    if (!confirmedAuthorized) throw new Error("请先在设置中确认你有权保存和处理该内容。");

    // 网易云单曲链接走独立的直链下载流程（yt-dlp 不支持网易云）
    const neteaseSongId = parseNeteaseSongId(input.trim());
    if (neteaseSongId) return this.importNetease(neteaseSongId, taskId);
    // Joox 完整曲目直链导入
    const jooxTrackId = parseJooxId(input.trim());
    if (jooxTrackId) return this.importJoox(jooxTrackId, taskId, meta);

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
      const download = this.youtubeDl.exec(parsed.url, {
        format: "bestaudio/best",
        noPlaylist: true,
        noWarnings: true,
        output: outputTemplate
      }, { env: directNetworkEnvironment() });
      let progressBuffer = "";
      let stderrLog = "";
      download.stderr?.on("data", (chunk: Buffer) => {
        const chunkStr = String(chunk);
        stderrLog = (stderrLog + chunkStr).slice(-10000);
        progressBuffer = (progressBuffer + chunkStr).slice(-4000);
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
      try {
        await download;
      } catch (downloadError) {
        const errDetail = downloadError instanceof Error ? downloadError.message : String(downloadError);
        console.error("[importAudio] 下载失败, stderr:", stderrLog);
        console.error("[importAudio] 下载错误:", errDetail);
        throw new Error(`下载失败: ${errDetail}\n\n详细日志:\n${stderrLog.slice(-2000)}`);
      }

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
      const lyrics = parsed.platform === "bilibili"
        ? await fetchBilibiliLyrics(preview.url)
        : null;
      const track = await this.library.add({
        ...preview,
        id,
        filePath,
        coverPath,
        lyrics,
        favorite: false,
        folderIds: [],
        sourceTrackId: null,
        importedAt: new Date().toISOString()
      });
      saved = true;
      this.report({
        stage: "complete", message: `导入完成：${preview.title}`,
        taskId, title: preview.title, percent: 100
      });
      return track;
    } catch (error) {
      if (!saved) {
        if (downloadedPath) await rm(downloadedPath, { force: true });
        if (downloadedCover) await rm(downloadedCover, { force: true });
      }
      const rawMessage = error instanceof Error ? error.message : "导入失败";
      console.error("[importAudio] 导入失败:", rawMessage);
      this.report({ stage: "error", message: rawMessage, taskId, title: input });
      throw new Error(rawMessage);
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

  async searchBilibili(query: string, page: number): Promise<OnlineSearchPage> {
    const keyword = query.trim();
    if (!keyword) return { items: [], page: 1, hasMore: false };
    const safePage = Math.max(1, Math.floor(page) || 1);
    const pageSize = 10;
    const url = new URL("https://api.bilibili.com/x/web-interface/wbi/search/type");
    url.searchParams.set("search_type", "video");
    url.searchParams.set("keyword", keyword);
    url.searchParams.set("page", String(safePage));
    url.searchParams.set("page_size", String(pageSize));
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        Referer: "https://www.bilibili.com/"
      }
    });
    if (!response.ok) throw new Error(`B站搜索请求失败（HTTP ${response.status}）。`);
    const payload = await response.json() as BilibiliSearchResponse;
    if (payload.code !== 0) throw new Error(payload.message || "B站暂时无法返回搜索结果。");
    const entries = payload.data?.result || [];
    const items: OnlineSearchResult[] = entries.map((entry) => ({
        id: entry.bvid || String(entry.aid || crypto.randomUUID()),
        platform: "bilibili",
        url: entry.bvid
          ? `https://www.bilibili.com/video/${entry.bvid}`
          : entry.arcurl?.replace(/^http:/, "https:") || `https://www.bilibili.com/video/av${entry.aid}`,
        title: plainBilibiliTitle(entry.title),
        author: entry.author?.trim() || "未知 UP 主",
        duration: parseBilibiliDuration(entry.duration),
        thumbnail: entry.pic ? (entry.pic.startsWith("//") ? `https:${entry.pic}` : entry.pic) : null
      }));
    return { items, page: payload.data?.page || safePage, hasMore: (payload.data?.numPages || safePage) > safePage };
  }

  async resolveBilibiliPreview(url: string): Promise<string> {
    await this.ensurePreviewServer();
    const token = crypto.randomUUID();
    this.previewLinks.set(token, url);
    const expiry = setTimeout(() => this.previewLinks.delete(token), 30 * 60 * 1000);
    expiry.unref();
    return `http://127.0.0.1:${this.previewPort}/bilibili-preview/${token}`;
  }

  /** 网易云试听：主进程取直链后经本地预览服务器转发（绕过混合内容/Referer 限制） */
  async resolveNeteasePreview(songId: string): Promise<string> {
    const mediaUrl = await this.neteaseMediaUrl(songId);
    return this.resolveStreamPreview(mediaUrl, neteaseRefererHeaders);
  }

  /**
   * 通用直链试听：Joox 等公开直链。
   * 传入平台页面地址或直链均可，内部解析成媒体流后经本地服务器转发。
   */
  async resolveStreamPreview(url: string, customHeaders?: Record<string, string>): Promise<string> {
    let urls: string[];
    const jooxId = parseJooxId(url);
    if (!jooxId) throw new Error("没有找到可播放的音频地址。");
    urls = [await this.jooxMediaUrl(jooxId)];
    await this.ensurePreviewServer();
    const token = crypto.randomUUID();
    this.previewStreams.set(token, { urls, headers: customHeaders });
    const expiry = setTimeout(() => this.previewStreams.delete(token), 30 * 60 * 1000);
    expiry.unref();
    return `http://127.0.0.1:${this.previewPort}/stream/${token}`;
  }

  /** 批量校验哪些歌曲能取到播放地址（VIP/无版权的会被网易云返回空 url） */
  private async neteasePlayableIds(songIds: string[]): Promise<Set<string>> {
    if (!songIds.length) return new Set();
    const url = new URL("https://music.163.com/api/song/enhance/player/url");
    url.searchParams.set("ids", `[${songIds.join(",")}]`);
    url.searchParams.set("br", "320000");
    const response = await platformRequest(url, "https://music.163.com/");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as NeteaseMediaResponse;
    return new Set(
      (payload.data || [])
        .filter((media) => media.url && media.code === 200 && media.id)
        .map((media) => String(media.id))
    );
  }

  /** 网易云搜索：官方公开的 web 搜索接口，与在线歌词搜索使用同一入口 */
  async searchNetease(query: string, page: number): Promise<OnlineSearchPage> {
    const keyword = query.trim();
    if (!keyword) return { items: [], page: 1, hasMore: false };
    const safePage = Math.max(1, Math.floor(page) || 1);
    const limit = 20;
    const url = new URL("https://music.163.com/api/search/get/web");
    url.searchParams.set("s", keyword);
    url.searchParams.set("type", "1");
    url.searchParams.set("offset", String((safePage - 1) * limit));
    url.searchParams.set("total", String(safePage > 1));
    url.searchParams.set("limit", String(limit));
    const response = await platformRequest(url, "https://music.163.com/");
    if (!response.ok) throw new Error(`网易云搜索请求失败（HTTP ${response.status}）。`);
    const payload = await response.json() as NeteaseSearchResponse;
    const songs = payload.result?.songs || [];
    const all: OnlineSearchResult[] = songs
      .filter((song) => song.id)
      .map((song) => ({
        id: String(song.id),
        platform: "netease",
        url: `https://music.163.com/#/song?id=${song.id}`,
        title: song.name || "未命名歌曲",
        author: (song.artists || []).map((artist) => artist.name).filter(Boolean).join(" / ") || "未知歌手",
        duration: typeof song.duration === "number" ? Math.round(song.duration / 1000) : null,
        thumbnail: song.album?.picUrl ? song.album.picUrl.replace(/^http:/, "https:") : null
      }));
    // VIP / 无版权歌曲拿不到播放地址：直接从结果中筛掉，避免用户点击后才报错。
    // 校验本身失败时不拦截结果，保持搜索可用。
    let playable: Set<string>;
    try {
      playable = await this.neteasePlayableIds(all.map((item) => item.id));
    } catch (error) {
      console.warn("[netease] 播放地址批量校验失败，跳过过滤:", error);
      return { items: all, page: safePage, hasMore: safePage * limit < (payload.result?.songCount || 0) };
    }
    const items = all.filter((item) => playable.has(item.id));
    return { items, page: safePage, hasMore: safePage * limit < (payload.result?.songCount || 0) };
  }

  private async neteaseMediaUrl(songId: string): Promise<string> {
    const url = new URL("https://music.163.com/api/song/enhance/player/url");
    url.searchParams.set("ids", `[${songId}]`);
    url.searchParams.set("br", "320000");
    const response = await platformRequest(url, `https://music.163.com/song?id=${songId}`);
    if (!response.ok) throw new Error(`获取网易云播放地址失败（HTTP ${response.status}）。`);
    const payload = await response.json() as NeteaseMediaResponse;
    const media = payload.data?.[0];
    if (!media?.url) throw new Error("这首歌曲需要版权或 VIP，无法获取播放地址。");
    return media.url.replace(/^http:/, "https:");
  }

  /** 网易云单曲导入：取直链下载音频，顺带抓取封面与 LRC 歌词 */
  private async importNetease(songId: string, taskId?: string): Promise<Track> {
    const url = `https://music.163.com/#/song?id=${songId}`;
    const duplicate = (await this.library.list()).find((track) =>
      track.platform === "netease" && track.url === url);
    if (duplicate) throw new Error(`“${duplicate.title}”已经在音乐库中。`);
    this.report({ stage: "parsing", message: "正在读取歌曲信息…", taskId, title: url });
    const detailUrl = new URL("https://music.163.com/api/v3/song/detail");
    detailUrl.searchParams.set("id", songId);
    detailUrl.searchParams.set("ids", `[${songId}]`);
    const detailResponse = await platformRequest(detailUrl, `https://music.163.com/song?id=${songId}`);
    if (!detailResponse.ok) throw new Error(`读取歌曲信息失败（HTTP ${detailResponse.status}）。`);
    const detail = (await detailResponse.json() as NeteaseDetailResponse).songs?.[0];
    if (!detail?.id) throw new Error("没有找到这首歌曲，可能已下架。");
    const title = detail.name || "未命名歌曲";
    const author = (detail.artists || []).map((artist) => artist.name).filter(Boolean).join(" / ") || "未知歌手";

    this.report({ stage: "downloading", message: "正在获取音频直链…", taskId, title, percent: 10 });
    const mediaUrl = await this.neteaseMediaUrl(songId);
    const mediaResponse = await fetch(mediaUrl, { headers: neteaseRefererHeaders });
    if (!mediaResponse.ok || !mediaResponse.body) {
      throw new Error(`音频下载失败（HTTP ${mediaResponse.status}）。`);
    }
    const id = crypto.randomUUID();
    const baseName = `${safeFileName(title)}-${id.slice(0, 8)}`;
    const extension = mediaUrl.includes(".flac") ? ".flac" : mediaUrl.includes(".m4a") ? ".m4a" : ".mp3";
    const filePath = path.join(this.library.mediaDirectory, `${baseName}${extension}`);
    const coverPath = path.join(this.library.mediaDirectory, `${baseName}.cover.jpg`);
    try {
      this.report({ stage: "downloading", message: "正在下载音频…", taskId, title, percent: 40 });
      await writeFile(filePath, Buffer.from(await mediaResponse.arrayBuffer()));
      const picUrl = detail.al?.picUrl?.replace(/^http:/, "https:");
      const coverFile = picUrl ? await downloadCover(picUrl, coverPath).catch(() => null) : null;
      this.report({ stage: "saving", message: "正在写入本地音频库…", taskId, title, percent: 90 });
      const lyrics = await this.fetchNeteaseLyrics(songId);
      const track = await this.library.add({
        platform: "netease",
        url,
        title,
        author,
        duration: typeof detail.duration === "number" ? Math.round(detail.duration / 1000) : null,
        thumbnail: picUrl || null,
        id,
        filePath,
        coverPath: coverFile,
        lyrics,
        favorite: false,
        folderIds: [],
        sourceTrackId: null,
        importedAt: new Date().toISOString()
      });
      this.report({ stage: "complete", message: `导入完成：${title}`, taskId, title, percent: 100 });
      return track;
    } catch (error) {
      await rm(filePath, { force: true });
      await rm(coverPath, { force: true });
      throw error;
    }
  }

  private async fetchNeteaseLyrics(songId: string): Promise<LyricsTrack | null> {
    try {
      const lyricUrl = new URL("https://music.163.com/api/song/lyric");
      lyricUrl.searchParams.set("id", songId);
      lyricUrl.searchParams.set("lv", "1");
      lyricUrl.searchParams.set("kv", "1");
      lyricUrl.searchParams.set("tv", "-1");
      const response = await platformRequest(lyricUrl, `https://music.163.com/song?id=${songId}`);
      if (!response.ok) return null;
      const payload = await response.json() as { lrc?: { lyric?: string } };
      const lrcText = payload.lrc?.lyric || "";
      if (!lrcText) return null;
      const lines = parseLrcLyrics(lrcText);
      return lines.length
        ? { source: "online", updatedAt: new Date().toISOString(), lines }
        : null;
    } catch {
      return null;
    }
  }

  private async jooxMediaUrl(jooxId: string): Promise<string> {
    for (const br of [320, 128]) {
      const url = new URL("https://music-api.gdstudio.xyz/api.php");
      url.searchParams.set("types", "url");
      url.searchParams.set("source", "joox");
      url.searchParams.set("id", jooxId);
      url.searchParams.set("br", String(br));
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) continue;
      const payload = await response.json() as { url?: string };
      if (payload.url) return payload.url.replace(/^http:/, "https:");
    }
    throw new Error("这首歌暂时没有可用的播放地址，换一首试试。");
  }

  /** Joox 搜索：经 GDStudio 聚合接口（keyless），320k 完整曲目 */
  async searchJoox(query: string, page: number): Promise<OnlineSearchPage> {
    const keyword = query.trim();
    if (!keyword) return { items: [], page: 1, hasMore: false };
    const safePage = Math.max(1, Math.floor(page) || 1);
    const limit = 20;
    const url = new URL("https://music-api.gdstudio.xyz/api.php");
    url.searchParams.set("types", "search");
    url.searchParams.set("source", "joox");
    url.searchParams.set("name", keyword);
    url.searchParams.set("count", String(limit));
    url.searchParams.set("pages", String(safePage));
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Joox 搜索请求失败（HTTP ${response.status}）。`);
    const payload = await response.json() as JooxSearchItem[];
    const items: OnlineSearchResult[] = (Array.isArray(payload) ? payload : [])
      .filter((song) => song.id && song.name)
      .map((song) => ({
        id: song.id!,
        platform: "joox",
        url: `gdstudio-joox:${song.id}|${song.pic_id || ""}|${song.lyric_id || ""}`,
        title: song.name || "未命名歌曲",
        author: (song.artist || []).join(" / ") || "未知歌手",
        duration: null,
        thumbnail: null
      }));
    return { items, page: safePage, hasMore: items.length >= limit };
  }

  /**
   * Joox 单曲导入：取 320k 直链下载完整歌曲。
   * 搜索结果的 URL 里带有 id|picId|lyricId，标题/歌手来自搜索结果元数据。
   */
  private async importJoox(jooxId: string, taskId?: string, meta?: ImportRequest["meta"]): Promise<Track> {
    const [songId, picId = "", lyricId = ""] = jooxId.split("|");
    const pageUrl = `gdstudio-joox:${jooxId}`;
    const duplicate = (await this.library.list()).find((track) =>
      track.platform === "joox" && track.url === pageUrl);
    if (duplicate) throw new Error(`“${duplicate.title}”已经在音乐库中。`);
    this.report({ stage: "parsing", message: "正在获取播放地址…", taskId, title: meta?.title || pageUrl });
    const mediaUrl = await this.jooxMediaUrl(songId);
    let thumbnail = meta?.thumbnail ?? null;
    if (!thumbnail && picId) {
      thumbnail = await this.jooxPicUrl(picId).catch(() => null);
    }
    const lyrics = lyricId ? await this.jooxLyrics(lyricId) : null;
    return this.importDirectAudio({
      platform: "joox",
      url: pageUrl,
      title: meta?.title || "Joox 曲目",
      author: meta?.author || "未知歌手",
      duration: meta?.duration ?? null,
      thumbnail,
      mediaUrl,
      lyrics,
      taskId
    });
  }

  private async jooxPicUrl(picId: string): Promise<string | null> {
    const url = new URL("https://music-api.gdstudio.xyz/api.php");
    url.searchParams.set("types", "pic");
    url.searchParams.set("source", "joox");
    url.searchParams.set("id", picId);
    url.searchParams.set("size", "300");
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const payload = await response.json() as { url?: string };
    return payload.url ? payload.url.replace(/^http:/, "https:") : null;
  }

  /** Joox 歌词：LRC 优先，纯文本兜底；失败静默 */
  private async jooxLyrics(lyricId: string): Promise<LyricsTrack | null> {
    try {
      const url = new URL("https://music-api.gdstudio.xyz/api.php");
      url.searchParams.set("types", "lyric");
      url.searchParams.set("source", "joox");
      url.searchParams.set("id", lyricId);
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) return null;
      const payload = await response.json() as { lyric?: string };
      const text = payload.lyric || "";
      if (!text) return null;
      const lines = parseLrcLyrics(text);
      return lines.length
        ? { source: "online", updatedAt: new Date().toISOString(), lines }
        : {
          source: "online", updatedAt: new Date().toISOString(),
          lines: plainLyricsFromLrc(text).map((line) => ({ text: line, start: 0, end: null }))
        };
    } catch {
      return null;
    }
  }

  /**
   * 直链音频通用导入：下载字节流 → 写库 → 失败清理
   */
  private async importDirectAudio(input: {
    platform: "joox";
    url: string;
    title: string;
    author: string;
    duration: number | null;
    thumbnail: string | null;
    mediaUrl: string;
    lyrics?: LyricsTrack | null;
    taskId?: string;
  }): Promise<Track> {
    const id = crypto.randomUUID();
    const baseName = `${safeFileName(input.title)}-${id.slice(0, 8)}`;
    const filePath = path.join(this.library.mediaDirectory, `${baseName}.mp3`);
    const coverPath = path.join(this.library.mediaDirectory, `${baseName}.cover.jpg`);
    let savedCover: string | null = null;
    try {
      this.report({ stage: "downloading", message: "正在下载音频…", taskId: input.taskId, title: input.title, percent: 40 });
      const mediaResponse = await fetch(input.mediaUrl, { signal: AbortSignal.timeout(120000) });
      if (!mediaResponse.ok || !mediaResponse.body) {
        throw new Error(`音频下载失败（HTTP ${mediaResponse.status}）。`);
      }
      await writeFile(filePath, Buffer.from(await mediaResponse.arrayBuffer()));
      if (input.thumbnail) {
        savedCover = await downloadCover(input.thumbnail, coverPath).catch(() => null);
      }
      this.report({ stage: "saving", message: "正在写入本地音频库…", taskId: input.taskId, title: input.title, percent: 90 });
      const track = await this.library.add({
        platform: input.platform,
        url: input.url,
        title: input.title,
        author: input.author,
        duration: input.duration,
        thumbnail: input.thumbnail,
        id,
        filePath,
        coverPath: savedCover,
        lyrics: input.lyrics ?? null,
        favorite: false,
        folderIds: [],
        sourceTrackId: null,
        importedAt: new Date().toISOString()
      });
      this.report({ stage: "complete", message: `导入完成：${input.title}`, taskId: input.taskId, title: input.title, percent: 100 });
      return track;
    } catch (error) {
      await rm(filePath, { force: true });
      await rm(coverPath, { force: true });
      throw error;
    }
  }

  /** 导入 B 站视频的公开字幕作为歌词 */
  async importBilibiliLyrics(trackId: string): Promise<Track> {
    const track = (await this.library.list()).find((item) => item.id === trackId);
    if (!track) throw new Error("没有找到这首歌曲。");
    if (track.platform !== "bilibili") throw new Error("只有 B 站来源的歌曲可以获取 B 站字幕。");
    const lyrics = await fetchBilibiliLyrics(track.url);
    if (!lyrics?.lines.length) {
      throw new Error("该视频没有可直接访问的字幕；部分 B 站 AI 字幕需要登录后才会开放。");
    }
    return this.library.saveLyrics(track.id, lyrics.lines, lyrics.source);
  }

  async lookupOnlineLyrics(trackId: string): Promise<{
    synced?: LyricLine[];
    plain?: string[];
    provider: string;
  }> {
    const candidates = await this.searchOnlineLyrics(trackId);
    const first = candidates[0];
    if (!first) throw new Error("没有在在线歌词库找到匹配结果。你可以手动粘贴歌词后使用 AI 匹配。");
    return this.resolveOnlineLyricsCandidate(trackId, first.id);
  }

  async searchOnlineLyrics(trackId: string): Promise<OnlineLyricsCandidate[]> {
    const track = (await this.library.list()).find((item) => item.id === trackId);
    if (!track) throw new Error("没有找到这首歌曲。");
    return this.collectLyricsCandidates(track);
  }

  /** 歌词工作台手动关键词搜索：以关键词代替曲目元数据在各歌词源检索 */
  async searchLyricsByKeyword(trackId: string, keyword: string): Promise<OnlineLyricsCandidate[]> {
    const track = (await this.library.list()).find((item) => item.id === trackId);
    if (!track) throw new Error("没有找到这首歌曲。");
    const cleaned = keyword.trim();
    if (!cleaned) throw new Error("请输入搜索关键词。");
    return this.collectLyricsCandidates({ ...track, title: cleaned, author: "" });
  }

  private async collectLyricsCandidates(track: Track): Promise<OnlineLyricsCandidate[]> {
    const candidates: OnlineLyricsCandidate[] = [];
    const fingerprints = new Set<string>();
    const cache = (candidate: Omit<OnlineLyricsCandidate, "id">, lyrics: { synced?: LyricLine[]; plain?: string[] }) => {
      const text = (lyrics.synced?.map((line) => line.text) || lyrics.plain || [])
        .join("\n").toLocaleLowerCase().replace(/\s+/g, "").trim();
      if (!text || fingerprints.has(text)) return;
      fingerprints.add(text);
      const id = crypto.randomUUID();
      this.onlineLyricsCache.set(id, { trackId: track.id, provider: candidate.provider, ...lyrics });
      const expiry = setTimeout(() => this.onlineLyricsCache.delete(id), 15 * 60 * 1000);
      expiry.unref();
      candidates.push({ id, ...candidate });
    };
    try {
      const url = new URL("https://lrclib.net/api/search");
      url.searchParams.set("q", `${track.title} ${track.author}`.trim());
      const response = await fetch(url, {
        headers: { "User-Agent": "LyraLink/0.1 (lyrics lookup)" }
      });
      if (response.ok) {
        const results = await response.json() as LrclibSearchResponse[];
        for (const result of results.slice(0, 8)) {
          // 有 syncedLyrics 时保留时间轴（LRC 歌词文件），否则退回纯文本
          const timed = result.syncedLyrics ? parseLrcLyrics(result.syncedLyrics) : [];
          const plain = !timed.length && result.plainLyrics ? parsePlainLyrics(result.plainLyrics) : [];
          if (!timed.length && !plain.length) continue;
          cache({
            provider: "LRCLIB",
            title: result.trackName || track.title,
            author: result.artistName || track.author,
            album: result.albumName || null,
            duration: typeof result.duration === "number" ? result.duration : null,
            mode: timed.length ? "synced" : "plain"
          }, timed.length ? { synced: timed } : { plain });
        }
      }
    } catch (error) {
      console.warn("[lrclib] 查询失败，准备查询其他歌词源:", error);
    }
    try {
      const fallbackUrl = new URL("https://api.lrc.cx/lyrics");
      fallbackUrl.searchParams.set("title", track.title);
      fallbackUrl.searchParams.set("artist", track.author);
      const fallbackResponse = await fetch(fallbackUrl, { headers: bilibiliHeaders });
      if (fallbackResponse.ok) {
        const plain = plainLyricsFromLrc(await fallbackResponse.text());
        if (plain.length) cache({
          provider: "LrcAPI", title: track.title, author: track.author,
          album: null, duration: track.duration, mode: "plain"
        }, { plain });
      }
    } catch (error) {
      console.warn("[lrcapi] 查询失败:", error);
    }
    const neteaseSearch = (async () => {
      const searchUrl = new URL("https://music.163.com/api/search/get/web");
      searchUrl.searchParams.set("csrf_token", "");
      searchUrl.searchParams.set("s", track.title);
      searchUrl.searchParams.set("type", "1");
      searchUrl.searchParams.set("offset", "0");
      searchUrl.searchParams.set("total", "true");
      searchUrl.searchParams.set("limit", "30");
      const response = await platformRequest(searchUrl, "https://music.163.com/");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as NeteaseSearchResponse;
      const matches = rankPlatformMatches((payload.result?.songs || []).map((song) => ({
        id: String(song.id || ""),
        title: song.name || track.title,
        author: (song.artists || []).map((artist) => artist.name).filter(Boolean).join(" / ") || track.author,
        album: song.album?.name || null,
        duration: typeof song.duration === "number" ? song.duration / 1000 : null
      })).filter((song) => song.id), track).slice(0, 3);
      await Promise.allSettled(matches.map(async (match) => {
        const lyricUrl = new URL("https://music.163.com/api/song/lyric");
        lyricUrl.searchParams.set("id", match.id);
        lyricUrl.searchParams.set("lv", "1");
        lyricUrl.searchParams.set("kv", "1");
        lyricUrl.searchParams.set("tv", "-1");
        const lyricResponse = await platformRequest(lyricUrl, `https://music.163.com/song?id=${match.id}`);
        if (!lyricResponse.ok) return;
        const lyricPayload = await lyricResponse.json() as { lrc?: { lyric?: string } };
        const lrcText = lyricPayload.lrc?.lyric || "";
        const timed = lrcText ? parseLrcLyrics(lrcText) : [];
        const plain = !timed.length && lrcText ? plainLyricsFromLrc(lrcText) : [];
        if (!timed.length && !plain.length) return;
        cache({
          provider: "网易云",
          title: match.title,
          author: match.author,
          album: match.album,
          duration: match.duration,
          mode: timed.length ? "synced" : "plain"
        }, timed.length ? { synced: timed } : { plain });
      }));
    })();
    await Promise.allSettled([neteaseSearch]);
    return candidates;
  }

  async resolveOnlineLyricsCandidate(trackId: string, candidateId: string): Promise<{
    synced?: LyricLine[];
    plain?: string[];
    provider: string;
  }> {
    const cached = this.onlineLyricsCache.get(candidateId);
    if (!cached || cached.trackId !== trackId) throw new Error("歌词候选已失效，请重新搜索。");
    return { synced: cached.synced, plain: cached.plain, provider: cached.provider };
  }

  private async ensurePreviewServer(): Promise<void> {
    if (this.previewServer && this.previewPort) return;
    this.previewServer = createServer((request, response) => {
      const streamToken = request.url?.match(/^\/stream\/([\w-]+)$/)?.[1];
      if (streamToken) {
        const stream = this.previewStreams.get(streamToken);
        if (!stream) {
          response.writeHead(404).end();
          return;
        }
        // 依次尝试候选直链；透传 Range 以支持进度条拖动
        void (async () => {
          for (const candidate of stream.urls) {
            const headers = { ...stream.headers } as Record<string, string>;
            const range = request.headers.range;
            if (range) headers.Range = range;
            let upstream: Response;
            try {
              upstream = await fetch(candidate, { headers });
            } catch {
              continue;
            }
            if (!upstream.ok || !upstream.body) continue;
            response.writeHead(upstream.status === 206 ? 206 : 200, {
              "Content-Type": upstream.headers.get("content-type") || "audio/mpeg",
              "Cache-Control": "no-store",
              ...(upstream.headers.get("content-range")
                ? { "Content-Range": upstream.headers.get("content-range") as string }
                : {}),
              ...(upstream.headers.get("content-length")
                ? { "Content-Length": upstream.headers.get("content-length") as string }
                : {})
            });
            const upstreamStream = Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream);
            // 播放器暂停/切歌会中途断开连接：必须双向挂 error 处理器，
            // 否则 undici 的 "TypeError: terminated" 会变成主进程未捕获异常
            upstreamStream.on("error", () => {
              if (!response.writableEnded) response.destroy();
            });
            response.on("error", () => upstreamStream.destroy());
            response.on("close", () => upstreamStream.destroy());
            upstreamStream.pipe(response);
            return;
          }
          if (!response.headersSent) response.writeHead(502);
          response.end();
        })().catch(() => {
          if (!response.headersSent) response.writeHead(502);
          response.end();
        });
        return;
      }
      const bilibiliToken = request.url?.match(/^\/bilibili-preview\/([\w-]+)$/)?.[1];
      const token = bilibiliToken;
      const sourceUrl = token ? this.previewLinks.get(token) : undefined;
      if (!sourceUrl) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "Transfer-Encoding": "chunked"
      });
      // yt-dlp reads Bilibili's DASH segments; ffmpeg remuxes them to a browser
      // friendly MP3 byte stream. No media is written to disk.
      const downloader = spawn(this.ytDlpCommand, [
        "--no-warnings", "--no-playlist", "--format", "bestaudio[ext=m4a]/bestaudio",
        "--output", "-", "--user-agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        "--add-header", "Referer:https://www.bilibili.com/", sourceUrl
      ], { env: directNetworkEnvironment(), windowsHide: true });
      const transcoder = spawn(this.ffmpegCommand, [
        "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn",
        "-c:a", "libmp3lame", "-b:a", "192k", "-f", "mp3", "pipe:1"
      ], { windowsHide: true });
      downloader.stdout.pipe(transcoder.stdin);
      transcoder.stdout.pipe(response);
      // Closing or switching a preview tears down both child processes. Their
      // pipe sockets may report EPIPE during that normal shutdown; consume the
      // stream errors so they never become uncaught main-process exceptions.
      downloader.stdout.on("error", () => undefined);
      transcoder.stdin.on("error", () => undefined);
      transcoder.stdout.on("error", () => undefined);
      response.on("error", () => undefined);
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        downloader.stdout.unpipe(transcoder.stdin);
        transcoder.stdout.unpipe(response);
        if (!downloader.killed) downloader.kill();
        if (!transcoder.killed) transcoder.kill();
      };
      // IncomingMessage emits `close` once its request body is read, which is
      // immediately for an audio GET. Watch the response instead so streaming
      // remains alive until the player actually disconnects.
      response.on("close", close);
      downloader.on("error", close);
      transcoder.on("error", close);
      transcoder.on("close", () => { if (!response.writableEnded) response.end(); });
    });
    await new Promise<void>((resolve, reject) => {
      this.previewServer!.once("error", reject);
      this.previewServer!.listen(0, "127.0.0.1", () => {
        const address = this.previewServer!.address();
        this.previewPort = typeof address === "object" && address ? address.port : null;
        resolve();
      });
    });
  }
}

function toFriendlyError(message: string): string {
  if (/unsupported url/i.test(message)) return "平台暂时无法解析这个链接，可能是链接类型尚未支持。";
  if (/private|login|sign in/i.test(message)) return "该内容需要登录或不是公开内容。";
  if (/network|timed out|unable to download|connection/i.test(message)) return "网络连接失败，请稍后重试。";
  return message;
}
