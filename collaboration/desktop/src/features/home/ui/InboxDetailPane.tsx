import { InboxEmptyDetail, InboxDetailHeader, useInboxFocusHighlight } from "@client-kit/platform/react/inbox-surface";
import {
  AlertCircle,
  LoaderCircle,
} from "lucide-react";
import * as React from "react";

import type {
  InboxContextMessage,
  InboxItem,
  InboxReply,
} from "@/features/home/lib/inbox";
import { formatInboxTypeLabel } from "@/features/home/lib/inbox";
import {
  hasInboxThreadContext,
  toTimelineMessage,
} from "@/features/home/lib/inboxViewHelpers";
import {
  type InboxDisplayMessage,
  InboxMessageRow,
} from "@/features/home/ui/InboxMessageRow";
import type { TimelineMessage } from "@/features/messages/types";
import { formatTime } from "@/features/messages/lib/dateFormatters";
import {
  hasSameMessageAuthor,
  isWithinGroupingWindow,
  startsNewMessageGroup,
} from "@/features/messages/lib/messageGrouping";
import {
  buildVideoReviewPresentationByMessageId,
  hasRenderedVideoAttachment,
} from "@/features/messages/lib/videoReviewContext";
import { getThreadReference } from "@/features/messages/lib/threading";
import { handleTimelineMentionCopy } from "@/features/messages/lib/timelineMentionCopy";
import { MessageComposer } from "@/features/messages/ui/MessageComposer";
import { useAnchoredScroll } from "@/features/messages/ui/useAnchoredScroll";
import { useComposerHeightPadding } from "@/features/messages/ui/useComposerHeightPadding";
import type { UserProfileSummary } from "@/shared/api/types";
import { VideoReviewNavigationProvider } from "@/shared/ui/VideoReviewNavigation";

const EMPTY_CONTEXT_MESSAGES: InboxContextMessage[] = [];
const EMPTY_REPLIES: InboxReply[] = [];

type InboxDetailPaneProps = {
  canReply: boolean;
  currentPubkey?: string;
  onToggleReaction?: (message: TimelineMessage, emoji: string, remove: boolean) => Promise<void>;
  disabledReplyReason?: string | null;
  isSendingReply?: boolean;
  isSinglePanelView?: boolean;
  hasThreadContextLoadError?: boolean;
  isThreadContextLoading?: boolean;
  item: InboxItem | null;
  messages?: InboxContextMessage[];
  profiles?: Record<string, UserProfileSummary>;
  replies?: InboxReply[];
  contextChannelName?: string | null;
  /**
   * The event anchor: the specific event ID the user selected or navigated to
   * via `?item=`. Used for message highlighting and as the stable identity for
   * scroll/focus effects. Does NOT change when a live reply advances the
   * representative `item.id`.
   */
  selectedEventId: string | null;
  unreadBoundaryEventId?: string | null;
  /**
   * The default reply-parent event ID derived from the latched anchor's tags
   * in HomeView (`parentId ?? anchor.id`). Populated once the anchor is found
   * in feedItems and held until a new anchor is selected. Used as fallback
   * when the anchor event has been displaced from the current `groupItems`
   * (e.g. a very old anchor evicted by a newer representative).
   */
  latchedDefaultParentId?: string | null;
  onBack?: () => void;
  canOpenContext?: boolean;
  onOpenContext: (
    channelId: string,
    messageId: string,
    threadRootId?: string | null,
  ) => void;
  onSendReply: (input: {
    content: string;
    mediaTags?: string[][];
    mentionPubkeys: string[];
    parentEventId: string | null;
  }) => Promise<void>;
};

export function InboxDetailPane(props: InboxDetailPaneProps) {
  return (
    <VideoReviewNavigationProvider>
      <InboxMessageDetailPane {...props} />
    </VideoReviewNavigationProvider>
  );
}

