import type { OnlineSearchResult } from "../../../shared/types.js";
import { useLibraryStore } from "../stores/library.js";
import { usePlayerStore } from "../stores/player.js";
import { useSearchStore } from "../stores/search.js";
import { useSettingsStore } from "../stores/settings.js";
import { useViewStore } from "../stores/view.js";
import { toast } from "../ui.js";

export async function previewOnline(result: OnlineSearchResult): Promise<void> {
  const player = usePlayerStore();
  try {
    const badge = { bilibili: "B站预览", joox: "Joox 试听", netease: "网易云试听", local: "本地" }[result.platform];
    const streamUrl = result.platform === "bilibili"
      ? await window.linkAudio.resolveBilibiliPreview(result.url)
      : await window.linkAudio.resolveStreamPreview(result.url);
    player.loadPreview(streamUrl, result.title, result.author, result.thumbnail, result.duration, badge);
    toast("正在在线播放预览，下载按钮可保存到音乐库。", "success");
  } catch (error) {
    if ((error as DOMException | undefined)?.name === "AbortError") return;
    toast(error instanceof Error ? error.message : String(error), "error");
  }
}

export async function downloadOnline(result: OnlineSearchResult, shouldPlay = false, addToPlaylist = false): Promise<void> {
  const search = useSearchStore();
  const library = useLibraryStore();
  const settings = useSettingsStore();
  const player = usePlayerStore();
  const view = useViewStore();

  if (!settings.settings.confirmedAuthorized) {
    view.showView("settings");
    toast("请先在设置中完成合法使用确认。", "error");
    return;
  }
  const playlist = addToPlaylist
    ? library.playlists.find((item) => `playlist:${item.id}` === view.activeCollection) || library.playlists[0]
    : undefined;
  if (addToPlaylist && !playlist) {
    toast("请先新建一个歌单，再使用“＋”下载并加入歌单。", "error");
    return;
  }
  try {
    const track = await window.linkAudio.importAudio({
      input: result.url,
      taskId: crypto.randomUUID(),
      meta: { title: result.title, author: result.author, duration: result.duration, thumbnail: result.thumbnail }
    });
    search.downloadedIds = new Set([...search.downloadedIds, result.id]);
    await library.refreshTracks();
    if (playlist) {
      library.playlists = await window.linkAudio.updatePlaylist(playlist.id, [...playlist.trackIds, track.id]);
      toast(`已下载并加入“${playlist.name}”${lyricsSuffix(result.platform, track.lyrics != null)}。`, "success");
    } else {
      toast(`已下载到音乐库${lyricsSuffix(result.platform, track.lyrics != null)}。`, "success");
    }
    if (shouldPlay) player.play(track, true);
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  }
}

/** 按来源生成歌词提示，避免 B 站专属文案出现在其他平台 */
function lyricsSuffix(platform: OnlineSearchResult["platform"], hasLyrics: boolean): string {
  if (platform === "bilibili") {
    return hasLyrics ? "，B站字幕已转为歌词" : "；未发现可公开访问的 B站字幕";
  }
  return hasLyrics ? "，歌词已匹配" : "";
}
