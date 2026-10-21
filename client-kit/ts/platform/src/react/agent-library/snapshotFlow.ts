// DD-131(2)(3)(5)(7) data path behind the original snapshot dialogs (Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/agents/ui/useTeamActions.ts, usePersonaActions.ts and useSnapshotSendController.ts):
// the original local encode/decode is replaced by governed Core actions. Export is
// `agent.definition.export` / `agent.team.export` (owner approval, then a Temporal-generated
// ExportPackage whose assetId is the ActionExecution ID); import is an upload staged for this
// session plus `agent.definition.import` / `agent.team.import`. No memory level, card minting or
// locked card exists (DD-131(4)(5)).
import {
  ActionDispatchState,
  ActionGateState,
  AgentSnapshotDiscardedField,
  AgentSnapshotEncoding,
  AgentSnapshotKind,
  ExportPackageState,
  ReasonCode,
  type ActionCommand,
  type ActionSubmission,
  type AgentSnapshotUploadView,
  type ExportPackageView,
  type TaskView,
} from "@client-kit/contracts";
import type { BffClient, SnapshotMediaType } from "../../client";
import { taskPhase } from "../../governance";
import { BffError, TransportError } from "../../transport";

export type SnapshotKind = "agent" | "team";
export type SnapshotFormat = "json" | "png";

/** Bytes of one snapshot package plus the original file name and media type. */
export type SnapshotFile = { bytes: Uint8Array<ArrayBuffer>; fileName: string; mediaType: string };

export function snapshotEncoding(format: SnapshotFormat): AgentSnapshotEncoding {
  return format === "png" ? AgentSnapshotEncoding.Png : AgentSnapshotEncoding.Json;
}

/** Original `.agent.json/.agent.png/.team.json/.team.png` names (exact suffix, case-insensitive). */
export function snapshotKindFromFileName(fileName: string): SnapshotKind | null {
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith(".agent.json") || lower.endsWith(".agent.png")) return "agent";
  if (lower.endsWith(".team.json") || lower.endsWith(".team.png")) return "team";
  return null;
}

