// DD-131(2)(3)(8): one governed snapshot export as the original export/share dialogs see it.
// The intent (target, version, encoding, idempotency key) is frozen before it is sent; an unknown
// outcome keeps it and only that same command is re-sent. A WAITING receipt is shown with the
// approval panel (the owner approves their own export explicitly, self_approval ALLOW); after
// approval Core's Temporal workflow generates the ExportPackage, which is then read by its
// assetId (= ActionExecution ID). Observation is reads only and never re-submits.
import * as React from "react";
import type { ActionCommand, ActionSubmission, AgentDefinitionView, AgentTeamView, ExportPackageView, ReasonCode } from "@client-kit/contracts";
import { newIdempotencyKey } from "../../governance";
import { TransportError, writeFailure } from "../../transport";
import { useBffClient, useCurrentPrincipalId } from "../context";
import {
  ExportRefused,
  observeExport,
  receiptRefused,
  receiptUnknown,
  snapshotEncoding,
  validReceipt,
  type SnapshotFormat,
} from "./snapshotFlow";

export type SnapshotExportTarget =
  | { kind: "agent"; definition: AgentDefinitionView }
  | { kind: "team"; team: AgentTeamView };

export type SnapshotExportState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "unknown"; operation?: string }
  | { phase: "approval"; receipt: ActionSubmission; workflowId: string }
  | { phase: "generating"; receipt: ActionSubmission }
  | { phase: "stalled"; receipt: ActionSubmission }
  | { phase: "ready"; receipt: ActionSubmission; pkg: ExportPackageView }
  | { phase: "refused"; reason?: ReasonCode; detail: string };

/** Bounded observation after a receipt: reads only; "Check again" restarts it. */
export const EXPORT_OBSERVE_ATTEMPTS = 60;
export const EXPORT_OBSERVE_INTERVAL_MS = 2_000;

/** The governed export command of one target, or null when it has no published version. */
export function snapshotExportCommand(target: SnapshotExportTarget, format: SnapshotFormat): Omit<ActionCommand, "idempotencyKey"> | null {
  const snapshotExport = { encoding: snapshotEncoding(format) };
  if (target.kind === "team")
    return { actionKey: "agent.team.export", resourceId: target.team.resourceId, resourceVersion: target.team.resourceVersion, snapshotExport };
  const assetId = target.definition.currentPublishedVersionAssetId;
  if (!assetId) return null;
  return { actionKey: "agent.definition.export", resourceId: target.definition.resourceId,
    resourceVersion: target.definition.resourceVersion, assetId, snapshotExport };
}

/** Whether the caller decides this export's approval (target owner) or only waits for it. */
export function useExportApprovalRole(target: SnapshotExportTarget | null): "approver" | "initiator" {
  const principal = useCurrentPrincipalId();
  const owner = target?.kind === "team" ? target.team.ownerPrincipalId : target?.definition.ownerPrincipalId;
  return principal !== undefined && owner === principal ? "approver" : "initiator";
}

export function useSnapshotExport(target: SnapshotExportTarget | null, options?: { sleep?: (ms: number) => Promise<void> }) {
  const client = useBffClient();
  const [state, setState] = React.useState<SnapshotExportState>({ phase: "idle" });
  const intent = React.useRef<ActionCommand | null>(null);
  const receiptRef = React.useRef<ActionSubmission | null>(null);
  const epoch = React.useRef(0);
  const mounted = React.useRef(true);
  const sleep = options?.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const sleepRef = React.useRef(sleep);
  sleepRef.current = sleep;
  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; epoch.current += 1; };
  }, []);
  const commit = React.useCallback((next: SnapshotExportState) => { if (mounted.current) setState(next); }, []);

  const observe = React.useCallback(async (receipt: ActionSubmission) => {
    const generation = ++epoch.current;
    for (let attempt = 0; attempt < EXPORT_OBSERVE_ATTEMPTS; attempt += 1) {
      if (generation !== epoch.current) return;
      try {
        const progress = await observeExport(client, receipt);
        if (generation !== epoch.current) return;
        if (progress.phase === "ready") { commit({ phase: "ready", receipt, pkg: progress.pkg }); return; }
        commit(progress.phase === "approval" ? { phase: "approval", receipt, workflowId: progress.workflowId } : { phase: "generating", receipt });
      } catch (error) {
        if (generation !== epoch.current) return;
        if (error instanceof ExportRefused) { commit({ phase: "refused", reason: error.reason, detail: error.message }); return; }
        // A read failure says nothing about the export; keep observing within the bound.
      }
      await sleepRef.current(EXPORT_OBSERVE_INTERVAL_MS);
    }
    if (generation === epoch.current) commit({ phase: "stalled", receipt });
  }, [client, commit]);

  const send = React.useCallback(async (command: ActionCommand) => {
    commit({ phase: "submitting" });
    try {
      const result = await client.submitAction(command);
      if (!validReceipt(result, command, receiptRef.current)) throw new TransportError("Missing admission receipt");
      receiptRef.current = result;
      if (receiptUnknown(result)) { commit({ phase: "unknown", operation: result.operationId }); return; }
      intent.current = null;
      if (receiptRefused(result)) { commit({ phase: "refused", reason: result.reason, detail: result.gateState }); return; }
      void observe(result);
    } catch (error) {
      const failed = writeFailure(error);
      if (failed.kind === "unknown" || receiptRef.current) {
        commit({ phase: "unknown", operation: failed.kind === "unknown" ? failed.operationId ?? receiptRef.current?.operationId : receiptRef.current?.operationId });
      } else {
        intent.current = null;
        commit({ phase: "refused", reason: failed.reason, detail: failed.detail });
      }
    }
  }, [client, commit, observe]);

  /** Freeze a new export intent for `format` and send it. Ignored while one is unresolved. */
  const start = React.useCallback((format: SnapshotFormat) => {
    if (!target || intent.current) return;
    const command = snapshotExportCommand(target, format);
    if (!command) return;
    intent.current = { ...command, idempotencyKey: newIdempotencyKey() };
    receiptRef.current = null;
    void send(intent.current);
  }, [target, send]);

  /** Re-send the same frozen command after an unknown outcome. */
  const retry = React.useCallback(() => { if (intent.current) void send(intent.current); }, [send]);
  /** Re-read the current execution (after an approval decision or a stalled observation). */
  const checkAgain = React.useCallback(() => { if (receiptRef.current && !intent.current) void observe(receiptRef.current); }, [observe]);
  /** Drop a settled export; an unknown intent is never dropped. */
  const reset = React.useCallback(() => {
    if (intent.current) return;
    epoch.current += 1;
    receiptRef.current = null;
    commit({ phase: "idle" });
  }, [commit]);

  const busy = state.phase === "submitting" || state.phase === "approval" || state.phase === "generating";
  return { state, start, retry, checkAgain, reset, busy, holdsIntent: state.phase === "unknown" };
}

export type SnapshotExport = ReturnType<typeof useSnapshotExport>;
