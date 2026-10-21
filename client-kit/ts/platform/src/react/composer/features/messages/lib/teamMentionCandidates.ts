// Reused from Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/lib/mentionCandidates.ts::{buildTeamMentionCandidates,formatTeamMention}.
// DD-131(1): "@team" expands, in the composer, into ordinary mentions of the members' Installations
// in this channel; each mention is still admitted by `agent.invoke` on its own. Members are resolved
// only through the channel's admitted Installation directory (never a profile or kind:0 flag). A
// member without an Installation in this channel is not expanded; a team with no expandable member
// is not offered.
import type { AgentTeamView } from "@client-kit/contracts";
import type { MentionSuggestion } from "../ui/MentionAutocomplete";
import type { ComposerAgent } from "./composerAgentDirectory";

export type TeamMentionMember = {
  displayName: string;
  kind: "identity";
  pubkey: string;
};

/** A team row's sentinel key: not a hex public key, so it never binds a mention by itself. */
export function teamMentionKey(teamId: string): string {
  return `team:${teamId}`;
}

export function isTeamMentionSuggestion(suggestion: Pick<MentionSuggestion, "kind" | "teamMembers">): boolean {
  return suggestion.kind === "team" && Array.isArray(suggestion.teamMembers);
}

/** Autocomplete rows for the caller's discoverable teams in one channel. */
export function buildTeamMentionCandidates(
  teams: readonly AgentTeamView[],
  agents: readonly Pick<ComposerAgent, "pubkey" | "displayName" | "installation">[],
): MentionSuggestion[] {
  const byDefinition = new Map<string, Pick<ComposerAgent, "pubkey" | "displayName">>();
  for (const agent of agents) {
    const definitionId = agent.installation.agentResourceId;
    // Directory order decides when one Definition has several Installations in the channel.
    if (definitionId && !byDefinition.has(definitionId)) byDefinition.set(definitionId, agent);
  }
  return teams.flatMap((team) => {
    const name = team.name.trim();
    if (!name) return [];
    const teamMembers: TeamMentionMember[] = [];
    const seen = new Set<string>();
    for (const memberId of team.memberAgentResourceIds) {
      const agent = byDefinition.get(memberId);
      if (!agent || seen.has(agent.pubkey)) continue;
      seen.add(agent.pubkey);
      teamMembers.push({ displayName: agent.displayName.trim() || agent.pubkey, kind: "identity", pubkey: agent.pubkey });
    }
    // Every member carries its exact key, so same-name members are told apart at selection time
    // (selectedMentionLabel), as the original allows for keyed members.
    if (teamMembers.length === 0) return [];
    return [{
      kind: "team" as const,
      teamId: team.resourceId,
      teamMembers,
      pubkey: teamMentionKey(team.resourceId),
      displayName: name,
      isAgent: false,
    }];
  });
}

/** Original insertion text: `Team(@Member @Member) `. */
export function formatTeamMention(teamName: string, members: readonly Pick<TeamMentionMember, "displayName">[]) {
  return `${teamName}(${members.map((member) => `@${member.displayName}`).join(" ")}) `;
}
