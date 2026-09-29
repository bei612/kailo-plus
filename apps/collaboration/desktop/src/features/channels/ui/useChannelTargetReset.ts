import * as React from "react";

export function useChannelTargetReset({
  activeChannelId,
  setExpandedThreadReplyIds,
  setThreadReplyTargetId,
  setThreadScrollTargetId,
}: {
  activeChannelId: string | null;
  setExpandedThreadReplyIds: (ids: Set<string>) => void;
  setThreadReplyTargetId: (id: string | null) => void;
  setThreadScrollTargetId: (id: string | null) => void;
}) {
  React.useEffect(() => {
    // The channel identity is intentionally the reset trigger.
    void activeChannelId;
    setExpandedThreadReplyIds(new Set());
    setThreadScrollTargetId(null);
    setThreadReplyTargetId(null);
  }, [
    activeChannelId,
    setExpandedThreadReplyIds,
    setThreadReplyTargetId,
    setThreadScrollTargetId,
  ]);
}
