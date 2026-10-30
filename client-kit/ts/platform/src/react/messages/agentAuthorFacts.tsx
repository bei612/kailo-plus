// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/lib/formatTimelineMessages.ts (ownerPubkey/ownerLabel for agent
// authors), MessageAgentOwner.tsx and ChannelScreen.tsx respondToLookup → MessageRow
// showRespondToIndicator.
// DD-147: (1) every Workspace member sees "managed by <owner>": the facts come from the member-readable
// Agent author directory (Core `/agent-authors`, same admission as the member list, grants nothing),
// not the SpiceDB-read-filtered Installation list; the owner's Workspace key comes from the member
// list so the name opens that member's profile card; (2) only the Installation owner sees the respondTo
// badge, from its own readable use grants; `anyone` is not offered (DD-125(6)), so only allowlist exists.
import * as React from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { AgentRespondToMode, WorkspaceMembershipState, type AgentAuthorDirectory, type WorkspaceMemberView } from "@client-kit/contracts";
import type { BffClient } from "../../client";
import { respondToModeOf } from "../agent-activity/respondTo";
import { normalizePubkey } from "../conversations/pubkey";
import type { TimelineMessage } from "./types";
import type { AgentAddressHost } from "./MessageAgentAddressPrefix";

export type AgentAuthorFact = {
  ownerLabel: string | null;
  ownerPubkey: string | null;
  ownerPrincipalId: string | null;
  displayName: string | null;
  respondTo?: "allowlist";
  /** DD-162: disabled Installation, shown as archived and never offered as a candidate. */
  archived?: boolean;
};
export type AgentAuthorFacts = ReadonlyMap<string, AgentAuthorFact>;

/** The member-readable directory, the Workspace members and the viewer (null until known). */
export type AgentAuthorDirectoryScope = {
  principalId: string | null;
  agents: AgentAuthorDirectory["agents"];
  members: readonly WorkspaceMemberView[];
};

/** Pure projection of the member-readable directory (plus the owner's respondTo modes). */
export function agentAuthorFacts(directory: AgentAuthorDirectoryScope | undefined,
  allowlisted: ReadonlySet<string> = new Set(),
  ownerProfileNames: ReadonlyMap<string, string> = new Map()): AgentAuthorFacts {
  const facts = new Map<string, AgentAuthorFact>();
  if (!directory) return facts;
  for (const agent of directory.agents) {
    const owner = directory.members.find((member) => member.principalId === agent.ownerPrincipalId
      && member.state === WorkspaceMembershipState.Active);
    // Original formatOwnerLabel: the owner's published profile name first — the same name the
    // member profile card shows — then the directory label (Tenant display name).
    const ownerLabel = ownerProfileNames.get(agent.ownerPrincipalId)?.trim()
      || agent.ownerDisplayName?.trim() || null;
    const ownerPubkey = ownerLabel ? owner?.pubkeys[0] ?? null : null;
    facts.set(normalizePubkey(agent.agentPubkey), {
      ownerLabel,
      ownerPubkey,
      ownerPrincipalId: ownerPubkey ? agent.ownerPrincipalId : null,
      displayName: agent.agentDisplayName?.trim() || null,
      ...(allowlisted.has(agent.installationResourceId) ? { respondTo: "allowlist" as const } : {}),
      ...(agent.archived ? { archived: true } : {}),
    });
  }
  return facts;
}

/**
 * The member-readable directory of one Workspace, plus the viewer's own Installations' use pages
 * (owner-only badge). `principalId` is the viewer's Tenant Principal; a host that does not hold it
 * omits it and the platform session supplies it. Null scope reads nothing.
 */
