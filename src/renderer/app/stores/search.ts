import { defineStore } from "pinia";
import { ref } from "vue";
import type { OnlineSearchPage } from "../../../shared/types.js";

export type SearchSource = "local" | "bilibili" | "joox" | "netease";
export type OnlinePlatform = Exclude<SearchSource, "local">;

export const ONLINE_PLATFORMS: Array<{ id: OnlinePlatform; name: string; hint: string; placeholder: string }> = [
  { id: "bilibili", name: "B 站", hint: "可下载到本地音乐库", placeholder: "输入关键词搜索 B 站视频、音乐或 UP 主，回车搜索" },
  { id: "joox", name: "Joox", hint: "完整曲目 320k，可下载到本地音乐库", placeholder: "输入歌名或歌手搜索 Joox 曲库，回车搜索" },
  { id: "netease", name: "网易云", hint: "可试听并下载到本地音乐库", placeholder: "输入歌名或歌手搜索网易云曲库，回车搜索" }
];

export const useSearchStore = defineStore("search", {
  state: () => ({
    source: "local" as SearchSource,
    /** 在线搜索页当前平台 */
    platform: "bilibili" as OnlinePlatform,
    state: {
      bilibili: { query: "", page: null, done: false },
      joox: { query: "", page: null, done: false },
      netease: { query: "", page: null, done: false }
    } as Record<OnlinePlatform, { query: string; page: OnlineSearchPage | null; done: boolean }>,
    loading: false,
    error: "",
    downloadedIds: new Set<string>(),
    requestId: 0
  }),
  getters: {
    current: (state) => state.state[state.platform]
  },
  actions: {
    async runSearch(platform: OnlinePlatform, query: string, page: number) {
      const slot = this.state[platform];
      slot.query = query;
      const keyword = query.trim();
      if (!keyword) {
        slot.page = null;
        this.loading = false;
        this.error = "";
        return;
      }
      const requestId = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
      this.requestId = requestId;
      this.loading = true;
      this.error = "";
      try {
        const api = {
          bilibili: window.linkAudio.searchBilibili,
          joox: window.linkAudio.searchJoox,
          netease: window.linkAudio.searchNetease
        }[platform];
        const result = await api(keyword, page);
        if (this.requestId !== requestId) return;
        slot.page = result;
      } catch (error) {
        if (this.requestId !== requestId) return;
        this.error = error instanceof Error ? error.message : String(error);
        slot.page = null;
      } finally {
        if (this.requestId === requestId) this.loading = false;
      }
    },
    /** 从音乐库空态跳转过来：定位到指定平台并立即搜索 */
    searchFromLibrary(query: string, platform: OnlinePlatform) {
      this.platform = platform;
      return this.runSearch(platform, query, 1);
    },
    clear(platform: OnlinePlatform) {
      const slot = this.state[platform];
      slot.query = "";
      slot.page = null;
      this.error = "";
      this.loading = false;
    }
  }
});
