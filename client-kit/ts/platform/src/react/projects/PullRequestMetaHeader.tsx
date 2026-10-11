import {translateCurrent as t} from "../../i18n";
import { GitBranch, GitMerge, GitPullRequest, Tag } from "lucide-react";
import * as React from "react";

import type {ProjectPullRequest} from "./projectPullRequests.mjs";
import type {Repository as Project} from "./projectModels";
import type { UserProfileLookup } from "../messages/system/identity";
import { CopyCommitHashButton } from "./ProjectCommitCopyButton";
import {
  ProjectDetailMetaList,
  ProjectDetailMetaPills,
  ProjectDetailMetaRow,
} from "./ProjectDetailMeta";
import { PullRequestReviewersRow } from "./PullRequestReviewersRow";

const prStatusKey={Open:"projects.status.open",Merged:"projects.status.merged",Closed:"projects.status.closed",Draft:"projects.status.draft"} as const;
function statusClassName(status: ProjectPullRequest["status"]) {
  if (status === "Closed") return "text-destructive";
  if (status === "Draft") return "text-muted-foreground";
  if (status === "Merged") return "text-purple-400";
  return "text-green-500";
}

/** Compact metadata under the review title: branches, reviewers, status. */
export function PullRequestMetaHeader({
  diffStats,
  profiles,
  project,
  pullRequest,
}: {
  diffStats?: { additions: number; deletions: number } | null;
  profiles?: UserProfileLookup;
  project: Project;
  pullRequest: ProjectPullRequest;
}) {
  const targetBranch =
    pullRequest.targetBranch || project.defaultBranch || t("projects.review.defaultBranch");
  const sourceBranch = pullRequest.branchName || t("projects.review.unknownBranch");
  const labels = pullRequest.labels.filter(
    (label) => label.toLowerCase() !== "draft",
  );
  const StatusIcon =
    pullRequest.status === "Merged" ? GitMerge : GitPullRequest;
  const diffStatsCache = React.useRef<{
    pullRequestId: string;
    stats: typeof diffStats;
  }>({
    pullRequestId: pullRequest.id,
    stats: diffStats,
  });
  if (diffStatsCache.current.pullRequestId !== pullRequest.id) {
    diffStatsCache.current = {
      pullRequestId: pullRequest.id,
      stats: diffStats,
    };
  } else if (diffStats) {
    diffStatsCache.current.stats = diffStats;
  }
  const displayedDiffStats = diffStats ?? diffStatsCache.current.stats;

  return (
    <ProjectDetailMetaList>
      <ProjectDetailMetaRow icon={GitBranch} label={t("projects.workItem.branch")}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <p className="flex min-w-0 items-center gap-1.5 overflow-hidden">
            <span className="truncate text-foreground">{sourceBranch}</span>
            <span aria-hidden className="shrink-0 text-muted-foreground">
              →
            </span>
            <span className="truncate text-foreground">{targetBranch}</span>
          </p>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <span className="inline-flex min-w-20 justify-end gap-1.5 tabular-nums">
              {displayedDiffStats ? (
                <>
                  <span className="text-green-500">
                    +{displayedDiffStats.additions}
                  </span>
                  <span className="text-destructive">
                    -{displayedDiffStats.deletions}
                  </span>
                </>
              ) : (
                <span aria-hidden className="invisible">
                  +0 -0
                </span>
              )}
            </span>
            {pullRequest.commit ? (
              <span className="inline-flex min-w-0 items-center gap-0.5 text-muted-foreground">
                <code
                  className="truncate font-mono text-xs"
                  title={pullRequest.commit}
                >
                  {pullRequest.commit.slice(0, 7)}
                </code>
                <CopyCommitHashButton
                  className="h-5 w-5 p-0"
                  hash={pullRequest.commit}
                />
              </span>
            ) : null}
          </div>
        </div>
      </ProjectDetailMetaRow>
      <PullRequestReviewersRow
        profiles={profiles}
        pullRequest={pullRequest}
      />
      <ProjectDetailMetaRow icon={StatusIcon} label={t("projects.workItem.status")}>
        <span className={`font-medium ${statusClassName(pullRequest.status)}`}>
          {t(prStatusKey[pullRequest.status])}
        </span>
      </ProjectDetailMetaRow>
      {labels.length > 0 ? (
        <ProjectDetailMetaRow icon={Tag} label={t("projects.workItem.labels")}>
          <ProjectDetailMetaPills labels={labels} />
        </ProjectDetailMetaRow>
      ) : null}
    </ProjectDetailMetaList>
  );
}