export function useAgentAuthorFacts(
  client: Pick<BffClient, "agentAuthors" | "members" | "agentInstallationUsers" | "session" | "memberProfile">,
  scope: { workspaceId: string; principalId?: string } | null | undefined,
): AgentAuthorFacts {
  const enabled = Boolean(scope);
  const workspaceId = scope?.workspaceId ?? "";
  const session = useQuery({ queryKey: ["platform", "session"], queryFn: () => client.session(),
    enabled: enabled && !scope?.principalId, retry: false });
  const viewer = scope?.principalId ?? session.data?.tenantPrincipalId ?? null;
  const authors = useQuery({ queryKey: ["platform", "agent-authors", workspaceId],
    queryFn: () => client.agentAuthors(workspaceId), enabled, retry: false });
  const members = useQuery({ queryKey: ["platform", "members", workspaceId],
    queryFn: () => client.members(workspaceId), enabled, retry: false });
  const directory = React.useMemo<AgentAuthorDirectoryScope | undefined>(() => enabled && authors.data
    ? { principalId: viewer, agents: authors.data.agents, members: members.data ?? [] } : undefined,
  [enabled, viewer, authors.data, members.data]);
  const owned = (directory?.agents ?? []).filter((agent) => directory?.principalId
    && agent.ownerPrincipalId === directory.principalId).map((agent) => agent.installationResourceId);
  const pages = useQueries({ queries: owned.map((resourceId) => ({
    queryKey: ["platform", "agent-installation-users", resourceId],
    queryFn: () => client.agentInstallationUsers(resourceId),
    retry: false,
  })) });
  // The owner line names each owner the way the member profile card does (published kind:0 name,
  // read through the same authorized member-profile route), not by the Tenant login label.
  const owners = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const agent of directory?.agents ?? []) {
      const member = directory?.members.find((entry) => entry.principalId === agent.ownerPrincipalId
        && entry.state === WorkspaceMembershipState.Active);
      const pubkey = member?.pubkeys[0];
      if (pubkey && !seen.has(agent.ownerPrincipalId)) seen.set(agent.ownerPrincipalId, pubkey);
    }
    return [...seen.entries()];
  }, [directory]);
  const ownerProfiles = useQueries({ queries: owners.map(([principalId, pubkey]) => ({
    queryKey: ["platform", "agent-owner-profile", workspaceId, principalId, pubkey],
    queryFn: () => client.memberProfile(workspaceId, principalId, pubkey),
    retry: false,
    staleTime: 60_000,
  })) });
  const ownerNamesKey = ownerProfiles.map((query, index) => {
    const name = query.isSuccess ? query.data?.displayName?.trim() : "";
    return name ? `${owners[index]![0]}\u0000${name}` : "";
  }).join("\u0001");
  const allowlistKey = pages.map((page, index) => page.isSuccess && page.data
    && respondToModeOf(page.data) === AgentRespondToMode.Allowlist ? owned[index] : "").join(",");
  return React.useMemo(() => {
    const names = new Map(ownerNamesKey.split("\u0001").filter(Boolean)
      .map((entry) => entry.split("\u0000") as [string, string]));
    return agentAuthorFacts(directory, new Set(allowlistKey.split(",").filter(Boolean)), names);
  }, [directory, allowlistKey, ownerNamesKey]);
}

/** Marks agent-authored rows with the original owner line and the owner-only badge. */
export function withAgentAuthorFacts(message: TimelineMessage, facts: AgentAuthorFacts): TimelineMessage {
  const fact = message.pubkey ? facts.get(normalizePubkey(message.pubkey)) : undefined;
  if (!fact) return message;
  return { ...message, isAgent: true, ownerLabel: fact.ownerLabel, ownerPubkey: fact.ownerPubkey,
    ownerPrincipalId: fact.ownerPrincipalId,
    ...(fact.respondTo ? { respondTo: fact.respondTo } : {}),
    ...(fact.archived ? { agentArchived: true } : {}) };
}

/** The same directory as the DD-148 prefix host. */
export function agentAddressHost(facts: AgentAuthorFacts): AgentAddressHost {
  return {
    isKnownAgent: (pubkey) => facts.has(normalizePubkey(pubkey)),
    labelFor: (pubkey) => facts.get(normalizePubkey(pubkey))?.displayName ?? null,
  };
}

/** The owner whose name opens the host's member profile card (DD-147(1)). */
export type AgentOwnerTarget = { principalId: string; pubkey: string; label: string };
export type AgentOwnerRenderer = (owner: AgentOwnerTarget, name: React.ReactNode) => React.ReactNode;

type AgentAuthorScope = { facts: AgentAuthorFacts; host: AgentAddressHost; renderOwner?: AgentOwnerRenderer };
const AgentAuthorFactsContext = React.createContext<AgentAuthorScope | null>(null);

/**
 * Hosts provide the facts once for rows rendered deep in shared timelines, and how the owner's
 * name opens that member's profile card on this host.
 */
export function AgentAuthorFactsProvider({ facts, renderOwner, children }: {
  facts: AgentAuthorFacts; renderOwner?: AgentOwnerRenderer; children: React.ReactNode;
}) {
  const scope = React.useMemo(() => ({ facts, host: agentAddressHost(facts), renderOwner }), [facts, renderOwner]);
  return <AgentAuthorFactsContext.Provider value={scope}>{children}</AgentAuthorFactsContext.Provider>;
}

export function useAgentAuthorScope(): AgentAuthorScope | null {
  return React.useContext(AgentAuthorFactsContext);
}
