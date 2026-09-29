import * as React from "react";

import {
  collectMessageAuthorPubkeys,
  collectMessageMentionPubkeys,
} from "@/features/messages/lib/formatTimelineMessages";
import type { RelayEvent } from "@/shared/api/types";

export function useMessageEventProfilePubkeys(
  messages: RelayEvent[],
  threadReplies: RelayEvent[],
  relaySelfPubkey: string | null | undefined,
) {
  return React.useMemo(() => {
    const events = [...messages, ...threadReplies];
    return [
      ...new Set([
        ...collectMessageAuthorPubkeys(events, relaySelfPubkey),
        ...collectMessageMentionPubkeys(events),
      ]),
    ];
  }, [messages, relaySelfPubkey, threadReplies]);
}
