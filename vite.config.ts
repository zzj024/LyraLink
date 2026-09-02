import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";
import type { Plugin } from "vite";

const rendererRoot = path.resolve(__dirname, "src/renderer");

// 开发模式下移除 CSP（Vite dev server 需要注入 HMR 客户端与 ws 连接）；
// 生产构建保留 CSP，仅放开 style-src 的 unsafe-inline 以支持 Naive UI 运行时样式注入。
function cspForDev(): Plugin {
  return {
    name: "strip-csp-in-dev",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        if (ctx.server) return html.replace(/\s*<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, "");
        return html;
      }
    }
  };
}

export default defineConfig({
  root: rendererRoot,
  base: "./",
  plugins: [vue(), cspForDev()],
  define: {
    __VUE_OPTIONS_API__: "true",
    __VUE_PROD_DEVTOOLS__: "false",
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false"
  },
  resolve: {
    alias: { "@": rendererRoot }
  },
  server: {
    port: 5174,
    strictPort: true
  },
  build: {
    outDir: path.resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
    target: "chrome120",
    sourcemap: true,
    rollupOptions: {
      input: {
        index: path.resolve(rendererRoot, "index.html"),
        "desktop-lyrics": path.resolve(rendererRoot, "desktop-lyrics.html"),
        "tray-menu": path.resolve(rendererRoot, "tray-menu.html")
      }
    }
  }
});
