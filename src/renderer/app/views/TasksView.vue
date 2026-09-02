<script setup lang="ts">
import { computed } from "vue";
import { useTaskStore } from "../stores/tasks.js";

const tasks = useTaskStore();
const running = computed(() => tasks.history.filter((t) => t.status === "running"));
const failed = computed(() => tasks.history.filter((t) => t.status === "error"));
const done = computed(() => tasks.history.filter((t) => t.status === "complete"));
</script>

<template>
  <section class="tasks-view">
    <header class="tv-head">
      <h3>处理记录</h3>
      <button class="btn ghost sm" @click="tasks.clearFinished()">清空历史</button>
    </header>

    <div class="card">
      <div class="task-section">
        <h4>进行中 <span v-if="running.length" class="pill num">{{ running.length }}</span></h4>
        <div v-if="!running.length" class="empty-line muted">没有正在进行的任务。</div>
        <div v-for="task in running" :key="task.id" class="task-row">
          <div class="task-copy">
            <b class="ellip">{{ task.title }}</b>
            <small>{{ task.message }}</small>
            <div class="bar"><i :style="{ width: `${task.percent ?? 0}%` }"></i></div>
          </div>
          <span class="num pct">{{ task.percent ?? 0 }}%</span>
        </div>
      </div>

      <div class="task-section">
        <h4>失败 <span v-if="failed.length" class="pill danger num">{{ failed.length }}</span></h4>
        <div v-if="!failed.length" class="empty-line muted">没有失败的任务。</div>
        <div v-for="task in failed" :key="task.id" class="task-row">
          <div class="task-copy">
            <b class="ellip">{{ task.title }}</b>
            <small class="err-text">{{ task.detail || task.message }}</small>
          </div>
          <time class="num">{{ new Date(task.time).toLocaleTimeString("zh-CN", { hour12: false }) }}</time>
        </div>
      </div>

      <div class="task-section">
        <h4>历史 <span v-if="done.length" class="pill num">{{ done.length }}</span></h4>
        <div v-if="!done.length" class="empty-line muted">完成的任务会自动归档到这里。</div>
        <div v-for="task in done" :key="task.id" class="task-row">
          <div class="task-copy">
            <b class="ellip">{{ task.title }}</b>
            <small class="ok-text">{{ task.message }}</small>
          </div>
          <time class="num">{{ new Date(task.time).toLocaleString("zh-CN", { hour12: false }) }}</time>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.tasks-view { max-width: 1060px; margin: 0 auto; padding: 30px 28px 60px; }
.tv-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.tv-head h3 { margin: 0; font-size: 28px; font-weight: 800; }
.card {
  border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--panel-solid);
  padding: 20px; box-shadow: var(--shadow-sm);
}
.task-section { padding: 12px 0; border-bottom: 1px solid var(--line); }
.task-section:first-of-type { padding-top: 0; }
.task-section:last-child { border-bottom: 0; padding-bottom: 0; }
.task-section h4 { margin: 0 0 8px; font-size: 14px; display: flex; align-items: center; gap: 8px; }
.pill { padding: 1px 8px; border-radius: 999px; font-size: 11px; background: var(--accent-soft); color: var(--ink); }
.pill.danger { background: var(--danger-soft); color: var(--danger); }
.empty-line { font-size: 12.5px; }
.task-row { display: flex; justify-content: space-between; align-items: center; gap: 14px; padding: 7px 0; }
.task-copy { min-width: 0; flex: 1; }
.task-copy b { display: block; font-size: 13px; font-weight: 600; }
.task-copy small { color: var(--ink-3); font-size: 11.5px; display: block; }
.err-text { color: var(--danger) !important; }
.ok-text { color: var(--success) !important; }
.task-row time { color: var(--ink-3); font-size: 11.5px; flex: none; }
.bar { height: 4px; border-radius: 2px; background: var(--line-strong); margin-top: 6px; max-width: 320px; overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.3s; }
.pct { color: var(--ink-2); font-size: 12px; flex: none; }
.muted { color: var(--ink-3); }
</style>
