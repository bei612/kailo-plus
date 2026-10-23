// DD-131(1) "Deploy to channel" (Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/agents/ui/AddTeamToChannelDialog.tsx::handleDeploy): not a new action. For
// each member, in team order, the Definition's current published Version is installed with the
// existing `agent.installation.create`, each its own governed submission with its own idempotency
// key (same semantics as DD-125(4) channel templates). A member already installed in the channel,
// without a published Version, or refused is reported on its own; succeeded items are never rolled
// back. The original runtime choice, role and `forceNewInstance` do not apply (DD-26).
import { ActionDispatchState, ActionGateState, ResourceState, type AgentInstallationView } from "@client-kit/contracts";
import type { BffClient } from "../../client";
import { newIdempotencyKey } from "../../governance";
import { TransportError, writeFailure, type WriteFailure } from "../../transport";
import { currentCandidate } from "../channel-templates/applyChannelTemplate";

export type TeamDeployMember = { resourceId: string; name: string };

export type TeamDeployResult =
  | { member: TeamDeployMember; outcome: "submitted"; operationId: string; waiting: boolean }
  | { member: TeamDeployMember; outcome: "already" }
  | { member: TeamDeployMember; outcome: "unavailable" }
  | { member: TeamDeployMember; outcome: "failed"; failure: WriteFailure };

export type TeamDeployClient = Pick<BffClient, "agentInstallations" | "agentDefinition" | "agentVersion" | "agentInstallationCandidates" | "submitAction" | "task">;

/** Definitions that already have an Installation in this Workspace (its channel). */
export async function installedDefinitions(client: Pick<BffClient, "agentInstallations">, workspaceId: string): Promise<Set<string>> {
  const installed = new Set<string>();
  let offset = 0;
  for (;;) {
    const page = await client.agentInstallations(workspaceId, offset);
    if (!page || !Array.isArray(page.installations)) throw new TransportError("Agent installations unavailable");
    for (const row of page.installations as AgentInstallationView[]) {
      if (row.workspaceId !== workspaceId) throw new TransportError("Agent installation scope mismatch");
      if (row.resourceState === ResourceState.Active) installed.add(row.agentResourceId);
    }
    if (page.nextOffset == null) return installed;
    if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset) throw new TransportError("Agent installation cursor mismatch");
    offset = page.nextOffset;
  }
}

export async function deployTeamToChannel(
  client: TeamDeployClient,
  members: readonly TeamDeployMember[],
  workspaceId: string,
  isCurrent: () => boolean,
  onResult?: (result: TeamDeployResult) => void,
): Promise<TeamDeployResult[]> {
  const results: TeamDeployResult[] = [];
  const push = (result: TeamDeployResult) => { results.push(result); onResult?.(result); };
  const installed = await installedDefinitions(client, workspaceId);
  for (const member of members) {
    if (!isCurrent()) break;
    if (installed.has(member.resourceId)) { push({ member, outcome: "already" }); continue; }
    let found: Awaited<ReturnType<typeof currentCandidate>>;
    try { found = await currentCandidate(client, workspaceId, member.resourceId); }
    catch (error) { push({ member, outcome: "failed", failure: writeFailure(error) }); continue; }
    const candidate = found.candidate;
    if (!candidate) { push({ member, outcome: "unavailable" }); continue; }
    try {
      const command = {
        actionKey: "agent.installation.create", idempotencyKey: newIdempotencyKey(), workspaceId,
        resourceId: candidate.agentResourceId, resourceVersion: candidate.resourceVersion,
        assetId: candidate.agentVersionAssetId, assetVersion: candidate.assetVersion,
      };
      const receipt = await client.submitAction(command);
      if (!receipt || receipt.actionKey !== command.actionKey || !receipt.actionExecutionId || !receipt.operationId)
        throw new TransportError("Installation receipt mismatch");
      if ([ActionGateState.Denied, ActionGateState.Revoked, ActionGateState.Expired].includes(receipt.gateState)
        || receipt.dispatchState === ActionDispatchState.Aborted)
        push({ member, outcome: "failed", failure: { kind: "rejected", reason: receipt.reason, detail: receipt.gateState } });
      else if (receipt.dispatchState === ActionDispatchState.Unknown || receipt.gateState === ActionGateState.Evaluating)
        push({ member, outcome: "failed", failure: { kind: "unknown", operationId: receipt.operationId } });
      else push({ member, outcome: "submitted", operationId: receipt.operationId, waiting: receipt.gateState === ActionGateState.Waiting });
    } catch (error) {
      push({ member, outcome: "failed", failure: writeFailure(error) });
    }
  }
  return results;
}
