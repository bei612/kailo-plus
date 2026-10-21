// DD-131(1): the caller's discoverable teams for "@team" in a channel composer, expanded only
// through the channel's admitted Installation directory (teamMentionCandidates.ts). A failed team
// read offers no team rows; it never blocks ordinary mentions.
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { BffClient } from "../../../../../client";
import { loadAgentTeams } from "../../../../agent-library/teamPersonas";
import type { ComposerAgent } from "../lib/composerAgentDirectory";
import { buildTeamMentionCandidates } from "../lib/teamMentionCandidates";
import type { MentionSuggestion } from "./MentionAutocomplete";

export function useTeamMentionCandidates(
  client: BffClient,
  scope: { principal?: string; workspaceId?: string },
  agents: readonly ComposerAgent[] | undefined,
  enabled: boolean,
): MentionSuggestion[] {
  const query = useQuery({
    queryKey: ["platform", "agent-team-mentions", scope.principal, scope.workspaceId],
    enabled: enabled && Boolean(scope.workspaceId),
    retry: false,
    staleTime: 30_000,
    queryFn: () => loadAgentTeams(client),
  });
  const teams = enabled && query.isSuccess ? query.data : undefined;
  return React.useMemo(() => teams && agents && agents.length > 0 ? buildTeamMentionCandidates(teams, agents) : [], [teams, agents]);
}
