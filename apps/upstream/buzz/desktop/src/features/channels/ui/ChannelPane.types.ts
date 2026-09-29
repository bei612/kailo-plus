import type * as React from "react";
import type { MainTimelineEntry } from "@/features/messages/lib/threadPanel";
import type { ChannelWindowThreadSummary } from "@/features/messages/lib/channelWindowStore";
import type { TimelineMessage } from "@/features/messages/types";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import type { Channel } from "@/shared/api/types";
export type ChannelPaneProps = {
  activeChannel: Channel;
  /**
   * When non-null, the main composer fires `submitMessage` once after loading
   * the draft identified by this key — i.e. the user clicked "Send message"
   * in the Drafts panel and confirmed. Cleared by the composer after firing so
   * back-navigation cannot re-trigger.
   */
  autoSendDraftKey?: string | null;
  /**
   * Called after the auto-submit guard fires to surgically clear `?autoSend`
   * from the URL while preserving `?thread` and all other panel search state.
   */
  onAutoSendComplete: () => void;
  currentPubkey?: string;
  fetchOlder?: () => Promise<void>;
  header?: React.ReactNode;
  hasOlderMessages?: boolean;
  /** True when the loaded window provably starts at the channel's beginning. */
  historyExhausted?: boolean;
  isFetchingOlder?: boolean;
  isSinglePanelView?: boolean;
  isSending: boolean;
  /** Terminal channel-history failure. Cached messages remain visible when present. */
  isTimelineError?: boolean;
  isTimelineLoading: boolean;
  onRetryTimeline?: () => void;
  messages: TimelineMessage[];
  threadSummaries?: ReadonlyMap<string, ChannelWindowThreadSummary>;
  firstUnreadMessageId?: string | null;
  unreadCount?: number;
  canResetThreadPanelWidth: boolean;
  onCancelThreadReply: () => void;
  onCloseProfilePanel: () => void;
  onCloseThread: () => void;
  onMarkUnread?: (message: TimelineMessage) => void;
  onMarkRead?: (message: TimelineMessage) => void;
  onExpandThreadReplies: (message: TimelineMessage) => void;
  onOpenThread: (message: TimelineMessage) => void;
  onResetThreadPanelWidth: () => void;
  onSelectThreadReplyTarget: (message: TimelineMessage) => void;
  onSendMessage: (
    content: string,
    mentionPubkeys: string[],
    mediaTags?: string[][],
    channelId?: string | null,
    threadContext?: {
      parentEventId: string | null;
      threadHeadId: string | null;
    } | null,
    forceRest?: boolean,
  ) => Promise<void>;
  onSendToChannel: (
    message: TimelineMessage,
    threadRoot: TimelineMessage,
    channelId: string,
  ) => Promise<void>;
  onSendVideoReviewComment?: (
    message: TimelineMessage,
    content: string,
    mentionPubkeys: string[],
    mediaTags?: string[][],
    parentEventId?: string,
  ) => Promise<void>;
  onSendThreadReply: (
    content: string,
    mentionPubkeys: string[],
    mediaTags?: string[][],
    channelId?: string | null,
    threadContext?: {
      parentEventId: string | null;
      threadHeadId: string | null;
    } | null,
  ) => Promise<void>;
  onTargetReached?: (messageId: string) => void;
  onThreadScrollTargetResolved: () => void;
  onThreadPanelResizeStart: (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => void;
  profiles?: UserProfileLookup;
  openThreadHeadId: string | null;
  shouldShowThreadSkeleton: boolean;
  profilePanelPubkey?: string | null;
  threadHeadMessage: TimelineMessage | null;
  threadAllMessages: TimelineMessage[];
  threadMessages: MainTimelineEntry[];
  threadMessagesPending?: boolean;
  threadMessagesError?: boolean;
  onRetryThreadReplies?: () => void;
  threadPanelWidthPx: number;
  threadReplyTargetMessage: TimelineMessage | null;
  threadScrollTargetId: string | null;
  threadUnreadCounts?: ReadonlyMap<string, number>;
  threadReplyUnreadCounts?: ReadonlyMap<string, number>;
  threadFirstUnreadReplyId?: string | null;
  targetMessageId: string | null;
  /** Exact clicked result id, including a reply routed into the thread panel. */
  targetSearchMessageId?: string | null;
  /** Search text to highlight within the clicked result. */
  targetSearchQuery?: string;
  isFollowingThread?: boolean;
  onFollowThread?: () => void;
  onUnfollowThread?: () => void;
  followThreadById?: (rootId: string) => void;
  unfollowThreadById?: (rootId: string) => void;
  isFollowingThreadById?: (rootId: string) => boolean;
  isMessageUnreadById?: (messageId: string) => boolean;
};
