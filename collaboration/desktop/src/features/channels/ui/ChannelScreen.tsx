import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppShell } from "@/app/AppShellContext";
import { useChannelPaneHandlers } from "@/features/channels/useChannelPaneHandlers";
import { useEphemeralChannelDisplay } from "@/features/channels/useEphemeralChannelDisplay";
import { useMessageEventProfilePubkeys } from "@/features/channels/useMessageEventProfilePubkeys";
import { useThreadTargetSync } from "@/features/channels/useThreadTargetSync";
import { useChannelMembersQuery } from "@/features/channels/hooks";
import {
  MSG_PREFIX,
  THREAD_PREFIX,
} from "@/features/channels/readState/readStateFormat";
import { ChannelScreenEmptyState } from "@/features/channels/ui/ChannelScreenEmptyState";
import { ChannelScreenHeader } from "@/features/channels/ui/ChannelScreenHeader";
import {
  mergeMessages,
  useChannelMessagesQuery,
  useChannelSubscription,
  useChannelWindowQuery,
  useSendMessageMutation,
} from "@/features/messages/hooks";
import { channelWindowThreadSummaries } from "@/features/messages/lib/channelWindowStore";
import { formatTimelineMessages } from "@/features/messages/lib/formatTimelineMessages";
import { getThreadReference } from "@/features/messages/lib/threading";
import { hasPersistedHydratedChannel } from "@/features/messages/lib/channelHeadCache";
import { resolveTimelineQueryLoadingState } from "@/features/messages/lib/timelineLoadingState";
import { useFetchOlderMessages } from "@/features/messages/useFetchOlderMessages";
import { useIndependentThreadPanel } from "@/features/messages/useIndependentThreadPanel";
import { useThreadReplies } from "@/features/messages/useThreadReplies";
import type { TimelineMessage } from "@/features/messages/types";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { useRelaySelfQuery } from "@/shared/api/relaySelf";
import { ProfilePanelProvider } from "@/shared/context/ProfilePanelContext";
import { useMainInsetRef } from "@/shared/layout/MainInsetContext";
import { channelContentTopPaddingMeasurement } from "@/shared/layout/chromeLayout";
import { useMeasuredCssVariable } from "@/shared/layout/useMeasuredCssVariable";
import { useElementWidth } from "@/shared/hooks/use-mobile";
import { useThreadPanelWidth } from "@/shared/hooks/useThreadPanelWidth";
import { AUXILIARY_PANEL_SINGLE_COLUMN_BREAKPOINT_PX } from "@/shared/layout/AuxiliaryPanel";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";
import { useMessageProfiles } from "./useMessageProfiles";
import { useChannelPanelHistoryState } from "./useChannelPanelHistoryState";
import { useChannelProfilePanel } from "./useChannelProfilePanel";
import { useChannelTargetReset } from "./useChannelTargetReset";
import { useChannelRouteTarget } from "./useChannelRouteTarget";
import { useChannelOpenReadState } from "./useChannelOpenReadState";
import { useChannelUnreadState } from "./useChannelUnreadState";
import type { ChannelScreenProps } from "./ChannelScreen.types";
import { ChannelPane } from "./ChannelScreenLazyViews";
import { useChannelMessageEdit } from "@client-kit/platform/react/thread";
import { useActiveCommunity } from "@/features/platform/activeCommunity";
import { useChannelTyping } from "@/features/messages/useChannelTyping";

