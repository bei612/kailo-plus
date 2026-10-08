import * as React from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { WebProfileUpdateRequest } from "@client-kit/contracts";
import { TransportError } from "@client-kit/platform/transport";

import {
  getProfile,
  updateProfile,
  searchUsers,
  getUserProfile,
  getUsersBatch,
} from "@/shared/api/tauriProfiles";
import type {
  Profile,
  UserSearchResult,
  UserProfileSummary,
  UsersBatchResponse,
} from "@/shared/api/types";
import { getAvatarSnapshotUrl } from "@/shared/lib/animatedAvatar";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";
import {
  SELF_PROFILE_CACHE_EVENT,
  type SelfProfileCache,
  fetchAvatarDataUrl,
  readSelfProfileCache,
  writeSelfProfileCache,
  shouldFetchAvatar,
  resolveAvatarDataUrl,
} from "@/features/profile/lib/selfProfileStorage";
import {
  resolveUserLabelPlaceholderData,
  writeCachedUserLabels,
} from "@/features/profile/lib/userLabelStorage";
import { useActiveCommunity, useNativeSession } from "@/features/platform/activeCommunity";

const profileQueryKey = (community: { id: string; relayUrl: string }, pubkey: string) =>
  ["profile", community.id, community.relayUrl, pubkey] as const;

/** Restored original native writer; cache only a canonical, same-scope receipt. */
export function useUpdateProfileMutation() {
  const community = useActiveCommunity();
  const session = useNativeSession();
  const queryClient = useQueryClient();
  const pubkey = session.devicePubkey;
  const key = React.useMemo(() => profileQueryKey(community, pubkey), [community.id, community.relayUrl, pubkey]);
  const owner = React.useMemo(() => ({ active: true }), [session.client, key]);
  const live = React.useRef(owner);
  live.current = owner;
  React.useEffect(() => { owner.active = true; return () => { owner.active = false; }; }, [owner]);
  return useMutation({
    mutationFn: async (request: WebProfileUpdateRequest) => {
      if (!pubkey) throw new Error("Profile identity unavailable");
      if (request.expectedPubkey !== pubkey) throw new Error("Profile identity changed before save");
      await queryClient.cancelQueries({ queryKey: key });
      if (!owner.active || live.current !== owner) throw new Error("Profile identity changed before save");
      const profile = await updateProfile({ ...request, expectedRelayUrl: community.relayUrl, expectedSignerPubkey: pubkey });
      if (!owner.active || live.current !== owner || profile.pubkey !== pubkey) throw new TransportError("Profile identity changed before readback");
      await queryClient.cancelQueries({ queryKey: key });
      if (!owner.active || live.current !== owner) throw new TransportError("Profile identity changed before readback");
      queryClient.setQueryData(key, profile);
      void persistSelfProfile(community.relayUrl, pubkey, profile);
      evictUsersBatchEntries(queryClient, [pubkey]);
      void queryClient.invalidateQueries({ queryKey: ["user-profile", pubkey] });
      void queryClient.invalidateQueries({ queryKey: ["users-batch"] });
      return profile;
    },
  });
}

/**
 * Persists a freshly-fetched profile to localStorage as the offline fallback.
 * Reuses an existing avatar data URL when the avatar URL is unchanged to avoid
 * re-downloading the image on every ~30s background refetch.
 */
async function persistSelfProfile(
  relayUrl: string,
  pubkey: string,
  profile: Profile,
): Promise<void> {
  const existing = readSelfProfileCache(relayUrl, pubkey);
  const avatarSnapshotUrl = getAvatarSnapshotUrl(profile.avatarUrl);
  const fetched =
    shouldFetchAvatar(profile.avatarUrl, existing) && avatarSnapshotUrl !== null
      ? await fetchAvatarDataUrl(rewriteRelayUrl(avatarSnapshotUrl))
      : null;
  const avatarDataUrl = resolveAvatarDataUrl(
    profile.avatarUrl,
    fetched,
    existing,
  );
  writeSelfProfileCache(relayUrl, pubkey, {
    version: 1,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    about: profile.about,
    avatarDataUrl,
    updatedAt: Date.now(),
    // Only persist the presence bit when true — no-event fallbacks
    // (hasProfileEvent: false) must not be cached as real profiles,
    // which would cause the onboarding gate to skip on next restart.
    ...(profile.hasProfileEvent && { hasProfileEvent: true }),
  });
}

