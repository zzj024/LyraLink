import { existsSync } from "node:fs";
import { cp, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

// Packaged builds used to ship as "LinkAudio" and dev runs as "link-audio",
// while current builds use "LyraLink". Electron derives the userData
// directory from the product name, so after an overwrite upgrade the app
// would start from an empty directory even though every track, cover and
// setting is still on disk under the old name. Moving the old "library"
// folder across on first launch keeps those upgrades seamless.
const legacyAppDirectoryNames = ["LinkAudio", "link-audio"];

async function directoryHasEntries(directory: string): Promise<boolean> {
  try {
    return (await readdir(directory)).length > 0;
  } catch {
    return false;
  }
}

/**
 * Moves the previous product name's library into the current userData
 * directory. Returns the source path when a migration happened, null when
 * the current library already has data or no legacy data exists.
 */
export async function migrateLegacyUserData(currentUserDataDirectory: string): Promise<string | null> {
  const targetLibraryDirectory = path.join(currentUserDataDirectory, "library");
  if (await directoryHasEntries(targetLibraryDirectory)) return null;
  const parentDirectory = path.dirname(currentUserDataDirectory);
  for (const name of legacyAppDirectoryNames) {
    const sourceLibraryDirectory = path.join(parentDirectory, name, "library");
    if (path.resolve(sourceLibraryDirectory) === path.resolve(targetLibraryDirectory)) continue;
    if (!existsSync(sourceLibraryDirectory)) continue;
    await rm(targetLibraryDirectory, { recursive: true, force: true });
    try {
      await rename(sourceLibraryDirectory, targetLibraryDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      // Different volumes cannot be renamed into each other; fall back to a
      // recursive copy so the upgrade still succeeds, then drop the source.
      await cp(sourceLibraryDirectory, targetLibraryDirectory, { recursive: true });
      await rm(sourceLibraryDirectory, { recursive: true, force: true });
    }
    return sourceLibraryDirectory;
  }
  return null;
}
