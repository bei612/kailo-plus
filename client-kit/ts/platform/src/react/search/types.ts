// Buzz 779af8886caae1317b4de962082429867ab61503: original search presentation; host reads remain transport-specific.
export type ChannelType = "stream" | "forum" | "dm";
export type ChannelVisibility = "open" | "private";
export type ChannelRole = "owner" | "admin" | "member" | "guest" | "bot";

export type Channel = {
  id: string;
  name: string;
  channelType: ChannelType;
  visibility: ChannelVisibility;
  description: string;
  topic: string | null;
  purpose: string | null;
  memberCount: number;
  memberPubkeys: string[];
  lastMessageAt: string | null;
  archivedAt: string | null;
  participants: string[];
  participantPubkeys: string[];
  isMember: boolean;
  ttlSeconds: number | null;
  ttlDeadline: string | null;
};

// Search consumes the original presentation fields, not a fabricated full Relay
// channel. A BFF host may know archived state without the original timestamp.
export type SearchChannel = Pick<Channel, "id" | "name" | "channelType" | "visibility" | "description" | "lastMessageAt" | "isMember"> &
  Partial<Pick<Channel, "archivedAt" | "participants" | "participantPubkeys">> & { archived?: boolean };

export type UserSearchResult = {
  pubkey: string;
  displayName: string | null;
  avatarUrl: string | null;
  nip05Handle: string | null;
  ownerPubkey: string | null;
  isAgent: boolean;
};

export type SearchMessagesInput = {
  q: string;
  limit?: number;
  channelId?: string;
  /** Hex pubkeys for `from:` operator. */
  authors?: string[];
  /** Unix seconds (`after:YYYY-MM-DD`). */
  since?: number;
  /** Unix seconds (`before:YYYY-MM-DD`). */
  until?: number;
};

export type SearchHit = {
  eventId: string;
  content: string;
  kind: number;
  pubkey: string;
  channelId: string | null;
  channelName: string | null;
  createdAt: number;
  score: number;
  threadRootId?: string | null;
};

export type SearchMessagesResponse = {
  hits: SearchHit[];
  found: number;
};
