import { ref } from "vue";
import type { AppSettings, CustomThemeConfig } from "../../shared/types.js";
import type { GlobalThemeOverrides } from "naive-ui";

/** 全局主题模式：默认录音室深色 */
export const themeMode = ref<"dark" | "light">("dark");

export function applyThemeMode(mode: "dark" | "light") {
  themeMode.value = mode;
  document.documentElement.dataset.theme = mode;
}

/** 根据底色亮度自动判断深浅模式 */
export function isLightColor(hex: string): boolean {
  const full = hex.replace("#", "");
  const normalized = full.length === 3 ? full.split("").map((c) => c + c).join("") : full;
  const num = parseInt(normalized, 16);
  if (!Number.isFinite(num)) return false;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150;
}

export interface ThemePreset {
  id: string;
  name: string;
  desc: string;
  accent: string;
  surface: string;
}

/** 内置预设主题（深色系列 + 浅色系列） */
export const THEME_PRESETS: ThemePreset[] = [
  { id: "dark", name: "录音室深色", desc: "专注、低眩光", accent: "#e7ff57", surface: "#121311" },
  { id: "forest", name: "森林秘境", desc: "幽绿、自然", accent: "#5fd9a4", surface: "#0f1d15" },
  { id: "dusk", name: "暮色紫", desc: "静谧、梦幻", accent: "#c9a7ff", surface: "#171126" },
  { id: "ember", name: "暖橙夜", desc: "温暖、复古", accent: "#ffb35c", surface: "#1e1410" },
  { id: "ocean", name: "深海蓝", desc: "清凉、通透", accent: "#6fd3e7", surface: "#0c1826" },
  { id: "rose", name: "莓果玫瑰", desc: "浓烈、浪漫", accent: "#ff7d9c", surface: "#1f1116" },
  { id: "sakura", name: "樱花粉", desc: "柔软、温暖", accent: "#d4506e", surface: "#fbf0f3" },
  { id: "sapphire", name: "宝石蓝", desc: "清澈、冷静", accent: "#2f6fb3", surface: "#eaf2fa" },
  { id: "light", name: "柔和浅色", desc: "自然、明亮", accent: "#8fae12", surface: "#f2f1ea" }
];

export function presetById(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((preset) => preset.id === id);
}

/** 解析当前生效的主题（预设或用户自定义），返回统一描述 */
export function resolveActiveTheme(settings: AppSettings): {
  mode: "dark" | "light";
  accent: string;
  surface: string;
  name: string;
} {
  const activeId = settings.theme || "dark";
  const preset = presetById(activeId);
  if (preset) {
    const override = settings.themeOverrides?.[activeId];
    const surface = override?.surface ?? preset.surface;
    return {
      mode: isLightColor(surface) ? "light" : "dark",
      accent: override?.accent ?? preset.accent,
      surface,
      name: preset.name
    };
  }
  const custom = (settings.customThemes || []).find((item) => item.id === activeId);
  if (custom) {
    return { mode: isLightColor(custom.surface) ? "light" : "dark", accent: custom.accent, surface: custom.surface, name: custom.name };
  }
  // 兼容旧版单一自定义主题
  if (activeId === "custom" && settings.customTheme) {
    return {
      mode: isLightColor(settings.customTheme.surface) ? "light" : "dark",
      accent: settings.customTheme.accent,
      surface: settings.customTheme.surface,
      name: "自定义"
    };
  }
  const fallback = THEME_PRESETS[0];
  return {
    mode: isLightColor(fallback.surface) ? "light" : "dark",
    accent: fallback.accent,
    surface: fallback.surface,
    name: fallback.name
  };
}

const root = () => document.documentElement;

/** 把强调色/底色/深浅模式一次性应用到文档 */
export function applyAppearance(settings: AppSettings): void {
  const active = resolveActiveTheme(settings);
  applyThemeMode(active.mode);
  activeAccent.value = active.accent;
  const style = root().style;
  style.setProperty("--accent", active.accent);
  // 每个主题的底色都从 token 基础上覆盖，保证不同预设观感不同
  if (active.surface) {
    style.setProperty("--bg", active.surface);
    style.setProperty("--panel-solid", shade(active.surface, active.mode === "dark" ? 8 : -6));
    style.setProperty("--elevated", shade(active.surface, active.mode === "dark" ? 16 : 0));
  }
}

/** 明度增减（amount 为 0-255） */
function shade(hex: string, amount: number): string {
  const normalized = hex.replace("#", "");
  const full = normalized.length === 3
    ? normalized.split("").map((c) => c + c).join("")
    : normalized;
  const num = parseInt(full, 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp((num >> 16) + amount);
  const g = clamp(((num >> 8) & 0xff) + amount);
  const b = clamp((num & 0xff) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** 本地路径 → file:// URL（供 CSS 背景引用） */
export function filePathToUrl(path: string): string {
  return "file:///" + encodeURI(path.replace(/\\/g, "/")).replace(/#/g, "%23");
}

const darkOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: "#e7ff57",
    primaryColorHover: "#dff34d",
    primaryColorPressed: "#d3e63e",
    primaryColorSuppl: "#e7ff57"
  }
};

const lightOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: "#8fae12",
    primaryColorHover: "#7f9d0f",
    primaryColorPressed: "#6f8b0c",
    primaryColorSuppl: "#8fae12"
  },
  Button: {
    colorPrimary: "#8fae12",
    colorHoverPrimary: "#7f9d0f",
    colorPressedPrimary: "#6f8b0c",
    textColorPrimary: "#ffffff",
    textColorHoverPrimary: "#ffffff",
    textColorPressedPrimary: "#ffffff",
    fontWeight: "600"
  }
};

