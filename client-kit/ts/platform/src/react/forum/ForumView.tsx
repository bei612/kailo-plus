// Original ForumView, ForumPostCard and ForumThreadPanel presentation from
// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/forum/ui/.
// Hosts own authenticated reads/publication and supply existing profile/Markdown/composer controls.
import * as React from "react";
import { ArrowLeft, MessageSquare, MessageSquareText } from "lucide-react";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Button } from "../profile/buzz/shared/ui/button";
import { VirtualizedList } from "./VirtualizedList";
import { useT } from "../context";

/** Original Buzz forum UI projection, derived from verified Relay events, never persisted here. */
export type ForumMessage = {
  eventId: string;
  pubkey: string;
  content: string;
  createdAt: number;
  tags: string[][];
  threadSummary?: { replyCount: number; lastReplyAt: number | null } | null;
};

export type ForumLabels = {
  back: string; start: string; archived: string; join: string; empty: string;
  emptyHint: string; noReplies: string; more: string; retry: string;
  replies: (count: number) => string;
};

export function useForumLabels(): ForumLabels & { postPlaceholder: string; replyPlaceholder: string; cancel: string } {
  const t = useT();
  return { back: t("forum.back"), start: t("forum.start"), archived: t("forum.archived"), join: t("forum.join"),
    empty: t("forum.empty"), emptyHint: t("forum.emptyHint"), noReplies: t("forum.noReplies"), more: t("forum.more"), retry: t("forum.retry"),
    replies: (count) => t(count === 1 ? "forum.replyOne" : "forum.replyMany", { count }),
    postPlaceholder: t("forum.postPlaceholder"), replyPlaceholder: t("forum.replyPlaceholder"), cancel: t("forum.cancel") };
}
export type ForumViewProps = {
  channelId: string;
  isMember: boolean;
  archived: boolean;
  posts: ForumMessage[];
  post?: ForumMessage;
  replies: ForumMessage[];
  selectedPostId: string | null;
  loading: boolean;
  error?: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
  onRetry: () => void;
  onSelectPost: (id: string | null) => void;
  targetEventId?: string | null;
  onTargetReached?: (id: string) => void;
  onCopy?: React.ClipboardEventHandler<HTMLDivElement>;
  labels: ForumLabels;
  formatTime: (createdAt: number) => string;
  renderAuthor: (message: ForumMessage, large: boolean) => React.ReactNode;
  renderContent: (message: ForumMessage, preview: boolean) => React.ReactNode;
  renderComposer: (postId: string | null, close: () => void) => React.ReactNode;
  renderDelete?: (message: ForumMessage, reply: boolean) => React.ReactNode;
};

function Skeleton({ className }: { className: string }) {
  return <div aria-hidden="true" className={cn("t-skel-bar rounded-md bg-primary/10 is-pulsing", className)} />;
}

export function ForumView(props: ForumViewProps) {
  // Each channel visit has its own composer/scroll ownership.
  return <ForumVisit key={props.channelId} {...props} />;
}

