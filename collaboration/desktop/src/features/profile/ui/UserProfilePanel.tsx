import { useUserProfileQuery } from "@/features/profile/hooks";
import { getProfile } from "@/shared/api/tauriProfiles";
import { useActiveCommunity, useNativeSession } from "@/features/platform/activeCommunity";
import { buildWaveMessageContent } from "@client-kit/platform/react/messages";
import { sendChannelMessage } from "@/shared/api/tauri";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { translate } from "@client-kit/platform/i18n";
import { useDeviceLocale } from "@client-kit/platform/react/context";
import { useDirectMessageOpen } from "@client-kit/platform/react/new-message";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { channelsQueryKey } from "@/features/channels/hooks";
import {
  ProfileSummaryView,
  UserProfileAgentPanel,
  UserProfilePanelFrame,
  useProfileAgentLookup,
  type ProfilePanelTab,
  type ProfilePanelView,
  type UserProfileAgentScope,
} from "@client-kit/platform/react/pulse";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import { useIsThreadPanelOverlay } from "@/shared/hooks/use-mobile";
import {
  AuxiliaryPanelBody,
  AuxiliaryPanelHeaderGroup,
  AuxiliaryPanelHeaderTitleBlock,
} from "@/shared/layout/AuxiliaryPanel";
import { truncateNpub } from "@/shared/lib/pubkey";
import * as React from "react";
import { Button } from "@/shared/ui/button";
import { snapshotExportHost } from "@/features/platform/snapshotExportHost";

export type UserProfilePanelProps = {
  /**
   * DD-125(6), 17 §8: the admitted Workspace this profile was opened from. When the pubkey is
   * one of its Agents, the shared Agent panel (tabs, sections, focused views, activity) renders;
   * without it every profile is public only.
   */
  agentScope?: UserProfileAgentScope;
  canResetWidth?: boolean;
  isSinglePanelView?: boolean;
  layout?: "standalone" | "split";
  onClose: () => void;
  onResetWidth?: () => void;
  onResizeStart?: (event: React.PointerEvent<HTMLButtonElement>) => void;
  pubkey: string;
  splitPaneClamp?: boolean;
  /** Original controlled summary tab / focused view (route search state); internal when absent. */
  tab?: ProfilePanelTab;
  view?: ProfilePanelView;
  onTabChange?: (tab: ProfilePanelTab, options?: { replace?: boolean }) => void;
  onViewChange?: (view: ProfilePanelView, options?: { replace?: boolean }) => void;
  widthPx: number;
  transparentChrome?: boolean;
};

