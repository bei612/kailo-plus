// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/presence/hooks.ts: original presence query, self mutation and the
// heartbeat/idle session. Transport is injected (./context.ts): the BFF answers the
// Relay-signed snapshot and signs the person's own 20001, so the original Relay live
// subscription/reconciler is replaced by the host feeding admitted stream frames into
// applyLivePresenceEvent. Browsers expose no OS idle, so in-app activity is their only signal;
// a native host that injects osIdleSeconds makes OS-wide idle authoritative, as the original.
import * as React from "react";
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { normalizePubkey } from "../conversations/pubkey";
import { type PresenceHost, type PresenceSession, usePresenceHost } from "./context";
import {
  isPresenceStatus,
  mergePresenceUpdate,
  parseLivePresenceEvent,
  presenceQueryWantsPubkey,
  PRESENCE_HEARTBEAT_INTERVAL_MS,
  PRESENCE_TTL_SECONDS,
  resolveAutomaticPresenceStatus,
  type PresenceLookup,
  type PresenceStatus,
} from "./lib/presence";

const PRESENCE_STATUS_TICK_INTERVAL_MS = 30_000;
/** Keeps focused polling for presence at the established 60-second backstop cadence. */
export const PRESENCE_REFETCH_INTERVAL_MS = 60_000;
/** Suppresses the focus refetch until presence data is genuinely stale.
 * The live stream frames (setQueriesData) are the primary freshness path;
 * the 60s poll is the backstop. */
export const PRESENCE_FOCUS_STALE_TIME_MS = 5 * 60_000;

/** Focus-refetch policy for the presence query. */
export const presenceFocusRefetchPolicy = {
  staleTime: PRESENCE_FOCUS_STALE_TIME_MS,
  refetchOnWindowFocus: false,
} as const;
const PRESENCE_ACTIVITY_THROTTLE_MS = 1_000;
const PRESENCE_PREFERENCE_STORAGE_KEY = "buzz-presence-preference";
/** WebPresenceQueryRequest.pubkeys maxItems (contracts/api/web_presence_query_request.schema.json). */
export const PRESENCE_QUERY_CHUNK_SIZE = 200;

type PresencePreference = "auto" | "away" | "offline" | null;

function normalizePubkeys(pubkeys: readonly string[]) {
  return [...new Set(pubkeys.map((pubkey) => normalizePubkey(pubkey)))]
    .filter((pubkey) => pubkey.length > 0)
    .sort();
}

/** Canonical normalized key shared by observers and action-time readers. */
export function presenceQueryKey(pubkeys: readonly string[]) {
  return ["presence", ...normalizePubkeys(pubkeys)] as const;
}

/**
 * One chunk of the BFF snapshot. Only requested pubkeys with a recognised status are
 * kept; a pubkey without a fact stays absent (DD-120 (5)), never offline.
 */
export function presenceLookupFromPage(
  page: { presences?: unknown } | null | undefined,
  requested: ReadonlySet<string>,
): PresenceLookup {
  if (!page || !Array.isArray(page.presences)) {
    throw new Error("Invalid presence response");
  }
  const lookup: PresenceLookup = {};
  for (const view of page.presences as unknown[]) {
    if (!view || typeof view !== "object") throw new Error("Invalid presence entry");
    const { pubkey, status } = view as { pubkey?: unknown; status?: unknown };
    if (typeof pubkey !== "string" || !isPresenceStatus(status)) {
      throw new Error("Invalid presence entry");
    }
    const normalized = normalizePubkey(pubkey);
    if (requested.has(normalized)) lookup[normalized] = status;
  }
  return lookup;
}

export async function fetchPresenceLookup(
  pubkeys: readonly string[],
  query: PresenceHost["queryPresence"],
): Promise<PresenceLookup> {
  const normalized = normalizePubkeys(pubkeys);
  const chunks: string[][] = [];
  for (let index = 0; index < normalized.length; index += PRESENCE_QUERY_CHUNK_SIZE) {
    chunks.push(normalized.slice(index, index + PRESENCE_QUERY_CHUNK_SIZE));
  }
  const pages = await Promise.all(
    chunks.map(async (chunk) => presenceLookupFromPage(await query(chunk), new Set(chunk))),
  );
  return Object.assign({}, ...pages) as PresenceLookup;
}

function presencePreferenceStorageKey(pubkey: string) {
  return `${PRESENCE_PREFERENCE_STORAGE_KEY}:${pubkey}`;
}

function readStoredPresencePreference(pubkey: string): PresencePreference {
  if (typeof window === "undefined" || pubkey.length === 0) {
    return null;
  }

  const value = window.localStorage.getItem(
    presencePreferenceStorageKey(pubkey),
  );
  return value === "auto" || value === "away" || value === "offline"
    ? value
    : null;
}

function writeStoredPresencePreference(
  pubkey: string,
  preference: PresencePreference,
) {
  if (typeof window === "undefined" || pubkey.length === 0) {
    return;
  }

  if (preference === null) {
    window.localStorage.removeItem(presencePreferenceStorageKey(pubkey));
    return;
  }

  window.localStorage.setItem(presencePreferenceStorageKey(pubkey), preference);
}

