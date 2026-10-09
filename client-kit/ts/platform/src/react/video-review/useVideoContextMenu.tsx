// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/shared/ui/useVideoContextMenu.tsx.
import * as React from "react";
import { useUiT } from "../context";
import {
  MediaContextMenu,
  type MediaContextMenuItem,
  type MediaContextMenuPosition,
  useDismissMediaContextMenu,
} from "../image-lightbox/MediaContextMenu";
import { resolveVideoDownloadFilename } from "./videoDownload";

export type VideoContextMenuActions = {
  download: (url: string, filename: string) => Promise<void>;
  copyLink: (url: string, successMessage: string) => Promise<unknown> | void;
  reportError: (message: string) => void;
};

export function useVideoContextMenu(
  src: string,
  downloadUrl: string | undefined,
  filename: string | undefined,
  actions: VideoContextMenuActions,
) {
  const t = useUiT();
  const [position, setPosition] = React.useState<MediaContextMenuPosition | null>(null);
  const close = React.useCallback(() => setPosition(null), []);
  useDismissMediaContextMenu(Boolean(position), close);
  const onContextMenu = React.useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setPosition({ x: event.clientX, y: event.clientY });
  }, []);
  const items = React.useMemo<MediaContextMenuItem[]>(() => {
    const entries: MediaContextMenuItem[] = [];
    if (downloadUrl) {
      entries.push({
        label: t("video.download"),
        onSelect: () => {
          close();
          actions.download(downloadUrl, resolveVideoDownloadFilename(filename)).catch((error: unknown) => {
            actions.reportError(error instanceof Error ? error.message : t("video.downloadFailed"));
          });
        },
      });
    }
    entries.push({
      label: t("video.copyLink"),
      onSelect: () => {
        close();
        Promise.resolve(actions.copyLink(downloadUrl ?? src, t("video.linkCopied"))).catch((error: unknown) => {
          actions.reportError(error instanceof Error ? error.message : t("buzz.copyFailed"));
        });
      },
    });
    return entries;
  }, [actions, close, downloadUrl, filename, src, t]);
  return {
    onContextMenu,
    menu: position ? <MediaContextMenu dataAttributes={["data-video-context-menu"]} items={items} position={position} /> : null,
  };
}
