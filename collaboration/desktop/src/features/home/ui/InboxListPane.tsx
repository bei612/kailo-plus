import type { InboxListPresentation } from "@client-kit/platform/react/inbox-list-pane";
import type { PlatformLocale } from "@client-kit/platform/i18n";
import { getInboxVideoReviewCommentRootId } from "@client-kit/platform/react/video-review";
import { getInboxTypeLabel, type InboxItem } from "@/features/home/lib/inbox";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { VideoReviewCommentMarkdown } from "@/shared/ui/VideoReviewCommentMarkdown";
import { UserAvatar } from "@/shared/ui/UserAvatar";

// Host adapter only: trusted native profile and body rendering for the shared
// original InboxListPane row. The list, menus, selection/read actions and
// personal branches belong to the shared Inbox page body.
export function nativeInboxListPresentation(
  item: InboxItem,
  locale: PlatformLocale,
  agentPubkeys?: ReadonlySet<string>,
): InboxListPresentation {
  const typeLabel = getInboxTypeLabel(item, locale);
  const isSenderAgent = agentPubkeys?.has(normalizePubkey(item.item.pubkey)) === true;
  return { senderLabel: item.senderLabel, timestamp: item.timestampLabel, unreadCount: item.unreadCount,
    label: typeLabel.text, channel: typeLabel.channelLabel,
    avatar: <UserProfilePopover pubkey={item.item.pubkey}
      triggerClassName={`shrink-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${isSenderAgent ? "rounded-[30%]" : "rounded-full"}`}
      triggerElement="span" triggerTestId={`home-inbox-avatar-${item.id}`}>
      <span className="inline-flex shrink-0"><UserAvatar avatarUrl={item.avatarUrl} className="h-9 w-9"
        displayName={item.senderLabel} size="md" shape={isSenderAgent ? "squircle" : "circle"} /></span>
    </UserProfilePopover>,
    sender: <UserProfilePopover pubkey={item.item.pubkey} triggerElement="span">
      <span className="block max-w-full truncate rounded text-sm font-semibold leading-4 text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">{item.senderLabel}</span>
    </UserProfilePopover>,
    preview: <VideoReviewCommentMarkdown className="inbox-preview-markdown text-inherit"
      content={item.preview} interactive={false} mentionNames={item.mentionNames}
      videoReviewCommentRootId={getInboxVideoReviewCommentRootId(item)} /> };
}
