// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/user-status/hooks.ts: original replacement fences, expiry timers,
// live-event merge, 120 s backstop and self mutation. Transport is injected (../presence/context):
// reads are the BFF's verified 30315 page (a cleared status is omitted, DD-120 (4)) instead of a
// Relay filter, the host feeds admitted stream frames into applyUserStatusEventToQueries, and the
// person's own status is published by Core under DD-81 with one Idempotency-Key per intent.
import * as React from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  QueryClient,
  QueryClientContext,
} from "@tanstack/react-query";
import type { WebUserStatusUpdateRequest } from "@client-kit/contracts";

import { newIdempotencyKey } from "../../governance";
import { isOutcomeUnknown } from "../../transport";
import { normalizePubkey } from "../conversations/pubkey";
import { KIND_USER_STATUS } from "../messages/thread/kinds";
import { type PresenceHost, usePresenceHost } from "../presence/context";
import type { UserStatus, UserStatusInput, UserStatusLookup } from "./types";

// Hosts without a presence surface keep rendering exactly as before: the query stays
// disabled on a detached client instead of requiring an application QueryClient.
const DETACHED_QUERY_CLIENT = new QueryClient();

type StatusEvent = {
  id: string;
  pubkey: string;
  kind?: number;
  created_at: number;
  content: string;
  tags: string[][];
};

function normalizePubkeys(pubkeys: readonly string[]) {
  return [...new Set(pubkeys.map((pk) => normalizePubkey(pk)))]
    .filter((pk) => pk.length > 0)
    .sort();
}

type UserStatusVersion = { updatedAt: number; eventId: string };
type UserStatusCacheEntry = UserStatus | null;

function statusVersionIsAtLeast(
  current: Pick<UserStatus, "updatedAt" | "eventId"> | undefined,
  candidate: UserStatusVersion,
): boolean {
  if (!current) return false;
  if (current.updatedAt !== candidate.updatedAt) {
    return current.updatedAt > candidate.updatedAt;
  }
  if (!current.eventId) return false;
  return current.eventId <= candidate.eventId;
}

function newerUserStatus(
  current: UserStatusCacheEntry | undefined,
  candidate: UserStatus,
): UserStatus {
  return statusVersionIsAtLeast(current ?? undefined, {
    updatedAt: candidate.updatedAt,
    eventId: candidate.eventId ?? "",
  })
    ? (current ?? candidate)
    : candidate;
}

function hiddenUserStatus(version: UserStatusVersion): UserStatus {
  return {
    text: "",
    emoji: "",
    updatedAt: version.updatedAt,
    eventId: version.eventId,
  };
}

export function visibleUserStatus(
  status: UserStatusCacheEntry | undefined,
): UserStatus | null {
  return status && (status.text || status.emoji) ? status : null;
}

/**
 * DD-120 (5) companion: a person with several bound keys shows the newest visible
 * status among them (each key publishes its own `d=general` 30315).
 */
export function newestVisibleUserStatus(
  lookup: UserStatusLookup | undefined,
  pubkeys: readonly string[],
): UserStatus | null {
  let newest: UserStatus | null = null;
  for (const pubkey of pubkeys) {
    const status = visibleUserStatus(lookup?.[normalizePubkey(pubkey)]);
    if (status) newest = newest ? newerUserStatus(newest, status) : status;
  }
  return newest;
}

function statusIsExpired(
  status: UserStatusCacheEntry | undefined,
  nowSeconds: number,
): boolean {
  return status?.expiresAt !== undefined && status.expiresAt <= nowSeconds;
}

/** Remove expired entries from every mounted user-status lookup. */
export function expireUserStatusQueries(
  queryClient: Pick<QueryClient, "getQueriesData" | "setQueryData">,
  nowSeconds = Math.floor(Date.now() / 1_000),
): boolean {
  let changed = false;
  for (const [queryKey, old] of queryClient.getQueriesData<UserStatusLookup>({
    queryKey: ["user-status"],
  })) {
    if (!old) continue;
    let next: UserStatusLookup | null = null;
    for (const [pubkey, status] of Object.entries(old)) {
      if (!status || !statusIsExpired(status, nowSeconds)) continue;
      next ??= { ...old };
      next[pubkey] = hiddenUserStatus({
        updatedAt: status.updatedAt,
        eventId: status.eventId ?? "",
      });
    }
    if (!next) continue;
    queryClient.setQueryData(queryKey, next);
    changed = true;
  }
  return changed;
}

