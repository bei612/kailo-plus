// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/home/ui/InboxDetailPane.tsx message-list consumer.
// Hosts supply admitted messages and commands, never a second read/write authority.
import * as React from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { useUiT } from "./context";
import { Button } from "./profile/buzz/shared/ui/button";
import { useInboxFocusHighlight } from "./inbox-surface";
import { hasSameMessageAuthor, isWithinGroupingWindow, startsNewMessageGroup } from "./messages/messageGrouping";
import type { TimelineMessage } from "./messages/types";
import { useAnchoredScroll } from "./messages/thread/useAnchoredScroll";
import { useComposerHeightPadding } from "./messages/thread/useComposerHeightPadding";

export type InboxDetailMessagePresentation = {
  isContinuation: boolean;
  isFirst: boolean;
  isFocusHighlightVisible: boolean;
  showUnreadBoundary: boolean;
  onReply?: (message: TimelineMessage) => void;
  onEdit?: (message: TimelineMessage) => void;
  onDelete?: (message: TimelineMessage) => void;
};

export function InboxDetailMessages({
  conversationId, selectedEventId, messages, unreadBoundaryEventId,
  loading = false, contextError = false, unavailable = false, onRetry,
  interrupted = false, pending = false, unknown = false, sending = false,
  unresolvedDeleteId, canReply, canManageMessage, onReply, onEdit, onDelete,
  pagination, composerOverlayRef, onCopy, renderMessage,
}: {
  conversationId: string | null;
  selectedEventId: string | null;
  messages: TimelineMessage[];
  unreadBoundaryEventId?: string | null;
  loading?: boolean;
  contextError?: boolean;
  unavailable?: boolean;
  onRetry?: () => void;
  interrupted?: boolean;
  pending?: boolean;
  unknown?: boolean;
  sending?: boolean;
  unresolvedDeleteId?: string | null;
  canReply: boolean;
  canManageMessage: (message: TimelineMessage) => boolean;
  onReply: (message: TimelineMessage) => void;
  onEdit: (message: TimelineMessage) => void;
  onDelete: (message: TimelineMessage) => void;
  /** Present only while the host's original cursor read remains admitted. */
  pagination?: { hasMore: boolean; pending: boolean; load: () => void };
  composerOverlayRef?: React.RefObject<HTMLDivElement | null>;
  onCopy?: React.ClipboardEventHandler<HTMLDivElement>;
  renderMessage: (message: TimelineMessage, presentation: InboxDetailMessagePresentation, index: number) => React.ReactNode;
}) {
  const t = useUiT();
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const noOverlay = React.useRef<HTMLDivElement | null>(null);
  const isFocusHighlightVisible = useInboxFocusHighlight(conversationId);
  const visibleMessages = unavailable ? [] : messages;
  const { onScroll } = useAnchoredScroll({
    channelId: conversationId, contentRef, scrollContainerRef,
    messages: visibleMessages, isLoading: loading || unavailable,
    targetMessageId: selectedEventId, pinTargetCentered: true,
  });
  useComposerHeightPadding(scrollContainerRef, composerOverlayRef ?? noOverlay, conversationId);
  // A cold anchor can be outside the admitted first page. Fetch through the
  // host's original cursor consumer; an error/revocation never becomes empty success.
  React.useEffect(() => {
    if (!interrupted && !loading && selectedEventId &&
        !messages.some(message => message.id === selectedEventId) &&
        pagination?.hasMore && !pagination.pending) pagination.load();
  }, [unavailable, interrupted, loading, selectedEventId, messages, pagination]);
  const locked = unavailable || interrupted || contextError || loading || pending || unknown;
  return <div ref={scrollContainerRef} onScroll={onScroll} onCopy={onCopy}
    aria-busy={loading} data-testid="home-inbox-detail-scroll"
    className={`-mt-13 min-h-0 flex-1 overflow-y-auto overscroll-contain pt-13 [overflow-anchor:none]${composerOverlayRef ? " pb-32" : ""}`}>
    <div ref={contentRef}>
      {unavailable ? <div role="status" className="p-5">{t("platform.loadFailed")}{onRetry ? <Button onClick={onRetry}>{t("platform.refresh")}</Button> : null}</div> : <>
        {loading && messages.length <= 1 ? <div className="mx-4 mb-2 flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground" data-testid="home-inbox-context-loading" role="status">
          <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" /><span>{t("inbox.contextLoading")}</span>
        </div> : null}
        {contextError ? <div className="mx-4 mb-2 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="home-inbox-context-error" role="status">
          <AlertCircle className="h-4 w-4 shrink-0" /><span>{t("inbox.contextUnavailable")}</span>
        </div> : null}
        {messages.map((message, index) => {
          const showUnreadBoundary = message.id === unreadBoundaryEventId;
          const previous = messages[index - 1];
          const isContinuation = index !== 1 && !showUnreadBoundary && !startsNewMessageGroup(message)
            && hasSameMessageAuthor(previous, message) && isWithinGroupingWindow(previous?.createdAt, message.createdAt);
          const mutable = !locked && !sending && canManageMessage(message);
          return <React.Fragment key={message.id}>{renderMessage(message, {
            isContinuation, isFirst: index === 0, isFocusHighlightVisible, showUnreadBoundary,
            onReply: !locked && !sending && !unresolvedDeleteId && canReply ? onReply : undefined,
            onEdit: mutable && !unresolvedDeleteId ? onEdit : undefined,
            // An unresolved delete may only reopen/reconcile its original target.
            onDelete: mutable && (!unresolvedDeleteId || unresolvedDeleteId === message.id) ? onDelete : undefined,
          }, index)}</React.Fragment>;
        })}
        {pagination?.hasMore ? <Button disabled={pagination.pending || interrupted} onClick={pagination.load}>{t("forum.more")}</Button> : null}
      </>}
    </div>
  </div>;
}
