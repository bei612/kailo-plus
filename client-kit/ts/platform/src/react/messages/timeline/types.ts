import type * as React from "react";
import type { TimelineMessage } from "../types";
import type { MainTimelineEntry } from "../thread/threadPanel";
import type { ChannelWindowThreadSummary } from "../../forum/channelWindowResponse";
import type { ChannelIntro } from "./ChannelIntroBlock";
import type { TimelineVirtualizerApi } from "./VirtualizedTimelineRows";
import type { DirectMessageIntroPerson, DirectMessageParticipantRenderer } from "./DirectMessageIntroAvatarStack";
type UserProfileLookup = Record<string, import("../../pulse/host").UserProfileSummary>;
export type MessageTimelineProps = {
  /** Actual rows admitted by the Relay window, including orphan replies. */
  authoritativeRowIds?: ReadonlySet<string>;
  channelId?: string | null;
  channelIntro?: ChannelIntro | null;
  directMessageIntro?: { displayName: string; participants: DirectMessageIntroPerson[]; renderParticipant: DirectMessageParticipantRenderer } | null;
  channelName?: string;
  messages: TimelineMessage[];
  mainEntries?: MainTimelineEntry[];
  /** Relay thread summaries (root id → summary) for the deferred-pass entry
   *  fallback, so badge rows survive while a scrollback page commits. */
  threadSummaries?: ReadonlyMap<string, ChannelWindowThreadSummary>;
  isError?: boolean;
  isLoading?: boolean;
  onRetry?: () => void;
  entranceMessageId?: string | null;
  onEntranceMessageComplete?: (messageId: string) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  currentPubkey?: string;
  fetchOlder?: () => Promise<void>;
  hasOlderMessages?: boolean;
  /**
   * True when the loaded window provably starts at the channel's beginning
   * (a resolved tail page with `hasMore: false`) — NOT merely the absence of
   * a paging signal. Gates the oldest loaded day's divider.
   */
  historyExhausted?: boolean;
  /** Optional external ref to the scroll container — used by the parent to
   *  observe scroll position or adjust padding dynamically. */
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  /** True when the timeline has the composer overlay below it. */
  hasComposerOverlay?: boolean;
  isFetchingOlder?: boolean;
  messageFooters?: Record<string, React.ReactNode>;
  profiles?: UserProfileLookup;
  followThreadById?: (rootId: string) => void;
  isFollowingThreadById?: (rootId: string) => boolean;
  isMessageUnreadById?: (messageId: string) => boolean;
  onMarkUnread?: (message: TimelineMessage) => void;
  onMarkRead?: (message: TimelineMessage) => void;
  onReply?: (message: TimelineMessage) => void;
  onEdit?: (message: TimelineMessage) => void;
  onDelete?: (message: TimelineMessage) => void;
  onToggleReaction?: (message: TimelineMessage, emoji: string, remove: boolean) => Promise<void>;
  onOpenThread?: (message: TimelineMessage) => void;
  isSendingVideoReviewComment?: boolean;
  onSendVideoReviewComment?: (
    message: TimelineMessage,
    content: string,
    mentionPubkeys: string[],
    mediaTags?: string[][],
    parentEventId?: string,
  ) => Promise<void>;
  unfollowThreadById?: (rootId: string) => void;
  /** The message ID of the currently active find-in-channel match. */
  searchActiveMessageId?: string | null;
  /** Set of message IDs that match the current find-in-channel query. */
  searchMatchingMessageIds?: Set<string>;
  /** The current find-in-channel query string. */
  searchQuery?: string;
  targetMessageId?: string | null;
  onTargetReached?: (messageId: string) => void;
  splitThreadPanelOpen?: boolean;
  /** Event id of the oldest unread top-level message at channel open, or null. */
  firstUnreadMessageId?: string | null;
  /** Count of unread top-level messages at channel open. */
  unreadCount?: number;
  /** Per-thread unread counts keyed by thread root id. */
  threadUnreadCounts?: ReadonlyMap<string, number>;
};

export type TimelineMessageListProps = {
  authoritativeRowIds?: ReadonlySet<string>;
  channelId?: string | null;
  channelName?: string;
  currentPubkey?: string;
  /** Event id of the oldest unread top-level message; renders a "New" divider above it. */
  firstUnreadMessageId?: string | null;
  followThreadById?: (rootId: string) => void;
  highlightedMessageId?: string | null;
  isFollowingThreadById?: (rootId: string) => boolean;
  isMessageUnreadById?: (messageId: string) => boolean;
  entranceMessageId?: string | null;
  onEntranceMessageComplete?: (messageId: string) => void;
  messageFooters?: Record<string, React.ReactNode>;
  /** Hoisted main-timeline entries (computed once in ChannelPane). Falls back
   *  to deriving them here when omitted (e.g. the deferred-render pass). */
  mainEntries?: MainTimelineEntry[];
  /** Relay thread summaries keyed by thread root id. Keeps badge rows alive on
   *  the deferred-render fallback — replies usually are not local timeline
   *  rows, so without the relay map every summary row unmounts mid-scrollback. */
  threadSummaries?: ReadonlyMap<string, ChannelWindowThreadSummary>;
  messages: TimelineMessage[];
  onMarkUnread?: (message: TimelineMessage) => void;
  onMarkRead?: (message: TimelineMessage) => void;
  onReply?: (message: TimelineMessage) => void;
  onEdit?: (message: TimelineMessage) => void;
  onDelete?: (message: TimelineMessage) => void;
  onToggleReaction?: (message: TimelineMessage, emoji: string, remove: boolean) => Promise<void>;
  onOpenThread?: (message: TimelineMessage) => void;
  isSendingVideoReviewComment?: boolean;
  onSendVideoReviewComment?: (
    message: TimelineMessage,
    content: string,
    mentionPubkeys: string[],
    mediaTags?: string[][],
    parentEventId?: string,
  ) => Promise<void>;
  unfollowThreadById?: (rootId: string) => void;
  profiles?: UserProfileLookup;
  /** The message ID of the currently active find-in-channel match. */
  searchActiveMessageId?: string | null;
  /** Set of message IDs that match the current find-in-channel query. */
  searchMatchingMessageIds?: Set<string>;
  /** The current find-in-channel query string. */
  searchQuery?: string;
  /** Keep date chips pinned while the timeline scrolls. */
  stickyDayDividers?: boolean;
  /** Per-thread unread counts keyed by thread root id. */
  threadUnreadCounts?: ReadonlyMap<string, number>;
  /** Content rendered as the first virtual row before channel history. */
  leadingContent?: React.ReactNode;
  /**
   * True when the loaded window provably starts at the channel's beginning.
   * Proves the oldest loaded day's boundary so its divider may render.
   */
  historyExhausted?: boolean;
  /** The virtualized timeline owns its scroll node when enabled. */
  useVirtualizer?: boolean;
  onStartReached?: () => boolean;
  onAtBottomStateChange?: (atBottom: boolean) => void;
  onVirtualizerApiChange?: (api: TimelineVirtualizerApi | null) => void;
  onVirtualizerRangeChanged?: () => void;
  onVirtualizerScrollerChange?: (element: HTMLDivElement | null) => void;
};
