// Buzz 779af8886caae1317b4de962082429867ab61503: original search presentation; host reads remain transport-specific.
import {
  Bot,
  FileText,
  Hash,
  MessageCircle,
  Plus,
  User,
} from "lucide-react";

import { HashSearch } from "./icons";
import type { Channel, SearchHit, UserSearchResult } from "./types";

export type SearchResult =
  | {
      kind: "action";
      action: {
        description?: string;
        id: "browse-channels" | "create-agent" | "create-channel";
        title: string;
      };
    }
  | { kind: "channel"; channel: Channel }
  | { kind: "user"; user: UserSearchResult }
  | { kind: "message"; hit: SearchHit };

export function resultKey(result: SearchResult) {
  if (result.kind === "action") {
    return `action-${result.action.id}`;
  }

  if (result.kind === "channel") {
    return `channel-${result.channel.id}`;
  }

  if (result.kind === "user") {
    return `user-${result.user.pubkey}`;
  }

  return `message-${result.hit.eventId}`;
}

export function resultTestId(result: SearchResult) {
  if (result.kind === "action") {
    return `search-result-action-${result.action.id}`;
  }

  if (result.kind === "channel") {
    return `search-result-channel-${result.channel.id}`;
  }

  if (result.kind === "user") {
    return `search-result-user-${result.user.pubkey}`;
  }

  return `search-result-${result.hit.eventId}`;
}

export function resultIcon(
  result: SearchResult,
  channelLookup: ReadonlyMap<string, Channel>,
) {
  if (result.kind === "action") {
    if (result.action.id === "browse-channels") {
      return HashSearch;
    }
    return result.action.id === "create-agent" ? Bot : Plus;
  }

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
