// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/ui/AgentsView.tsx composition of
// the Teams section and its dialogs (DD-131(1)(6), SF-BUZ-60). Shared by Web and Desktop: every read
// and write goes through the governed BFF client of the host.
import { ResourceState } from "@client-kit/contracts";
import { useRef, useState } from "react";
import { useCurrentPrincipalId, useUiT } from "../context";
import { AddTeamToChannelDialog } from "./AddTeamToChannelDialog";
import { TeamDeleteDialog } from "./TeamDeleteDialog";
import { TeamDialog } from "./TeamDialog";
import { TeamShareDialog } from "./TeamShareDialog";
import type { SnapshotExportHost } from "./AgentSnapshotExportDialog";
import { TeamSnapshotExportDialog, type TeamSnapshotExportTarget } from "./TeamSnapshotExportDialog";
import { TeamSnapshotImportDialog, teamSnapshotSource, type TeamSnapshotSource } from "./TeamSnapshotImportDialog";
import { TeamsSection } from "./TeamsSection";
import { useTeamActions } from "./useTeamActions";

export type AgentTeamsLibraryProps = {
  /** The page's refresh revision: a refresh re-reads teams and the agent directory. */
  refreshRevision: number;
  /** Another Agents-page dialog holds a write: team entry points stay closed meanwhile. */
  locked?: boolean;
  /** DD-131(3)：READY 团队导出包的保存方式；缺省为同源受授权下载。 */
  snapshotExportHost?: SnapshotExportHost;
  /** DD-131(6): the host's catalog dialog, opened on its Teams list. */
  onDiscover?: () => void;
};

export function AgentTeamsLibrary({ refreshRevision, locked = false, onDiscover, snapshotExportHost }: AgentTeamsLibraryProps) {
  const t = useUiT();
  const principalId = useCurrentPrincipalId();
  const teams = useTeamActions(refreshRevision);
  // DD-131(3): original "Import team snapshot" from a local .team.json/.team.png file, and "Export".
  const importInput = useRef<HTMLInputElement>(null);
  const [importSource, setImportSource] = useState<TeamSnapshotSource | null>(null);
  const [importError, setImportError] = useState<"teamSnapshot.unsupportedFile" | "teamSnapshot.fileTooLarge" | null>(null);
  const [exportTarget, setExportTarget] = useState<TeamSnapshotExportTarget | null>(null);
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
        onDiscover={onDiscover}
        onDuplicate={teams.openDuplicateDialog}
        onEdit={teams.openEditDialog}
        onImport={() => { setImportError(null); importInput.current?.click(); }}
        onRetry={teams.reload}
        onShare={(team) => { teams.share.dismiss(); teams.setTeamToShare(team); }}
        teams={teams.teams}
      />
      <input ref={importInput} type="file" hidden accept=".json,.png,application/json,image/png" data-testid="team-import-file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          void file.arrayBuffer().then((buffer) => {
            const next = teamSnapshotSource(file.name, new Uint8Array(buffer));
            if (next === "unsupported") setImportError("teamSnapshot.unsupportedFile");
            else if (next === "tooLarge") setImportError("teamSnapshot.fileTooLarge");
            else setImportSource(next);
          }, () => setImportError("teamSnapshot.unsupportedFile"));
        }} />
      {importError ? <p className="text-sm text-danger-text" role="alert" data-testid="team-import-error">{t(importError)}</p> : null}
      <TeamSnapshotImportDialog source={importSource} onClose={() => setImportSource(null)} onImported={teams.reload} />
      <TeamSnapshotExportDialog target={exportTarget} host={snapshotExportHost} onClose={() => setExportTarget(null)} />
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
          onExport={() => {
            const team = teams.teamToShare;
            if (!team) return;
            teams.share.dismiss(); teams.setTeamToShare(null);
            setExportTarget({ resourceId: team.resourceId, resourceVersion: team.resourceVersion, name: team.name });
          }}
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
