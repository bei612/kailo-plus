// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/profile/ui/UserProfilePanel.tsx, the Agent half: view / tab state, the
// owner and activity gates, field buckets, header content and the focused views. The HUMAN half
// stays in each host (Desktop UserProfilePanel, Web MessageAuthorProfile) around
// pulse/ProfileSummaryView; both hosts mount this same body when the profile is an Agent.
// Kailo data sources, each with its design basis:
// - The Agent is identified only through the admitted Installation directory of the Workspace
//   the profile was opened from (17 §8, Installation `read`); no directory row means a public
//   profile. There is no local managed agent, persona file or Relay agent list (DD-26).
// - Owner gates ("viewerIsOwner") are the session Principal being the Installation's HUMAN owner;
//   activity is Installation `audit` (DD-125(6)); memory is the owner's governed surface
//   (DD-68); the instructions are the pinned Version's (Definition `read`, 17 §8).
// - Every read is re-admitted by Core; a refused or malformed read hides that part only.
import {
  AgentRespondToMode,
  type AgentInstallationUsePage,
  type AgentInstallationView,
  type AgentVersionView,
  type WorkspaceMemberView,
} from "@client-kit/contracts";
import * as React from "react";

import { useLifecycleRequest } from "../../../../../agent-activity/AgentLifecycleControls";
import { useAgentWorking } from "../../../../../agent-activity/agentWorkingSignal";
import { respondToModeOf } from "../../../../../agent-activity/respondTo";
import { loadWorkspaceAgents } from "../../../../../agent-installation-view";
import { TranscriptWorkspaceProvider } from "../../../../../agent-transcript/host";
import { useOpenAgentActivity } from "../../../../../agent-transcript/open-agent-activity";
import {
  useBffClient,
  useCurrentPrincipalId,
  useOptionalBffClient,
  useUiT,
} from "../../../../../context";
import { AuxiliaryPanelBody } from "../../../../../messages/thread/auxiliary";
import { UserProfilePanelFrame } from "../../../../../pulse/UserProfilePanelFrame";
import { useLoad } from "../../../../../use-load";
import { resolveProfileActivityAgent } from "../lib/profileActivityAgent";
import { AgentConfigurationFocusedView } from "./UserProfilePanelAgentDetails";
import { useProfileFieldBuckets } from "./UserProfilePanelFields";
import {
  AgentInfoFocusedView,
  ChannelsFocusedView,
  MemoryFocusedView,
} from "./UserProfilePanelFocusedViews";
import { getUserProfilePanelHeaderContent } from "./UserProfilePanelHeaderContent";
import {
  AgentInstructionsFocusedView,
  AgentProfileSummaryView,
} from "./UserProfilePanelSections";
import {
  deriveProfileChannels,
  type ProfilePanelTab,
  type ProfilePanelView,
  profilePanelTargetKey,
} from "./UserProfilePanelUtils";

export type { ProfilePanelTab, ProfilePanelView };

/** The admitted Workspace the profile was opened from; without it a profile is public only. */
export type UserProfileAgentScope = {
  workspaceId: string;
  /** Display name of that Workspace's channel (activity and channel rows). */
  channelName?: string | null;
  /** Open a Buzz channel of this Workspace. */
  onOpenChannel?: (channelId: string) => void;
  /** Open another profile in this same panel (owner row, instances). */
  onOpenProfile?: (pubkey: string) => void;
};

export type ProfileAgentLookup =
  | { status: "none" }
  | { status: "pending" }
  | {
      status: "agent";
      installation: AgentInstallationView;
      rows: AgentInstallationView[];
      reload: () => void;
    };

const normalize = (pubkey: string) => pubkey.trim().toLowerCase();

/**
 * Whether `pubkey` is an Agent of the admitted Workspace: its Installation from the governed
 * directory (every page; a malformed page fails closed to "none"). Renders without a platform
 * session too, where every profile is public.
 */
