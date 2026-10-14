// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/projectRightPanelContext.ts::projectTaskActivity and
// projectReviewActivity, unchanged. Git ref scope has no shared consumer yet.
import type { ProjectIssue } from "./projectIssues.mjs";
import type { ProjectPullRequest } from "./projectPullRequests.mjs";

export function projectTaskActivity(issues: ProjectIssue[]) {
  const completed = issues.filter(
    (issue) => issue.status === "Done" || issue.status === "Closed",
  ).length;
  return {
    active: issues.length - completed,
    completed,
    total: issues.length,
  };
}

export function projectReviewActivity(pullRequests: ProjectPullRequest[]) {
  return {
    merged: pullRequests.filter(
      (pullRequest) => pullRequest.status === "Merged",
    ).length,
    open: pullRequests.filter(
      (pullRequest) =>
        pullRequest.status === "Open" || pullRequest.status === "Draft",
    ).length,
    total: pullRequests.length,
  };
}
