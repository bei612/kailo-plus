// Original Task/Review discussion branches. The Agent chat branch has no managed-owner
// execution consumer here and is not represented by an inert control.
import { useMemo } from "react";
import type { ProjectIssue } from "./projectIssues.mjs";
import type { ProjectPullRequest } from "./projectPullRequests.mjs";
import { issueShareLink, pullRequestShareLink } from "./projectShareLinks";
import { ProjectSelectionDiscussAction } from "./ProjectSelectionDiscussAction";
import { useProjectDiscussInChannel, type ProjectDiscussInChannel } from "./useProjectDiscussInChannel";
import type { ProjectSelectionItem } from "./lib/projectSelection";

export function ProjectWorkItemCommunicationActions({ issue, pullRequest, channelId, scopeKey, onDiscuss }: (
  { issue: ProjectIssue; pullRequest?: never } | { issue?: never; pullRequest: ProjectPullRequest }
) & { channelId?: string | null; scopeKey: string; onDiscuss: ProjectDiscussInChannel }) {
  const items = useMemo<ProjectSelectionItem[]>(() => issue
    ? [{ id: `task:${issue.id}`, kind: "task", title: issue.title, channelId, shareLink: issueShareLink(issue) }]
    : [{ id: `review:${pullRequest.id}`, kind: "review", title: pullRequest.title, channelId, shareLink: pullRequestShareLink(pullRequest) }], [issue, pullRequest, channelId]);
  const discussInChannel = useProjectDiscussInChannel(items, onDiscuss);
  return <div className="space-y-0.5" data-testid="project-context-communication-actions">
    <ProjectSelectionDiscussAction key={scopeKey} scopeKey={scopeKey} items={items} onSelectChannel={discussInChannel} testIdPrefix="project-context"/>
  </div>;
}
