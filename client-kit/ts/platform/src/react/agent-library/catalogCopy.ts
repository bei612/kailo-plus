// DD-131(6) community catalog "add" paths (Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/agents/ui/CommunityCatalogDialog.tsx onSelectPersona/onAddTeam). The original
// copied a Relay catalog event into local files; Kailo uses only existing governed actions:
//  - copy a shared Definition: `agent.definition.create`, then `agent.version.create` with the
//    source's published portable fields (identity, instructions, reply policy, triggers,
//    parallelism, turn limits, memory write mode, capability keys); runtime profile and model route
//    are the person's choice; skills, tools, permissions, delegations and bindings are not copied;
//  - copy a shared team: `agent.team.create` with the same visible members (still the source
//    Definitions).
// Each step is its own submission with its own idempotency key; a later step's failure never rolls
// back an earlier one.
import {
  ActionDispatchState,
  ActionGateState,
  ResourceState,
  type ActionCommand,
  type ActionSubmission,
  type AgentVersionContent,
  type AgentVersionView,
} from "@client-kit/contracts";
import type { BffClient } from "../../client";
import { newIdempotencyKey } from "../../governance";
import { TransportError, writeFailure, type WriteFailure } from "../../transport";
import type { ImportRuntimeProfile } from "./SnapshotImportFields";

export type CopyChoice = { name: string; slug: string; profile: ImportRuntimeProfile; routeId: string };

/** Why a source version's portable fields do not fit the chosen runtime contract. */
export function copyContentProblems(source: AgentVersionContent, profile: ImportRuntimeProfile): string[] {
  const contract = profile.contract;
  const problems: string[] = [];
  if (!contract.replyPolicies.includes(source.replyPolicy)) problems.push("replyPolicy");
  if (source.parallelism > contract.maxParallelism) problems.push("parallelism");
  if (source.turnLimits.idleTimeoutSeconds > contract.maxIdleTimeoutSeconds) problems.push("idleTimeout");
  if (source.turnLimits.maxTurnDurationSeconds > contract.maxTurnDurationSeconds) problems.push("maxTurnDuration");
  if (!source.capabilityRequirements.every((key) => contract.capabilityRequirements.includes(key))) problems.push("capabilities");
  return problems;
}

/** The portable fields of the source's published version under the person's runtime choice. */
export function copyVersionContent(source: AgentVersionContent, choice: CopyChoice): AgentVersionContent {
  const identity = source.personaIdentity;
  return {
    personaIdentity: {
      displayName: choice.name.trim() || identity.displayName,
      ...(identity.description ? { description: identity.description } : {}),
      ...(identity.avatarUrl ? { avatarUrl: identity.avatarUrl } : {}),
    },
    instructions: source.instructions,
    runtimeProfileKey: choice.profile.key,
    modelRouteResourceId: choice.routeId,
    replyPolicy: source.replyPolicy,
    parallelism: source.parallelism,
    turnLimits: { ...source.turnLimits },
    memoryPolicy: { ...source.memoryPolicy },
    capabilityRequirements: [...source.capabilityRequirements],
    triggerDefaults: [...source.triggerDefaults],
    skillVersionAssetIds: [],
    declaredToolResourceIds: [],
  };
}

/** Original-looking stable identifier suggestion: lowercase words plus a short random suffix. */
export function suggestSlug(name: string): string {
  const base = name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "agent";
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

export type CopyStep = "definition" | "version";
export type CopyResult =
  | { outcome: "copied"; definitionId: string; operations: string[] }
  | { outcome: "partial"; definitionId: string; step: CopyStep; failure: WriteFailure }
  | { outcome: "failed"; step: CopyStep; failure: WriteFailure };

async function submit(client: Pick<BffClient, "submitAction">, command: ActionCommand): Promise<ActionSubmission> {
  const receipt = await client.submitAction(command);
  if (!receipt || receipt.actionKey !== command.actionKey || !receipt.actionExecutionId || !receipt.operationId)
    throw new TransportError("Receipt mismatch");
  if ([ActionGateState.Denied, ActionGateState.Revoked, ActionGateState.Expired].includes(receipt.gateState)
    || receipt.dispatchState === ActionDispatchState.Aborted)
    throw Object.assign(new Error(receipt.gateState), { rejected: { kind: "rejected", reason: receipt.reason, detail: receipt.gateState } satisfies WriteFailure });
  if (receipt.dispatchState === ActionDispatchState.Unknown || receipt.gateState === ActionGateState.Evaluating)
    throw Object.assign(new Error("unknown"), { rejected: { kind: "unknown", operationId: receipt.operationId } satisfies WriteFailure });
  return receipt;
}

function failureOf(error: unknown): WriteFailure {
  const carried = (error as { rejected?: WriteFailure } | null)?.rejected;
  return carried ?? writeFailure(error);
}

export async function copyCatalogDefinition(
  client: Pick<BffClient, "submitAction" | "task" | "agentDefinition">,
  source: AgentVersionView,
  choice: CopyChoice,
  options: { isCurrent: () => boolean; sleep: (ms: number) => Promise<void>; attempts?: number },
): Promise<CopyResult> {
  let created: ActionSubmission;
  try {
    created = await submit(client, { actionKey: "agent.definition.create", idempotencyKey: newIdempotencyKey(),
      name: choice.name.trim(), slug: choice.slug.trim() });
  } catch (error) {
    return { outcome: "failed", step: "definition", failure: failureOf(error) };
  }
  let definitionId = "";
  try {
    const task = await client.task(created.actionExecutionId);
    if (task.actionExecutionId !== created.actionExecutionId || !task.targetId) throw new TransportError("Created definition unknown");
    definitionId = task.targetId;
    // The new Definition is PROVISIONING until its projection closes; read it before the version.
    const attempts = options.attempts ?? 15;
    for (let attempt = 0; ; attempt += 1) {
      if (!options.isCurrent()) throw new TransportError("Catalog copy scope changed");
      const definition = await client.agentDefinition(definitionId).catch(() => null);
      if (definition?.resourceId === definitionId && definition.resourceState === ResourceState.Active) {
        const version = await submit(client, { actionKey: "agent.version.create", idempotencyKey: newIdempotencyKey(),
          resourceId: definitionId, resourceVersion: definition.resourceVersion,
          agentVersionContent: copyVersionContent(source.content, choice) });
        return { outcome: "copied", definitionId, operations: [created.operationId, version.operationId] };
      }
      if (attempt + 1 >= attempts) throw new TransportError("Created definition is not active yet");
      await options.sleep(2_000);
    }
  } catch (error) {
    return definitionId
      ? { outcome: "partial", definitionId, step: "version", failure: failureOf(error) }
      : { outcome: "partial", definitionId: "", step: "definition", failure: failureOf(error) };
  }
}

/** Copy a shared team as the person's own new team (same visible member Definitions). */
export function copyTeamCommand(team: { name: string; description?: string; memberAgentResourceIds: string[] }): Omit<ActionCommand, "idempotencyKey"> {
  return { actionKey: "agent.team.create", explicitConfirmation: true,
    agentTeam: { name: team.name, ...(team.description?.trim() ? { description: team.description.trim() } : {}), memberAgentResourceIds: [...team.memberAgentResourceIds] } };
}
