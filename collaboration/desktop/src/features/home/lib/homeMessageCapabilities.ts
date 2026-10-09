import type { InboxItem } from "@/features/home/lib/inbox";
import { translate, type PlatformLocale } from "@client-kit/platform/i18n";

export function getHomeMessageCapabilities(
  item: InboxItem | null,
  availableChannelIds: ReadonlySet<string>,
  locale: PlatformLocale = "en",
) {
  const canReply = Boolean(
    item?.item.channelId && availableChannelIds.has(item.item.channelId),
  );
  const disabledReplyReason =
    canReply || !item
      ? null
      : item.item.channelId
        ? translate(locale, "inbox.replyOpenChannel")
        : translate(locale, "inbox.replyNoTarget");

  return { canReply, disabledReplyReason };
}