function resolveAutomaticPresenceStatusSync(
  lastActivityAt: number,
  now: number,
): PresenceStatus {
  return resolveAutomaticPresenceStatus(null, lastActivityAt, now);
}

/** Requires a PresenceHost; without one the query stays disabled and no fact is invented. */
export function usePresenceQuery(
  pubkeys: readonly string[],
  options?: {
    enabled?: boolean;
  },
) {
  const host = usePresenceHost();
  const normalizedPubkeys = normalizePubkeys(pubkeys);
  const enabled =
    host !== null && (options?.enabled ?? true) && normalizedPubkeys.length > 0;

  return useQuery<PresenceLookup>({
    enabled,
    queryKey: presenceQueryKey(normalizedPubkeys),
    queryFn: () => {
      if (!host) throw new Error("Presence host unavailable");
      return fetchPresenceLookup(normalizedPubkeys, host.queryPresence);
    },
    // Backstop poll: catches TTL expiry (closed pages) and members outside the
    // active stream's roster. Stream frames handle the fast path. TanStack pauses
    // the interval while the document is hidden.
    refetchInterval: PRESENCE_REFETCH_INTERVAL_MS,
    retry: false,
    ...presenceFocusRefetchPolicy,
  });
}

/**
 * The original usePresenceSubscription handler: a live, member-signed 20001 from an
 * admitted stream updates only successful lookups that requested its author.
 */
export function applyLivePresenceEvent(
  queryClient: Pick<QueryClient, "setQueriesData">,
  event: { pubkey: string; content: string },
): boolean {
  const parsed = parseLivePresenceEvent(event);
  if (!parsed) return false;
  const { pubkey, status } = parsed;
  queryClient.setQueriesData<PresenceLookup>(
    {
      queryKey: ["presence"],
      // A single live author cannot heal a failed aggregate snapshot:
      // setQueriesData would mark every cached sibling successful again.
      predicate: (query) =>
        query.state.status === "success" &&
        presenceQueryWantsPubkey(query.queryKey, pubkey),
    },
    (old) => mergePresenceUpdate(old, pubkey, status),
  );
  return true;
}

export function useSetPresenceMutation(pubkey?: string) {
  const host = usePresenceHost();
  const queryClient = useQueryClient();
  const normalizedPubkey = pubkey?.trim().toLowerCase() ?? "";

  return useMutation({
    mutationFn: async (status: PresenceStatus) => {
      if (!host) throw new Error("Presence host unavailable");
      await host.updatePresence(status);
      return {
        status,
        ttlSeconds: status === "offline" ? 0 : PRESENCE_TTL_SECONDS,
      };
    },
    onSuccess: ({ status }) => {
      if (normalizedPubkey.length === 0) return;
      queryClient.setQueriesData<PresenceLookup>(
        {
          queryKey: ["presence"],
          // A successful self heartbeat is not a fresh roster snapshot.
          predicate: (query) =>
            query.state.status === "success" &&
            presenceQueryWantsPubkey(query.queryKey, normalizedPubkey),
        },
        (old) => mergePresenceUpdate(old, normalizedPubkey, status),
      );
    },
  });
}

