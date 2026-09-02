import type { DesktopLyricsState } from "../shared/types.js";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const shell = byId("lyrics-shell");
const settingsPanel = byId("settings-panel");
let currentState: DesktopLyricsState | null = null;
let chromeTimer = 0;
let animationTimer = 0;
let displayedCurrent = "";
let displayedNext = "";
let pendingLyrics: { current: string; next: string } | null = null;

interface LyricsStyle {
  fontSize: number;
  currentColor: string;
  nextColor: string;
  backgroundOpacity: number;
  lineCount: 1 | 2;
}

const defaults: LyricsStyle = {
  fontSize: 34, currentColor: "#efff84", nextColor: "#ffffff", backgroundOpacity: 72, lineCount: 2
};
let lyricsStyle: LyricsStyle = defaults;

function loadStyle(): LyricsStyle {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem("linkAudioDesktopLyricsStyle") || "{}") };
  } catch { return defaults; }
}

function applyStyle(style: LyricsStyle): void {
  lyricsStyle = style;
  document.documentElement.style.setProperty("--lyric-size", `${style.fontSize}px`);
  document.documentElement.style.setProperty("--lyric-color", style.currentColor);
  document.documentElement.style.setProperty("--next-color", style.nextColor);
  document.documentElement.style.setProperty("--panel-opacity", String(style.backgroundOpacity / 100));
  byId<HTMLInputElement>("font-size").value = String(style.fontSize);
  byId("font-size-value").textContent = String(style.fontSize);
  byId<HTMLInputElement>("current-color").value = style.currentColor;
  byId<HTMLInputElement>("next-color").value = style.nextColor;
  byId<HTMLInputElement>("background-opacity").value = String(style.backgroundOpacity);
  byId("background-value").textContent = `${style.backgroundOpacity}%`;
  shell.classList.toggle("single-line", style.lineCount === 1);
  byId("one-line").classList.toggle("active", style.lineCount === 1);
  byId("two-lines").classList.toggle("active", style.lineCount === 2);
  byId("one-line").setAttribute("aria-pressed", String(style.lineCount === 1));
  byId("two-lines").setAttribute("aria-pressed", String(style.lineCount === 2));
  const compactHeight = style.lineCount === 1
    ? Math.max(104, style.fontSize + 66)
    : Math.max(126, Math.round(style.fontSize * 1.65 + 64));
  window.linkAudio.setDesktopLyricsCompactHeight(compactHeight);
  localStorage.setItem("linkAudioDesktopLyricsStyle", JSON.stringify(style));
}

function readStyleControls(): LyricsStyle {
  return {
    fontSize: Number(byId<HTMLInputElement>("font-size").value),
    currentColor: byId<HTMLInputElement>("current-color").value,
    nextColor: byId<HTMLInputElement>("next-color").value,
    backgroundOpacity: Number(byId<HTMLInputElement>("background-opacity").value),
    lineCount: lyricsStyle.lineCount
  };
}

function setLyricText(current: string, next: string): void {
  displayedCurrent = current;
  displayedNext = next;
  byId("current").textContent = current;
  byId("next").textContent = next;
  byId("incoming").textContent = "";
}

function updateLyricLines(current: string, next: string): void {
  if (!displayedCurrent) {
    setLyricText(current, next);
    return;
  }
  if (current === displayedCurrent) {
    if (!shell.classList.contains("advancing") && next !== displayedNext) {
      displayedNext = next;
      byId("next").textContent = next;
    }
    return;
  }
  if (shell.classList.contains("advancing")) {
    pendingLyrics = { current, next };
    return;
  }

  byId("next").textContent = current;
  byId("incoming").textContent = lyricsStyle.lineCount === 1 ? current : next;
  shell.classList.add("advancing");
  window.clearTimeout(animationTimer);
  animationTimer = window.setTimeout(() => {
    shell.classList.remove("advancing");
    setLyricText(current, next);
    const pending = pendingLyrics;
    pendingLyrics = null;
    if (pending && pending.current !== current) {
      requestAnimationFrame(() => updateLyricLines(pending.current, pending.next));
    }
  }, lyricsStyle.lineCount === 1 ? 310 : 390);
}

