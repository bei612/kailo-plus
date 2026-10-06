// Original edit overlay selection from Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/lib/formatTimelineMessages.ts::formatTimelineMessages.
// Hosts provide already admitted signed events; no message authority lives here.
import { applyEditTagOverlay } from "./applyEditTagOverlay";
import { KIND_STREAM_MESSAGE_EDIT } from "./thread/kinds";

type MessageEvent = { id: string; pubkey: string; kind: number; created_at: number; content: string; tags: string[][] };

export function applyMessageEdits<T extends MessageEvent>(messages: readonly T[], events: readonly MessageEvent[]): T[] {
  const originals = new Map(messages.map((event) => [event.id, event]));
  const edits = new Map<string, MessageEvent>();
  for (const event of events) {
    if (event.kind !== KIND_STREAM_MESSAGE_EDIT) continue;
    const targetId = event.tags.find((tag) => tag[0] === "e")?.[1];
    const target = targetId ? originals.get(targetId) : undefined;
    const channel = event.tags.find((tag) => tag[0] === "h")?.[1];
    if (!target || target.pubkey !== event.pubkey ||
        !channel || channel !== target.tags.find((tag) => tag[0] === "h")?.[1]) continue;
    const previous = edits.get(target.id);
    if (!previous || event.created_at > previous.created_at) edits.set(target.id, event);
  }
  return messages.map((message) => {
    const edit = edits.get(message.id);
    return edit ? { ...message, content: edit.content, tags: applyEditTagOverlay(message.tags, edit.tags) } : message;
  });
}