export function usePresenceSession(pubkey?: string): PresenceSession {
  const normalizedPubkey = pubkey?.trim().toLowerCase() ?? "";
  const presenceQuery = usePresenceQuery(
    normalizedPubkey.length > 0 ? [normalizedPubkey] : [],
    { enabled: normalizedPubkey.length > 0 },
  );
  const setPresenceMutation = useSetPresenceMutation(normalizedPubkey);
  const osIdleSeconds = usePresenceHost()?.osIdleSeconds;
  const [presencePreference, setPresencePreference] =
    React.useState<PresencePreference>(() =>
      readStoredPresencePreference(normalizedPubkey),
    );
  // Activity is tracked in a REF, and React state holds only the DERIVED
  // status, so a keystroke anywhere in the app does not re-render the host;
  // setState fires on online <-> away transitions only.
  const lastActivityAtRef = React.useRef(Date.now());
  const [automaticStatus, setAutomaticStatus] = React.useState<PresenceStatus>(
    () =>
      resolveAutomaticPresenceStatusSync(lastActivityAtRef.current, Date.now()),
  );
  const automaticStatusRef = React.useRef(automaticStatus);
  const skipNextSyncRef = React.useRef<PresenceStatus | null>(null);

  const applyAutomaticStatus = React.useEffectEvent((next: PresenceStatus) => {
    if (next !== automaticStatusRef.current) {
      automaticStatusRef.current = next;
      setAutomaticStatus(next);
    }
  });

  const reevaluateAutomaticStatus = React.useEffectEvent(() => {
    applyAutomaticStatus(
      resolveAutomaticPresenceStatusSync(lastActivityAtRef.current, Date.now()),
    );
  });

  // OS-wide idle is authoritative when the host provides it; async, so tick-driven only.
  const reevaluateFromOsIdle = React.useEffectEvent(async () => {
    if (!osIdleSeconds) {
      reevaluateAutomaticStatus();
      return;
    }
    const seconds = await osIdleSeconds().catch(() => null);
    if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) {
      // Keep the fallback clock consistent so a later null reading can't flap.
      lastActivityAtRef.current = Math.max(
        lastActivityAtRef.current,
        Date.now() - seconds * 1000,
      );
      applyAutomaticStatus(
        resolveAutomaticPresenceStatus(seconds, lastActivityAtRef.current, Date.now()),
      );
      return;
    }
    reevaluateAutomaticStatus();
  });

  React.useEffect(() => {
    setPresencePreference(readStoredPresencePreference(normalizedPubkey));
    lastActivityAtRef.current = Date.now();
    reevaluateAutomaticStatus();
  }, [normalizedPubkey]);

  React.useEffect(() => {
    writeStoredPresencePreference(normalizedPubkey, presencePreference);
  }, [normalizedPubkey, presencePreference]);

  const recordActivity = React.useEffectEvent(() => {
    lastActivityAtRef.current = Date.now();
    reevaluateAutomaticStatus();
  });

  React.useEffect(() => {
    if (normalizedPubkey.length === 0) {
      return;
    }

    // Activity signal: wheel/pointermove count (passive reading), throttled
    // to 1/s; window visibility never affects presence.
    let lastRecordedAt = 0;

    function handleUserActivity() {
      const now = Date.now();
      if (now - lastRecordedAt < PRESENCE_ACTIVITY_THROTTLE_MS) {
        return;
      }
      lastRecordedAt = now;
      recordActivity();
    }

    window.addEventListener("pointerdown", handleUserActivity, true);
    window.addEventListener("pointermove", handleUserActivity, true);
    window.addEventListener("wheel", handleUserActivity, {
      capture: true,
      passive: true,
    });
    window.addEventListener("keydown", handleUserActivity, true);
    window.addEventListener("focus", handleUserActivity);

    return () => {
      window.removeEventListener("pointerdown", handleUserActivity, true);
      window.removeEventListener("pointermove", handleUserActivity, true);
      window.removeEventListener("wheel", handleUserActivity, {
        capture: true,
      });
      window.removeEventListener("keydown", handleUserActivity, true);
      window.removeEventListener("focus", handleUserActivity);
    };
  }, [normalizedPubkey]);

  React.useEffect(() => {
    if (normalizedPubkey.length === 0) {
      return;
    }

    void reevaluateFromOsIdle();
    const intervalId = window.setInterval(() => {
      void reevaluateFromOsIdle();
    }, PRESENCE_STATUS_TICK_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [normalizedPubkey]);
  const currentStatus: PresenceStatus =
    normalizedPubkey.length === 0
      ? "offline"
      : presencePreference === "offline"
        ? "offline"
        : presencePreference === "away"
          ? "away"
          : automaticStatus;

  const updatePresence = React.useCallback(
    async (status: PresenceStatus) => {
      const previousPreference = presencePreference;
      const nextPreference: PresencePreference =
        status === "online" ? "auto" : status;

      if (nextPreference === "auto") {
        lastActivityAtRef.current = Date.now();
        reevaluateAutomaticStatus();
      }

      setPresencePreference(nextPreference);
      skipNextSyncRef.current = status;

      try {
        await setPresenceMutation.mutateAsync(status);
      } catch (error) {
        skipNextSyncRef.current = null;
        setPresencePreference(previousPreference);
        throw error;
      }
    },
    [presencePreference, setPresenceMutation],
  );

  const syncPresence = React.useEffectEvent((status: PresenceStatus) => {
    void setPresenceMutation.mutateAsync(status).catch(() => {
      return;
    });
  });

  React.useEffect(() => {
    if (normalizedPubkey.length === 0) {
      return;
    }

    if (skipNextSyncRef.current === currentStatus) {
      skipNextSyncRef.current = null;
      return;
    }

    syncPresence(currentStatus);
  }, [currentStatus, normalizedPubkey]);

  React.useEffect(() => {
    if (normalizedPubkey.length === 0 || currentStatus === "offline") {
      return;
    }

    const intervalId = window.setInterval(() => {
      // A browser that reports itself offline cannot reach the BFF; the next
      // tick after reconnection renews the lease.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return;
      }
      syncPresence(currentStatus);
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [currentStatus, normalizedPubkey]);

  const resyncNow = React.useEffectEvent(() => {
    if (normalizedPubkey.length > 0) syncPresence(currentStatus);
  });
  const resync = React.useCallback(() => resyncNow(), []);

  return {
    currentStatus,
    isLoading: presenceQuery.isLoading,
    isPending: setPresenceMutation.isPending,
    error:
      setPresenceMutation.error instanceof Error
        ? setPresenceMutation.error
        : presenceQuery.error instanceof Error
          ? presenceQuery.error
          : null,
    setStatus: updatePresence,
    resync,
  };
}
