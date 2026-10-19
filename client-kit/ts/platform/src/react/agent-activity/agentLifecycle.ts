// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/lib/managedAgentControlActions.ts
// and ui/useManagedAgentActions.ts mapped onto governed Installation actions (DD-125(6), 05 §2.11):
//   Stop / Remove from channel / Delete → agent.installation.disable
//   Start agent                         → agent.installation.enable
//   Restart agent                       → same-version agent.installation.upgrade (DD-122(4))
//   Stop all (bulk)                     → one agent.installation.disable per running Agent
// There is no physical delete: the Installation, its history and profile are kept.
// Disable/enable carry only actionKey, idempotencyKey, resourceId, resourceVersion and
// explicitConfirmation. One key per intent; an UNKNOWN outcome keeps the identical command.
import * as React from "react";
import {
  ActionDispatchState,
  ActionGateState,
  AgentInstallationState,
  AgentVersionState,
  type ActionCommand,
  type ActionSubmission,
  type AgentInstallationView,
} from "@client-kit/contracts";
import type { BffClient } from "../../client";
import { newIdempotencyKey } from "../../governance";
import { TransportError, type WriteFailure, writeFailure } from "../../transport";

export type LifecycleKind = "stop" | "start" | "restart" | "remove";

export type LifecycleIntent = {
  kind: LifecycleKind;
  installationId: string;
  command: ActionCommand;
};

export type LifecycleOffer = { stop: boolean; start: boolean; restart: boolean };

/** Original isManagedAgentActive: Kailo "running" is an ACTIVE Installation. */
export function isInstallationActive(row: Pick<AgentInstallationView, "state">): boolean {
  return row.state === AgentInstallationState.Active;
}

/** Entries follow the BFF hints only; Core re-admits every submit. */
export function lifecycleOffer(row: AgentInstallationView): LifecycleOffer {
  return {
    stop: row.canDisable === true && row.state === AgentInstallationState.Active,
    start: row.canEnable === true && row.state === AgentInstallationState.Disabled,
    restart: row.canRestart === true && row.state === AgentInstallationState.Active,
  };
}

export function disableCommand(row: Pick<AgentInstallationView, "resourceId" | "resourceVersion">, idempotencyKey = newIdempotencyKey()): ActionCommand {
  return { actionKey: "agent.installation.disable", idempotencyKey, resourceId: row.resourceId,
    resourceVersion: row.resourceVersion, explicitConfirmation: true };
}

export function enableCommand(row: Pick<AgentInstallationView, "resourceId" | "resourceVersion">, idempotencyKey = newIdempotencyKey()): ActionCommand {
  return { actionKey: "agent.installation.enable", idempotencyKey, resourceId: row.resourceId,
    resourceVersion: row.resourceVersion, explicitConfirmation: true };
}

/**
 * Restart is the same governed upgrade the Tools "re-grant" uses: the Installation's own freshly
 * read pinned Version, still PUBLISHED. Built once per intent and then frozen.
 */
export async function restartCommand(client: BffClient, row: AgentInstallationView, idempotencyKey = newIdempotencyKey()): Promise<ActionCommand> {
  const current = await client.agentInstallation(row.resourceId);
  if (!current || current.resourceId !== row.resourceId || current.workspaceId !== row.workspaceId
    || current.canRestart !== true || current.state !== AgentInstallationState.Active) throw new TransportError("Installation changed");
  const pinned = await client.agentVersion(current.pinnedVersionAssetId);
  if (!pinned || pinned.assetId !== current.pinnedVersionAssetId || pinned.agentResourceId !== current.agentResourceId
    || pinned.state !== AgentVersionState.Published || !Number.isSafeInteger(pinned.assetVersion) || pinned.assetVersion <= 0)
    throw new TransportError("Pinned Version unavailable");
  return { actionKey: "agent.installation.upgrade", idempotencyKey, workspaceId: current.workspaceId,
    resourceId: current.resourceId, resourceVersion: current.resourceVersion,
    assetId: pinned.assetId, assetVersion: pinned.assetVersion };
}

