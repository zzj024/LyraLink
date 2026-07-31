import type { LinkAudioApi } from "../shared/types.js";

declare global {
  interface Window {
    linkAudio: LinkAudioApi;
  }
}

export {};