export function useProfileQuery(enabled = true) {
  const activeCommunity = useActiveCommunity();
  const session = useNativeSession();
  const queryClient = useQueryClient();
  const relayUrl = activeCommunity.relayUrl;
  const pubkey = session.devicePubkey;
  const key = React.useMemo(() => profileQueryKey(activeCommunity, pubkey), [activeCommunity.id, relayUrl, pubkey]);
  const owner = React.useMemo(() => ({ active: true }), [session.client, key]);
  const live = React.useRef(owner);
  live.current = owner;
  React.useEffect(() => { owner.active = true; return () => { owner.active = false; }; }, [owner]);

  // Parse localStorage once per relayUrl/pubkey pair — not on every render.
  // Cached identity renders instantly and persists through fetch errors (relay
  // unreachable); initialDataUpdatedAt keeps the normal background refetch.
  const cached = React.useMemo(
    () => (relayUrl && pubkey ? readSelfProfileCache(relayUrl, pubkey) : null),
    [relayUrl, pubkey],
  );

  // Stable memo so the seeding effect below has stable deps and doesn't
  // retrigger on unrelated re-renders.
  const initialData = React.useMemo(
    () =>
      cached && cached.updatedAt > 0
        ? ({
            pubkey,
            displayName: cached.displayName,
            avatarUrl: cached.avatarUrl,
            about: cached.about,
            nip05Handle: null,
            ownerPubkey: null,
            // Only true when the cache entry was explicitly written with a
            // real kind:0-backed profile. Older entries (absent field) and
            // no-event fallbacks default to false — conservative is correct.
            hasProfileEvent: cached.hasProfileEvent === true,
          } satisfies Profile)
        : undefined,
    [cached, pubkey],
  );

  // `initialData` is only honored at query construction, which happens before
  // identity/community resolve on a fresh QueryClient — seed the cache
  // imperatively once they arrive, without ever stomping a real fetch result.
  React.useEffect(() => {
    if (!initialData || !cached) return;
    if (queryClient.getQueryData(key) === undefined) {
      queryClient.setQueryData(key, initialData, {
        updatedAt: cached.updatedAt,
      });
    }
  }, [queryClient, key, initialData, cached]);

  const seedOptions =
    initialData !== undefined
      ? { initialData, initialDataUpdatedAt: cached?.updatedAt }
      : {};

  return useQuery({
    enabled: enabled && !!pubkey,
    queryKey: key,
    queryFn: async () => {
      const profile = await getProfile();
      if (!owner.active || live.current !== owner || profile.pubkey !== pubkey)
        throw new TransportError("Profile identity changed during read");
      if (relayUrl && pubkey) {
        void persistSelfProfile(relayUrl, pubkey, profile);
      }
      return profile;
    },
    staleTime: 30_000,
    ...seedOptions,
  });
}

/**
 * Reactive hook for the locally-cached self-profile.
 *
 * localStorage isn't reactive — the storage module dispatches
 * SELF_PROFILE_CACHE_EVENT after writes so this hook re-reads without polling.
 */
