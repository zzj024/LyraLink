import type { MediaPreview, Platform } from "../../shared/types.js";

const PLATFORM_META: Record<Platform, { label: string; color: string }> = {
  local: { label: "本地音乐", color: "var(--success)" },
  bilibili: { label: "哔哩哔哩", color: "#fb7299" },
  joox: { label: "Joox", color: "#00d26a" },
  netease: { label: "网易云", color: "#dd001b" }
};

export function platformLabel(platform: Platform): string {
  return PLATFORM_META[platform]?.label ?? platform;
}

export function platformColor(platform: Platform): string {
  return PLATFORM_META[platform]?.color ?? "var(--ink-3)";
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "--:--";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

export function formatPlayerTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "00:00";
  const minutes = Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, "0");
  const rest = Math.floor(Math.max(0, seconds) % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

export function displayTitle(value: string, maxLength = Number.POSITIVE_INFINITY): string {
  const normalized = value.trim();
  const characters = Array.from(normalized);
  return characters.length > maxLength ? `${characters.slice(0, maxLength).join("")}…` : normalized;
}

export function displayArtist(value: string | null | undefined): string {
  const normalized = value?.trim();
  return !normalized || normalized === "未知作者" ? "未知歌手" : normalized;
}

export function cleanLyrics(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/\[(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.:]\d+)?\]/g, "")
        .replace(/^\s*\d+[.、)]\s*/, "")
        .trim()
    )
    .filter(Boolean);
}

export function formatSyncTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const rest = (seconds % 60).toFixed(1).padStart(4, "0");
  return `${minutes}:${rest}`;
}

export function previewMeta(preview: MediaPreview): string {
  return `${displayArtist(preview.author)} · ${formatDuration(preview.duration)}`;
}
