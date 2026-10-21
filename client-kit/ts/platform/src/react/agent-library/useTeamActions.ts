// Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/ui/useTeamActions.ts.
// The original local mutations become governed Core actions (DD-131(1)(3)(6)); the dialog state
// machine, copy and the create/duplicate/edit/delete/share/export/import entry points are kept.
// Every write freezes its command with an idempotency key; an unknown outcome keeps the dialog on
// that same request. Directories are re-read after every recorded change (never optimistic).
import * as React from "react";
import type { AgentDefinitionView, AgentSnapshotUploadView, AgentTeamView, WorkspaceView } from "@client-kit/contracts";
import { useBffClient, useFailureText, useUiT } from "../context";
import { useGovernedChannelAction } from "../channel-management-actions";
import { useLoad } from "../use-load";
import { agentActionOutcomeText } from "./agentActionOutcome";
import { loadAgentDirectory, loadAgentTeams, MAX_TEAM_MEMBERS } from "./teamPersonas";
import { snapshotKindFromFileName, uploadSnapshotFile, type SnapshotFile, type SnapshotKind } from "./snapshotFlow";
import type { TeamDialogValues, TeamSubmitInput } from "./TeamDialog";
import type { TeamDeployResult } from "./teamDeploy";
import { writeFailure } from "../../transport";

type TeamDialogState = {
  description: string;
  initialValues: TeamDialogValues;
  submitLabel: string;
  title: string;
} | null;

export type SnapshotImportState = { kind: SnapshotKind; fileName: string; preview: AgentSnapshotUploadView } | null;

