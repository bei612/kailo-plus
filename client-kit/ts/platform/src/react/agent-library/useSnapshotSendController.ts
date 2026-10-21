/**
 * Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/ui/useSnapshotSendController.ts.
 *
 * Payload-agnostic send controller for sharing a snapshot package to a direct message. DD-131(7):
 * the package is a governed ExportPackage (owner-approved, see useSnapshotExport) rather than a
 * locally encoded file, the destination is prepared with the governed `conversation.open`, and the
 * host publishes it as an ordinary attachment through its existing path. The original
 * single-concurrency guard is kept; the original timeout/moderation-DM checks are Core's on publish.
 * An unknown publication keeps its idempotency key so only the same send is re-checked.
 */
import * as React from "react";
import type { ConversationView } from "@client-kit/contracts";
import { newIdempotencyKey } from "../../governance";
import { isOutcomeUnknown } from "../../transport";
import type { SnapshotFile } from "./snapshotFlow";

export type SendPhase = "idle" | "preparing" | "uploading" | "sending" | "done" | "error" | "unknown";

export type SnapshotSendState = {
  phase: SendPhase;
  error: string | null;
};

/** Original pure single-concurrency guard: a concurrent call gets `false` immediately. */
export function createSendGuard(): {
  runGuarded: (action: () => Promise<boolean>) => Promise<boolean>;
  get inFlight(): boolean;
} {
  let inFlight = false;
  return {
    runGuarded: async (action) => {
      if (inFlight) return false;
      inFlight = true;
      try {
        return await action();
      } finally {
        inFlight = false;
      }
    },
    get inFlight() {
      return inFlight;
    },
  };
}

type SendIntent = { key: string; conversation: ConversationView | null };

/** prepare destination → send attachment, behind one guard; never throws. */
export async function runSendPipeline(deps: {
  file: SnapshotFile;
  label: string;
  intent: SendIntent;
  resolveConversation: () => Promise<ConversationView>;
  sendFn: (conversation: ConversationView, file: SnapshotFile, label: string, key: string) => Promise<void>;
  setStateFn: (state: SnapshotSendState) => void;
}): Promise<boolean> {
  const { file, label, intent, resolveConversation, sendFn, setStateFn } = deps;
  setStateFn({ phase: "preparing", error: null });
  if (!intent.conversation) {
    try {
      intent.conversation = await resolveConversation();
    } catch (error) {
      setStateFn({ phase: "error", error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }
  setStateFn({ phase: "sending", error: null });
  try {
    await sendFn(intent.conversation, file, label, intent.key);
  } catch (error) {
    setStateFn({ phase: isOutcomeUnknown(error) ? "unknown" : "error", error: error instanceof Error ? error.message : String(error) });
    return false;
  }
  setStateFn({ phase: "done", error: null });
  return true;
}

export function useSnapshotSendController(
  sendFn: (conversation: ConversationView, file: SnapshotFile, label: string, key: string) => Promise<void>,
) {
  const [state, setState] = React.useState<SnapshotSendState>({ phase: "idle", error: null });
  const stateRef = React.useRef(state);
  const commitState = React.useCallback((next: SnapshotSendState) => {
    stateRef.current = next;
    setState(next);
  }, []);
  const guardRef = React.useRef(createSendGuard());
  const intentRef = React.useRef<SendIntent | null>(null);

  /** Send `file` once; after an unknown outcome the same intent (key, conversation) is re-checked. */
  async function beginSend(file: SnapshotFile, resolveConversation: () => Promise<ConversationView>, label: string): Promise<boolean | null> {
    if (guardRef.current.inFlight) return null;
    const intent = intentRef.current ?? { key: newIdempotencyKey(), conversation: null };
    intentRef.current = intent;
    const sent = await guardRef.current.runGuarded(() => runSendPipeline({ file, label, intent, resolveConversation, sendFn, setStateFn: commitState }));
    if (stateRef.current.phase !== "unknown") intentRef.current = null;
    return sent;
  }

  const reset = React.useCallback(() => {
    if (!guardRef.current.inFlight && stateRef.current.phase !== "unknown") {
      intentRef.current = null;
      commitState({ phase: "idle", error: null });
    }
  }, [commitState]);

  return {
    state,
    getCurrentError: () => stateRef.current.error,
    beginSend,
    reset,
  };
}