export async function lifecycleIntent(client: BffClient, kind: LifecycleKind, row: AgentInstallationView): Promise<LifecycleIntent> {
  const command = kind === "start" ? enableCommand(row)
    : kind === "restart" ? await restartCommand(client, row)
    : disableCommand(row);
  return { kind, installationId: row.resourceId, command };
}

/** Whether a submission proves its outcome; anything else stays the same pending intent. */
export function submissionSettled(result: ActionSubmission): boolean {
  return result.dispatchState !== ActionDispatchState.Unknown
    && result.gateState !== ActionGateState.Evaluating
    && !(result.gateState === ActionGateState.Allowed && result.dispatchState === ActionDispatchState.NotDispatched);
}

export type SubmitOutcome =
  | { kind: "recorded"; submission: ActionSubmission }
  | { kind: "refused"; failure: WriteFailure & { kind: "rejected" } }
  | { kind: "unknown"; failure: WriteFailure & { kind: "unknown" } };

/** One governed submit; a receipt that does not answer this exact command is not evidence. */
export async function submitGoverned(client: BffClient, command: ActionCommand): Promise<SubmitOutcome> {
  try {
    const result = await client.submitAction(command);
    if (!result || result.actionKey !== command.actionKey || !result.operationId) throw new TransportError("receipt");
    if (!submissionSettled(result)) return { kind: "unknown", failure: { kind: "unknown", operationId: result.operationId } };
    // WAITING is a recorded request awaiting its approval (an upgrade may require one).
    if (result.gateState === ActionGateState.Denied || result.gateState === ActionGateState.Revoked
      || result.gateState === ActionGateState.Expired || result.dispatchState === ActionDispatchState.Aborted)
      return { kind: "refused", failure: { kind: "rejected", reason: result.reason, detail: "" } };
    return { kind: "recorded", submission: result };
  } catch (error) {
    const failure = writeFailure(error);
    return failure.kind === "unknown" ? { kind: "unknown", failure } : { kind: "refused", failure };
  }
}

export type LifecycleController = {
  busy: boolean;
  /** Intents whose outcome is unknown; Retry re-sends exactly these commands and keys. */
  pending: LifecycleIntent[];
  failure: WriteFailure | null;
  /** Original runBulkAction "{n} of {m} … failed." count, null for single actions. */
  bulkFailures: { failed: number; total: number; kind: LifecycleKind } | null;
  run: (intents: readonly LifecycleIntent[]) => Promise<void>;
  retry: () => Promise<void>;
  clear: () => void;
};

export function useLifecycleController(client: BffClient, onRecorded?: () => void): LifecycleController {
  const [busy, setBusy] = React.useState(false);
  const [pending, setPending] = React.useState<LifecycleIntent[]>([]);
  const [failure, setFailure] = React.useState<WriteFailure | null>(null);
  const [bulkFailures, setBulkFailures] = React.useState<LifecycleController["bulkFailures"]>(null);
  const inFlight = React.useRef(false);
  const recorded = React.useRef(onRecorded);
  recorded.current = onRecorded;
  const run = React.useCallback(async (intents: readonly LifecycleIntent[]) => {
    if (inFlight.current || intents.length === 0) return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    setBulkFailures(null);
    const unknown: LifecycleIntent[] = [];
    let lastFailure: WriteFailure | null = null;
    let failed = 0;
    // Sequential like the governed use-grant loop: each Installation is admitted on its own.
    for (const intent of intents) {
      const outcome = await submitGoverned(client, intent.command);
      if (outcome.kind === "recorded") continue;
      failed += 1;
      lastFailure = outcome.failure;
      if (outcome.kind === "unknown") unknown.push(intent);
    }
    setPending(unknown);
    setFailure(unknown.length > 0 ? { kind: "unknown", operationId: lastFailure?.kind === "unknown" ? lastFailure.operationId : undefined } : lastFailure);
    if (intents.length > 1 && failed > 0) {
      setBulkFailures({ failed, total: intents.length, kind: intents[0]?.kind ?? "stop" });
    }
    inFlight.current = false;
    setBusy(false);
    recorded.current?.();
  }, [client]);
  const retry = React.useCallback(() => run(pending), [run, pending]);
  const clear = React.useCallback(() => { setFailure(null); setBulkFailures(null); }, []);
  return { busy, pending, failure, bulkFailures, run, retry, clear };
}
