<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ONLINE_PLATFORMS, useSearchStore, type OnlinePlatform } from "../stores/search.js";
import { useTaskStore } from "../stores/tasks.js";
import { useViewStore } from "../stores/view.js";
import { displayArtist, displayTitle, formatDuration } from "../format.js";
import { downloadOnline, previewOnline } from "../actions/bilibili.js";

const search = useSearchStore();
const tasks = useTaskStore();
const view = useViewStore();

const keyword = ref("");

// 切换平台时带出该平台上次的搜索词
watch(() => search.platform, () => {
  keyword.value = search.current.query;
});

const platformMeta = computed(() => ONLINE_PLATFORMS.find((p) => p.id === search.platform)!);

function switchTab(platform: OnlinePlatform) {
  if (search.platform === platform) return;
  search.platform = platform;
  keyword.value = search.current.query;
}

function runSearch(page = 1) {
  void search.runSearch(search.platform, keyword.value, page);
}
function onSearchKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") runSearch(1);
}
function clearSearch() {
  keyword.value = "";
  search.clear(search.platform);
}
const done = computed(() => tasks.history.filter((t) => t.status === "complete"));
const failed = computed(() => tasks.history.filter((t) => t.status === "error"));
</script>

<template>
  <section class="search-view">
    <header class="sv-head">
      <h3>在线搜索</h3>
      <small class="muted">试听满意后再下载到音乐库</small>
    </header>

    <div class="card">
      <div class="src-tabs" role="tablist" aria-label="在线搜索音源">
        <button
          v-for="p in ONLINE_PLATFORMS"
          :key="p.id"
          class="src-tab"
          :class="{ on: search.platform === p.id }"
          role="tab"
          :aria-selected="search.platform === p.id"
          @click="switchTab(p.id)"
        >{{ p.name }}</button>
      </div>
      <div class="searchline">
        <span class="src-dot">{{ platformMeta.name.slice(0, 1) }}</span>
        <input
          v-model="keyword"
          type="search"
          :placeholder="platformMeta.placeholder"
          @keydown="onSearchKeydown"
        />
        <button class="btn primary sm" :disabled="search.loading || !keyword.trim()" @click="runSearch(1)">搜索</button>
        <button v-if="search.current.query" class="btn ghost sm" @click="clearSearch">清除</button>
      </div>
      <small class="hint muted">{{ platformMeta.hint }}</small>

      <div v-if="search.loading" class="empty-line muted">正在搜索 {{ platformMeta.name }} 内容…</div>
      <div v-else-if="search.error" class="empty-line err-text">{{ search.error }}</div>
      <div v-else-if="!search.current.page?.items.length" class="empty-line muted">
        {{ search.current.query ? "没有找到相关内容，换个关键词试试。" : "输入关键词开始搜索。" }}
      </div>
      <template v-else>
        <div v-for="item in search.current.page.items" :key="item.id" class="result-row">
          <img v-if="item.thumbnail" class="result-cover" :src="item.thumbnail" alt="" loading="lazy" />
          <span v-else class="result-cover placeholder">▶</span>
          <div class="result-copy">
            <b class="ellip" :title="item.title">{{ displayTitle(item.title) }}</b>
            <small>{{ displayArtist(item.author) }} · {{ formatDuration(item.duration) }}</small>
          </div>
          <div class="result-actions">
            <button class="icon-btn" title="在线播放试听" @click="void previewOnline(item)">▶</button>
            <button
              class="icon-btn dl"
              :class="{ done: search.downloadedIds.has(item.id) }"
              :title="search.downloadedIds.has(item.id) ? '已下载到音乐库' : '下载到音乐库'"
              @click="void downloadOnline(item)"
            >{{ search.downloadedIds.has(item.id) ? "✓" : "⇩" }}</button>
          </div>
        </div>
        <div class="pagination">
          <button class="btn ghost sm" :disabled="search.current.page.page <= 1" @click="runSearch(search.current.page.page - 1)">上一页</button>
          <span class="num">第 {{ search.current.page.page }} 页</span>
          <button class="btn ghost sm" :disabled="!search.current.page.hasMore" @click="runSearch(search.current.page.page + 1)">下一页</button>
        </div>
      </template>
    </div>

    <!-- 最近任务简报：详情在「处理记录」页 -->
    <div v-if="done.length || failed.length" class="card recent">
      <div class="card-head">
        <strong>最近任务</strong>
        <button class="btn ghost sm" @click="view.showView('tasks')">查看全部 →</button>
      </div>
      <div v-for="task in [...failed.slice(-2), ...done.slice(-3)].reverse()" :key="task.id" class="recent-row">
        <span class="dot" :class="task.status === 'error' ? 'err' : 'ok'"></span>
        <b class="ellip">{{ task.title }}</b>
        <small :class="task.status === 'error' ? 'err-text' : 'ok-text'">{{ task.status === "error" ? "失败" : "完成" }}</small>
      </div>
    </div>
  </section>
