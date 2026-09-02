<script setup lang="ts">
import { computed, ref } from "vue";
import type { AppSettings } from "../../../shared/types.js";
import { useSettingsStore } from "../stores/settings.js";
import { useLibraryStore } from "../stores/library.js";
import { usePlayerStore } from "../stores/player.js";
import { useSearchStore } from "../stores/search.js";
import { useViewStore } from "../stores/view.js";
import { useModalsStore } from "../stores/modals.js";
import { THEME_PRESETS, resolveActiveTheme } from "../theme.js";
import { toast } from "../ui.js";
import type { CustomThemeConfig } from "../../../shared/types.js";

const settings = useSettingsStore();
const modals = useModalsStore();
const library = useLibraryStore();
const player = usePlayerStore();
const search = useSearchStore();
const view = useViewStore();

const s = computed(() => settings.settings);
const customThemes = computed(() => s.value.customThemes || []);
const activeThemeId = computed(() => s.value.theme || "dark");
const activeName = computed(() => resolveActiveTheme(s.value).name);

function createAndEdit() {
  const theme = settings.createCustomTheme();
  modals.openThemeEditor(theme.id, "custom");
}
const behaviorCards = [
  { value: "tray", icon: "⌄", label: "系统托盘", desc: "隐藏任务栏图标，继续播放" },
  { value: "taskbar", icon: "—", label: "任务栏", desc: "保留任务栏入口" },
  { value: "exit", icon: "×", label: "退出软件", desc: "停止播放并完全退出" }
] as const;

function chooseTheme(value: string) {
  settings.chooseTheme(value);
}
function chooseBehavior(value: (typeof behaviorCards)[number]["value"]) {
  settings.settings.closeBehavior = value;
  settings.scheduleSave();
}
function setDefaultPlayMode(value: string) {
  settings.settings.defaultPlayMode = value as AppSettings["defaultPlayMode"];
  settings.scheduleSave();
}
function setDefaultSort(value: string) {
  settings.settings.defaultSort = value as AppSettings["defaultSort"];
  settings.scheduleSave();
}
async function backup() {
  try {
    if (await window.linkAudio.backupLibrary()) {
      settings.statusText = "音乐、封面、歌词、歌单和设置已完整备份。";
      settings.statusKind = "success";
    }
  } catch (error) {
    settings.statusText = error instanceof Error ? error.message : String(error);
    settings.statusKind = "error";
  }
}
async function restoreBackup() {
  settings.statusText = "";
  try {
    if (await window.linkAudio.restoreLibraryBackup()) {
      await library.refreshAll();
      settings.statusText = "音乐库已经恢复。";
      settings.statusKind = "success";
    }
  } catch (error) {
    settings.statusText = error instanceof Error ? error.message : String(error);
    settings.statusKind = "error";
  }
}
async function cleanTrashNow() {
  library.deletedTracks = await window.linkAudio.cleanTrash();
  settings.statusText = "过期的回收站内容已经清理。";
  settings.statusKind = "success";
}
</script>

