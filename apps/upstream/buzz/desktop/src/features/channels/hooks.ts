import * as React from "react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { getChannelMembers, getChannels } from "@/shared/api/tauri";
import type { Channel } from "@/shared/api/types";
import type { GetChannelsPayload } from "@/shared/api/tauriChannels";
import { mergeConcurrentChannelRecency } from "@/features/channels/lib/channelRecencyMerge";
import { useIdentityQuery } from "@/shared/api/hooks";
import { useFocusedRefetchInterval } from "@/shared/lib/useDocumentVisible";
import { useActiveCommunity } from "@/features/kailo/activeCommunity";
import {
  inspectChannelSnapshot,
  type ChannelSnapshot,
  writeChannelSnapshot,
} from "@/features/channels/channelSnapshot";
import { CHANNEL_MEMBERS_STALE_TIME_MS } from "@/features/channels/rosterFreshness";

export const channelsQueryKey = ["channels"] as const;
/** Keeps focused polling at the established one-minute cadence. */
export const CHANNELS_REFETCH_INTERVAL_MS = 60_000;
/** Suppresses the expensive focus refetch until the channel list is old. */
export const CHANNELS_FOCUS_STALE_TIME_MS = 5 * 60_000;

/** Focus-refetch policy for the channels query; consumed by focusRefetchPolicy.test.mjs. */
export const channelsFocusRefetchPolicy = {
  staleTime: CHANNELS_FOCUS_STALE_TIME_MS,
  refetchOnWindowFocus: false,
} as const;
/**
 * Authoritative server list/hash pair. Presentation mutations may patch
 * `channelsQueryKey`, but may never change or be persisted with this hash.
 */
const channelsSnapshotPairKey = ["channels", "_snapshot-pair"] as const;
const channelTypeOrder = {
  stream: 0,
  forum: 1,
  dm: 2,
} as const;

export function sortChannels(channels: Channel[]) {
  const uniqueChannels = new Map<string, Channel>();

  for (const channel of channels) {
    uniqueChannels.set(channel.id, channel);
  }

  return [...uniqueChannels.values()].sort((left, right) => {
    const typeOrder =
      channelTypeOrder[left.channelType] - channelTypeOrder[right.channelType];

    if (typeOrder !== 0) {
      return typeOrder;
    }

    return left.name.localeCompare(right.name);
  });
}

export const CHANNELS_SNAPSHOT_DIAGNOSTIC_MARK =
  "buzz:sidebar:snapshot-diagnostic";
export const CHANNELS_FULL_SIDEBAR_PAINT_MARK =
  "buzz:sidebar:full-list-painted";
export const CHANNELS_BOOT_TO_FULL_SIDEBAR_MEASURE =
  "buzz:sidebar:boot-to-full-list-painted";

const markedSnapshotKeys = new Set<string>();
const measuredSidebarKeys = new Set<string>();
const scheduledSidebarKeys = new Set<string>();

function sidebarMeasurementKey(relayUrl: string, ownerPubkey: string): string {
  return `${relayUrl}\u0000${ownerPubkey.toLowerCase()}`;
}

function markSnapshotDiagnostic(
  relayUrl: string,
  ownerPubkey: string,
  diagnostics: ReturnType<typeof inspectChannelSnapshot>["diagnostics"],
): void {
  if (typeof performance === "undefined") return;
  const key = sidebarMeasurementKey(relayUrl, ownerPubkey);
  if (markedSnapshotKeys.has(key)) return;
  markedSnapshotKeys.add(key);
  performance.mark(CHANNELS_SNAPSHOT_DIAGNOSTIC_MARK, {
    detail: { ...diagnostics, relayUrl },
  });
  console.info("[sidebar-perf] snapshot", { ...diagnostics, relayUrl });
}

function measureFullSidebarPaint(
  relayUrl: string,
  ownerPubkey: string,
  channelCount: number,
): void {
  if (typeof performance === "undefined") return;
  const key = sidebarMeasurementKey(relayUrl, ownerPubkey);
  if (measuredSidebarKeys.has(key) || scheduledSidebarKeys.has(key)) return;
  scheduledSidebarKeys.add(key);

  // The channels have committed to the shared query cache; two animation frames
  // put the mark after React's sidebar DOM commit and the browser's next paint.
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      scheduledSidebarKeys.delete(key);
      if (measuredSidebarKeys.has(key)) return;
      measuredSidebarKeys.add(key);
      performance.mark(CHANNELS_FULL_SIDEBAR_PAINT_MARK, {
        detail: { channelCount, relayUrl },
      });
      performance.measure(CHANNELS_BOOT_TO_FULL_SIDEBAR_MEASURE, {
        detail: { channelCount, relayUrl },
        duration: performance.now(),
        start: 0,
      });
      const measure = performance
        .getEntriesByName(CHANNELS_BOOT_TO_FULL_SIDEBAR_MEASURE)
        .at(-1);
      console.info("[sidebar-perf] full list painted", {
        channelCount,
        durationMs: measure?.duration,
        relayUrl,
      });
    });
  });
}

