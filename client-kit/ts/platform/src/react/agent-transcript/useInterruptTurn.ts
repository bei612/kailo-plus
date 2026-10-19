// DD-84 as widened by DD-125(6): the original "Stop current turn" is the governed
// Agent turn cancel control (task.cancel.agent.invoke.v1), offered by Core only to
// the original initiator or an Installation `manage` holder (activeTurn.cancelActionKey).
// One idempotency key per intent is kept while the outcome is UNKNOWN; cancel
// accepted is not a terminal turn state (the transcript shows the real end).
import * as React from "react";
import {
  ActionDispatchState,
  ActionGateState,
  type ActionCommand,
  type ActionSubmission,
  type AgentActiveTurnView,
} from "@client-kit/contracts";

import { newIdempotencyKey } from "../../governance";
import { writeFailure, type WriteFailure } from "../../transport";
import { useBffClient } from "../context";

/** Whether a submission proves its write outcome; anything else stays a pending intent. */
function settled(result: ActionSubmission): boolean {
  return result.dispatchState !== ActionDispatchState.Unknown
    && result.gateState !== ActionGateState.Evaluating
    && !(result.gateState === ActionGateState.Allowed
      && result.dispatchState === ActionDispatchState.NotDispatched);
}

export type InterruptOutcome =
  | { kind: "requested" }
  | { kind: "unknown"; operationId?: string }
  | { kind: "failed"; failure: WriteFailure };

export function useInterruptTurn(activeTurn: AgentActiveTurnView | undefined) {
  const client = useBffClient();
  const [intent, setIntent] = React.useState<ActionCommand | null>(null);
  const [busy, setBusy] = React.useState(false);
  const inFlight = React.useRef(false);
  const cancelKey = activeTurn?.cancelActionKey;
  const original = activeTurn?.originalActionExecutionId;

  // A pending intent belongs to one original action; another turn needs a new one.
  React.useEffect(() => {
    if (intent && original && intent.originalActionExecutionId !== original) {
      setIntent(null);
    }
  }, [intent, original]);

  const interrupt = React.useCallback(async (): Promise<InterruptOutcome | null> => {
    if (inFlight.current) return null;
    const command: ActionCommand | null = intent ?? (cancelKey && original ? {
      actionKey: cancelKey,
      idempotencyKey: newIdempotencyKey(),
      originalActionExecutionId: original,
    } : null);
    if (!command) return null;
    inFlight.current = true;
    setBusy(true);
    setIntent(command);
    try {
      const result = await client.submitAction(command);
      if (!result || result.actionKey !== command.actionKey || !result.operationId) {
        throw new Error("receipt");
      }
      if (!settled(result)) {
        return { kind: "unknown", operationId: result.operationId };
      }
      setIntent(null);
      if (result.gateState !== ActionGateState.Allowed) {
        return { kind: "failed", failure: { kind: "rejected", reason: result.reason, detail: "" } };
      }
      return { kind: "requested" };
    } catch (error) {
      const failure = writeFailure(error);
      if (failure.kind === "unknown") return { kind: "unknown", operationId: failure.operationId };
      setIntent(null);
      return { kind: "failed", failure };
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [cancelKey, client, intent, original]);

  return {
    available: Boolean(cancelKey) || intent !== null,
    busy,
    /** An UNKNOWN outcome keeps this intent; retrying sends the same key. */
    pending: intent !== null,
    interrupt,
  };
}
