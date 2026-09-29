import * as React from "react";
import { RefreshCcw } from "lucide-react";

import { useAppShell } from "@/app/AppShellContext";
import { useChannelsQuery } from "@/features/channels/hooks";
import { RightAuxiliaryPane } from "@/features/channels/ui/RightAuxiliaryPane";
import {
  type InboxFilter,
  type InboxReply,
  buildInboxItems,
  findInboxItemByEventId,
  formatInboxFullTimestamp,
  getInboxItemConversationId,
} from "@/features/home/lib/inbox";
import { useInboxSelectionAnchor } from "@/features/home/useInboxSelectionAnchor";
import { matchesInboxFilter } from "@/features/home/lib/inboxViewHelpers";
import { resolveInboxFilterSelection } from "@/features/home/lib/inboxSelection";
import { useHomeDrafts } from "@/features/home/useHomeDrafts";
import { useHomeInboxReadState } from "@/features/home/useHomeInboxReadState";
import { useHomeInboxAutoSelection } from "@/features/home/useHomeInboxAutoSelection";
import { useHomeInboxContextMessages } from "@/features/home/useHomeInboxContextMessages";
import { useInboxThreadContext } from "@/features/home/useInboxThreadContext";
import { UserProfilePanel } from "@/features/profile/ui/UserProfilePanel";
import {
  INBOX_SINGLE_COLUMN_BREAKPOINT_PX,
  useResizableInboxListWidth,
} from "@/features/home/useResizableInboxListWidth";
import { getHomePaneLayout } from "@/features/home/lib/homePaneLayout";
import { getHomeMessageCapabilities } from "@/features/home/lib/homeMessageCapabilities";
import { HomeLoadingState } from "@/features/home/ui/HomeLoadingState";
import { InboxDetailPane } from "@/features/home/ui/InboxDetailPane";
import { InboxListPane } from "@/features/home/ui/InboxListPane";
import { useChannelMessagesQuery } from "@/features/messages/hooks";
import { collectMessageMentionPubkeys } from "@/features/messages/lib/formatTimelineMessages";
import { formatTime } from "@/features/messages/lib/dateFormatters";
import { splitOutgoingTags } from "@/features/messages/lib/imetaMediaMarkdown";
import { getThreadReference } from "@/features/messages/lib/threading";
import { DraftDetailPane } from "@/features/messages/ui/DraftDetailPane";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { useRelaySelfQuery } from "@/shared/api/relaySelf";
import { sendChannelMessage } from "@/shared/api/tauri";
import type { InboxFeed } from "@/shared/api/types";
import { topChromeInset } from "@/shared/layout/chromeLayout";
import { cn } from "@/shared/lib/cn";
import { useElementWidth } from "@/shared/hooks/use-mobile";
import { useThreadPanelWidth } from "@/shared/hooks/useThreadPanelWidth";
import { AUXILIARY_PANEL_SINGLE_COLUMN_BREAKPOINT_PX } from "@/shared/layout/AuxiliaryPanel";
import { useHistorySearchState } from "@/shared/hooks/useHistorySearchState";
import { ProfilePanelProvider } from "@/shared/context/ProfilePanelContext";
import { Button } from "@/shared/ui/button";

const INBOX_SEARCH_KEYS = ["item", "profile"] as const;

type HomeViewProps = {
  feed?: InboxFeed;
  isLoading?: boolean;
  errorMessage?: string;
  currentPubkey?: string;
  availableChannelIds: ReadonlySet<string>;
  onOpenContext: (
    channelId: string,
    messageId: string,
    threadRootId?: string | null,
  ) => void;
  onRefresh: () => void;
};

