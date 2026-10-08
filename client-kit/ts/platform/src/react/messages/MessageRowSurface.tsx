import { useUiT } from "../context";
import * as React from "react";
import type { TimelineMessage } from "./types";
import { getThreadReplyAvatarCenterRem, getThreadReplyAvatarCenterYRem, getThreadReplyDescendantRailStartYRem, getThreadReplyConnectorLayout, getThreadReplyIndentRem, threadReplyLength, THREAD_REPLY_LINE_WIDTH_REM } from "./threadTreeLayout";
import { cn } from "../profile/buzz/shared/lib/cn";
import { useMeasuredCssVariable } from "./useMeasuredCssVariable";
import { isEmojiOnlyMessage } from "./emojiOnly";
import { UserAvatar } from "./UserAvatar";
import { MessageHeaderRow, MessageAuthorText } from "./MessageHeader";
import { MessageTimestamp } from "./MessageTimestamp";
import { MessageReactions } from "./reactions/MessageReactions";
import { useReactionHandler } from "./reactions/useReactionHandler";
import type { CustomEmoji } from "../custom-emoji/emoji";
import type { MessageActionBarSurface } from "./MessageActionBarSurface";
type ReactionActionProps = Pick<React.ComponentProps<typeof MessageActionBarSurface>,
  "reactions" | "onReactionSelect" | "onReactionBadgeBurstRequest" | "reactionErrorMessage" | "customEmoji" | "reactionScope" | "resolveMediaUrl">;
export type ThreadDepthGuideAction = {
  active?: boolean;
  depth: number;
  label: string;
  message: TimelineMessage;
};
export function MessageRowSurface({
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
    isContinuation = false,
    layoutVariant = "default",
    message,
    onCollapseDepthGuide,
    onCollapseDepthGuideHoverChange,
    onCollapseDescendants,
    onCollapseDescendantsHoverChange,
    onEntranceComplete,
    playEntrance = false,
    showDepthGuides = true,
    renderBody, renderIdentity, renderActions, reference, resolveMediaUrl,
    onToggleReaction, customEmoji = [], reactionScope,
  }: {
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
    isContinuation?: boolean;
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
    onEntranceComplete?: (messageId: string) => void;
    playEntrance?: boolean;
    showDepthGuides?: boolean;
    renderBody: (className: string) => React.ReactNode;
    renderIdentity?: (node: React.ReactNode, kind: "avatar" | "author") => React.ReactNode;
    renderActions?: (ref: React.RefCallback<HTMLElement>, reactions: ReactionActionProps) => React.ReactNode;
    onToggleReaction?: (message: TimelineMessage, emoji: string, remove: boolean) => Promise<void>;
    customEmoji?: CustomEmoji[];
    reactionScope?: string | null;
    reference?: React.ReactNode;
    resolveMediaUrl?: (url: string) => string | undefined;
  }) {
    const translateUi = useUiT();
    const [badgeBurstEmoji, setBadgeBurstEmoji] = React.useState<string | null>(null);
    const reaction = useReactionHandler(message, onToggleReaction, customEmoji);
    // Keep the transient send state with its timestamp rather than collapsing
    // it into a grouped message row with no header.
    const isDisplayedAsContinuation = isContinuation && !message.pending;
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
    const emojiOnly = React.useMemo(
      () => isEmojiOnlyMessage(message.body),
      [message.body],
    );
    const bodyOffsetClass = emojiOnly ? "mt-1" : "mt-conversation-body";


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

    const bodyNode = renderBody(cn("max-w-full text-message", emojiOnly && "text-4xl leading-tight [&_p]:leading-tight"));

    const isThreadReplyLayout = layoutVariant === "thread-reply";
    const guideBleedRem = isThreadReplyLayout ? 0.25 : 0;
    const avatarNode = (
      <div className="relative shrink-0">
        <UserAvatar
          resolveMediaUrl={resolveMediaUrl}
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

    const avatarGutterNode = isDisplayedAsContinuation ? continuationTimestampGutter : renderIdentity ? renderIdentity(avatarNode, "avatar") : <div className="flex shrink-0 items-start">{avatarNode}</div>;

    const authorNode = renderIdentity ? (
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
        {renderActions?.(actionRailMeasureRef, {
          reactions: reaction.reactions,
          onReactionSelect: reaction.canToggle && !reaction.pending ? reaction.select : undefined,
          onReactionBadgeBurstRequest: setBadgeBurstEmoji,
          reactionErrorMessage: reaction.errorMessage,
          customEmoji, reactionScope, resolveMediaUrl,
        })}
      </div>
    );

    const statusMetadataNode = message.pending ? (
      <p
        className="font-normal text-muted-foreground/70"
        data-testid="message-send-status"
      >
        {translateUi("buzz.sending")}…
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
        {renderIdentity ? renderIdentity(authorNode, "author") : authorNode}
        {inlineMetadataNode}
      </MessageHeaderRow>
    );
    const bodyContainerClass = isDisplayedAsContinuation
      ? "mt-0"
      : bodyOffsetClass;

    const messageBodyNode = (
      <>
        {reference}
        {bodyNode}
        {continuationMetadataNode}
        <MessageReactions
          messageId={message.id} reactions={reaction.reactions}
          canToggle={reaction.canToggle} pending={reaction.pending}
          onSelect={(emoji) => { void reaction.select(emoji).catch(() => {}); }}
          burstEmojiOnRender={badgeBurstEmoji}
          onBurstEmojiRendered={(emoji) => setBadgeBurstEmoji(current => current === emoji ? null : current)}
          customEmoji={customEmoji} reactionScope={reactionScope} resolveMediaUrl={resolveMediaUrl}
        />
        {reaction.errorMessage ? <p className="mt-1.5 text-xs text-muted-foreground" role="status">{reaction.errorMessage}</p> : null}
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
                  collapseDescendantsLabel ?? translateUi("buzz.collapseReplies")
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
}
