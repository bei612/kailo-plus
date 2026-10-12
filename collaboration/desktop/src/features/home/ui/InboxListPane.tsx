import { InboxListPane as SharedInboxListPane } from "@client-kit/platform/react/inbox-list-pane";
import { useLocale } from "@client-kit/platform/react/context";
import { getInboxVideoReviewCommentRootId } from "@client-kit/platform/react/video-review";
import { getInboxTypeLabel, type InboxFilter, type InboxItem } from "@/features/home/lib/inbox";
import { DraftsPanel, type DraftViewItem } from "@/features/messages/ui/DraftsPanel";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { VideoReviewCommentMarkdown } from "@/shared/ui/VideoReviewCommentMarkdown";
import { UserAvatar } from "@/shared/ui/UserAvatar";

type InboxListPaneProps = {
  agentPubkeys?: ReadonlySet<string>;
  activeDraftCount: number;
  draftItems: DraftViewItem[];
  doneSet: ReadonlySet<string>;
  filter: InboxFilter;
  items: InboxItem[];
  onFilterChange: (filter: InboxFilter) => void;
  onDeleteDraft: (draftKey: string) => void;
  onMarkRead: (itemId: string) => void;
  onMarkUnread: (itemId: string) => void;
  onOpenDirect: (item: InboxItem) => void;
  onSelect: (itemId: string) => void;
  onSelectDraft: (draftKey: string) => void;
  onUnreadOnlyChange: (checked: boolean) => void;
  selectedConversationId: string | null;
  selectedDraftKey: string | null;
  selectedReminderId: string | null;
  onSelectReminder: (id: string) => void;
  showRightDivider?: boolean;
  unreadOnly: boolean;
  readPending?: boolean;
  isReopenPending?: (channelId: string) => boolean;
  isReopenErrored?: (channelId: string) => boolean;
  isReopenUnknown?: (channelId: string) => boolean;
};

// Host adapter only: trusted native profile/body and original governed writes.
// The complete list, menus, selection/read action and personal branches are shared.
export function InboxListPane(props: InboxListPaneProps) {
  const locale = useLocale();
  return <SharedInboxListPane items={props.items} filter={props.filter} onFilterChange={props.onFilterChange}
    unreadOnly={props.unreadOnly} onUnreadOnlyChange={props.onUnreadOnlyChange}
    activeDraftCount={props.activeDraftCount} selectedConversationId={props.selectedConversationId}
    selectedReminderId={props.selectedReminderId} onSelectReminder={props.onSelectReminder}
    onSelect={item => props.onSelect(item.id)} isRead={item => props.doneSet.has(item.id)}
    onMarkRead={item => props.onMarkRead(item.id)} onMarkUnread={item => props.onMarkUnread(item.id)}
    readPending={props.readPending} onOpen={props.onOpenDirect} showRightDivider={props.showRightDivider}
    sourceChannelId={item => item.item.channelId}
    reopenState={item => ({ pending: Boolean(item.item.channelId && props.isReopenPending?.(item.item.channelId)),
      error: Boolean(item.item.channelId && props.isReopenErrored?.(item.item.channelId)),
      unknown: Boolean(item.item.channelId && props.isReopenUnknown?.(item.item.channelId)) })}
    draftList={<DraftsPanel items={props.draftItems} onDeleteDraft={props.onDeleteDraft}
      onSelectDraft={props.onSelectDraft} selectedDraftKey={props.selectedDraftKey} />}
    presentation={item => {
      const typeLabel = getInboxTypeLabel(item, locale);
      const isSenderAgent = props.agentPubkeys?.has(normalizePubkey(item.item.pubkey)) === true;
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
    }} />;
}
