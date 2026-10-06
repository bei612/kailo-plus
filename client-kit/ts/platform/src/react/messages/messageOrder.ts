// Extracted from Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/lib/messageQueryKeys.ts::{dedupeMessagesById,sortMessages}.
import type { Event } from "nostr-tools";

/** Keep the last snapshot of each event without changing its signed fields. */
export function dedupeMessagesById<T extends Pick<Event, "id">>(messages: T[]): T[] {
  const seenIds = new Set<string>();
  const deduped: T[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (seenIds.has(message.id)) continue;
    seenIds.add(message.id);
    deduped.push(message);
  }
  return deduped.reverse();
}

/** Original chronological order, including deterministic same-second events. */
export function sortMessages<T extends Pick<Event, "id" | "created_at">>(messages: T[]): T[] {
  return dedupeMessagesById(messages).sort((left, right) => {
    if (left.created_at !== right.created_at) return left.created_at - right.created_at;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}