function nextUserStatusExpiration(
  queryClient: Pick<QueryClient, "getQueriesData">,
  nowSeconds: number,
): number | null {
  let nearest: number | null = null;
  for (const [, lookup] of queryClient.getQueriesData<UserStatusLookup>({
    queryKey: ["user-status"],
  })) {
    if (!lookup) continue;
    for (const status of Object.values(lookup)) {
      if (
        status?.expiresAt !== undefined &&
        status.expiresAt > nowSeconds &&
        (nearest === null || status.expiresAt < nearest)
      ) {
        nearest = status.expiresAt;
      }
    }
  }
  return nearest;
}

export function userStatusQueryKey(pubkeys: readonly string[]) {
  return ["user-status", ...normalizePubkeys(pubkeys)] as const;
}

export function parseUserStatusEvent(event: StatusEvent): {
  pubkey: string;
  text: string;
  emoji: string;
  updatedAt: number;
  eventId: string;
  expiresAt?: number;
} {
  const emojiTag = event.tags.find(
    (tag) => tag[0] === "emoji" && tag.length >= 2,
  );
  const expirationTag = event.tags.find(
    (tag) => tag[0] === "expiration" && tag.length >= 2,
  );
  const parsedExpiration = Number.parseInt(expirationTag?.[1] ?? "", 10);
  return {
    pubkey: normalizePubkey(event.pubkey),
    text: event.content,
    emoji: emojiTag?.[1] ?? "",
    updatedAt: event.created_at,
    eventId: event.id,
    expiresAt: Number.isFinite(parsedExpiration) ? parsedExpiration : undefined,
  };
}

/** Returns false when the frame is not the original `d=general` 30315. */
export function applyUserStatusEventToQueries(
  queryClient: Pick<QueryClient, "getQueriesData" | "setQueryData">,
  event: StatusEvent,
  nowSeconds = Math.floor(Date.now() / 1_000),
): boolean {
  if (event.kind !== undefined && event.kind !== KIND_USER_STATUS) return false;
  if (!Array.isArray(event.tags) || typeof event.content !== "string") return false;
  const dTag = event.tags.find((tag) => tag[0] === "d");
  if (dTag?.[1] !== "general") return false;
  const parsed = parseUserStatusEvent(event);
  const isExpired =
    parsed.expiresAt !== undefined && parsed.expiresAt <= nowSeconds;
  const status: UserStatus =
    (parsed.text || parsed.emoji) && !isExpired
      ? {
          text: parsed.text,
          emoji: parsed.emoji,
          updatedAt: parsed.updatedAt,
          eventId: parsed.eventId,
          expiresAt: parsed.expiresAt,
        }
      : hiddenUserStatus(parsed);

  for (const [queryKey, old] of queryClient.getQueriesData<UserStatusLookup>({
    queryKey: ["user-status"],
  })) {
    if (!queryKey.slice(1).includes(parsed.pubkey)) continue;
    const existing = old?.[parsed.pubkey];
    if (
      statusVersionIsAtLeast(existing ?? undefined, {
        updatedAt: parsed.updatedAt,
        eventId: parsed.eventId,
      })
    ) {
      continue;
    }
    queryClient.setQueryData(queryKey, {
      ...(old ?? {}),
      [parsed.pubkey]: status,
    });
  }
  return true;
}

/** Keeps focused polling at the established 2-minute backstop cadence. */
export const USER_STATUS_REFETCH_INTERVAL_MS = 120_000;
/** Suppresses the focus refetch until user-status data is genuinely stale.
 * The live stream frames (setQueriesData) are the primary freshness path. */
export const USER_STATUS_FOCUS_STALE_TIME_MS = 5 * 60_000;
/** WebUserStatusQueryRequest.pubkeys maxItems (contracts/api/web_user_status_query_request.schema.json). */
export const USER_STATUS_AUTHOR_CHUNK_SIZE = 200;

/** Focus-refetch policy for the user-status query. */
export const userStatusFocusRefetchPolicy = {
  staleTime: USER_STATUS_FOCUS_STALE_TIME_MS,
  refetchOnWindowFocus: false,
} as const;

type FetchStatusPage = PresenceHost["queryUserStatus"];

