// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/home/ui/HomeView.tsx (filter/unread/selection state,
// filter-change selection, auto-selection, loading/unavailable states, pane
// layout and the list/detail/auxiliary switch), lib/homePaneLayout.ts::
// getHomePaneLayout and lib/inboxSelection.ts::resolveInboxFilterSelection.
// The one Inbox page body for Web and Desktop. Hosts keep only their transport
// adapters: admitted feed aggregation, read-state writes, anchor latch/recovery,
// message detail bodies, drafts storage and profile panels.
import * as React from "react";
import { RefreshCcw } from "lucide-react";

import { useT } from "./context";
import { HomeLoadingState } from "./home-loading-state";
import { InboxListPane, type InboxListPresentation } from "./inbox-list-pane";
import { InboxLayout, type InboxFilter } from "./inbox-surface";
import { AUXILIARY_PANEL_SINGLE_COLUMN_BREAKPOINT_PX } from "./messages/thread/auxiliaryPanelLayout";
import { Button } from "./profile/buzz/shared/ui/button";
import { ReminderDetailPane, useReminderHost, useRemindersQuery } from "./reminders";
import { useElementWidth } from "./sidebar/use-mobile";
import { useHomeInboxAutoSelection } from "./use-inbox-auto-selection";
import {
  INBOX_COLUMN_MIN_WIDTH_PX,
  INBOX_SINGLE_COLUMN_BREAKPOINT_PX,
  useResizableInboxListWidth,
} from "./use-resizable-inbox-list-width";

type HomePaneLayoutOptions = {
  hasAuxiliaryPane: boolean;
  homeWidthPx: number;
  inboxListWidthPx: number;
  isDrafts: boolean;
  isMessagesMode: boolean;
  isNarrow: boolean;
  isReminders: boolean;
  isSinglePanelAuxiliaryView: boolean;
  selectedDraft: boolean;
  selectedEvent: boolean;
  selectedReminder: boolean;
  threadPanelWidthPx: number;
};

export function getHomePaneLayout(options: HomePaneLayoutOptions) {
  const singleMessage =
    options.isMessagesMode &&
    options.isNarrow &&
    options.selectedEvent &&
    !options.isSinglePanelAuxiliaryView;
  const singleDraft =
    options.isDrafts &&
    options.isNarrow &&
    options.selectedDraft &&
    !options.isSinglePanelAuxiliaryView;
  const singleReminder =
    options.isReminders &&
    options.isNarrow &&
    options.selectedReminder &&
    !options.isSinglePanelAuxiliaryView;
  const showList =
    !singleMessage &&
    !singleDraft &&
    !singleReminder &&
    !options.isSinglePanelAuxiliaryView;
  const showDetail =
    !options.isSinglePanelAuxiliaryView &&
    ((options.isMessagesMode && (!options.isNarrow || singleMessage)) ||
      (options.isDrafts && (!options.isNarrow || singleDraft)) ||
      (options.isReminders && (!options.isNarrow || singleReminder)));
  const auxiliaryWidth = options.isSinglePanelAuxiliaryView
    ? options.homeWidthPx
    : options.threadPanelWidthPx;
  const maxListWidth =
    options.homeWidthPx > 0
      ? Math.max(
          INBOX_COLUMN_MIN_WIDTH_PX,
          options.homeWidthPx -
            INBOX_COLUMN_MIN_WIDTH_PX -
            (options.hasAuxiliaryPane ? auxiliaryWidth : 0),
        )
      : undefined;

  return {
    auxiliaryPaneWidthPx: auxiliaryWidth,
    effectiveInboxListWidthPx:
      options.homeWidthPx > 0
        ? Math.min(
            options.inboxListWidthPx,
            maxListWidth ?? options.inboxListWidthPx,
          )
        : options.inboxListWidthPx,
    isSinglePanelDetailView: singleMessage,
    isSinglePanelDraftDetailView: singleDraft,
    isSinglePanelReminderDetailView: singleReminder,
    showDetailPane: showDetail,
    showListPane: showList,
  };
}

