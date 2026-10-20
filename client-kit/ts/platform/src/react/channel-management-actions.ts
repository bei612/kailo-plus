// DD-119 channel management over the existing governed action flow (Web and Desktop share it).
// Edit, reopen, leave, archive and unarchive are ActionCommands submitted through the BFF
// client; the entries appear only when the BFF answers the matching action hint, and every
// submission is re-admitted by Core. The member topic is a host publication (Web BFF route).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ActionDispatchState,
  ActionGateState,
  DiscoverableWorkspaceLeaveActionKey,
  DiscoverableWorkspaceUpdateActionKey,
  WorkspaceLifecycleActionKey,
  type ActionCommand,
  type WebPublishTopicRequest,
} from "@client-kit/contracts";
import type { BffClient } from "../client";
import { newIdempotencyKey } from "../governance";
import { BffError, TransportError, writeFailure } from "../transport";
import { loadChannelDirectory } from "./channel-browser/loadChannelDirectory";
import { useBffClient, useFailureText, useReasonText, type Translate } from "./context";

/** Host seam for the parts that differ between Web and Desktop. */
export type ChannelManagementHost = {
  /** Re-read the host's channel view and directory after a recorded change (readback). */
  refresh: () => void;
  /**
   * DD-119 (9): the member's own topic publication, resent unchanged with the same
   * Idempotency-Key after an unknown outcome. Omitted: the topic is shown read-only.
   */
  publishTopic?: (workspaceId: string, request: WebPublishTopicRequest, idempotencyKey: string) => Promise<void>;
  /** Called after a recorded leave, once the sheet has closed. */
  onLeft?: () => void;
  /**
   * DD-125(4) original Canvas: the host's Markdown renderer for the adopted (CONTROL-authored)
   * Canvas body. Omitted: the Canvas row and view are not offered on this host.
   */
  renderCanvas?: (content: string) => ReactNode;
};

/** BFF action hints for one Workspace channel; omitted keys mean no entry is shown. */
export type ChannelManagementHints = {
  updateActionKey?: DiscoverableWorkspaceUpdateActionKey;
  /** With updateActionKey: the Channel was archived by the TTL reaper and only reopen is offered. */
  canReopen: boolean;
  leaveActionKey?: DiscoverableWorkspaceLeaveActionKey;
  lifecycleActionKey?: WorkspaceLifecycleActionKey;
};

export const channelManagementQueryKey = (workspaceId: string) => ["platform", "channel-management", workspaceId] as const;

/** The current Principal's Workspace lifecycle hint (suspend/restore) from the role projection. */
async function loadLifecycleActionKey(client: BffClient, workspaceId: string): Promise<WorkspaceLifecycleActionKey | undefined> {
  let offset = 0;
  try {
    for (;;) {
      const page = await client.roleWorkspaces(offset);
      if (!page || !Array.isArray(page.workspaces)) throw new TransportError("Invalid role workspace page");
      const row = page.workspaces.find((item) => item?.id === workspaceId);
      if (row) {
        if (row.lifecycleActionKey !== undefined && !Object.values(WorkspaceLifecycleActionKey).includes(row.lifecycleActionKey))
          throw new TransportError("Invalid workspace lifecycle hint");
        return row.lifecycleActionKey;
      }
      if (page.nextOffset === undefined) return undefined;
      if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset) throw new TransportError("Role workspace cursor did not advance");
      offset = page.nextOffset;
    }
  } catch (error) {
    // No Tenant manage permission only removes the archive entry.
    if (error instanceof BffError && error.status === 403) return undefined;
    throw error;
  }
}

