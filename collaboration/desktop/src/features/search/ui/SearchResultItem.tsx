import { Hash, User } from "lucide-react";

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

export function resultIcon(result: SearchResult) {
  return result.kind === "user" ? User : Hash;
}
