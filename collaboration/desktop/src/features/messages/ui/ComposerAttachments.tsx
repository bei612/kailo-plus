import type { ComponentProps } from "react";
import { ComposerAttachments as SharedComposerAttachments } from "@client-kit/platform/react/composer/features/messages/ui/ComposerAttachments";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";
import { fetchMediaBytes } from "@/shared/api/tauriMedia";
import { AudioMessageAttachment } from "./AudioMessageAttachment";
export { DropZoneOverlay } from "@client-kit/platform/react/composer/features/messages/ui/ComposerAttachments";
export function ComposerAttachments(props: Omit<ComponentProps<typeof SharedComposerAttachments>, "resolveMediaUrl" | "fetchMediaBytes" | "AudioAttachment">) {
  return <SharedComposerAttachments {...props} resolveMediaUrl={rewriteRelayUrl} fetchMediaBytes={fetchMediaBytes} AudioAttachment={AudioMessageAttachment} />;
}