export function useTeamActions(refreshRevision: number) {
  const client = useBffClient();
  const t = useUiT();
  const failureText = useFailureText();
  const [revision, setRevision] = React.useState(0);
  const key = `${refreshRevision}:${revision}`;
  const [teamsState, reloadTeams] = useLoad(`agent-teams:${key}`, () => loadAgentTeams(client));
  const [definitionsState, reloadDefinitions] = useLoad(`agent-team-directory:${key}`, () => loadAgentDirectory(client));
  const reload = React.useCallback(() => setRevision((value) => value + 1), []);

  const teams: AgentTeamView[] = teamsState.status === "ok" ? teamsState.data : [];
  const definitions: AgentDefinitionView[] = definitionsState.status === "ok" ? definitionsState.data : [];

  const [teamDialogState, setTeamDialogState] = React.useState<TeamDialogState>(null);
  const [teamToDelete, setTeamToDelete] = React.useState<AgentTeamView | null>(null);
  const [teamToAddToChannel, setTeamToAddToChannel] = React.useState<AgentTeamView | null>(null);
  const [teamToExport, setTeamToExport] = React.useState<AgentTeamView | null>(null);
  const [teamToShare, setTeamToShare] = React.useState<AgentTeamView | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [snapshotImportState, setSnapshotImportState] = React.useState<SnapshotImportState>(null);
  const [importProblem, setImportProblem] = React.useState<string | null>(null);
  const [importing, setImporting] = React.useState(false);

  const save = useGovernedChannelAction((command) => {
    setTeamDialogState(null);
    setNotice(t(command.actionKey === "agent.team.update" ? "agentTeams.updated" : "agentTeams.created", { name: command.agentTeam?.name ?? "" }));
    reload();
  });
  const remove = useGovernedChannelAction(() => {
    const name = teamToDelete?.name ?? "";
    setTeamToDelete(null);
    setNotice(t("agentTeams.deleted", { name }));
    reload();
  });
  const share = useGovernedChannelAction((command) => {
    // Re-read the team: the open share dialog must not keep a stale version or flag.
    const resourceId = command.resourceId;
    if (resourceId) void client.agentTeam(resourceId).then((team) => {
      setTeamToShare((current) => current?.resourceId === team.resourceId ? team : current);
    }, () => undefined);
    reload();
  });

  function clearFeedback() { setNotice(null); }

  function openCreateDialog() {
    clearFeedback(); save.dismiss();
    setTeamDialogState({ title: t("agentTeams.create"), description: t("agentTeams.createDescription"), submitLabel: t("agentTeams.create"),
      initialValues: { name: "", description: "", memberAgentResourceIds: [] } });
  }
  function openDuplicateDialog(team: AgentTeamView) {
    clearFeedback(); save.dismiss();
    setTeamDialogState({ title: t("agentTeams.duplicateTitle", { name: team.name }), description: t("agentTeams.duplicateDescription"),
      submitLabel: t("agentTeams.create"),
      initialValues: { name: t("agentTeams.copyName", { name: team.name }), description: team.description ?? "", memberAgentResourceIds: [...team.memberAgentResourceIds] } });
  }
  function openEditDialog(team: AgentTeamView) {
    clearFeedback(); save.dismiss();
    setTeamDialogState({ title: t("agentTeams.editTitle"), description: "", submitLabel: t("agentTeams.saveChanges"),
      initialValues: { resourceId: team.resourceId, resourceVersion: team.resourceVersion, name: team.name, description: team.description ?? "",
        memberAgentResourceIds: [...team.memberAgentResourceIds] } });
  }

  function handleTeamSubmit(input: TeamSubmitInput) {
    const agentTeam = {
      name: input.name.trim(),
      ...(input.description.trim() ? { description: input.description.trim() } : {}),
      memberAgentResourceIds: input.memberAgentResourceIds.slice(0, MAX_TEAM_MEMBERS),
    };
    void save.submit(input.resourceId
      ? { actionKey: "agent.team.update", resourceId: input.resourceId, resourceVersion: input.resourceVersion, agentTeam, explicitConfirmation: true }
      : { actionKey: "agent.team.create", agentTeam, explicitConfirmation: true });
  }

  function handleDeleteTeam(team: AgentTeamView) {
    if (remove.unknown) { void remove.submit(); return; }
    void remove.submit({ actionKey: "agent.team.delete", resourceId: team.resourceId, resourceVersion: team.resourceVersion, explicitConfirmation: true });
  }

  function setTeamCatalogShared(team: AgentTeamView, shared: boolean) {
    if (share.unknown) { void share.submit(); return; }
    void share.submit({ actionKey: shared ? "agent.team.share" : "agent.team.unshare", resourceId: team.resourceId,
      resourceVersion: team.resourceVersion, explicitConfirmation: true });
  }

  function handleTeamDeployed(channel: WorkspaceView, results: TeamDeployResult[]) {
    const submitted = results.filter((result) => result.outcome === "submitted").length;
    setNotice(t("agentTeams.deployedNotice", { count: submitted, total: results.length, channel: channel.name }));
  }

  /** Upload one snapshot file for Core's preview; the import dialog opens on a valid preview. */
  async function handleImportSnapshotFile(file: SnapshotFile, expected?: SnapshotKind) {
    const kind = snapshotKindFromFileName(file.fileName);
    setImportProblem(null);
    if (!kind || (expected && kind !== expected)) { setImportProblem(t("agentSnapshots.unsupportedFile")); return; }
    setImporting(true);
    try {
      const preview = await uploadSnapshotFile(client, file, kind);
      setSnapshotImportState({ kind, fileName: file.fileName, preview });
    } catch (error) {
      const failed = writeFailure(error);
      setImportProblem(failed.kind === "unknown" ? t("agentSnapshots.uploadUnknown") : t("agentSnapshots.uploadRejected", { reason: failureText(failed) }));
    } finally {
      setImporting(false);
    }
  }

  const saveProblem = save.outcome && (save.outcome.kind === "unknown" || save.outcome.kind === "rejected" || save.outcome.kind === "aborted")
    ? agentActionOutcomeText(t, save.outcome) : null;
  const deleteProblem = remove.outcome && (remove.outcome.kind === "unknown" || remove.outcome.kind === "rejected" || remove.outcome.kind === "aborted")
    ? agentActionOutcomeText(t, remove.outcome) : null;
  const shareProblem = share.outcome ? agentActionOutcomeText(t, share.outcome) : null;

  return {
    teams, definitions, teamsState, definitionsState, reload, reloadTeams, reloadDefinitions,
    teamDialogState, setTeamDialogState, teamToDelete, setTeamToDelete, teamToAddToChannel, setTeamToAddToChannel,
    teamToExport, setTeamToExport, teamToShare, setTeamToShare, notice, setNotice,
    save, remove, share, saveProblem, deleteProblem, shareProblem,
    openCreateDialog, openDuplicateDialog, openEditDialog, handleTeamSubmit, handleDeleteTeam, setTeamCatalogShared, handleTeamDeployed,
    snapshotImportState, setSnapshotImportState, importProblem, setImportProblem, importing, handleImportSnapshotFile,
    isPending: save.busy || remove.busy || share.busy || importing,
  };
}