/** Original public fields and direct Message action through governed DM preparation. */
export function UserProfilePanel({
  agentScope,
  canResetWidth,
  isSinglePanelView = false,
  layout = "standalone",
  onClose,
  onResetWidth,
  onResizeStart,
  pubkey,
  splitPaneClamp = false,
  tab,
  view,
  onTabChange,
  onViewChange,
  widthPx,
  transparentChrome = false,
}: UserProfilePanelProps) {
  const locale = useDeviceLocale();
  const session = useNativeSession();
  const community = useActiveCommunity();
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
  const agent = useProfileAgentLookup(agentScope, pubkey);
  // DD-125(3) original handleWave: open (or reuse) the 1:1 DM through the same governed
  // preparation, navigate there, then sign the marked wave kind:9 with this device's key.
  const [waving, setWaving] = React.useState(false);
  async function waveAtProfile() {
    if (!profile || waving || opening || directMessage.busy || !platformSession.isSuccess || platformSession.isFetching
      || !owner.active || currentOwner.current !== owner) return;
    const relayUrl = community.relayUrl;
    const signer = session.devicePubkey;
    const sessionName = (platformSession.data.displayName ?? "").trim();
    setWaving(true);
    try {
      // Original sender name: own profile display name, then the account name.
      const own = await getProfile().catch(() => null);
      const senderName = (own?.pubkey === signer ? own.displayName?.trim() : "") || sessionName;
      const conversation = await directMessage.open(profile.pubkey);
      if (!owner.active || currentOwner.current !== owner) return;
      await cache.invalidateQueries({ queryKey: channelsQueryKey });
      if (!owner.active || currentOwner.current !== owner) return;
      await navigate({ to: "/channels/$channelId", params: { channelId: conversation.channelId } });
      if (owner.active && currentOwner.current === owner) onClose();
      await sendChannelMessage(conversation.channelId, buildWaveMessageContent(senderName), null,
        undefined, undefined, undefined, undefined, undefined, undefined, relayUrl, signer);
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : translate(locale, "platform.profile.waveFailed"));
    } finally {
      if (owner.active && currentOwner.current === owner) setWaving(false);
    }
  }
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

  if (agent.status === "agent" && agentScope) {
    return (
      <UserProfileAgentPanel
        canResetWidth={canResetWidth}
        displayName={profile?.displayName ?? (agent.installation.agentDisplayName?.trim() || truncateNpub(pubkey))}
        installation={agent.installation}
        isOverlay={isOverlay}
        isSinglePanelView={isSinglePanelView}
        isSplitLayout={isSplitLayout}
        mediaUrl={rewriteRelayUrl}
        onClose={onClose}
        onResetWidth={onResetWidth}
        onResizeStart={onResizeStart}
        onTabChange={onTabChange}
        onViewChange={onViewChange}
        profile={profile}
        pubkey={pubkey}
        reload={agent.reload}
        rows={agent.rows}
        scope={{ ...agentScope, snapshotExportHost }}
        splitPaneClamp={splitPaneClamp}
        tab={tab}
        transparentChrome={transparentChrome}
        view={view}
        widthPx={widthPx}
      />
    );
  }

  return (
    <UserProfilePanelFrame
      canResetWidth={canResetWidth}
      isSinglePanelView={isSinglePanelView}
      isSplitLayout={isSplitLayout}
      isOverlay={isOverlay}
      onClose={onClose}
      onResetWidth={onResetWidth}
      onResizeStart={onResizeStart}
      splitPaneClamp={splitPaneClamp}
      transparentChrome={transparentChrome}
      widthPx={widthPx}
      addAgentToChannelDialog={null}
      editAgentDialog={null}
      personaDialogs={null}
      headerActions={null}
      stickyChromeActive={false}
      stickyChromeEnabled={false}
      stickyChromeHeight={0}
      headerLeftContent={
          <AuxiliaryPanelHeaderGroup>
            <AuxiliaryPanelHeaderTitleBlock title={translate(locale, "platform.settings.profile")} />
          </AuxiliaryPanelHeaderGroup>
      }
      profileBody={
      <AuxiliaryPanelBody
        className="overflow-y-auto px-4 pb-6"
        data-testid="user-profile-scroll-body"
      >
        {profile && agent.status !== "pending" ? <ProfileSummaryView
          displayName={displayName}
          profile={profile}
          pubkey={pubkey}
          copy={writeTextToClipboard}
          mediaUrl={rewriteRelayUrl}
          messagePending={opening || directMessage.busy}
          onMessage={pubkey !== session.devicePubkey && platformSession.isSuccess && !platformSession.isFetching ? () => { void openMessage(); } : undefined}
          wavePending={waving}
          onWave={pubkey !== session.devicePubkey && platformSession.isSuccess && !platformSession.isFetching ? () => { void waveAtProfile(); } : undefined}
        /> : agent.status !== "pending" && (profileQuery.isError || (profileQuery.isSuccess && !profileQuery.isFetching)) ?
          <div role="alert"><p>{translate(locale, "platform.loadFailed")}</p>
            <Button onClick={() => { void profileQuery.refetch(); }}>{translate(locale, "platform.retry")}</Button>
          </div> : <p role="status">{translate(locale, "platform.loading")}</p>}
        {openFailed ? <p role="alert">{directMessage.notice ?? translate(locale, "platform.loadFailed")}</p> : null}
      </AuxiliaryPanelBody>
      }
    />
  );
}
