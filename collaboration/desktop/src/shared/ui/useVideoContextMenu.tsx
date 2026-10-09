import { invokeTauri } from "@/shared/api/tauri";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { useVideoContextMenu as useSharedVideoContextMenu, type VideoContextMenuActions } from "@client-kit/platform/react/video-review";
import { toast } from "sonner";

const actions: VideoContextMenuActions = {
  download: (url, filename) => invokeTauri("download_file", { url, filename }),
  copyLink: copyTextToClipboard,
  reportError: (message) => { toast.error(message); },
};

/**
 * Owns the inline video right-click menu: open/close state, the pointer-anchor
 * handler, and the Download/Copy actions. Kept out of `VideoPlayer` so that
 * large component stays focused on playback, and out of the pure
 * `videoDownload.ts` helpers so they keep their DOM-free, Node-testable shape.
 *
 * `downloadUrl` is the original relay `/media/` URL (distinct from a rewritten
 * proxy `src`); when absent the menu omits Download and offers only Copy link,
 * so a non-relay video — which the download command's SSRF gate would reject —
 * never surfaces an action that could only error.
 */
export function useVideoContextMenu(
  src: string,
  downloadUrl?: string,
  filename?: string,
) {
  return useSharedVideoContextMenu(src, downloadUrl, filename, actions);
}