<template>
  <section class="settings-view">
    <header class="sv-head">
      <h3>设置</h3>
      <p class="muted">调整应用行为、音乐库和本地数据。</p>
    </header>

    <div class="sv-card">
      <div class="sv-overview">
        <span class="sv-icon">⚙</span>
        <div><h4>通用设置</h4><p class="muted">外观、窗口行为、播放偏好与本地数据。</p></div>
        <span class="autosave"><i></i>自动保存</span>
      </div>

      <div class="group">
        <div class="g-head">
          <strong>外观</strong>
          <small class="muted">当前主题：{{ activeName }}。可选预设，或创建多个自己的主题。</small>
        </div>
        <div class="cards">
          <button
            v-for="preset in THEME_PRESETS"
            :key="preset.id"
            class="choice-card"
            :class="{ on: activeThemeId === preset.id }"
            @click="chooseTheme(preset.id)"
          >
            <span class="thumb" :style="{ background: `linear-gradient(120deg, ${preset.surface} 55%, ${preset.accent} 55.5%)` }"></span>
            <b>{{ preset.name }}</b>
            <small>{{ preset.desc }}</small>
            <em v-if="activeThemeId === preset.id" class="check">✓</em>
            <span class="card-ops" @click.stop>
              <button class="mini-btn" title="编辑并保存为修改版" @click="modals.openThemeEditor(preset.id, 'preset')">✎</button>
            </span>
          </button>
          <button
            v-for="theme in customThemes"
            :key="theme.id"
            class="choice-card"
            :class="{ on: activeThemeId === theme.id }"
            @click="chooseTheme(theme.id)"
          >
            <span class="thumb" :style="{ background: `linear-gradient(120deg, ${theme.surface} 55%, ${theme.accent} 55.5%)` }"></span>
            <b>{{ theme.name }}</b>
            <small>{{ theme.mode === "dark" ? "自定义 · 深色" : "自定义 · 浅色" }}</small>
            <em v-if="activeThemeId === theme.id" class="check">✓</em>
            <span class="card-ops" @click.stop>
              <button class="mini-btn" title="编辑主题" @click="modals.openThemeEditor(theme.id, 'custom')">✎</button>
              <button class="mini-btn del" title="删除主题" @click="settings.deleteCustomTheme(theme.id)">✕</button>
            </span>
          </button>
          <button class="choice-card new-theme" @click="createAndEdit">
            <span class="plus">＋</span>
            <b>新建主题</b>
            <small>自定义名字与配色</small>
          </button>
        </div>


      </div>

      <div class="group">
        <div class="g-head"><strong>窗口行为</strong><small class="muted">选择点击右上角关闭按钮后的动作。</small></div>
        <div class="cards">
          <button
            v-for="card in behaviorCards"
            :key="card.value"
            class="choice-card behavior"
            :class="{ on: (s.closeBehavior || 'tray') === card.value }"
            @click="chooseBehavior(card.value)"
          >
            <span class="bicon">{{ card.icon }}</span>
            <b>{{ card.label }}</b>
            <small>{{ card.desc }}</small>
            <em v-if="(s.closeBehavior || 'tray') === card.value" class="check">✓</em>
          </button>
        </div>
      </div>

      <div class="group">
        <div class="g-head"><strong>播放与音乐库</strong><small class="muted">统一管理播放行为和歌曲列表。</small></div>
        <div class="form-grid">
          <label>默认播放模式
            <select class="inp" :value="s.defaultPlayMode || 'list'" @change="setDefaultPlayMode(($event.target as HTMLSelectElement).value)">
              <option value="list">顺序播放</option>
              <option value="shuffle">随机播放</option>
              <option value="repeat">单曲循环</option>
            </select>
          </label>
          <label>默认排序方式
            <select class="inp" :value="s.defaultSort || 'newest'" @change="setDefaultSort(($event.target as HTMLSelectElement).value)">
              <option value="newest">最近导入</option>
              <option value="title">按歌名</option>
              <option value="author">按歌手</option>
              <option value="duration">按时长</option>
            </select>
          </label>
          <label class="checkline"><input type="checkbox" :checked="s.rememberVolume !== false" @change="s.rememberVolume = ($event.target as HTMLInputElement).checked; settings.scheduleSave()" /> 记住上次音量设置</label>
          <label class="checkline"><input type="checkbox" :checked="s.showSourceColumn !== false" @change="s.showSourceColumn = ($event.target as HTMLInputElement).checked; settings.scheduleSave()" /> 歌曲列表显示"来源"列</label>
        </div>
      </div>

      <div class="group">
        <div class="g-head"><strong>本地数据管理</strong><small class="muted">音乐、封面、歌词和设置仅保存在本机。</small></div>
        <div class="ops">
          <div class="op"><div><strong>备份音乐库</strong><small class="muted">导出音乐、封面、歌词、歌单和设置。</small></div><button class="btn secondary sm" @click="backup">选择备份位置</button></div>
          <div class="op"><div><strong>恢复音乐库</strong><small class="muted">从已有 LyraLink 备份恢复本地数据。</small></div><button class="btn secondary sm" @click="restoreBackup">选择备份恢复</button></div>
          <div class="op">
            <div><strong>清理过期回收站</strong><small class="muted">立即按照上方保留天数清理内容。</small></div>
            <div class="op-right">
              <input class="inp days" type="number" min="0" max="3650" :value="s.trashRetentionDays" @change="s.trashRetentionDays = Math.max(0, Math.min(3650, Number(($event.target as HTMLInputElement).value) || 0)); settings.scheduleSave()" />
              <button class="btn secondary sm" @click="cleanTrashNow">立即清理</button>
            </div>
          </div>
        </div>
        <p class="g-note">回收站保留天数（0 表示不自动清理）。</p>
      </div>

      <div class="group">
        <div class="g-head"><strong>键盘快捷键</strong><small class="muted">在输入框中打字时，以下快捷键不会触发。</small></div>
        <div class="shortcuts">
          <div><kbd>空格</kbd><span>播放 / 暂停</span></div>
          <div><kbd>Ctrl + →</kbd><span>下一首</span></div>
          <div><kbd>Ctrl + ←</kbd><span>上一首</span></div>
          <div><kbd>Ctrl + F</kbd><span>搜索音乐库</span></div>
          <div><kbd>Esc</kbd><span>关闭弹窗，或从歌词页逐级返回</span></div>
        </div>
      </div>

      <label class="consent">
        <input type="checkbox" :checked="s.confirmedAuthorized" @change="s.confirmedAuthorized = ($event.target as HTMLInputElement).checked; settings.scheduleSave()" />
        <span>我确认自己有权保存和处理该内容，且内容不受付费、会员、私密或 DRM 限制。</span>
      </label>

      <p v-if="settings.statusText" class="sv-status" :class="settings.statusKind">{{ settings.statusText }}</p>
    </div>

    <div class="sv-tail">
      <button class="btn ghost sm" @click="view.showView('library', 'all')">← 返回音乐库</button>
      <span class="muted" style="font-size: 12px">当前搜索范围：{{ search.source === "local" ? "本地" : "B站" }} · 队列 {{ player.queueRows.length }} 首</span>
    </div>
  </section>