function showChrome(): void {
  if (currentState?.locked) return;
  window.linkAudio.setDesktopLyricsClickThrough(false);
  shell.classList.add("chrome-visible");
  window.clearTimeout(chromeTimer);
}

function hideChrome(): void {
  if (!settingsPanel.classList.contains("hidden")) return;
  shell.classList.remove("chrome-visible");
  if (!currentState?.locked) window.linkAudio.setDesktopLyricsClickThrough(true);
}

function closeSettings(): void {
  settingsPanel.classList.add("hidden");
  window.linkAudio.setDesktopLyricsSettingsOpen(false);
}

function render(state: DesktopLyricsState): void {
  const wasLocked = currentState?.locked;
  currentState = state;
  byId("title").textContent = state.title;
  byId("author").textContent = state.author;
  updateLyricLines(state.currentLine, state.nextLine);
  byId("toggle").textContent = state.isPlaying ? "Ⅱ" : "▶";
  byId("toggle").setAttribute("aria-label", state.isPlaying ? "暂停" : "播放");
  const modes = {
    list: { icon: "⇥", label: "顺序播放" },
    shuffle: { icon: "⤨", label: "随机播放" },
    repeat: { icon: "↻", label: "单曲循环" }
  } as const;
  byId("mode").textContent = modes[state.playMode].icon;
  byId("mode").setAttribute("title", modes[state.playMode].label);
  shell.classList.toggle("paused", !state.isPlaying);
  shell.classList.toggle("locked", state.locked);
  if (state.locked) hideChrome();
  else if (wasLocked) showChrome();
}

byId("lyrics").addEventListener("click", showChrome);
document.addEventListener("mousemove", (event) => {
  if (currentState?.locked || shell.classList.contains("chrome-visible")) return;
  if (event.target instanceof Element && event.target.closest(".lyrics p")) showChrome();
});
document.addEventListener("mouseleave", hideChrome);
window.addEventListener("blur", () => {
  closeSettings();
  hideChrome();
});
byId("previous").addEventListener("click", () => window.linkAudio.controlDesktopLyrics("previous"));
byId("toggle").addEventListener("click", () => window.linkAudio.controlDesktopLyrics("toggle"));
byId("next-track").addEventListener("click", () => window.linkAudio.controlDesktopLyrics("next"));
byId("mode").addEventListener("click", () => window.linkAudio.controlDesktopLyrics("cycle-mode"));
byId("close").addEventListener("click", () => {
  closeSettings();
  window.linkAudio.hideDesktopLyrics();
});
byId("lock").addEventListener("click", () => {
  closeSettings();
  shell.classList.add("locked");
  hideChrome();
  window.linkAudio.setDesktopLyricsLocked(true);
});
byId("settings-toggle").addEventListener("click", () => {
  const opening = settingsPanel.classList.contains("hidden");
  settingsPanel.classList.toggle("hidden", !opening);
  window.linkAudio.setDesktopLyricsSettingsOpen(opening);
});
byId("settings-close").addEventListener("click", closeSettings);
for (const id of ["font-size", "current-color", "next-color", "background-opacity"]) {
  byId<HTMLInputElement>(id).addEventListener("input", () => applyStyle(readStyleControls()));
}
for (const id of ["one-line", "two-lines"]) {
  byId(id).addEventListener("click", () => {
    const lineCount = Number(byId<HTMLButtonElement>(id).dataset.lines) as 1 | 2;
    applyStyle({ ...lyricsStyle, lineCount });
  });
}
byId("reset-style").addEventListener("click", () => applyStyle(defaults));

window.linkAudio.onDesktopLyricsUpdate(render);
window.linkAudio.onDesktopLyricsReveal(() => {
  closeSettings();
  hideChrome();
});
window.linkAudio.onDesktopLyricsPointerLeave(hideChrome);
applyStyle(loadStyle());
