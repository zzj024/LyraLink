// 并行启动：Vite（渲染层构建/监听）+ esbuild（主进程/preload/测试构建/监听）
// 用法：npm run dev          —— 两者都 watch
//       npm run dev:vite     —— 只跑 Vite dev server（配合 HMR，Electron 加载 http://localhost:5174）
import { spawn } from "node:child_process";

const tasks = [];
const run = (name, command, args, env) => {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...env }
  });
  child.on("exit", (code) => {
    console.log(`[${name}] exited with ${code}`);
    process.exitCode ??= code ?? 0;
  });
  tasks.push(child);
};

if (process.argv.includes("--serve")) {
  run("vite-serve", "npx", ["vite", "--serve"]);
  run("esbuild", "node", ["scripts/build.mjs", "--watch"]);
} else {
  run("vite", "npx", ["vite", "build", "--watch"]);
  run("esbuild", "node", ["scripts/build.mjs", "--watch"]);
}

process.on("SIGINT", () => {
  for (const task of tasks) task.kill();
  process.exit(0);
});
