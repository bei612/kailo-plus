// Shared shape checks for the governed Agent installation directory. The Agents page and the
// channel member dialog (Buzz 779af888 MembersSidebar agent rows) accept the same rows.
import {
  AgentInstallationState,
  AgentRuntimeProjectionState,
  AgentTrigger,
  ResourceState,
  type AgentInstallationView,
} from "@client-kit/contracts";
import type { BffClient } from "../client";
import type { PlatformMessageKey } from "../i18n";
import { TransportError } from "../transport";

export const installationLabels = {
  [AgentInstallationState.Provisioning]: "agents.installation.state.provisioning",
  [AgentInstallationState.Active]: "agents.installation.state.active",
  [AgentInstallationState.Draining]: "agents.installation.state.draining",
  [AgentInstallationState.Disabled]: "agents.installation.state.disabled",
  [AgentInstallationState.Error]: "agents.installation.state.error",
} as const satisfies Record<AgentInstallationState, PlatformMessageKey>;

export function validInstallation(row: AgentInstallationView): boolean {
  if (!row || ![row.resourceId, row.workspaceId, row.agentResourceId, row.pinnedVersionAssetId,
    row.agentPrincipalId, row.ownerPrincipalId].every((id) => typeof id === "string" && !!id)
    || !Number.isSafeInteger(row.resourceVersion) || row.resourceVersion <= 0
    || !Object.values(ResourceState).includes(row.resourceState)
    || !Object.values(AgentInstallationState).includes(row.state)
    || (row.canUpgrade !== undefined && typeof row.canUpgrade !== "boolean")
    || (row.agentPrincipalState !== "ACTIVE" && row.agentPrincipalState !== "DISABLED")) return false;
  const channel = row.channelBinding;
  if (channel !== undefined && (!channel || !["ACTIVE", "DISABLED", "ERROR"].includes(channel.status)
    || !Array.isArray(channel.triggers) || channel.triggers.length === 0
    || !channel.triggers.every((trigger) => Object.values(AgentTrigger).includes(trigger))
    || (channel.channelId !== undefined && (typeof channel.channelId !== "string" || !channel.channelId)))) return false;
  const projection = row.projection;
  if (projection !== undefined && (!projection || !Number.isSafeInteger(projection.generation) || projection.generation <= 0
    || projection.agentVersionAssetId !== row.pinnedVersionAssetId
    || typeof projection.runtimeProfileKey !== "string" || !projection.runtimeProfileKey
    || typeof projection.configHash !== "string" || !/^[0-9a-f]{64}$/.test(projection.configHash)
    || !Object.values(AgentRuntimeProjectionState).includes(projection.state))) return false;
  if (row.activeProjectionGeneration !== undefined && (!Number.isSafeInteger(row.activeProjectionGeneration)
    || row.activeProjectionGeneration <= 0 || projection?.generation !== row.activeProjectionGeneration)) return false;
  for (const permission of [row.executionPermission, row.readPermission]) {
    if (permission !== undefined && (!permission
      || ![permission.requested, permission.effective, permission.canGrant, permission.canRevoke].every((value) => typeof value === "boolean")
      || (permission.pendingActionExecutionId !== undefined && (typeof permission.pendingActionExecutionId !== "string" || !permission.pendingActionExecutionId)))) return false;
  }
  return row.state !== AgentInstallationState.Active || (row.resourceState === ResourceState.Active
    && row.activeProjectionGeneration !== undefined && projection?.state === AgentRuntimeProjectionState.Active);
}

/** Every page of one Workspace's installation directory; a malformed or stalled page fails closed. */
export async function loadWorkspaceAgents(client: BffClient, workspaceId: string): Promise<AgentInstallationView[]> {
  const rows: AgentInstallationView[] = [];
  const ids = new Set<string>();
  let offset = 0;
  for (;;) {
    const page = await client.agentInstallations(workspaceId, offset);
    if (!page || !Array.isArray(page.installations)) throw new TransportError("Invalid Installation directory");
    for (const row of page.installations) {
      if (!validInstallation(row) || row.workspaceId !== workspaceId || ids.has(row.resourceId)) throw new TransportError("Invalid Installation directory");
      ids.add(row.resourceId); rows.push(row);
    }
    if (page.nextOffset === undefined || page.nextOffset === null) return rows;
    if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset) throw new TransportError("Invalid Installation cursor");
    offset = page.nextOffset;
  }
}
