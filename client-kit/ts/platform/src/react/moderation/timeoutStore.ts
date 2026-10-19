// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/moderation/lib/timeoutStore.ts: the member's own community timeout,
// learned reactively from a send rejection (there is no self-restriction read: members do not
// read the restriction list). Kailo receives it as the structured PUBLISH_REJECTED
// restriction (DD-125(2), V-SCN-129) instead of parsing the Relay text.
import * as React from "react";
import { isTimeoutActive, timeoutFromRestriction, type PublishRestriction } from "../../moderation";

export type TimeoutState = {
  /** True while the member is timed out (write-blocked). */
  active: boolean;
  /** Expiry in epoch ms, or null when the Relay gave no parseable timestamp. */
  expiresAtMs: number | null;
};

const INACTIVE: TimeoutState = { active: false, expiresAtMs: null };
let snapshot: TimeoutState = INACTIVE;
const listeners = new Set<() => void>();

function emit(next: TimeoutState) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Record a timeout from a publish restriction. Returns true when it was a timeout, so the
 * caller can suppress its generic error surface; any other rejection is left untouched.
 */
export function recordTimeoutFromRestriction(restriction: PublishRestriction | undefined): boolean {
  const rejection = timeoutFromRestriction(restriction);
  if (!rejection) return false;
  emit({ active: true, expiresAtMs: rejection.expiresAtMs });
  return true;
}

/** An accepted send proves the write-block is lifted. */
export function clearTimeoutState(): void {
  if (!snapshot.active && snapshot.expiresAtMs === null) return;
  emit(INACTIVE);
}

export function getTimeoutSnapshot(): TimeoutState {
  return snapshot;
}

function currentState(state: TimeoutState, nowMs: number): TimeoutState {
  if (!state.active || !isTimeoutActive(state.expiresAtMs, nowMs)) return INACTIVE;
  return state;
}

/** Re-renders on record/clear and ticks each second while a known-expiry timeout is active. */
export function useTimeoutState(): TimeoutState {
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const state = React.useSyncExternalStore(subscribe, () => snapshot, () => INACTIVE);
  React.useEffect(() => {
    if (!state.active || state.expiresAtMs === null) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [state.active, state.expiresAtMs]);
  return currentState(state, nowMs);
}
