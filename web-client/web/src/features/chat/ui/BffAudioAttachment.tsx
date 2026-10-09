import { useMemo, type ComponentProps } from "react";
import {
  AudioMessageAttachment,
  type AudioMediaHost,
} from "@client-kit/platform/react/messages/audio/AudioMessageAttachment";

// Callers supply only the current message/draft's resolved BFF reference. The
// original player never receives an imeta remote origin or a Desktop IPC host.
export function BffAudioAttachment(
  props: Omit<ComponentProps<typeof AudioMessageAttachment>, "host"> & {
    mimeType?: string;
  },
) {
  const { href, mimeType, ...attachmentProps } = props;
  const host = useMemo<AudioMediaHost>(
    () => ({
      mimeType,
      fetchMediaBytes: async (url, signal) => {
        if (url !== href || new URL(url, window.location.href).origin !== window.location.origin) {
          throw new Error("Audio media is outside the current BFF reference.");
        }
        const response = await fetch(url, {
          credentials: "same-origin",
          redirect: "error",
          signal,
        });
        if (!response.ok) throw new Error(`Audio read failed (${response.status}).`);
        return new Uint8Array(await response.arrayBuffer());
      },
      downloadFile: async (filename, url) => {
        if (url !== href || new URL(url, window.location.href).origin !== window.location.origin) {
          throw new Error("Audio download is outside the current BFF reference.");
        }
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
      },
    }),
    [href, mimeType],
  );
  return <AudioMessageAttachment {...attachmentProps} href={href} host={host} />;
}
