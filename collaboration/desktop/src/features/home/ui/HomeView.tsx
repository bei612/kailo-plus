import { InboxLayout } from "@client-kit/platform/react/inbox-surface";
import * as React from "react";
import { RefreshCcw } from "lucide-react";

import { inboxReply } from "@client-kit/platform/inbox";
import { useT } from "@client-kit/platform/react/context";
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
import {
  inboxReadContexts,
  useInboxState,
} from "@client-kit/platform/react/use-inbox-state";
import { useNativeSession } from "@/features/platform/activeCommunity";
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
import { useChannelMessagesQuery, useToggleReactionMutation } from "@/features/messages/hooks";
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
  const t = useT();
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
  const coreReads = useInboxState(useNativeSession().client);
  const admittedChannelIds = React.useMemo(
    () =>
      new Set(
        [...availableChannelIds].filter((id) =>
          coreReads.visibleChannels.has(id),
        ),
      ),
    [availableChannelIds, coreReads.visibleChannels],
  );
  const admittedFeed = React.useMemo(
    () =>
      feed && coreReads.state
        ? {
            mentions: feed.mentions.filter(
              (item) =>
                item.channelId && coreReads.visibleChannels.has(item.channelId),
            ),
            activity: feed.activity.filter(
              (item) =>
                item.channelId && coreReads.visibleChannels.has(item.channelId),
            ),
          }
        : undefined,
    [feed, coreReads.state, coreReads.visibleChannels],
  );
  const getMessageReadAt = React.useCallback(
    (id: string) => coreReads.readAt(`msg:${id}`),
    [coreReads.readAt],
  );
  const getThreadReadAt = React.useCallback(
    (id: string) => coreReads.readAt(`thread:${id}`),
    [coreReads.readAt],
  );
  const readStateVersion = coreReads.state?.version ?? -1;
  const {
    feedItems,
    activeLatchedItem: latchedItem,
    coldResolutionPending,
  } = useInboxSelectionAnchor({
    feed: admittedFeed,
    selectedEventId,
    availableChannelIds: admittedChannelIds,
  });
  // Native's same-anchor latch is useful for paging, but it is not an access
  // grant. Revalidate it synchronously before deriving context/detail queries.
  const activeLatchedItem =
    latchedItem?.channelId && admittedChannelIds.has(latchedItem.channelId)
      ? latchedItem
      : null;

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
  const toggleReaction = useToggleReactionMutation(selectedChannel, currentPubkey);
  const onToggleReaction = React.useCallback(async (message: { id: string }, emoji: string, remove: boolean) => {
    await toggleReaction.mutateAsync({ eventId: message.id, emoji, remove });
  }, [toggleReaction.mutateAsync]);
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
        feed: admittedFeed,
        getMessageReadAt,
        getThreadReadAt,
        profiles: feedProfiles,
      }),
    [
      channels,
      currentPubkey,
      admittedFeed,
      feedProfiles,
      getMessageReadAt,
      getThreadReadAt,
      readStateVersion,
      coreReads.state,
      coreReads.visibleChannels,
    ],
  );
  const effectiveDoneSet = React.useMemo(
    () =>
      new Set(
        inboxItems
          .filter((row) =>
            row.groupItems.every(
              (event) =>
                event.createdAt <=
                (coreReads.readAt(
                  inboxReply(event.tags)
                    ? `msg:${event.id}`
                    : (event.channelId ?? ""),
                ) ?? 0),
            ),
          )
          .map((row) => row.id),
      ),
    [inboxItems, coreReads.readAt],
  );
  const markInbox = (id: string, read: boolean) => {
    const row = inboxItems.find((item) => item.id === id);
    if (row) coreReads.write(inboxReadContexts(row.groupItems, read));
  };
  const markItemRead = (id: string) => markInbox(id, true);
  const markItemUnread = (id: string) => markInbox(id, false);
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

  if ((isLoading && !feed) || (!coreReads.state && !coreReads.failed)) {
    return <HomeLoadingState />;
  }

  if (!feed || !coreReads.state || coreReads.unknown) {
    return (
      <div className="flex-1 overflow-hidden px-4 pb-3 pt-4 sm:px-6">
        <div className="flex w-full max-w-3xl flex-col gap-4">
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-5">
            <p className="text-base font-semibold tracking-tight">
              Home feed unavailable
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {coreReads.failed || coreReads.unknown
                ? t(
                    coreReads.unknown
                      ? "inbox.readUnknown"
                      : "inbox.readUnavailable",
                  )
                : (errorMessage ?? "The relay did not return a feed response.")}
            </p>
            <Button
              className="mt-5"
              onClick={() => {
                onRefresh();
                void coreReads.refresh();
              }}
              type="button"
            >
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
    admittedChannelIds,
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
        <InboxLayout containerRef={homeInboxRef} listWidth={effectiveInboxListWidthPx}
          auxiliaryWidth={auxiliaryPaneWidthPx} showList={showListPane} showDetail={showDetailPane}
          hasAuxiliary={hasAuxiliaryPane} singleAuxiliary={isSinglePanelAuxiliaryView}
          onResize={handleInboxListResizeStart} onReset={canResetInboxListWidth ? handleInboxListWidthReset : undefined}>
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


          {showDetailPane && detailMode === "messages" ? (
            <InboxDetailPane
              canReply={canReply}
              currentPubkey={currentPubkey}
              onToggleReaction={canReply && !threadContext.hasLoadError && !threadContext.isLoading && selectedChannel?.isMember && selectedChannel.archivedAt === null ? onToggleReaction : undefined}
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
        </InboxLayout>
      </div>
    </ProfilePanelProvider>
  );
}