export function useSelfProfileCache(): SelfProfileCache | null {
  const activeCommunity = useActiveCommunity();
  const session = useNativeSession();
  const relayUrl = activeCommunity.relayUrl;
  const pubkey = session.devicePubkey;

  const source = React.useMemo(() => ({
    value: relayUrl && pubkey ? readSelfProfileCache(relayUrl, pubkey) : null,
  }), [relayUrl, pubkey]);
  const [cache, setCache] = React.useState(() => ({ source, value: source.value }));

  React.useEffect(() => {
    function handleCacheEvent() {
      setCache({ source, value: relayUrl && pubkey ? readSelfProfileCache(relayUrl, pubkey) : null });
    }

    handleCacheEvent();
    window.addEventListener(SELF_PROFILE_CACHE_EVENT, handleCacheEvent);
    return () => {
      window.removeEventListener(SELF_PROFILE_CACHE_EVENT, handleCacheEvent);
    };
  }, [source, relayUrl, pubkey]);

  // Effects run after the first render for a new identity. Never expose the
  // previous identity's avatar snapshot in that render (or from its late event).
  return cache.source === source ? cache.value : source.value;
}

export function useUserProfileQuery(pubkey?: string, sessionScope?: string) {
  return useQuery({
    enabled: typeof pubkey === "string" && pubkey.length > 0,
    queryKey: sessionScope === undefined
      ? ["user-profile", pubkey?.toLowerCase() ?? ""]
      : ["user-profile", pubkey?.toLowerCase() ?? "", sessionScope],
    queryFn: () => getUserProfile(pubkey),
    refetchOnMount: sessionScope === undefined ? undefined : "always",
    staleTime: 60_000,
  });
}

// Per-pubkey resolution cache backing `useUsersBatchQuery`'s delta fetch.
// `summary: null` records a relay-confirmed miss so unknown pubkeys aren't
// re-requested every page. Entries older than the hook's 10-minute staleTime
// are treated as unresolved and refetched.
export type UsersBatchEntry = {
  summary: UserProfileSummary | null;
  fetchedAt: number;
};

export const usersBatchEntryKey = (pubkey: string) => [
  "users-batch-entry",
  pubkey,
];

/**
 * How long a per-pubkey entry answers without a refetch. Exported so readers
 * outside this hook (the clipboard's paste-side identity check) apply the same
 * freshness rule rather than trusting an entry this hook already considers
 * stale.
 */
export const USERS_BATCH_ENTRY_FRESH_MS = 10 * 60_000;

/**
 * Drop the per-pubkey delta-fetch entries so the next `useUsersBatchQuery`
 * run re-fetches these profiles from the relay. Must be called anywhere a
 * specific profile (or a containing `users-batch` query) is invalidated —
 * otherwise the re-run resolves from the still-fresh-looking entry and
 * renders the stale name/avatar for up to the entry's 10-minute freshness
 * window.
 * Synchronous, so callers can evict before awaiting aggregate invalidations.
 */
export function evictUsersBatchEntries(queryClient: QueryClient, pubkeys: string[]) {
  for (const pubkey of pubkeys) {
    queryClient.removeQueries({ queryKey: usersBatchEntryKey(pubkey.toLowerCase()), exact: true });
  }
}