export function useChannelManagementHints(workspaceId: string | undefined, channelId: string, enabled: boolean) {
  const client = useBffClient();
  return useQuery({
    queryKey: [...channelManagementQueryKey(workspaceId ?? ""), channelId],
    enabled: enabled && workspaceId !== undefined,
    retry: false,
    staleTime: 0,
    queryFn: async (): Promise<ChannelManagementHints> => {
      const [rows, lifecycleActionKey] = await Promise.all([
        loadChannelDirectory(client, () => true, channelId),
        loadLifecycleActionKey(client, workspaceId!),
      ]);
      const row = rows.find((item) => item.id === workspaceId);
      if (!row) return { canReopen: false, lifecycleActionKey };
      if ((row.updateActionKey !== undefined && row.updateActionKey !== DiscoverableWorkspaceUpdateActionKey.WorkspaceUpdate)
        || (row.leaveActionKey !== undefined && row.leaveActionKey !== DiscoverableWorkspaceLeaveActionKey.WorkspaceLeave)
        || (row.canReopen !== undefined && typeof row.canReopen !== "boolean"))
        throw new TransportError("Invalid channel management hint");
      return {
        updateActionKey: row.updateActionKey,
        canReopen: row.updateActionKey !== undefined && row.canReopen === true,
        leaveActionKey: row.leaveActionKey,
        lifecycleActionKey,
      };
    },
  });
}

/** Bounded readback after a recorded change converges through its workflow (reads only, never a resend). */
export const CHANNEL_CONVERGENCE_REREAD_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;

export type ChannelActionOutcome =
  | { kind: "recorded"; operation: string }
  | { kind: "waiting"; operation: string }
  | { kind: "aborted"; operation: string; reason: string }
  | { kind: "unknown"; operation?: string }
  | { kind: "rejected"; reason: string };

export function channelActionOutcomeText(t: Translate, outcome: ChannelActionOutcome): string {
  switch (outcome.kind) {
    case "recorded": return t("channelManagement.actionRecorded", { operation: outcome.operation });
    case "waiting": return t("channelManagement.actionWaiting", { operation: outcome.operation });
    case "unknown": return t("workspace.lifecycle.unknown", { operation: outcome.operation ?? "—" });
    case "aborted": return t("workspace.lifecycle.aborted", { reason: outcome.reason, operation: outcome.operation });
    case "rejected": return t("workspace.lifecycle.rejected", { reason: outcome.reason });
  }
}

/**
 * One governed channel action. A new intent is frozen with its idempotency key before it is
 * sent; an unknown outcome keeps it and only that same command can be resent. A definite answer
 * settles it. Recorded (or approval-pending) commands trigger the host readback.
 */
