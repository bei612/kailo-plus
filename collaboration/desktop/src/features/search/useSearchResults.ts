// The fixed original search state and presentation are shared by both hosts.
// Native keeps its local identity and original Relay read hooks.
import { createSearchResultsReader } from "@client-kit/platform/react/search/useSearchResults";
import { useUserSearchQuery, useUsersBatchQuery } from "@/features/profile/hooks";
import { useSearchMessagesQuery } from "@/features/search/hooks";

export const useSearchResults = createSearchResultsReader({
  useUserSearchQuery,
  useUsersBatchQuery,
  useSearchMessagesQuery,
});
