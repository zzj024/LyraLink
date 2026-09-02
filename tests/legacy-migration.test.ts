import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrateLegacyUserData } from "../src/main/legacy-migration.js";

async function makeScratchDirectory(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "lyralink-migration-"));
}

test("moves a legacy LinkAudio library into the current userData directory", async () => {
  const base = await makeScratchDirectory();
  try {
    const legacyLibrary = path.join(base, "LinkAudio", "library");
    await mkdir(legacyLibrary, { recursive: true });
    await writeFile(path.join(legacyLibrary, "library.json"), JSON.stringify([{ id: "track-1" }]), "utf8");
    await mkdir(path.join(legacyLibrary, "media"), { recursive: true });
    const currentUserDirectory = path.join(base, "LyraLink");
    await mkdir(currentUserDirectory, { recursive: true });

    const migrated = await migrateLegacyUserData(currentUserDirectory);

    assert.equal(migrated, legacyLibrary);
    const stored = JSON.parse(
      await readFile(path.join(currentUserDirectory, "library", "library.json"), "utf8")
    ) as Array<{ id: string }>;
    assert.equal(stored[0].id, "track-1");
    assert.ok((await readdir(path.join(currentUserDirectory, "library", "media"))).length === 0);
    await assert.rejects(readdir(legacyLibrary));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("keeps the current library untouched when it already has data", async () => {
  const base = await makeScratchDirectory();
  try {
    const legacyLibrary = path.join(base, "LinkAudio", "library");
    await mkdir(legacyLibrary, { recursive: true });
    await writeFile(path.join(legacyLibrary, "library.json"), "[]", "utf8");
    const currentUserDirectory = path.join(base, "LyraLink");
    const currentLibrary = path.join(currentUserDirectory, "library");
    await mkdir(currentLibrary, { recursive: true });
    await writeFile(path.join(currentLibrary, "library.json"), JSON.stringify([{ id: "current" }]), "utf8");

    const migrated = await migrateLegacyUserData(currentUserDirectory);

    assert.equal(migrated, null);
    const stored = JSON.parse(await readFile(path.join(currentLibrary, "library.json"), "utf8")) as Array<{ id: string }>;
    assert.equal(stored[0].id, "current");
    assert.ok(await readdir(legacyLibrary).then(() => true));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("replaces an empty current library directory with the legacy one", async () => {
  const base = await makeScratchDirectory();
  try {
    const legacyLibrary = path.join(base, "LinkAudio", "library");
    await mkdir(legacyLibrary, { recursive: true });
    await writeFile(path.join(legacyLibrary, "settings.json"), "{}", "utf8");
    const currentUserDirectory = path.join(base, "LyraLink");
    await mkdir(path.join(currentUserDirectory, "library"), { recursive: true });

    const migrated = await migrateLegacyUserData(currentUserDirectory);

    assert.equal(migrated, legacyLibrary);
    assert.deepEqual(JSON.parse(await readFile(path.join(currentUserDirectory, "library", "settings.json"), "utf8")), {});
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("returns null when no legacy data exists", async () => {
  const base = await makeScratchDirectory();
  try {
    const currentUserDirectory = path.join(base, "LyraLink");
    await mkdir(currentUserDirectory, { recursive: true });
    assert.equal(await migrateLegacyUserData(currentUserDirectory), null);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("ignores the current directory when it matches a legacy name", async () => {
  const base = await makeScratchDirectory();
  try {
    const currentUserDirectory = path.join(base, "link-audio");
    await mkdir(currentUserDirectory, { recursive: true });
    await mkdir(path.join(currentUserDirectory, "library"), { recursive: true });
    assert.equal(await migrateLegacyUserData(currentUserDirectory), null);
    assert.equal(await readdir(path.join(currentUserDirectory, "library")).then(() => true, () => false), true);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
