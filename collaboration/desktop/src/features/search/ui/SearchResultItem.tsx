import { Bot, FileText, Hash, MessageCircle, User } from "lucide-react";

import type { SearchHit, UserSearchResult, Channel } from "@/shared/api/types";

export type SearchResult =
  | { kind: "channel"; channel: Channel }
  | { kind: "user"; user: UserSearchResult }
  | { kind: "message"; hit: SearchHit };

export function resultKey(result: SearchResult) {
  if (result.kind === "channel") {
    return `channel-${result.channel.id}`;
  }

  if (result.kind === "user") {
    return `user-${result.user.pubkey}`;
  }

  return `message-${result.hit.eventId}`;
}

export function resultTestId(result: SearchResult) {
  if (result.kind === "channel") {
    return `search-result-channel-${result.channel.id}`;
  }

  if (result.kind === "user") {
    return `search-result-user-${result.user.pubkey}`;
  }

  return `search-result-${result.hit.eventId}`;
}

// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/search/ui/SearchResultItem.tsx::resultIcon.
export function resultIcon(
  result: SearchResult,
  channelLookup: ReadonlyMap<string, Channel>,
) {
  if (result.kind === "user") {
    return result.user.isAgent ? Bot : User;
  }

  const channelType =
    result.kind === "channel"
      ? result.channel.channelType
      : result.hit.channelId
        ? channelLookup.get(result.hit.channelId)?.channelType
        : undefined;

  if (channelType === "forum") {
    return FileText;
  }

  if (channelType === "dm") {
    return MessageCircle;
  }

  return Hash;
}
