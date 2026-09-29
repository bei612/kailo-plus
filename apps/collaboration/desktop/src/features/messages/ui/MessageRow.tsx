import * as React from "react";
import {
  depthGuideActionsEqual,
  numberArrayEqual,
  tagsEqual,
} from "@/features/messages/lib/messageRowEquality";
import {
  assertCanSendMessageToChannel,
  canSendMessageToChannel,
} from "@/features/messages/lib/canSendToChannel";
import type { TimelineMessage } from "@/features/messages/types";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import {
  getThreadReplyAvatarCenterRem,
  getThreadReplyAvatarCenterYRem,
  getThreadReplyDescendantRailStartYRem,
  getThreadReplyConnectorLayout,
  getThreadReplyIndentRem,
  threadReplyLength,
  THREAD_REPLY_LINE_WIDTH_REM,
} from "@/features/messages/lib/threadTreeLayout";
import { cn } from "@/shared/lib/cn";
import { useMeasuredCssVariable } from "@/shared/layout/useMeasuredCssVariable";
import { isEmojiOnlyMessage } from "@/shared/lib/emojiOnly";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { useChannelNavigation } from "@/shared/context/ChannelNavigationContext";
import { parseImetaTags } from "@/shared/ui/markdown/parseImeta";
import { resolveMentionProps } from "@/shared/lib/resolveMentionNames";
import type { VideoReviewContext } from "@/shared/ui/VideoPlayer";
import { VideoReviewCommentMarkdown } from "@/shared/ui/VideoReviewCommentMarkdown";
import { MessageActionBar } from "./MessageActionBar";
import { hasLinkPreviewSuppression } from "@/features/messages/lib/formatTimelineMessages";
import {
  MessageAuthorIdentity,
  MessageAuthorText,
  MessageHeaderRow,
} from "./MessageHeader";
import { MessageTimestamp } from "./MessageTimestamp";
import { SentFromThreadLine } from "./SentFromThreadLine";
export type ThreadDepthGuideAction = {
  active?: boolean;
  depth: number;
  label: string;
  message: TimelineMessage;
};
export const MessageRow = React.memo(
  function MessageRow({
    channelId = null,
    currentPubkey,
    collapseDepthGuideActions,
    connectDescendants = false,
    depthGuideDepths,
    highlighted = false,
    highlightDescendantRail = false,
    highlightReplyConnector = false,
    highlightThreadLineDepths,
    hoverBackground = true,
    actionBarPlacement = "floating",
    collapseDescendantsLabel,
    isFollowingThread,
    isContinuation = false,
    isUnread,
    layoutVariant = "default",
    message,
    onCollapseDepthGuide,
    onCollapseDepthGuideHoverChange,
    onCollapseDescendants,
    onCollapseDescendantsHoverChange,
    onFollowThread,
    onMarkUnread,
    onMarkRead,
    onReply,
    onSendToChannel,
    onEntranceComplete,
    playEntrance = false,
    onUnfollowThread,
    profiles,
    searchQuery,
    showDepthGuides = true,
    videoReviewCommentRootId,
    videoReviewContext,
  }: {
    channelId?: string | null;
    currentPubkey?: string;
    collapseDepthGuideActions?: ReadonlyArray<ThreadDepthGuideAction>;
    connectDescendants?: boolean;
    depthGuideDepths?: ReadonlyArray<number>;
    highlighted?: boolean;
    highlightDescendantRail?: boolean;
    highlightReplyConnector?: boolean;
    highlightThreadLineDepths?: ReadonlyArray<number>;
    hoverBackground?: boolean;
    actionBarPlacement?: "floating" | "inside";
    collapseDescendantsLabel?: string;
    isFollowingThread?: boolean;
    isContinuation?: boolean;
    isUnread?: boolean;
    layoutVariant?: "default" | "thread-reply";
    message: TimelineMessage;
    onCollapseDepthGuide?: (message: TimelineMessage) => void;
    onCollapseDepthGuideHoverChange?: (
      message: TimelineMessage,
      hovered: boolean,
    ) => void;
    onCollapseDescendants?: (message: TimelineMessage) => void;
    onCollapseDescendantsHoverChange?: (
      message: TimelineMessage,
      hovered: boolean,
    ) => void;
    onFollowThread?: (message: TimelineMessage) => void;
    onMarkUnread?: (message: TimelineMessage) => void;
    onMarkRead?: (message: TimelineMessage) => void;
    onReply?: (message: TimelineMessage) => void;
    onSendToChannel?: (message: TimelineMessage) => Promise<void>;
    onUnfollowThread?: (message: TimelineMessage) => void;
    onEntranceComplete?: (messageId: string) => void;
    playEntrance?: boolean;
    profiles?: UserProfileLookup;
    searchQuery?: string;
    showDepthGuides?: boolean;
    videoReviewCommentRootId?: string;
    videoReviewContext?: VideoReviewContext;
  }) {
    // Keep the transient send state with its timestamp rather than collapsing
    // it into a grouped message row with no header.
    const isDisplayedAsContinuation = isContinuation && !message.pending;
    const linkPreviewsSuppressed = hasLinkPreviewSuppression(message.tags);
    const handleEntranceAnimationEnd = React.useCallback(
      (event: React.AnimationEvent<HTMLElement>) => {
        if (
          playEntrance &&
          event.animationName === "motion-enter-conversation"
        ) {
          onEntranceComplete?.(message.id);
        }
      },
      [message.id, onEntranceComplete, playEntrance],
    );
    // The hover/focus action rail is absolutely positioned over the row, so it
    // takes no layout space of its own. Measure its rendered footprint and
    // reserve it in the message-header row (see `headerNode`) so a long author
    // name ellipsizes before the rail instead of painting underneath it. The
    // reservation is unconditional — the rail appears on hover AND
    // focus-within, and padding must not reflow the header mid-interaction.
    const articleRef = React.useRef<HTMLElement | null>(null);
    const actionRailMeasureRef = useMeasuredCssVariable({
      cssVariable: "--message-action-rail-width",
      dimension: "inline",
      resetValue: "0px",
      targetRef: articleRef,
    });
    const sendToChannelAllowed = canSendMessageToChannel(
      message,
      currentPubkey,
    );
    const handleSendToChannel = React.useCallback(
      async (target: TimelineMessage) => {
        assertCanSendMessageToChannel(target, currentPubkey);
        await onSendToChannel?.(target);
      },
      [currentPubkey, onSendToChannel],
    );
    const { mentionNames, mentionPubkeysByName } = React.useMemo(
      () => resolveMentionProps(message.tags, profiles, message.body),
      [profiles, message.tags, message.body],
    );
    const imetaByUrl = React.useMemo(
      () => (message.tags ? parseImetaTags(message.tags) : undefined),
      [message.tags],
    );

    const emojiOnly = React.useMemo(
      () => isEmojiOnlyMessage(message.body),
      [message.body],
    );
    const bodyOffsetClass = emojiOnly ? "mt-1" : "mt-conversation-body";

    const { nonDmChannelNames: channelNames } = useChannelNavigation();

    const indentRem = getThreadReplyIndentRem(message.depth);
    const descendantGuideOffsetRem = connectDescendants
      ? getThreadReplyAvatarCenterRem(message.depth)
      : null;
    const replyConnector = React.useMemo(() => {
      return getThreadReplyConnectorLayout(message.depth);
    }, [message.depth]);
    const depthGuideItems = React.useMemo(() => {
      const depths =
        depthGuideDepths ??
        Array.from(
          { length: Math.max(0, message.depth - 1) },
          (_, index) => index + 1,
        );

      return depths.map((depth) => ({
        depth,
        offset: getThreadReplyAvatarCenterRem(depth),
      }));
    }, [depthGuideDepths, message.depth]);
    const handleCollapseDescendants = React.useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        onCollapseDescendants?.(message);
      },
      [message, onCollapseDescendants],
    );
    const handleCollapseDescendantsHoverChange = React.useCallback(
      (hovered: boolean) => {
        onCollapseDescendantsHoverChange?.(message, hovered);
      },
      [message, onCollapseDescendantsHoverChange],
    );
    const handleCollapseDepthGuide = React.useCallback(
      (
        event: React.MouseEvent<HTMLButtonElement>,
        targetMessage: TimelineMessage,
      ) => {
        event.preventDefault();
        event.stopPropagation();
        onCollapseDepthGuide?.(targetMessage);
      },
      [onCollapseDepthGuide],
    );
    const handleCollapseDepthGuideHoverChange = React.useCallback(
      (targetMessage: TimelineMessage, hovered: boolean) => {
        onCollapseDepthGuideHoverChange?.(targetMessage, hovered);
      },
      [onCollapseDepthGuideHoverChange],
    );
    const collapseDepthGuideActionsByDepth = React.useMemo(() => {
      if (!collapseDepthGuideActions?.length) {
        return new Map<number, ThreadDepthGuideAction>();
      }

      return new Map(
        collapseDepthGuideActions.map((action) => [action.depth, action]),
      );
    }, [collapseDepthGuideActions]);

    const bodyNode = (
      <VideoReviewCommentMarkdown
        channelNames={channelNames}
        className={cn(
          "max-w-full text-message",
          emojiOnly && "text-4xl leading-tight [&_p]:leading-tight",
        )}
        content={message.body}
        messageId={message.id}
        linkPreviewsSuppressed={linkPreviewsSuppressed}
        linkPreviewTags={message.tags}
        imetaByUrl={imetaByUrl}
        mentionNames={mentionNames}
        mentionPubkeysByName={mentionPubkeysByName}
        searchQuery={searchQuery}
        videoReviewCommentRootId={videoReviewCommentRootId}
        videoReviewContext={videoReviewContext}
      />
    );

    const isThreadReplyLayout = layoutVariant === "thread-reply";
    const guideBleedRem = isThreadReplyLayout ? 0.25 : 0;
    const avatarNode = (
      <div className="relative shrink-0">
        <UserAvatar
          accent={message.accent}
          avatarUrl={message.avatarUrl ?? null}
          className="shrink-0"
          displayName={message.author}
          testId="message-avatar"
        />
      </div>
    );

    const continuationTimestampGutter = (
      <div
        aria-hidden="true"
        className={cn(
          "flex w-9 shrink-0 justify-end items-start pt-0.5",
          isThreadReplyLayout ? "self-start" : "self-stretch",
        )}
      >
        <MessageTimestamp
          className="opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100"
          createdAt={message.createdAt}
          hideDayPeriod
        />
      </div>
    );

    const avatarGutterNode = isDisplayedAsContinuation ? (
      continuationTimestampGutter
    ) : message.pubkey ? (
      <UserProfilePopover pubkey={message.pubkey}>
        <button
          className="flex shrink-0 items-start rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          type="button"
        >
          {avatarNode}
        </button>
      </UserProfilePopover>
    ) : (
      <div className="flex shrink-0 items-start">{avatarNode}</div>
    );

    const authorNode = message.pubkey ? (
      <MessageAuthorText hoverUnderline>{message.author}</MessageAuthorText>
    ) : (
      <MessageAuthorText as="h3">{message.author}</MessageAuthorText>
    );
    const actionBarNode = (
      <div
        className={cn(
          "absolute right-2 top-1 z-10 sm:pointer-events-none",
          actionBarPlacement === "floating"
            ? isContinuation
              ? "sm:-top-3 sm:-translate-y-1/2"
              : "sm:top-0 sm:-translate-y-1/2"
            : "sm:top-1 sm:translate-y-0",
        )}
      >
        <MessageActionBar
          channelId={channelId}
          ref={actionRailMeasureRef}
          isFollowingThread={isFollowingThread}
          isUnread={isUnread}
          message={message}
          onFollowThread={onFollowThread}
          onMarkUnread={onMarkUnread}
          onMarkRead={onMarkRead}
          onReply={onReply}
          onSendToChannel={
            onSendToChannel && sendToChannelAllowed
              ? handleSendToChannel
              : undefined
          }
          onUnfollowThread={onUnfollowThread}
          profiles={profiles}
        />
      </div>
    );

    const statusMetadataNode = message.pending ? (
      <p
        className="font-normal text-muted-foreground/70"
        data-testid="message-send-status"
      >
        Sending…
      </p>
    ) : null;

    const inlineMetadataNode = (
      <div className="flex shrink-0 items-baseline gap-2 text-xs">
        <MessageTimestamp createdAt={message.createdAt} />
        {statusMetadataNode}
      </div>
    );

    const continuationMetadataNode =
      isDisplayedAsContinuation && statusMetadataNode ? (
        <div className="mt-0.5 flex items-baseline gap-2 text-xs">
          {statusMetadataNode}
        </div>
      ) : null;

    const headerNode = isDisplayedAsContinuation ? null : (
      // pe reserves the measured action-rail footprint (0px until measured) so
      // header content ends before the rail's left edge in every rail state.
      <MessageHeaderRow className="pe-[var(--message-action-rail-width,0px)]">
        <MessageAuthorIdentity pubkey={message.pubkey}>
          {authorNode}
        </MessageAuthorIdentity>
        {inlineMetadataNode}
      </MessageHeaderRow>
    );
    const bodyContainerClass = isDisplayedAsContinuation
      ? "mt-0"
      : bodyOffsetClass;

    const messageBodyNode = (
      <>
        <SentFromThreadLine channelId={channelId} tags={message.tags} />
        {bodyNode}
        {continuationMetadataNode}
      </>
    );

    return (
      <div
        className="relative"
        style={
          indentRem > 0
            ? { paddingLeft: threadReplyLength(indentRem) }
            : undefined
        }
      >
        {showDepthGuides && depthGuideItems.length > 0 ? (
          <div
            aria-hidden={
              collapseDepthGuideActionsByDepth.size > 0 ? undefined : true
            }
            className={cn(
              "absolute left-0",
              collapseDepthGuideActionsByDepth.size === 0 &&
                "pointer-events-none",
            )}
            style={{
              bottom: threadReplyLength(-guideBleedRem),
              top: threadReplyLength(-guideBleedRem),
            }}
          >
            {depthGuideItems.map(({ depth, offset }) => {
              const collapseAction =
                collapseDepthGuideActionsByDepth.get(depth);
              const isHighlighted =
                Boolean(collapseAction?.active) ||
                Boolean(highlightThreadLineDepths?.includes(depth));
              if (collapseAction) {
                return (
                  <React.Fragment key={`${message.id}-depth-guide-${offset}`}>
                    <div
                      aria-hidden
                      className={cn(
                        "pointer-events-none absolute bottom-0 top-0 border-l transition-[border-color]",
                        isHighlighted ? "border-primary" : "border-border/45",
                      )}
                      style={{
                        borderLeftWidth: threadReplyLength(
                          THREAD_REPLY_LINE_WIDTH_REM,
                        ),
                        left: threadReplyLength(offset),
                      }}
                    />
                    <button
                      aria-label={collapseAction.label}
                      className="absolute bottom-0 top-0 z-20 w-5 -translate-x-1/2 cursor-pointer rounded-full focus-visible:outline-hidden"
                      data-thread-head-id={collapseAction.message.id}
                      data-testid="thread-collapse-guide"
                      onBlur={() =>
                        handleCollapseDepthGuideHoverChange(
                          collapseAction.message,
                          false,
                        )
                      }
                      onClick={(event) =>
                        handleCollapseDepthGuide(event, collapseAction.message)
                      }
                      onFocus={() =>
                        handleCollapseDepthGuideHoverChange(
                          collapseAction.message,
                          true,
                        )
                      }
                      onMouseEnter={() =>
                        handleCollapseDepthGuideHoverChange(
                          collapseAction.message,
                          true,
                        )
                      }
                      onMouseLeave={() =>
                        handleCollapseDepthGuideHoverChange(
                          collapseAction.message,
                          false,
                        )
                      }
                      style={{ left: threadReplyLength(offset) }}
                      type="button"
                    />
                  </React.Fragment>
                );
              }

              return (
                <div
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute bottom-0 top-0 border-l transition-[border-color]",
                    isHighlighted ? "border-primary" : "border-border/45",
                  )}
                  key={`${message.id}-depth-guide-${offset}`}
                  style={{
                    borderLeftWidth: threadReplyLength(
                      THREAD_REPLY_LINE_WIDTH_REM,
                    ),
                    left: threadReplyLength(offset),
                  }}
                />
              );
            })}
          </div>
        ) : null}
        {showDepthGuides && descendantGuideOffsetRem !== null ? (
          <>
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute bottom-0 z-0 border-l transition-[border-color]",
                highlightDescendantRail ? "border-primary" : "border-border/45",
              )}
              style={{
                bottom: threadReplyLength(-guideBleedRem),
                borderLeftWidth: threadReplyLength(THREAD_REPLY_LINE_WIDTH_REM),
                left: threadReplyLength(descendantGuideOffsetRem),
                top: threadReplyLength(getThreadReplyDescendantRailStartYRem()),
              }}
            />
            {onCollapseDescendants ? (
              <button
                aria-label={
                  collapseDescendantsLabel ?? "Collapse replies to this message"
                }
                className="absolute bottom-0 z-20 w-5 -translate-x-1/2 cursor-pointer rounded-full p-0 focus-visible:outline-hidden"
                data-thread-head-id={message.id}
                data-testid="thread-collapse-rail"
                onBlur={() => handleCollapseDescendantsHoverChange(false)}
                onClick={handleCollapseDescendants}
                onFocus={() => handleCollapseDescendantsHoverChange(true)}
                onMouseEnter={() => handleCollapseDescendantsHoverChange(true)}
                onMouseLeave={() => handleCollapseDescendantsHoverChange(false)}
                style={{
                  left: threadReplyLength(descendantGuideOffsetRem),
                  top: threadReplyLength(getThreadReplyAvatarCenterYRem()),
                }}
                type="button"
              />
            ) : null}
          </>
        ) : null}
        {showDepthGuides && replyConnector ? (
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute left-0 top-0 rounded-bl-2xl border-b border-l transition-[border-color]",
              highlightReplyConnector ? "border-primary" : "border-border/45",
            )}
            style={{
              borderBottomWidth: threadReplyLength(THREAD_REPLY_LINE_WIDTH_REM),
              borderLeftWidth: threadReplyLength(THREAD_REPLY_LINE_WIDTH_REM),
              height: threadReplyLength(
                replyConnector.heightRem + guideBleedRem,
              ),
              left: threadReplyLength(replyConnector.parentOffsetRem),
              top: threadReplyLength(-guideBleedRem),
              width: threadReplyLength(replyConnector.widthRem),
            }}
          />
        ) : null}

        <article
          className={cn(
            "group/message relative z-10 rounded-2xl transition-colors",
            playEntrance && "motion-enter-conversation",
            "py-conversation-row",
            hoverBackground
              ? "mx-1 px-2 hover:bg-muted/50 focus-within:bg-muted/50"
              : isThreadReplyLayout
                ? "mx-1 px-2"
                : "px-2",
            "flex gap-2.5",
            isDisplayedAsContinuation ? "items-center" : "items-start",
            highlighted
              ? "-mx-4 rounded-none px-6 before:absolute before:-inset-y-1.5 before:inset-x-0 before:animate-[route-target-highlight-fade_2s_ease-out_forwards] before:bg-primary/10 before:content-[''] motion-reduce:before:animate-none sm:-mx-6 sm:px-8"
              : "",
          )}
          data-message-id={message.id}
          data-testid="message-row"
          onAnimationEnd={handleEntranceAnimationEnd}
          ref={articleRef}
        >
          {isThreadReplyLayout ? (
            <>
              {avatarGutterNode}
              <div className="flex min-w-0 flex-1 flex-col">
                {headerNode}
                <div className={bodyContainerClass} data-testid="message-body">
                  {messageBodyNode}
                </div>
              </div>
            </>
          ) : (
            <>
              {avatarGutterNode}
              <div className="flex min-w-0 flex-1 flex-col">
                {headerNode}
                <div className={bodyContainerClass} data-testid="message-body">
                  {messageBodyNode}
                </div>
              </div>
            </>
          )}
          {actionBarNode}
        </article>
      </div>
    );
    // Callbacks (onReply) intentionally excluded: inline arrows
    // from parent create new refs every render — including them defeats memo.
  },
  (prev, next) =>
    prev.message.id === next.message.id &&
    prev.message.pubkey === next.message.pubkey &&
    prev.message.body === next.message.body &&
    prev.message.author === next.message.author &&
    prev.message.avatarUrl === next.message.avatarUrl &&
    prev.message.accent === next.message.accent &&
    // The header timestamp and hover gutter both derive from createdAt (the
    // old `time` prop was the same value pre-formatted; this row reads neither).
    prev.message.createdAt === next.message.createdAt &&
    prev.message.depth === next.message.depth &&
    prev.message.kind === next.message.kind &&
    prev.message.pending === next.message.pending &&
    // Value comparisons, not identity: these arrays are rebuilt with fresh
    // identities on every ingest/refetch even when unchanged — identity
    // checks made every row re-render on every streamed event in an open
    // thread (see messageRowEquality.ts).
    tagsEqual(prev.message.tags, next.message.tags) &&
    prev.message.role === next.message.role &&
    prev.currentPubkey === next.currentPubkey &&
    depthGuideActionsEqual(
      prev.collapseDepthGuideActions,
      next.collapseDepthGuideActions,
    ) &&
    prev.collapseDescendantsLabel === next.collapseDescendantsLabel &&
    prev.connectDescendants === next.connectDescendants &&
    numberArrayEqual(prev.depthGuideDepths, next.depthGuideDepths) &&
    prev.highlightDescendantRail === next.highlightDescendantRail &&
    prev.highlighted === next.highlighted &&
    prev.highlightReplyConnector === next.highlightReplyConnector &&
    numberArrayEqual(
      prev.highlightThreadLineDepths,
      next.highlightThreadLineDepths,
    ) &&
    prev.hoverBackground === next.hoverBackground &&
    prev.isContinuation === next.isContinuation &&
    prev.isFollowingThread === next.isFollowingThread &&
    prev.isUnread === next.isUnread &&
    prev.layoutVariant === next.layoutVariant &&
    prev.onCollapseDepthGuide === next.onCollapseDepthGuide &&
    prev.onCollapseDepthGuideHoverChange ===
      next.onCollapseDepthGuideHoverChange &&
    prev.onCollapseDescendants === next.onCollapseDescendants &&
    prev.onCollapseDescendantsHoverChange ===
      next.onCollapseDescendantsHoverChange &&
    prev.onEntranceComplete === next.onEntranceComplete &&
    prev.playEntrance === next.playEntrance &&
    prev.onSendToChannel === next.onSendToChannel &&
    prev.profiles === next.profiles &&
    prev.searchQuery === next.searchQuery &&
    prev.videoReviewCommentRootId === next.videoReviewCommentRootId &&
    prev.videoReviewContext === next.videoReviewContext,
);

MessageRow.displayName = "MessageRow";
