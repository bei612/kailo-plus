// Buzz 779af8886caae1317b4de962082429867ab61503: original search presentation; host reads remain transport-specific.
export const MIN_SEARCH_QUERY_LENGTH = 2;
export const MIN_SCOPED_SEARCH_QUERY_LENGTH = 1;
export function getMinimumSearchQueryLength(channelId?: string | null) {
  return channelId ? MIN_SCOPED_SEARCH_QUERY_LENGTH : MIN_SEARCH_QUERY_LENGTH;
}
