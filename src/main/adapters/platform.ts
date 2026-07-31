import type { ParsedLink, Platform } from "../../shared/types.js";

const URL_PATTERN = /https?:\/\/[^\s，。！？、；：）)\]}>]+/i;

interface PlatformRule {
  platform: Platform;
  hosts: string[];
}

const RULES: PlatformRule[] = [
  {
    platform: "bilibili",
    hosts: ["bilibili.com", "www.bilibili.com", "m.bilibili.com", "b23.tv"]
  }
];

function cleanUrl(raw: string): string {
  return raw.replace(/[，。！？、；：）)\]}>]+$/u, "");
}

export function parseSupportedLink(input: string): ParsedLink {
  const match = input.match(URL_PATTERN);
  if (!match) {
    throw new Error("没有找到有效网址，请粘贴哔哩哔哩分享链接。");
  }

  let url: URL;
  try {
    url = new URL(cleanUrl(match[0]));
  } catch {
    throw new Error("链接格式无效。");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("只支持 HTTP 或 HTTPS 链接。");
  }

  const host = url.hostname.toLowerCase();
  const rule = RULES.find((item) =>
    item.hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
  );

  if (!rule) {
    throw new Error("目前只支持哔哩哔哩链接。");
  }

  return { platform: rule.platform, url: url.toString() };
}
