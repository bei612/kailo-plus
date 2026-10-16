// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/presence/lib/presence.ts: original live-event parsing, cache merge,
// heartbeat/idle constants and dot/chip styling. Labels resolve through the shared catalog;
// DD-120 (5) per-person aggregation is the Kailo addition at the end of this module.
import type { PlatformMessageKey } from "../../../i18n";

export type PresenceStatus = "online" | "away" | "offline";
export type PresenceLookup = Record<string, PresenceStatus>;

export function isPresenceStatus(value: unknown): value is PresenceStatus {
  return value === "online" || value === "away" || value === "offline";
}

// Live kind:20001 events are self-signed by their author; the subject is
// always the event author. A p tag is NOT trusted here — a client could forge
// one to spoof another user. The relay-signed REST/seed path is the only place
// a p-tag subject is trusted. Returns null for unknown statuses.
export function parseLivePresenceEvent(event: {
  pubkey: string;
  content: string;
}): { pubkey: string; status: PresenceStatus } | null {
  const status = event.content;
  if (status !== "online" && status !== "away" && status !== "offline") {
    return null;
  }
  return { pubkey: event.pubkey.toLowerCase(), status };
}

export function activePresencePubkeys(
  queries: Array<{ queryKey: readonly unknown[]; isActive: () => boolean }>,
): string[] {
  const pubkeys = new Set<string>();
  for (const query of queries) {
    if (!query.isActive() || query.queryKey[0] !== "presence") continue;
    for (const value of query.queryKey.slice(1)) {
      if (typeof value === "string" && value) pubkeys.add(value.toLowerCase());
    }
  }
  return [...pubkeys].sort();
}

// Presence query keys are ["presence", ...normalizedSortedPubkeys]; a query
// "wants" an update only for a pubkey it actually requested.
export function presenceQueryWantsPubkey(
  queryKey: readonly unknown[],
  pubkey: string,
): boolean {
  return queryKey.length > 1 && queryKey.includes(pubkey);
}

// get_presence omits offline/unknown pubkeys, so a live online event often
// targets a pubkey absent from the lookup — merge it in rather than dropping it.
export function mergePresenceUpdate(
  old: PresenceLookup | undefined,
  pubkey: string,
  status: PresenceStatus,
): PresenceLookup | undefined {
  if (!old) return old;
  if (old[pubkey] === status) return old;
  return { ...old, [pubkey]: status };
}

// Keep the local optimistic cache and relay expiry at three heartbeat windows.
// The relay owns the authoritative TTL; deploy its TTL increase before shipping
// a desktop build with a slower heartbeat.
export const PRESENCE_HEARTBEAT_INTERVAL_MS = 60_000;
export const PRESENCE_TTL_SECONDS = 3 * (PRESENCE_HEARTBEAT_INTERVAL_MS / 1000);

// Away means "human not at the machine" (Slack/Discord semantics), never
// "Buzz is not the focused window". OS-wide idle is authoritative when the
// platform exposes it; otherwise fall back to in-app activity.
export const PRESENCE_IDLE_TIMEOUT_MS = 10 * 60_000;

export function resolveAutomaticPresenceStatus(
  osIdleSeconds: number | null,
  lastActivityAt: number,
  now: number,
): PresenceStatus {
  if (osIdleSeconds !== null) {
    return osIdleSeconds * 1000 >= PRESENCE_IDLE_TIMEOUT_MS ? "away" : "online";
  }
  return now - lastActivityAt >= PRESENCE_IDLE_TIMEOUT_MS ? "away" : "online";
}

const PRESENCE_LABEL_KEYS = {
  online: "presence.online",
  away: "presence.away",
  offline: "presence.offline",
} as const satisfies Record<PresenceStatus, PlatformMessageKey>;

/** Original getPresenceLabel, resolved through the shared en/zh-CN catalog. */
export function getPresenceLabelKey(status: PresenceStatus): PlatformMessageKey {
  return PRESENCE_LABEL_KEYS[status];
}

export function getPresenceDotClassName(status: PresenceStatus) {
  switch (status) {
    case "online":
      return "bg-emerald-500";
    case "away":
      return "bg-amber-500";
    case "offline":
      return "bg-muted-foreground/35";
  }
}

// Chip styling for the presence pill (colored fill + matching text, no dot).
export function getPresenceChipClassName(status: PresenceStatus) {
  switch (status) {
    case "online":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
    case "away":
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
    case "offline":
      return "bg-muted-foreground/15 text-muted-foreground";
  }
}

/**
 * DD-120 (5): one Human may hold several bound pubkeys (Web SERVER key plus each
 * native device). The person is online if any key is online, else away if any key is
 * away, else offline only when a key has an explicit offline fact. A key without a
 * fact contributes nothing: missing presence is never painted offline.
 */
export function aggregatePresence(
  lookup: PresenceLookup | undefined,
  pubkeys: readonly string[],
): PresenceStatus | undefined {
  if (!lookup) return undefined;
  let result: PresenceStatus | undefined;
  for (const pubkey of pubkeys) {
    const status = lookup[pubkey.trim().toLowerCase()];
    if (status === "online") return "online";
    if (status === "away") result = "away";
    else if (status === "offline" && result === undefined) result = "offline";
  }
  return result;
}
