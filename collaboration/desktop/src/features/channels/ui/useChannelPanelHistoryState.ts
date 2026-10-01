import * as React from "react";

import {
  type HistorySearchSetterOptions,
  useHistorySearchState,
} from "@/shared/hooks/useHistorySearchState";
import {
  buildAutoSendClearPatch,
  CHANNEL_SEARCH_KEYS,
} from "./channelSearchKeys";
export type { ChannelSearchKey } from "./channelSearchKeys";

/**
 * Auxiliary-panel state for the channel routes, backed by URL search params
 * via useHistorySearchState: back/forward restores the panel a given entry
 * was showing, and reloads restore the panel from the URL.
 *
 * Params: `thread` (open thread head id), `profile` (profile panel pubkey),
 * `autoSend` (draft auto-submit
 * trigger — cleared surgically after the auto-submit fires so `thread` and
 * all other panel state are preserved).
 */

export type PanelSetterOptions = HistorySearchSetterOptions;

export type PanelValueSetter = (
  value: string | null,
  options?: PanelSetterOptions,
) => void;

export function useChannelPanelHistoryState() {
  const { applyPatch, values } = useHistorySearchState(CHANNEL_SEARCH_KEYS);

  const setOpenThreadHeadId = React.useCallback<PanelValueSetter>(
    (value, options) => applyPatch({ thread: value }, options),
    [applyPatch],
  );

  const setProfilePanelPubkey = React.useCallback<PanelValueSetter>(
    (value, options) => applyPatch({ profile: value }, options),
    [applyPatch],
  );

  const openProfilePanel = React.useCallback(
    (pubkey: string) => applyPatch({ profile: pubkey }),
    [applyPatch],
  );

  const clearMessageRouteTarget = React.useCallback(
    (options?: PanelSetterOptions) =>
      applyPatch({ messageId: null, threadRootId: null }, options),
    [applyPatch],
  );

  // Clears only the ?autoSend param, preserving `thread` and all other panel
  // search state. Use this instead of a full goChannel() re-navigation so the
  // thread panel does not unmount between the auto-submit trigger clear and the
  // deferred setTimeout(0) send.
  const clearAutoSend = React.useCallback(
    (options?: PanelSetterOptions) =>
      applyPatch(buildAutoSendClearPatch(), { replace: true, ...options }),
    [applyPatch],
  );

  return {
    clearAutoSend,
    clearMessageRouteTarget,
    openProfilePanel,
    openThreadHeadId: values.thread,
    profilePanelPubkey: values.profile,
    setOpenThreadHeadId,
    setProfilePanelPubkey,
  };
}
