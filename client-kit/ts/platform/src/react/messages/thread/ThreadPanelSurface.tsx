// Presentation extracted from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/messages/ui/MessageThreadPanel.tsx, preserving the Kailo native host's supported actions.
import * as React from "react";
import { useUiT } from "../../context";
import { ArrowDown } from "lucide-react";

import {
  buildThreadSummaryFromVisibleEntries,
  getActiveContinuationDepths,
  hasNestedThreadBranches,
  type MainTimelineEntry,
} from "./threadPanel";
import {
  hasSameMessageAuthor,
  isWithinGroupingWindow,
} from "../messageGrouping";
import type { TimelineMessage } from "../types";
import type { ThreadPanelLayoutProps } from "./threadPanelLayout";
import { useEscapeKey } from "./useEscapeKey";
import { useIsThreadPanelOverlay } from "./use-thread-overlay";
import { cn } from "../../profile/buzz/shared/lib/cn";
import { AuxiliaryPanel } from "./auxiliary";
import { AuxiliaryPanelBody } from "./auxiliary";
import {
  THREAD_PANEL_COLUMN_CLASS,
  THREAD_PANEL_COMPOSER_GUTTER_CLASS,
  THREAD_PANEL_MESSAGE_GUTTER_CLASS,
} from "./messageThreadPanelLayout";
import { Button } from "../../profile/buzz/shared/ui/button";
import { Separator } from "../../sidebar/separator";
import { ComposerDockBackdrop } from "./ComposerDockBackdrop";
import {
  MessageThreadPanelHeader,
  ThreadMessageSkeleton,
} from "./MessageThreadPanelSkeleton";
import type { ThreadDepthGuideAction } from "../MessageRowSurface";
import { MessageThreadSummaryRow } from "./MessageThreadSummaryRow";
import { ThreadReplyRegion } from "./MessageThreadReplyState";
import { UnreadDivider } from "../UnreadDivider";
import { useComposerHeightPadding } from "./useComposerHeightPadding";
import { useAnchoredScroll } from "./useAnchoredScroll";
import { selectDeferredListRenderState } from "./timelineSnapshot";
import { selectThreadRowHighlight } from "./threadReplyHighlight";

export type ThreadPanelRowProps = Omit<React.ComponentProps<typeof import("../MessageRowSurface").MessageRowSurface>, "renderBody" | "renderIdentity" | "renderActions"> & {
  isUnread?: boolean; searchQuery?: string;
  onReply?: (message: TimelineMessage) => void;
};
export type ThreadPanelComposerProps = {
  channelId: string | null; channelName: string; containerClassName: string; layoutMode: "dock";
  disabled: boolean; isSending: boolean; draftKey: string; autoSubmitDraftKey?: string | null;
  onAutoSubmitComplete?: () => void; onCancelReply?: () => void;
  onCaptureSendContext: () => {parentEventId: string | null; threadHeadId: string | null};
  placeholder: string; replyTarget: {author: string; body: string; id: string} | null;
};
export type ThreadPanelSurfaceProps = ThreadPanelLayoutProps & {
  renderRow: (props: ThreadPanelRowProps) => React.ReactNode;
  renderComposer: (props: ThreadPanelComposerProps) => React.ReactNode;
  resolveMediaUrl?: (url: string) => string | undefined;
  onCopy?: React.ClipboardEventHandler<HTMLDivElement>;
  channelId: string | null;
  channelName: string;
  disabled?: boolean;
  firstUnreadReplyId?: string | null;
  isSending: boolean;
  onCancelReply: () => void;
  onClose: () => void;
  onMarkUnread?: (message: TimelineMessage) => void;
  onMarkRead?: (message: TimelineMessage) => void;
  onExpandReplies: (message: TimelineMessage) => void;
  onScrollTargetResolved: () => void;
  onScrollTargetSettled?: (messageId: string) => void;
  scrollTargetHighlights?: boolean;
  searchMessageId?: string | null;
  searchQuery?: string;
  onSelectReplyTarget: (message: TimelineMessage) => void;
  replyTargetMessage: TimelineMessage | null;
  scrollTargetId: string | null;
  threadHead: TimelineMessage | null;
  threadReplies: MainTimelineEntry[];
  threadRepliesPending?: boolean;
  /** True when the thread-reply query terminally failed (all retries exhausted). */
  threadRepliesError?: boolean;
  /** Retries the failed thread-reply load; wired to the query's `refetch`. */
  onRetryThreadReplies?: () => void;
  threadUnreadCount?: number;
  threadReplyUnreadCounts?: ReadonlyMap<string, number>;
  widthPx: number;
  isFollowingThread?: boolean;
  isMessageUnreadById?: (messageId: string) => boolean;
  onFollowThread?: () => void;
  onUnfollowThread?: () => void;
  /**
   * When set to `thread:<threadHead.id>`, the thread composer auto-submits
   * once on mount (Send-from-drafts flow). Must be cleared by
   * `onAutoSubmitComplete` before `submitMessage` fires so the param cannot
   * re-trigger on back-navigation.
   */
  autoSendDraftKey?: string | null;
  /** Called when the thread-composer auto-submit fires so the parent can clear the trigger. */
  onAutoSubmitComplete?: () => void;
};

