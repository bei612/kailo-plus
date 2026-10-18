// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectPullRequestInlineComments.tsx::ProjectPullRequestInlineCommentThread.
// Same thread card, author/time row, rich content and the anchored composer with the optional
// "Request changes" secondary submit; copy comes from the shared catalog and the composer is the
// host's Forum composer (DD-118(5) line comments travel through the governed publication host).
import { FileCode2, MessageSquareText } from "lucide-react";
import type { WebMessageAttachment } from "@client-kit/contracts";
import { useUiT } from "../context";
import { resolveUserLabel, type UserProfileLookup } from "../messages/system/identity";
import { normalizePubkey } from "../conversations/pubkey";
import { ForumComposer } from "../pulse/host";
import { relativeTime } from "./lib/projectsViewHelpers";
import type { ProjectPullRequestComment, ProjectPullRequestCommentAnchor } from "./projectPullRequests.mjs";
import { ProjectRichContent } from "./ProjectRichContent";

export type ProjectInlineCommentSubmit = (content: string, mentions: string[], attachments?: WebMessageAttachment[],
  contentIncludesAttachments?: boolean, decision?: "request-changes") => Promise<unknown>;

function commentAuthor(pubkey: string, profiles: UserProfileLookup | undefined) {
  return resolveUserLabel({ pubkey: normalizePubkey(pubkey), profiles });
}

export function ProjectPullRequestInlineCommentThread({ activeAnchor, comments, canRequestChanges, isSending, onCancel, onSubmit, profiles }: {
  activeAnchor: ProjectPullRequestCommentAnchor | null;
  canRequestChanges: boolean;
  comments: ProjectPullRequestComment[];
  isSending: boolean;
  onCancel: () => void;
  onSubmit: ProjectInlineCommentSubmit;
  profiles?: UserProfileLookup;
}) {
  const t = useUiT();
  if (comments.length === 0 && !activeAnchor) return null;
  return (
    <div className="border-border/50 border-y bg-background px-3 py-2 font-sans" data-testid="project-inline-comment-thread">
      {comments.length > 0 ? (
        <div className="divide-y divide-border/50 rounded-lg border border-border/60 bg-card">
          {comments.map((comment) => (
            <article className="space-y-1.5 px-3 py-2.5" data-testid="project-inline-comment" key={comment.id}>
              <div className="flex min-w-0 items-center gap-2 text-xs">
                <MessageSquareText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{commentAuthor(comment.author, profiles)}</span>
                <span className="shrink-0 text-muted-foreground">{relativeTime(comment.createdAt)}</span>
              </div>
              <ProjectRichContent content={comment.content} tags={comment.tags} />
            </article>
          ))}
        </div>
      ) : null}
      {activeAnchor ? (
        <ForumComposer
          className="mt-2 border border-border/60 bg-background/70"
          disabled={isSending}
          header={
            <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <FileCode2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{activeAnchor.path}</span>
              <span className="shrink-0">{activeAnchor.side === "new" ? "+" : "-"}{activeAnchor.line}</span>
            </div>
          }
          isSending={isSending}
          onCancel={onCancel}
          onSecondarySubmit={canRequestChanges
            ? (content, mentions, attachments, contentIncludesAttachments) => onSubmit(content, mentions, attachments, contentIncludesAttachments, "request-changes")
            : undefined}
          onSubmit={(content, mentions, attachments, contentIncludesAttachments) => onSubmit(content, mentions, attachments, contentIncludesAttachments)}
          placeholder={t("projects.review.lineComment.placeholder")}
          profiles={profiles}
          secondarySubmitLabel={t("projects.review.requestChanges")}
        />
      ) : null}
    </div>
  );
}
