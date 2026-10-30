// DD-131(6) catalog reads and the "copy as my own Definition" chain behind the original
// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/ui/CommunityCatalogDialog.tsx
// "Add agent" / "Add team". Kailo's catalog is the caller's discoverable AgentDefinitions and
// `agent.team` Resources; adding grants nothing. A Definition copy is the existing
// `agent.definition.create` followed by `agent.version.create` with the source's portable published
// fields (the same field set as the snapshot package, DD-131(2)); a team copy is `agent.team.create`
// referencing the original Definitions. Every write is its own frozen, idempotent submission.
// Replaces the original relay catalog readers desktop/src/features/agents/lib/personaCatalogRelay.ts,
// desktop/src/features/agents/lib/usePersonaCatalogRelay.ts, desktop/src/features/agents/lib/teamCatalogRelay.ts,
// desktop/src/features/agents/lib/useTeamCatalogRelay.ts and the native desktop/src-tauri/src/team_catalog.rs
// (kind:30175/30178 paging and verification): the catalog is now Core's discover-filtered read (DD-131(6)).
// The original Tauri commands/teams/adopt.rs (+ adopt/apply.rs, tests) "add team from catalog" is the
// governed team copy below.
import {
  ActionDispatchState,
  ActionGateState,
  AgentVersionState,
  TaskStatus,
  type ActionCommand,
  type ActionSubmission,
  type AgentCatalogOwners,
  type AgentDefinitionView,
  type AgentTeamView,
  type AgentVersionContent,
  type AgentVersionView,
} from "@client-kit/contracts";
import type { BffClient } from "../../client";
import { taskPhase } from "../../governance";
import { TransportError } from "../../transport";

export type CatalogOwner = { principalId: string; displayName?: string };

/** Owner names for catalog entries, one bounded page per request; unanswered IDs stay unknown. */
export async function loadCatalogOwners(
  client: Pick<BffClient, "agentCatalogOwners">,
  resourceIds: readonly string[],
  pageSize = 100,
): Promise<Map<string, CatalogOwner>> {
  const owners = new Map<string, CatalogOwner>();
  const ids = [...new Set(resourceIds)];
  for (let start = 0; start < ids.length; start += pageSize) {
    const page = ids.slice(start, start + pageSize);
    const answer: AgentCatalogOwners = await client.agentCatalogOwners(page);
    if (!answer || !Array.isArray(answer.owners)) throw new TransportError("Agent catalog owners unavailable");
    for (const row of answer.owners) {
      if (!row || typeof row.resourceId !== "string" || !page.includes(row.resourceId)
        || typeof row.ownerPrincipalId !== "string" || !row.ownerPrincipalId) throw new TransportError("Agent catalog owner mismatch");
      const name = typeof row.ownerDisplayName === "string" ? row.ownerDisplayName.trim() : "";
      owners.set(row.resourceId, { principalId: row.ownerPrincipalId, ...(name ? { displayName: name } : {}) });
    }
  }
  return owners;
}

/** Original `resolveCatalogOwnerLabel`: you, the owner's name, or "owner unavailable". */
export function catalogOwnerLabel(
  entry: { resourceId: string; ownerPrincipalId: string },
  owners: ReadonlyMap<string, CatalogOwner>,
  currentPrincipalId: string | undefined,
): { kind: "you" } | { kind: "name"; name: string } | { kind: "unavailable" } {
  if (currentPrincipalId !== undefined && entry.ownerPrincipalId === currentPrincipalId) return { kind: "you" };
  const owner = owners.get(entry.resourceId);
  return owner && owner.principalId === entry.ownerPrincipalId && owner.displayName
    ? { kind: "name", name: owner.displayName } : { kind: "unavailable" };
}

/**
 * The portable fields of a published Version (DD-131(2) package field set). Model route, runtime
 * profile and declared tools are Tenant/owner bindings, so the copy is a DRAFT the new owner
 * completes before publishing (the publish admission checks them).
 */