function ForumVisit({ channelId, isMember, archived, posts, post, replies, selectedPostId,
  loading, error, hasMore, loadingMore, onMore, onRetry, onSelectPost, targetEventId,
  onTargetReached, onCopy, labels, formatTime, renderAuthor, renderContent,
  renderComposer, renderDelete }: ForumViewProps) {
  const [composerOpen, setComposerOpen] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!targetEventId || !post) return;
    const target = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>("[data-forum-event-id]") ?? [])
      .find((element) => element.dataset.forumEventId === targetEventId);
    if (target) { target.scrollIntoView({ block: "center" }); onTargetReached?.(targetEventId); }
  }, [post, replies, targetEventId, onTargetReached]);
  const more = hasMore ? <div className="p-4 text-center"><Button type="button" variant="ghost"
    disabled={loadingMore} onClick={onMore}>{labels.more}</Button></div> : null;
  const failure = error ? <div role="alert" className="p-4 text-sm text-destructive">
    <p>{error}</p><Button type="button" variant="ghost" onClick={onRetry}>{labels.retry}</Button>
  </div> : null;

  if (selectedPostId) return <div className="flex h-full flex-col pt-(--buzz-channel-content-top-padding,5.75rem)">
    <div className="border-b border-border/60 px-4 py-3">
      <Button className="gap-1.5 text-muted-foreground" onClick={() => onSelectPost(null)} size="sm" variant="ghost">
        <ArrowLeft className="h-4 w-4" />{labels.back}
      </Button>
    </div>
    {failure}
    {loading && !post ? <div className="flex-1 space-y-4 p-4">
      <Skeleton className="h-8 w-3/4" /><Skeleton className="h-24 w-full" /><Skeleton className="h-16 w-full" />
    </div> : post && !error ? <>
      <div className="flex-1 overflow-y-auto" data-scroll-restoration-id={`forum-thread:${channelId}`}
        onCopy={onCopy} ref={scrollRef}>
        <div className="group border-b border-border/60 p-4" data-forum-event-id={post.eventId}>
          <div className="flex items-center gap-2">{renderAuthor(post, true)}
            <span className="text-xs text-muted-foreground">{formatTime(post.createdAt)}</span>{renderDelete?.(post, false)}
          </div>
          <div className="mt-3">{renderContent(post, false)}</div>
        </div>
        <div className="flex items-center gap-1.5 border-b border-border/60 px-4 py-2.5 text-sm font-medium text-muted-foreground">
          <MessageSquare className="h-4 w-4" />{labels.replies(replies.length)}
        </div>
        <div className="divide-y divide-border/40">
          {replies.map((reply) => <div className="group content-visibility-auto px-4 py-3" key={reply.eventId}
            data-forum-event-id={reply.eventId}>
            <div className="flex items-center gap-2">{renderAuthor(reply, false)}
              <span className="text-xs text-muted-foreground">{formatTime(reply.createdAt)}</span>{renderDelete?.(reply, true)}
            </div>
            <div className="mt-1.5 pl-8">{renderContent(reply, false)}</div>
          </div>)}
          {!replies.length && !error ? <div className="px-4 py-6 text-center text-sm text-muted-foreground">{labels.noReplies}</div> : null}
        </div>{more}
      </div>
      {isMember && !archived ? <div className="border-t border-border/60 p-4">
        {renderComposer(selectedPostId, () => {})}
      </div> : null}
    </> : null}
  </div>;

  return <div className="flex h-full flex-col pt-(--buzz-channel-content-top-padding,5.75rem)">
    <div className="border-b border-border/60 p-4">
      {composerOpen && isMember && !archived && !error ? renderComposer(null, () => setComposerOpen(false)) :
        <button className="w-full rounded-xl border border-dashed border-border/80 px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:border-border hover:bg-accent/30 hover:text-foreground"
          disabled={!isMember || archived || Boolean(error)} onClick={() => setComposerOpen(true)} type="button">
          {archived ? labels.archived : !isMember ? labels.join : labels.start}
        </button>}
    </div>
    {failure}
    <div className="flex-1 overflow-y-auto" data-scroll-restoration-id={`forum-list:${channelId}`} onCopy={onCopy} ref={scrollRef}>
      {error ? null : loading && !posts.length ? <div className="space-y-3 p-4">
        <Skeleton className="h-24 w-full rounded-xl" /><Skeleton className="h-24 w-full rounded-xl" /><Skeleton className="h-24 w-full rounded-xl" />
      </div> : !posts.length && !error ? <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
        <MessageSquareText className="h-10 w-10 text-muted-foreground/40" /><div>
          <p className="text-sm font-medium text-foreground/70">{labels.empty}</p>
          <p className="mt-1 text-xs text-muted-foreground">{labels.emptyHint}</p>
        </div>
      </div> : <VirtualizedList estimateSize={120} getItemKey={(item) => item.eventId} innerClassName="p-4" items={posts}
        renderItem={(item) => <div className="pb-3">
          {/* Original card contains interactive author/file controls, so it is not a nested button. */}
          <div role="button" tabIndex={0} className="group w-full cursor-pointer rounded-xl border border-border/60 bg-card p-4 text-left transition-colors hover:border-border hover:bg-accent/40"
            onClick={() => onSelectPost(item.eventId)} onKeyDown={(event) => {
              if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault(); onSelectPost(item.eventId);
              }
            }}>
            <div className="flex items-center gap-2">
              <div role="presentation" onClick={(event) => event.stopPropagation()}>{renderAuthor(item, false)}</div>
              <span className="text-xs text-muted-foreground">{formatTime(item.createdAt)}</span>
              <div className="ml-auto" role="presentation" onClick={(event) => event.stopPropagation()}>{renderDelete?.(item, false)}</div>
            </div>
            <div className="mt-2">{renderContent(item, true)}</div>
            {item.threadSummary && item.threadSummary.replyCount > 0 ?
              <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <MessageSquare className="h-4 w-4" /><span>{labels.replies(item.threadSummary.replyCount)}</span>
                {item.threadSummary.lastReplyAt ? <><span className="text-muted-foreground/50">·</span>
                  <span>{formatTime(item.threadSummary.lastReplyAt)}</span></> : null}
              </div> : null}
          </div>
        </div>} scrollRef={scrollRef} />}{more}
    </div>
  </div>;
}
