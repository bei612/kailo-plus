// Original edit overlay selection from Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/lib/formatTimelineMessages.ts::formatTimelineMessages.
// Hosts provide already admitted signed events; no message authority lives here.
import { applyEditTagOverlay } from "./applyEditTagOverlay";
import { hasLinkPreviewSuppression } from "../link-preview/linkPreviewSnapshot";
import { KIND_STREAM_MESSAGE_EDIT } from "./thread/kinds";

type MessageEvent = { id: string; pubkey: string; kind: number; created_at: number; content: string; tags: string[][] };

/** Edited rows carry `edited: true`, the original `edited: edit !== undefined` row flag. */
export function applyMessageEdits<T extends MessageEvent>(messages: readonly T[], events: readonly MessageEvent[]): Array<T & { edited?: true }> {
  const originals = new Map(messages.map((event) => [event.id, event]));
  const edits = new Map<string, MessageEvent>();
  // Original previewSuppressedTargetIds: ANY authorized edit carrying the marker suppresses
  // the message's previews for good, not only the newest edit ("remove for everyone").
  const suppressed = new Set<string>();
  for (const event of events) {
    if (event.kind !== KIND_STREAM_MESSAGE_EDIT) continue;
    const targetId = event.tags.find((tag) => tag[0] === "e")?.[1];
    const target = targetId ? originals.get(targetId) : undefined;
    const channel = event.tags.find((tag) => tag[0] === "h")?.[1];
    if (!target || target.pubkey !== event.pubkey ||
        !channel || channel !== target.tags.find((tag) => tag[0] === "h")?.[1]) continue;
    if (hasLinkPreviewSuppression(event.tags)) suppressed.add(target.id);
    const previous = edits.get(target.id);
    if (!previous || event.created_at > previous.created_at) edits.set(target.id, event);
  }
  return messages.map((message) => {
    const edit = edits.get(message.id);
    if (!edit) return message;
    const tags = applyEditTagOverlay(message.tags, edit.tags);
    return { ...message, content: edit.content, edited: true as const,
      tags: suppressed.has(message.id) && !hasLinkPreviewSuppression(tags) ? [...tags, ["link-preview", "none"]] : tags };
  });
}
