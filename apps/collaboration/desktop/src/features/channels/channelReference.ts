import * as React from "react";
import { useQueries } from "@tanstack/react-query";

import { getChannelDetails } from "@/shared/api/tauri";
import type { Channel, ChannelDetail } from "@/shared/api/types";
import { useIdentityQuery } from "@/shared/api/hooks";
import {
  useStableArrayShallow,
  useStableMap,
} from "@/shared/hooks/useStableReference";
import { useActiveCommunity } from "@/features/kailo/activeCommunity";
import {
  canFetchChannelsForIdentity,
  channelsQueryKey,
  useChannelsQuery,
} from "@/features/channels/hooks";

/** Holds a resolved reference (or a cached miss) across a browse session. */
export const CHANNEL_REFERENCE_STALE_TIME_MS = 5 * 60_000;

/**
 * Returns a reference-query key nested under {@link channelsQueryKey}, so a
 * channel-list invalidation also drops a cached miss once the channel becomes
 * visible. Exported for mounted-hook regressions.
 */
export function channelReferenceQueryKey(channelId: string) {
  return [...channelsQueryKey, "reference", channelId] as const;
}

/**
 * Detail metadata does not establish membership. Only member channels and
 * non-member open channels may be navigated to from a resolved reference.
 */
export function isChannelReferenceOpenable(
  channel: Channel | undefined,
): channel is Channel {
  return (
    channel !== undefined && (channel.isMember || channel.visibility === "open")
  );
}

/**
 * A channel detail event carries no membership tag, so `fromRawChannel`
 * defaults `isMember` to true. A reference only reaches the bounded fetch
 * when the id is absent from the member list, so it is by definition not a
 * member: force `isMember: false` here so `isChannelOpenable` keeps a fetched
 * private channel non-openable.
 */
function channelFromFetchedDetail(detail: ChannelDetail): Channel {
  return { ...detail, isMember: false };
}

/**
 * Shared bounded detail query for one unresolved channel id. Both single- and
 * multi-reference consumers use this exact key, fetch, and miss-cache policy,
 * so concurrent surfaces dedupe in React Query rather than creating parallel
 * reference caches.
 */
function channelReferenceQueryOptions({
  channelId,
  enabled,
}: {
  channelId: string;
  enabled: boolean;
}) {
  return {
    enabled,
    queryKey: channelReferenceQueryKey(channelId),
    queryFn: async (): Promise<Channel | null> => {
      try {
        return channelFromFetchedDetail(await getChannelDetails(channelId));
      } catch (error) {
        if (String(error).includes("channel not found")) {
          return null;
        }
        throw error;
      }
    },
    retry: false,
    staleTime: CHANNEL_REFERENCE_STALE_TIME_MS,
  };
}

function uniqueChannelIds(
  channelIds: readonly (string | null | undefined)[],
): string[] {
  return [
    ...new Set(
      channelIds.filter((channelId): channelId is string => Boolean(channelId)),
    ),
  ];
}

/**
 * Resolves a finite set of channel ids. Known member entries win immediately;
 * only the remaining ids issue bounded `get_channel_details` requests. Per-id query
 * keys intentionally match `useChannelReference`, which shares in-flight
 * work and five-minute misses across every consumer.
 */
export function useChannelReferences(
  channelIds: readonly (string | null | undefined)[],
  options?: { enabled?: boolean },
): { channelsById: ReadonlyMap<string, Channel>; isReady: boolean } {
  const ids = useStableArrayShallow(
    React.useMemo(() => uniqueChannelIds(channelIds), [channelIds]),
  );
  const channelsQuery = useChannelsQuery(options);
  const isReady = channelsQuery.isSuccess;
  const knownById = React.useMemo(
    () =>
      new Map<string, Channel>(
        (channelsQuery.data ?? []).map((channel) => [channel.id, channel]),
      ),
    [channelsQuery.data],
  );

  const relayUrl = useActiveCommunity().relayUrl;
  const identityQuery = useIdentityQuery();
  const ownerPubkey = identityQuery.data?.pubkey ?? null;
  const canFetch =
    (options?.enabled ?? true) &&
    isReady &&
    relayUrl !== null &&
    canFetchChannelsForIdentity(ownerPubkey, identityQuery.isError);
  const fetchQueries = useQueries({
    queries: ids.map((channelId) =>
      channelReferenceQueryOptions({
        channelId,
        enabled: canFetch && !knownById.has(channelId),
      }),
    ),
  });
  const channelsById = React.useMemo(() => {
    const resolved = new Map(knownById);
    for (let index = 0; index < ids.length; index += 1) {
      const channel = fetchQueries[index]?.data;
      if (channel) {
        resolved.set(ids[index], channel);
      }
    }
    return resolved;
  }, [fetchQueries, ids, knownById]);

  return { channelsById: useStableMap(channelsById), isReady };
}

/**
 * Resolves a single channel id to its metadata (name + visibility) for a
 * reference surface — a permalink chip, project origin, repo-access channel.
 * Resolution order: the member list, then a bounded per-id
 * `get_channel_details` fetch after the member list settles (one addressable
 * kind:39000 event). A genuine "not found"
 * is cached as a resolved miss so an inaccessible id does not refetch on every
 * render; a transient relay error stays unresolved (retryable) rather than
 * caching a false miss.
 */
export function useChannelReference(
  channelId: string | null | undefined,
): Channel | undefined {
  const ids = React.useMemo(() => (channelId ? [channelId] : []), [channelId]);
  const { channelsById } = useChannelReferences(ids);
  return channelId ? channelsById.get(channelId) : undefined;
}
