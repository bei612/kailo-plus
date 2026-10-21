// Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/lib/teamPersonas.ts
// and desktop/src/features/agents/ui/teamDialogSelection.ts; members are same-Tenant AgentDefinitions
// (DD-131(1)), not local personas. The team view lists only the members the reader can discover;
// the rest are `hiddenMemberCount`, which never resolves and never grants anything.
import { ResourceState, type AgentDefinitionView, type AgentTeamView } from "@client-kit/contracts";
import type { BffClient } from "../../client";
import { TransportError } from "../../transport";

/** Original team catalog member limit, kept by `agent.team.create/update`. */
export const MAX_TEAM_MEMBERS = 64;

export type ResolvedTeamMembers = {
  hasMissingMembers: boolean;
  isComplete: boolean;
  isUsable: boolean;
  /** Visible members the caller can no longer resolve (not ACTIVE or not in the directory). */
  missingMemberCount: number;
  missingMemberIds: string[];
  /** Members the reader cannot discover; counted, never named. */
  hiddenMemberCount: number;
  resolvedMemberIds: string[];
  resolvedMembers: AgentDefinitionView[];
};

export function emptyResolvedTeamMembers(): ResolvedTeamMembers {
  return { hasMissingMembers: false, isComplete: true, isUsable: false, missingMemberCount: 0, missingMemberIds: [],
    hiddenMemberCount: 0, resolvedMemberIds: [], resolvedMembers: [] };
}

export function resolveTeamMembers(
  team: Pick<AgentTeamView, "memberAgentResourceIds" | "hiddenMemberCount">,
  definitions: readonly AgentDefinitionView[],
): ResolvedTeamMembers {
  const byId = new Map(definitions.map((definition) => [definition.resourceId, definition]));
  const resolvedMembers: AgentDefinitionView[] = [];
  const missingMemberIds: string[] = [];
  for (const id of team.memberAgentResourceIds) {
    const definition = byId.get(id);
    if (definition && definition.resourceState === ResourceState.Active) resolvedMembers.push(definition);
    else missingMemberIds.push(id);
  }
  const missingMemberCount = missingMemberIds.length;
  return {
    hasMissingMembers: missingMemberCount > 0,
    isComplete: missingMemberCount === 0,
    isUsable: missingMemberCount === 0 && resolvedMembers.length > 0,
    missingMemberCount,
    missingMemberIds,
    hiddenMemberCount: team.hiddenMemberCount,
    resolvedMemberIds: resolvedMembers.map((definition) => definition.resourceId),
    resolvedMembers,
  };
}

// Original teamDialogSelection helpers over Definition IDs.
export function copySelectedMemberIds(ids: readonly string[]): string[] {
  return [...ids];
}

export function countMissingMemberIds(ids: readonly string[], definitions: readonly AgentDefinitionView[]): number {
  const available = new Set(definitions.map((definition) => definition.resourceId));
  return ids.filter((id) => !available.has(id)).length;
}

export function filterAvailableMemberIds(ids: readonly string[], definitions: readonly AgentDefinitionView[]): string[] {
  const available = new Set(definitions.map((definition) => definition.resourceId));
  return ids.filter((id) => available.has(id));
}

export function orderDefinitionsByInitiallySelected(
  definitions: readonly AgentDefinitionView[],
  initialSelectedIds: readonly string[],
): AgentDefinitionView[] {
  const selected = new Set(initialSelectedIds);
  return [...definitions.filter((definition) => selected.has(definition.resourceId)),
    ...definitions.filter((definition) => !selected.has(definition.resourceId))];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A team view as DD-131 defines it; anything else is not rendered as a team. */
export function validAgentTeam(team: AgentTeamView): boolean {
  return !!team && typeof team.resourceId === "string" && UUID.test(team.resourceId)
    && typeof team.name === "string" && !!team.name.trim()
    && (team.description === undefined || typeof team.description === "string")
    && Array.isArray(team.memberAgentResourceIds) && team.memberAgentResourceIds.length <= MAX_TEAM_MEMBERS
    && team.memberAgentResourceIds.every((id) => typeof id === "string" && UUID.test(id))
    && new Set(team.memberAgentResourceIds).size === team.memberAgentResourceIds.length
    && Number.isSafeInteger(team.hiddenMemberCount) && team.hiddenMemberCount >= 0
    && typeof team.ownerPrincipalId === "string" && !!team.ownerPrincipalId
    && Number.isSafeInteger(team.resourceVersion) && team.resourceVersion > 0
    && team.resourceState === ResourceState.Active && typeof team.catalogShared === "boolean";
}

/** Every team page the caller can discover, in Core order; a bad page or cursor fails the read. */
export async function loadAgentTeams(client: Pick<BffClient, "agentTeams">): Promise<AgentTeamView[]> {
  const teams: AgentTeamView[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (;;) {
    const page = await client.agentTeams(offset);
    if (!page || !Array.isArray(page.teams) || !page.teams.every(validAgentTeam)) throw new TransportError("Agent teams unavailable");
    for (const team of page.teams) {
      if (seen.has(team.resourceId)) throw new TransportError("Agent team page mismatch");
      seen.add(team.resourceId);
      teams.push(team);
    }
    if (page.nextOffset == null) return teams;
    if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset) throw new TransportError("Agent team cursor mismatch");
    offset = page.nextOffset;
  }
}

/** Every Definition the caller can discover (all pages), for member names and the member picker. */
export async function loadAgentDirectory(client: Pick<BffClient, "agentDefinitions">): Promise<AgentDefinitionView[]> {
  const definitions: AgentDefinitionView[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (;;) {
    const page = await client.agentDefinitions(offset);
    if (!page || !Array.isArray(page.definitions)) throw new TransportError("Agent catalog unavailable");
    for (const definition of page.definitions) {
      if (!definition?.resourceId || seen.has(definition.resourceId)) throw new TransportError("Agent catalog mismatch");
      seen.add(definition.resourceId);
      definitions.push(definition);
    }
    if (page.nextOffset == null) return definitions;
    if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset) throw new TransportError("Agent catalog cursor mismatch");
    offset = page.nextOffset;
  }
}
