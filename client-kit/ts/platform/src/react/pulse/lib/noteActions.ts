// Original Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/pulse/lib/noteActions.ts; governed host adapters only.
import { nip19 } from "nostr-tools";

import type { UserNote } from "../socialTypes";

export function buildNoteShareUri(note: Pick<UserNote, "id" | "pubkey">) {
  return `nostr:${nip19.neventEncode({
    id: note.id,
    author: note.pubkey,
  })}`;
}

export function toggleNoteIdInSet(
  current: ReadonlySet<string>,
  noteId: string,
  enabled: boolean,
) {
  const next = new Set(current);
  if (enabled) {
    next.add(noteId);
  } else {
    next.delete(noteId);
  }
  return next;
}
