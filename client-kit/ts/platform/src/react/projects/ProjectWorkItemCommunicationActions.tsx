// Original Task discussion branch. The Agent chat branch has no managed-owner
// execution consumer here and is not represented by an inert control.
import { useMemo } from "react";
import type { ProjectIssue } from "./projectIssues.mjs";
import { issueShareLink } from "./projectShareLinks";
import { ProjectSelectionDiscussAction } from "./ProjectSelectionDiscussAction";
import { useProjectDiscussInChannel, type ProjectDiscussInChannel } from "./useProjectDiscussInChannel";
import type { ProjectSelectionItem } from "./lib/projectSelection";

export function ProjectWorkItemCommunicationActions({ issue, scopeKey, onDiscuss }: {
  issue: ProjectIssue; scopeKey: string; onDiscuss: ProjectDiscussInChannel;
}) {
  const items = useMemo<ProjectSelectionItem[]>(() => [{ id: `task:${issue.id}`, kind: "task",
    title: issue.title, channelId: issue.channelId, shareLink: issueShareLink(issue) }], [issue]);
  const discussInChannel = useProjectDiscussInChannel(items, onDiscuss);
  return <div className="space-y-0.5" data-testid="project-context-communication-actions">
    <ProjectSelectionDiscussAction key={scopeKey} scopeKey={scopeKey} items={items} onSelectChannel={discussInChannel} testIdPrefix="project-context"/>
  </div>;
}
