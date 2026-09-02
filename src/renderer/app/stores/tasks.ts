import { defineStore } from "pinia";
import { ref } from "vue";
import type { UiTask } from "../types.js";
import { toast } from "../ui.js";

const MAX_TASKS = 20;

function load(): UiTask[] {
  try {
    const raw = localStorage.getItem("linkAudioTasks");
    if (!raw) return [];
    const list = JSON.parse(raw) as UiTask[];
    return list.map((task) =>
      task.status === "running" ? { ...task, status: "error" as const, detail: "任务被中断" } : task
    );
  } catch {
    return [];
  }
}

export const useTaskStore = defineStore("tasks", () => {
  const history = ref<UiTask[]>(load());

  function persist() {
    localStorage.setItem("linkAudioTasks", JSON.stringify(history.value.slice(0, MAX_TASKS)));
  }

  function record(
    message: string,
    status: UiTask["status"],
    detail?: string,
    taskId?: string,
    title?: string,
    percent?: number
  ) {
    const existing = taskId ? history.value.find((task) => task.id === taskId) : undefined;
    if (existing) {
      existing.message = message;
      existing.status = status;
      existing.detail = detail ?? existing.detail;
      existing.percent = percent ?? existing.percent;
      if (title) existing.title = title;
      existing.time = Date.now();
    } else {
      history.value.unshift({
        id: taskId || crypto.randomUUID(),
        title: title || "任务",
        message,
        status,
        detail,
        percent,
        time: Date.now()
      });
    }
    history.value = history.value.slice(0, MAX_TASKS);
    persist();
  }

  function clearFinished() {
    history.value = history.value.filter((task) => task.status === "running");
    persist();
  }

  /** onProgress 事件 → 任务记录 + 消息提示 */
  function applyProgress(progress: {
    stage: string;
    message: string;
    percent?: number;
    taskId?: string;
    title?: string;
  }) {
    const status = progress.stage === "complete" ? "complete" : progress.stage === "error" ? "error" : "running";
    if (progress.taskId) {
      record(
        progress.message,
        status,
        progress.stage === "error" ? progress.message : undefined,
        progress.taskId,
        progress.title || "链接下载",
        progress.percent
      );
    }
    toast(progress.message, progress.stage === "error" ? "error" : progress.stage === "complete" ? "success" : "info");
  }

  return { history, record, clearFinished, applyProgress };
});

export type { UiTask };
