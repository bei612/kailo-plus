// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/ui/AgentsView.tsx composition of
// the Teams section, team dialogs, the community catalog, snapshot export/import and persona sharing
// (DD-131, SF-BUZ-60). Shared by Web and Desktop; only AgentSnapshotHost differs per host.
import * as React from "react";
import { ResourceState, type AgentDefinitionView } from "@client-kit/contracts";
import { useBffClient, useCurrentPrincipalId, useUiT } from "../context";
import { useGovernedChannelAction } from "../channel-management-actions";
import { consumePendingSnapshotImport, subscribeSnapshotImport } from "../open-snapshot-import-event";
import { agentActionOutcomeText } from "./agentActionOutcome";
import { AddTeamToChannelDialog } from "./AddTeamToChannelDialog";
import { AgentSnapshotExportDialog } from "./AgentSnapshotExportDialog";
import { AgentSnapshotImportDialog } from "./AgentSnapshotImportDialog";
import { CommunityCatalogDialog } from "./CommunityCatalogDialog";
import { PersonaShareDialog } from "./PersonaShareDialog";
import { TeamDeleteDialog } from "./TeamDeleteDialog";
import { TeamDialog } from "./TeamDialog";
import { TeamShareDialog } from "./TeamShareDialog";
import { TeamSnapshotExportDialog } from "./TeamSnapshotExportDialog";
import { TeamSnapshotImportDialog } from "./TeamSnapshotImportDialog";
import { TeamsSection } from "./TeamsSection";
import { useTeamActions } from "./useTeamActions";
import { snapshotMediaType, type SnapshotKind } from "./snapshotFlow";
import type { AgentSnapshotHost } from "./agentSnapshotHost";

export type AgentTeamsLibraryProps = {
  host: AgentSnapshotHost;
  /** The page's refresh revision: a refresh re-reads teams and the agent directory. */
  refreshRevision: number;
  /** A recorded import or copy changed the Agents directory. */
  onDirectoryChanged: () => void;
  /** The governed create entry of the Agents page (catalog "Create agent"). */
  onCreateAgent: () => void;
  /** The Definition whose original "Share" dialog is open (from its card menu). */
  shareDefinition: AgentDefinitionView | null;
  onShareDefinitionChange: (definition: AgentDefinitionView | null) => void;
};

async function readFile(file: File) {
  return { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name, mediaType: file.type || snapshotMediaType(file.name) };
}