</template>

<style scoped>
.settings-view { max-width: 1060px; margin: 0 auto; padding: 30px 28px 60px; }
.sv-head h3 { margin: 0 0 2px; font-size: 28px; font-weight: 800; }
.sv-card {
  border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--panel-solid);
  padding: 24px; margin-top: 18px; box-shadow: var(--shadow-sm);
}
.sv-overview { display: flex; align-items: center; gap: 14px; padding-bottom: 18px; border-bottom: 1px solid var(--line); }
.sv-icon {
  width: 44px; height: 44px; border-radius: 13px; display: grid; place-items: center;
  background: var(--accent); color: var(--on-accent); font-size: 20px;
}
.sv-overview h4 { margin: 0 0 2px; font-size: 16px; }
.sv-overview p { margin: 0; font-size: 12.5px; }
.autosave {
  margin-left: auto; display: inline-flex; align-items: center; gap: 6px;
  font-size: 11.5px; color: var(--ink-2); border: 1px solid var(--line-strong);
  border-radius: 999px; padding: 4px 12px;
}
.autosave i { width: 7px; height: 7px; border-radius: 50%; background: var(--success); }
.group { padding: 20px 0; border-bottom: 1px solid var(--line); }
.group:last-of-type { border-bottom: 0; }
.g-head { display: flex; flex-direction: column; gap: 2px; margin-bottom: 14px; }
.g-head strong { font-size: 14.5px; }
.g-head small { font-size: 12px; }
.cards { display: flex; gap: 12px; flex-wrap: wrap; }
.choice-card {
  position: relative; width: 200px; text-align: left; cursor: pointer;
  border: 1px solid var(--line-strong); border-radius: var(--r-md); background: var(--bg);
  padding: 14px; color: var(--ink);
}
.choice-card:hover { border-color: var(--accent); }
.choice-card.on { border-color: var(--accent); background: var(--accent-soft); }
.choice-card .thumb {
  display: block; height: 52px; border-radius: 9px; margin-bottom: 10px;
  background: linear-gradient(120deg, #121311 55%, #e7ff57 55.5%);
}
.choice-card .thumb[data-theme="light"] { background: linear-gradient(120deg, #f2f1ea 55%, #8fae12 55.5%); }
.choice-card .thumb[data-theme="custom"] { background: linear-gradient(120deg, #22231f 55%, #7bd88f 55.5%); }
.choice-card b { display: block; font-size: 13.5px; }
.choice-card small { color: var(--ink-3); font-size: 11.5px; }
.rename-input {
  width: 100%; padding: 3px 6px; border-radius: 6px; font-size: 12.5px;
  border: 1px solid var(--accent); background: var(--bg); color: var(--ink); outline: none;
}
.card-ops {
  position: absolute; top: 8px; left: 8px; display: flex; gap: 5px;
  opacity: 0; transition: opacity 0.15s;
}
.choice-card:hover .card-ops { opacity: 1; }
.mini-btn {
  width: 22px; height: 22px; display: grid; place-items: center;
  border: 1px solid var(--line-strong); border-radius: 7px; background: var(--panel-solid);
  color: var(--ink-2); cursor: pointer; font-size: 11px;
}
.mini-btn:hover { border-color: var(--accent); color: var(--ink); background: var(--accent-soft); }
.mini-btn.del:hover { border-color: var(--danger); background: var(--danger-soft); color: var(--danger); }
.choice-card.new-theme {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  border-style: dashed; color: var(--ink-2); min-height: 118px;
}
.choice-card.new-theme:hover { color: var(--ink); }
.choice-card.new-theme .plus { font-size: 24px; color: var(--accent); }
.appear-row { display: flex; align-items: center; gap: 10px; margin-top: 16px; font-size: 12.5px; flex-wrap: wrap; }
.appear-row .checkline { display: flex; align-items: center; gap: 8px; color: var(--ink-2); cursor: pointer; }
.appear-row input[type="checkbox"] { accent-color: var(--accent); }
.blur-slider { width: 140px; accent-color: var(--accent); }
.choice-card .check {
  position: absolute; top: 8px; right: 8px; width: 20px; height: 20px; border-radius: 50%;
  display: grid; place-items: center; background: var(--accent); color: var(--on-accent);
  font-size: 11px; font-weight: 700; font-style: normal;
}
.choice-card.behavior .bicon { font-size: 22px; }
.custom-row { display: flex; align-items: center; gap: 18px; margin-top: 12px; font-size: 12.5px; color: var(--ink-2); }
.color-field { display: flex; align-items: center; gap: 8px; }
.color-field input[type="color"] {
  width: 40px; height: 28px; padding: 2px; border: 1px solid var(--line-strong);
  border-radius: 8px; background: var(--bg); cursor: pointer;
}
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 22px; }
.form-grid label { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; color: var(--ink-2); }
.form-grid label.checkline { flex-direction: row; align-items: center; gap: 9px; margin-top: 10px; }
.inp {
  padding: 8px 12px; border-radius: 10px; border: 1px solid var(--line-strong);
  background: var(--bg); color: var(--ink); font-size: 13px; outline: none;
}
.inp:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.inp.days { width: 80px; }
.ops { display: flex; flex-direction: column; gap: 12px; }
.op { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.op strong { display: block; font-size: 13px; }
.op small { font-size: 12px; }
.op-right { display: flex; align-items: center; gap: 8px; }
.g-note { margin: 10px 0 0; font-size: 11.5px; color: var(--ink-3); }
.shortcuts { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 8px 22px; }
.shortcuts div { display: flex; align-items: center; gap: 12px; padding: 6px 0; border-bottom: 1px dashed var(--line); font-size: 12.5px; color: var(--ink-2); }
.shortcuts kbd {
  min-width: 84px; text-align: center; padding: 3px 8px; border: 1px solid var(--line-strong);
  border-radius: 6px; background: var(--bg); color: var(--ink); font-size: 11.5px;
}
.consent { display: flex; gap: 10px; align-items: flex-start; margin-top: 18px; font-size: 12.5px; color: var(--ink-2); }
.consent input { accent-color: var(--accent); margin-top: 3px; }
.sv-status { margin: 14px 0 0; font-size: 12.5px; }
.sv-status.success { color: var(--success); }
.sv-status.error { color: var(--danger); }
.sv-tail { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; }
</style>
