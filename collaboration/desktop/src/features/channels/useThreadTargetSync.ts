import * as React from "react";

import type { PanelValueSetter } from "@/features/channels/ui/useChannelPanelHistoryState";
import type { TimelineMessage } from "@/features/messages/types";

/**
 * Keeps thread-panel targets consistent with the messages
 * that are actually loaded: closes the thread panel when its head message
 * disappears, seeds the reply target from the thread head, and clears stale
 * reply targets that no longer resolve to a message.
 */
export function useThreadTargetSync({
  clearOptimisticThreadOverride,
  editTarget,
  editTargetMessage,
  clearEditTarget,
  isTimelineLoading,
  openThreadHeadId,
  openThreadHeadMessage,
  setExpandedThreadReplyIds,
  setOpenThreadHeadId,
  setThreadReplyTargetId,
  setThreadScrollTargetId,
  threadReplyTargetId,
  threadReplyTargetMessage,
}: {
  clearOptimisticThreadOverride: () => void;
  editTarget: TimelineMessage | null;
  editTargetMessage: TimelineMessage | null;
  clearEditTarget: () => void;
  isTimelineLoading: boolean;
  openThreadHeadId: string | null;
  openThreadHeadMessage: TimelineMessage | null;
  setExpandedThreadReplyIds: (ids: Set<string>) => void;
  setOpenThreadHeadId: PanelValueSetter;
  setThreadReplyTargetId: (id: string | null) => void;
  setThreadScrollTargetId: (id: string | null) => void;
  threadReplyTargetId: string | null;
  threadReplyTargetMessage: TimelineMessage | null;
}) {
  React.useEffect(() => {
    if (openThreadHeadId && !openThreadHeadMessage) {
      if (isTimelineLoading) {
        return;
      }
      clearOptimisticThreadOverride();
      setOpenThreadHeadId(null, { replace: true });
      setExpandedThreadReplyIds(new Set());
      setThreadScrollTargetId(null);
      return;
    }

    if (openThreadHeadMessage && !threadReplyTargetId) {
      setThreadReplyTargetId(openThreadHeadMessage.id);
      return;
    }

    if (threadReplyTargetId && !threadReplyTargetMessage) {
      setThreadReplyTargetId(openThreadHeadMessage?.id ?? null);
    }
    if (editTarget && !editTargetMessage && !isTimelineLoading) clearEditTarget();
  }, [
    clearOptimisticThreadOverride,
    editTarget,
    editTargetMessage,
    clearEditTarget,
    isTimelineLoading,
    openThreadHeadId,
    openThreadHeadMessage,
    setExpandedThreadReplyIds,
    setOpenThreadHeadId,
    setThreadReplyTargetId,
    setThreadScrollTargetId,
    threadReplyTargetId,
    threadReplyTargetMessage,
  ]);
}