function InboxMessageDetailPane({
  canReply,
  currentPubkey,
  onToggleReaction,
  disabledReplyReason,
  isSendingReply = false,
  hasThreadContextLoadError = false,
  isThreadContextLoading = false,
  item,
  messages = EMPTY_CONTEXT_MESSAGES,
  profiles,
  replies = EMPTY_REPLIES,
  contextChannelName = null,
  selectedEventId,
  unreadBoundaryEventId = null,
  latchedDefaultParentId = null,
  onBack,
  canOpenContext = true,
  onOpenContext,
  onSendReply,
}: InboxDetailPaneProps) {
  const detailPaneRef = React.useRef<HTMLElement | null>(null);
  // Refs for the shared anchored-scroll hook's container and content roots.
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const composerWrapperRef = React.useRef<HTMLDivElement | null>(null);
  const [replyTargetId, setReplyTargetId] = React.useState<string | null>(null);
  // The stable conversation ID: does not change when the representative latest
  // event advances. All lifecycle effects (reply target reset, focus highlight,
  // scroll centering) key on this.
  const conversationId = item?.conversationId ?? null;
  const isFocusHighlightVisible = useInboxFocusHighlight(conversationId);
  // Build the plain, non-virtualized timeline the shared hook anchors against.
  // Live arrivals rerun its layout compensation without changing the target.

  const displayMessages = React.useMemo<InboxDisplayMessage[]>(() => {
    const selectedMessage = messages.find((message) => message.isSelected);
    const pendingReplyMessages: InboxDisplayMessage[] = replies.map(
      (reply) => ({
        ...reply,
        depth: reply.depth ?? (selectedMessage?.depth ?? 0) + 1,
        isSelected: false,
        mentionNames: [],
      }),
    );

    if (messages.length > 0) {
      return [...messages, ...pendingReplyMessages];
    }
    if (!item) return pendingReplyMessages;

    const threadReference = getThreadReference(item.item.tags);
    return [
      {
        authorLabel: item.senderLabel,
        authorPubkey: item.item.pubkey,
        avatarUrl: item.avatarUrl,
        content: item.preview,
        createdAt: item.item.createdAt,
        depth: 0,
        fullTimestampLabel: item.fullTimestampLabel,
        id: item.id,
        isSelected: true,
        mentionNames: item.mentionNames,
        mentionPubkeysByName: item.mentionPubkeysByName,
        parentId: threadReference.parentId,
        rootId: threadReference.rootId,
        tags: item.item.tags,
        timeLabel: formatTime(item.item.createdAt),
      },
      ...pendingReplyMessages,
    ];
  }, [item, messages, replies]);
  const videoReviewMessages = React.useMemo(
    () => displayMessages.map(toTimelineMessage),
    [displayMessages],
  );
  const handleSendVideoReviewComment = React.useCallback(
    (
      message: TimelineMessage,
      content: string,
      mentionPubkeys: string[],
      mediaTags?: string[][],
      parentEventId?: string,
    ) =>
      onSendReply({
        content,
        mediaTags,
        mentionPubkeys,
        parentEventId: parentEventId ?? message.id,
      }),
    [onSendReply],
  );
  const videoReviewPresentation = React.useMemo(
    () =>
      buildVideoReviewPresentationByMessageId(
        {
          channelId: item?.item.channelId,
          channelName: contextChannelName ?? item?.channelLabel ?? undefined,
          isSendingVideoReviewComment: isSendingReply,
          messages: videoReviewMessages,
          onSendVideoReviewComment: canReply
            ? handleSendVideoReviewComment
            : undefined,
          profiles,
        },
        hasRenderedVideoAttachment,
      ),
    [
      canReply,
      contextChannelName,
      handleSendVideoReviewComment,
      isSendingReply,
      item,
      profiles,
      videoReviewMessages,
    ],
  );
  const { onScroll } = useAnchoredScroll({
    channelId: conversationId,
    contentRef,
    isLoading: isThreadContextLoading,
    messages: displayMessages,
    pinTargetCentered: true,
    scrollContainerRef,
    targetMessageId: selectedEventId,
  });

  const focusComposer = React.useCallback(() => {
    window.requestAnimationFrame(() => {
      const textarea =
        detailPaneRef.current?.querySelector<HTMLTextAreaElement>(
          '[data-testid="message-input"]',
        );
      textarea?.focus();
    });
  }, []);

  React.useEffect(() => {
    void conversationId;
    setReplyTargetId(null);
  }, [conversationId]);

  // Capture the default composer reply parent from the selected-event anchor
  // when the conversation first opens (or when the user explicitly navigates
  // to a different event anchor). Reset only when conversationId/selectedEventId
  // changes so that a live incoming message does not silently retarget the
  // in-progress reply, preserving PR #1714 same-depth semantics.
  //
  // Design: no render-phase ref mutations. `item` and `latchedDefaultParentId`
  // are explicit deps. A committed ref (`parentCapturedRef`) written only inside
  // effects prevents live-update re-runs from overwriting a value that was
  // already captured for the current (conversationId, selectedEventId) pair.
  const [capturedDefaultParentId, setCapturedDefaultParentId] = React.useState<
    string | null
  >(null);
  // Written only inside committed effects — never during render.
  const parentCapturedRef = React.useRef(false);

  // Reset when the user navigates to a different conversation or event anchor.
  // biome-ignore lint/correctness/useExhaustiveDependencies: parentCapturedRef is a ref (not a reactive value); conversationId and selectedEventId are the intentional reset triggers
  React.useEffect(() => {
    parentCapturedRef.current = false;
    setCapturedDefaultParentId(null);
  }, [conversationId, selectedEventId]);

  // Capture the default parent once per (conversation, anchor) pair. The effect
  // also fires when `item` or `latchedDefaultParentId` changes, but the
  // `parentCapturedRef` guard prevents overwriting a value that was already
  // resolved for the current anchor. The one exception: when the anchor is not
  // in groupItems and `latchedDefaultParentId` was null on the first run, we
  // defer capture until the latch arrives (parentCapturedRef stays false so
  // the null→resolved transition of latchedDefaultParentId triggers re-capture).
  // biome-ignore lint/correctness/useExhaustiveDependencies: conversationId is derived from item but listed explicitly as a self-documenting reset signal; parentCapturedRef is a ref
  React.useEffect(() => {
    if (parentCapturedRef.current) {
      return;
    }
    if (!item) {
      setCapturedDefaultParentId(null);
      return;
    }
    // Look for the anchored event inside groupItems first (it may be an older
    // non-representative event), then fall back to the representative item.
    const anchoredEvent =
      selectedEventId != null
        ? item.groupItems.find((gi) => gi.id === selectedEventId)
        : null;
    if (anchoredEvent) {
      // Anchor found in groupItems — derive parent from its tags. Mark as
      // captured so live feed advances don't retarget the reply.
      const defaultParent =
        getThreadReference(anchoredEvent.tags).parentId ?? anchoredEvent.id;
      setCapturedDefaultParentId(defaultParent);
      parentCapturedRef.current = true;
      return;
    }
    // Anchor is not in groupItems (evicted from feed window). Use the latched
    // default parent from HomeView, which was captured when the event was still
    // present in feedItems. If the latch is not yet available (null), use the
    // representative fallback but do NOT mark as captured — the null→resolved
    // transition of latchedDefaultParentId will fire this effect again with the
    // correct value.
    if (latchedDefaultParentId != null) {
      setCapturedDefaultParentId(latchedDefaultParentId);
      parentCapturedRef.current = true;
      return;
    }
    // Latch not yet available; install the representative fallback without
    // marking as captured so the true latch value replaces it when it arrives.
    const fallback =
      getThreadReference(item.item.tags ?? []).parentId ?? item.id;
    setCapturedDefaultParentId(fallback);
  }, [conversationId, selectedEventId, item, latchedDefaultParentId]);

  useComposerHeightPadding(
    scrollContainerRef,
    composerWrapperRef,
    conversationId,
  );

  if (!item) return <InboxEmptyDetail />;

  const replyTarget =
    displayMessages.find((message) => message.id === replyTargetId) ?? null;
  // Explicit sub-message reply wins. Otherwise use the captured default parent
  // (derived from the selected-event anchor at conversation entry), which does
  // not change when a live incoming message advances the representative item.
  const composerParentEventId =
    replyTarget?.id ?? capturedDefaultParentId ?? item.id;
  const composerReplyTarget =
    replyTarget && replyTarget.id !== item.id
      ? {
          author: replyTarget.authorLabel,
          body: replyTarget.content,
          id: replyTarget.id,
        }
      : null;
  const channelContextName = contextChannelName ?? item.channelLabel;
  const isThreadContext = hasInboxThreadContext(item, messages);
  const contextLabel = isThreadContext
    ? channelContextName
      ? `Thread in #${channelContextName}`
      : "Thread"
    : channelContextName
      ? `Message in #${channelContextName}`
      : formatInboxTypeLabel(item);
  const contextChannelId = item.item.channelId;
  const sourceEventId = selectedEventId ?? item.id;
  const contextThreadRootId = isThreadContext ? item.conversationId : null;
  const openContextLabel = isThreadContext
    ? "Open full thread"
    : "Open in channel";

  const handleSelectReplyTarget = (message: InboxDisplayMessage) => {
    setReplyTargetId((currentReplyTargetId) =>
      currentReplyTargetId === message.id ? null : message.id,
    );
    focusComposer();
  };

  return (
    <section
      className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background/60"
      data-testid="home-inbox-detail"
      ref={detailPaneRef}
    >
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <InboxDetailHeader title={contextLabel} onBack={onBack} openLabel={openContextLabel}
          fallbackTitle={item.fullTimestampLabel}
          onOpen={contextChannelId && canOpenContext ? () => onOpenContext(contextChannelId, sourceEventId, contextThreadRootId) : undefined} />

        <div
          aria-busy={isThreadContextLoading}
          className="-mt-13 min-h-0 flex-1 overflow-y-auto overscroll-contain pb-32 pt-13 [overflow-anchor:none]"
          data-testid="home-inbox-detail-scroll"
          // Selection copy across a rendered mention chip: restores the sigil
          // and the identity sidecar the browser's default copy would drop.
          // Covers only the messages — the composer is a sibling overlay, so
          // its own copy handler is untouched.
          onCopy={handleTimelineMentionCopy}
          onScroll={onScroll}
          ref={scrollContainerRef}
        >
          <div ref={contentRef}>
            {isThreadContextLoading && displayMessages.length <= 1 ? (
              <div
                className="mx-4 mb-2 flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
                data-testid="home-inbox-context-loading"
              >
                <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" />
                <span>Loading surrounding context...</span>
              </div>
            ) : null}
            {hasThreadContextLoadError ? (
              <div
                className="mx-4 mb-2 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                data-testid="home-inbox-context-error"
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Some message context could not be loaded.</span>
              </div>
            ) : null}
            {displayMessages.map((message, index) => {
              const hasUnreadBoundary = message.id === unreadBoundaryEventId;
              const isAfterSeparator = index === 1 || hasUnreadBoundary;
              const previousMessage = displayMessages[index - 1];
              const isContinuation =
                !isAfterSeparator &&
                !startsNewMessageGroup(message) &&
                hasSameMessageAuthor(
                  { pubkey: previousMessage?.authorPubkey },
                  { pubkey: message.authorPubkey },
                ) &&
                isWithinGroupingWindow(
                  previousMessage?.createdAt,
                  message.createdAt,
                );

              return (
                <InboxMessageRow
                  canReply={canReply}
                  currentPubkey={currentPubkey}
                  onToggleReaction={onToggleReaction}
                  channelId={item.item.channelId}
                  isContinuation={isContinuation}
                  isFirst={index === 0}
                  isFocusHighlightVisible={isFocusHighlightVisible}
                  key={message.id}
                  message={message}
                  onSelectReplyTarget={handleSelectReplyTarget}
                  profiles={profiles}
                  showUnreadBoundary={hasUnreadBoundary}
                  videoReviewCommentRootId={videoReviewPresentation.commentRootIdsByMessageId.get(
                    message.id,
                  )}
                  videoReviewContext={videoReviewPresentation.contextsByMessageId.get(
                    message.id,
                  )}
                />
              );
            })}
          </div>
        </div>

        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-40 isolate before:absolute before:inset-x-0 before:bottom-0 before:h-12 before:bg-gradient-to-b before:from-transparent before:to-background before:content-[''] after:absolute after:inset-x-0 after:bottom-0 after:h-4 after:bg-background after:content-['']"
          data-testid="home-inbox-detail-composer-overlay"
          ref={composerWrapperRef}
        >
          <span
            aria-hidden="true"
            className="absolute bottom-4 left-4 h-4 w-4 bg-background"
            style={{
              maskImage:
                "radial-gradient(circle at top right, transparent 0 1rem, black calc(1rem + 0.5px))",
              WebkitMaskImage:
                "radial-gradient(circle at top right, transparent 0 1rem, black calc(1rem + 0.5px))",
            }}
          />
          <span
            aria-hidden="true"
            className="absolute bottom-4 right-4 h-4 w-4 bg-background"
            style={{
              maskImage:
                "radial-gradient(circle at top left, transparent 0 1rem, black calc(1rem + 0.5px))",
              WebkitMaskImage:
                "radial-gradient(circle at top left, transparent 0 1rem, black calc(1rem + 0.5px))",
            }}
          />
          <div className="pointer-events-auto">
            <MessageComposer
              channelId={item.item.channelId}
              channelName={item.channelLabel ?? "channel"}
              containerClassName="px-4 pb-4 sm:px-4"
              disabled={!canReply}
              draftKey={`thread:${item.conversationId}`}
              isSending={isSendingReply}
              onCancelReply={
                composerReplyTarget ? () => setReplyTargetId(null) : undefined
              }
              onSend={(content, mentionPubkeys, mediaTags) =>
                onSendReply({
                  content,
                  mediaTags,
                  mentionPubkeys,
                  parentEventId: composerParentEventId,
                })
              }
              placeholder={
                canReply
                  ? `Send reply to ${item.channelLabel ? `#${item.channelLabel} thread` : "channel thread"}`
                  : (disabledReplyReason ??
                    "Replies are not available for this item.")
              }
              replyTarget={composerReplyTarget}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
