import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useActiveCommunity } from "@/features/platform/activeCommunity";
import { editMessage } from "@/shared/api/tauriMessages";
import { useToggleReactionMutation } from "@/features/messages/hooks";
import { channelMessagesKey } from "@/features/messages/lib/messageQueryKeys";
import type { TimelineMessage } from "@/features/messages/types";
import { AnimatePresence } from "motion/react";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useMediaUpload } from "@/features/messages/lib/useMediaUpload";
import { ComposerDockBackdrop } from "@/features/messages/ui/ComposerDockBackdrop";
import { ComposerUploadProgressOverlay } from "@/features/messages/ui/ComposerUploadProgressOverlay";
import { MessageComposer } from "@/features/messages/ui/MessageComposer";
import { DropZoneOverlay } from "@/features/messages/ui/ComposerAttachments";
import { MessageThreadPanel } from "@/features/messages/ui/MessageThreadPanel";
import { MessageThreadPanelSkeleton } from "@/features/messages/ui/MessageThreadPanelSkeleton";
import {
  MessageTimeline,
  type MessageTimelineHandle,
} from "@/features/messages/ui/MessageTimeline";
import { buildVideoReviewPresentationByMessageId } from "@/features/messages/lib/videoReviewContext";
import { useComposerHeightPadding } from "@/features/messages/ui/useComposerHeightPadding";
import { UserProfilePanel } from "@/features/profile/ui/UserProfilePanel";
import { RightAuxiliaryPane } from "@/features/channels/ui/RightAuxiliaryPane";
import { ThreadPanelSurface } from "@/features/channels/ui/ThreadPanelSurface";
import { ThreadViewModeToggle } from "@/features/channels/ui/ThreadViewModeToggle";
import { THREAD_SURFACE_KEY } from "@/features/channels/lib/threadFocusLayout";
import { getThreadPanelLayout } from "@/features/channels/lib/threadPanelLayout";
import { useThreadViewMode } from "@/features/channels/lib/threadViewModePreference";
import { useThreadViewModeSwitch } from "@/features/channels/ui/useThreadViewModeSwitch";
import { useFocusDrawerPresence } from "@/features/channels/ui/useFocusDrawerPresence";
import { useSearchHighlightProps } from "@/features/channels/ui/useSearchHighlightProps";
import { useChannelIntro } from "@/features/channels/ui/useChannelIntro";
import type { ChannelPaneProps } from "@/features/channels/ui/ChannelPane.types";
import { useChannelPaneMessages } from "@/features/channels/ui/useChannelPaneMessages";
import { useIsThreadPanelOverlay } from "@/shared/hooks/use-mobile";
import { channelChrome } from "@/shared/layout/chromeLayout";
import { cn } from "@/shared/lib/cn";
export const ChannelPane = React.memo(function ChannelPane({
  activeChannel,
  autoSendDraftKey = null,
  onAutoSendComplete,
  currentPubkey,
  fetchOlder,
  header,
  hasOlderMessages,
  historyExhausted,
  isFetchingOlder,
  followThreadById,
  isFollowingThread,
  isFollowingThreadById,
  isMessageUnreadById,
  isSinglePanelView = false,
  isSending,
  isTimelineError = false,
  isTimelineLoading,
  onRetryTimeline,
  messages,
  threadSummaries,
  firstUnreadMessageId = null,
  unreadCount = 0,
  canResetThreadPanelWidth,
  onCancelThreadReply,
  onCloseProfilePanel,
  onCloseThread,
  onFollowThread,
  onMarkUnread,
  onMarkRead,
  onExpandThreadReplies,
  onOpenThread,
  onResetThreadPanelWidth,
  onSelectThreadReplyTarget,
  onSendMessage,
  onSendToChannel,
  onSendVideoReviewComment,
  onSendThreadReply,
  onThreadScrollTargetResolved,
  onThreadPanelResizeStart,
  onTargetReached,
  onUnfollowThread,
  unfollowThreadById,
  profiles,
  openThreadHeadId,
  shouldShowThreadSkeleton,
  profilePanelPubkey,
  targetMessageId,
  targetSearchMessageId,
  targetSearchQuery,
  threadAllMessages,
  threadHeadMessage,
  threadMessages,
  threadMessagesPending = false,
  threadMessagesError = false,
  onRetryThreadReplies,
  threadPanelWidthPx,
  threadScrollTargetId,
  threadReplyTargetMessage,
  threadUnreadCounts,
  threadReplyUnreadCounts,
  threadFirstUnreadReplyId,
}: ChannelPaneProps) {
  const timelineScrollRef = React.useRef<HTMLDivElement>(null);
  const community = useActiveCommunity();
  const toggleReaction = useToggleReactionMutation(activeChannel, currentPubkey);
  const handleToggleReaction = React.useCallback((message: TimelineMessage, emoji: string, remove: boolean) =>
    toggleReaction.mutateAsync({eventId: message.id, emoji, remove}), [toggleReaction.mutateAsync]);
  const queryClient = useQueryClient();
  const [editTarget, setEditTarget] = React.useState<TimelineMessage | null>(null);
  const [editing, setEditing] = React.useState(false);
  const editOwner = React.useMemo(() => ({}), [activeChannel.id, community.relayUrl, currentPubkey]);
  const editOwnerRef = React.useRef(editOwner);
  editOwnerRef.current = editOwner;
  React.useEffect(() => {
    setEditTarget(null);
    setEditing(false);
  }, [editOwner]);
  const saveEdit = async (content: string, mentions: string[], media: string[][] = []) => {
    if (!editTarget || !currentPubkey || editing || editTarget.signerPubkey !== currentPubkey) {
      throw new Error("Edit identity or receipt is not available.");
    }
    const captured = editTarget;
    const requestedOwner = editOwner;
    setEditing(true);
    try {
      const receipt = await editMessage(activeChannel.id, captured.id, content,
        media.filter((tag) => tag[0] === "imeta"), mentions, community.relayUrl, currentPubkey);
      if (!receipt.id || receipt.kind !== 40003 || receipt.pubkey !== currentPubkey ||
          !receipt.tags.some((tag) => tag[0] === "e" && tag[1] === captured.id)) {
        throw new Error("relay publish outcome unknown");
      }
      // Refetch original Relay projection. A returned receipt is not a second
      // editable-message authority and does not replace the immutable row id.
      if (channelPaneMountedRef.current && editOwnerRef.current === requestedOwner) {
        void queryClient.invalidateQueries({queryKey: channelMessagesKey(activeChannel.id)});
        setEditTarget((current) => current === captured ? null : current);
      }
    } finally {
      if (channelPaneMountedRef.current && editOwnerRef.current === requestedOwner) {
        setEditing(false);
      }
    }
  };
  const messageTimelineRef = React.useRef<MessageTimelineHandle>(null);
  const composerWrapperRef = React.useRef<HTMLDivElement>(null);
  const { goChannel } = useAppNavigation();
  const mainComposerMedia = useMediaUpload({ deferUploadsUntilSend: true });
  const searchHighlightProps = useSearchHighlightProps(
    targetSearchMessageId,
    targetSearchQuery,
  );
  const [acceptsMainAttachments, setAcceptsMainAttachments] =
    React.useState(true);
  const activeChannelId = activeChannel.id;
  const activeChannelIdRef = React.useRef(activeChannelId);
  const channelPaneMountedRef = React.useRef(false);
  activeChannelIdRef.current = activeChannelId;
  React.useEffect(() => {
    channelPaneMountedRef.current = true;
    return () => {
      channelPaneMountedRef.current = false;
    };
  }, []);
  useComposerHeightPadding(
    timelineScrollRef,
    composerWrapperRef,
    `${activeChannelId}:${isSinglePanelView}`,
    "css-variable",
    () => messageTimelineRef.current?.settleAtBottom() ?? false,
  );
  const isComposerDisabled =
    !activeChannel.isMember || activeChannel.archivedAt !== null || isSending;
  const handleSendMessage = React.useCallback(
    async (
      content: string,
      mentionPubkeys: string[],
      mediaTags?: string[][],
      channelId?: string | null,
      threadContext?: {
        parentEventId: string | null;
        threadHeadId: string | null;
      } | null,
      forceRest?: boolean,
    ) => {
      messageTimelineRef.current?.scrollToBottomOnNextUpdate();
      await onSendMessage(
        content,
        mentionPubkeys,
        mediaTags,
        channelId,
        threadContext,
        forceRest,
      );
      if (
        channelId &&
        channelId !== activeChannelId &&
        channelPaneMountedRef.current &&
        activeChannelIdRef.current === activeChannelId
      ) {
        await goChannel(channelId, { replace: true });
      }
    },
    [activeChannelId, goChannel, onSendMessage],
  );
  const canDropInMainColumn =
    !isComposerDisabled && acceptsMainAttachments && !isSinglePanelView;
  const channelIntro = useChannelIntro(activeChannel);
  const { mainTimelineEntries } = useChannelPaneMessages({
    messages,
    profiles,
    threadSummaries,
  });
  const activeVideoReviewCommentSender = activeChannel.archivedAt
    ? undefined
    : onSendVideoReviewComment;
  const threadVideoReviewPresentation = React.useMemo(() => {
    const messagesById = new Map(
      messages.map((message) => [message.id, message]),
    );
    if (threadHeadMessage) {
      messagesById.set(threadHeadMessage.id, threadHeadMessage);
    }
    for (const message of threadAllMessages) {
      messagesById.set(message.id, message);
    }
    return buildVideoReviewPresentationByMessageId({
      channelId: activeChannel.id,
      channelName: activeChannel.name,
      isSendingVideoReviewComment: isSending,
      messages: [...messagesById.values()],
      onSendVideoReviewComment: activeVideoReviewCommentSender,
      profiles,
    });
  }, [
    activeChannel,
    activeVideoReviewCommentSender,
    isSending,
    messages,
    profiles,
    threadAllMessages,
    threadHeadMessage,
  ]);
  const isOverlay = useIsThreadPanelOverlay();
  const useSplitAuxiliaryPane = !isSinglePanelView && !isOverlay;
  const threadViewMode = useThreadViewMode();
  const hasThreadSurface =
    Boolean(threadHeadMessage) || shouldShowThreadSkeleton;
  const useFocusThreadDrawer =
    threadViewMode === "focus" && useSplitAuxiliaryPane && hasThreadSurface;
  const { channelIsCovered, markExitComplete } = useFocusDrawerPresence(
    useFocusThreadDrawer,
    onCloseThread,
  );
  const { changeThreadViewMode, layoutScrollTargetId, resolveScrollTarget } =
    useThreadViewModeSwitch({
      activeThreadHeadId: threadHeadMessage?.id ?? null,
      externalScrollTargetId: threadScrollTargetId,
      onExternalTargetResolved: onThreadScrollTargetResolved,
      onModeChange: markExitComplete,
    });
  const wrapAux = (panel: React.ReactNode, testId: string) =>
    useSplitAuxiliaryPane ? (
      <RightAuxiliaryPane
        canResetWidth={canResetThreadPanelWidth}
        key={testId}
        onResetWidth={onResetThreadPanelWidth}
        onResizeStart={onThreadPanelResizeStart}
        testId={testId}
        widthPx={threadPanelWidthPx}
      >
        {panel}
      </RightAuxiliaryPane>
    ) : (
      <React.Fragment key={testId}>{panel}</React.Fragment>
    );
  const wrapThreadPanel = (panel: React.ReactNode) => (
    <ThreadPanelSurface
      channelName={activeChannel.name}
      isFocusDrawer={useFocusThreadDrawer}
      key={THREAD_SURFACE_KEY}
      onClose={onCloseThread}
    >
      {useFocusThreadDrawer ? panel : wrapAux(panel, "message-thread-panel")}
    </ThreadPanelSurface>
  );
  const threadHeaderLeading = useSplitAuxiliaryPane ? (
    <ThreadViewModeToggle onChange={changeThreadViewMode} />
  ) : undefined;
  const threadLayoutProps = getThreadPanelLayout({
    headerLeading: threadHeaderLeading,
    isFocusDrawer: useFocusThreadDrawer,
    isSinglePanelView,
    useSplitAuxiliaryPane,
  });
  const timelineReplyHandler = activeChannel.archivedAt
    ? undefined
    : onOpenThread;
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
      {!isSinglePanelView ? (
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 z-30 bg-background/80 backdrop-blur-md supports-backdrop-filter:bg-background/70 dark:bg-background/70 dark:backdrop-blur-xl dark:supports-backdrop-filter:bg-background/55",
            channelChrome.headerHeight,
          )}
          data-testid="channel-shared-header-backdrop"
        />
      ) : null}
      {!isSinglePanelView ? (
        <section
          aria-label="Channel messages and composer"
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          inert={channelIsCovered ? true : undefined}
          data-testid="channel-drop-zone"
          onDragEnter={
            canDropInMainColumn ? mainComposerMedia.handleDragEnter : undefined
          }
          onDragLeave={
            canDropInMainColumn ? mainComposerMedia.handleDragLeave : undefined
          }
          onDragOver={
            canDropInMainColumn ? mainComposerMedia.handleDragOver : undefined
          }
          onDrop={
            canDropInMainColumn
              ? (event) => {
                  void mainComposerMedia.handleDrop(event);
                }
              : undefined
          }
        >
          {header}
          <div className="relative isolate flex min-h-0 min-w-0 flex-1 flex-col">
            <MessageTimeline
              ref={messageTimelineRef}
              channelId={activeChannel.id}
              channelIntro={channelIntro}
              scrollContainerRef={timelineScrollRef}
              currentPubkey={currentPubkey}
              fetchOlder={fetchOlder}
              followThreadById={followThreadById}
              hasOlderMessages={hasOlderMessages}
              historyExhausted={historyExhausted}
              isFetchingOlder={isFetchingOlder}
              isFollowingThreadById={isFollowingThreadById}
              isMessageUnreadById={isMessageUnreadById}
              profiles={profiles}
              unfollowThreadById={unfollowThreadById}
              emptyDescription="Messages and sub-replies will appear here once the relay has history for this channel."
              emptyTitle="No messages yet"
              isError={isTimelineError}
              isLoading={isTimelineLoading}
              onRetry={onRetryTimeline}
              mainEntries={mainTimelineEntries}
              threadSummaries={threadSummaries}
              messages={messages}
              firstUnreadMessageId={firstUnreadMessageId}
              unreadCount={unreadCount}
              onMarkUnread={onMarkUnread}
              onMarkRead={onMarkRead}
              onReply={timelineReplyHandler}
              onEdit={isComposerDisabled || editing ? undefined : setEditTarget}
              onToggleReaction={isComposerDisabled ? undefined : handleToggleReaction}
              onOpenThread={onOpenThread}
              channelName={activeChannel.name}
              isSendingVideoReviewComment={isSending}
              onSendVideoReviewComment={activeVideoReviewCommentSender}
              onTargetReached={onTargetReached}
              {...searchHighlightProps.timeline}
              targetMessageId={targetMessageId}
              splitThreadPanelOpen={
                useSplitAuxiliaryPane &&
                !useFocusThreadDrawer &&
                Boolean(openThreadHeadId)
              }
              threadUnreadCounts={threadUnreadCounts}
            />
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 z-40 isolate before:absolute before:inset-x-0 before:bottom-0 before:-z-10 before:h-24 before:bg-gradient-to-b before:from-transparent before:to-background before:content-[''] after:absolute after:inset-x-0 after:bottom-0 after:-z-10 after:h-12 after:bg-background after:content-['']"
              data-testid="channel-composer-overlay"
              ref={composerWrapperRef}
            >
              <ComposerUploadProgressOverlay />
              <div className="composer-dock composer-overlay-corner-masks relative pointer-events-auto">
                <ComposerDockBackdrop gutterClassName="inset-x-5" />
                {editTarget ? (
                  <MessageComposer
                    key={`edit:${editTarget.id}`}
                    channelId={activeChannel.id}
                    channelName={activeChannel.name}
                    editTarget={editTarget}
                    onCancelEdit={() => setEditTarget(null)}
                    containerClassName="px-5 pb-0"
                    layoutMode="dock"
                    profiles={profiles}
                    disabled={isComposerDisabled}
                    isSending={editing}
                    onSend={saveEdit}
                    showBackgroundUploadProgress={false}
                  />
                ) : null}
                <div hidden={editTarget !== null}><MessageComposer
                  channelId={activeChannel.id}
                  channelName={activeChannel.name}
                  containerClassName="px-5 pb-0"
                  layoutMode="dock"
                  disabled={isComposerDisabled}
                  autoSubmitDraftKey={autoSendDraftKey}
                  onAutoSubmitComplete={onAutoSendComplete}
                  isSending={isSending}
                  mediaController={mainComposerMedia}
                  onAttachmentAcceptanceChange={setAcceptsMainAttachments}
                  onSend={handleSendMessage}
                  profiles={profiles}
                  showBackgroundUploadProgress={false}
                  placeholder={
                    activeChannel.archivedAt
                      ? "Archived channels are read-only."
                      : `Message #${activeChannel.name}`
                  }
                  showTopBorder={false}
                /></div>
              </div>
            </div>
            {canDropInMainColumn && mainComposerMedia.isDragOver ? (
              <DropZoneOverlay className="z-50 rounded-2xl bg-primary/20 backdrop-blur-sm" />
            ) : null}
          </div>
        </section>
      ) : null}
      {/* Serialize replacements so focus drawers keep one travel direction. */}
      <AnimatePresence mode="wait" onExitComplete={markExitComplete}>
        {threadHeadMessage
          ? wrapThreadPanel(
              <MessageThreadPanel
                channelId={activeChannel.id}
                channelName={activeChannel.name}
                currentPubkey={currentPubkey}
                disabled={isComposerDisabled}
                firstUnreadReplyId={threadFirstUnreadReplyId}
                isFollowingThread={isFollowingThread}
                isMessageUnreadById={isMessageUnreadById}
                isSending={isSending}
                {...threadLayoutProps}
                autoSendDraftKey={autoSendDraftKey}
                onAutoSubmitComplete={onAutoSendComplete}
                onCancelReply={onCancelThreadReply}
                onClose={onCloseThread}
                onFollowThread={onFollowThread}
                onMarkUnread={onMarkUnread}
                onMarkRead={onMarkRead}
                onToggleReaction={isComposerDisabled ? undefined : handleToggleReaction}
                onExpandReplies={onExpandThreadReplies}
                onSelectReplyTarget={onSelectThreadReplyTarget}
                onSend={onSendThreadReply}
                onSendToChannel={
                  isComposerDisabled ? undefined : onSendToChannel
                }
                onScrollTargetResolved={() => resolveScrollTarget()}
                onScrollTargetSettled={resolveScrollTarget}
                onUnfollowThread={onUnfollowThread}
                profiles={profiles}
                replyTargetMessage={threadReplyTargetMessage}
                scrollTargetHighlights={!layoutScrollTargetId}
                scrollTargetId={layoutScrollTargetId ?? threadScrollTargetId}
                {...searchHighlightProps.thread}
                threadHead={threadHeadMessage}
                videoReviewPresentation={threadVideoReviewPresentation}
                widthPx={threadPanelWidthPx}
                threadReplies={threadMessages}
                threadRepliesPending={threadMessagesPending}
                threadRepliesError={threadMessagesError}
                onRetryThreadReplies={onRetryThreadReplies}
                threadUnreadCount={threadUnreadCounts?.get(
                  threadHeadMessage.id,
                )}
                threadReplyUnreadCounts={threadReplyUnreadCounts}
              />,
            )
          : shouldShowThreadSkeleton
            ? wrapThreadPanel(
                <MessageThreadPanelSkeleton
                  {...threadLayoutProps}
                  onClose={onCloseThread}
                  widthPx={threadPanelWidthPx}
                />,
              )
            : profilePanelPubkey
              ? wrapAux(
                  <UserProfilePanel
                    isSinglePanelView={
                      useSplitAuxiliaryPane ? false : isSinglePanelView
                    }
                    layout={useSplitAuxiliaryPane ? "split" : "standalone"}
                    transparentChrome={useSplitAuxiliaryPane}
                    onClose={onCloseProfilePanel}
                    pubkey={profilePanelPubkey}
                    splitPaneClamp
                    widthPx={threadPanelWidthPx}
                  />,
                  "user-profile-panel",
                )
              : null}
      </AnimatePresence>
    </div>
  );
});
