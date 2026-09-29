import type {
  Channel,
  ChannelDetail,
  ChannelMember,
  ChannelType,
} from "@/shared/api/types";
import { invokeTauri } from "@/shared/api/tauri";

export type RawChannel = {
  id: string;
  name: string;
  channel_type: ChannelType;
  visibility: "open" | "private";
  description: string;
  topic: string | null;
  purpose: string | null;
  member_count: number;
  member_pubkeys: string[];
  last_message_at: string | null;
  archived_at: string | null;
  participants: string[];
  participant_pubkeys: string[];
  is_member?: boolean;
  ttl_seconds: number | null;
  ttl_deadline: string | null;
};

/**
 * Response payload for the `get_channels` Tauri command.
 *
 * When `channels` is `null`, the caller's `knownHash` matched the relay
 * snapshot and the expensive channel list was not re-serialized across IPC.
 * `lastMessages` is always present so the caller can update sidebar
 * timestamps without a full channel-list re-render.
 */
export type GetChannelsPayload = {
  hash: string;
  /** Full channel list, or `null` on a not-modified (hash-match) response. */
  channels: Channel[] | null;
  /** Map of channel id → ISO-8601 timestamp of its most recent message. */
  lastMessages: Record<string, string>;
};

type RawChannelDetail = RawChannel & {
  created_by: string;
  created_at: string;
  updated_at: string;
  topic_set_by: string | null;
  topic_set_at: string | null;
  purpose_set_by: string | null;
  purpose_set_at: string | null;
  topic_required: boolean;
  max_members: number | null;
  nip29_group_id: string | null;
};

type RawChannelMember = {
  pubkey: string;
  role: ChannelMember["role"];
  is_agent?: boolean;
  joined_at: string;
  display_name: string | null;
};

type RawChannelMembersResponse = {
  members: RawChannelMember[];
  next_cursor: string | null;
};

export function fromRawChannel(channel: RawChannel): Channel {
  return {
    id: channel.id,
    name: channel.name,
    channelType: channel.channel_type,
    visibility: channel.visibility,
    description: channel.description,
    topic: channel.topic,
    purpose: channel.purpose,
    memberCount: channel.member_count,
    memberPubkeys: channel.member_pubkeys ?? [],
    lastMessageAt: channel.last_message_at,
    archivedAt: channel.archived_at,
    participants: channel.participants,
    participantPubkeys: channel.participant_pubkeys,
    isMember: channel.is_member ?? true,
    ttlSeconds: channel.ttl_seconds,
    ttlDeadline: channel.ttl_deadline,
  };
}

export function fromRawChannelDetail(channel: RawChannelDetail): ChannelDetail {
  return {
    ...fromRawChannel(channel),
    createdBy: channel.created_by,
    createdAt: channel.created_at,
    updatedAt: channel.updated_at,
    topicSetBy: channel.topic_set_by,
    topicSetAt: channel.topic_set_at,
    purposeSetBy: channel.purpose_set_by,
    purposeSetAt: channel.purpose_set_at,
    topicRequired: channel.topic_required,
    maxMembers: channel.max_members,
    nip29GroupId: channel.nip29_group_id,
  };
}

function fromRawChannelMember(member: RawChannelMember): ChannelMember {
  return {
    pubkey: member.pubkey,
    role: member.role,
    isAgent: member.is_agent ?? false,
    joinedAt: member.joined_at,
    displayName: member.display_name,
  };
}

/**
 * Fetch the channel list from the backend.
 *
 * Pass `knownHash` from a previous response to enable the not-modified
 * short-circuit: when the relay snapshot is unchanged, `channels` in the
 * returned payload will be `null` so the multi-MB list is not deserialized.
 * Pass `null` to always request the full list.
 */
export async function getChannels(
  knownHash: string | null,
): Promise<GetChannelsPayload> {
  const raw = await invokeTauri<{
    hash: string;
    channels: RawChannel[] | null;
    last_messages: Record<string, string>;
  }>("get_channels", { knownHash });
  return {
    hash: raw.hash,
    channels: raw.channels !== null ? raw.channels.map(fromRawChannel) : null,
    lastMessages: raw.last_messages,
  };
}

export async function getChannelDetails(
  channelId: string,
): Promise<ChannelDetail> {
  const detail = await invokeTauri<RawChannelDetail>("get_channel_details", {
    channelId,
  });
  return fromRawChannelDetail(detail);
}

export async function getChannelMembers(
  channelId: string,
): Promise<ChannelMember[]> {
  const response = await invokeTauri<RawChannelMembersResponse>(
    "get_channel_members",
    { channelId },
  );
  return response.members.map(fromRawChannelMember);
}
