// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/PullRequestReviewCard.tsx: the lifecycle
// actions (ready/reopen, convert to draft, close). Approve and merge are not
// restored here: merge runs through git and review decisions stay pending.
import { GitPullRequest, GitPullRequestDraft, MoreHorizontal, RotateCcw, X } from "lucide-react";
import * as React from "react";
import { Button } from "../profile/buzz/shared/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../sidebar/dropdown-menu";
import { useUiT } from "../context";
import type { ProjectPullRequest } from "./projectPullRequests.mjs";
import type { Repository } from "./projectModels";
import { canChangeProjectPullRequestStatus, type ProjectPullRequestLifecycle } from "./pullRequestStatus";

export function PullRequestReviewCard({ repository, pullRequest, viewer, pending, recoveryStatus, onStatusChange }: {
  repository: Pick<Repository, "owner">;
  pullRequest: ProjectPullRequest;
  viewer: string | null | undefined;
  pending: boolean;
  /** A retained unconfirmed lifecycle intent; only that exact intent may be resent. */
  recoveryStatus?: ProjectPullRequestLifecycle;
  onStatusChange: (status: ProjectPullRequestLifecycle) => void;
}) {
  const t = useUiT();
  const canChangeStatus = canChangeProjectPullRequestStatus(repository, pullRequest, viewer);
  if (!canChangeStatus) return null;
  if (recoveryStatus) {
    return <ReviewActionTimeline>
      <Button className="h-8 gap-1.5 px-3" disabled={pending} onClick={() => onStatusChange(recoveryStatus)} size="xs" type="button" variant="secondary">
        <RotateCcw className="h-3.5 w-3.5" />
        {t("projects.review.status.recheck")}
      </Button>
    </ReviewActionTimeline>;
  }
  const canMarkReady = pullRequest.status === "Draft";
  const canConvertToDraft = pullRequest.status === "Open";
  const canClose = pullRequest.status === "Open" || pullRequest.status === "Draft";
  const canReopen = pullRequest.status === "Closed";
  const hasOverflowAction = canConvertToDraft || canClose;
  if (!canMarkReady && !canConvertToDraft && !canClose && !canReopen) return null;
  return <ReviewActionTimeline>
    {canMarkReady ? (
      <Button className="h-8 gap-1.5 px-3" disabled={pending} onClick={() => onStatusChange("open")} size="xs" type="button" variant="secondary">
        <GitPullRequest className="h-3.5 w-3.5" />
        {t("projects.review.status.ready")}
      </Button>
    ) : null}
    {canReopen ? (
      <Button className="h-8 gap-1.5 px-3" disabled={pending} onClick={() => onStatusChange("open")} size="xs" type="button" variant="secondary">
        <RotateCcw className="h-3.5 w-3.5" />
        {t("projects.review.status.reopen")}
      </Button>
    ) : null}
    {hasOverflowAction ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label={t("projects.review.status.more")} className="ml-auto h-8 w-8" disabled={pending} size="icon-xs" type="button" variant="ghost">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canConvertToDraft ? (
            <DropdownMenuItem onSelect={() => onStatusChange("draft")}>
              <GitPullRequestDraft className="h-4 w-4" />
              {t("projects.review.status.draft")}
            </DropdownMenuItem>
          ) : null}
          {canClose ? (
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onStatusChange("closed")}>
              <X className="h-4 w-4" />
              {t("projects.review.status.close")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null}
  </ReviewActionTimeline>;
}

function ReviewActionTimeline({ children }: { children: React.ReactNode }) {
  return <div className="pull-request-action-timeline flex min-w-0 flex-1 items-start gap-2">
    <span aria-hidden="true" className="mt-3.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground ring-1 ring-border/70">
      <GitPullRequest className="h-3 w-3" />
    </span>
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-start gap-2 rounded-lg border border-border/60 bg-muted/15 p-2"
      data-testid="project-pull-request-actions">
      {children}
    </div>
  </div>;
}
