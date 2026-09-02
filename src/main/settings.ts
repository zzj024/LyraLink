import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppSettings, CustomThemeConfig } from "../shared/types.js";

const DEFAULT_SETTINGS: AppSettings = {
  confirmedAuthorized: false,
  trashRetentionDays: 30,
  onboardingCompleted: false,
  defaultPlayMode: "list",
  rememberVolume: true,
  defaultSort: "newest",
  showSourceColumn: true,
  theme: "dark",
  closeBehavior: "tray",
  customTheme: { accent: "#e7ff57", surface: "#f6f6f1", sidebar: "#20211e" },
  customThemes: [],
  themeOverrides: {}
};

interface CustomThemeInput {
  id?: unknown;
  name?: unknown;
  accent?: unknown;
  surface?: unknown;
  mode?: unknown;
}

const validColor = (value: unknown, fallback: string) =>
  typeof value === "string" && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value) ? value : fallback;

function validateThemeOverrides(value: unknown): Record<string, { accent: string; surface: string }> {
  const result: Record<string, { accent: string; surface: string }> = {};
  if (typeof value === "object" && value !== null) {
    for (const [id, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === "object" && item !== null) {
        const entry = item as { accent?: unknown; surface?: unknown };
        const accent = validColor(entry.accent, "");
        const surface = validColor(entry.surface, "");
        if (accent && surface) result[id] = { accent, surface };
      }
    }
  }
  return result;
}

function validateCustomThemes(value: unknown): CustomThemeConfig[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is CustomThemeInput => typeof item === "object" && item !== null)
    .map((item) => ({
      id: typeof item.id === "string" && item.id ? item.id : crypto.randomUUID(),
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 20) : "我的主题",
      accent: validColor(item.accent, "#e7ff57"),
      surface: validColor(item.surface, "#121311"),
      mode: item.mode === "light" ? "light" as const : "dark" as const
    }))
    .slice(0, 12);
}

function validateCommon(stored: Partial<AppSettings>): AppSettings {
  const playModes = ["list", "repeat", "shuffle"] as const;
  const sorts = ["newest", "title", "author", "duration"] as const;
  const closeBehaviors = ["tray", "taskbar", "exit"] as const;
  return {
    confirmedAuthorized: stored.confirmedAuthorized === true,
    trashRetentionDays: Number.isFinite(stored.trashRetentionDays)
      ? Math.max(0, Math.min(3650, Math.round(Number(stored.trashRetentionDays))))
      : DEFAULT_SETTINGS.trashRetentionDays,
    onboardingCompleted: stored.onboardingCompleted === true,
    defaultPlayMode: playModes.includes(stored.defaultPlayMode as any) ? stored.defaultPlayMode : DEFAULT_SETTINGS.defaultPlayMode,
    rememberVolume: stored.rememberVolume !== false,
    defaultSort: sorts.includes(stored.defaultSort as any) ? stored.defaultSort : DEFAULT_SETTINGS.defaultSort,
    showSourceColumn: stored.showSourceColumn !== false,
    theme: typeof stored.theme === "string" && stored.theme ? stored.theme : DEFAULT_SETTINGS.theme!,
    closeBehavior: closeBehaviors.includes(stored.closeBehavior as any)
      ? stored.closeBehavior : DEFAULT_SETTINGS.closeBehavior,
    customTheme: {
      accent: validColor(stored.customTheme?.accent, DEFAULT_SETTINGS.customTheme!.accent),
      surface: validColor(stored.customTheme?.surface, DEFAULT_SETTINGS.customTheme!.surface),
      sidebar: validColor(stored.customTheme?.sidebar, DEFAULT_SETTINGS.customTheme!.sidebar)
    },
    customThemes: validateCustomThemes(stored.customThemes),
    themeOverrides: validateThemeOverrides(stored.themeOverrides)
  };
}

export class SettingsStore {
  private readonly filePath: string;

  constructor(private readonly dataDirectory: string) {
    this.filePath = path.join(dataDirectory, "settings.json");
  }

  async get(): Promise<AppSettings> {
    try {
      const stored = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<AppSettings>;
      return validateCommon(stored);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_SETTINGS };
      throw error;
    }
  }

  async save(settings: AppSettings): Promise<AppSettings> {
    const validated = validateCommon(settings);
    await mkdir(this.dataDirectory, { recursive: true });
    await writeFile(this.filePath, JSON.stringify(validated, null, 2), "utf8");
    return validated;
  }
}
