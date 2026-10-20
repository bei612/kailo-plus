// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/channel-templates/useApplyTemplate.ts::{applyCanvas,applyAgents} and
// desktop/src/app/AppShell.tsx::handleCreateChannel (create, canvas, then agents; best effort).
// DD-125(4): a template grants nothing. After the existing workspace.create submission, each
// part is its own governed submission with its own idempotency key, admitted and audited by
// Core; a refused part is reported on its own and never rolls back the channel or other parts.
import { ActionDispatchState, ActionGateState, AgentVersionState, RoleWorkspacePageCreateActionKey, ResourceState, TaskStatus,
  type ActionCommand, type ActionSubmission, type AgentInstallationCandidate } from "@client-kit/contracts";
import type { BffClient } from "../../client";
import type { ChannelTemplateRecord } from "../../collaboration-preferences";
import { newIdempotencyKey, taskPhase } from "../../governance";
import { TransportError, writeFailure, type WriteFailure } from "../../transport";

export type TemplateApplyItem = { kind: "canvas" } | { kind: "agent"; resourceId: string; name: string };
export type TemplateApplyResult =
  | { item: TemplateApplyItem; outcome: "submitted"; submission: ActionSubmission }
  | { item: TemplateApplyItem; outcome: "failed"; failure: WriteFailure }
  | { item: TemplateApplyItem; outcome: "unavailable" };

export type TemplateApplyClient = Pick<BffClient, "task" | "submitAction" | "agentDefinition" | "agentVersion" | "agentInstallationCandidates">;

/** Original applyCanvas placeholder replacement. */
export function renderCanvasTemplate(template: Pick<ChannelTemplateRecord, "name" | "canvasTemplate">, channelName: string): string | null {
  if (!template.canvasTemplate) return null;
  return template.canvasTemplate.split("{channel.name}").join(channelName).split("{template.name}").join(template.name);
}

export class TemplateChannelPending extends Error {}
export class TemplateChannelRejected extends Error {}

/** The created Workspace, once its workspace.create task has completed. */
export async function waitForCreatedWorkspace(
  client: Pick<BffClient, "task">,
  submission: ActionSubmission,
  options: { isCurrent: () => boolean; sleep: (ms: number) => Promise<void>; attempts?: number; intervalMs?: number },
): Promise<string> {
  const attempts = options.attempts ?? 30;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!options.isCurrent()) throw new TemplateChannelPending("Template scope changed");
    const task = await client.task(submission.actionExecutionId);
    if (task.actionExecutionId !== submission.actionExecutionId || task.operationId !== submission.operationId
      || task.actionKey !== RoleWorkspacePageCreateActionKey.WorkspaceCreate) throw new TransportError("Template channel receipt mismatch");
    const phase = taskPhase(task);
    if (phase.tone === "negative") throw new TemplateChannelRejected("Template channel creation rejected");
    if (phase.tone === "positive" && task.taskStatus === TaskStatus.Completed && task.targetId) return task.targetId;
    if (attempt + 1 < attempts) await options.sleep(options.intervalMs ?? 2_000);
  }
  throw new TemplateChannelPending("Template channel has not completed");
}

/** The Definition's current published Version as an installable candidate in this Workspace. */
async function currentCandidate(client: TemplateApplyClient, workspaceId: string, resourceId: string): Promise<{ name?: string; candidate: AgentInstallationCandidate | null }> {
  const definition = await client.agentDefinition(resourceId);
  if (definition.resourceId !== resourceId) throw new TransportError("Agent definition mismatch");
  const name = definition.displayName;
  if (definition.resourceState !== ResourceState.Active || !definition.currentPublishedVersionAssetId) return { name, candidate: null };
  const version = await client.agentVersion(definition.currentPublishedVersionAssetId);
  if (version.assetId !== definition.currentPublishedVersionAssetId || version.state !== AgentVersionState.Published) return { name, candidate: null };
  const seen = new Set<number>();
  let offset = 0;
  for (;;) {
    const page = await client.agentInstallationCandidates(workspaceId, offset);
    if (page.workspaceId !== workspaceId || !Array.isArray(page.candidates)) throw new TransportError("Agent candidates unavailable");
    if (page.canCreate !== true) return { name, candidate: null };
    const match = page.candidates.find((candidate) => candidate.agentResourceId === resourceId && candidate.agentVersionAssetId === version.assetId);
    if (match) return { name, candidate: match };
    if (page.nextOffset === undefined) return { name, candidate: null };
    if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset || seen.has(page.nextOffset)) throw new TransportError("Agent candidate cursor mismatch");
    seen.add(page.nextOffset);
    offset = page.nextOffset;
  }
}

