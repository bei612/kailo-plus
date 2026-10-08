import * as React from "react";

import type { TimelineMessage } from "@/features/messages/types";
import { isBroadcastReply } from "@/features/messages/lib/threading";
import type { Channel } from "@/shared/api/types";
import type { PanelValueSetter } from "./useChannelPanelHistoryState";
import { getThreadRouteTarget, getRouteMainTimelineTargetId } from "@client-kit/platform/react/thread";

export function useChannelRouteTarget({
  activeChannel,
  activeChannelId,
  clearEditTarget,
  requireThreadEditResolution,
  setExpandedThreadReplyIds,
  setOpenThreadHeadId,
  setProfilePanelPubkey,
  setThreadReplyTargetId,
  setThreadScrollTargetId,
  targetMessageId,
  timelineMessages,
}: {
  activeChannel: Channel | null;
  activeChannelId: string | null;
  clearEditTarget: () => void;
  requireThreadEditResolution: () => boolean;
  setExpandedThreadReplyIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setOpenThreadHeadId: PanelValueSetter;
  setProfilePanelPubkey: PanelValueSetter;
  setThreadReplyTargetId: React.Dispatch<React.SetStateAction<string | null>>;
  setThreadScrollTargetId: React.Dispatch<React.SetStateAction<string | null>>;
  targetMessageId: string | null;
  timelineMessages: TimelineMessage[];
}) {
  const timelineMessageById = React.useMemo(
    () => new Map(timelineMessages.map((message) => [message.id, message])),
    [timelineMessages],
  );
  const targetTimelineMessage = targetMessageId
    ? (timelineMessageById.get(targetMessageId) ?? null)
    : null;
  const mainTimelineTargetMessageId = getRouteMainTimelineTargetId(
    targetMessageId,
    targetTimelineMessage,
  );
  const handledThreadRouteTargetRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!targetMessageId) {
      handledThreadRouteTargetRef.current = null;
      return;
    }

    const targetKey = `${activeChannelId ?? "none"}:${targetMessageId}`;
    if (handledThreadRouteTargetRef.current !== targetKey) {
      handledThreadRouteTargetRef.current = null;
    }

    if (
      handledThreadRouteTargetRef.current === targetKey ||
      !activeChannel ||
      activeChannel.channelType === "forum"
    ) {
      return;
    }

    const targetMessage = timelineMessageById.get(targetMessageId) ?? null;
    if (!targetMessage) {
      return;
    }

    if (!targetMessage.parentId) {
      if (!requireThreadEditResolution()) return;
      clearEditTarget();
      setProfilePanelPubkey(null, { replace: true });
      // Root message links open the reply panel.
      setOpenThreadHeadId(targetMessage.id, { replace: true });
      setThreadReplyTargetId(targetMessage.id);
      setThreadScrollTargetId(null);
      setExpandedThreadReplyIds(new Set());
      handledThreadRouteTargetRef.current = targetKey;
      return;
    }

    if (isBroadcastReply(targetMessage.tags ?? [])) {
      return;
    }

    const routeTarget = getThreadRouteTarget(
      targetMessage,
      timelineMessageById,
    );
    if (!routeTarget) {
      return;
    }
    if (!requireThreadEditResolution()) return;
    clearEditTarget();
    // Replace so the deep-link entry itself carries the opened thread —
    // back should leave the deep link, not strip the panel from it.
    setProfilePanelPubkey(null, { replace: true });
    setOpenThreadHeadId(routeTarget.threadHeadId, { replace: true });
    setThreadReplyTargetId(routeTarget.threadHeadId);
    setThreadScrollTargetId(targetMessageId);
    setExpandedThreadReplyIds(routeTarget.expandedReplyIds);
    handledThreadRouteTargetRef.current = targetKey;
  }, [
    activeChannel,
    activeChannelId,
    clearEditTarget,
    requireThreadEditResolution,
    setExpandedThreadReplyIds,
    setOpenThreadHeadId,
    setProfilePanelPubkey,
    setThreadReplyTargetId,
    setThreadScrollTargetId,
    targetMessageId,
    timelineMessageById,
  ]);

  return mainTimelineTargetMessageId;
}
