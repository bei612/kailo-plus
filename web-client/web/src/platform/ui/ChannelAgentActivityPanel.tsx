// DD-125(6), V-SCN-143: where the Web channel opens an Agent's activity — the
// original AgentSessionThreadPanel slot beside the timeline. Every working surface
// (activity popover, composer chip) calls the shared opener; the panel shows only
// Agents of this channel whose Installation the viewer may `audit` (members only
// ever see the Agent's 20002 working signal).
import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { ComposerAgent } from "@client-kit/platform/react/composer/features/messages/lib/composerAgentDirectory";
import {
  AgentSessionPanel,
  useRegisterAgentActivityOpener,
  type AgentActivityOpener,
} from "@client-kit/platform/react/agent-transcript";

type Opened = { pubkey: string; channelId: string | null };

export function useChannelAgentActivityPanel({ agents, channelId, channelName, enabled, scopeId }: {
  agents: readonly ComposerAgent[] | undefined;
  /** Buzz Channel of this view, for the panel scope label. */
  channelId: string | null;
  channelName?: string;
  enabled: boolean;
  /** The view's sidebar identity (Workspace ID); null for conversations. */
  scopeId: string | null;
}): { opener: AgentActivityOpener; panel: ReactNode } {
  const [opened, setOpened] = useState<Opened | null>(null);
  const find = useCallback((pubkey: string) => {
    const key = pubkey.toLowerCase();
    return enabled ? agents?.find((agent) => agent.pubkey.toLowerCase() === key && agent.installation.canAudit === true) : undefined;
  }, [agents, enabled]);
  const opener = useMemo<AgentActivityOpener>(() => ({
    // A request may arrive before this channel's Agents load (sidebar navigation);
    // it is kept and rendered only once an audited Installation matches.
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
