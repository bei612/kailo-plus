import { Clock, ExternalLink, MailOpen } from "lucide-react";
import * as React from "react";
import { InboxRow } from "@client-kit/platform/react/inbox-row";
import { InboxListHeader, InboxEmptyList, InboxRowActionButton, InboxReopenStatus } from "@client-kit/platform/react/inbox-surface";
import { useLocale, useT } from "@client-kit/platform/react/context";
import { RemindersPanel, useReminderHost, useRemindLater, useRemindersQuery, useReminderSources, buildInboxListRows, isDue, ReminderInboxRow, type Reminder } from "@client-kit/platform/react/reminders";

import {
  getInboxTypeLabel,
  type InboxFilter,
  type InboxItem,
} from "@/features/home/lib/inbox";
import { getInboxVideoReviewCommentRootId } from "@client-kit/platform/react/video-review";
import {
  DraftsPanel,
  type DraftViewItem,
} from "@/features/messages/ui/DraftsPanel";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import { cn } from "@/shared/lib/cn";
import { normalizePubkey } from "@/shared/lib/pubkey";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/ui/context-menu";
import { VideoReviewCommentMarkdown } from "@/shared/ui/VideoReviewCommentMarkdown";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { VirtualizedList } from "@/shared/ui/VirtualizedList";

const INBOX_PANE_RIGHT_DIVIDER_CLASS =
  "after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:z-40 after:w-px after:bg-border/35 after:content-['']";

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
  isReopenPending?: (channelId: string) => boolean;
  isReopenErrored?: (channelId: string) => boolean;
  isReopenUnknown?: (channelId: string) => boolean;
};

