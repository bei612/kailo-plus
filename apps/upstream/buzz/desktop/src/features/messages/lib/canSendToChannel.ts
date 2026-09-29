import type { TimelineMessage } from "@/features/messages/types";
import { KIND_STREAM_MESSAGE } from "@/shared/constants/kinds";
import { normalizePubkey } from "@/shared/lib/pubkey";

function isOwnMessage(
  message: TimelineMessage,
  currentPubkey: string | undefined,
): boolean {
  return (
    Boolean(currentPubkey) &&
    Boolean(message.pubkey) &&
    normalizePubkey(message.pubkey ?? "") ===
      normalizePubkey(currentPubkey ?? "")
  );
}

export function canSendMessageToChannel(
  message: TimelineMessage,
  currentPubkey: string | undefined,
): boolean {
  return (
    message.kind === KIND_STREAM_MESSAGE &&
    !message.pending &&
    isOwnMessage(message, currentPubkey)
  );
}

export function assertCanSendMessageToChannel(
  message: TimelineMessage,
  currentPubkey: string | undefined,
): void {
  if (message.kind !== KIND_STREAM_MESSAGE) {
    throw new Error(
      "Only ordinary channel messages can be sent to the channel.",
    );
  }
  if (message.pending) {
    throw new Error("Wait for the message to finish sending first.");
  }
  if (!isOwnMessage(message, currentPubkey)) {
    throw new Error("You can only send your own messages.");
  }
}