export function resolveInboxFilterSelection({
  isNarrow,
  items,
  selectedConversationId,
}: {
  isNarrow: boolean;
  items: readonly { conversationId: string; id: string }[];
  selectedConversationId: string | null;
}) {
  const preserveSelection =
    selectedConversationId !== null &&
    items.some((item) => item.conversationId === selectedConversationId);

  return {
    autoSelectedEventId:
      preserveSelection || isNarrow ? null : (items[0]?.id ?? null),
    preserveSelection,
  };
}

/**
 * Original HomeView page state. `itemId` is the host's URL `?item=` value; a
 * host may hold another anchor (for example an unsent publication's owner) in
 * `heldItemId`, which then takes the URL's place without rewriting it.
 */
export function useInboxViewState({ itemId, setItemId, heldItemId = null }: {
  itemId: string | null;
  setItemId: (id: string | null) => void;
  heldItemId?: string | null;
}) {
  const [containerRef, widthPx] = useElementWidth<HTMLDivElement>();
  const isNarrow = widthPx > 0 && widthPx < INBOX_SINGLE_COLUMN_BREAKPOINT_PX;
  const [filter, setFilter] = React.useState<InboxFilter>("all");
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  const [selectedReminderId, setSelectedReminderId] = React.useState<string | null>(null);
  const [selectedDraftKey, setSelectedDraftKey] = React.useState<string | null>(null);
  // Explicit selection is URL-owned; automatic desktop selection stays local.
  const [autoSelectedEventId, setAutoSelectedEventId] = React.useState<string | null>(null);
  const [unreadBoundary, setUnreadBoundary] = React.useState<{
    conversationId: string;
    eventId: string;
  } | null>(null);
  const isDrafts = filter === "drafts";
  const isReminders = filter === "reminders";
  const isMessagesMode = !isDrafts && !isReminders && selectedReminderId === null;
  // `?item=` is Messages-mode-only machinery: a draft never enters the
  // FeedItem selection model.
  const urlSelectedItemId = isMessagesMode ? (heldItemId ?? itemId) : null;
  const selectedEventId = urlSelectedItemId ?? autoSelectedEventId;
  const selectItem = React.useCallback((id: string | null) => {
    setAutoSelectedEventId(null);
    setItemId(id);
  }, [setItemId]);
  const resize = useResizableInboxListWidth();
  return {
    containerRef, widthPx, isNarrow,
    filter, setFilter, unreadOnly, setUnreadOnly,
    selectedReminderId, setSelectedReminderId,
    selectedDraftKey, setSelectedDraftKey,
    autoSelectedEventId, setAutoSelectedEventId,
    unreadBoundary, setUnreadBoundary,
    isDrafts, isReminders, isMessagesMode,
    urlSelectedItemId, selectedEventId, selectItem, resize,
  };
}

export type InboxViewState = ReturnType<typeof useInboxViewState>;

export type InboxViewRow = {
  id: string;
  conversationId: string;
  latestActivityAt: number;
  item: { id: string; channelId: string | null; pubkey: string; content: string };
  groupItems: readonly { id: string }[];
};

export type InboxViewStatus =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string; onRetry: () => void }
  | { kind: "ready" };

type ListAdapter<T> = {
  activeDraftCount: number;
  draftList: React.ReactNode;
  readPending?: boolean;
  onMarkRead: (row: T) => void;
  onMarkUnread: (row: T) => void;
  /** Web batches the same admitted read contexts; Native retains its original writes. */
  onMarkAllRead?: (rows: readonly T[]) => void;
  onOpen: (row: T) => void;
  reopenState: (row: T) => { pending: boolean; error: boolean; unknown: boolean };
  sourceChannelId: (row: T) => string | null;
  presentation: (row: T) => InboxListPresentation;
};

