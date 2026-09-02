import type { DesktopLyricsState } from "../shared/types.js";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function render(state: DesktopLyricsState): void {
  byId("tray-title").textContent = state.title === "LyraLink" ? "暂未播放歌曲" : state.title;
  byId("tray-author").textContent = state.author || "从音乐库选择一首歌曲";
  const cover = byId<HTMLImageElement>("tray-cover");
  if (state.coverUrl) cover.src = state.coverUrl;
  else cover.removeAttribute("src");
  byId("tray-toggle").textContent = state.isPlaying ? "Ⅱ" : "▶";
  const modes = { list:["⇥","顺序播放"], shuffle:["⤨","随机播放"], repeat:["↻","单曲循环"] } as const;
  const [icon,label] = modes[state.playMode];
  byId("tray-mode").querySelector(".row-icon")!.textContent = icon;
  byId("tray-mode").querySelector("strong")!.textContent = label;
}

function action(name: "previous"|"toggle"|"next"|"cycle-mode"): void { window.linkAudio.controlDesktopLyrics(name); }
byId("tray-previous").addEventListener("click",()=>action("previous"));
byId("tray-toggle").addEventListener("click",()=>action("toggle"));
byId("tray-next").addEventListener("click",()=>action("next"));
byId("tray-mode").addEventListener("click",()=>action("cycle-mode"));
byId("tray-lyrics").addEventListener("click",()=>{ void window.linkAudio.openDesktopLyrics(); window.linkAudio.hideTrayMenu(); });
byId("tray-open").addEventListener("click",()=>{ window.linkAudio.showMainWindow(); window.linkAudio.hideTrayMenu(); });
byId("tray-exit").addEventListener("click",()=>window.linkAudio.quitApp());
byId("tray-close").addEventListener("click",()=>window.linkAudio.hideTrayMenu());
window.linkAudio.onDesktopLyricsUpdate(render);
