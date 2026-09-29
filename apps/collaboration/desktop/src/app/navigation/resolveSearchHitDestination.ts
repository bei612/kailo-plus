import type { SearchHit } from "@/shared/api/types";

export type SearchHitDestination = {
  channelId: string;
  messageId?: string;
  threadRootId?: string | null;
};

export async function resolveSearchHitDestination(
  hit: SearchHit,
): Promise<SearchHitDestination | null> {
  if (!hit.channelId) {
    return null;
  }

  return {
    channelId: hit.channelId,
    messageId: hit.eventId,
    threadRootId: hit.threadRootId ?? null,
  };
}