export function ChannelScreen({
  activeChannel,
  autoSendDraftKey,
  currentIdentity,
  currentProfile,
  targetMessageEvents,
  targetMessageId,
  targetSearchMessageId,
  targetSearchQuery,
}: ChannelScreenProps) {
  const queryClient = useQueryClient();
  const {
    clearChannelUnreadSource,
    markChannelUnread,
    getChannelReadAt,
    getMessageReadAt,
    markMessageRead,
    markMessagesUnread,
    coreReads,
    setContextParentResolver,
    followThread,
    unfollowThread,
    isFollowingThread,
    isNotifiedForThread,
    isThreadMuted,
    readStateVersion,
  } = useAppShell();
  const {
    clearAutoSend,
    clearMessageRouteTarget,
    openProfilePanel,
    openThreadHeadId,
    profilePanelPubkey,
    setOpenThreadHeadId,
    setProfilePanelPubkey,
  } = useChannelPanelHistoryState();
  const [channelContentRef, channelContentWidthPx] =
    useElementWidth<HTMLDivElement>();
  const {
    canReset: canResetThreadPanelWidth,
    onResetWidth: handleThreadPanelWidthReset,
    onResizeStart: handleThreadPanelResizeStart,
    widthPx: threadPanelWidthPx,
  } = useThreadPanelWidth(channelContentWidthPx || undefined);
  const [expandedThreadReplyIds, setExpandedThreadReplyIds] = React.useState(
    () => new Set<string>(),
  );
  const [threadScrollTargetId, setThreadScrollTargetId] = React.useState<
    string | null
  >(null);
  const [threadReplyTargetId, setThreadReplyTargetId] = React.useState<
    string | null
  >(null);
  const [optimisticOpenThreadHeadId, setOptimisticOpenThreadHeadId] =
    React.useState<string | null | undefined>(undefined);
  const clearOptimisticThreadOverride = React.useCallback(() => {
    setOptimisticOpenThreadHeadId(undefined);
  }, []);
  const mainInsetRef = useMainInsetRef();
  const currentPubkey = currentIdentity?.pubkey;
  const activeChannelId = activeChannel?.id ?? null;
  const community = useActiveCommunity();
  const {
    editTarget,
    setEditTarget,
    handleEdit,
    handleCancelEdit,
    requireThreadEditResolution,
  } = useChannelMessageEdit<TimelineMessage>(
    JSON.stringify([activeChannelId, community.relayUrl, currentPubkey]),
  );
  const relaySelfPubkey = useRelaySelfQuery(activeChannel !== null).data;
  const effectiveOpenThreadHeadId =
    optimisticOpenThreadHeadId === undefined
      ? openThreadHeadId
      : optimisticOpenThreadHeadId;
  const isNotifiedForEffectiveThread =
    effectiveOpenThreadHeadId != null
      ? isNotifiedForThread(effectiveOpenThreadHeadId)
      : false;
  const previousActiveChannelIdRef = React.useRef(activeChannelId);
  React.useEffect(() => {
    const didChangeChannel =
      previousActiveChannelIdRef.current !== activeChannelId;
    previousActiveChannelIdRef.current = activeChannelId;
    setOptimisticOpenThreadHeadId((current) => {
      if (current === undefined) {
        return current;
      }
      return didChangeChannel || openThreadHeadId === current
        ? undefined
        : current;
    });
  }, [activeChannelId, openThreadHeadId]);
  const messagesQuery = useChannelMessagesQuery(activeChannel);
  const windowQuery = useChannelWindowQuery(activeChannel);
  const threadRepliesQuery = useThreadReplies(
    activeChannel,
    effectiveOpenThreadHeadId,
    threadScrollTargetId,
  );
  const {typingEntries, receiveMessage} = useChannelTyping(activeChannel, currentPubkey, relaySelfPubkey);
  useChannelSubscription(activeChannel, receiveMessage);
  const { fetchOlder, hasOlderMessages, historyExhausted, isFetchingOlder } =
    useFetchOlderMessages(activeChannel);
  const latestActiveMessage = React.useMemo(() => {
    const messages = messagesQuery.data;
    if (!messages) return null;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (getThreadReference(messages[index].tags).parentId === null)
        return messages[index];
    }
    return null;
  }, [messagesQuery.data]);
  const activeReadAt = latestActiveMessage
    ? new Date(latestActiveMessage.created_at * 1_000).toISOString()
    : null;
  useChannelOpenReadState(
    activeChannelId,
    activeChannel?.isMember,
    activeReadAt,
    activeChannel?.channelType === "dm",
    activeChannel?.channelType !== "dm" || Boolean(coreReads?.state && !coreReads.failed && !coreReads.unknown),
  );
  React.useEffect(() => {
    if (!activeChannelId) {
      setContextParentResolver(null);
      return;
    }
    setContextParentResolver((contextId) =>
      contextId.startsWith(THREAD_PREFIX) || contextId.startsWith(MSG_PREFIX)
        ? activeChannelId
        : null,
    );
    return () => setContextParentResolver(null);
  }, [activeChannelId, setContextParentResolver]);
  const activeChannelEphemeralDisplay =
    useEphemeralChannelDisplay(activeChannel);
  const sendMessageMutation = useSendMessageMutation(
    activeChannel,
    currentIdentity,
  );
  const channelMessages = messagesQuery.data;
  const resolvedMessages = React.useMemo(() => {
    const messages = channelMessages ?? [];
    if (!activeChannel || targetMessageEvents.length === 0) return messages;
    return targetMessageEvents.reduce(mergeMessages, messages);
  }, [activeChannel, channelMessages, targetMessageEvents]);
  const windowStore = windowQuery.data;
  const threadSummaries = React.useMemo(
    () => (windowStore ? channelWindowThreadSummaries(windowStore) : new Map()),
    [windowStore],
  );
  const threadReplyEvents = threadRepliesQuery.data;
  const resolvedThreadReplyEvents = React.useMemo(
    () => threadReplyEvents ?? [],
    [threadReplyEvents],
  );
  const messageProfilePubkeys = useMessageEventProfilePubkeys(
    resolvedMessages,
    resolvedThreadReplyEvents,
    relaySelfPubkey,
  );
  const channelMembersQuery = useChannelMembersQuery(activeChannel?.id ?? null);
  const channelMembers = channelMembersQuery.data;
  const messageProfilesQuery = useUsersBatchQuery(messageProfilePubkeys, {
    enabled: messageProfilePubkeys.length > 0,
  });
  const messageProfiles = useMessageProfiles({
    currentProfile,
    profiles: messageProfilesQuery.data?.profiles,
  });
  const timelineMessages = React.useMemo(
    () =>
      formatTimelineMessages(
        resolvedMessages,
        currentPubkey,
        currentProfile?.avatarUrl ?? null,
        messageProfiles,
        channelMembers,
        relaySelfPubkey,
      ),
    [
      channelMembers,
      currentProfile?.avatarUrl,
      currentPubkey,
      messageProfiles,
      relaySelfPubkey,
      resolvedMessages,
    ],
  );
  const threadPanelData = useIndependentThreadPanel({
    channelEvents: resolvedMessages,
    threadReplyEvents: resolvedThreadReplyEvents,
    rootId: effectiveOpenThreadHeadId,
    replyTargetId: threadReplyTargetId,
    expandedReplyIds: expandedThreadReplyIds,
    currentPubkey,
    currentAvatarUrl: currentProfile?.avatarUrl ?? null,
    profiles: messageProfiles,
    members: channelMembers,
    relaySelfPubkey,
  });
  const {
    firstUnreadMessageId,
    getFirstReplyIdForMessage,
    getReplyDescendantIdsForMessage,
    handleMarkMessageRead,
    handleMarkMessageUnread,
    isMessageUnread,
    markRevealedRepliesRead,
    openThreadHeadMessage,
    threadFirstUnreadReplyId,
    threadReplyTargetMessage,
    threadReplyUnreadCounts,
    threadUnreadCounts,
    unreadCount,
  } = useChannelUnreadState({
    activeChannelId,
    timelineMessages,
    currentPubkey,
    openThreadHeadId: effectiveOpenThreadHeadId,
    threadReplyTargetId,
    expandedThreadReplyIds,
    openThreadMessages: threadPanelData.visibleReplies,
    clearChannelUnreadSource,
    getChannelReadAt,
    getMessageReadAt,
    markChannelUnread,
    markMessageRead,
    markMessagesUnread,
    isReadStateReady: activeChannel?.channelType !== "dm" || Boolean(coreReads?.state && !coreReads.failed && !coreReads.unknown),
    isThreadMuted,
    readStateVersion,
  });
  const {
    handleCancelThreadReply,
    handleCloseThread,
    handleExpandThreadReplies,
    handleOpenThread,
    handleSendMessage,
    handleSendToChannel,
    handleSendThreadReply,
    handleSelectThreadReplyTarget,
  } = useChannelPaneHandlers({
    handleCancelEdit,
    requireThreadEditResolution,
    expandedThreadReplyIds,
    getFirstReplyIdForMessage,
    getReplyDescendantIdsForMessage,
    markRevealedRepliesRead,
    openThreadHeadId: effectiveOpenThreadHeadId,
    onOptimisticOpenThreadHeadIdChange: setOptimisticOpenThreadHeadId,
    sendMessageMutation,
    setExpandedThreadReplyIds,
    setOpenThreadHeadId,
    setThreadReplyTargetId,
    setThreadScrollTargetId,
    threadReplyTargetId,
  });
  const handleMessageMarkUnread = React.useCallback(
    (message: TimelineMessage) => handleMarkMessageUnread(message.id),
    [handleMarkMessageUnread],
  );
  const handleMessageMarkRead = React.useCallback(
    (message: TimelineMessage) => handleMarkMessageRead(message.id),
    [handleMarkMessageRead],
  );
  const sendMessageMutateAsync = sendMessageMutation.mutateAsync;
  const handleSendVideoReviewComment = React.useCallback(
    async (
      message: { id: string },
      content: string,
      mentionPubkeys: string[],
      mediaTags?: string[][],
      parentEventId?: string,
    ) => {
      await sendMessageMutateAsync({
        content,
        mediaTags,
        mentionPubkeys,
        parentEventId: parentEventId ?? message.id,
      });
    },
    [sendMessageMutateAsync],
  );
  const effectiveSendVideoReviewComment =
    activeChannel && !activeChannel.archivedAt && activeChannel.isMember
      ? handleSendVideoReviewComment
      : undefined;
  const { handleOpenProfilePanel, handleCloseProfilePanel } =
    useChannelProfilePanel({
      requireThreadEditResolution,
      openProfilePanel,
      setExpandedThreadReplyIds,
      setOpenThreadHeadId,
      setProfilePanelPubkey,
      setThreadReplyTargetId,
      setThreadScrollTargetId,
    });
  const settledChannelIdRef = React.useRef<string | null>(null);
  const { settledChannelId, isLoading: isTimelineLoading } =
    resolveTimelineQueryLoadingState(
      settledChannelIdRef.current,
      activeChannelId,
      {
        isEnabled: activeChannel !== null,
        isPending: messagesQuery.isPending,
        isFetching: messagesQuery.isFetching,
        isPlaceholderData: messagesQuery.isPlaceholderData,
        dataLength: messagesQuery.data?.length ?? null,
        isError: messagesQuery.isError,
      },
      activeChannelId !== null &&
        hasPersistedHydratedChannel(queryClient, activeChannelId),
    );
  settledChannelIdRef.current = settledChannelId;
  useChannelTargetReset({
    activeChannelId,
    setExpandedThreadReplyIds,
    setThreadReplyTargetId,
    setThreadScrollTargetId,
  });
  const mainTimelineTargetMessageId = useChannelRouteTarget({
    activeChannel,
    activeChannelId,
    clearEditTarget: handleCancelEdit,
    requireThreadEditResolution,
    setExpandedThreadReplyIds,
    setOpenThreadHeadId,
    setProfilePanelPubkey,
    setThreadReplyTargetId,
    setThreadScrollTargetId,
    targetMessageId,
    timelineMessages,
  });
  useThreadTargetSync({
    clearOptimisticThreadOverride,
    editTarget,
    editTargetMessage: editTarget
      ? (timelineMessages.find((message) => message.id === editTarget.id) ??
        threadPanelData.messages.find((message) => message.id === editTarget.id) ??
        null)
      : null,
    clearEditTarget: handleCancelEdit,
    isTimelineLoading:
      isTimelineLoading ||
      (effectiveOpenThreadHeadId !== null && threadRepliesQuery.isPending),
    openThreadHeadId,
    openThreadHeadMessage,
    setExpandedThreadReplyIds,
    setOpenThreadHeadId,
    setThreadReplyTargetId,
    setThreadScrollTargetId,
    threadReplyTargetId,
    threadReplyTargetMessage,
  });
  const hasAuxiliaryPanel = Boolean(
    effectiveOpenThreadHeadId || profilePanelPubkey,
  );
  const displayedThreadHeadMessage = threadPanelData.threadHead;
  const displayedThreadFirstUnreadReplyId = displayedThreadHeadMessage
    ? threadFirstUnreadReplyId
    : null;
  const shouldShowThreadSkeleton = Boolean(
    effectiveOpenThreadHeadId && activeChannel && !displayedThreadHeadMessage,
  );
  const isSinglePanelView =
    channelContentWidthPx > 0 &&
    channelContentWidthPx < AUXILIARY_PANEL_SINGLE_COLUMN_BREAKPOINT_PX &&
    hasAuxiliaryPanel;
  const channelHeaderChromeRef = useMeasuredCssVariable({
    targetRef: mainInsetRef,
    ...channelContentTopPaddingMeasurement,
    resetKey: activeChannelId,
    enabled: !isSinglePanelView,
  });
  const channelHeader =
    activeChannel && !isSinglePanelView ? (
      <ChannelScreenHeader
        activeChannel={activeChannel}
        activeChannelEphemeralDisplay={activeChannelEphemeralDisplay}
        currentPubkey={currentPubkey}
        chromeWrapperRef={channelHeaderChromeRef}
      />
    ) : null;
  return (
    <ProfilePanelProvider onOpenProfilePanel={handleOpenProfilePanel}>
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        ref={channelContentRef}
      >
        {activeChannel ? (
          <React.Suspense
            fallback={<ViewLoadingFallback includeHeader kind="channel" />}
          >
            <ChannelPane
              activeChannel={activeChannel}
              autoSendDraftKey={autoSendDraftKey}
              onAutoSendComplete={clearAutoSend}
              currentPubkey={currentPubkey}
              typingEntries={typingEntries}
              editTarget={editTarget}
              onEdit={(message) => {
                if (handleEdit(message)) setThreadReplyTargetId(effectiveOpenThreadHeadId);
              }}
              onCancelEdit={handleCancelEdit}
              onEditConfirmed={(message) =>
                setEditTarget((current) =>
                  current?.id === message.id ? null : current,
                )
              }
              canResetThreadPanelWidth={canResetThreadPanelWidth}
              fetchOlder={fetchOlder}
              header={channelHeader}
              hasOlderMessages={hasOlderMessages}
              historyExhausted={historyExhausted}
              followThreadById={followThread}
              unfollowThreadById={unfollowThread}
              isFollowingThreadById={isFollowingThread}
              isMessageUnreadById={isMessageUnread}
              isFollowingThread={isNotifiedForEffectiveThread}
              isFetchingOlder={isFetchingOlder}
              isSending={sendMessageMutation.isPending}
              isSinglePanelView={isSinglePanelView}
              isTimelineError={messagesQuery.isError}
              isTimelineLoading={isTimelineLoading}
              onRetryTimeline={() => void messagesQuery.refetch()}
              messages={timelineMessages}
              threadSummaries={threadSummaries}
              onCancelThreadReply={handleCancelThreadReply}
              onFollowThread={
                effectiveOpenThreadHeadId != null &&
                !isNotifiedForEffectiveThread
                  ? () => followThread(effectiveOpenThreadHeadId)
                  : undefined
              }
              onUnfollowThread={
                effectiveOpenThreadHeadId != null &&
                isNotifiedForEffectiveThread
                  ? () => unfollowThread(effectiveOpenThreadHeadId)
                  : undefined
              }
              onCloseThread={handleCloseThread}
              onMarkUnread={handleMessageMarkUnread}
              onMarkRead={handleMessageMarkRead}
              onExpandThreadReplies={handleExpandThreadReplies}
              onResetThreadPanelWidth={handleThreadPanelWidthReset}
              onCloseProfilePanel={handleCloseProfilePanel}
              onOpenThread={handleOpenThread}
              onSelectThreadReplyTarget={handleSelectThreadReplyTarget}
              onSendMessage={handleSendMessage}
              onSendToChannel={handleSendToChannel}
              onSendVideoReviewComment={effectiveSendVideoReviewComment}
              onSendThreadReply={handleSendThreadReply}
              onThreadScrollTargetResolved={() => setThreadScrollTargetId(null)}
              onThreadPanelResizeStart={handleThreadPanelResizeStart}
              onTargetReached={() => clearMessageRouteTarget({ replace: true })}
              openThreadHeadId={effectiveOpenThreadHeadId}
              shouldShowThreadSkeleton={shouldShowThreadSkeleton}
              profilePanelPubkey={profilePanelPubkey}
              profiles={messageProfiles}
              firstUnreadMessageId={firstUnreadMessageId}
              unreadCount={unreadCount}
              targetMessageId={mainTimelineTargetMessageId}
              targetSearchMessageId={targetSearchMessageId}
              targetSearchQuery={targetSearchQuery}
              threadAllMessages={threadPanelData.messages}
              threadHeadMessage={displayedThreadHeadMessage}
              threadMessages={threadPanelData.visibleReplies}
              threadMessagesPending={threadRepliesQuery.isPending}
              threadMessagesError={threadRepliesQuery.isError}
              onRetryThreadReplies={() => {
                void threadRepliesQuery.refetch();
              }}
              threadPanelWidthPx={threadPanelWidthPx}
              threadReplyTargetMessage={threadPanelData.replyTargetMessage}
              threadScrollTargetId={threadScrollTargetId}
              threadUnreadCounts={threadUnreadCounts}
              threadReplyUnreadCounts={threadReplyUnreadCounts}
              threadFirstUnreadReplyId={displayedThreadFirstUnreadReplyId}
            />
          </React.Suspense>
        ) : (
          <ChannelScreenEmptyState />
        )}
      </div>
    </ProfilePanelProvider>
  );
}