/** Naive UI 主题随自定义强调色动态变化 */
export function naiveOverridesFor(mode: "dark" | "light", accent: string): GlobalThemeOverrides {
  const base = mode === "dark" ? DARK_BASE : LIGHT_BASE;
  return mergeOverrides(base, {
    common: { primaryColor: accent, primaryColorSuppl: accent },
    Button: { colorPrimary: accent, colorHoverPrimary: accent, colorFocusPrimary: accent }
  });
}

const DARK_BASE: GlobalThemeOverrides = {
  common: {
    fontFamily: '"Segoe UI", "HarmonyOS Sans SC", "Microsoft YaHei", sans-serif',
    infoColor: "#7bd88f",
    successColor: "#7bd88f",
    warningColor: "#f5c04e",
    errorColor: "#ff6b5e",
    bodyColor: "#121311",
    textColorBase: "#f2f1ec",
    textColor1: "#f2f1ec",
    textColor2: "#a2a49b",
    textColor3: "#6c6e66",
    borderColor: "rgba(255,255,255,.13)",
    dividerColor: "rgba(255,255,255,.07)",
    borderRadius: "10px",
    borderRadiusSmall: "8px",
    modalColor: "#1a1b18",
    popoverColor: "#22231f",
    cardColor: "#1a1b18",
    inputColor: "#121311",
    tableColor: "transparent",
    tableHeaderColor: "transparent",
    hoverColor: "rgba(255,255,255,.045)"
  },
  Button: {
    colorPrimary: "#e7ff57",
    colorHoverPrimary: "#dff34d",
    colorPressedPrimary: "#d3e63e",
    colorFocusPrimary: "#e7ff57",
    textColorPrimary: "#17180f",
    textColorHoverPrimary: "#17180f",
    textColorPressedPrimary: "#17180f",
    borderPrimary: "1px solid transparent",
    fontWeight: "600"
  },
  Card: { borderRadiusMedium: "14px", borderColor: "rgba(255,255,255,.07)" },
  DataTable: { tdColor: "transparent", thColor: "transparent", borderColor: "rgba(255,255,255,.07)" },
  Slider: { fillColor: "#e7ff57", dotColor: "#ffffff" }
};

const LIGHT_BASE: GlobalThemeOverrides = {
  common: {
    fontFamily: '"Segoe UI", "HarmonyOS Sans SC", "Microsoft YaHei", sans-serif',
    primaryColor: "#8fae12",
    primaryColorHover: "#7f9d0f",
    primaryColorPressed: "#6f8b0c",
    primaryColorSuppl: "#8fae12",
    bodyColor: "#f2f1ea",
    textColorBase: "#1b1c17",
    textColor1: "#1b1c17",
    textColor2: "#63665c",
    textColor3: "#9a9d90",
    borderColor: "rgba(20,22,14,.16)",
    dividerColor: "rgba(20,22,14,.08)",
    borderRadius: "10px",
    borderRadiusSmall: "8px",
    modalColor: "#ffffff",
    popoverColor: "#ffffff",
    cardColor: "#ffffff",
    inputColor: "#ffffff"
  },
  Button: {
    colorPrimary: "#8fae12",
    colorHoverPrimary: "#7f9d0f",
    colorPressedPrimary: "#6f8b0c",
    textColorPrimary: "#ffffff",
    textColorHoverPrimary: "#ffffff",
    textColorPressedPrimary: "#ffffff",
    fontWeight: "600"
  },
  Card: { borderRadiusMedium: "14px" },
  Slider: { fillColor: "#8fae12", dotColor: "#ffffff" }
};

/** 当前生效的强调色（响应式，applyAppearance 更新） */
export const activeAccent = ref("#e7ff57");

const darkThemeOverrides: GlobalThemeOverrides = DARK_BASE;
const lightThemeOverrides: GlobalThemeOverrides = LIGHT_BASE;

export { darkThemeOverrides, lightThemeOverrides };

function mergeOverrides(
  base: GlobalThemeOverrides,
  extra: GlobalThemeOverrides
): GlobalThemeOverrides {
  const merged: Record<string, Record<string, unknown>> = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(extra)])) {
    merged[key] = {
      ...((base as Record<string, Record<string, unknown>>)[key] || {}),
      ...((extra as Record<string, Record<string, unknown>>)[key] || {})
    };
  }
  return merged as unknown as GlobalThemeOverrides;
}

export const darkOverridesRef = darkThemeOverrides;
export const lightOverridesRef = lightThemeOverrides;