export function HomeView({
  feed,
  isLoading = false,
  errorMessage,
  currentPubkey,
  availableChannelIds,
  onOpenContext,
  onRefresh,
}: HomeViewProps) {
  const relaySelfPubkey = useRelaySelfQuery().data;
  const [homeInboxRef, homeInboxWidthPx] = useElementWidth<HTMLDivElement>();
  const isNarrowHomeViewport =
    homeInboxWidthPx > 0 &&
    homeInboxWidthPx < INBOX_SINGLE_COLUMN_BREAKPOINT_PX;
  const [filter, setFilter] = React.useState<InboxFilter>("all");
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  // Explicit selections are mirrored to the URL (`?item=`), so back/forward
  // restores the detail pane each history entry was showing and reloads
  // restore it from the URL. Default/automatic selection stays local-only —
  // background data loads must never trigger navigations.
  const { applyPatch: applyInboxSearchPatch, values: inboxSearchValues } =
    useHistorySearchState(INBOX_SEARCH_KEYS);
  const isDrafts = filter === "drafts";
  const isMessagesMode = !isDrafts;
  // Drafts are only listed (and selectable) under the dedicated Drafts filter.
  const {
    activeCount: activeDraftCount,
    deleteDraft: handleDeleteDraft,
    items: draftItems,
    selectedItem: selectedDraftItem,
    selectedKey: selectedDraftKey,
    selectDraft: setSelectedDraftKey,
  } = useHomeDrafts({
    autoSelect: isDrafts,
    isNarrowHomeViewport,
    selectionEnabled: isDrafts,
    viewportWidthPx: homeInboxWidthPx,
  });
  // `?item=` is Messages-mode-only machinery: a draft never enters the
  // FeedItem selection model.
  const urlSelectedItemId = isMessagesMode ? inboxSearchValues.item : null;
  const profilePanelPubkey = inboxSearchValues.profile;
  // Explicit selection is URL-owned; automatic desktop selection stays local.
  const [autoSelectedEventId, setAutoSelectedEventId] = React.useState<
    string | null
  >(null);
  const [unreadBoundary, setUnreadBoundary] = React.useState<{
    conversationId: string;
    eventId: string;
  } | null>(null);
  const selectedEventId = urlSelectedItemId ?? autoSelectedEventId;
  const handleUserSelectItem = React.useCallback(
    (itemId: string | null) => {
      setAutoSelectedEventId(null);
      applyInboxSearchPatch({ item: itemId });
    },
    [applyInboxSearchPatch],
  );
  const handleOpenProfilePanel = React.useCallback(
    (pubkey: string) => {
      applyInboxSearchPatch({ profile: pubkey });
    },
    [applyInboxSearchPatch],
  );
  const handleCloseProfilePanel = React.useCallback(() => {
    applyInboxSearchPatch({ profile: null });
  }, [applyInboxSearchPatch]);
  const [isSendingReply, setIsSendingReply] = React.useState(false);
  const [localRepliesByItemId, setLocalRepliesByItemId] = React.useState<
    Record<string, InboxReply[]>
  >({});
  const {
    canReset: canResetThreadPanelWidth,
    onResetWidth: handleThreadPanelWidthReset,
    onResizeStart: handleThreadPanelResizeStart,
    widthPx: threadPanelWidthPx,
  } = useThreadPanelWidth();
  const {
    canResetInboxListWidth,
    handleInboxListResizeStart,
    handleInboxListWidthReset,
    inboxListWidthPx,
  } = useResizableInboxListWidth();
  const {
    clearChannelUnreadSource,
    getChannelReadAt,
    getThreadReadAt,
    getMessageReadAt,
    feedItemState,
    markChannelRead,
    markChannelUnread,
    markMessageRead,
    markThreadRead,
    readStateVersion,
  } = useAppShell();
  const { doneSet, markDone, markUnread, undoDone, undoUnread, unreadSet } =
    feedItemState;
  const { feedItems, activeLatchedItem, coldResolutionPending } =
    useInboxSelectionAnchor({
      feed,
      selectedEventId,
      availableChannelIds,
    });

  const threadContextFeedItem = activeLatchedItem;
  // Derive the default composer parent from the active anchor's own tags so
  // that InboxDetailPane can recover the original reply target even when the
  // anchor event has been displaced from the current groupItems. This is null
  // until the active item is resolved (anchor not yet found in feedItems and
  // no matching committed latch).
  const latchedDefaultParentId =
    activeLatchedItem !== null
      ? (getThreadReference(activeLatchedItem.tags).parentId ??
        activeLatchedItem.id)
      : null;
  const channelsQuery = useChannelsQuery();
  const channels = channelsQuery.data;
  const selectedChannelIdCandidate = threadContextFeedItem?.channelId ?? null;
  const selectedChannel = React.useMemo(() => {
    if (!selectedChannelIdCandidate || !channels) return null;
    return (
      channels.find((channel) => channel.id === selectedChannelIdCandidate) ??
      null
    );
  }, [channels, selectedChannelIdCandidate]);
  const hasAuxiliaryPane = profilePanelPubkey !== null;
  const isSinglePanelAuxiliaryView =
    hasAuxiliaryPane &&
    homeInboxWidthPx > 0 &&
    homeInboxWidthPx < AUXILIARY_PANEL_SINGLE_COLUMN_BREAKPOINT_PX;

  const channelMessagesQuery = useChannelMessagesQuery(selectedChannel);
  const channelMessages = channelMessagesQuery.data;
  const threadContext = useInboxThreadContext(
    threadContextFeedItem,
    channelMessages,
  );

  const feedProfilePubkeys = React.useMemo(
    () => [
      ...new Set([
        ...feedItems.map((item) => item.pubkey),
        ...collectMessageMentionPubkeys(feedItems),
        ...threadContext.events.map((event) => event.pubkey),
        ...collectMessageMentionPubkeys(threadContext.events),
        ...(currentPubkey ? [currentPubkey] : []),
      ]),
    ],
    [currentPubkey, feedItems, threadContext.events],
  );
  const feedProfilesQuery = useUsersBatchQuery(feedProfilePubkeys, {
    enabled: feedProfilePubkeys.length > 0,
  });
  const feedProfiles = feedProfilesQuery.data?.profiles;
  // biome-ignore lint/correctness/useExhaustiveDependencies: readStateVersion invalidates the stable read-marker callbacks
  const inboxItems = React.useMemo(
    () =>
      buildInboxItems({
        channels,
        currentPubkey,
        feed,
        getMessageReadAt,
        getThreadReadAt,
        profiles: feedProfiles,
      }),
    [
      channels,
      currentPubkey,
      feed,
      feedProfiles,
      getMessageReadAt,
      getThreadReadAt,
      readStateVersion,
    ],
  );
  const { effectiveDoneSet, markItemRead, markItemUnread } =
    useHomeInboxReadState({
      items: inboxItems,
      getChannelReadAt,
      getThreadReadAt,
      getMessageReadAt,
      readStateVersion,
      localDoneSet: doneSet,
      localUnreadSet: unreadSet,
      clearChannelUnreadSource,
      markChannelRead,
      markChannelUnread,
      markMessageRead,
      markThreadRead,
      markDoneLocal: markDone,
      markUnreadLocal: markUnread,
      undoDoneLocal: undoDone,
      undoUnreadLocal: undoUnread,
    });
  // Resolve selection before filtering so unread-only can retain its active row.
  const selectedItemFromAll = React.useMemo(
    () =>
      selectedEventId
        ? findInboxItemByEventId(inboxItems, selectedEventId)
        : null,
    [inboxItems, selectedEventId],
  );
  // selectedConversationId: prefer the InboxItem-derived conversationId (stable
  // group key). Fall back to deriving it from the latched FeedItem when the
  // anchored event is no longer present in any group's items — this keeps the
  // correct row selected (by conversationId) even after the anchor event has
  // been displaced from groupItems by a newer representative.
  const latchedConversationId = activeLatchedItem
    ? getInboxItemConversationId(activeLatchedItem)
    : null;
  const selectedConversationId =
    selectedItemFromAll?.conversationId ?? latchedConversationId;

  const filteredItems = React.useMemo(() => {
    return inboxItems.filter(
      (item) =>
        matchesInboxFilter(item, filter) &&
        (!unreadOnly ||
          !effectiveDoneSet.has(item.id) ||
          item.conversationId === selectedConversationId),
    );
  }, [
    effectiveDoneSet,
    filter,
    inboxItems,
    selectedConversationId,
    unreadOnly,
  ]);
  // A filter change may only retain detail for a conversation that remains
  // visible. The filter handler selects the next valid row in the same update,
  // so the detail pane never renders a stale conversation between states.
  const selectedItem = React.useMemo(() => {
    if (!selectedEventId) return null;
    const fromFiltered = findInboxItemByEventId(filteredItems, selectedEventId);
    if (fromFiltered) return fromFiltered;
    if (selectedConversationId) {
      return (
        filteredItems.find(
          (item) => item.conversationId === selectedConversationId,
        ) ?? null
      );
    }
    return null;
  }, [filteredItems, selectedConversationId, selectedEventId]);
  const handleOpenItem = React.useCallback(
    (item: {
      item: { channelId: string | null; id: string; tags: string[][] };
    }) => {
      const channelId = item.item.channelId;
      if (!channelId) return;
      const thread = getThreadReference(item.item.tags);
      onOpenContext(channelId, item.item.id, thread.rootId);
    },
    [onOpenContext],
  );
  const unreadBoundaryEventId = React.useMemo(() => {
    if (!selectedItem) return null;
    if (unreadBoundary?.conversationId === selectedItem.conversationId) {
      return unreadBoundary.eventId;
    }
    return effectiveDoneSet.has(selectedItem.id) ? null : selectedItem.id;
  }, [effectiveDoneSet, selectedItem, unreadBoundary]);
  const contextMessages = useHomeInboxContextMessages({
    currentPubkey,
    events: threadContext.events,
    profiles: feedProfiles,
    relaySelfPubkey,
    selectedEventId,
    selectedItem,
  });
  const selectedItemReplies = React.useMemo<InboxReply[]>(() => {
    if (!selectedItem) return [];
    const localReplies =
      localRepliesByItemId[selectedItem.conversationId] ?? [];
    const contextIds = new Set(contextMessages.map((message) => message.id));
    return localReplies.filter((reply) => !contextIds.has(reply.id));
  }, [contextMessages, localRepliesByItemId, selectedItem]);
  useHomeInboxAutoSelection({
    coldResolutionPending,
    filteredItems,
    hasFeed: Boolean(feed),
    hasPersonalSelection: selectedDraftItem !== null,
    homeInboxWidthPx,
    isLoading,
    isMessagesMode,
    isNarrowHomeViewport,
    selectedConversationId,
    setAutoSelectedEventId,
    urlSelectedItemId,
  });

  React.useEffect(() => {
    void selectedConversationId;
    setIsSendingReply(false);
  }, [selectedConversationId]);

  const handleFilterChange = React.useCallback(
    (nextFilter: InboxFilter) => {
      const nextItems = inboxItems.filter(
        (item) =>
          matchesInboxFilter(item, nextFilter) &&
          (!unreadOnly ||
            !effectiveDoneSet.has(item.id) ||
            item.conversationId === selectedConversationId),
      );
      const selection = resolveInboxFilterSelection({
        isNarrow: isNarrowHomeViewport,
        items: nextItems,
        selectedConversationId,
      });

      setUnreadBoundary(null);
      setSelectedDraftKey(null);
      setFilter(nextFilter);

      if (nextFilter === "drafts" || selection.preserveSelection) {
        if (nextFilter === "drafts") {
          setAutoSelectedEventId(null);
          applyInboxSearchPatch({ item: null });
        }
        return;
      }

      applyInboxSearchPatch({ item: null });
      setAutoSelectedEventId(selection.autoSelectedEventId);
    },
    [
      applyInboxSearchPatch,
      effectiveDoneSet,
      inboxItems,
      isNarrowHomeViewport,
      selectedConversationId,
      setSelectedDraftKey,
      unreadOnly,
    ],
  );

  if (isLoading && !feed) {
    return <HomeLoadingState />;
  }

  if (!feed) {
    return (
      <div className="flex-1 overflow-hidden px-4 pb-3 pt-4 sm:px-6">
        <div className="flex w-full max-w-3xl flex-col gap-4">
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-5">
            <p className="text-base font-semibold tracking-tight">
              Home feed unavailable
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {errorMessage ?? "The relay did not return a feed response."}
            </p>
            <Button className="mt-5" onClick={onRefresh} type="button">
              <RefreshCcw className="h-4 w-4" />
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const { canReply, disabledReplyReason } = getHomeMessageCapabilities(
    selectedItem,
    availableChannelIds,
  );
  const detailMode = isDrafts || selectedDraftItem ? "drafts" : "messages";
  const {
    auxiliaryPaneWidthPx,
    effectiveInboxListWidthPx,
    isSinglePanelDetailView,
    isSinglePanelDraftDetailView,
    showDetailPane,
    showListPane,
  } = getHomePaneLayout({
    hasAuxiliaryPane,
    homeWidthPx: homeInboxWidthPx,
    inboxListWidthPx,
    isDrafts: detailMode === "drafts",
    isMessagesMode: detailMode === "messages",
    isNarrow: isNarrowHomeViewport,
    isSinglePanelAuxiliaryView,
    selectedDraft: selectedDraftItem !== null,
    selectedEvent: selectedEventId !== null,
    threadPanelWidthPx,
  });

  return (
    <ProfilePanelProvider onOpenProfilePanel={handleOpenProfilePanel}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          className={cn(
            "relative grid min-h-0 w-full flex-1",
            isSinglePanelAuxiliaryView
              ? "grid-cols-1"
              : showListPane && showDetailPane && hasAuxiliaryPane
                ? "grid-cols-[var(--home-inbox-list-width)_minmax(0,1fr)_var(--home-auxiliary-width)]"
                : showListPane && showDetailPane
                  ? "grid-cols-[var(--home-inbox-list-width)_minmax(0,1fr)]"
                  : hasAuxiliaryPane
                    ? "grid-cols-[minmax(0,1fr)_var(--home-auxiliary-width)]"
                    : "grid-cols-1",
          )}
          data-testid="home-inbox"
          ref={homeInboxRef}
          style={
            {
              "--home-auxiliary-width": `${auxiliaryPaneWidthPx}px`,
              "--home-inbox-list-width": `${effectiveInboxListWidthPx}px`,
            } as React.CSSProperties
          }
        >
          {showListPane || showDetailPane ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 z-30 h-13 bg-background/80 backdrop-blur-md supports-backdrop-filter:bg-background/70 dark:bg-background/70 dark:backdrop-blur-xl dark:supports-backdrop-filter:bg-background/55"
              data-testid="home-inbox-shared-header-backdrop"
            />
          ) : null}

          {showListPane ? (
            <InboxListPane
              activeDraftCount={activeDraftCount}
              draftItems={draftItems}
              doneSet={effectiveDoneSet}
              filter={filter}
              items={filteredItems}
              onDeleteDraft={handleDeleteDraft}
              onFilterChange={handleFilterChange}
              onMarkRead={markItemRead}
              onMarkUnread={markItemUnread}
              onOpenDirect={handleOpenItem}
              onSelect={(itemId) => {
                const item = findInboxItemByEventId(inboxItems, itemId);
                setUnreadBoundary(
                  item && !effectiveDoneSet.has(item.id)
                    ? {
                        conversationId: item.conversationId,
                        eventId: item.id,
                      }
                    : null,
                );
                setSelectedDraftKey(null);
                handleUserSelectItem(itemId);
                markItemRead(itemId);
              }}
              onSelectDraft={(draftKey) => {
                setUnreadBoundary(null);
                handleUserSelectItem(null);
                setSelectedDraftKey(draftKey);
              }}
              onUnreadOnlyChange={setUnreadOnly}
              selectedConversationId={selectedConversationId}
              selectedDraftKey={selectedDraftKey}
              showRightDivider={showListPane && showDetailPane}
              unreadOnly={unreadOnly}
            />
          ) : null}

          <button
            aria-label="Resize inbox list"
            className={cn(
              "group absolute bottom-0 z-40 w-3 -translate-x-1/2 cursor-col-resize",
              topChromeInset.top,
              showListPane && showDetailPane ? "block" : "hidden",
            )}
            data-testid="home-inbox-list-resize-handle"
            onDoubleClick={
              canResetInboxListWidth ? handleInboxListWidthReset : undefined
            }
            onPointerDown={handleInboxListResizeStart}
            style={{ left: `${effectiveInboxListWidthPx}px` }}
            title={
              canResetInboxListWidth
                ? "Drag to resize. Double-click to reset width."
                : "Drag to resize."
            }
            type="button"
          >
            <span className="absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-border/80 group-focus-visible:bg-border/80" />
          </button>

          {showDetailPane && detailMode === "messages" ? (
            <InboxDetailPane
              canReply={canReply}
              contextChannelName={selectedChannel?.name ?? null}
              disabledReplyReason={disabledReplyReason}
              isSendingReply={isSendingReply}
              isSinglePanelView={isSinglePanelDetailView}
              hasThreadContextLoadError={threadContext.hasLoadError}
              isThreadContextLoading={threadContext.isLoading}
              item={selectedItem}
              latchedDefaultParentId={latchedDefaultParentId}
              messages={contextMessages}
              profiles={feedProfiles}
              selectedEventId={selectedEventId}
              unreadBoundaryEventId={unreadBoundaryEventId}
              onBack={
                isSinglePanelDetailView
                  ? () => {
                      handleUserSelectItem(null);
                    }
                  : undefined
              }
              onOpenContext={onOpenContext}
              onSendReply={async ({
                content,
                mediaTags,
                mentionPubkeys,
                parentEventId,
              }) => {
                const channelId = selectedItem?.item.channelId;
                if (!selectedItem || !channelId || !canReply) {
                  throw new Error("Replies are not available for this item.");
                }

                const itemToReply = selectedItem;
                setIsSendingReply(true);
                try {
                  const {
                    mediaTags: imetaTags,
                    emojiTags,
                    mentionTags,
                  } = splitOutgoingTags(mediaTags);
                  const result = await sendChannelMessage(
                    channelId,
                    content,
                    parentEventId,
                    imetaTags,
                    mentionPubkeys,
                    emojiTags,
                    mentionTags,
                  );
                  const authorPubkey = currentPubkey ?? itemToReply.item.pubkey;
                  const reply: InboxReply = {
                    authorLabel: currentPubkey
                      ? resolveUserLabel({
                          currentPubkey,
                          profiles: feedProfiles,
                          pubkey: authorPubkey,
                        })
                      : "You",
                    authorPubkey,
                    avatarUrl:
                      currentPubkey && feedProfiles
                        ? (feedProfiles[currentPubkey.trim().toLowerCase()]
                            ?.avatarUrl ?? null)
                        : null,
                    content,
                    createdAt: result.createdAt,
                    depth: result.depth,
                    fullTimestampLabel: formatInboxFullTimestamp(
                      result.createdAt,
                    ),
                    id: result.eventId,
                    parentId: result.parentEventId,
                    rootId: result.rootEventId,
                    tags: [...imetaTags, ...emojiTags, ...mentionTags],
                    timeLabel: formatTime(result.createdAt),
                  };
                  setLocalRepliesByItemId((current) => ({
                    ...current,
                    [itemToReply.conversationId]: [
                      ...(current[itemToReply.conversationId] ?? []),
                      reply,
                    ],
                  }));
                  onRefresh();
                } finally {
                  setIsSendingReply(false);
                }
              }}
              replies={selectedItemReplies}
            />
          ) : null}
          {showDetailPane && detailMode === "drafts" ? (
            <DraftDetailPane
              item={selectedDraftItem}
              key={selectedDraftItem?.entry.key ?? "empty"}
              onBack={
                isSinglePanelDraftDetailView
                  ? () => setSelectedDraftKey(null)
                  : undefined
              }
              onDelete={handleDeleteDraft}
            />
          ) : null}
          {profilePanelPubkey ? (
            <RightAuxiliaryPane
              canResetWidth={canResetThreadPanelWidth}
              constrainToAvailableSpace={false}
              onResetWidth={handleThreadPanelWidthReset}
              onResizeStart={handleThreadPanelResizeStart}
              testId="home-user-profile-panel"
              widthPx={auxiliaryPaneWidthPx}
            >
              <UserProfilePanel
                isSinglePanelView={isSinglePanelAuxiliaryView}
                layout="split"
                onClose={handleCloseProfilePanel}
                pubkey={profilePanelPubkey}
                splitPaneClamp
                transparentChrome
                widthPx={auxiliaryPaneWidthPx}
              />
            </RightAuxiliaryPane>
          ) : null}
        </div>
      </div>
    </ProfilePanelProvider>
  );
}