</template>

<style scoped>
.search-view { max-width: 1060px; margin: 0 auto; padding: 30px 28px 60px; }
.sv-head { display: flex; align-items: baseline; gap: 14px; margin-bottom: 16px; }
.sv-head h3 { margin: 0; font-size: 28px; font-weight: 800; }
.card {
  border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--panel-solid);
  padding: 20px; margin-bottom: 18px; box-shadow: var(--shadow-sm);
}
.card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.card-head strong { font-size: 15px; }
.src-tabs { display: inline-flex; gap: 4px; padding: 3px; border: 1px solid var(--line-strong); border-radius: 999px; background: var(--bg); margin-bottom: 14px; }
.src-tab {
  border: 0; border-radius: 999px; background: transparent; color: var(--ink-2);
  font-size: 12.5px; padding: 4px 16px; cursor: pointer; transition: background 0.12s, color 0.12s;
}
.src-tab:hover { color: var(--ink); }
.src-tab.on { background: var(--accent); color: var(--on-accent); font-weight: 700; }
.searchline {
  display: flex; align-items: center; gap: 10px; padding: 8px 12px;
  border: 1px solid var(--line-strong); border-radius: 12px; background: var(--bg);
}
.src-dot {
  width: 20px; height: 20px; border-radius: 6px; background: var(--accent); color: var(--on-accent);
  display: grid; place-items: center; font-size: 12px; font-weight: 700; flex: none;
}
.searchline input {
  flex: 1; min-width: 0; border: 0; outline: 0; background: transparent;
  color: var(--ink); font-size: 13px;
}
.searchline input::placeholder { color: var(--ink-3); }
.hint { display: block; margin-top: 8px; }
.result-row {
  display: grid; grid-template-columns: 56px minmax(0, 1fr) auto; align-items: center; gap: 14px;
  padding: 9px 10px; border-radius: 10px; border-bottom: 1px solid var(--line);
}
.result-row:hover { background: var(--row-hover); }
.result-cover { width: 56px; height: 42px; border-radius: 8px; object-fit: cover; }
.result-cover.placeholder { display: grid; place-items: center; background: var(--elevated); color: var(--ink-3); }
.result-copy { min-width: 0; }
.result-copy b { display: block; font-size: 13.5px; font-weight: 600; }
.result-copy small { color: var(--ink-3); font-size: 11.5px; }
.result-actions { display: flex; gap: 6px; }
.pagination { display: flex; align-items: center; justify-content: center; gap: 16px; padding: 14px 0 2px; color: var(--ink-2); font-size: 12.5px; }
.empty-line { font-size: 12.5px; padding: 8px 0; }
.err-text { color: var(--danger) !important; }
.ok-text { color: var(--success) !important; }
.recent-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; font-size: 12.5px; }
.recent-row b { flex: 1; min-width: 0; }
.recent-row .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.recent-row .dot.ok { background: var(--success); }
.recent-row .dot.err { background: var(--danger); }
.icon-btn {
  width: 30px; height: 30px; display: grid; place-items: center; border-radius: 9px;
  color: var(--ink-2); cursor: pointer; font-size: 13px; border: 0; background: transparent;
}
.icon-btn:hover { background: var(--accent-soft); color: var(--ink); }
.icon-btn.dl { color: #9fb54a; }
.icon-btn.dl.done { color: var(--success); }
.muted { color: var(--ink-3); }
</style>
