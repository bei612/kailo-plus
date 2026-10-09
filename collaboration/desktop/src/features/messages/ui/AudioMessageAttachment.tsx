import type { ComponentProps } from "react";
import {
  AudioMessageAttachment as SharedAudioMessageAttachment,
  renderAudioMessageAttachment as renderSharedAudioMessageAttachment,
  type AudioMediaHost,
} from "@client-kit/platform/react/messages/audio/AudioMessageAttachment";
import type { AudioAttachmentImetaEntry } from "@client-kit/platform/react/composer/features/messages/lib/audioAttachment";
import { invokeTauri } from "@/shared/api/tauri";
import { fetchMediaBytes } from "@/shared/api/tauriMedia";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";

// Native's original local-key/IPC media transport; the complete player UI is
// shared with Web, whose host can only read the authorized same-origin BFF.
const audioMediaHost: AudioMediaHost = {
  fetchMediaBytes,
  fallbackMediaUrl: rewriteRelayUrl,
  downloadFile: (filename, url) =>
    invokeTauri("download_file", { filename, url }),
};

export function AudioMessageAttachment(
  props: Omit<ComponentProps<typeof SharedAudioMessageAttachment>, "host">,
) {
  return <SharedAudioMessageAttachment {...props} host={audioMediaHost} />;
}

export function renderAudioMessageAttachment(
  entry: AudioAttachmentImetaEntry | undefined,
  href: string | undefined,
  label: string,
  downloadUrl?: string,
) {
  return renderSharedAudioMessageAttachment(
    entry,
    href,
    label,
    audioMediaHost,
    downloadUrl,
  );
}
