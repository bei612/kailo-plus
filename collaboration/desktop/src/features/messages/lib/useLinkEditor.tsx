import { openUrl } from "@tauri-apps/plugin-opener";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useLinkEditor as useSharedLinkEditor } from "@client-kit/platform/react/composer/features/messages/lib/useLinkEditor";
import type { UseRichTextEditorResult } from "./useRichTextEditor";
export function useLinkEditor(richText: UseRichTextEditorResult) {
  const { goChannel } = useAppNavigation();
  return useSharedLinkEditor(richText, { openExternal: (url) => void openUrl(url), openMessageLink: (link) => void goChannel(link.channelId, { messageId: link.messageId, threadRootId: link.threadRootId }) });
}
