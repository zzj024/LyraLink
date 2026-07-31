import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppSettings } from "../shared/types.js";

const DEFAULT_SETTINGS: AppSettings = {
  confirmedAuthorized: false,
  trashRetentionDays: 30,
  onboardingCompleted: false,
  defaultPlayMode: "list",
  rememberVolume: true,
  defaultSort: "newest",
  showSourceColumn: true,
  theme: "light"
};

export class SettingsStore {
  private readonly filePath: string;

  constructor(private readonly dataDirectory: string) {
    this.filePath = path.join(dataDirectory, "settings.json");
  }

  async get(): Promise<AppSettings> {
    try {
      const stored = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<AppSettings>;
      const playModes = ["list", "repeat", "shuffle"] as const;
      const sorts = ["newest", "title", "author", "duration"] as const;
      return {
        confirmedAuthorized: stored.confirmedAuthorized === true,
        trashRetentionDays: Number.isFinite(stored.trashRetentionDays)
          ? Math.max(0, Math.min(3650, Number(stored.trashRetentionDays)))
          : DEFAULT_SETTINGS.trashRetentionDays,
        onboardingCompleted: stored.onboardingCompleted === true,
        defaultPlayMode: playModes.includes(stored.defaultPlayMode as any) ? stored.defaultPlayMode : DEFAULT_SETTINGS.defaultPlayMode,
        rememberVolume: stored.rememberVolume !== false,
        defaultSort: sorts.includes(stored.defaultSort as any) ? stored.defaultSort : DEFAULT_SETTINGS.defaultSort,
        showSourceColumn: stored.showSourceColumn !== false,
        theme: stored.theme === "dark" ? "dark" : "light"
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_SETTINGS };
      throw error;
    }
  }

  async save(settings: AppSettings): Promise<AppSettings> {
    const playModes = ["list", "repeat", "shuffle"] as const;
    const sorts = ["newest", "title", "author", "duration"] as const;
    const validated: AppSettings = {
      confirmedAuthorized: settings.confirmedAuthorized === true,
      trashRetentionDays: Number.isFinite(settings.trashRetentionDays)
        ? Math.max(0, Math.min(3650, Math.round(settings.trashRetentionDays)))
        : DEFAULT_SETTINGS.trashRetentionDays,
      onboardingCompleted: settings.onboardingCompleted === true,
      defaultPlayMode: playModes.includes(settings.defaultPlayMode as any) ? settings.defaultPlayMode : DEFAULT_SETTINGS.defaultPlayMode,
      rememberVolume: settings.rememberVolume !== false,
      defaultSort: sorts.includes(settings.defaultSort as any) ? settings.defaultSort : DEFAULT_SETTINGS.defaultSort,
      showSourceColumn: settings.showSourceColumn !== false,
      theme: settings.theme === "dark" ? "dark" : "light"
    };
    await mkdir(this.dataDirectory, { recursive: true });
    await writeFile(this.filePath, JSON.stringify(validated, null, 2), "utf8");
    return validated;
  }
}
