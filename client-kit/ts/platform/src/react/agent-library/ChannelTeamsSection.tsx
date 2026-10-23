// Reused from Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/channels/ui/AddChannelBotTeamsSection.tsx: the "Teams" block of the
// channel's add-agent dialog. In the original, a team chip toggled all its personas into the
// pending selection; in Kailo each member is its own governed `agent.installation.create`
// (DD-131(1)), so a team chip opens the same per-member deploy dialog as the Agents page, already
// pointed at this channel. Like the original, nothing is shown while loading or without teams.
import * as React from "react";
import { Users } from "lucide-react";

import type { AgentDefinitionView, AgentTeamView } from "@client-kit/contracts";
import { useBffClient, useUiT } from "../context";
import { useLoad } from "../use-load";
import { AddTeamToChannelDialog } from "./AddTeamToChannelDialog";
import { IdentityInitialsAvatar } from "./IdentityInitialsAvatar";
import { loadAgentDirectory, loadAgentTeams, resolveTeamMembers } from "./teamPersonas";

const MAX_AVATARS = 3;

export function ChannelTeamsSection({ workspaceId, disabled = false, onDeployed }: {
  workspaceId: string;
  disabled?: boolean;
  onDeployed?: () => void;
}) {
  const t = useUiT();
  const client = useBffClient();
  const [data] = useLoad(`channel-teams:${workspaceId}`, async () => {
    const [teams, definitions] = await Promise.all([loadAgentTeams(client), loadAgentDirectory(client)]);
    return { teams, definitions };
  });
  const [team, setTeam] = React.useState<AgentTeamView | null>(null);
  if (data.status !== "ok" || data.data.teams.length === 0) return null;
  const definitions: AgentDefinitionView[] = data.data.definitions;
  return (
    <div className="flex flex-col gap-3" data-testid="channel-teams-section">
      <div>
        <div className="text-sm font-medium">{t("agentTeams.channelSection.title")}</div>
        <p className="text-xs text-muted-foreground">{t("agentTeams.channelSection.hint")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {data.data.teams.map((row) => {
          const members = resolveTeamMembers(row, definitions).resolvedMembers;
          return (
            <button
              aria-label={t("agentTeams.channelSection.add", { name: row.name })}
              className="inline-flex min-h-9 items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              data-testid={`channel-team-${row.resourceId}`}
              disabled={disabled || members.length === 0}
              key={row.resourceId}
              onClick={() => setTeam(row)}
              type="button"
            >
              <Users className="h-4 w-4" />
              <span className="truncate">{row.name}</span>
              <span className="flex -space-x-1.5">
                {members.slice(0, MAX_AVATARS).map((member, index) => (
                  <span className="h-5 w-5" key={member.resourceId}>
                    <IdentityInitialsAvatar className="border-0 text-2xs shadow-none" colorIndex={index} label={member.displayName} size={20} />
                  </span>
                ))}
              </span>
              <span className="text-xs text-muted-foreground">{t("agentTeams.agentsCount", { count: members.length })}</span>
            </button>
          );
        })}
      </div>
      <AddTeamToChannelDialog
        channelId={workspaceId}
        definitions={definitions}
        onDeployed={() => onDeployed?.()}
        onOpenChange={(open) => { if (!open) setTeam(null); }}
        open={team !== null}
        team={team}
      />
    </div>
  );
}
