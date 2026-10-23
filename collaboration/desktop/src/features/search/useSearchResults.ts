// The fixed original search state and presentation are shared by both hosts.
// Native keeps its local identity and original Relay read hooks.
import { createSearchResultsReader } from "@client-kit/platform/react/search/useSearchResults";
import { useUserSearchQuery, useUsersBatchQuery } from "@/features/profile/hooks";
import { useComponentSearchQuery, useSearchMessagesQuery } from "@/features/search/hooks";

export const useSearchResults = createSearchResultsReader({
  useUserSearchQuery,
  useUsersBatchQuery,
  useSearchMessagesQuery,
  // DD-138(5), 07 §4.8.4: component content source, as on the Web host.
  useComponentSearchQuery,
});
