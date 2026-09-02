import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { AppSettings, CustomThemeConfig } from "../../../shared/types.js";
import { applyAppearance, resolveActiveTheme } from "../theme.js";

const DEFAULTS: AppSettings = {
  confirmedAuthorized: false,
  trashRetentionDays: 30,
  onboardingCompleted: false,
  theme: "dark"
};

let saveTimer = 0;

export const useSettingsStore = defineStore("settings", () => {
  const settings = ref<AppSettings>({ ...DEFAULTS });
  const statusText = ref("");
  const statusKind = ref<"success" | "error">("success");

  const isDarkTheme = computed(() => resolveActiveTheme(settings.value).mode === "dark");
  const themeActive = computed(() => settings.value.theme || "dark");

  /** 应用主题变量到文档 */
  function applyTheme() {
    applyAppearance(settings.value);
  }

  async function load() {
    settings.value = { ...DEFAULTS, ...(await window.linkAudio.getSettings()) };
    applyTheme();
  }

  function scheduleSave() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void save(), 500);
  }

  async function save() {
    try {
      // IPC 结构化克隆不接受 Vue 响应式 Proxy，这里深拷贝成纯对象
      const plain = JSON.parse(JSON.stringify(settings.value)) as AppSettings;
      settings.value = await window.linkAudio.saveSettings(plain);
      statusText.value = "设置已自动保存。";
      statusKind.value = "success";
    } catch (error) {
      statusText.value = error instanceof Error ? error.message : String(error);
      statusKind.value = "error";
    }
  }

  // ---- 多自定义主题管理 ----
  function createCustomTheme(): CustomThemeConfig {
    const theme: CustomThemeConfig = {
      id: crypto.randomUUID(),
      name: `我的主题 ${(settings.value.customThemes?.length || 0) + 1}`,
      accent: "#e7ff57",
      surface: "#121311",
      mode: "dark"
    };
    settings.value.customThemes = [...(settings.value.customThemes || []), theme];
    settings.value.theme = theme.id;
    applyTheme();
    scheduleSave();
    return theme;
  }

  function updateCustomTheme(id: string, patch: Partial<CustomThemeConfig>) {
    settings.value.customThemes = (settings.value.customThemes || []).map((item) =>
      item.id === id ? { ...item, ...patch } : item
    );
    applyTheme();
    scheduleSave();
  }

  function deleteCustomTheme(id: string) {
    settings.value.customThemes = (settings.value.customThemes || []).filter((item) => item.id !== id);
    if (settings.value.theme === id) {
      settings.value.theme = "dark";
    }
    applyTheme();
    scheduleSave();
  }

  /** 保存对预设主题的颜色修改 */
  function savePresetOverride(id: string, patch: { accent: string; surface: string }) {
    settings.value.themeOverrides = {
      ...(settings.value.themeOverrides || {}),
      [id]: patch
    };
    applyTheme();
    scheduleSave();
  }

  /** 预设主题恢复出厂配色 */
  function resetPresetOverride(id: string) {
    const overrides = { ...(settings.value.themeOverrides || {}) };
    delete overrides[id];
    settings.value.themeOverrides = overrides;
    applyTheme();
    scheduleSave();
  }

  function chooseTheme(id: string) {
    settings.value.theme = id;
    applyTheme();
    scheduleSave();
  }

  return {
    settings, statusText, statusKind, isDarkTheme, themeActive,
    load, scheduleSave, save, applyTheme,
    createCustomTheme, updateCustomTheme, deleteCustomTheme, chooseTheme,
    savePresetOverride, resetPresetOverride
  };
});
