// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/PullRequestReviewCard.tsx: Approve (with the original optional
// summary dialog) for a requested reviewer or the repository owner, the lifecycle actions (ready/
// reopen, convert to draft, close) and, in the original place, MergePullRequestButton when the host
// can merge and the viewer's own pubkey is the repository coordinate owner (DD-118). The approval is
// the original labeled kind-1 comment published through the governed host (DD-118(5)); an
// unconfirmed approval is retained and the button then only re-checks it.
import { Check, GitPullRequest, GitPullRequestDraft, MoreHorizontal, RotateCcw, X } from "lucide-react";
import * as React from "react";
import { Button } from "../profile/buzz/shared/ui/button";
import { Textarea } from "../profile/buzz/shared/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../composer/shared/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../sidebar/dropdown-menu";
import { useUiT } from "../context";
import type { ProjectPullRequest } from "./projectPullRequests.mjs";
import type { Repository } from "./projectModels";
import { MergePullRequestButton } from "./MergePullRequestButton";
import { canMergeProjectPullRequest, type ProjectPullRequestMergeOutcome } from "./pullRequestMutations";
import { canChangeProjectPullRequestStatus, type ProjectPullRequestLifecycle } from "./pullRequestStatus";

/** The host's merge capability for this review; absent when the host cannot merge. */
export type PullRequestMergeAction = {
  onMerge: () => Promise<ProjectPullRequestMergeOutcome | null>;
  /** A retained unconfirmed merge of this review; only that exact merge may be resent. */
  recheck: boolean;
};

/** The viewer's original review decision; absent when the host cannot publish. */
export type PullRequestApprovalAction = {
  /** Original canApprove: canReviewProjectPullRequest and no current approval by the viewer. */
  canApprove: boolean;
  /** A retained unconfirmed approval; only it may be re-checked, with the same summary. */
  recheck: boolean;
  /** Resolves true once the approval is confirmed (the dialog then closes and clears). */
  onApprove: (summary: string) => Promise<boolean>;
};

export function PullRequestReviewCard({ repository, pullRequest, viewer, pending, recoveryStatus, onStatusChange, merge, approval }: {
  repository: Pick<Repository, "owner" | "repoAddress" | "defaultBranch">;
  pullRequest: ProjectPullRequest;
  viewer: string | null | undefined;
  pending: boolean;
  /** A retained unconfirmed lifecycle intent; only that exact intent may be resent. */
  recoveryStatus?: ProjectPullRequestLifecycle;
  onStatusChange: (status: ProjectPullRequestLifecycle) => void;
  merge?: PullRequestMergeAction;
  approval?: PullRequestApprovalAction;
}) {
  const t = useUiT();
  const [approveDialogOpen, setApproveDialogOpen] = React.useState(false);
  const [approvalSummary, setApprovalSummary] = React.useState("");
  const canChangeStatus = canChangeProjectPullRequestStatus(repository, pullRequest, viewer);
  const canMerge = Boolean(merge) && (merge!.recheck || canMergeProjectPullRequest(repository, pullRequest, viewer));
  const mergeButton = canMerge ? <MergePullRequestButton onMerge={merge!.onMerge} pending={pending} project={repository}
    pullRequest={pullRequest} recheck={merge!.recheck}/> : null;
  const approveButton = approval && (approval.canApprove || approval.recheck) ? (
    <Button className="h-8 gap-1.5 bg-green-600 px-3.5 text-white shadow-sm hover:bg-green-700" disabled={pending}
      onClick={() => setApproveDialogOpen(true)} size="xs" type="button">
      <Check className="h-3.5 w-3.5" />
      {approval.recheck ? t("projects.review.approve.recheck") : t("projects.review.approve.action")}
    </Button>
  ) : null;
  const handleApprove = async () => {
    if (!approval || pending) return;
    if (await approval.onApprove(approvalSummary)) {
      setApproveDialogOpen(false);
      setApprovalSummary("");
    }
  };
  const approveDialog = approval ? (
    <Dialog
      onOpenChange={(open) => {
        if (!open && pending) return;
        setApproveDialogOpen(open);
        if (!open) setApprovalSummary("");
      }}
      open={approveDialogOpen}
    >
      <DialogContent className="max-w-md" data-testid="project-pull-request-approve-dialog">
        <DialogHeader>
          <DialogTitle>{t("projects.review.approve.title")}</DialogTitle>
          <DialogDescription>{t("projects.review.approve.description")}</DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label={t("projects.review.approve.summaryLabel")}
          disabled={pending}
          onChange={(event) => setApprovalSummary(event.target.value)}
          placeholder={t("projects.review.approve.summaryPlaceholder")}
          value={approvalSummary}
        />
        <DialogFooter>
          <Button disabled={pending} onClick={() => setApproveDialogOpen(false)} type="button" variant="ghost">
            {t("platform.cancel")}
          </Button>
          <Button className="bg-green-600 text-white hover:bg-green-700" disabled={pending} onClick={() => { void handleApprove(); }} type="button">
            <Check className="h-4 w-4" />
            {t("projects.review.approve.action")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  let actions: React.ReactNode = null;
  if (!canChangeStatus) {
    actions = approveButton || mergeButton ? <>{approveButton}{mergeButton}</> : null;
  } else if (recoveryStatus) {
    actions = <>
      {approveButton}
      <Button className="h-8 gap-1.5 px-3" disabled={pending} onClick={() => onStatusChange(recoveryStatus)} size="xs" type="button" variant="secondary">
        <RotateCcw className="h-3.5 w-3.5" />
        {t("projects.review.status.recheck")}
      </Button>
      {merge?.recheck ? mergeButton : null}
    </>;
  } else {
    const canMarkReady = pullRequest.status === "Draft";
    const canConvertToDraft = pullRequest.status === "Open";
    const canClose = pullRequest.status === "Open" || pullRequest.status === "Draft";
    const canReopen = pullRequest.status === "Closed";
    const hasOverflowAction = canConvertToDraft || canClose;
    if (approveButton || mergeButton || canMarkReady || canConvertToDraft || canClose || canReopen) actions = <>
      {approveButton}
      {mergeButton}
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
    </>;
  }
  return <>
    {actions ? <ReviewActionTimeline>{actions}</ReviewActionTimeline> : null}
    {approveDialog}
  </>;
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
