// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/ui/AgentsView.tsx composition of
// the Teams section and its dialogs (DD-131(1)(6), SF-BUZ-60). Shared by Web and Desktop: every read
// and write goes through the governed BFF client of the host.
import { ResourceState } from "@client-kit/contracts";
import { useCurrentPrincipalId } from "../context";
import { AddTeamToChannelDialog } from "./AddTeamToChannelDialog";
import { TeamDeleteDialog } from "./TeamDeleteDialog";
import { TeamDialog } from "./TeamDialog";
import { TeamShareDialog } from "./TeamShareDialog";
import { TeamsSection } from "./TeamsSection";
import { useTeamActions } from "./useTeamActions";

export type AgentTeamsLibraryProps = {
  /** The page's refresh revision: a refresh re-reads teams and the agent directory. */
  refreshRevision: number;
  /** Another Agents-page dialog holds a write: team entry points stay closed meanwhile. */
  locked?: boolean;
};

export function AgentTeamsLibrary({ refreshRevision, locked = false }: AgentTeamsLibraryProps) {
  const principalId = useCurrentPrincipalId();
  const teams = useTeamActions(refreshRevision);
  const isOwner = (ownerPrincipalId: string) => principalId !== undefined && ownerPrincipalId === principalId;
  const teamsError = teams.teamsState.status === "error" ? teams.teamsState.error
    : teams.definitionsState.status === "error" ? teams.definitionsState.error : undefined;

  return (
    <>
      <TeamsSection
        currentPrincipalId={principalId}
        definitions={teams.definitions}
        error={teamsError}
        hasError={teams.teamsState.status === "error" || teams.definitionsState.status === "error"}
        isLoading={teams.teamsState.status === "pending" || teams.definitionsState.status === "pending"}
        isPending={teams.isPending || locked}
        onAddToChannel={teams.setTeamToAddToChannel}
        onCreate={teams.openCreateDialog}
        onDelete={(team) => { teams.remove.dismiss(); teams.setTeamToDelete(team); }}
        onDuplicate={teams.openDuplicateDialog}
        onEdit={teams.openEditDialog}
        onRetry={teams.reload}
        onShare={(team) => { teams.share.dismiss(); teams.setTeamToShare(team); }}
        teams={teams.teams}
      />
      {teams.notice ? (
        <div className="space-y-1 text-sm" data-testid="agent-teams-feedback">
          <p role="status">{teams.notice}</p>
        </div>
      ) : null}

      {teams.teamDialogState ? (
        <TeamDialog
          definitions={teams.definitions.filter((definition) => definition.resourceState === ResourceState.Active)}
          description={teams.teamDialogState.description}
          error={teams.saveProblem}
          initialValues={teams.teamDialogState.initialValues}
          isPending={teams.save.busy}
          onOpenChange={(open) => { if (!open) { teams.save.dismiss(); teams.setTeamDialogState(null); } }}
          onRetry={() => void teams.save.submit()}
          onSubmit={teams.handleTeamSubmit}
          open={teams.teamDialogState !== null}
          submitLabel={teams.teamDialogState.submitLabel}
          title={teams.teamDialogState.title}
          unknown={teams.save.unknown}
        />
      ) : null}
      {teams.teamToDelete ? (
        <TeamDeleteDialog
          onConfirm={teams.handleDeleteTeam}
          onOpenChange={(open) => { if (!open) { teams.remove.dismiss(); teams.setTeamToDelete(null); } }}
          open={teams.teamToDelete !== null}
          pending={teams.remove.busy}
          problem={teams.deleteProblem}
          team={teams.teamToDelete}
          unknown={teams.remove.unknown}
        />
      ) : null}
      {teams.teamToAddToChannel ? (
        <AddTeamToChannelDialog
          definitions={teams.definitions}
          onDeployed={teams.handleTeamDeployed}
          onOpenChange={(open) => { if (!open) teams.setTeamToAddToChannel(null); }}
          open={teams.teamToAddToChannel !== null}
          team={teams.teamToAddToChannel}
        />
      ) : null}
      {teams.teamToShare ? (
        <TeamShareDialog
          canShare={isOwner(teams.teamToShare.ownerPrincipalId)}
          isPending={teams.share.busy}
          onCatalogShareChange={(shared) => { if (teams.teamToShare) teams.setTeamCatalogShared(teams.teamToShare, shared); }}
          onOpenChange={(open) => { if (!open) { teams.share.dismiss(); teams.setTeamToShare(null); } }}
          open={teams.teamToShare !== null}
          problem={teams.shareProblem}
          team={teams.teamToShare}
          unknown={teams.share.unknown}
        />
      ) : null}
    </>
  );
}
