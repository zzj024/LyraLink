<script setup lang="ts">
import { computed } from "vue";
import { useLibraryStore } from "../stores/library.js";
import { useViewStore } from "../stores/view.js";
import { useModalsStore } from "../stores/modals.js";

const view = useViewStore();
const library = useLibraryStore();
const modals = useModalsStore();

const playlists = computed(() => library.playlists);

function goLibrary(collection: string) {
  view.showView("library", collection);
}
function isActive(collection: string) {
  return view.current === "library" && view.activeCollection === collection;
}
function newPlaylist() {
  modals.openPlaylist();
}
</script>

<template>
  <aside class="sidebar" :class="{ collapsed: view.sidebarCollapsed }">
    <div class="brand">
      <span class="logo">L</span>
      <div class="brand-text"><b>LyraLink</b></div>
    </div>

    <nav class="nav">
      <button class="nav-item" :class="{ on: view.current === 'import' }" @click="view.showView('import')">
        <span class="ico">⇪</span><b>导入音乐</b>
      </button>
      <button class="nav-item" :class="{ on: view.current === 'search' }" @click="view.showView('search')">
        <span class="ico">⌕</span><b>在线搜索</b>
      </button>
      <button class="nav-item" :class="{ on: isActive('all') }" @click="goLibrary('all')">
        <span class="ico">♫</span><b>音乐库</b>
      </button>
      <button class="nav-item" :class="{ on: isActive('favorites') }" @click="goLibrary('favorites')">
        <span class="ico">♥</span><b>我喜欢的音乐</b>
      </button>
    </nav>

    <div class="nav-heading"><span>我的歌单</span><button class="add" title="新建歌单" @click="newPlaylist">＋</button></div>
    <div class="nav-sub-group">
      <button
        v-for="playlist in playlists"
        :key="playlist.id"
        class="nav-sub"
        :class="{ on: isActive(`playlist:${playlist.id}`) }"
        @click="goLibrary(`playlist:${playlist.id}`)"
      >
        {{ playlist.name }}
      </button>
      <div v-if="!playlists.length" class="nav-empty">还没有歌单</div>
    </div>

    <nav class="nav foot">
      <button class="nav-item" :class="{ on: view.current === 'tasks' }" @click="view.showView('tasks')">
        <span class="ico">▤</span><b>处理记录</b>
      </button>
      <button class="nav-item" :class="{ on: view.current === 'settings' }" @click="view.showView('settings')">
        <span class="ico">⚙</span><b>设置</b>
      </button>
      <button class="nav-item" :class="{ on: isActive('trash') }" @click="goLibrary('trash')">
        <span class="ico">♲</span><b>回收站</b>
      </button>
      <button class="nav-item collapse" @click="view.toggleSidebar">
        <span class="ico">{{ view.sidebarCollapsed ? "»" : "«" }}</span><b>{{ view.sidebarCollapsed ? "" : "收起侧栏" }}</b>
      </button>
    </nav>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex; flex-direction: column;
  width: 216px; padding: 16px 12px 12px;
  transition: width .2s ease;
  background: var(--panel);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-right: 1px solid var(--line);
  overflow-y: auto;
  min-height: 0;
}
.brand { display: flex; align-items: center; gap: 10px; padding: 2px 10px 14px; }
.brand .logo {
  width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center;
  background: var(--accent); color: var(--on-accent); font-weight: 800; font-size: 15px;
  box-shadow: 0 4px 14px var(--accent-soft-2);
}
.brand b { font-size: 14px; display: block; }
.brand small { display: block; color: var(--ink-3); font-size: 10.5px; }
.nav { display: flex; flex-direction: column; gap: 3px; }
.nav-item {
  display: flex; align-items: center; gap: 11px;
  padding: 9px 12px; border-radius: var(--r-sm); font-size: 13.5px;
  color: var(--ink-2); cursor: pointer; position: relative;
  border: 1px solid transparent; background: transparent; text-align: left; width: 100%;
  transition: background .15s, color .15s;
}
.nav-item:hover { background: var(--row-hover); color: var(--ink); }
.nav-item.on { background: var(--accent-soft); color: var(--ink); font-weight: 600; border-color: var(--line); }
.nav-item.on::before {
  content: ""; position: absolute; left: 0; top: 22%; bottom: 22%; width: 3px;
  border-radius: 3px; background: var(--accent);
}
.nav-item .ico { width: 18px; text-align: center; }
.nav-heading {
  display: flex; justify-content: space-between; align-items: center;
  margin: 14px 10px 5px; color: var(--ink-3); font-size: 11.5px; letter-spacing: .5px;
}
.nav-heading .add {
  cursor: pointer; color: var(--ink-3); border: 0; background: transparent;
  padding: 1px 7px; border-radius: 6px; font-size: 12px;
}
.nav-heading .add:hover { background: var(--row-hover); color: var(--ink); }
.nav-sub-group { display: flex; flex-direction: column; gap: 2px; }
.nav-sub {
  padding: 6px 12px 6px 41px; border-radius: 8px; color: var(--ink-2); font-size: 13px;
  cursor: pointer; border: 0; background: transparent; text-align: left; width: 100%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.nav-sub:hover { background: var(--row-hover); color: var(--ink); }
.nav-sub.on { background: var(--accent-soft); color: var(--ink); font-weight: 600; }
.nav-empty { padding: 4px 12px 6px 41px; color: var(--ink-3); font-size: 11.5px; }
.sidebar.collapsed { width: 60px; padding-left: 8px; padding-right: 8px; }
.sidebar.collapsed .brand-text,
.sidebar.collapsed .nav-item b,
.sidebar.collapsed .nav-heading,
.sidebar.collapsed .nav-sub,
.sidebar.collapsed .nav-empty { display: none; }
.sidebar.collapsed .nav-item { justify-content: center; }
.foot { margin-top: auto; border-top: 1px solid var(--line); padding-top: 10px; }
.sidebar-expand {
  position: absolute; left: 0; top: 50%; z-index: 20;
  width: 22px; height: 56px; border: 1px solid var(--line-strong); border-left: 0;
  border-radius: 0 10px 10px 0; background: var(--panel-solid); color: var(--ink-2); cursor: pointer;
}
.sidebar-expand:hover { color: var(--ink); background: var(--elevated); }
</style>
