import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const watch = process.argv.includes("--watch");
const root = process.cwd();
const dist = path.join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "renderer"), { recursive: true });
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
    entryPoints: ["src/renderer/app.ts"],
    outfile: "dist/renderer/app.js",
    bundle: true,
    platform: "browser",
    format: "esm",
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
  }
];

await cp("src/renderer/index.html", "dist/renderer/index.html");
await cp("src/renderer/styles.css", "dist/renderer/styles.css");
await cp("resources/icon.svg", "dist/renderer/icon.svg");
await cp("ai/align_lyrics.py", "dist/ai/align_lyrics.py");

if (watch) {
  const contexts = await Promise.all(options.map((item) => context(item)));
  await Promise.all(contexts.map((item) => item.watch()));
  console.log("Watching source files…");
} else {
  await Promise.all(options.map((item) => build(item)));
  console.log("Build complete.");
}
