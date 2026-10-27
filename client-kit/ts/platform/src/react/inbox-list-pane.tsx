// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/home/ui/InboxListPane.tsx. One list/menu interaction body;
// hosts supply admitted items, identity/body rendering and governed commands.
import * as React from "react";
import { Clock, ExternalLink, MailOpen } from "lucide-react";
import { useT } from "./context";
import { Button, Notice } from "./ui";
import { InboxRow } from "./inbox-row";
import { InboxListHeader, InboxEmptyList, InboxRowActionButton, InboxReopenStatus, type InboxFilter } from "./inbox-surface";
import { VirtualizedList } from "./forum/VirtualizedList";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "./sidebar/context-menu";
import { RemindersPanel, useReminderHost, useRemindLater, useRemindersQuery, useReminderSources, buildInboxListRows, isDue, ReminderInboxRow } from "./reminders";
import { NeedsActionInboxRow, needsActionSortAt, type NeedsActionItem, type NeedsActionSource } from "./inbox/needs-action";
import { ComponentNotificationInboxRow, componentNotificationSortAt, type ComponentNotificationItem, type ComponentNotificationSource } from "./inbox/component-notifications";

/** DD-125(5) approval items shown with the feed rows (the host's InboxView owns selection). */
export type InboxListNeedsAction = Pick<NeedsActionSource, "status" | "refresh"> & {
  items: readonly NeedsActionItem[]; available: boolean; selectedKey: string | null;
  isDone: (item: NeedsActionItem) => boolean; setDone: (item: NeedsActionItem, done: boolean) => void;
  onSelect: (item: NeedsActionItem) => void;
};

/** DD-138(4), 07 §4.8.3: component notifications of the current filter (the host owns read and open). */
export type InboxListComponentNotifications = Pick<ComponentNotificationSource, "status" | "refresh"> & {
  items: readonly ComponentNotificationItem[];
  isRead: (item: ComponentNotificationItem) => boolean;
  onOpen: (item: ComponentNotificationItem) => void;
  onMarkRead: (items: readonly ComponentNotificationItem[]) => void;
};

type ListItem = {
  id: string; conversationId: string; latestActivityAt: number;
  item: { id: string; channelId: string | null; pubkey: string; content: string };
  groupItems: readonly { id: string }[];
};
export type InboxListPresentation = {
  senderLabel: string; sender: React.ReactNode; avatar: React.ReactNode;
  preview: React.ReactNode; timestamp: string; unreadCount: number;
  label: string; channel: string | null;
};