export function portableVersionContent(content: AgentVersionContent): AgentVersionContent {
  return {
    personaIdentity: { ...content.personaIdentity },
    instructions: content.instructions,
    ...(content.replyPolicy !== undefined ? { replyPolicy: content.replyPolicy } : {}),
    parallelism: content.parallelism,
    turnLimits: { ...content.turnLimits },
    memoryPolicy: { ...content.memoryPolicy },
    capabilityRequirements: [...content.capabilityRequirements],
    triggerDefaults: [...content.triggerDefaults],
    skillVersionAssetIds: [...content.skillVersionAssetIds],
    declaredToolResourceIds: [],
  };
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
export const validCopySlug = (slug: string) => SLUG_RE.test(slug);

/** `<slug>-copy`, then `-copy-2`… avoiding slugs already visible in the directory. */
export function suggestedCopySlug(slug: string, taken: ReadonlySet<string>): string {
  const base = `${slug}-copy`;
  if (!taken.has(base)) return base;
  for (let index = 2; ; index += 1) {
    const next = `${base}-${index}`;
    if (!taken.has(next)) return next;
  }
}

/** The team copy keeps only the members the caller can see; hidden members are never referenced. */
export function teamCopyCommand(team: AgentTeamView, name: string): Omit<ActionCommand, "idempotencyKey"> {
  return {
    actionKey: "agent.team.create",
    explicitConfirmation: true,
    agentTeam: {
      name: name.trim(),
      ...(team.description?.trim() ? { description: team.description.trim() } : {}),
      memberAgentResourceIds: [...team.memberAgentResourceIds],
    },
  };
}

export type CatalogSubmitResult =
  | { kind: "accepted"; submission: ActionSubmission; waiting: boolean }
  | { kind: "unknown"; operation?: string }
  | { kind: "rejected"; submission: ActionSubmission };

/** Classifies one admission receipt exactly like the governed hooks of the Agents page. */
export function classifyReceipt(command: ActionCommand, receipt: ActionSubmission | null | undefined): CatalogSubmitResult {
  if (!receipt || receipt.actionKey !== command.actionKey || !receipt.actionExecutionId || !receipt.operationId
    || !Object.values(ActionGateState).includes(receipt.gateState)
    || !Object.values(ActionDispatchState).includes(receipt.dispatchState)) throw new TransportError("Missing admission receipt");
  if (receipt.dispatchState === ActionDispatchState.Unknown || receipt.gateState === ActionGateState.Evaluating
    || (receipt.gateState === ActionGateState.Allowed && receipt.dispatchState === ActionDispatchState.NotDispatched))
    return { kind: "unknown", operation: receipt.operationId };
  if (receipt.dispatchState === ActionDispatchState.Aborted
    || [ActionGateState.Denied, ActionGateState.Revoked, ActionGateState.Expired].includes(receipt.gateState))
    return { kind: "rejected", submission: receipt };
  return { kind: "accepted", submission: receipt, waiting: receipt.gateState === ActionGateState.Waiting };
}

export class CatalogCopyPending extends Error {}
export class CatalogCopyRejected extends Error {}

/** The new Definition's ID once its `agent.definition.create` task has completed. */
export async function waitForCreatedDefinition(
  client: Pick<BffClient, "task">,
  submission: ActionSubmission,
  options: { isCurrent: () => boolean; sleep: (ms: number) => Promise<void>; attempts?: number; intervalMs?: number },
): Promise<string> {
  const attempts = options.attempts ?? 30;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!options.isCurrent()) throw new CatalogCopyPending("Catalog copy scope changed");
    const task = await client.task(submission.actionExecutionId);
    if (task.actionExecutionId !== submission.actionExecutionId || task.operationId !== submission.operationId
      || task.actionKey !== "agent.definition.create") throw new TransportError("Catalog copy receipt mismatch");
    const phase = taskPhase(task);
    if (phase.tone === "negative") throw new CatalogCopyRejected("Definition creation rejected");
    if (phase.tone === "positive" && task.taskStatus === TaskStatus.Completed && task.targetId) return task.targetId;
    if (attempt + 1 < attempts) await options.sleep(options.intervalMs ?? 2_000);
  }
  throw new CatalogCopyPending("Definition creation has not completed");
}

/** Fresh read of the source's current published Version (DD-131(6): the source must still be readable). */
export async function readPublishedSource(
  client: Pick<BffClient, "agentDefinition" | "agentVersion">,
  resourceId: string,
): Promise<{ definition: AgentDefinitionView; version: AgentVersionView }> {
  const definition = await client.agentDefinition(resourceId);
  if (!definition || definition.resourceId !== resourceId || !definition.currentPublishedVersionAssetId)
    throw new CatalogCopyRejected("Source has no published version");
  const version = await client.agentVersion(definition.currentPublishedVersionAssetId);
  if (!version || version.assetId !== definition.currentPublishedVersionAssetId || version.agentResourceId !== resourceId
    || version.state !== AgentVersionState.Published) throw new CatalogCopyRejected("Source version is not published");
  return { definition, version };
}

/** `agent.version.create` on the freshly created Definition with the source's portable fields. */
export async function versionCopyCommand(
  client: Pick<BffClient, "agentDefinition" | "agentVersion">,
  sourceResourceId: string,
  createdResourceId: string,
): Promise<Omit<ActionCommand, "idempotencyKey">> {
  const { version } = await readPublishedSource(client, sourceResourceId);
  const created = await client.agentDefinition(createdResourceId);
  if (!created || created.resourceId !== createdResourceId) throw new TransportError("Created definition mismatch");
  return {
    actionKey: "agent.version.create",
    resourceId: created.resourceId,
    resourceVersion: created.resourceVersion,
    agentVersionContent: portableVersionContent(version.content),
  };
}