export function AgentTeamsLibrary({ host, refreshRevision, onDirectoryChanged, onCreateAgent, shareDefinition, onShareDefinitionChange }: AgentTeamsLibraryProps) {
  const t = useUiT();
  const client = useBffClient();
  const principalId = useCurrentPrincipalId();
  const teams = useTeamActions(refreshRevision);
  const teamImportInputRef = React.useRef<HTMLInputElement | null>(null);
  const [catalogLaunchTarget, setCatalogLaunchTarget] = React.useState<"agents" | "teams" | null>(null);
  const [definitionToExport, setDefinitionToExport] = React.useState<AgentDefinitionView | null>(null);
  const [shareTarget, setShareTarget] = React.useState<AgentDefinitionView | null>(shareDefinition);
  const canMoveBytes = client.supportsSnapshotBytes;
  React.useEffect(() => { setShareTarget(shareDefinition); }, [shareDefinition]);

  const definitionShare = useGovernedChannelAction((command) => {
    const resourceId = command.resourceId;
    if (resourceId) void client.agentDefinition(resourceId).then((definition) => {
      setShareTarget((current) => current?.resourceId === definition.resourceId ? definition : current);
    }, () => undefined);
    onDirectoryChanged();
    teams.reload();
  });

  const importRef = React.useRef(teams.handleImportSnapshotFile);
  importRef.current = teams.handleImportSnapshotFile;
  const handleImport = React.useCallback((file: { bytes: Uint8Array<ArrayBuffer>; fileName: string; mediaType: string }, kind?: SnapshotKind) => {
    void importRef.current(file, kind);
  }, []);

  // A snapshot card in a message asked for this import (original AgentsView mount/subscribe).
  React.useEffect(() => {
    if (!canMoveBytes) return;
    const take = (payload: { fileBytes: Uint8Array<ArrayBuffer>; fileName: string; snapshotKind: SnapshotKind }) =>
      handleImport({ bytes: payload.fileBytes, fileName: payload.fileName, mediaType: snapshotMediaType(payload.fileName) }, payload.snapshotKind);
    const pending = consumePendingSnapshotImport();
    if (pending) take(pending);
    return subscribeSnapshotImport(take);
  }, [canMoveBytes, handleImport]);

  function openCommunityCatalog(target: "agents" | "teams") {
    teams.setNotice(null);
    teams.reload();
    setCatalogLaunchTarget(target);
  }

  const reloadAll = () => { teams.reload(); onDirectoryChanged(); };
  const isOwner = (ownerPrincipalId: string) => principalId !== undefined && ownerPrincipalId === principalId;
  const teamsError = teams.teamsState.status === "error" || teams.definitionsState.status === "error" ? t("platform.loadFailed") : null;

  return (
    <>
      <TeamsSection
        canImport={canMoveBytes}
        currentPrincipalId={principalId}
        definitions={teams.definitions}
        error={teamsError}
        isLoading={teams.teamsState.status === "pending" || teams.definitionsState.status === "pending"}
        isPending={teams.isPending}
        onAddToChannel={teams.setTeamToAddToChannel}
        onCreate={teams.openCreateDialog}
        onDelete={(team) => { teams.remove.dismiss(); teams.setTeamToDelete(team); }}
        onDiscover={() => openCommunityCatalog("teams")}
        onDuplicate={teams.openDuplicateDialog}
        onEdit={teams.openEditDialog}
        onImport={() => teamImportInputRef.current?.click()}
        onRetry={teams.reload}
        onShare={(team) => { teams.share.dismiss(); teams.setTeamToShare(team); }}
        teams={teams.teams}
      />
      {teams.notice || teams.importProblem || teams.importing ? (
        <div className="space-y-1 text-sm" data-testid="agent-teams-feedback">
          {teams.notice ? <p role="status">{teams.notice}</p> : null}
          {teams.importing ? <p role="status">{t("agentSnapshots.uploading")}</p> : null}
          {teams.importProblem ? <p className="text-destructive" role="alert">{teams.importProblem}</p> : null}
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
          catalog={isOwner(teams.teamToShare.ownerPrincipalId) ? {
            shared: teams.teamToShare.catalogShared,
            pending: teams.share.busy || teams.share.unknown,
            problem: teams.shareProblem,
            onChange: (shared) => { if (teams.teamToShare) teams.setTeamCatalogShared(teams.teamToShare, shared); },
          } : null}
          host={host}
          isPending={teams.isPending}
          onExport={() => { const team = teams.teamToShare; teams.setTeamToShare(null); if (team) teams.setTeamToExport(team); }}
          onOpenChange={(open) => { if (!open) teams.setTeamToShare(null); }}
          open={teams.teamToShare !== null}
          team={teams.teamToShare}
        />
      ) : null}
      {teams.teamToExport ? (
        <TeamSnapshotExportDialog
          onOpenChange={(open) => { if (!open) teams.setTeamToExport(null); }}
          onSaveFile={host.saveExportPackage}
          open={teams.teamToExport !== null}
          team={teams.teamToExport}
        />
      ) : null}

      {shareTarget ? (
        <PersonaShareDialog
          catalog={isOwner(shareTarget.ownerPrincipalId) ? {
            shared: shareTarget.catalogShared === true,
            pending: definitionShare.busy || definitionShare.unknown,
            problem: definitionShare.outcome ? agentActionOutcomeText(t, definitionShare.outcome) : null,
            onChange: (shared) => {
              if (definitionShare.unknown) { void definitionShare.submit(); return; }
              void definitionShare.submit({ actionKey: shared ? "agent.definition.share" : "agent.definition.unshare",
                resourceId: shareTarget.resourceId, resourceVersion: shareTarget.resourceVersion, explicitConfirmation: true });
            },
          } : null}
          definition={shareTarget}
          displayName={shareTarget.displayName}
          host={host}
          isPending={false}
          onExport={() => { const target = shareTarget; onShareDefinitionChange(null); setDefinitionToExport(target); }}
          onOpenChange={(open) => { if (!open) { definitionShare.dismiss(); onShareDefinitionChange(null); } }}
          open={shareTarget !== null}
        />
      ) : null}
      {definitionToExport ? (
        <AgentSnapshotExportDialog
          agentName={definitionToExport.displayName}
          definition={definitionToExport}
          onOpenChange={(open) => { if (!open) setDefinitionToExport(null); }}
          onSaveFile={host.saveExportPackage}
          open={definitionToExport !== null}
        />
      ) : null}

      {teams.snapshotImportState?.kind === "agent" ? (
        <AgentSnapshotImportDialog
          onImported={reloadAll}
          onOpenChange={(open) => { if (!open) teams.setSnapshotImportState(null); }}
          open
          preview={teams.snapshotImportState.preview}
        />
      ) : null}
      {teams.snapshotImportState?.kind === "team" ? (
        <TeamSnapshotImportDialog
          onImported={reloadAll}
          onOpenChange={(open) => { if (!open) teams.setSnapshotImportState(null); }}
          open
          preview={teams.snapshotImportState.preview}
        />
      ) : null}

      {catalogLaunchTarget !== null ? (
        <CommunityCatalogDialog
          definitions={teams.definitions}
          definitionsError={teams.definitionsState.status === "error" ? t("platform.loadFailed") : null}
          definitionsLoading={teams.definitionsState.status === "pending"}
          onChanged={reloadAll}
          onCreateAgent={onCreateAgent}
          onImportFile={canMoveBytes ? (file) => { void readFile(file).then((read) => handleImport(read, "agent")); } : null}
          onOpenChange={(open) => { if (!open) setCatalogLaunchTarget(null); }}
          open={catalogLaunchTarget !== null}
          preferSection={catalogLaunchTarget}
          teams={teams.teams}
          teamsError={teams.teamsState.status === "error" ? t("platform.loadFailed") : null}
          teamsLoading={teams.teamsState.status === "pending"}
        />
      ) : null}

      {canMoveBytes ? (
        <input
          accept=".team.json,.team.png"
          className="hidden"
          data-testid="team-snapshot-import-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void readFile(file).then((read) => handleImport(read, "team"));
          }}
          ref={teamImportInputRef}
          type="file"
        />
      ) : null}
    </>
  );
}
