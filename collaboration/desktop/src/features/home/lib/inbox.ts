import {
  resolveUserLabel,
  type UserProfileLookup,
} from "@/features/profile/lib/identity";
import type {
  Channel,
  FeedItem,
  FeedItemCategory,
  InboxFeed,
  RelayEvent,
} from "@/shared/api/types";
import { formatItemTimestamp } from "@/shared/lib/datetime";
import { resolveMentionProps } from "@/shared/lib/resolveMentionNames";
import { aggregateInbox, inboxConversation, feedHeadline, getInboxTypeLabel } from "@client-kit/platform/inbox";
export { getInboxTypeLabel, isThreadActivityItem } from "@client-kit/platform/inbox";
export type { InboxTypeLabel } from "@client-kit/platform/inbox";
import type { TimelineMessage } from "@/features/messages/types";

export type { InboxFilter } from "@client-kit/platform/react/inbox-surface";

export type InboxItem = {
  avatarUrl: string | null;
  /**
   * Stable conversation identity: the NIP-10 root. Does NOT change when a new
   * reply advances the representative latest event. Use this for lifecycle
   * continuity: scroll gating, draft keys, local-reply storage, and selection.
   */
  conversationId: string;
  id: string;
  item: FeedItem;
  categories: FeedItemCategory[];
  categoryLabel: string;
  channelLabel: string | null;
  fullTimestampLabel: string;
  groupItems: FeedItem[];
  latestActivityAt: number;
  mentionNames: string[];
  mentionPubkeysByName?: Record<string, string>;
  preview: string;
  senderLabel: string;
  subject: string;
  timestampLabel: string;
  unreadCount: number;
};

export type InboxReply = {
  authorLabel: string;
  authorPubkey: string;
  avatarUrl: string | null;
  content: string;
  createdAt: number;
  depth?: number;
  fullTimestampLabel: string;
  id: string;
  parentId?: string | null;
  rootId?: string | null;
  tags?: string[][];
  /** Clock time only, for the hover gutter on continuation rows. */
  timeLabel?: string;
  reactions?: TimelineMessage["reactions"];
  pending?: TimelineMessage["pending"];
};

export type InboxContextMessage = InboxReply & {
  depth: number;
  isSelected: boolean;
  mentionNames: string[];
  mentionPubkeysByName?: Record<string, string>;
};

type InboxChannel = Pick<Channel, "id" | "name" | "channelType">;

const fullTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function feedPreview(item: FeedItem) {
  const content = item.content.trim();
  if (content.length > 0) {
    return content;
  }

  return "No additional details were attached to this event.";
}

function categoryLabelFor(category: FeedItemCategory) {
  return category === "mention" ? "Mention" : "Activity";
}

function resolveItemChannel(
  item: FeedItem,
  channelById: ReadonlyMap<string, InboxChannel>,
) {
  const channel = item.channelId ? channelById.get(item.channelId) : undefined;
  const name = item.channelName?.trim() || channel?.name.trim() || null;

  return { name, type: item.channelType ?? channel?.channelType };
}

function resolveGroupChannel(
  primaryItem: FeedItem,
  groupItems: FeedItem[],
  channelById: ReadonlyMap<string, InboxChannel>,
) {
  for (const candidate of [primaryItem, ...groupItems]) {
    const channel = resolveItemChannel(candidate, channelById);
    if (channel.name) {
      return channel;
    }
  }

  return resolveItemChannel(primaryItem, channelById);
}

export function formatInboxTypeLabel(item: InboxItem) {
  const label = getInboxTypeLabel(item);
  return label.channelLabel
    ? `${label.text} #${label.channelLabel}`
    : label.text;
}

/**
 * Returns the stable conversation ID for any FeedItem or relay event: the
 * NIP-10 root, parent-reply tag, then event id. This is the same derivation
 * used by `buildInboxItems` for `conversationId`.
 */
