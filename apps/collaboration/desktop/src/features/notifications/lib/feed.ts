import type { Channel, FeedItem, HomeFeedResponse } from "@/shared/api/types";
import { formatMessageNotification } from "@/features/notifications/lib/notificationFormat";

export type NotificationChannel = Pick<Channel, "id" | "name">;

export function enrichFeedItemChannel(
  item: FeedItem,
  channels: readonly NotificationChannel[],
): FeedItem {
  if (!item.channelId || item.channelName.trim()) {
    return item;
  }

  const channel = channels.find((candidate) => candidate.id === item.channelId);
  return channel ? { ...item, channelName: channel.name } : item;
}

export function formatFeedNotification(item: FeedItem, senderName?: string) {
  return formatMessageNotification({
    source: "mention",
    senderName,
    channelName: item.channelName,
    content: item.content,
  });
}

export function eligibleFeedNotificationItems(
  feed: HomeFeedResponse,
  channels: readonly NotificationChannel[] = [],
) {
  return feed.feed.mentions
    .map((item) => enrichFeedItemChannel(item, channels))
    .sort((left, right) => left.createdAt - right.createdAt);
}
