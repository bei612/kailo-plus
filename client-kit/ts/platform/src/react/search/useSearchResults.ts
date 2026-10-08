// Buzz 779af8886caae1317b4de962082429867ab61503: original search state and ranking, shared by both hosts.
import * as React from "react";
import { rankUserCandidatesBySearch } from "./userCandidateSearch";
import { scoreChannelMatch } from "../channel-browser/channelSearchScore";
import { getMinimumSearchQueryLength, MIN_SEARCH_QUERY_LENGTH } from "./searchQueryLimits";
import { isChannelUuid, isHexPubkey, normalizeFromHandle, normalizeInChannel, parseSearchOperators, type OperatorResolveResult } from "./parseSearchOperators";
import type { SearchResult } from "./SearchResultItem";
import type { SearchChannel as Channel, SearchHit, SearchMessagesResponse, UserSearchResult } from "./types";
import type { UserProfileLookup } from "../messages/system/identity";
import { normalizePubkey } from "../conversations/pubkey";

export type SearchDataHooks = {
  useUserSearchQuery: (query: string, options?: {allowEmpty?:boolean;enabled?:boolean;limit?:number}) => {data?:UserSearchResult[];isLoading:boolean;error?:unknown};
  useUsersBatchQuery: (pubkeys:string[], options?:{enabled?:boolean}) => {data?:{profiles:UserProfileLookup};error?:unknown};
  useSearchMessagesQuery: (query:string, options?:{channelId?:string;authors?:string[];since?:number|null;until?:number|null;enabled?:boolean;limit?:number;unresolvedOperator?:boolean;minimumQueryLength?:number}) => {data?:SearchMessagesResponse;isLoading:boolean;error:unknown};
};

function formatUserResultName(user: UserSearchResult) {
  return user.displayName?.trim() || user.nip05Handle?.trim() || user.pubkey;
}

function dedupeSearchHits(hits: SearchHit[]) {
  const seenEventIds = new Set<string>();

  return hits.filter((hit) => {
    if (seenEventIds.has(hit.eventId)) {
      return false;
    }

    seenEventIds.add(hit.eventId);
    return true;
  });
}

function resolveChannelIdFromOperator(
  raw: string | null,
  channels: Channel[],
  channelLabels?: Record<string, string>,
): OperatorResolveResult<string> {
  if (!raw) {
    return { status: "none" };
  }
  const value = normalizeInChannel(raw);
  if (!value) {
    return { status: "none" };
  }
  if (isChannelUuid(value)) {
    return { status: "resolved", value };
  }
  const needle = value.toLowerCase();
  const match = channels.find((channel) => {
    const label = channelLabels?.[channel.id]?.trim() || channel.name;
    return channel.name.toLowerCase() === needle || label.toLowerCase() === needle;
  });
  return match
    ? { status: "resolved", value: match.id }
    : { status: "unresolved" };
}

function resolveAuthorFromOperator(
  raw: string | null,
  candidates: Array<{ pubkey: string; displayName?: string | null }>,
): OperatorResolveResult<string> {
  if (!raw) {
    return { status: "none" };
  }
  if (isHexPubkey(raw)) {
    return { status: "resolved", value: normalizePubkey(raw) };
  }
  const handle = normalizeFromHandle(raw).toLowerCase();
  if (!handle) {
    return { status: "unresolved" };
  }
  const match = candidates.find((candidate) => {
    const name = candidate.displayName?.trim().toLowerCase();
    return name === handle || normalizePubkey(candidate.pubkey) === handle;
  });
  return match
    ? { status: "resolved", value: normalizePubkey(match.pubkey) }
    : { status: "unresolved" };
}