export function InboxListPane({
  agentPubkeys,
  activeDraftCount,
  draftItems,
  doneSet,
  filter,
  items,
  onFilterChange,
  onDeleteDraft,
  onMarkRead,
  onMarkUnread,
  onOpenDirect,
  onSelect,
  onSelectDraft,
  onUnreadOnlyChange,
  selectedConversationId,
  selectedDraftKey,
  selectedReminderId,
  onSelectReminder,
  showRightDivider = false,
  unreadOnly,
  isReopenPending,
  isReopenErrored,
  isReopenUnknown,
}: InboxListPaneProps) {
  const t = useT();
  const locale = useLocale();
  const reminderHost = useReminderHost();
  const reminderActions = useRemindLater();
  const reminders=useRemindersQuery(reminderHost.pubkey);
  const reminderSources=useReminderSources(reminders.data??[]);
  const visibleInboxRows=buildInboxListRows({items,reminders:filter==="all"&&!unreadOnly?(reminders.data??[]).filter(reminder=>isDue(reminder,Math.floor(Date.now()/1000))):[]});
  const isDrafts = filter === "drafts";
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const unreadVisibleItemCount = React.useMemo(
    () =>
      items.reduce((count, item) => count + (doneSet.has(item.id) ? 0 : 1), 0),
    [doneSet, items],
  );
  const handleMarkAllRead = React.useCallback(() => {
    for (const item of items) {
      if (!doneSet.has(item.id)) {
        onMarkRead(item.id);
      }
    }
  }, [doneSet, items, onMarkRead]);

  const renderItem = (item: InboxItem, dueReminder?: Reminder) => {
    const isSelected = item.conversationId === selectedConversationId;
    const isDone = doneSet.has(item.id);
    const isReopening = Boolean(item.item.channelId && isReopenPending?.(item.item.channelId));
    const canOpen = Boolean(item.item.channelId) && !isReopening;
    const openLabel = isReopening ? t("inbox.reopening") : canOpen ? t("inbox.open") : t("inbox.noChannelLink");
    const typeLabel = getInboxTypeLabel(item, locale);
    const isSenderAgent = agentPubkeys?.has(normalizePubkey(item.item.pubkey)) === true;
    const videoReviewCommentRootId = getInboxVideoReviewCommentRootId(item);
    const hasActiveReminder=Boolean(dueReminder)||[item.id,...item.groupItems.map(event=>event.id)].some(id=>reminderActions.activeReminderEventIds.has(id));
    const remind = () => {
      if (item.item.channelId) reminderActions.openReminder({ eventId: item.item.id, channelId: item.item.channelId, preview: item.item.content.slice(0, 100), authorPubkey: item.item.pubkey });
    };
    const row = (
      <InboxRow
        id={item.id}
        selected={isSelected}
        read={isDone}
        reminderDue={Boolean(dueReminder)}
        openLabel={t("inbox.openItem", { sender: item.senderLabel })}
        onSelect={() => onSelect(item.id)}
        timestamp={item.timestampLabel}
        unread={
          item.unreadCount > 1
            ? t("inbox.unreadCount", { count: item.unreadCount })
            : null
        }
        label={typeLabel.text}
        channel={typeLabel.channelLabel}
        avatar={
          <UserProfilePopover
            pubkey={item.item.pubkey}
            triggerClassName={cn("shrink-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring", isSenderAgent ? "rounded-[30%]" : "rounded-full")}
            triggerElement="span"
            triggerTestId={`home-inbox-avatar-${item.id}`}
          >
            <span className="inline-flex shrink-0">
              <UserAvatar
                avatarUrl={item.avatarUrl}
                className="h-9 w-9"
                displayName={item.senderLabel}
                size="md"
                shape={isSenderAgent ? "squircle" : "circle"}
              />
            </span>
          </UserProfilePopover>
        }
        sender={
          <UserProfilePopover pubkey={item.item.pubkey} triggerElement="span">
            <span className="block max-w-full truncate rounded text-sm font-semibold leading-4 text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
              {item.senderLabel}
            </span>
          </UserProfilePopover>
        }
        preview={
          <><VideoReviewCommentMarkdown
            className="inbox-preview-markdown text-inherit"
            content={item.preview}
            interactive={false}
            mentionNames={item.mentionNames}
            videoReviewCommentRootId={videoReviewCommentRootId}
          /><InboxReopenStatus id={item.id} pending={isReopening} error={Boolean(item.item.channelId && isReopenErrored?.(item.item.channelId))} unknown={Boolean(item.item.channelId && isReopenUnknown?.(item.item.channelId))} onRetry={() => onOpenDirect(item)}/></>
        }
        actions={
          <>
            {isDone ? (
              <InboxRowActionButton
                label={t("inbox.markUnread")}
                onClick={() => onMarkUnread(item.id)}
              >
                <MailOpen className="!h-4 !w-4" />
              </InboxRowActionButton>
            ) : (
              <InboxRowActionButton
                label={t("inbox.markRead")}
                onClick={() => onMarkRead(item.id)}
              >
                <MailOpen className="!h-4 !w-4" />
              </InboxRowActionButton>
            )}
            {item.item.channelId?<InboxRowActionButton
              disabled={!canOpen}
              label={openLabel}
              onClick={() => onOpenDirect(item)}
            >
              <ExternalLink className="!h-4 !w-4" />
            </InboxRowActionButton>:null}
            {reminderActions.available && item.item.channelId ? <InboxRowActionButton active={hasActiveReminder} label={t(hasActiveReminder?"reminders.created":"reminders.remindLater")} onClick={remind}><Clock className="!h-4 !w-4" /></InboxRowActionButton> : null}
          </>
        }
      />
    );

    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent>
          {isDone ? (
            <ContextMenuItem onClick={() => onMarkUnread(item.id)}>
              <MailOpen className="h-4 w-4" />
              {t("inbox.markUnread")}
            </ContextMenuItem>
          ) : (
            <ContextMenuItem onClick={() => onMarkRead(item.id)}>
              <MailOpen className="h-4 w-4" />
              {t("inbox.markRead")}
            </ContextMenuItem>
          )}
          {item.item.channelId?<><ContextMenuSeparator />
          <ContextMenuItem
            disabled={!canOpen}
            onClick={() => {
              if (canOpen) {
                onOpenDirect(item);
              }
            }}
          >
            <ExternalLink className="h-4 w-4" />
            {openLabel}
          </ContextMenuItem></>:null}
          {reminderActions.available && item.item.channelId ? <ContextMenuItem onClick={remind}><Clock className="h-4 w-4" />{t(hasActiveReminder?"reminders.created":"reminders.remindLater")}</ContextMenuItem> : null}
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  return (
    <section
      className={cn(
        "relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-background/60",
        showRightDivider && INBOX_PANE_RIGHT_DIVIDER_CLASS,
      )}
    >
      <InboxListHeader filter={filter} onFilterChange={onFilterChange} activeDraftCount={activeDraftCount}
        unreadOnly={unreadOnly} onUnreadOnlyChange={onUnreadOnlyChange} unreadCount={unreadVisibleItemCount}
        onMarkAllRead={handleMarkAllRead} />

      {filter === "reminders" ? (
        <div className="-mt-13 flex min-h-0 flex-1 flex-col overflow-hidden pt-13" data-testid="home-inbox-reminders">
          <RemindersPanel pubkey={reminderHost.pubkey} onSelectReminder={onSelectReminder}
            selectedReminderId={selectedReminderId} presentation="inbox-list" />
        </div>
      ) : isDrafts ? (
        <div
          className="-mt-13 flex min-h-0 flex-1 flex-col overflow-hidden pt-13"
          data-testid="home-inbox-drafts"
        >
          <DraftsPanel
            items={draftItems}
            onDeleteDraft={onDeleteDraft}
            onSelectDraft={onSelectDraft}
            selectedDraftKey={selectedDraftKey}
          />
        </div>
      ) : (
        <div
          className="-mt-13 min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain pt-13"
          data-testid="home-inbox-list"
          ref={scrollRef}
        >
          {visibleInboxRows.length > 0 ? (
            <VirtualizedList
              estimateSize={96}
              getItemKey={(row) => row.key}
              items={visibleInboxRows}
              renderItem={(row) => row.kind==="inbox"?renderItem(row.item,row.dueReminder):<ReminderInboxRow reminder={row.reminder} source={reminderSources.get(row.reminder.id)} selected={selectedReminderId===row.reminder.id} onSelect={()=>onSelectReminder(row.reminder.id)} />}
              scrollRef={scrollRef}
            />
          ) : (
            <InboxEmptyList filter={filter} unreadOnly={unreadOnly} />
          )}
        </div>
      )}
    </section>
  );
}