/**
 * Overlays `last_messages` timestamps onto channels without creating new object
 * references for channels whose `lastMessageAt` is unchanged. Preserving
 * references lets React Query's structural sharing skip re-renders for
 * channels that received no new messages. Exported for unit testing.
 */
export function applyLastMessages(
  channels: Channel[],
  lastMessages: Record<string, string>,
): Channel[] {
  return channels.map((channel) => {
    const newTs = lastMessages[channel.id] ?? null;
    if (channel.lastMessageAt === newTs) {
      return channel;
    }
    return { ...channel, lastMessageAt: newTs };
  });
}

/**
 * A failed identity read must disable persisted snapshots, not the live channel
 * request. The backend still resolves its authoritative current identity.
 */
export function canFetchChannelsForIdentity(
  ownerPubkey: string | null,
  identityReadFailed: boolean,
): boolean {
  return ownerPubkey !== null || identityReadFailed;
}

/** A hashless retry must return a full list before it can become authoritative. */
export function requireFullChannelList(channels: Channel[] | null): Channel[] {
  if (channels === null) {
    throw new Error("get_channels returned no list for a hashless request");
  }
  return channels;
}

export type RefreshChannelsQueryOptions = {
  queryClient: QueryClient;
  initialSnapshotPair: ChannelSnapshot | null;
  relayUrl: string | null;
  ownerPubkey: string | null;
  fetchChannels?: (knownHash: string | null) => Promise<GetChannelsPayload>;
  persistSnapshot?: typeof writeChannelSnapshot;
};

/**
 * Revalidates the channel query while preserving live recency updates that land
 * during the request. Exported so the production query/cache interleaving can
 * be regression-tested without replacing it with a helper-only simulation.
 */
export async function refreshChannelsQuery({
  queryClient,
  initialSnapshotPair,
  relayUrl,
  ownerPubkey,
  fetchChannels = getChannels,
  persistSnapshot = writeChannelSnapshot,
}: RefreshChannelsQueryOptions): Promise<Channel[]> {
  // Revalidation uses only an authoritative list/hash pair. The displayed
  // channels cache is intentionally ignored because successful mutations
  // patch it before the relay's list/hash has necessarily caught up.
  const cachedPair =
    queryClient.getQueryData<ChannelSnapshot>(channelsSnapshotPairKey) ??
    initialSnapshotPair;
  const knownHash = cachedPair?.hash ?? null;

  const channelsAtRequestStart =
    queryClient.getQueryData<Channel[]>(channelsQueryKey);
  const payload = await fetchChannels(knownHash);

  // A not-modified response is usable only when it echoes the exact hash
  // that described the available list. Any other hash/list pairing fails
  // slow-never-wrong by retrying without a hash.
  const hasMatchingNotModifiedResponse =
    payload.channels === null &&
    knownHash !== null &&
    payload.hash === knownHash;
  const pairChannels =
    payload.channels ??
    (hasMatchingNotModifiedResponse ? cachedPair?.channels : undefined);

  if (!pairChannels) {
    // Missing cache or a mismatched not-modified response: discard the hash
    // and fetch a complete authoritative list before updating persistence.
    const full = await fetchChannels(null);
    const authoritativeChannels = sortChannels(
      applyLastMessages(
        requireFullChannelList(full.channels),
        full.lastMessages,
      ),
    );
    const displayedAtSettlement =
      queryClient.getQueryData<Channel[]>(channelsQueryKey);
    const sorted = sortChannels(
      mergeConcurrentChannelRecency(
        authoritativeChannels,
        displayedAtSettlement,
        channelsAtRequestStart,
      ),
    );
    const pair = { channels: authoritativeChannels, hash: full.hash };
    queryClient.setQueryData(channelsSnapshotPairKey, pair);
    if (relayUrl && ownerPubkey) {
      persistSnapshot(relayUrl, ownerPubkey, pair.channels, pair.hash);
    }
    return sorted;
  }

  const authoritativeChannels = sortChannels(
    applyLastMessages(pairChannels, payload.lastMessages),
  );
  const pair = {
    channels: authoritativeChannels,
    hash: payload.hash,
  };
  queryClient.setQueryData(channelsSnapshotPairKey, pair);
  // Merge against the displayed cache at settlement so a newer live
  // timestamp cannot be rolled back by an older request result. This is
  // required for both full-list and matching not-modified responses.
  const displayedAtSettlement =
    queryClient.getQueryData<Channel[]>(channelsQueryKey);
  const refreshedForDisplay =
    payload.channels === null
      ? sortChannels(
          applyLastMessages(
            displayedAtSettlement ?? authoritativeChannels,
            payload.lastMessages,
          ),
        )
      : authoritativeChannels;
  const sorted = sortChannels(
    mergeConcurrentChannelRecency(
      refreshedForDisplay,
      displayedAtSettlement,
      channelsAtRequestStart,
    ),
  );
  if (relayUrl && ownerPubkey) {
    persistSnapshot(relayUrl, ownerPubkey, pair.channels, pair.hash);
  }
  return sorted;
}

