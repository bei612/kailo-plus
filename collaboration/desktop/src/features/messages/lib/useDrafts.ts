import { discardQueuedAttachmentsForDraft } from "./backgroundMediaUploadStore";
import { initDraftStore as initSharedDraftStore } from "@client-kit/platform/react/composer/features/messages/lib/useDrafts";
export * from "@client-kit/platform/react/composer/features/messages/lib/useDrafts";
export function initDraftStore(pubkey: string, relayUrl = "") {
  initSharedDraftStore(pubkey, relayUrl, discardQueuedAttachmentsForDraft);
}
