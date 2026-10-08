import { useUserProfileQuery } from "@/features/profile/hooks";
import { useNativeSession } from "@/features/platform/activeCommunity";
import { useNavigate } from "@tanstack/react-router";
import { translate } from "@client-kit/platform/i18n";
import { useDeviceLocale } from "@client-kit/platform/react/context";
import { useDirectMessageOpen } from "@client-kit/platform/react/new-message";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { channelsQueryKey } from "@/features/channels/hooks";
import { ProfileSummaryView } from "@client-kit/platform/react/pulse";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import { useIsThreadPanelOverlay } from "@/shared/hooks/use-mobile";
import {
  AuxiliaryPanel,
  AuxiliaryPanelBody,
  AuxiliaryPanelHeader,
  AuxiliaryPanelHeaderGroup,
  AuxiliaryPanelHeaderTitleBlock,
} from "@/shared/layout/AuxiliaryPanel";
import { truncateNpub } from "@/shared/lib/pubkey";
import * as React from "react";
import { Button } from "@/shared/ui/button";

export type UserProfilePanelProps = {
  canResetWidth?: boolean;
  isSinglePanelView?: boolean;
  layout?: "standalone" | "split";
  onClose: () => void;
  onResetWidth?: () => void;
  onResizeStart?: (event: React.PointerEvent<HTMLButtonElement>) => void;
  pubkey: string;
  splitPaneClamp?: boolean;
  widthPx: number;
  transparentChrome?: boolean;
};

/** Original public fields and direct Message action through governed DM preparation. */
export function UserProfilePanel({
  canResetWidth,
  isSinglePanelView = false,
  layout = "standalone",
  onClose,
  onResetWidth,
  onResizeStart,
  pubkey,
  splitPaneClamp = false,
  widthPx,
  transparentChrome = false,
}: UserProfilePanelProps) {
  const locale = useDeviceLocale();
  const session = useNativeSession();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const platformSession = useQuery({ queryKey: ["platform", "session"], queryFn: () => session.client.session() });
  const directMessage = useDirectMessageOpen(platformSession.data?.tenantPrincipalId ?? "");
  const scope = `${session.facts.communityHost}:${session.devicePubkey}`;
  const owner = React.useMemo(() => ({ active: true }), [session, pubkey]);
  const currentOwner = React.useRef(owner);
  currentOwner.current = owner;
  const [opening, setOpening] = React.useState(false);
  const [openFailed, setOpenFailed] = React.useState(false);
  React.useEffect(() => {
    owner.active = true;
    setOpening(false);
    setOpenFailed(false);
    return () => { owner.active = false; };
  }, [owner]);
  const isOverlay = useIsThreadPanelOverlay();
  const isSplitLayout = layout === "split";
  useEscapeKey(onClose, isOverlay || isSinglePanelView);
  const profileQuery = useUserProfileQuery(pubkey, scope);
  const profile = profileQuery.isSuccess && !profileQuery.isFetching && profileQuery.data.pubkey === pubkey
    ? profileQuery.data : undefined;
  const displayName = profile?.displayName ?? truncateNpub(pubkey);
  async function openMessage() {
    if (!profile || opening || directMessage.busy || !platformSession.isSuccess || platformSession.isFetching || !owner.active || currentOwner.current !== owner) return;
    setOpening(true);
    setOpenFailed(false);
    try {
      const conversation = await directMessage.open(profile.pubkey);
      if (!owner.active || currentOwner.current !== owner) return;
      await cache.invalidateQueries({ queryKey: channelsQueryKey });
      if (!owner.active || currentOwner.current !== owner) return;
      await navigate({ to: "/channels/$channelId", params: { channelId: conversation.channelId } });
      if (owner.active && currentOwner.current === owner) onClose();
    } catch {
      if (owner.active && currentOwner.current === owner) setOpenFailed(true);
    } finally {
      if (owner.active && currentOwner.current === owner) setOpening(false);
    }
  }

  return (
    <AuxiliaryPanel
      canResetWidth={canResetWidth}
      className="relative"
      isSinglePanelView={isSinglePanelView}
      layout={isSplitLayout ? "split" : "standalone"}
      onClose={onClose}
      onResetWidth={onResetWidth}
      onResizeStart={onResizeStart}
      resizeHandleAriaLabel={translate(locale, "platform.profile.resize")}
      resizeHandleTestId="user-profile-resize-handle"
      splitPaneClamp={splitPaneClamp}
      testId="user-profile-panel"
      transparentChrome={transparentChrome}
      widthPx={widthPx}
      header={
        <AuxiliaryPanelHeader
          data-testid="user-profile-panel-header"
          inset={!isSplitLayout ? "wide" : "default"}
          resizeBorder={!isSinglePanelView && !isOverlay && !isSplitLayout}
        >
          <AuxiliaryPanelHeaderGroup>
            <AuxiliaryPanelHeaderTitleBlock title={translate(locale, "platform.settings.profile")} />
          </AuxiliaryPanelHeaderGroup>
        </AuxiliaryPanelHeader>
      }
    >
      <AuxiliaryPanelBody
        className="overflow-y-auto px-4 pb-6"
        data-testid="user-profile-scroll-body"
      >
        {profile ? <ProfileSummaryView
          displayName={displayName}
          profile={profile}
          pubkey={pubkey}
          copy={writeTextToClipboard}
          mediaUrl={rewriteRelayUrl}
          messagePending={opening || directMessage.busy}
          onMessage={pubkey !== session.devicePubkey && platformSession.isSuccess && !platformSession.isFetching ? () => { void openMessage(); } : undefined}
        /> : profileQuery.isError || (profileQuery.isSuccess && !profileQuery.isFetching) ?
          <div role="alert"><p>{translate(locale, "platform.loadFailed")}</p>
            <Button onClick={() => { void profileQuery.refetch(); }}>{translate(locale, "platform.retry")}</Button>
          </div> : <p role="status">{translate(locale, "platform.loading")}</p>}
        {openFailed ? <p role="alert">{directMessage.notice ?? translate(locale, "platform.loadFailed")}</p> : null}
      </AuxiliaryPanelBody>
    </AuxiliaryPanel>
  );
}