async function submit(client: TemplateApplyClient, item: TemplateApplyItem, command: ActionCommand): Promise<TemplateApplyResult> {
  try {
    const submission = await client.submitAction(command);
    if (!submission || submission.actionKey !== command.actionKey || !submission.actionExecutionId || !submission.operationId)
      throw new TransportError("Template submission receipt mismatch");
    // Denied/expired gates are refusals of this one part; the others proceed.
    if ([ActionGateState.Denied, ActionGateState.Revoked, ActionGateState.Expired].includes(submission.gateState))
      return { item, outcome: "failed", failure: { kind: "rejected", reason: submission.reason, detail: submission.gateState } };
    return { item, outcome: "submitted", submission };
  } catch (error) {
    return { item, outcome: "failed", failure: writeFailure(error) };
  }
}

/** The Canvas write of DD-125(4), 05 §2.11 (CONTROL signs kind 40100; the body is transient). */
export const CANVAS_SET_ACTION = "workspace.canvas.set";

/**
 * The canvas part: one governed `workspace.canvas.set` with the rendered template. It is SYNC, so
 * a receipt whose dispatch is still unknown or was aborted is reported, not counted as applied.
 */
async function submitCanvas(client: TemplateApplyClient, workspaceId: string, content: string): Promise<TemplateApplyResult> {
  const item: TemplateApplyItem = { kind: "canvas" };
  const result = await submit(client, item, {
    actionKey: CANVAS_SET_ACTION, idempotencyKey: newIdempotencyKey(), workspaceId,
    explicitConfirmation: true, workspaceCanvas: { content },
  });
  if (result.outcome !== "submitted") return result;
  if (result.submission.dispatchState === ActionDispatchState.Unknown)
    return { item, outcome: "failed", failure: { kind: "unknown", operationId: result.submission.operationId } };
  if (result.submission.dispatchState === ActionDispatchState.Aborted)
    return { item, outcome: "failed", failure: { kind: "rejected", reason: result.submission.reason, detail: result.submission.dispatchState } };
  return result;
}

/**
 * Original order: canvas, then each Agent. Each part is its own governed submission
 * (`workspace.canvas.set`, then `agent.installation.create`), admitted and audited on its own;
 * the template grants nothing and a refused part never rolls back the others.
 */
export async function applyChannelTemplate(
  client: TemplateApplyClient,
  template: Pick<ChannelTemplateRecord, "name" | "canvasTemplate" | "agentResourceIds">,
  workspaceId: string,
  channelName: string,
  agentNames: ReadonlyMap<string, string>,
  isCurrent: () => boolean,
): Promise<TemplateApplyResult[]> {
  const results: TemplateApplyResult[] = [];
  const canvas = renderCanvasTemplate(template, channelName);
  if (canvas !== null && isCurrent()) results.push(await submitCanvas(client, workspaceId, canvas));
  for (const resourceId of [...new Set(template.agentResourceIds)]) {
    if (!isCurrent()) break;
    const item: TemplateApplyItem = { kind: "agent", resourceId, name: agentNames.get(resourceId) ?? resourceId };
    let found: Awaited<ReturnType<typeof currentCandidate>>;
    try { found = await currentCandidate(client, workspaceId, resourceId); }
    catch (error) { results.push({ item, outcome: "failed", failure: writeFailure(error) }); continue; }
    const named: TemplateApplyItem = { kind: "agent", resourceId, name: agentNames.get(resourceId) ?? found.name ?? found.candidate?.displayName ?? resourceId };
    const candidate = found.candidate;
    if (!candidate) { results.push({ item: named, outcome: "unavailable" }); continue; }
    results.push(await submit(client, named, {
      actionKey: "agent.installation.create", idempotencyKey: newIdempotencyKey(), workspaceId,
      resourceId: candidate.agentResourceId, resourceVersion: candidate.resourceVersion,
      assetId: candidate.agentVersionAssetId, assetVersion: candidate.assetVersion,
    }));
  }
  return results;
}

export type TemplateAgentOption = { resourceId: string; name: string };

/** Same-Tenant AgentDefinitions the caller can discover (the original persona list). */
export async function loadTemplateAgents(client: Pick<BffClient, "agentDefinitions">): Promise<TemplateAgentOption[]> {
  const result: TemplateAgentOption[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (;;) {
    const page = await client.agentDefinitions(offset);
    if (!Array.isArray(page.definitions)) throw new TransportError("Agent catalog unavailable");
    for (const definition of page.definitions) {
      if (!definition.resourceId || seen.has(definition.resourceId)) throw new TransportError("Agent catalog mismatch");
      seen.add(definition.resourceId);
      if (definition.resourceState !== ResourceState.Active) continue;
      result.push({ resourceId: definition.resourceId, name: definition.displayName });
    }
    if (page.nextOffset === undefined) return result;
    if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset) throw new TransportError("Agent catalog cursor mismatch");
    offset = page.nextOffset;
  }
}