/** The upload media type of an original snapshot file name. */
export function snapshotMediaType(fileName: string): SnapshotMediaType {
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

const DIGEST = /^[0-9a-f]{64}$/;
const DISCARDED = new Set<string>(Object.values(AgentSnapshotDiscardedField));

function validDiscarded(values: unknown): boolean {
  return Array.isArray(values) && values.every((value) => typeof value === "string" && DISCARDED.has(value));
}

/** The upload preview as the contract defines it; a mismatch is not a preview. */
export function validSnapshotUpload(view: AgentSnapshotUploadView, kind?: SnapshotKind): boolean {
  return !!view && typeof view.uploadId === "string" && !!view.uploadId && DIGEST.test(view.contentDigest)
    && Number.isSafeInteger(view.byteSize) && view.byteSize > 0
    && Object.values(AgentSnapshotEncoding).includes(view.encoding)
    && Object.values(AgentSnapshotKind).includes(view.snapshotKind)
    && (kind === undefined || view.snapshotKind === (kind === "team" ? AgentSnapshotKind.Team : AgentSnapshotKind.Agent))
    && typeof view.expiresAt === "string"
    && (view.snapshotKind === AgentSnapshotKind.Team
      ? !!view.team && typeof view.team.name === "string" && validDiscarded(view.team.discardedFields)
      : view.team === undefined && view.members?.length === 1)
    && Array.isArray(view.members) && view.members.every((member) => !!member && typeof member.displayName === "string"
      && typeof member.instructions === "string" && validDiscarded(member.discardedFields)
      && (member.avatarDataUrl === undefined || (typeof member.avatarDataUrl === "string" && member.avatarDataUrl.startsWith("data:image/"))));
}

/** Stage one snapshot file for preview; the kind must match the file the user picked. */
export async function uploadSnapshotFile(client: Pick<BffClient, "uploadAgentSnapshot">, file: SnapshotFile, kind: SnapshotKind): Promise<AgentSnapshotUploadView> {
  const view = await client.uploadAgentSnapshot(file.bytes, file.fileName, snapshotMediaType(file.fileName), kind === "team" ? "TEAM" : "AGENT");
  if (!validSnapshotUpload(view, kind)) throw new TransportError("Snapshot preview unavailable");
  return view;
}

/** One receipt of a governed submission, validated the same way as the Agents page. */
export function validReceipt(result: ActionSubmission, command: ActionCommand, prior?: ActionSubmission | null): boolean {
  return !!result && result.actionKey === command.actionKey
    && typeof result.actionExecutionId === "string" && !!result.actionExecutionId
    && typeof result.operationId === "string" && !!result.operationId
    && Object.values(ActionGateState).includes(result.gateState)
    && Object.values(ActionDispatchState).includes(result.dispatchState)
    && (result.reason === undefined || Object.values(ReasonCode).includes(result.reason))
    && (!prior || (result.actionExecutionId === prior.actionExecutionId && result.operationId === prior.operationId))
    && (result.gateState !== ActionGateState.Waiting || !!result.approvalWorkflowId);
}

/** A receipt whose outcome is still unknown: only the same frozen command may be re-sent. */
export function receiptUnknown(result: ActionSubmission): boolean {
  return result.dispatchState === ActionDispatchState.Unknown || result.gateState === ActionGateState.Evaluating
    || (result.gateState === ActionGateState.Allowed && result.dispatchState === ActionDispatchState.NotDispatched);
}

/** A definite refusal of the gate or dispatch. */
export function receiptRefused(result: ActionSubmission): boolean {
  return [ActionGateState.Denied, ActionGateState.Revoked, ActionGateState.Expired].includes(result.gateState)
    || result.dispatchState === ActionDispatchState.Aborted;
}

export type ExportProgress =
  | { phase: "approval"; workflowId: string; task?: TaskView }
  | { phase: "generating"; task?: TaskView }
  | { phase: "ready"; pkg: ExportPackageView };

export class ExportRefused extends Error {
  readonly reason?: ReasonCode;
  constructor(message: string, reason?: ReasonCode) {
    super(message);
    this.name = "ExportRefused";
    this.reason = reason;
  }
}

/** The package as the contract defines it for this export execution. */
export function validExportPackage(pkg: ExportPackageView, assetId: string): boolean {
  return !!pkg && pkg.assetId === assetId && typeof pkg.sourceResourceId === "string" && !!pkg.sourceResourceId
    && typeof pkg.formatKey === "string" && Number.isSafeInteger(pkg.formatVersion)
    && Object.values(AgentSnapshotEncoding).includes(pkg.encoding) && DIGEST.test(pkg.contentDigest)
    && Number.isSafeInteger(pkg.byteSize) && pkg.byteSize > 0 && typeof pkg.mediaType === "string" && !!pkg.mediaType
    && typeof pkg.fileName === "string" && snapshotKindFromFileName(pkg.fileName) !== null
    && Object.values(ExportPackageState).includes(pkg.state);
}

/**
 * One observation of an export execution: the task (gate, approval, workflow) and the package.
 * A missing package (404) is "not generated yet"; a negative task phase or a revoked/failed
 * package ends the export. Reads only; never re-submits.
 */
export async function observeExport(
  client: Pick<BffClient, "task" | "exportPackage">,
  receipt: ActionSubmission,
): Promise<ExportProgress> {
  let pkg: ExportPackageView | null = null;
  try {
    pkg = await client.exportPackage(receipt.actionExecutionId);
  } catch (error) {
    if (!(error instanceof BffError && error.status === 404)) throw error;
  }
  if (pkg) {
    if (!validExportPackage(pkg, receipt.actionExecutionId)) throw new TransportError("Export package mismatch");
    if (pkg.state === ExportPackageState.Ready) return { phase: "ready", pkg };
    if (pkg.state !== ExportPackageState.Creating) throw new ExportRefused(pkg.state);
  }
  const task = await client.task(receipt.actionExecutionId);
  if (task.actionExecutionId !== receipt.actionExecutionId || task.operationId !== receipt.operationId)
    throw new TransportError("Export task mismatch");
  const phase = taskPhase(task);
  if (phase.tone === "negative") throw new ExportRefused(task.gateState, task.reason);
  const workflowId = task.approvalWorkflowId ?? receipt.approvalWorkflowId;
  if (task.gateState === ActionGateState.Waiting && workflowId) return { phase: "approval", workflowId, task };
  return { phase: "generating", task };
}

/** The READY package bytes, checked against the frozen size before they are used. */
export async function downloadExportPackage(client: Pick<BffClient, "exportPackageContent">, pkg: ExportPackageView): Promise<SnapshotFile> {
  const bytes = await client.exportPackageContent(pkg.assetId);
  if (bytes.byteLength !== pkg.byteSize) throw new TransportError("Export package size mismatch");
  return { bytes, fileName: pkg.fileName, mediaType: pkg.mediaType };
}

/** SHA-256 of package bytes as lowercase hex (original verified attachment fetch). */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}
