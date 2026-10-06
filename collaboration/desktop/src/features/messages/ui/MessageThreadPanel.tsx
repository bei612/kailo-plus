import { ThreadPanelSurface } from "@client-kit/platform/react/thread";
import type { MainTimelineEntry } from "@/features/messages/lib/threadPanel";
import type { TimelineMessage } from "@/features/messages/types";
import type { VideoReviewPresentation } from "@/features/messages/lib/videoReviewContext";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import type { ThreadPanelLayoutProps } from "@/features/channels/lib/threadPanelLayout";
import { handleTimelineMentionCopy } from "@/features/messages/lib/timelineMentionCopy";
import { VideoReviewNavigationProvider } from "@/shared/ui/VideoReviewNavigation";
import { MessageComposer } from "./MessageComposer";
import { MessageThreadRow } from "./MessageThreadRow";
import { useStableSendToChannel } from "./useStableSendToChannel";

type MessageThreadPanelProps = ThreadPanelLayoutProps & {
  channelId: string | null;
  channelName: string;
  currentPubkey?: string;
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
  onSend: (
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
  onSendToChannel?: (
    message: TimelineMessage,
    threadRoot: TimelineMessage,
    channelId: string,
  ) => Promise<void>;
  profiles?: UserProfileLookup;
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
  videoReviewPresentation?: VideoReviewPresentation;
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


export function MessageThreadPanel(props: MessageThreadPanelProps) {
  const stableSendToChannel = useStableSendToChannel(props.channelId, props.threadHead, props.onSendToChannel);
  return <VideoReviewNavigationProvider>
    <ThreadPanelSurface {...props} onCopy={handleTimelineMentionCopy}
      renderRow={(row) => <MessageThreadRow {...row}
        channelId={props.channelId} currentPubkey={props.currentPubkey} profiles={props.profiles}
        isFollowingThread={row.message.id === props.threadHead?.id ? props.isFollowingThread : undefined}
        onFollowThread={row.message.id === props.threadHead?.id && props.onFollowThread ? () => props.onFollowThread?.() : undefined}
        onUnfollowThread={row.message.id === props.threadHead?.id && props.onUnfollowThread ? () => props.onUnfollowThread?.() : undefined}
        onMarkRead={props.onMarkRead} onMarkUnread={props.onMarkUnread}
        onSendToChannel={row.message.id !== props.threadHead?.id ? stableSendToChannel : undefined}
        videoReviewCommentRootId={props.videoReviewPresentation?.commentRootIdsByMessageId.get(row.message.id)}
        videoReviewContext={props.videoReviewPresentation?.contextsByMessageId.get(row.message.id)}
      />}
      renderComposer={(composer) => <MessageComposer {...composer} onSend={props.onSend} profiles={props.profiles} />}
    />
  </VideoReviewNavigationProvider>;
}