export function createSearchResultsReader({useUserSearchQuery,useUsersBatchQuery,useSearchMessagesQuery}:SearchDataHooks) {
return function useSearchResults({
  channelLabels,
  channels,
  enabled,
  limit = 12,
  scopeChannelId,
}: {
  channelLabels?: Record<string, string>;
  channels: Channel[];
  enabled: boolean;
  limit?: number;
  scopeChannelId?: string | null;
}) {
  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const parsedQuery = React.useMemo(
    () => parseSearchOperators(debouncedQuery),
    [debouncedQuery],
  );
  const minimumQueryLength = getMinimumSearchQueryLength(scopeChannelId);
  const hasSearchQuery =
    debouncedQuery.trim().length >= minimumQueryLength ||
    parsedQuery.since !== null ||
    parsedQuery.until !== null ||
    parsedQuery.from !== null ||
    parsedQuery.in !== null;
  const searchBackedQueriesEnabled = enabled && hasSearchQuery;

  const channelLookup = React.useMemo(
    () => new Map(channels.map((channel) => [channel.id, channel])),
    [channels],
  );

  const channelResolution = React.useMemo<OperatorResolveResult<string>>(
    () =>
      scopeChannelId
        ? { status: "resolved", value: scopeChannelId }
        : resolveChannelIdFromOperator(parsedQuery.in, channels, channelLabels),
    [parsedQuery.in, channels, channelLabels, scopeChannelId],
  );

  const ftsQuery = parsedQuery.text;

  const entitySearchEnabled = searchBackedQueriesEnabled && !scopeChannelId;

  const fromHandleForLookup =
    parsedQuery.from && !isHexPubkey(parsedQuery.from)
      ? normalizeFromHandle(parsedQuery.from)
      : "";

  const fromUserSearchQuery = useUserSearchQuery(fromHandleForLookup, {
    enabled: searchBackedQueriesEnabled && fromHandleForLookup.length >= 1,
    limit,
  });
  const userSearchQuery = useUserSearchQuery(ftsQuery, {
    enabled: entitySearchEnabled,
    limit,
  });
  const fuzzyUserCandidatesQuery = useUserSearchQuery("", {
    allowEmpty: true,
    enabled: entitySearchEnabled && ftsQuery.length >= 4,
    limit: 100,
  });

  const authorCandidateSeed = React.useMemo(() => {
    const candidates: Array<{ pubkey: string; displayName?: string | null }> =
      [];
    const seen = new Set<string>();
    const push = (pubkey: string, displayName?: string | null) => {
      const key = normalizePubkey(pubkey);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      candidates.push({ pubkey: key, displayName });
    };
    for (const user of fromUserSearchQuery.data ?? []) {
      push(user.pubkey, user.displayName);
    }
    for (const user of userSearchQuery.data ?? []) {
      push(user.pubkey, user.displayName);
    }
    return candidates;
  }, [fromUserSearchQuery.data, userSearchQuery.data]);

  const authorResolution = React.useMemo(
    () => resolveAuthorFromOperator(parsedQuery.from, authorCandidateSeed),
    [parsedQuery.from, authorCandidateSeed],
  );

  const hasUnresolvedOperator =
    authorResolution.status === "unresolved" ||
    channelResolution.status === "unresolved";

  // While `from:@name` user search is still loading, hold off so we do not
  // flash an unresolved empty state before candidates arrive.
  const waitingOnFromResolution =
    Boolean(fromHandleForLookup) &&
    fromUserSearchQuery.isLoading &&
    authorResolution.status === "unresolved";

  const searchQuery = useSearchMessagesQuery(ftsQuery, {
    enabled:
      enabled &&
      !hasUnresolvedOperator &&
      !waitingOnFromResolution &&
      ftsQuery.length >= minimumQueryLength,
    limit,
    channelId:
      channelResolution.status === "resolved"
        ? channelResolution.value
        : undefined,
    authors:
      authorResolution.status === "resolved"
        ? [authorResolution.value]
        : undefined,
    since: parsedQuery.since,
    until: parsedQuery.until,
    unresolvedOperator: hasUnresolvedOperator,
    minimumQueryLength,
  });

  const messageResults = React.useMemo(() => {
    if (hasUnresolvedOperator) {
      return [];
    }
    return dedupeSearchHits(searchQuery.data?.hits ?? []);
  }, [hasUnresolvedOperator, searchQuery.data?.hits]);
  const channelResults = React.useMemo(() => {
    if (scopeChannelId || ftsQuery.length < MIN_SEARCH_QUERY_LENGTH) {
      return [];
    }

    const normalizedQuery = ftsQuery.toLowerCase();

    return channels
      .flatMap((channel) => {
        const isVisible = channel.archivedAt || channel.archived === true
          ? channel.isMember : channel.visibility === "open" || channel.isMember;
        if (!isVisible) return [];

        const displayName = channelLabels?.[channel.id]?.trim() || channel.name;
        const displayScore = scoreChannelMatch(
          { name: displayName, description: channel.description },
          normalizedQuery,
        );
        const rawNameScore = scoreChannelMatch(
          { name: channel.name, description: "" }, normalizedQuery,
        );
        const scores = [displayScore, rawNameScore].filter((score): score is number => score !== null);
        return scores.length === 0 ? [] : [{ channel, displayName, score: Math.min(...scores) }];
      })
      .sort(
        (a, b) =>
          a.score - b.score || a.displayName.localeCompare(b.displayName),
      )
      .slice(0, 5)
      .map(({ channel }) => channel);
  }, [channelLabels, channels, ftsQuery, scopeChannelId]);
  const userResults = React.useMemo<UserSearchResult[]>(() => {
    if (scopeChannelId || ftsQuery.length < MIN_SEARCH_QUERY_LENGTH) {
      return [];
    }

    const candidatesByPubkey = new Map<string, UserSearchResult>();

    const addCandidate = (candidate: UserSearchResult) => {
      const pubkey = normalizePubkey(candidate.pubkey);
      const existing = candidatesByPubkey.get(pubkey);
      if (!existing) {
        candidatesByPubkey.set(pubkey, { ...candidate, pubkey });
        return;
      }

      candidatesByPubkey.set(pubkey, {
        ...existing,
        avatarUrl: existing.avatarUrl ?? candidate.avatarUrl ?? null,
        displayName: existing.displayName ?? candidate.displayName,
        nip05Handle: existing.nip05Handle ?? candidate.nip05Handle ?? null,
      });
    };

    for (const user of userSearchQuery.data ?? []) {
      addCandidate(user);
    }

    for (const user of fuzzyUserCandidatesQuery.data ?? []) {
      addCandidate(user);
    }

    return rankUserCandidatesBySearch({
      candidates: [...candidatesByPubkey.values()],
      getLabel: formatUserResultName,
      limit,
      query: ftsQuery,
    });
  }, [
    fuzzyUserCandidatesQuery.data,
    ftsQuery,
    limit,
    scopeChannelId,
    userSearchQuery.data,
  ]);

  const results = React.useMemo<SearchResult[]>(
    () => [
      ...channelResults.map((channel) => ({
        kind: "channel" as const,
        channel,
      })),
      ...userResults.map((user) => ({
        kind: "user" as const,
        user,
      })),
      ...messageResults.map((hit) => ({
        kind: "message" as const,
        hit,
      })),
    ],
    [channelResults, messageResults, userResults],
  );

  const resultProfilesQuery = useUsersBatchQuery(
    messageResults.map((hit) => hit.pubkey),
    {
      enabled: enabled && messageResults.length > 0,
    },
  );

  React.useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < minimumQueryLength) {
      setDebouncedQuery("");
      return;
    }

    const timeout = window.setTimeout(() => {
      setDebouncedQuery(trimmed);
    }, 300);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [minimumQueryLength, query]);

  React.useEffect(() => {
    if (!enabled) {
      setQuery("");
      setDebouncedQuery("");
      setSelectedIndex(0);
    }
  }, [enabled]);

  React.useEffect(() => {
    setSelectedIndex((current) => {
      if (results.length === 0) {
        return 0;
      }

      return Math.min(current, results.length - 1);
    });
  }, [results]);

  return {
    channelLookup,
    channelResults,
    debouncedQuery,
    isWaitingOnFromResolution: waitingOnFromResolution,
    messageResults,
    query,
    resultProfiles: resultProfilesQuery.data?.profiles,
    results,
    searchQuery: {
      ...searchQuery,
      error: searchQuery.error ?? fromUserSearchQuery.error ?? userSearchQuery.error ?? fuzzyUserCandidatesQuery.error ?? resultProfilesQuery.error,
    },
    selectedIndex,
    selectedResult: results[selectedIndex],
    setQuery,
    setSelectedIndex,
    userResults,
    fuzzyUserCandidatesQuery,
    userSearchQuery,
  };
}

}
