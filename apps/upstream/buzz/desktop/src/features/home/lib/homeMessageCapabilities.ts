import type { InboxItem } from "@/features/home/lib/inbox";

export function getHomeMessageCapabilities(
  item: InboxItem | null,
  availableChannelIds: ReadonlySet<string>,
) {
  const canReply = Boolean(
    item?.item.channelId && availableChannelIds.has(item.item.channelId),
  );
  const disabledReplyReason =
    canReply || !item
      ? null
      : item.item.channelId
        ? "Open the linked channel to reply."
        : "This inbox item does not have a reply target.";

  return { canReply, disabledReplyReason };
}
