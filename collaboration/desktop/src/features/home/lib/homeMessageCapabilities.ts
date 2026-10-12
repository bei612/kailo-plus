import type { InboxItem } from "@/features/home/lib/inbox";
import { translate, type PlatformLocale } from "@client-kit/platform/i18n";

export function getHomeMessageCapabilities(
  item: InboxItem | null,
  availableChannelIds: ReadonlySet<string>,
  locale: PlatformLocale = "en",
) {
  const hasChannel = Boolean(
    item?.item.channelId && availableChannelIds.has(item.item.channelId),
  );
  const canReply = hasChannel && item?.item.kind !== 45001 && item?.item.kind !== 45003;
  const disabledReplyReason =
    canReply || !item
      ? null
      : hasChannel
        ? translate(locale, "inbox.replyUnsupported")
        : item.item.channelId
        ? translate(locale, "inbox.replyOpenChannel")
        : translate(locale, "inbox.replyNoTarget");

  return { canReply, disabledReplyReason };
}
