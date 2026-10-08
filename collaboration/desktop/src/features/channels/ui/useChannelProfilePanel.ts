import * as React from "react";

type UseChannelProfilePanelOptions = {
  requireThreadEditResolution: () => boolean;
  openProfilePanel: (pubkey: string) => void;
  setExpandedThreadReplyIds: (value: Set<string>) => void;
  setOpenThreadHeadId: (value: string | null) => void;
  setProfilePanelPubkey: (value: string | null) => void;
  setThreadReplyTargetId: (value: string | null) => void;
  setThreadScrollTargetId: (value: string | null) => void;
};

export function useChannelProfilePanel({
  requireThreadEditResolution,
  openProfilePanel,
  setExpandedThreadReplyIds,
  setOpenThreadHeadId,
  setProfilePanelPubkey,
  setThreadReplyTargetId,
  setThreadScrollTargetId,
}: UseChannelProfilePanelOptions) {
  const handleOpenProfilePanel = React.useCallback(
    (pubkey: string) => {
      if (!requireThreadEditResolution()) return;
      setOpenThreadHeadId(null);
      setExpandedThreadReplyIds(new Set());
      setThreadScrollTargetId(null);
      setThreadReplyTargetId(null);
      openProfilePanel(pubkey);
    },
    [
      openProfilePanel,
      requireThreadEditResolution,
      setExpandedThreadReplyIds,
      setOpenThreadHeadId,
      setThreadReplyTargetId,
      setThreadScrollTargetId,
    ],
  );

  const handleCloseProfilePanel = React.useCallback(() => {
    setProfilePanelPubkey(null);
  }, [setProfilePanelPubkey]);

  return {
    handleOpenProfilePanel,
    handleCloseProfilePanel,
  };
}
