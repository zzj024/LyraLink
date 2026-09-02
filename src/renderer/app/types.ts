export interface UiTask {
  id: string;
  title: string;
  message: string;
  status: "running" | "complete" | "error";
  time: number;
  detail?: string;
  percent?: number;
}

export type LyricsWorkbenchStep = "prepare" | "match" | "review";
