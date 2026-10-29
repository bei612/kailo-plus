// DD-125(6), V-SCN-143/144: Desktop host of the shared Agent working signal and activity panel
// (Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/channels/ui/useChannelActivityTyping.ts,
// ChannelComposerActivityAccessory.tsx, BotActivityBar.tsx and the AgentSessionThreadPanel slot).
// The bodies are the client-kit ones the Web host mounts. Only the inputs are host facts:
// - the channel's admitted Workspace comes from the BFF directory (Core Workspace IDs and signed
//   Relay channel IDs are separate identities); the signal is keyed by that Workspace, the scope
//   under which Core answers audited running turns;
// - Agent 20002 typing comes from this device's own Relay subscription (useChannelTyping);
// - the Installation directory and the audited turns are BFF reads (management plane via BFF, DD-75).
// Members only ever see the 20002 working signal; the turn start, headline and "View activity"
// stay with Installation `audit` holders (Core re-admits each read).
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useBffClient } from "@client-kit/platform/react/context";
import { loadWorkspaceAgents } from "@client-kit/platform/react/agent-installation-view";
import {
  resetAgentWorkingSignal,
  useChannelAgentActivity,
  type BotActivityAgent,
} from "@client-kit/platform/react/agent-activity";
import {
  AgentActivityOpenerHost,
  AgentSessionPanel,
  useRegisterAgentActivityOpener,
  type AgentActivityOpener,
} from "@client-kit/platform/react/agent-transcript";
import { useComposerAgentDirectory } from "@client-kit/platform/react/composer/features/messages/ui/useComposerAgentDirectory";
import type { ComposerAgent } from "@client-kit/platform/react/composer/features/messages/lib/composerAgentDirectory";
import { truncateNpub } from "@client-kit/platform/react/conversations/pubkey";
import type { TypingIndicatorEntry } from "@client-kit/platform/react/messages/typingState";
import { useAgentAuthorFacts } from "@client-kit/platform/react/messages";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { nativeApplicationWorkspace, useWorkspaceChannelDirectory } from "@/features/channels/hooks";
import { useNativeSession } from "@/features/platform/activeCommunity";
import type { Channel } from "@/shared/api/types";

/**
 * App-level opener for working surfaces outside the channel view (the sidebar popover): a
 * request for another channel opens that channel, whose view then receives it. The Workspace
 * scope is resolved to the native channel through the same admitted directory.
 */
export function DesktopAgentActivityOpenerHost({ children }: { children: React.ReactNode }) {
  const directory = useWorkspaceChannelDirectory();
  const { goChannel } = useAppNavigation();
  const rows = React.useRef(directory.data);
  rows.current = directory.data;
  const navigate = React.useCallback((scopeId: string) => {
    const channelId = rows.current?.find((row) => row.id === scopeId)?.channel.channelId;
    if (channelId) void goChannel(channelId);
  }, [goChannel]);
  // Original community-switch reset: no working state crosses this session scope.
  React.useEffect(() => () => resetAgentWorkingSignal(), []);
  return <AgentActivityOpenerHost navigate={navigate}>{children}</AgentActivityOpenerHost>;
}

type OpenedActivity = { pubkey: string; channelId: string | null };

/** The original AgentSessionThreadPanel slot for this channel's audited Agents. */
function useAgentActivityPanel({ agents, channelId, channelName, enabled, scopeId }: {
  agents: readonly ComposerAgent[] | undefined;
  channelId: string;
  channelName: string;
  enabled: boolean;
  scopeId: string | null;
}): { opener: AgentActivityOpener; panel: React.ReactNode } {
  const [opened, setOpened] = React.useState<OpenedActivity | null>(null);
  const find = React.useCallback((pubkey: string) => {
    const key = pubkey.toLowerCase();
    return enabled
      ? agents?.find((agent) => agent.pubkey.toLowerCase() === key && agent.installation.canAudit === true)
      : undefined;
  }, [agents, enabled]);
  const opener = React.useMemo<AgentActivityOpener>(() => ({
    // A request may arrive before this channel's Agents load (sidebar navigation); it is kept
    // and rendered only once an audited Installation matches.
    openAgentActivity: (pubkey) => setOpened({ pubkey: pubkey.toLowerCase(), channelId }),
    canOpenAgentActivity: (pubkey) => find(pubkey) !== undefined,
  }), [channelId, find]);
  useRegisterAgentActivityOpener(enabled ? scopeId : null, opener);
  const agent = opened ? find(opened.pubkey) : undefined;
  const panel = opened && agent ? <AgentSessionPanel key={`${agent.installation.resourceId}:${opened.channelId ?? ""}`}
    agentAvatarUrl={agent.avatarUrl} agentName={agent.displayName} channelId={opened.channelId}
    channelName={channelName} installation={agent.installation} onClose={() => setOpened(null)} /> : null;
  return { opener, panel };
}

