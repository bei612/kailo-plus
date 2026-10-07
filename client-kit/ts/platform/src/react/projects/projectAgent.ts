import { ActionDispatchState, AgentInstallationState, AgentRuntimeProjectionState, AgentVersionState, ResourceState, TaskStatus, WorkflowKind,
  type ActionCommand, type ActionSubmission, type AgentInstallationCandidate } from "@client-kit/contracts";
import type { BffClient } from "../../client";
import { taskPhase } from "../../governance";
import { TransportError } from "../../transport";

// The original Coding agent selector uses Persona identity. Kailo fixes an
// existing published Version; it never creates a desktop-local managed Agent.
export function validProjectAgent(value: AgentInstallationCandidate): boolean {
  return !!value && [value.agentResourceId, value.agentVersionAssetId, value.displayName].every(id => typeof id === "string" && !!id)
    && [value.resourceVersion, value.assetVersion, value.ordinal].every(n => Number.isSafeInteger(n) && n > 0);
}

export async function loadProjectAgents(client: Pick<BffClient, "agentDefinitions" | "agentVersion">): Promise<AgentInstallationCandidate[]> {
  const result: AgentInstallationCandidate[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (;;) {
    const page = await client.agentDefinitions(offset);
    if (!Array.isArray(page.definitions)) throw new TransportError("Agent catalog unavailable");
    for (const definition of page.definitions) {
      if (!definition.resourceId || seen.has(definition.resourceId)) throw new TransportError("Agent catalog mismatch");
      seen.add(definition.resourceId);
      if (definition.status !== ResourceState.Active || definition.resourceState !== ResourceState.Active || !definition.currentPublishedVersionAssetId) continue;
      const version = await client.agentVersion(definition.currentPublishedVersionAssetId);
      if (version.assetId !== definition.currentPublishedVersionAssetId || version.agentResourceId !== definition.resourceId)
        throw new TransportError("Agent version mismatch");
      if (version.state !== AgentVersionState.Published) continue;
      const candidate = { agentResourceId: definition.resourceId, agentVersionAssetId: version.assetId,
        displayName: version.content.personaIdentity.displayName, resourceVersion: definition.resourceVersion, assetVersion: version.assetVersion, ordinal: version.ordinal };
      if (!validProjectAgent(candidate)) throw new TransportError("Agent version unavailable");
      result.push(candidate);
    }
    if (page.nextOffset === undefined) return result;
    if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset) throw new TransportError("Agent catalog cursor mismatch");
    offset = page.nextOffset;
  }
}

export type ProjectAgentIntent = { key: string; command?: ActionCommand; submission?: ActionSubmission };
export class ProjectAgentPending extends Error {}
export class ProjectAgentFailed extends Error {}

/** Project already exists: failure here must never discard its recovery intent. */
export async function installProjectAgent(client: Pick<BffClient, "agentInstallationCandidates" | "submitAction" | "task" | "agentInstallation">,
  workspaceId: string, selected: AgentInstallationCandidate, intent: ProjectAgentIntent, save: () => void) {
  if (!intent.command) {
    let offset = 0;
    let candidate: AgentInstallationCandidate | undefined;
    for (;;) {
      const page = await client.agentInstallationCandidates(workspaceId, offset);
      if (page.workspaceId !== workspaceId || page.canCreate !== true || !Array.isArray(page.candidates)
        || !page.candidates.every(validProjectAgent)) throw new ProjectAgentFailed("Agent installation unavailable for this channel");
      candidate = page.candidates.find(row => row.agentResourceId === selected.agentResourceId && row.agentVersionAssetId === selected.agentVersionAssetId);
      if (candidate || page.nextOffset === undefined) break;
      if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset) throw new TransportError("Agent candidate cursor mismatch");
      offset = page.nextOffset;
    }
    if (!candidate || candidate.ordinal !== selected.ordinal || candidate.assetVersion !== selected.assetVersion)
      throw new ProjectAgentFailed("Selected Agent version is no longer installable");
    intent.command = { actionKey: "agent.installation.create", idempotencyKey: intent.key, workspaceId,
      resourceId: candidate.agentResourceId, resourceVersion: candidate.resourceVersion,
      assetId: candidate.agentVersionAssetId, assetVersion: candidate.assetVersion };
    save();
  }
  const command = intent.command;
  if (command.actionKey !== "agent.installation.create" || command.idempotencyKey !== intent.key || command.workspaceId !== workspaceId
    || command.resourceId !== selected.agentResourceId || command.assetId !== selected.agentVersionAssetId || command.assetVersion !== selected.assetVersion)
    throw new TransportError("Project Agent intent mismatch");
  try {
    if (!intent.submission) {
      // Same command/key is the Core idempotent recovery path after a lost ACK.
      const submission = await client.submitAction(command);
      if (submission.actionKey !== command.actionKey || !submission.actionExecutionId || !submission.operationId)
        throw new TransportError("Agent installation receipt mismatch");
      intent.submission = submission;
      save();
    }
    const receipt = intent.submission;
    const task = await client.task(receipt.actionExecutionId);
    if (task.actionKey !== command.actionKey || task.actionExecutionId !== receipt.actionExecutionId || task.operationId !== receipt.operationId
      || task.workspaceId !== workspaceId || receipt.workflowId !== undefined && task.workflowId !== receipt.workflowId)
      throw new TransportError("Agent installation task mismatch");
    if (task.dispatchState === ActionDispatchState.Unknown) throw new ProjectAgentPending("Agent installation outcome unknown");
    if (taskPhase(task).tone === "negative") throw new ProjectAgentFailed("Agent installation rejected");
    if (taskPhase(task).tone !== "positive" || task.taskStatus !== TaskStatus.Completed || task.workflowKind !== WorkflowKind.AgentInstallation || !task.workflowId)
      throw new ProjectAgentPending("Agent installation has not completed");
    const installation = await client.agentInstallation(task.targetId);
    if (installation.resourceId !== task.targetId || installation.workspaceId !== workspaceId
      || installation.agentResourceId !== selected.agentResourceId || installation.pinnedVersionAssetId !== selected.agentVersionAssetId
      || installation.state !== AgentInstallationState.Active || installation.resourceState !== ResourceState.Active
      || installation.agentPrincipalState !== "ACTIVE" || !installation.agentPrincipalId
      || !installation.activeProjectionGeneration || installation.projection?.generation !== installation.activeProjectionGeneration
      || installation.projection.state !== AgentRuntimeProjectionState.Active || installation.projection.agentVersionAssetId !== selected.agentVersionAssetId
      || installation.channelBinding?.status !== "ACTIVE" || !installation.channelBinding.channelId)
      throw new ProjectAgentPending("Agent installation is awaiting its active channel projection");
  } catch (error) {
    if (error instanceof ProjectAgentFailed || error instanceof ProjectAgentPending) throw error;
    throw new ProjectAgentPending("Original Agent installation awaits authorized confirmation");
  }
}