export function useChannelsQuery(options?: { enabled?: boolean }) {
  const relayUrl = useActiveCommunity().relayUrl;
  // CommunityQueryProvider remounts its QueryClient for every community. Only
  // the active identity may authorize a persisted snapshot: Community.pubkey
  // is creation-time display metadata and can be stale after identity changes.
  const identityQuery = useIdentityQuery();
  const ownerPubkey = identityQuery.data?.pubkey ?? null;
  const queryClient = useQueryClient();
  const snapshotRead = React.useMemo(
    () =>
      relayUrl && ownerPubkey
        ? inspectChannelSnapshot(relayUrl, ownerPubkey)
        : null,
    [ownerPubkey, relayUrl],
  );
  const snapshot = snapshotRead?.snapshot ?? null;
  const initialSnapshotPair = React.useMemo(
    () =>
      snapshot
        ? { channels: sortChannels(snapshot.channels), hash: snapshot.hash }
        : null,
    [snapshot],
  );
  React.useEffect(() => {
    if (relayUrl && ownerPubkey && snapshotRead && options?.enabled !== false) {
      markSnapshotDiagnostic(relayUrl, ownerPubkey, snapshotRead.diagnostics);
    }
  }, [options?.enabled, ownerPubkey, relayUrl, snapshotRead]);
  const refetchInterval = useFocusedRefetchInterval(
    CHANNELS_REFETCH_INTERVAL_MS,
  );

  const query = useQuery({
    enabled:
      (options?.enabled ?? true) &&
      relayUrl !== null &&
      canFetchChannelsForIdentity(ownerPubkey, identityQuery.isError),
    queryKey: channelsQueryKey,
    queryFn: () =>
      refreshChannelsQuery({
        queryClient,
        initialSnapshotPair,
        relayUrl,
        ownerPubkey,
      }),
    // Paint the complete persisted list immediately. `initialDataUpdatedAt: 0`
    // deliberately keeps it stale so every boot still validates against the
    // relay; queryFn reads the matching hash from the same atomic document.
    initialData: initialSnapshotPair?.channels,
    initialDataUpdatedAt: 0,
    refetchInterval,
    ...channelsFocusRefetchPolicy,
  });

  React.useEffect(() => {
    if (
      relayUrl &&
      ownerPubkey &&
      query.isSuccess &&
      query.fetchStatus === "idle" &&
      query.dataUpdatedAt > 0
    ) {
      measureFullSidebarPaint(relayUrl, ownerPubkey, query.data.length);
    }
  }, [
    query.data,
    query.dataUpdatedAt,
    query.fetchStatus,
    query.isSuccess,
    ownerPubkey,
    relayUrl,
  ]);

  return query;
}

export function useChannelMembersQuery(
  channelId: string | null,
  enabled = true,
) {
  return useQuery({
    enabled: enabled && channelId !== null,
    queryKey: ["channels", channelId ?? "none", "members"],
    queryFn: async () => {
      if (!channelId) {
        throw new Error("No channel selected.");
      }

      return getChannelMembers(channelId);
    },
    staleTime: CHANNEL_MEMBERS_STALE_TIME_MS,
  });
}
