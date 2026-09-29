import * as React from "react";

import { buildIndependentThreadPanel } from "@/features/messages/lib/independentThreadPanel";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import type { ChannelMember, RelayEvent } from "@/shared/api/types";

export function useIndependentThreadPanel(args: {
  channelEvents: RelayEvent[];
  threadReplyEvents: RelayEvent[];
  rootId: string | null;
  replyTargetId: string | null;
  expandedReplyIds: ReadonlySet<string>;
  currentPubkey: string | undefined;
  currentAvatarUrl: string | null;
  profiles: UserProfileLookup | undefined;
  members: ChannelMember[] | undefined;
  relaySelfPubkey: string | null | undefined;
}) {
  // Depend on the individual fields, NOT the `args` object — callers pass a
  // fresh object literal every render, so `[args]` never memoizes and the
  // full O(replies) formatTimelineMessages + buildThreadPanelData rebuild
  // would run on every ChannelScreen render. Mirrors the main timeline's
  // memoization of the same formatter (ChannelScreen `timelineMessages`).
  return React.useMemo(
    () =>
      buildIndependentThreadPanel(
        args.channelEvents,
        args.threadReplyEvents,
        args.rootId,
        args.replyTargetId,
        args.expandedReplyIds,
        args.currentPubkey,
        args.currentAvatarUrl,
        args.profiles,
        args.members,
        args.relaySelfPubkey,
      ),
    [
      args.channelEvents,
      args.threadReplyEvents,
      args.rootId,
      args.replyTargetId,
      args.expandedReplyIds,
      args.currentPubkey,
      args.currentAvatarUrl,
      args.profiles,
      args.members,
      args.relaySelfPubkey,
    ],
  );
}