export function InboxView<T extends InboxViewRow>({
  state,
  status,
  items,
  matchesFilter,
  isRead,
  selectedConversationId,
  coldResolutionPending = false,
  list,
  drafts,
  renderMessageDetail,
  auxiliary = null,
  onRowSelected,
  onFilterChanged,
}: {
  state: InboxViewState;
  status: InboxViewStatus;
  /** Admitted rows for every message filter. */
  items: readonly T[];
  matchesFilter: (row: T, filter: InboxFilter) => boolean;
  isRead: (row: T) => boolean;
  selectedConversationId: string | null;
  coldResolutionPending?: boolean;
  list: ListAdapter<T>;
  drafts: { hasSelection: boolean; renderDetail: (args: { onBack?: () => void }) => React.ReactNode };
  /** Called whenever the detail column is in Messages mode; `visible` is the original showDetailPane. */
  renderMessageDetail: (args: {
    filteredItems: readonly T[];
    visible: boolean;
    isSinglePanel: boolean;
    /** The single-panel auxiliary view currently covers the detail column. */
    auxiliarySinglePanel: boolean;
    onBack?: () => void;
  }) => React.ReactNode;
  auxiliary?: {
    preferredWidthPx: number;
    render: (args: { widthPx: number; isSinglePanel: boolean }) => React.ReactNode;
  } | null;
  /** Host-local side effects of the original row selection. */
  onRowSelected?: (row: T) => void;
  onFilterChanged?: (filter: InboxFilter) => void;
}) {
  const t = useT();
  const reminderHost = useReminderHost();
  const reminders = useRemindersQuery(reminderHost.pubkey);
  const {
    filter, unreadOnly, isNarrow, widthPx, selectedReminderId,
    selectedEventId, urlSelectedItemId, isMessagesMode, isDrafts, isReminders,
  } = state;
  const selectedReminder = reminders.data?.find((reminder) => reminder.id === selectedReminderId) ?? null;
  const visibleIn = React.useCallback((nextFilter: InboxFilter) => items.filter(
    (row) =>
      matchesFilter(row, nextFilter) &&
      (!unreadOnly || !isRead(row) || row.conversationId === selectedConversationId),
  ), [isRead, items, matchesFilter, selectedConversationId, unreadOnly]);
  const filteredItems = React.useMemo(() => visibleIn(filter), [filter, visibleIn]);
  const ready = status.kind === "ready";
  useHomeInboxAutoSelection({
    coldResolutionPending,
    filteredItems,
    hasFeed: ready,
    hasPersonalSelection: drafts.hasSelection || selectedReminderId !== null,
    homeInboxWidthPx: widthPx,
    isLoading: status.kind === "loading",
    isMessagesMode,
    isNarrowHomeViewport: isNarrow,
    selectedConversationId,
    setAutoSelectedEventId: state.setAutoSelectedEventId,
    urlSelectedItemId,
  });

  if (status.kind === "loading") return <HomeLoadingState />;
  if (status.kind === "unavailable") {
    return (
      <div className="flex-1 overflow-hidden px-4 pb-3 pt-4 sm:px-6">
        <div className="flex w-full max-w-3xl flex-col gap-4">
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-5" role="status">
            <p className="text-base font-semibold tracking-tight">
              {t("inbox.homeUnavailable")}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{status.message}</p>
            <Button className="mt-5" onClick={status.onRetry} type="button">
              <RefreshCcw className="h-4 w-4" />
              {t("platform.retry")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const handleFilterChange = (nextFilter: InboxFilter) => {
    const selection = resolveInboxFilterSelection({
      isNarrow,
      items: visibleIn(nextFilter),
      selectedConversationId,
    });
    state.setUnreadBoundary(null);
    state.setSelectedDraftKey(null);
    state.setSelectedReminderId(null);
    state.setFilter(nextFilter);
    onFilterChanged?.(nextFilter);
    if (nextFilter === "drafts" || nextFilter === "reminders" || selection.preserveSelection) {
      if (nextFilter === "drafts" || nextFilter === "reminders") state.selectItem(null);
      return;
    }
    state.selectItem(null);
    state.setAutoSelectedEventId(selection.autoSelectedEventId);
  };

  const hasAuxiliaryPane = auxiliary !== null;
  const isSinglePanelAuxiliaryView =
    hasAuxiliaryPane && widthPx > 0 && widthPx < AUXILIARY_PANEL_SINGLE_COLUMN_BREAKPOINT_PX;
  const detailMode = isDrafts
    ? "drafts"
    : isReminders
      ? "reminders"
      : drafts.hasSelection
        ? "drafts"
        : selectedReminderId !== null
          ? "reminders"
          : "messages";
  const layout = getHomePaneLayout({
    hasAuxiliaryPane,
    homeWidthPx: widthPx,
    inboxListWidthPx: state.resize.inboxListWidthPx,
    isDrafts: detailMode === "drafts",
    isMessagesMode: detailMode === "messages",
    isNarrow,
    isReminders: detailMode === "reminders",
    isSinglePanelAuxiliaryView,
    selectedDraft: drafts.hasSelection,
    selectedEvent: selectedEventId !== null,
    selectedReminder: selectedReminderId !== null,
    threadPanelWidthPx: auxiliary?.preferredWidthPx ?? 0,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <InboxLayout containerRef={state.containerRef} listWidth={layout.effectiveInboxListWidthPx}
        auxiliaryWidth={layout.auxiliaryPaneWidthPx} showList={layout.showListPane} showDetail={layout.showDetailPane}
        hasAuxiliary={hasAuxiliaryPane} singleAuxiliary={isSinglePanelAuxiliaryView}
        onResize={state.resize.handleInboxListResizeStart}
        onReset={state.resize.canResetInboxListWidth ? state.resize.handleInboxListWidthReset : undefined}>
        {layout.showListPane ? (
          <InboxListPane
            items={filteredItems}
            filter={filter}
            onFilterChange={handleFilterChange}
            unreadOnly={unreadOnly}
            onUnreadOnlyChange={state.setUnreadOnly}
            activeDraftCount={list.activeDraftCount}
            selectedConversationId={selectedConversationId}
            selectedReminderId={selectedReminderId}
            onSelectReminder={(id) => {
              state.setUnreadBoundary(null);
              state.selectItem(null);
              state.setSelectedDraftKey(null);
              state.setSelectedReminderId(id);
            }}
            onSelect={(row) => {
              state.setSelectedReminderId(null);
              state.setUnreadBoundary(
                !isRead(row) ? { conversationId: row.conversationId, eventId: row.id } : null,
              );
              state.setSelectedDraftKey(null);
              onRowSelected?.(row);
              state.selectItem(row.id);
            }}
            isRead={isRead}
            onMarkRead={list.onMarkRead}
            onMarkUnread={list.onMarkUnread}
            onMarkAllRead={list.onMarkAllRead}
            readPending={list.readPending}
            onOpen={list.onOpen}
            reopenState={list.reopenState}
            sourceChannelId={list.sourceChannelId}
            presentation={list.presentation}
            draftList={list.draftList}
            showRightDivider={layout.showListPane && layout.showDetailPane}
          />
        ) : null}
        {detailMode === "messages" ? renderMessageDetail({
          filteredItems,
          visible: layout.showDetailPane,
          isSinglePanel: layout.isSinglePanelDetailView,
          auxiliarySinglePanel: isSinglePanelAuxiliaryView,
          onBack: layout.isSinglePanelDetailView ? () => state.selectItem(null) : undefined,
        }) : null}
        {layout.showDetailPane && detailMode === "reminders" ? (
          <ReminderDetailPane
            pubkey={reminderHost.pubkey}
            reminder={selectedReminder}
            onBack={layout.isSinglePanelReminderDetailView ? () => state.setSelectedReminderId(null) : undefined}
          />
        ) : null}
        {layout.showDetailPane && detailMode === "drafts" ? drafts.renderDetail({
          onBack: layout.isSinglePanelDraftDetailView ? () => state.setSelectedDraftKey(null) : undefined,
        }) : null}
        {auxiliary ? auxiliary.render({ widthPx: layout.auxiliaryPaneWidthPx, isSinglePanel: isSinglePanelAuxiliaryView }) : null}
      </InboxLayout>
    </div>
  );
}
