import { defineStore } from "pinia";
import type { Track } from "../../../shared/types.js";
import { useLibraryStore } from "./library.js";

export type ViewName = "library" | "import" | "search" | "tasks" | "settings" | "detail";
export type Collection = "all" | "favorites" | "trash" | string;

export interface ViewHistoryEntry {
  name: ViewName;
  collection?: string;
}

export const useViewStore = defineStore("view", {
  state: () => ({
    current: "library" as ViewName,
    activeCollection: "all" as Collection,
    selectedTrack: null as Track | null,
    showingLyrics: false,
    songInfoOpen: false,
    history: [] as ViewHistoryEntry[],
    historyIndex: -1,
    queuePanelOpen: false,
    sidebarCollapsed: localStorage.getItem("linkAudioSidebarCollapsed") === "true"
  }),
  actions: {
    showView(name: ViewName, collection?: string, record = true) {
      const library = useLibraryStore();
      if (name !== "library" || (collection && collection !== this.activeCollection)) {
        library.clearSelectionIf(collection);
      }
      if (name === "library" && collection) this.activeCollection = collection;
      if (name !== "detail") this.showingLyrics = false;
      this.songInfoOpen = false;
      this.current = name;
      if (record) {
        const effectiveCollection = name === "library" ? this.activeCollection : collection;
        const current = this.history[this.historyIndex];
        if (!current || current.name !== name || current.collection !== effectiveCollection) {
          this.history = this.history.slice(0, this.historyIndex + 1);
          this.history.push({ name, collection: effectiveCollection });
          this.historyIndex = this.history.length - 1;
        }
      }
    },
    navigate(delta: -1 | 1) {
      const next = this.historyIndex + delta;
      const entry = this.history[next];
      if (!entry) return;
      this.historyIndex = next;
      this.showView(entry.name, entry.collection, false);
    },
    canNavigate(delta: -1 | 1) {
      const next = this.historyIndex + delta;
      return next >= 0 && next < this.history.length;
    },
    openDetail(track: Track) {
      this.selectedTrack = track;
      this.showView("detail");
    },
    backToLibrary() {
      this.showingLyrics = false;
      this.showView("library");
    },
    toggleSidebar() {
      this.sidebarCollapsed = !this.sidebarCollapsed;
      localStorage.setItem("linkAudioSidebarCollapsed", String(this.sidebarCollapsed));
    }
  }
});