function statusFromView(view: unknown, nowSeconds: number): { pubkey: string; status: UserStatus } {
  const invalid = new Error("Invalid user status entry");
  if (!view || typeof view !== "object") throw invalid;
  const record = view as Record<string, unknown>;
  const pubkey = record.pubkey;
  const text = record.text;
  const eventId = record.eventId;
  const createdAt = record.createdAt;
  if (typeof pubkey !== "string" || typeof text !== "string" || typeof eventId !== "string") throw invalid;
  if (typeof createdAt !== "number" || !Number.isSafeInteger(createdAt)) throw invalid;
  const rawEmoji = record.emoji;
  let emoji = "";
  if (rawEmoji !== undefined) {
    if (typeof rawEmoji !== "string") throw invalid;
    emoji = rawEmoji;
  }
  const rawExpiresAt = record.expiresAt;
  let expiresAt: number | undefined;
  if (rawExpiresAt !== undefined) {
    if (typeof rawExpiresAt !== "number" || !Number.isSafeInteger(rawExpiresAt)) throw invalid;
    expiresAt = rawExpiresAt;
  }
  const version = { updatedAt: createdAt, eventId };
  const isExpired = expiresAt !== undefined && expiresAt <= nowSeconds;
  return {
    pubkey: normalizePubkey(pubkey),
    status: (text || emoji) && !isExpired
      ? { text, emoji, updatedAt: createdAt, eventId, expiresAt }
      : hiddenUserStatus(version),
  };
}

export async function fetchUserStatusLookup(
  pubkeys: readonly string[],
  fetchPage: FetchStatusPage,
  readCurrentLookup: () => UserStatusLookup = () => ({}),
): Promise<UserStatusLookup> {
  const normalizedAuthors = normalizePubkeys(pubkeys);
  const chunks: string[][] = [];
  for (
    let index = 0;
    index < normalizedAuthors.length;
    index += USER_STATUS_AUTHOR_CHUNK_SIZE
  ) {
    chunks.push(
      normalizedAuthors.slice(index, index + USER_STATUS_AUTHOR_CHUNK_SIZE),
    );
  }
  const startedAt = Math.floor(Date.now() / 1_000);
  const pages = await Promise.all(chunks.map((authors) => fetchPage(authors)));

  const requested = new Set(normalizedAuthors);
  const currentLookup = readCurrentLookup();
  const lookup: UserStatusLookup = {};
  // The BFF omits a cleared status, so absence means "no status" as of this read.
  // Only a cached version at least as new as the read itself — a live frame or own
  // publication that landed meanwhile — survives it, as in the original.
  for (const pubkey of normalizedAuthors) {
    const current = currentLookup[pubkey];
    lookup[pubkey] = current && current.updatedAt >= startedAt ? current : null;
  }
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const latest = new Map<string, UserStatus>();
  for (const page of pages) {
    if (!page || !Array.isArray(page.statuses)) throw new Error("Invalid user status response");
    for (const view of page.statuses) {
      const { pubkey, status } = statusFromView(view, nowSeconds);
      if (!requested.has(pubkey)) continue;
      const existing = latest.get(pubkey);
      latest.set(pubkey, existing ? newerUserStatus(existing, status) : status);
    }
  }
  for (const [pubkey, status] of latest) {
    lookup[pubkey] = newerUserStatus(currentLookup[pubkey], status);
  }
  return lookup;
}

export function readCurrentUserStatusLookup(
  queryClient: Pick<QueryClient, "getQueriesData">,
  pubkeys: readonly string[],
): UserStatusLookup {
  const normalizedPubkeys = normalizePubkeys(pubkeys);
  const currentLookup: UserStatusLookup = {};
  for (const [queryKey, lookup] of queryClient.getQueriesData<UserStatusLookup>(
    {
      queryKey: ["user-status"],
    },
  )) {
    if (!lookup) continue;
    for (const pubkey of normalizedPubkeys) {
      if (!queryKey.slice(1).includes(pubkey)) continue;
      const candidate = lookup[pubkey];
      if (candidate === undefined) continue;
      if (candidate === null) {
        currentLookup[pubkey] ??= null;
        continue;
      }
      currentLookup[pubkey] = newerUserStatus(currentLookup[pubkey], candidate);
    }
  }
  return currentLookup;
}

/** Requires a PresenceHost; without one the query stays disabled. */
export function useUserStatusQuery(
  pubkeys: readonly string[],
  preservePreviousData = false,
) {
  const host = usePresenceHost();
  const normalizedPubkeys = normalizePubkeys(pubkeys);
  const enabled = host !== null && normalizedPubkeys.length > 0;

  const queryClient = React.useContext(QueryClientContext) ?? DETACHED_QUERY_CLIENT;

  return useQuery<UserStatusLookup>({
    enabled,
    queryKey: userStatusQueryKey(normalizedPubkeys),
    queryFn: () => {
      if (!host) throw new Error("User status host unavailable");
      return fetchUserStatusLookup(
        normalizedPubkeys,
        host.queryUserStatus,
        () => readCurrentUserStatusLookup(queryClient, normalizedPubkeys),
      );
    },
    ...(preservePreviousData
      ? {
          placeholderData: (previous: UserStatusLookup | undefined) => previous,
        }
      : {}),
    refetchInterval: USER_STATUS_REFETCH_INTERVAL_MS,
    retry: false,
    ...userStatusFocusRefetchPolicy,
  }, host ? undefined : DETACHED_QUERY_CLIENT);
}

