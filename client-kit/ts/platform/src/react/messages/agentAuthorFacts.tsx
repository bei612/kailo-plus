// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/lib/formatTimelineMessages.ts (ownerPubkey/ownerLabel for agent
// authors), MessageAgentOwner.tsx and ChannelScreen.tsx respondToLookup → MessageRow
// showRespondToIndicator.
// DD-147: (1) every channel member who reads the admitted Agent directory sees "managed by <owner>",
// from the directory's ownerDisplayName (Core: the owner's ACTIVE Tenant name) and the owner's
// Workspace key for the profile popover; (2) only the Installation owner sees the respondTo badge,
// from its own readable use grants; `anyone` is not offered (DD-125(6)), so only allowlist exists.
import * as React from "react";
import { useQueries } from "@tanstack/react-query";
import { AgentRespondToMode, WorkspaceMembershipState, type AgentInstallationView, type WorkspaceMemberView } from "@client-kit/contracts";
import type { BffClient } from "../../client";
import { respondToModeOf } from "../agent-activity/respondTo";
import { normalizePubkey } from "../conversations/pubkey";
import type { TimelineMessage } from "./types";
import type { AgentAddressHost } from "./MessageAgentAddressPrefix";

export type AgentAuthorFact = {
  ownerLabel: string | null;
  ownerPubkey: string | null;
  displayName: string;
  respondTo?: "allowlist";
};
export type AgentAuthorFacts = ReadonlyMap<string, AgentAuthorFact>;

type Directory = {
  principalId: string;
  agents: readonly { installation: AgentInstallationView; pubkey: string; displayName: string }[];
  members: readonly WorkspaceMemberView[];
};

/** Pure projection of the admitted directory (plus the owner's respondTo modes). */
export function agentAuthorFacts(directory: Directory | undefined,
  allowlisted: ReadonlySet<string> = new Set()): AgentAuthorFacts {
  const facts = new Map<string, AgentAuthorFact>();
  if (!directory) return facts;
  for (const agent of directory.agents) {
    const owner = directory.members.find((member) => member.principalId === agent.installation.ownerPrincipalId
      && member.state === WorkspaceMembershipState.Active);
    const ownerLabel = agent.installation.ownerDisplayName?.trim() || null;
    facts.set(normalizePubkey(agent.pubkey), {
      ownerLabel,
      ownerPubkey: ownerLabel ? owner?.pubkeys[0] ?? null : null,
      displayName: agent.displayName,
      ...(allowlisted.has(agent.installation.resourceId) ? { respondTo: "allowlist" as const } : {}),
    });
  }
  return facts;
}

/** The directory plus the viewer's own Installations' use pages (owner-only badge). */
export function useAgentAuthorFacts(client: Pick<BffClient, "agentInstallationUsers">, directory: Directory | undefined): AgentAuthorFacts {
  const owned = (directory?.agents ?? []).filter((agent) => agent.installation.ownerPrincipalId === directory?.principalId)
    .map((agent) => agent.installation.resourceId);
  const pages = useQueries({ queries: owned.map((resourceId) => ({
    queryKey: ["platform", "agent-installation-users", resourceId],
    queryFn: () => client.agentInstallationUsers(resourceId),
    retry: false,
  })) });
  const allowlistKey = pages.map((page, index) => page.isSuccess && page.data
    && respondToModeOf(page.data) === AgentRespondToMode.Allowlist ? owned[index] : "").join(",");
  return React.useMemo(() => agentAuthorFacts(directory, new Set(allowlistKey.split(",").filter(Boolean))),
    [directory, allowlistKey]);
}

/** Marks agent-authored rows with the original owner line and the owner-only badge. */
export function withAgentAuthorFacts(message: TimelineMessage, facts: AgentAuthorFacts): TimelineMessage {
  const fact = message.pubkey ? facts.get(normalizePubkey(message.pubkey)) : undefined;
  if (!fact) return message;
  return { ...message, isAgent: true, ownerLabel: fact.ownerLabel, ownerPubkey: fact.ownerPubkey,
    ...(fact.respondTo ? { respondTo: fact.respondTo } : {}) };
}

/** The same directory as the DD-148 prefix host. */
export function agentAddressHost(facts: AgentAuthorFacts): AgentAddressHost {
  return {
    isKnownAgent: (pubkey) => facts.has(normalizePubkey(pubkey)),
    labelFor: (pubkey) => facts.get(normalizePubkey(pubkey))?.displayName ?? null,
  };
}

type AgentAuthorScope = { facts: AgentAuthorFacts; host: AgentAddressHost };
const AgentAuthorFactsContext = React.createContext<AgentAuthorScope | null>(null);

/** Hosts whose rows are rendered deep in shared timelines provide the facts once (Desktop). */
export function AgentAuthorFactsProvider({ facts, children }: { facts: AgentAuthorFacts; children: React.ReactNode }) {
  const scope = React.useMemo(() => ({ facts, host: agentAddressHost(facts) }), [facts]);
  return <AgentAuthorFactsContext.Provider value={scope}>{children}</AgentAuthorFactsContext.Provider>;
}

export function useAgentAuthorScope(): AgentAuthorScope | null {
  return React.useContext(AgentAuthorFactsContext);
}
