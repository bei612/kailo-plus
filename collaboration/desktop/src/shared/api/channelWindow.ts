import { invokeTauri } from "@/shared/api/tauri";
import type { ChannelPageCursor, RelayEvent } from "@/shared/api/types";

/** Fetch the flat Nostr event array for one server-assembled channel window. */
export async function getChannelWindowEvents(
  channelId: string,
  cursor: ChannelPageCursor | null = null,
  limitRows = 50,
  forumPosts = false,
  scope?: { relayUrl: string; signerPubkey: string },
): Promise<RelayEvent[]> {
  return invokeTauri<RelayEvent[]>("get_channel_window", {
    channelId,
    limitRows,
    forumPosts,
    expectedRelayUrl: scope?.relayUrl ?? null,
    expectedSignerPubkey: scope?.signerPubkey ?? null,
    cursor: cursor
      ? { created_at: cursor.createdAt, event_id: cursor.eventId }
      : null,
  });
}