export function useUsersBatchQuery(
  pubkeys: string[],
  options?: {
    enabled?: boolean;
  },
) {
  const queryClient = useQueryClient();
  const activeCommunity = useActiveCommunity();
  const relayUrl = activeCommunity.relayUrl;
  const normalizedPubkeys = [
    ...new Set(pubkeys.map((pubkey) => pubkey.toLowerCase())),
  ]
    .filter((pubkey) => pubkey.length > 0)
    .sort();
  const enabled = (options?.enabled ?? true) && normalizedPubkeys.length > 0;

  const query = useQuery<UsersBatchResponse>({
    enabled,
    queryKey: ["users-batch", ...normalizedPubkeys],
    // Delta fetch: scroll-back grows the author set one page at a time, and
    // keying on the full sorted list means every growth re-runs the query.
    // Requesting the accumulated set re-downloaded every already-resolved
    // profile (kind-0 payloads embed avatars — ~800KB per scroll page on
    // staging; RESEARCH/PERF_STAGING_SCROLLBACK.md). Resolve from the
    // per-pubkey entry cache first and hit the network only for pubkeys not
    // freshly resolved.
    queryFn: async () => {
      const now = Date.now();
      const profiles: UsersBatchResponse["profiles"] = {};
      const missing: string[] = [];
      const toFetch: string[] = [];
      for (const pubkey of normalizedPubkeys) {
        const entry = queryClient.getQueryData<UsersBatchEntry>(
          usersBatchEntryKey(pubkey),
        );
        if (entry && now - entry.fetchedAt < USERS_BATCH_ENTRY_FRESH_MS) {
          if (entry.summary) profiles[pubkey] = entry.summary;
          else missing.push(pubkey);
        } else {
          toFetch.push(pubkey);
        }
      }
      if (toFetch.length > 0) {
        const fresh = await getUsersBatch(toFetch);
        if (relayUrl) {
          writeCachedUserLabels(relayUrl, fresh.profiles, fresh.missing);
        }
        for (const pubkey of toFetch) {
          const summary = fresh.profiles[pubkey] ?? null;
          queryClient.setQueryData<UsersBatchEntry>(
            usersBatchEntryKey(pubkey),
            { summary, fetchedAt: now },
          );
          if (summary) profiles[pubkey] = summary;
          else missing.push(pubkey);
        }
      }
      return { profiles, missing };
    },
    // Loading older messages grows the pubkey set, which changes this query's
    // key entirely. Without this, already-resolved authors would flash back
    // to their raw pubkey while the larger batch refetches.
    placeholderData: (previousData) =>
      resolveUserLabelPlaceholderData(
        previousData,
        relayUrl,
        normalizedPubkeys,
      ),
    staleTime: USERS_BATCH_ENTRY_FRESH_MS,
    gcTime: 5 * 60 * 1_000,
    // Override the global defaults: a cold channel needs profiles to render
    // correctly, so a single failed attempt must not leave raw npubs/broken
    // mention chips until the user manually kicks the channel. Three attempts
    // with exponential backoff cover the common transient-relay case.
    //
    // After the retry budget exhausts, a window-focus event recovers the
    // query — but only when it is already in an error state. Gating on
    // query.state.status === "error" prevents unnecessary refetches for
    // successful batches on every focus event, which broke the profile-hover
    // E2E smoke test when unconditional focus-refetch was set.
    retry: 3,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 30_000),
    refetchOnWindowFocus: (query) => query.state.status === "error",
  });

  // Seed individual "user-profile" cache entries so avatar clicks are instant
  // cache hits instead of fresh network requests.
  React.useEffect(() => {
    // Persisted labels are intentionally presentation-only. Wait for a relay
    // result before seeding profile-detail caches that also carry ownership.
    if (query.dataUpdatedAt === 0) return;
    const profiles = query.data?.profiles;
    if (!profiles) return;
    for (const [pubkey, summary] of Object.entries(profiles)) {
      queryClient.setQueryData<Profile>(
        ["user-profile", pubkey],
        (existing) =>
          existing ?? {
            pubkey,
            about: null,
            // Batch endpoint gives UserProfileSummary (no event-presence flag).
            // These cached summaries are never used for the onboarding gate.
            hasProfileEvent: false,
            ...summary,
          },
      );
    }
  }, [query.data, query.dataUpdatedAt, queryClient]);

  return query;
}

export function useUserSearchQuery(
  query: string,
  options?: {
    allowEmpty?: boolean;
    enabled?: boolean;
    limit?: number;
  },
) {
  const normalizedQuery = query.trim().toLowerCase();
  const enabled =
    (options?.enabled ?? true) &&
    (options?.allowEmpty === true || normalizedQuery.length > 0);

  return useQuery<UserSearchResult[]>({
    enabled,
    queryKey: ["user-search", normalizedQuery, options?.limit ?? 8],
    queryFn: async () =>
      (await searchUsers(normalizedQuery, options?.limit ?? 8)).users,
    staleTime: 30_000,
    gcTime: 5 * 60 * 1_000,
  });
}
