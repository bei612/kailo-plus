import { useQuery } from "@tanstack/react-query";

import { searchMessages } from "@/shared/api/tauri";
import { useBffClient, useLocale } from "@client-kit/platform/react/context";
import { validComponentSearchPage } from "@client-kit/platform/react/search/componentSearch";
import { TransportError } from "@client-kit/platform/transport";
import { useNativeSession } from "@/features/platform/activeCommunity";

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

// DD-138(5), 07 §4.8.4: component content as a 「搜索全部」 source over the BFF (POST
// /api/v1/search/components), the same client-kit call as the Web host. The shared reader enables
// it only for the unscoped, debounced query of at least two characters; its failure never fails
// the message search. Keyed by the native session so results never cross people or communities.
export function useComponentSearchQuery(query: string, options: { enabled: boolean }) {
  const client = useBffClient();
  const session = useNativeSession();
  const locale = useLocale();
  return useQuery({
    queryKey: ["platform", session.facts.relayUrl, session.devicePubkey, "search-components", query, locale],
    enabled: options.enabled,
    retry: false,
    queryFn: async () => {
      const page: unknown = await client.searchComponents({ q: query, locale: locale === "zh-CN" ? "ZH_CN" : "EN" });
      if (!validComponentSearchPage(page)) throw new TransportError("Invalid component search page");
      return page;
    },
  });
}
