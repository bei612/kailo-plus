// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/MergePullRequestButton.tsx. Same confirmation, pending labels,
// toasts and conflict panel; copy comes from the shared catalog and the alert surface is the shared
// Radix one. DD-118: the merge runs through the owner's governed Projects Git host (`onMerge`), so
// the original client-signed "Publish merged status" step does not exist here (Core publishes the
// owner-signed 1631). An unconfirmed (UNKNOWN) merge is retained and the button then only re-checks
// that exact merge. "Resolve in Terminal" and its commands are Desktop-only and are not restored:
// the conflict panel keeps the original copy without the terminal action.
import * as Alert from "@radix-ui/react-alert-dialog";
import { AlertTriangle, GitMerge } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useUiT } from "../context";
import { MODAL_BACKDROP_BLUR_CLASS } from "../composer/shared/ui/modalBackdrop";
import { MODAL_CONTENT_MOTION_CLASS, MODAL_OVERLAY_MOTION_CLASS } from "../composer/shared/ui/modalMotion";
import { Button } from "../profile/buzz/shared/ui/button";
import { isProjectBranchOutcomeUnknown } from "./lib/projectBranchErrors";
import type { Repository as Project } from "./projectModels";
import type { ProjectPullRequest } from "./projectPullRequests.mjs";
import { parseProjectPullRequestMergeError, type ProjectPullRequestMergeOutcome } from "./pullRequestMutations";

export function MergePullRequestButton({
  onMerge,
  pending,
  project,
  pullRequest,
  recheck = false,
}: {
  /** Runs the governed merge (or resends the retained one); rejects with the typed failure. */
  onMerge: () => Promise<ProjectPullRequestMergeOutcome | null>;
  pending: boolean;
  project: Pick<Project, "defaultBranch">;
  pullRequest: ProjectPullRequest;
  /** An unconfirmed merge of this review is retained; only it can be re-checked. */
  recheck?: boolean;
}) {
  const t = useUiT();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [conflictState, setConflictState] = React.useState<{ pullRequestId: string; targetBranch: string } | null>(null);
  const targetBranch = pullRequest.targetBranch ?? project.defaultBranch;
  const conflictRecovery = conflictState?.pullRequestId === pullRequest.id ? conflictState : null;

  const handleMerge = React.useCallback(async () => {
    try {
      const result = await onMerge();
      if (!result) return;
      const message = t("projects.review.merge.merged", { source: result.sourceBranch, target: result.targetBranch });
      if (result.pullRequest) toast.success(message);
      else toast.warning(message, { description: t("projects.review.merge.statusPending") });
      setConflictState(null);
      setConfirmOpen(false);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (isProjectBranchOutcomeUnknown(error)) {
        setConfirmOpen(false);
        toast.message(t("projects.review.merge.unknown"));
        return;
      }
      const failure = parseProjectPullRequestMergeError(error);
      if (failure?.code === "merge_conflict") {
        setConflictState({ pullRequestId: pullRequest.id, targetBranch });
        setConfirmOpen(false);
      }
      toast.error(failure?.message ?? t("projects.review.merge.failed"));
    }
  }, [onMerge, pullRequest.id, t, targetBranch]);

  return (
    <div className="contents">
      <Alert.Root
        onOpenChange={(open) => {
          if (!pending) setConfirmOpen(open);
        }}
        open={confirmOpen}
      >
        <Button
          className="h-8 gap-1.5 px-3.5"
          data-testid="merge-pull-request-button"
          disabled={pending}
          onClick={() => {
            if (recheck) {
              void handleMerge();
            } else {
              setConfirmOpen(true);
            }
          }}
          size="xs"
          type="button"
        >
          <GitMerge className="h-3.5 w-3.5" />
          {recheck ? (pending ? t("projects.review.merge.merging") : t("projects.review.merge.recheck")) : t("projects.review.merge.merge")}
        </Button>
        <Alert.Portal>
          <Alert.Overlay className={`fixed inset-0 z-50 bg-black/60 ${MODAL_OVERLAY_MOTION_CLASS} ${MODAL_BACKDROP_BLUR_CLASS}`} />
          <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
            <Alert.Content
              className={`pointer-events-auto grid w-[calc(100vw-2rem)] max-w-md gap-4 outline-hidden rounded-3xl bg-background p-6 shadow-2xl ${MODAL_CONTENT_MOTION_CLASS}`}
              data-testid="merge-pull-request-confirm"
            >
              <div className="flex flex-col space-y-2 text-left">
                <Alert.Title className="text-xl font-semibold tracking-tight">{t("projects.review.merge.confirmTitle")}</Alert.Title>
                <Alert.Description className="text-sm text-muted-foreground">
                  {t("projects.review.merge.confirmDescription", { source: pullRequest.branchName ?? "", target: targetBranch })}
                </Alert.Description>
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Alert.Cancel asChild>
                  <Button disabled={pending} type="button" variant="outline">
                    {t("platform.cancel")}
                  </Button>
                </Alert.Cancel>
                <Button
                  data-testid="merge-pull-request-confirm-button"
                  disabled={pending}
                  onClick={(event) => {
                    event.preventDefault();
                    void handleMerge();
                  }}
                  type="button"
                >
                  {pending ? t("projects.review.merge.merging") : t("projects.review.merge.submit")}
                </Button>
              </div>
            </Alert.Content>
          </div>
        </Alert.Portal>
      </Alert.Root>
      {conflictRecovery ? (
        <div
          className="w-full basis-full space-y-2 rounded-lg border border-amber-500/35 bg-amber-500/10 p-3"
          data-testid="merge-conflict-recovery"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{t("projects.review.merge.conflictTitle")}</p>
              <p className="text-xs text-muted-foreground">
                {t("projects.review.merge.conflictDescription", { target: conflictRecovery.targetBranch })}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
