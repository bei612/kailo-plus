// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/useTypingBroadcast.ts: the original throttle (at most once every
// 3 seconds per channel, failures ignored). The Web transport is the BFF typing route (DD-120):
// Core signs the main-channel 20002 over the person's existing session connection.
import { useCallback, useRef } from "react";

const TYPING_SEND_INTERVAL_MS = 3_000;

export function useTypingBroadcast(
  scopeKey: string | null | undefined,
  send: () => Promise<void>,
) {
  const lastSentRef = useRef(0);
  const lastScopeRef = useRef(scopeKey);
  const scopeRef = useRef(scopeKey);
  const sendRef = useRef(send);
  scopeRef.current = scopeKey;
  sendRef.current = send;

  return useCallback(() => {
    const scope = scopeRef.current;
    if (!scope) return;
    if (lastScopeRef.current !== scope) {
      lastScopeRef.current = scope;
      lastSentRef.current = 0;
    }
    const now = Date.now();
    if (now - lastSentRef.current < TYPING_SEND_INTERVAL_MS) return;
    lastSentRef.current = now;
    // Any failure, synchronous or not, is ignored like the original.
    void Promise.resolve().then(() => sendRef.current()).catch(() => {});
  }, []);
}
