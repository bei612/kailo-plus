import type { Dispatch, SetStateAction } from "react";
import type { UserProfileLookup } from "../messages/system/identity";
import type { Channel } from "./types";
import type { SearchResult } from "./SearchResultItem";

// Only the existing host read hook crosses this seam: no search/index authority in the UI.
export type SearchResultsReader = (options: {
  channelLabels?: Record<string, string>;
  channels: Channel[];
  enabled: boolean;
  limit?: number;
  scopeChannelId?: string | null;
}) => {
  channelLookup: ReadonlyMap<string, Channel>;
  debouncedQuery: string;
  fuzzyUserCandidatesQuery: { isLoading: boolean };
  isWaitingOnFromResolution: boolean;
  query: string;
  resultProfiles?: UserProfileLookup;
  results: SearchResult[];
  searchQuery: { isLoading: boolean; error: unknown };
  setQuery: Dispatch<SetStateAction<string>>;
  userSearchQuery: { isLoading: boolean };
};