export function useProfileAgentLookup(
  scope: UserProfileAgentScope | undefined,
  pubkey: string | undefined,
): ProfileAgentLookup {
  const client = useOptionalBffClient();
  const workspaceId = client && scope ? scope.workspaceId : null;
  const [directory, reload] = useLoad(
    `profile-agent-directory:${workspaceId ?? ""}`,
    () => (client && workspaceId ? loadWorkspaceAgents(client, workspaceId) : Promise.resolve(null)),
  );
  if (!workspaceId || !pubkey) return { status: "none" };
  if (directory.status === "pending") return { status: "pending" };
  if (directory.status === "error" || !directory.data) return { status: "none" };
  const key = normalize(pubkey);
  const installation = directory.data.find(
    (row) => typeof row.agentPubkey === "string" && normalize(row.agentPubkey) === key,
  );
  return installation
    ? { status: "agent", installation, rows: directory.data, reload }
    : { status: "none" };
}

type FrameProps = {
  canResetWidth?: boolean;
  isOverlay: boolean;
  isSinglePanelView: boolean;
  isSplitLayout: boolean;
  onClose: () => void;
  onResetWidth?: () => void;
  onResizeStart?: React.PointerEventHandler<HTMLButtonElement>;
  splitPaneClamp: boolean;
  transparentChrome?: boolean;
  widthPx: number;
};

export type UserProfileAgentPanelProps = FrameProps & {
  displayName: string;
  installation: AgentInstallationView;
  mediaUrl: (url: string) => string;
  onTabChange?: (tab: ProfilePanelTab, options?: { replace?: boolean }) => void;
  onViewChange?: (view: ProfilePanelView, options?: { replace?: boolean }) => void;
  profile:
    | { avatarUrl?: string | null; about?: string | null; displayName?: string | null; nip05Handle?: string | null }
    | undefined;
  pubkey: string;
  reload: () => void;
  rows: AgentInstallationView[];
  scope: UserProfileAgentScope;
  tab?: ProfilePanelTab;
  view?: ProfilePanelView;
};

function validMembers(value: unknown): value is WorkspaceMemberView[] {
  return Array.isArray(value) && value.every((row: WorkspaceMemberView) => row
    && typeof row.principalId === "string" && typeof row.displayName === "string" && Array.isArray(row.pubkeys));
}

function validUsePage(value: AgentInstallationUsePage | null, installationId: string): value is AgentInstallationUsePage {
  return Boolean(value) && value?.installationId === installationId && Array.isArray(value.members);
}

function validVersion(value: AgentVersionView | null, assetId: string): value is AgentVersionView {
  return Boolean(value) && value?.assetId === assetId && typeof value.content?.instructions === "string";
}