export function getInboxConversationId(
  tags: string[][],
  eventId: string,
  channelId?: string | null,
  channelType?: string,
): string {
  return inboxConversation({ tags, id: eventId, channelId, channelType });
}

/** Returns the stable conversation identity for a complete Inbox feed item. */
export function getInboxItemConversationId(item: FeedItem) {
  return getInboxConversationId(item.tags, item.id, item.channelId, item.channelType);
}

/** Finds the Inbox row containing an event, including grouped events. */
export function findInboxItemByEventId(
  items: readonly InboxItem[],
  eventId: string,
): InboxItem | null {
  return (
    items.find((item) => item.id === eventId) ??
    items.find((item) =>
      item.groupItems.some((groupItem) => groupItem.id === eventId),
    ) ??
    null
  );
}

function formatInboxTimestamp(unixSeconds: number) {
  return formatItemTimestamp(unixSeconds);
}

export function formatInboxFullTimestamp(unixSeconds: number) {
  return fullTimeFormatter.format(new Date(unixSeconds * 1_000));
}

export function relayEventFromFeedItem(item: FeedItem): RelayEvent {
  return {
    content: item.content,
    created_at: item.createdAt,
    id: item.id,
    kind: item.kind,
    pubkey: item.pubkey,
    sig: "",
    tags: item.tags,
  };
}

export function buildInboxItems({
  channels,
  currentPubkey,
  feed,
  getMessageReadAt,
  getThreadReadAt,
  getChannelReadAt,
  profiles,
}: {
  channels?: InboxChannel[];
  currentPubkey?: string;
  feed?: InboxFeed;
  getMessageReadAt?: (messageId: string) => number | null;
  getChannelReadAt?: (channelId: string) => number | null;
  getThreadReadAt?: (
    rootId: string,
    channelId?: string | null,
  ) => number | null;
  profiles?: UserProfileLookup;
}): InboxItem[] {
  if (!feed) {
    return [];
  }

  const channelById = new Map(
    (channels ?? []).map((channel) => [channel.id, channel]),
  );

  const withChannelType = (items: FeedItem[]) => items.map(item => ({
    ...item,
    channelType: item.channelType ?? (item.channelId ? channelById.get(item.channelId)?.channelType : undefined),
  }));
  return aggregateInbox(
    { mentions: withChannelType(feed.mentions), activity: withChannelType(feed.activity) },
    getMessageReadAt,
    getThreadReadAt,
    getChannelReadAt,
  ).map(
    (group) => {
      const { conversationId, item } = group;
      const groupChannel = resolveGroupChannel(item, group.items, channelById);
      const categories = group.categories;
      const senderLabel = resolveUserLabel({
        pubkey: item.pubkey,
        currentPubkey,
        profiles,
        preferResolvedSelfLabel: true,
      });
      const subject = feedHeadline(item);
      const preview = feedPreview(item);
      const { mentionNames, mentionPubkeysByName } = resolveMentionProps(
        item.tags,
        profiles,
        item.content,
      );
      const channelLabel = groupChannel.name;
      const displayItem: FeedItem = {
        ...item,
        channelName: channelLabel ?? item.channelName,
        channelType: item.channelType ?? groupChannel.type,
      };
      const categoryLabel = categoryLabelFor(categories[0] ?? item.category);

      return {
        avatarUrl: profiles?.[item.pubkey.toLowerCase()]?.avatarUrl ?? null,
        conversationId,
        id: item.id,
        item: displayItem,
        categories,
        categoryLabel,
        channelLabel,
        fullTimestampLabel: formatInboxFullTimestamp(item.createdAt),
        groupItems: group.items,
        latestActivityAt: group.latestActivityAt,
        mentionNames: mentionNames ?? [],
        mentionPubkeysByName,
        preview,
        senderLabel,
        subject,
        timestampLabel: formatInboxTimestamp(group.latestActivityAt),
        unreadCount: group.unreadCount,
      };
    },
  );
}