/**
 * The expiry half of the original useUserStatusSubscription: hide each status when its
 * NIP-40 expiration passes, without a network read. Live 30315 frames arrive through the
 * host's stream ingestion instead of a Relay subscription.
 */
export function useUserStatusExpiry() {
  const queryClient = useQueryClient();

  React.useEffect(() => {
    let isCancelled = false;
    let expirationTimer: ReturnType<typeof setTimeout> | null = null;
    let expirationScheduleQueued = false;

    function scheduleExpiration() {
      if (expirationTimer) clearTimeout(expirationTimer);
      expirationTimer = null;
      if (isCancelled) return;

      const nowSeconds = Math.floor(Date.now() / 1_000);
      expireUserStatusQueries(queryClient, nowSeconds);
      if (isCancelled) return;
      const expiresAt = nextUserStatusExpiration(queryClient, nowSeconds);
      if (expiresAt === null) return;

      const delay = Math.max(0, expiresAt * 1_000 - Date.now());
      expirationTimer = setTimeout(
        scheduleExpiration,
        Math.min(delay, 0x7fffffff),
      );
    }

    const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.query.queryKey[0] !== "user-status" ||
        expirationScheduleQueued
      ) {
        return;
      }
      expirationScheduleQueued = true;
      queueMicrotask(() => {
        expirationScheduleQueued = false;
        scheduleExpiration();
      });
    });
    scheduleExpiration();

    return () => {
      isCancelled = true;
      unsubscribeCache();
      if (expirationTimer) clearTimeout(expirationTimer);
    };
  }, [queryClient]);
}

/**
 * DD-120 (4): the contract's empty text clears the status (an emoji-only status is
 * not representable, and the BFF read omits it), so a clear sends `text: ""` alone.
 */
export function userStatusUpdateRequest({ text, emoji, expiresAt }: UserStatusInput): WebUserStatusUpdateRequest {
  const trimmed = text.trim();
  if (!trimmed) return { text: "" };
  return {
    text: trimmed,
    ...(emoji ? { emoji } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  };
}

export function useSetUserStatusMutation(pubkey?: string) {
  const host = usePresenceHost();
  const queryClient = useQueryClient();
  const normalizedPubkey = normalizePubkey(pubkey ?? "");
  // One key per publication intent; an UNKNOWN outcome keeps it, so resending the
  // same status asks Core for the original outcome instead of signing another event.
  const intents = React.useRef(new Map<string, string>());

  return useMutation({
    mutationFn: async (input: UserStatusInput) => {
      if (!host) throw new Error("User status host unavailable");
      const request = userStatusUpdateRequest(input);
      const signature = JSON.stringify(request);
      const key = intents.current.get(signature) ?? newIdempotencyKey();
      intents.current.set(signature, key);
      try {
        const receipt = await host.updateUserStatus(request, key);
        intents.current.delete(signature);
        return { request, receipt };
      } catch (error) {
        if (!isOutcomeUnknown(error)) intents.current.delete(signature);
        throw error;
      }
    },
    onSuccess: ({ request, receipt }) => {
      if (normalizedPubkey.length === 0) return;
      const version = {
        updatedAt: receipt.createdAt ?? Math.floor(Date.now() / 1_000),
        eventId: receipt.eventId,
      };
      const status: UserStatus = request.text
        ? {
            text: request.text,
            emoji: request.emoji ?? "",
            ...version,
            expiresAt: request.expiresAt,
          }
        : hiddenUserStatus(version);

      queryClient.setQueryData<UserStatusLookup>(
        userStatusQueryKey([normalizedPubkey]),
        (old) => ({
          ...(old ?? {}),
          [normalizedPubkey]: newerUserStatus(old?.[normalizedPubkey], status),
        }),
      );

      queryClient.setQueriesData<UserStatusLookup>(
        { queryKey: ["user-status"] },
        (old) => {
          if (!old || !(normalizedPubkey in old)) return old;
          const next = newerUserStatus(old[normalizedPubkey], status);
          return next === old[normalizedPubkey]
            ? old
            : { ...old, [normalizedPubkey]: next };
        },
      );
    },
  });
}