export function UserProfileAgentPanel({
  canResetWidth,
  displayName,
  installation,
  isOverlay,
  isSinglePanelView,
  isSplitLayout,
  mediaUrl,
  onClose,
  onResetWidth,
  onResizeStart,
  onTabChange,
  onViewChange,
  profile,
  pubkey,
  reload,
  rows,
  scope,
  splitPaneClamp,
  tab: controlledTab,
  transparentChrome = false,
  view: controlledView,
  widthPx,
}: UserProfileAgentPanelProps) {
  const t = useUiT();
  const client = useBffClient();
  const currentPrincipalId = useCurrentPrincipalId();
  const viewerIsOwner =
    typeof currentPrincipalId === "string" &&
    currentPrincipalId.length > 0 &&
    currentPrincipalId === installation.ownerPrincipalId;

  const [internalView, setInternalView] =
    React.useState<ProfilePanelView>("summary");
  const view = controlledView ?? internalView;
  const setView = React.useCallback(
    (nextView: ProfilePanelView, options?: { replace?: boolean }) => {
      if (onViewChange) {
        onViewChange(nextView, options);
        return;
      }
      setInternalView(nextView);
    },
    [onViewChange],
  );
  const [internalTab, setInternalTab] = React.useState<ProfilePanelTab>("info");
  const tab = controlledTab ?? internalTab;
  const setTab = React.useCallback(
    (nextTab: ProfilePanelTab, options?: { replace?: boolean }) => {
      if (onTabChange) {
        onTabChange(nextTab, options);
        return;
      }
      setInternalTab(nextTab);
    },
    [onTabChange],
  );
  const [stickyChrome, setStickyChrome] = React.useState({
    active: false,
    height: 0,
  });
  const handleStickyChromeChange = React.useCallback(
    (nextState: { active: boolean; height: number }) => {
      setStickyChrome((currentState) =>
        currentState.active === nextState.active &&
        currentState.height === nextState.height
          ? currentState
          : nextState,
      );
    },
    [],
  );

  // Original target change: back to the summary Info tab, unless this panel itself opened the
  // requested instance (then its Runtime tab stays).
  const [requestedInstancePubkey, setRequestedInstancePubkey] = React.useState<
    string | null
  >(null);
  const preserveRequestedInstance =
    requestedInstancePubkey !== null &&
    normalize(requestedInstancePubkey) === normalize(pubkey);
  const targetKey = profilePanelTargetKey(pubkey);
  const prevTargetKeyRef = React.useRef(targetKey);
  React.useEffect(() => {
    if (prevTargetKeyRef.current === targetKey) return;
    prevTargetKeyRef.current = targetKey;
    if (preserveRequestedInstance) return;
    setRequestedInstancePubkey(null);
    setView("summary", { replace: true });
    setTab("info", { replace: true });
  }, [preserveRequestedInstance, setTab, setView, targetKey]);

  // Owner name for "Managed by" through the Workspace member directory (HUMAN Principals).
  const [members] = useLoad(
    `profile-agent-owner:${installation.workspaceId}:${installation.ownerPrincipalId}`,
    () => client.members(installation.workspaceId),
  );
  const owner =
    members.status === "ok" && validMembers(members.data)
      ? members.data.find((row) => row.principalId === installation.ownerPrincipalId)
      : undefined;
  const ownerName = owner?.displayName.trim() || null;
  const ownerDisplayName = ownerName
    ? viewerIsOwner
      ? t("platform.profile.field.managedByYou", { name: ownerName })
      : ownerName
    : null;
  const ownerPubkey = owner?.pubkeys[0] ?? null;

  // The original respondTo, read only for the owner (operational field).
  const [usePage] = useLoad(
    `profile-agent-use:${viewerIsOwner}:${installation.resourceId}:${installation.resourceVersion}`,
    () => (viewerIsOwner ? client.agentInstallationUsers(installation.resourceId) : Promise.resolve(null)),
  );
  const respondTo: AgentRespondToMode | undefined =
    usePage.status === "ok" && validUsePage(usePage.data, installation.resourceId)
      ? respondToModeOf(usePage.data)
      : undefined;

  // The pinned Version's instructions, read only for the owner.
  const [version] = useLoad(
    `profile-agent-version:${viewerIsOwner}:${installation.pinnedVersionAssetId}`,
    () => (viewerIsOwner ? client.agentVersion(installation.pinnedVersionAssetId) : Promise.resolve(null)),
  );
  const instruction =
    version.status === "ok" && validVersion(version.data, installation.pinnedVersionAssetId)
      ? version.data.content.instructions.trim() || null
      : null;

  const { canOpenAgentActivity, openAgentActivity } = useOpenAgentActivity();
  const canViewActivity =
    installation.canAudit === true && (canOpenAgentActivity?.(pubkey) ?? false);
  const activityAgent = React.useMemo(
    () =>
      canViewActivity
        ? resolveProfileActivityAgent({
            effectivePubkey: pubkey,
            fallbackName: t("agentTranscript.agentFallback"),
            installation,
            profile: profile ?? null,
          })
        : null,
    [canViewActivity, installation, profile, pubkey, t],
  );
  const activeTurns = useAgentWorking(pubkey).channels;
  const handleOpenActivity = React.useCallback(
    (channelId?: string | null) => {
      openAgentActivity(pubkey, { channelId: channelId ?? null });
    },
    [openAgentActivity, pubkey],
  );

  const { agentInfoFields, agentSettingsFields, diagnosticsFields } =
    useProfileFieldBuckets({
      installation,
      isOwner: viewerIsOwner,
      onOpenProfile: scope.onOpenProfile,
      ownerDisplayName,
      ownerPubkey,
      profile,
      pubkey,
      respondTo,
    });

  const channels = React.useMemo(
    () => deriveProfileChannels(installation, scope.channelName),
    [installation, scope.channelName],
  );
  // Activity scopes are keyed by the Workspace (the working signal and opener scope).
  const channelIdToName = React.useMemo<Record<string, string>>(() => {
    const name = scope.channelName?.trim();
    return name ? { [installation.workspaceId]: name } : {};
  }, [installation.workspaceId, scope.channelName]);
  const instances = React.useMemo(
    () =>
      rows.filter(
        (row) =>
          row.agentResourceId === installation.agentResourceId &&
          typeof row.agentPubkey === "string" &&
          row.agentPubkey.length > 0,
      ),
    [installation.agentResourceId, rows],
  );
  const openProfile = scope.onOpenProfile;
  const onOpenInstance = React.useMemo(
    () =>
      openProfile
        ? (instancePubkey: string) => {
            setRequestedInstancePubkey(instancePubkey);
            openProfile(instancePubkey);
            setTab("runtime");
          }
        : undefined,
    [openProfile, setTab],
  );

  const lifecycle = useLifecycleRequest(reload);
  const canDeleteAgent = viewerIsOwner && installation.canDisable === true;
  const showInstructionBlock = viewerIsOwner && instruction !== null;

  const { headerActions, headerLeftContent } = getUserProfilePanelHeaderContent({
    onBack: () => setView("summary"),
    t,
    view,
  });

  const profileBody = (
    <AuxiliaryPanelBody
      className="overflow-y-auto px-4 pb-6"
      data-testid="user-profile-scroll-body"
    >
      <TranscriptWorkspaceProvider value={installation.workspaceId}>
        {view === "summary" ? (
          <AgentProfileSummaryView
            activeTurns={activeTurns}
            activityAgent={activityAgent}
            agentInfoFields={agentInfoFields}
            agentSettingsFields={agentSettingsFields}
            canDeleteAgent={canDeleteAgent}
            canViewActivity={canViewActivity && activityAgent !== null}
            channelIdToName={channelIdToName}
            channels={channels}
            diagnosticsFields={diagnosticsFields}
            displayName={displayName}
            installation={installation}
            instances={instances}
            lifecycle={lifecycle}
            mediaUrl={mediaUrl}
            onOpenActivity={handleOpenActivity}
            onOpenChannel={scope.onOpenChannel}
            onOpenInstance={onOpenInstance}
            onOpenInstructions={() => setView("instructions")}
            onStickyChromeChange={handleStickyChromeChange}
            onTabChange={setTab}
            profile={profile}
            pubkey={pubkey}
            showInstructionBlock={showInstructionBlock}
            tab={tab}
            viewerIsOwner={viewerIsOwner}
          />
        ) : null}
        {view === "memories" ? (
          <MemoryFocusedView installation={installation} viewerIsOwner={viewerIsOwner} />
        ) : null}
        {view === "info" ? (
          <AgentInfoFocusedView metadataFields={agentInfoFields} />
        ) : null}
        {view === "configuration" ? (
          <AgentConfigurationFocusedView fields={agentSettingsFields} />
        ) : null}
        {view === "instructions" && viewerIsOwner ? (
          <AgentInstructionsFocusedView instruction={instruction} />
        ) : null}
        {view === "channels" ? (
          <ChannelsFocusedView channels={channels} onOpenChannel={scope.onOpenChannel} />
        ) : null}
      </TranscriptWorkspaceProvider>
    </AuxiliaryPanelBody>
  );

  return (
    <UserProfilePanelFrame
      addAgentToChannelDialog={null}
      canResetWidth={canResetWidth}
      editAgentDialog={null}
      headerActions={headerActions}
      headerLeftContent={headerLeftContent}
      isOverlay={isOverlay}
      isSinglePanelView={isSinglePanelView}
      isSplitLayout={isSplitLayout}
      onClose={onClose}
      onResetWidth={onResetWidth}
      onResizeStart={onResizeStart}
      personaDialogs={lifecycle.dialog}
      profileBody={profileBody}
      splitPaneClamp={splitPaneClamp}
      stickyChromeActive={view === "summary" && stickyChrome.active}
      stickyChromeEnabled={view === "summary"}
      stickyChromeHeight={stickyChrome.height}
      widthPx={widthPx}
      transparentChrome={transparentChrome}
    />
  );
}
