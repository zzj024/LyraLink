import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

// 渲染层（index/desktop-lyrics/tray-menu 三个窗口）由 Vite 构建（见 vite.config.ts），
// 这里只负责 Electron 主进程、preload 和测试。
const watch = process.argv.includes("--watch");
const root = process.cwd();
const dist = path.join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "main"), { recursive: true });
await mkdir(path.join(dist, "tests"), { recursive: true });
await mkdir(path.join(dist, "ai"), { recursive: true });

const options = [
  {
    entryPoints: ["src/main/index.ts"],
    outfile: "dist/main/index.js",
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["electron", "youtube-dl-exec", "ffmpeg-static"],
    sourcemap: true
  },
  {
    entryPoints: ["src/main/preload.ts"],
    outfile: "dist/main/preload.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    sourcemap: true
  },
  {
    entryPoints: ["tests/adapters.test.ts"],
    outfile: "dist/tests/adapters.test.js",
    bundle: true,
    platform: "node",
    format: "esm",
    sourcemap: true
  },
  {
    entryPoints: ["tests/audio-edit.test.ts"],
    outfile: "dist/tests/audio-edit.test.js",
    bundle: true,
    platform: "node",
    format: "esm",
    sourcemap: true
  },
  {
    entryPoints: ["tests/library.test.ts"],
    outfile: "dist/tests/library.test.js",
    bundle: true,
    platform: "node",
    format: "esm",
    sourcemap: true
  },
  {
    entryPoints: ["tests/collection.test.ts"],
    outfile: "dist/tests/collection.test.js",
    bundle: true,
    platform: "node",
    format: "esm",
    sourcemap: true
  },
  {
    entryPoints: ["tests/legacy-migration.test.ts"],
    outfile: "dist/tests/legacy-migration.test.js",
    bundle: true,
    platform: "node",
    format: "esm",
    sourcemap: true
  }
];

// 主进程与桌面歌词窗口依赖的静态资源（渲染层 HTML/CSS 由 Vite 产出，含 icon.svg 经 public/ 拷贝）
await cp("ai/align_lyrics.py", "dist/ai/align_lyrics.py");

if (watch) {
  const contexts = await Promise.all(options.map((item) => context(item)));
  await Promise.all(contexts.map((item) => item.watch()));
  console.log("Watching main/preload/tests…");
} else {
  await Promise.all(options.map((item) => build(item)));
  console.log("Main/preload/tests build complete.");
}
