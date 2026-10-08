import { useQuery } from "@tanstack/react-query";

import { searchMessages } from "@/shared/api/tauri";

export { MIN_SEARCH_QUERY_LENGTH, MIN_SCOPED_SEARCH_QUERY_LENGTH, getMinimumSearchQueryLength } from "@client-kit/platform/react/search/searchQueryLimits";
import { getMinimumSearchQueryLength } from "@client-kit/platform/react/search/searchQueryLimits";

export function useSearchMessagesQuery(
  query: string,
  options?: {
    channelId?: string;
    authors?: string[];
    since?: number | null;
    until?: number | null;
    enabled?: boolean;
    limit?: number;
    unresolvedOperator?: boolean;
    minimumQueryLength?: number;
  },
) {
  const trimmedQuery = query.trim();
  const enabled = options?.enabled ?? true;
  const limit = options?.limit ?? 12;
  const channelId = options?.channelId;
  const authors = options?.authors;
  const since = options?.since ?? null;
  const until = options?.until ?? null;
  const unresolvedOperator = options?.unresolvedOperator ?? false;
  const minimumQueryLength =
    options?.minimumQueryLength ?? getMinimumSearchQueryLength(channelId);

  return useQuery({
    queryKey: [
      "search-messages",
      trimmedQuery,
      limit,
      channelId ?? null,
      authors ?? null,
      since,
      until,
      unresolvedOperator,
    ],
    queryFn: () =>
      searchMessages({
        q: trimmedQuery,
        limit,
        channelId,
        authors,
        since: since ?? undefined,
        until: until ?? undefined,
      }),
    // Call sites own the "when to search" floor (FTS length / unresolved
    // operators). Keep a single threshold here so it cannot drift.
    enabled: enabled && trimmedQuery.length >= minimumQueryLength,
    staleTime: 30_000,
    gcTime: 5 * 60 * 1_000,
  });
}
