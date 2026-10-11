// Original read-only decision actors from Buzz 779af8886caae1317b4de962082429867ab61503 PullRequestReviewersRow.tsx.
import * as React from "react";
import {Check,History,TriangleAlert,Users} from "lucide-react";
import {cn} from "../profile/buzz/shared/lib/cn";
import {normalizePubkey} from "../conversations/pubkey";
import {resolveUserLabel,type UserProfileLookup} from "../messages/system/identity";
import type {ProjectPullRequest} from "./projectPullRequests.mjs";
import {ProjectDetailMetaRow} from "./ProjectDetailMeta";
import {translateCurrent as t} from "../../i18n";
function labelForPubkey(pubkey:string,profiles?:UserProfileLookup){return resolveUserLabel({pubkey,profiles});}
export function PullRequestReviewersRow({profiles,pullRequest}:{profiles?:UserProfileLookup;pullRequest:ProjectPullRequest}){
  const approvedBy = new Set(
    pullRequest.approvals.map((approval) => normalizePubkey(approval.author)),
  );
  const changesRequestedBy = new Set(
    pullRequest.changeRequests.map((request) =>
      normalizePubkey(request.author),
    ),
  );
  const historicalBy = new Set(
    pullRequest.comments
      .filter(
        (comment) =>
          comment.isTrustedReviewDecision &&
          comment.reviewDecisionStatus === "historical",
      )
      .map((comment) => normalizePubkey(comment.author)),
  );
  const decisionActors = [
    ...new Set([
      ...pullRequest.reviewers.map(normalizePubkey),
      ...pullRequest.approvals.map((approval) =>
        normalizePubkey(approval.author),
      ),
      ...pullRequest.changeRequests.map((request) =>
        normalizePubkey(request.author),
      ),
      ...historicalBy,
    ]),
  ];
  const requestedApprovalCount = pullRequest.reviewers.filter((pubkey) =>
    approvedBy.has(normalizePubkey(pubkey)),
  ).length;
  const staleDecisionActors = new Set(
    pullRequest.commit
      ? [...historicalBy].filter(
          (pubkey) =>
            !approvedBy.has(pubkey) && !changesRequestedBy.has(pubkey),
        )
      : [],
  );
  const hasHistoricalDecision = staleDecisionActors.size > 0;
  const reviewSummary = !pullRequest.commit
    ? t("projects.review.noCommit")
    : changesRequestedBy.size > 0
      ? t("projects.review.changesSummary")
      : pullRequest.reviewers.length > 0 &&
          requestedApprovalCount === pullRequest.reviewers.length
        ? t("projects.review.approvedSummary")
        : pullRequest.reviewers.length === 0 && approvedBy.size > 0
          ? t("projects.review.approvedSummary")
          : hasHistoricalDecision &&
              approvedBy.size === 0 &&
              changesRequestedBy.size === 0
            ? t("projects.review.rereviewSummary")
            : requestedApprovalCount > 0
              ? t("projects.review.approvalSummary",{count:requestedApprovalCount,total:pullRequest.reviewers.length})
              : pullRequest.reviewers.length > 0
                ? t("projects.review.awaiting")
                : t("projects.review.noReviewers");

  const displayedDecisionActors=decisionActors;
  return (
    <ProjectDetailMetaRow icon={Users} label={t("projects.workItem.reviewers")}>
      <div
        className="flex min-w-0 items-center gap-2"
        data-testid="project-reviewers-content"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap">
          {displayedDecisionActors.length === 0 ? (
            <span className="truncate font-medium" data-testid="project-review-summary">
              {reviewSummary}
            </span>
          ) : null}
          {displayedDecisionActors.map((pubkey, index) => {
            const label = labelForPubkey(pubkey, profiles);
            const hasApproved = approvedBy.has(pubkey);
            const hasRequestedChanges = changesRequestedBy.has(pubkey);
            const needsRereview = staleDecisionActors.has(pubkey);
            const DecisionIcon = hasApproved
              ? Check
              : hasRequestedChanges
                ? TriangleAlert
                : needsRereview
                  ? History
                  : null;
            const decisionLabel = hasApproved
              ? t("projects.review.approvedBy",{name:label})
              : hasRequestedChanges
                ? t("projects.review.changesBy",{name:label})
                : needsRereview
                  ? t("projects.review.rereviewBy",{name:label})
                  : t("projects.review.awaitingBy",{name:label});
            return (
              <React.Fragment key={pubkey}>
                {index > 0 ? (
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-muted-foreground/50"
                  >
                    ·
                  </span>
                ) : null}
                <span
                  className={cn(
                    "flex min-w-0 shrink items-center gap-1 text-sm",
                    hasApproved && "text-green-600 dark:text-green-400",
                    hasRequestedChanges && "text-amber-600 dark:text-amber-400",
                    !hasApproved &&
                      !hasRequestedChanges &&
                      "text-muted-foreground",
                  )}
                  data-testid="project-reviewer-decision"
                  title={decisionLabel}
                >
                  <span className="sr-only">{decisionLabel}</span>
                  {DecisionIcon ? (
                    <DecisionIcon
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0"
                    />
                  ) : null}
                  <span
                    aria-hidden="true"
                    className="truncate"
                    data-testid="project-reviewer-name"
                  >
                    {label}
                  </span>
                </span>
              </React.Fragment>
            );
          })}
          {hasHistoricalDecision ? (
            <span className="flex min-w-0 items-center gap-1 truncate text-xs text-amber-600 dark:text-amber-400">
              <History className="h-3.5 w-3.5 shrink-0" />
              {t("projects.review.earlierDecision")}
            </span>
          ) : null}
        </div>
      </div>
    </ProjectDetailMetaRow>
  );
}
