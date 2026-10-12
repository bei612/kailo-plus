// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/home/useInboxSelectionAnchor.ts::useInboxSelectionAnchor.
// One selection state machine; hosts retain event transport and fresh admission.
import * as React from "react";

type AnchorItem = { id: string };
type Attempt = "success" | "terminal-failed" | "missing"
  | { membershipKey: string } | { controller: AbortController };
type Saved<T> = { scope: unknown; eventId: string; item: T };

export function useInboxSelectionAnchor<T extends AnchorItem>({
  feedItems, selectedEventId, scopeKey, recoveryKey = scopeKey, membershipKey,
  ready = true, coldEnabled = true, isRetainedVisible, recover,
}: {
  feedItems: readonly T[];
  selectedEventId: string | null;
  /** Identity/session boundary, not an authorization grant. */
  scopeKey: unknown;
  /** Web uses its fresh admitted snapshot; Native uses the active session. */
  recoveryKey?: unknown;
  membershipKey: string;
  ready?: boolean;
  coldEnabled?: boolean;
  isRetainedVisible: (item: T) => boolean;
  recover: (eventId: string, signal: AbortSignal) => Promise<T | null>;
}) {
  const epoch = React.useMemo(() => ({}), [scopeKey, recoveryKey]);
  const [latch, setLatch] = React.useState<Saved<T> | null>(null);
  const [cold, setCold] = React.useState<(Saved<T> & { epoch: object }) | null>(null);
  const [attemptState, setAttempts] = React.useState<{ epoch: object; values: Map<string, Attempt> }>({ epoch, values: new Map() });
  const activeRequest = React.useRef<AbortController | null>(null);
  const latest = React.useRef({ epoch, scopeKey, selectedEventId, ready, isRetainedVisible, recover, membershipKey });
  latest.current = { epoch, scopeKey, selectedEventId, ready, isRetainedVisible, recover, membershipKey };
  const direct = ready && selectedEventId ? feedItems.find(item => item.id === selectedEventId) ?? null : null;
  const matchingLatch = latch && latch.scope === scopeKey && latch.eventId === selectedEventId ? latch : null;
  const retained = ready && matchingLatch && isRetainedVisible(matchingLatch.item) ? matchingLatch.item : null;
  const recovered = ready && cold && cold.scope === scopeKey && cold.epoch === epoch && cold.eventId === selectedEventId
    && isRetainedVisible(cold.item) ? cold.item : null;
  const attempt = selectedEventId && attemptState.epoch === epoch ? attemptState.values.get(selectedEventId) : undefined;
  const retryMembership = typeof attempt === "object" && "membershipKey" in attempt && attempt.membershipKey !== membershipKey;
  // Synchronous, protecting the first cold render from auto-selection.
  const coldResolutionPending = Boolean(ready && coldEnabled && selectedEventId && !direct && !matchingLatch && !recovered
    && (attempt === undefined || typeof attempt === "object" && "controller" in attempt || retryMembership));

  React.useEffect(() => {
    return () => {
      const controller = activeRequest.current;
      if (!controller) return;
      controller.abort();
      activeRequest.current = null;
      setAttempts(previous => {
        const value = previous.epoch === epoch && selectedEventId ? previous.values.get(selectedEventId) : undefined;
        if (typeof value !== "object" || !("controller" in value) || value.controller !== controller) return previous;
        const values = new Map(previous.values); values.delete(selectedEventId!); return { epoch, values };
      });
    };
    // A membership refresh revalidates the same in-flight read against latest
    // host facts; only selection/admission changes cancel that read.
  }, [epoch, scopeKey, selectedEventId, ready, coldEnabled, Boolean(direct), Boolean(matchingLatch), Boolean(recovered)]);

  React.useEffect(() => {
    if (!selectedEventId) { setLatch(null); return; }
    if (direct) setLatch(previous => previous && previous.scope === scopeKey && previous.eventId === selectedEventId
      ? previous : { scope: scopeKey, eventId: selectedEventId, item: direct });
    else setLatch(previous => previous && previous.scope === scopeKey && previous.eventId === selectedEventId ? previous : null);
  }, [direct, selectedEventId, scopeKey]);

  React.useEffect(() => {
    if (!selectedEventId) { setAttempts({ epoch, values: new Map() }); setCold(null); return; }
    if (!ready || !coldEnabled || direct || matchingLatch || recovered) return;
    if (attempt === "success" || attempt === "terminal-failed" || attempt === "missing"
      || typeof attempt === "object" && ("controller" in attempt && !attempt.controller.signal.aborted
        || "membershipKey" in attempt && !retryMembership)) return;
    const id = selectedEventId;
    const controller = new AbortController();
    activeRequest.current = controller;
    const record = (value: Attempt) => setAttempts(previous => {
      const values = new Map(previous.epoch === epoch ? previous.values : []);
      values.set(id, value); return { epoch, values };
    });
    record({ controller });
    const current = () => !controller.signal.aborted && latest.current.epoch === epoch
      && latest.current.selectedEventId === id && latest.current.ready;
    void Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return latest.current.recover(id, controller.signal);
    }).then(item => {
      if (!current()) return;
      if (!item) { record("missing"); return; }
      if (item.id !== id) throw new Error("Inbox anchor identity changed");
      if (!latest.current.isRetainedVisible(item)) { record({ membershipKey: latest.current.membershipKey }); return; }
      record("success");
      setCold({ scope: scopeKey, epoch, eventId: id, item });
    }).catch(() => { if (current()) record("terminal-failed"); });
    // Attempt writes are outcomes, not a new transport dependency. Host callbacks
    // are read through latest; identity/snapshot/membership changes drive recovery.
  }, [epoch, scopeKey, selectedEventId, ready, coldEnabled, Boolean(direct), Boolean(matchingLatch), Boolean(recovered), membershipKey]);

  return { feedItems, activeLatchedItem: direct ?? retained ?? recovered, coldResolutionPending,
    coldResolutionFailed: ready && attempt === "terminal-failed" };
}