export function useDesktopChannelAgentActivity({ activeChannel, enabled, typingEntries }: {
  activeChannel: Channel;
  /** False while the member cannot participate (not joined, archived). */
  enabled: boolean;
  typingEntries: readonly TypingIndicatorEntry[];
}) {
  const bff = useBffClient();
  const session = useNativeSession();
  const isWorkspaceChannel = activeChannel.channelType !== "dm";
  const directory = useWorkspaceChannelDirectory({ enabled: enabled && isWorkspaceChannel });
  const workspaceId = isWorkspaceChannel
    ? nativeApplicationWorkspace(directory.data, { channelId: activeChannel.id })?.id ?? null
    : null;
  const live = enabled && workspaceId !== null;
  // The composer's Agent directory: names and the audited Installation behind "View activity".
  const composerAgents = useComposerAgentDirectory(bff, {
    workspaceId: workspaceId ?? undefined, channelId: activeChannel.id, ownerPubkey: session.devicePubkey,
  }, live);
  // Every Agent this person may read (not only those they may invoke) is an Agent for the
  // working signal; its 20002 never shows as a person typing.
  const channelAgents = useQuery({
    queryKey: ["platform", "channel-agents", session.devicePubkey, workspaceId],
    queryFn: () => loadWorkspaceAgents(bff, workspaceId ?? ""),
    enabled: live,
    retry: false,
  });
  const readableAgents = live && channelAgents.isSuccess && Array.isArray(channelAgents.data)
    ? channelAgents.data : undefined;
  const activity = useChannelAgentActivity({
    client: bff, channelId: workspaceId, agents: readableAgents, typingEntries, enabled: live,
  });
  const composerAgentList = composerAgents.data?.agents;
  // DD-147: owner line from the member-readable author directory; the badge stays owner-only.
  const authorFacts = useAgentAuthorFacts(bff, live && workspaceId ? { workspaceId } : null);
  const workingAgents = React.useMemo<BotActivityAgent[]>(() => (readableAgents ?? []).flatMap((row) =>
    row.agentPubkey ? [{
      pubkey: row.agentPubkey,
      name: row.agentDisplayName?.trim()
        || (composerAgentList?.find((agent) => agent.installation.resourceId === row.resourceId)?.displayName
          ?? truncateNpub(row.agentPubkey)),
      ...(row.canAudit === true ? { auditInstallationId: row.resourceId } : {}),
    }] : []), [readableAgents, composerAgentList]);
  // DD-142: the original canManageMessageForCurrentUser "own Agent" set, from the same composer
  // directory and owner rule as the Web host. Only a live Workspace channel has one.
  const composerPrincipalId = composerAgents.data?.principalId;
  const ownedAgentPubkeys = React.useMemo<ReadonlySet<string>>(() => new Set(live && composerPrincipalId
    ? (composerAgentList ?? []).filter((agent) => agent.installation.ownerPrincipalId === composerPrincipalId)
      .map((agent) => agent.pubkey.toLowerCase())
    : []), [live, composerAgentList, composerPrincipalId]);
  // Agent mentions of a BFF edit are Installation IDs, never `mentionPubkeys` (Core refuses Agent keys there).
  const agentInstallationIds = React.useMemo<ReadonlyMap<string, string>>(() => new Map(live
    ? (composerAgentList ?? []).map((agent) => [agent.pubkey.toLowerCase(), agent.installation.resourceId] as const)
    : []), [live, composerAgentList]);
  const panel = useAgentActivityPanel({
    agents: composerAgentList, channelId: activeChannel.id, channelName: activeChannel.name,
    enabled: live, scopeId: workspaceId,
  });
  return {
    /** The Workspace scope the working signal and "View activity" use, if admitted. */
    scopeId: workspaceId,
    agentPubkeys: activity.agentPubkeys,
    /** DD-147/148 row facts for the shared timeline (owner line, badge, address prefix). */
    authorFacts,
    workingBotPubkeys: live ? activity.workingBotPubkeys : [],
    workingAgents,
    /** DD-142: AGENT keys of this Workspace's ACTIVE Installations the viewer owns. */
    ownedAgentPubkeys,
    /** Composer Agent key → Installation ID, for the Installation mentions of a BFF edit. */
    agentInstallationIds,
    opener: panel.opener,
    panel: panel.panel,
  };
}
