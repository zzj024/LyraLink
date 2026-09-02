import { defineStore } from "pinia";
import type { Track } from "../../../shared/types.js";
import type { LyricsWorkbenchStep } from "../types.js";

export type { LyricsWorkbenchStep };

export interface AudioFolderTarget {
  id: string;
  name: string;
}

/** 集中管理所有对话框的开关状态 */
export const useModalsStore = defineStore("modals", {
  state: () => ({
    folder: { open: false, editing: null as AudioFolderTarget | null },
    playlist: { open: false },
    playlistPicker: { open: false, track: null as Track | null },
    trackEditor: { open: false, track: null as Track | null },
    split: { open: false, track: null as Track | null },
    lyrics: { open: false, track: null as Track | null },
    workbenchStep: "prepare" as LyricsWorkbenchStep,
    themeEditor: { open: false, id: "", kind: "preset" as "preset" | "custom" }
  }),
  actions: {
    openThemeEditor(id: string, kind: "preset" | "custom") {
      this.themeEditor = { open: true, id, kind };
    },
    closeThemeEditor() {
      this.themeEditor = { open: false, id: "", kind: "preset" };
    },
    openFolder(editing?: AudioFolderTarget) {
      this.folder = { open: true, editing: editing ?? null };
    },
    closeFolder() {
      this.folder = { open: false, editing: null };
    },
    openPlaylist() {
      this.playlist.open = true;
    },
    closePlaylist() {
      this.playlist.open = false;
    },
    openPlaylistPicker(track: Track) {
      this.playlistPicker = { open: true, track };
    },
    closePlaylistPicker() {
      this.playlistPicker = { open: false, track: null };
    },
    openTrackEditor(track: Track) {
      this.trackEditor = { open: true, track };
    },
    closeTrackEditor() {
      this.trackEditor = { open: false, track: null };
    },
    openSplit(track: Track) {
      this.split = { open: true, track };
    },
    closeSplit() {
      this.split = { open: false, track: null };
    },
    openLyrics(track: Track) {
      this.lyrics = { open: true, track };
      this.workbenchStep = "prepare";
    },
    closeLyrics() {
      this.lyrics = { open: false, track: null };
    }
  }
});