const EMPTY_THREAD_REPLIES: MainTimelineEntry[] = [];
const THREAD_PANEL_SUMMARY_INDENT_OFFSET_REM = 0;

function ThreadRow({ render, ...props }: ThreadPanelRowProps & { render: ThreadPanelSurfaceProps["renderRow"] }) {
  return render(props);
}
function ThreadComposer({ render, ...props }: ThreadPanelComposerProps & { render: ThreadPanelSurfaceProps["renderComposer"] }) {
  return render(props);
}

export function ThreadPanelSurface({
  renderRow,
  renderComposer,
  resolveMediaUrl,
  onCopy,
  channelId,
  channelName,
  columnMaxWidthPx,
  disabled = false,
  firstUnreadReplyId,
  layout = "standalone",
  enterMotion,
  headerLeading,
  headerTitle,
  headerTitleAriaLabel,
  isSending,
  isFocusMode,
  isSinglePanelView = false,
  isMessageUnreadById,
  onCancelReply,
  onClose,
  onHeaderTitleClick,
  onResetWidth,
  onResizeStart,
  onExpandReplies,
  onScrollTargetResolved,
  onScrollTargetSettled,
  onSelectReplyTarget,
  replyTargetMessage,
  scrollTargetId,
  scrollTargetHighlights = true,
  searchMessageId,
  searchQuery,
  threadHead,
  threadReplies,
  threadRepliesPending = false,
  threadRepliesError = false,
  onRetryThreadReplies,
  threadUnreadCount,
  threadReplyUnreadCounts,
  canResetWidth,
  splitPaneClamp,
  showBackButton,
  testId = "message-thread-panel",
  widthPx,
  transparentChrome = false,
  autoSendDraftKey = null,
  onAutoSubmitComplete,
}: ThreadPanelSurfaceProps) {
  const t = useUiT();
  const threadBodyRef = React.useRef<HTMLDivElement>(null);
  const threadContentRef = React.useRef<HTMLDivElement>(null);
  const threadComposerWrapperRef = React.useRef<HTMLDivElement>(null);
  const [hoveredCollapseBranchId, setHoveredCollapseBranchId] = React.useState<
    string | null
  >(null);
  const [collapsedThreadHeadId, setCollapsedThreadHeadId] = React.useState<
    string | null
  >(null);
  const isOverlay = useIsThreadPanelOverlay();
  const threadHeadId = threadHead?.id ?? null;
  useEscapeKey(onClose, isOverlay || isSinglePanelView || isFocusMode);
  const hasConstrainedColumn = columnMaxWidthPx != null;

  // Live ref so onCaptureSendContext can read reply state at submit time
  // (before any async mention-flow awaits change navigation state).
  const replyTargetMessageRef = React.useRef(replyTargetMessage);
  replyTargetMessageRef.current = replyTargetMessage;

  const onCaptureSendContext = React.useCallback(
    () => ({
      parentEventId: replyTargetMessageRef.current?.id ?? threadHeadId,
      threadHeadId,
    }),
    [threadHeadId],
  );

  const collapseThreadHeadReplies = React.useCallback(() => {
    if (!threadHeadId) {
      return;
    }

    setHoveredCollapseBranchId(null);
    setCollapsedThreadHeadId(threadHeadId);
  }, [threadHeadId]);
  const expandThreadHeadReplies = React.useCallback(() => {
    setHoveredCollapseBranchId(null);
    setCollapsedThreadHeadId(null);
  }, []);
  const handleCollapseBranchHoverChange = React.useCallback(
    (message: TimelineMessage, hovered: boolean) => {
      setHoveredCollapseBranchId((current) => {
        if (hovered) {
          return message.id;
        }

        return current === message.id ? null : current;
      });
    },
    [],
  );
  const handleCollapseDepthGuide = React.useCallback(
    (message: TimelineMessage) => {
      if (message.id === threadHeadId) {
        collapseThreadHeadReplies();
        return;
      }

      onExpandReplies(message);
    },
    [collapseThreadHeadReplies, onExpandReplies, threadHeadId],
  );

  const composerReplyTarget =
    replyTargetMessage && threadHead && replyTargetMessage.id !== threadHead.id
      ? {
          author: replyTargetMessage.author,
          body: replyTargetMessage.body,
          id: replyTargetMessage.id,
        }
      : null;

  const deferredThreadReplies = React.useDeferredValue(
    threadReplies,
    EMPTY_THREAD_REPLIES,
  );
  const isRepliesPending = deferredThreadReplies !== threadReplies;
  const scrollTargetIsVisibleReply = React.useMemo(
    () =>
      scrollTargetId !== null &&
      scrollTargetId !== threadHeadId &&
      deferredThreadReplies.some(
        (entry) => entry.message.id === scrollTargetId,
      ),
    [deferredThreadReplies, scrollTargetId, threadHeadId],
  );
  const isThreadHeadRepliesCollapsed =
    collapsedThreadHeadId === threadHeadId && !scrollTargetIsVisibleReply;

  React.useLayoutEffect(() => {
    if (scrollTargetIsVisibleReply && collapsedThreadHeadId === threadHeadId) {
      setCollapsedThreadHeadId(null);
    }
  }, [collapsedThreadHeadId, scrollTargetIsVisibleReply, threadHeadId]);

  // Which of the three states the reply region paints this frame. Delegated to
  // a pure helper so the "don't flash empty over an incoming list" rule is
  // covered in the lib test suite (see selectDeferredListRenderState).
  const repliesRenderState = selectDeferredListRenderState(
    deferredThreadReplies.length,
    threadReplies.length,
  );
  const threadHeadSummary = React.useMemo(() => {
    if (!threadHeadId) {
      return null;
    }

    return buildThreadSummaryFromVisibleEntries(
      threadHeadId,
      deferredThreadReplies,
    );
  }, [deferredThreadReplies, threadHeadId]);
  const visibleThreadHeadSummary = isThreadHeadRepliesCollapsed
    ? threadHeadSummary
    : null;
  // Focus mode gives the thread a subject/body structure: the head is what the
  // thread is about, the replies are the conversation about it. Only draw the
  // rule when there is actually conversation under it — the "no replies yet"
  // card and the streaming-in `pending` state would both leave a rule hanging
  // over an empty region or a placeholder.
  const showThreadHeadDivider =
    isFocusMode && (threadRepliesPending || repliesRenderState === "list");

  const threadMessages = React.useMemo(
    () => deferredThreadReplies.map((entry) => entry.message),
    [deferredThreadReplies],
  );
  const shouldShowThreadBranchGuides = React.useMemo(
    () => hasNestedThreadBranches(deferredThreadReplies),
    [deferredThreadReplies],
  );
  const highlightedBranch = React.useMemo(() => {
    if (!hoveredCollapseBranchId) {
      return null;
    }

    if (hoveredCollapseBranchId === threadHeadId) {
      return {
        depth: 0,
        endIndex: deferredThreadReplies.length - 1,
        id: hoveredCollapseBranchId,
        startIndex: -1,
      };
    }

    const startIndex = deferredThreadReplies.findIndex(
      (entry) => entry.message.id === hoveredCollapseBranchId,
    );
    if (startIndex < 0) {
      return null;
    }

    const depth = deferredThreadReplies[startIndex]!.message.depth;
    let endIndex = startIndex;
    while (
      endIndex + 1 < deferredThreadReplies.length &&
      deferredThreadReplies[endIndex + 1]!.message.depth > depth
    ) {
      endIndex += 1;
    }

    return {
      depth,
      endIndex,
      id: hoveredCollapseBranchId,
      startIndex,
    };
  }, [deferredThreadReplies, hoveredCollapseBranchId, threadHeadId]);
  const threadReplyRenderItems = React.useMemo(() => {
    if (!threadHead) {
      return [];
    }

    const ancestorStack: { index: number; message: TimelineMessage }[] = [
      { index: -1, message: threadHead },
    ];
    let previousGroupMessage: TimelineMessage | null = threadHead;

    return deferredThreadReplies.map((entry, index) => {
      while (
        ancestorStack.length > 0 &&
        ancestorStack[ancestorStack.length - 1]!.message.depth >=
          entry.message.depth
      ) {
        ancestorStack.pop();
      }

      const ancestors = [...ancestorStack];
      const continuationDepths = getActiveContinuationDepths({
        ancestors,
        entries: deferredThreadReplies,
        index,
        message: entry.message,
      });
      const collapseDepthGuideAncestors = ancestors.filter((ancestor) =>
        continuationDepths.includes(ancestor.message.depth),
      );
      const collapseDepthGuideActions: ThreadDepthGuideAction[] | undefined =
        collapseDepthGuideAncestors.length > 0
          ? collapseDepthGuideAncestors.map((ancestor) => ({
              active:
                hoveredCollapseBranchId === ancestor.message.id &&
                entry.message.depth === ancestor.message.depth + 1,
              depth: ancestor.message.depth,
              label:
                ancestor.message.id === threadHead.id
                  ? t("thread.collapseThread")
                  : t("buzz.collapseReplies"),
              message: ancestor.message,
            }))
          : undefined;
      const nextEntry = deferredThreadReplies[index + 1];
      const connectsToVisibleChild =
        nextEntry != null && nextEntry.message.depth > entry.message.depth;
      const startsUnreadSection =
        index > 0 && entry.message.id === firstUnreadReplyId;
      const isContinuation =
        !startsUnreadSection &&
        entry.summary === null &&
        hasSameMessageAuthor(previousGroupMessage, entry.message) &&
        isWithinGroupingWindow(
          previousGroupMessage?.createdAt,
          entry.message.createdAt,
        );

      if (connectsToVisibleChild && !entry.summary) {
        ancestorStack.push({ index, message: entry.message });
      }

      previousGroupMessage = entry.summary !== null ? null : entry.message;

      return {
        collapseDepthGuideActions,
        connectsToVisibleChild,
        continuationDepths,
        entry,
        index,
        isContinuation,
      };
    });
  }, [
    deferredThreadReplies,
    firstUnreadReplyId,
    hoveredCollapseBranchId,
    threadHead,
    t,
  ]);

  const {
    isAtBottom,
    newMessageCount,
    onScroll,
    scrollToBottom,
    settleAtBottomAfterLayout,
  } = useAnchoredScroll({
    channelId: threadHeadId,
    contentRef: threadContentRef,
    isLoading: threadRepliesPending || repliesRenderState === "pending",
    messages: threadMessages,
    highlightTargetMessage: scrollTargetHighlights,
    onTargetReached: onScrollTargetResolved,
    onTargetSettled: onScrollTargetSettled,
    pinTargetCentered: !scrollTargetHighlights,
    scrollContainerRef: threadBodyRef,
    targetMessageId: scrollTargetId,
  });
  useComposerHeightPadding(
    threadBodyRef,
    threadComposerWrapperRef,
    isSinglePanelView,
    "padding",
    settleAtBottomAfterLayout,
  );
  if (!threadHead) {
    return null;
  }
  const threadScrollRegion = (
    <AuxiliaryPanelBody
      className="overflow-y-auto overflow-x-hidden overscroll-contain pb-24"
      data-buzz-conversation-scroll
      data-testid="message-thread-body"
      onCopy={onCopy}
      onScroll={onScroll}
      tabIndex={-1}
      ref={threadBodyRef}
    >
      {/* The gallery is intentionally DOM-scoped: only media currently rendered
          in this open thread participates. Collapsed or unloaded descendants
          join only after the thread UI renders them. */}
      <div
        className={cn(hasConstrainedColumn && THREAD_PANEL_COLUMN_CLASS)}
        data-image-gallery-scope="thread"
        ref={threadContentRef}
        style={
          hasConstrainedColumn ? { maxWidth: columnMaxWidthPx } : undefined
        }
      >
        <div
          className={cn(THREAD_PANEL_MESSAGE_GUTTER_CLASS, "pb-1 pt-0")}
          data-testid="message-thread-head"
        >
          <div className="rounded-2xl">
            <ThreadRow
              render={renderRow}
              actionBarPlacement="inside"
                            isUnread={isMessageUnreadById?.(threadHead.id)}
              message={threadHead}
              searchQuery={
                searchMessageId === threadHead.id ? searchQuery : undefined
              }
              showDepthGuides={shouldShowThreadBranchGuides}
            />
          </div>
        </div>

        {showThreadHeadDivider ? (
          <div
            className={cn(THREAD_PANEL_MESSAGE_GUTTER_CLASS, "pb-3 pt-2")}
            data-testid="message-thread-head-divider"
          >
            <Separator className="bg-border/60" />
          </div>
        ) : null}

        <div
          className={cn(THREAD_PANEL_MESSAGE_GUTTER_CLASS, "pb-3 pt-0")}
          data-testid="message-thread-replies"
        >
          <ThreadReplyRegion
            isPending={threadRepliesPending}
            isError={threadRepliesError}
            deferredCount={deferredThreadReplies.length}
            liveCount={threadReplies.length}
            onRetry={onRetryThreadReplies}
            renderSkeleton={() => (
              <div
                className="space-y-2.5 pt-1"
                data-testid="message-thread-replies-loading"
              >
                <ThreadMessageSkeleton />
                <ThreadMessageSkeleton />
              </div>
            )}
            renderList={() =>
              visibleThreadHeadSummary ? (
                <div
                  className="space-y-0"
                  data-render-pending={isRepliesPending ? "true" : undefined}
                >
                  <MessageThreadSummaryRow
                    resolveMediaUrl={resolveMediaUrl}
                    depth={threadHead.depth}
                    message={threadHead}
                    onOpenThread={expandThreadHeadReplies}
                    summary={visibleThreadHeadSummary}
                    summaryIndentOffsetRem={
                      THREAD_PANEL_SUMMARY_INDENT_OFFSET_REM
                    }
                    unreadCount={threadUnreadCount}
                  />
                </div>
              ) : (
                <div
                  className="space-y-0"
                  data-render-pending={isRepliesPending ? "true" : undefined}
                >
                  {threadReplyRenderItems.map((item) => {
                    const {
                      collapseDepthGuideActions,
                      connectsToVisibleChild,
                      continuationDepths,
                      entry,
                      index,
                      isContinuation,
                    } = item;
                    const showUnreadDivider =
                      index > 0 && entry.message.id === firstUnreadReplyId;
                    const highlight = selectThreadRowHighlight({
                      branch: highlightedBranch,
                      index,
                      messageId: entry.message.id,
                      messageDepth: entry.message.depth,
                      showGuides: shouldShowThreadBranchGuides,
                    });
                    return (
                      <div
                        className={cn(
                          "flex flex-col gap-0",
                          entry.summary &&
                            "group/message rounded-2xl px-0 py-0.5 transition-colors hover:bg-muted/50 focus-within:bg-muted/50",
                        )}
                        key={entry.message.renderKey ?? entry.message.id}
                      >
                        {showUnreadDivider ? <UnreadDivider /> : null}
                        <ThreadRow
                          render={renderRow}
                          collapseDepthGuideActions={collapseDepthGuideActions}
                          collapseDescendantsLabel={t("buzz.collapseReplies")}
                          connectDescendants={
                            shouldShowThreadBranchGuides &&
                            connectsToVisibleChild
                          }
                          depthGuideDepths={
                            shouldShowThreadBranchGuides
                              ? continuationDepths
                              : undefined
                          }
                          highlightDescendantRail={
                            shouldShowThreadBranchGuides &&
                            highlight.isBranchOwner &&
                            connectsToVisibleChild
                          }
                          highlightReplyConnector={
                            shouldShowThreadBranchGuides &&
                            highlight.isDirectChild
                          }
                          highlightThreadLineDepths={highlight.lineDepths}
                          hoverBackground={!entry.summary}
                          isContinuation={isContinuation}
                          isUnread={isMessageUnreadById?.(entry.message.id)}
                          message={entry.message}
                          onCollapseDepthGuide={handleCollapseDepthGuide}
                          onCollapseDepthGuideHoverChange={
                            handleCollapseBranchHoverChange
                          }
                          onCollapseDescendants={
                            shouldShowThreadBranchGuides &&
                            connectsToVisibleChild &&
                            !entry.summary
                              ? onExpandReplies
                              : undefined
                          }
                          onCollapseDescendantsHoverChange={
                            handleCollapseBranchHoverChange
                          }
                          onReply={onSelectReplyTarget}
                          searchQuery={
                            searchMessageId === entry.message.id
                              ? searchQuery
                              : undefined
                          }
                          showDepthGuides={shouldShowThreadBranchGuides}
                        />
                        {entry.summary ? (
                          <MessageThreadSummaryRow
                            resolveMediaUrl={resolveMediaUrl}
                            collapseDepthGuideActions={
                              collapseDepthGuideActions
                            }
                            depth={entry.message.depth}
                            depthGuideDepths={
                              shouldShowThreadBranchGuides
                                ? continuationDepths
                                : undefined
                            }
                            highlightThreadLineDepths={highlight.lineDepths}
                            message={entry.message}
                            onCollapseDepthGuide={handleCollapseDepthGuide}
                            onCollapseDepthGuideHoverChange={
                              handleCollapseBranchHoverChange
                            }
                            onOpenThread={onExpandReplies}
                            summary={entry.summary}
                            summaryIndentOffsetRem={
                              THREAD_PANEL_SUMMARY_INDENT_OFFSET_REM
                            }
                            showDepthGuides={shouldShowThreadBranchGuides}
                            unreadCount={threadReplyUnreadCounts?.get(
                              entry.message.id,
                            )}
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )
            }
          />
        </div>
      </div>
    </AuxiliaryPanelBody>
  );

  const threadFooter = (
    <>
      {!isAtBottom ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-36 z-50 flex justify-center px-4">
          <Button
            className="pointer-events-auto h-7 min-h-7 gap-1.5 rounded-full border-border/50 bg-background/85 px-2.5 text-2xs font-medium text-muted-foreground shadow-xs backdrop-blur-sm hover:bg-muted/70 hover:text-foreground [&_svg]:size-4"
            data-testid="thread-scroll-to-latest"
            onClick={() => scrollToBottom("smooth")}
            size="sm"
            type="button"
            variant="outline"
          >
            <ArrowDown aria-hidden />
            {newMessageCount > 0
              ? t(newMessageCount === 1 ? "thread.newMessage.one" : "thread.newMessage.other", {count: newMessageCount})
              : t("thread.jumpLatest")}
          </Button>
        </div>
      ) : null}

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-40 isolate before:absolute before:inset-x-0 before:bottom-0 before:-z-10 before:h-24 before:bg-gradient-to-b before:from-transparent before:to-background before:content-[''] after:absolute after:inset-x-0 after:bottom-0 after:-z-10 after:h-12 after:bg-background after:content-['']"
        data-testid="thread-composer-overlay"
        ref={threadComposerWrapperRef}
      >
        <div
          className={cn(hasConstrainedColumn && THREAD_PANEL_COLUMN_CLASS)}
          style={
            hasConstrainedColumn ? { maxWidth: columnMaxWidthPx } : undefined
          }
        >
          <div
            className={cn(
              "composer-dock composer-overlay-corner-masks relative pointer-events-auto",
            )}
          >
            <ComposerDockBackdrop gutterClassName="inset-x-5" />
            <ThreadComposer
              render={renderComposer}
              channelId={channelId}
              channelName={channelName}
              containerClassName={cn(
                THREAD_PANEL_COMPOSER_GUTTER_CLASS,
                "pb-0",
              )}
              layoutMode="dock"
              disabled={disabled || isSending || !channelId}
              draftKey={`thread:${threadHead.id}`}
              autoSubmitDraftKey={autoSendDraftKey}
              onAutoSubmitComplete={onAutoSubmitComplete}
              isSending={isSending}
              onCancelReply={composerReplyTarget ? onCancelReply : undefined}
              onCaptureSendContext={onCaptureSendContext}
              placeholder={t("thread.replyTo", {author: threadHead.author})}
              replyTarget={composerReplyTarget}
            />
          </div>
        </div>
      </div>
    </>
  );

  return (
    <>
      <AuxiliaryPanel
        canResetWidth={canResetWidth}
        className="relative"
        enterMotion={enterMotion ?? !isFocusMode}
        footer={threadFooter}
        header={
          <MessageThreadPanelHeader
            headerLeading={headerLeading}
            headerTitle={headerTitle}
            headerTitleAriaLabel={headerTitleAriaLabel}
            isFocusMode={isFocusMode}
            isSinglePanelView={isSinglePanelView}
            onClose={onClose}
            onHeaderTitleClick={onHeaderTitleClick}
            showBackButton={showBackButton}
          />
        }
        isSinglePanelView={isSinglePanelView}
        layout={layout}
        onClose={onClose}
        onResetWidth={onResetWidth}
        onResizeStart={onResizeStart}
        splitPaneClamp={splitPaneClamp}
        testId={testId}
        transparentChrome={transparentChrome}
        widthPx={widthPx}
      >
        {threadScrollRegion}
      </AuxiliaryPanel>
    </>
  );
}
