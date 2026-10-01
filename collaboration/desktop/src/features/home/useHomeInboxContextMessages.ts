import * as React from "react";

import type { InboxContextMessage, InboxItem } from "@/features/home/lib/inbox";
import { toInboxContextMessage } from "@/features/home/lib/inboxViewHelpers";
import { formatTimelineMessages } from "@/features/messages/lib/formatTimelineMessages";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import type { RelayEvent } from "@/shared/api/types";

type UseHomeInboxContextMessagesOptions = {
  currentPubkey?: string;
  events: RelayEvent[];
  profiles?: UserProfileLookup;
  relaySelfPubkey?: string | null;
  selectedEventId: string | null;
  selectedItem: InboxItem | null;
};

export function useHomeInboxContextMessages({
  currentPubkey,
  events,
  profiles,
  relaySelfPubkey,
  selectedEventId,
  selectedItem,
}: UseHomeInboxContextMessagesOptions): InboxContextMessage[] {
  return React.useMemo(() => {
    if (!selectedItem) return [];

    const eventById = new Map(events.map((event) => [event.id, event]));
    const currentUserAvatarUrl = currentPubkey
      ? (profiles?.[currentPubkey.toLowerCase()]?.avatarUrl ?? null)
      : null;
    const timelineMessages = formatTimelineMessages(
      events,
      currentPubkey,
      currentUserAvatarUrl,
      profiles,
      undefined,
      relaySelfPubkey,
    );

    return timelineMessages.map((message) =>
      toInboxContextMessage(message, {
        eventById,
        fallbackAuthorPubkey: selectedItem.item.pubkey,
        profiles,
        selectedItemId: selectedEventId ?? selectedItem.id,
      }),
    );
  }, [
    currentPubkey,
    events,
    profiles,
    relaySelfPubkey,
    selectedEventId,
    selectedItem,
  ]);
}