export function InboxListPane<T extends ListItem>({
  items, filter, onFilterChange, unreadOnly, onUnreadOnlyChange, activeDraftCount,
  selectedConversationId, selectedReminderId, onSelectReminder, onSelect,
  isRead, onMarkRead, onMarkUnread, onMarkAllRead, readPending = false,
  onOpen, reopenState, sourceChannelId, presentation, draftList, showRightDivider = false, needsAction, componentNotifications,
}: {
  items: readonly T[]; filter: InboxFilter; onFilterChange: (filter: InboxFilter) => void;
  unreadOnly: boolean; onUnreadOnlyChange: (value: boolean) => void; activeDraftCount: number;
  selectedConversationId: string | null; selectedReminderId: string | null;
  onSelectReminder: (id: string) => void; onSelect: (item: T) => void;
  isRead: (item: T) => boolean; onMarkRead: (item: T) => void; onMarkUnread: (item: T) => void;
  /** Web batches the same admitted read contexts; Native retains its original writes. */
  onMarkAllRead?: (items: readonly T[]) => void; readPending?: boolean;
  onOpen: (item: T) => void;
  reopenState: (item: T) => { pending: boolean; error: boolean; unknown: boolean };
  /** Native channel reference, not a Workspace ID used by a host's read API. */
  sourceChannelId: (item: T) => string | null;
  presentation: (item: T) => InboxListPresentation;
  draftList: React.ReactNode; showRightDivider?: boolean;
  needsAction?: InboxListNeedsAction;
  componentNotifications?: InboxListComponentNotifications;
}) {
  const t = useT();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const reminderHost = useReminderHost();
  const reminderActions = useRemindLater();
  const reminders = useRemindersQuery(reminderHost.pubkey);
  const reminderSources = useReminderSources(reminders.data ?? []);
  const feedRows = buildInboxListRows({ items, reminders: filter === "all" && !unreadOnly
    ? (reminders.data ?? []).filter(reminder => isDue(reminder, Math.floor(Date.now() / 1000))) : [] });
  type Row = (typeof feedRows)[number] | { key: string; kind: "needs_action"; needsAction: NeedsActionItem; sortAt: number }
    | { key: string; kind: "component"; component: ComponentNotificationItem; sortAt: number };
  const approvals = needsAction?.items ?? [];
  const components = componentNotifications?.items ?? [];
  const rows: Row[] = approvals.length === 0 && components.length === 0 ? feedRows : [...feedRows, ...approvals.map((item): Row => (
    { key: `needs-action:${item.key}`, kind: "needs_action", needsAction: item, sortAt: needsActionSortAt(item) })),
  ...components.map((item): Row => (
    { key: `component:${item.notificationId}`, kind: "component", component: item, sortAt: componentNotificationSortAt(item) }))]
    .sort((left, right) => right.sortAt - left.sortAt);
  // Original Inbox read failures offer an explicit retry. Each admitted source
  // keeps its own state: one failure must neither erase another source's rows
  // nor turn a partial/unknown result into a complete empty Inbox.
  const visibleSources = [
    ...(needsAction && (filter === "all" || filter === "needs_action") ? [needsAction] : []),
    ...(componentNotifications && (filter === "all" || filter === "mention" || filter === "needs_action") ? [componentNotifications] : []),
  ];
  const unavailableSources = visibleSources.filter(source => source.status === "unavailable");
  const incomplete = visibleSources.some(source => source.status !== "ready");
  const unreadItems = items.filter(item => !isRead(item));
  const undoneApprovals = approvals.filter(item => !needsAction?.isDone(item));
  const unreadComponents = components.filter(item => !componentNotifications?.isRead(item));
  const markAll = () => {
    if (readPending) return;
    // Original done marks for approval items are local only.
    for (const item of undoneApprovals) needsAction?.setDone(item, true);
    // DD-138(4): component items are read in Core (personal state), optimistically here.
    if (unreadComponents.length > 0) componentNotifications?.onMarkRead(unreadComponents);
    if (unreadItems.length === 0) return;
    if (onMarkAllRead) onMarkAllRead(unreadItems);
    else unreadItems.forEach(onMarkRead);
  };
  return <section aria-label={t("inbox.title")} className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-background/60 ${showRightDivider ? "after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:z-40 after:w-px after:bg-border/35 after:content-['']" : ""}`}>
    <InboxListHeader filter={filter} onFilterChange={onFilterChange} activeDraftCount={activeDraftCount}
      needsActionAvailable={needsAction?.available === true || componentNotifications !== undefined}
      unreadOnly={unreadOnly} onUnreadOnlyChange={onUnreadOnlyChange} unreadCount={unreadItems.length + undoneApprovals.length + unreadComponents.length}
      pending={readPending} onMarkAllRead={markAll} />
    {filter === "reminders" ? <div className="-mt-13 flex min-h-0 flex-1 flex-col overflow-hidden pt-13" data-testid="home-inbox-reminders">
      <RemindersPanel pubkey={reminderHost.pubkey} onSelectReminder={onSelectReminder} selectedReminderId={selectedReminderId} presentation="inbox-list" />
    </div> : filter === "drafts" ? <div className="-mt-13 flex min-h-0 flex-1 flex-col overflow-hidden pt-13" data-testid="home-inbox-drafts">{draftList}</div>
      : <div className="-mt-13 min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain pt-13" data-testid="home-inbox-list" ref={scrollRef}>
        {incomplete ? <Notice role="status">
          <p>{t(unavailableSources.length ? "platform.loadFailed" : "platform.loading")}</p>
          {unavailableSources.length ? <Button onClick={() => { for (const source of unavailableSources) source.refresh(); }}>{t("platform.retry")}</Button> : null}
        </Notice> : null}
        {rows.length ? <VirtualizedList estimateSize={96} getItemKey={row => row.key} items={rows} scrollRef={scrollRef} renderItem={entry => {
          if (entry.kind === "reminder") return <ReminderInboxRow reminder={entry.reminder} source={reminderSources.get(entry.reminder.id)} selected={selectedReminderId === entry.reminder.id} onSelect={() => onSelectReminder(entry.reminder.id)} />;
          if (entry.kind === "component") {
            const item = entry.component;
            const read = componentNotifications?.isRead(item) === true;
            return <ComponentNotificationInboxRow item={item} read={read}
              onOpen={() => componentNotifications?.onOpen(item)} onMarkRead={() => componentNotifications?.onMarkRead([item])} />;
          }
          if (entry.kind === "needs_action") {
            const approval = entry.needsAction;
            const done = needsAction?.isDone(approval) === true;
            const toggle = () => needsAction?.setDone(approval, !done);
            return <ContextMenu><ContextMenuTrigger asChild><div><NeedsActionInboxRow item={approval}
              selected={needsAction?.selectedKey === approval.key} done={done} onToggleDone={toggle}
              onSelect={() => { needsAction?.onSelect(approval); if (!done) needsAction?.setDone(approval, true); }} /></div></ContextMenuTrigger>
              <ContextMenuContent><ContextMenuItem onSelect={toggle}><MailOpen className="h-4 w-4" />{t(done ? "inbox.markUnread" : "inbox.markRead")}</ContextMenuItem></ContextMenuContent></ContextMenu>;
          }
          const row = entry.item;
          const view = presentation(row);
          const read = isRead(row);
          const reopening = reopenState(row);
          const hasChannel = Boolean(row.item.channelId);
          const openLabel = t(reopening.pending ? "inbox.reopening" : hasChannel ? "inbox.open" : "inbox.noChannelLink");
          const open = () => { if (hasChannel && !reopening.pending) onOpen(row); };
          const mark = () => { if (!readPending) (read ? onMarkUnread : onMarkRead)(row); };
          const channelId = sourceChannelId(row);
          const canRemind = reminderActions.available && hasChannel && Boolean(channelId);
          const hasReminder = Boolean(entry.dueReminder) || [row.item.id, ...row.groupItems.map(item => item.id)].some(id => reminderActions.activeReminderEventIds.has(id));
          const reminderLabel = t(hasReminder ? "reminders.created" : "reminders.remindLater");
          const remind = () => { if (canRemind && channelId) reminderActions.openReminder({ eventId: row.item.id, channelId, preview: row.item.content.slice(0, 100), authorPubkey: row.item.pubkey }); };
          return <ContextMenu><ContextMenuTrigger asChild><div><InboxRow id={row.id}
            selected={row.conversationId === selectedConversationId} read={read} reminderDue={Boolean(entry.dueReminder)}
            sender={view.sender} avatar={view.avatar} timestamp={view.timestamp}
            unread={view.unreadCount > 1 ? t("inbox.unreadCount", { count: view.unreadCount }) : null}
            label={view.label} channel={view.channel} openLabel={t("inbox.openItem", { sender: view.senderLabel })}
            onSelect={() => { onSelect(row); if (!read && !readPending) onMarkRead(row); }}
            preview={<>{view.preview}<InboxReopenStatus id={row.id} pending={reopening.pending} error={reopening.error} unknown={reopening.unknown} onRetry={open} /></>}
            actions={<>
              <InboxRowActionButton disabled={readPending} label={t(read ? "inbox.markUnread" : "inbox.markRead")} onClick={mark}><MailOpen className="h-4 w-4" /></InboxRowActionButton>
              {hasChannel ? <InboxRowActionButton disabled={reopening.pending} label={openLabel} onClick={open}><ExternalLink className="h-4 w-4" /></InboxRowActionButton> : null}
              {canRemind ? <InboxRowActionButton active={hasReminder} label={reminderLabel} onClick={remind}><Clock className="h-4 w-4" /></InboxRowActionButton> : null}
            </>} /></div></ContextMenuTrigger><ContextMenuContent>
              <ContextMenuItem disabled={readPending} onSelect={mark}><MailOpen className="h-4 w-4" />{t(read ? "inbox.markUnread" : "inbox.markRead")}</ContextMenuItem>
              {hasChannel ? <><ContextMenuSeparator /><ContextMenuItem disabled={reopening.pending} onSelect={open}><ExternalLink className="h-4 w-4" />{openLabel}</ContextMenuItem></> : null}
              {canRemind ? <ContextMenuItem onSelect={remind}><Clock className="h-4 w-4" />{reminderLabel}</ContextMenuItem> : null}
            </ContextMenuContent></ContextMenu>;
        }} /> : incomplete ? null : <InboxEmptyList filter={filter} unreadOnly={unreadOnly} />}
      </div>}
  </section>;
}