export function useGovernedChannelAction(onRecorded: (command: ActionCommand) => void) {
  const client = useBffClient();
  const failureText = useFailureText();
  const reasonText = useReasonText();
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const recordedRef = useRef(onRecorded);
  recordedRef.current = onRecorded;
  const [intent, setIntent] = useState<ActionCommand | null>(null);
  const intentRef = useRef<ActionCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ChannelActionOutcome | null>(null);

  const settle = (next: ActionCommand | null, result: ChannelActionOutcome) => {
    intentRef.current = next;
    if (!mounted.current) return;
    setIntent(next);
    setOutcome(result);
  };

  /** Sends `command`, or — while an unknown intent is retained — that same intent unchanged. */
  const submit = useCallback(async (command?: Omit<ActionCommand, "idempotencyKey">): Promise<ChannelActionOutcome | null> => {
    if (inFlight.current) return null;
    const retained = intentRef.current;
    const frozen = retained ?? (command ? { ...command, idempotencyKey: newIdempotencyKey() } : null);
    if (!frozen) return null;
    const prior = retained ? outcome : null;
    const priorOperation = prior?.kind === "unknown" ? prior.operation : undefined;
    inFlight.current = true;
    intentRef.current = frozen;
    setIntent(frozen);
    setBusy(true);
    if (!retained) setOutcome(null);
    let result: ChannelActionOutcome = { kind: "unknown" };
    try {
      const receipt = await client.submitAction(frozen);
      if (!receipt || receipt.actionKey !== frozen.actionKey
        || typeof receipt.actionExecutionId !== "string" || !receipt.actionExecutionId
        || typeof receipt.operationId !== "string" || !receipt.operationId
        || (priorOperation !== undefined && receipt.operationId !== priorOperation)
        || !Object.values(ActionGateState).includes(receipt.gateState)
        || !Object.values(ActionDispatchState).includes(receipt.dispatchState))
        throw new TransportError("Missing admission receipt");
      if (receipt.dispatchState === ActionDispatchState.Unknown || receipt.gateState === ActionGateState.Evaluating
        || (receipt.gateState === ActionGateState.Allowed && receipt.dispatchState === ActionDispatchState.NotDispatched)) {
        result = { kind: "unknown", operation: receipt.operationId };
        settle(frozen, result);
      } else if (receipt.dispatchState === ActionDispatchState.Aborted) {
        result = { kind: "aborted", operation: receipt.operationId,
          reason: receipt.reason ? reasonText(receipt.reason) : receipt.dispatchState };
        settle(null, result);
      } else if (receipt.gateState === ActionGateState.Allowed) {
        result = { kind: "recorded", operation: receipt.operationId };
        settle(null, result);
        recordedRef.current(frozen);
      } else if (receipt.gateState === ActionGateState.Waiting) {
        result = { kind: "waiting", operation: receipt.operationId };
        settle(null, result);
        recordedRef.current(frozen);
      } else {
        result = { kind: "rejected", reason: receipt.reason ? reasonText(receipt.reason) : receipt.gateState };
        settle(null, result);
      }
    } catch (error) {
      const failed = writeFailure(error);
      if (failed.kind === "unknown") {
        result = { kind: "unknown", operation: failed.operationId ?? priorOperation };
        settle(frozen, result);
      } else if (retained) {
        // A refusal of the re-check says nothing about the original uncertain write.
        result = { kind: "unknown", operation: priorOperation };
        settle(frozen, result);
      } else {
        result = { kind: "rejected", reason: failureText(failed) };
        settle(null, result);
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
    return result;
  }, [client, failureText, reasonText, outcome]);

  /** Clears a settled outcome; a retained unknown intent is never dropped here. */
  const dismiss = useCallback(() => { if (!intentRef.current && mounted.current) setOutcome(null); }, []);

  return { intent, busy, outcome, unknown: outcome?.kind === "unknown" && intent !== null, submit, dismiss };
}

export type TopicIntent = { topic: string; idempotencyKey: string };

/** DD-119 (9) member topic: one frozen publication intent; unknown keeps it for the same resend. */
export function useTopicPublication(host: ChannelManagementHost | undefined, workspaceId: string | undefined, onPublished: () => void) {
  const failureText = useFailureText();
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [intent, setIntent] = useState<TopicIntent | null>(null);
  const intentRef = useRef<TopicIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ kind: "unknown" } | { kind: "rejected"; reason: string } | null>(null);
  const publishedRef = useRef(onPublished);
  publishedRef.current = onPublished;

  const publish = useCallback(async (topic?: string): Promise<boolean> => {
    const send = host?.publishTopic;
    if (!send || !workspaceId || inFlight.current) return false;
    const retained = intentRef.current;
    const frozen = retained ?? (topic !== undefined ? { topic, idempotencyKey: newIdempotencyKey() } : null);
    if (!frozen) return false;
    inFlight.current = true;
    intentRef.current = frozen;
    setIntent(frozen);
    setBusy(true);
    setFailure(null);
    try {
      await send(workspaceId, { topic: frozen.topic }, frozen.idempotencyKey);
      intentRef.current = null;
      if (mounted.current) setIntent(null);
      publishedRef.current();
      return true;
    } catch (error) {
      const failed = writeFailure(error);
      if (failed.kind === "unknown" || retained) {
        // Unknown never re-signs: only the same publication (same key) may be re-checked.
        if (mounted.current) setFailure({ kind: "unknown" });
      } else {
        intentRef.current = null;
        if (mounted.current) { setIntent(null); setFailure({ kind: "rejected", reason: failureText(failed) }); }
      }
      return false;
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [host, workspaceId, failureText]);

  const reset = useCallback(() => { if (!intentRef.current && mounted.current) setFailure(null); }, []);

  return { intent, busy, failure, publish, reset };
}
