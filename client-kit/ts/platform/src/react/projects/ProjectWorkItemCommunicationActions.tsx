// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectWorkItemCommunicationActions.tsx.
// Original "Chat with an agent" (DD-130; shown only inside a right panel that has the governed
// chat transport) and Task/Review "Discuss in a channel" branches.
// desktop/src/features/projects/lib/projectDetailSelectionItem.ts: the selected Task/Review becomes the
// selection item here; a selected commit is chatted/discussed through ProjectCommitsPanel's selection.
import { useMemo } from "react";
import { Bot } from "lucide-react";
import { useUiT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import type { ProjectIssue } from "./projectIssues.mjs";
import type { ProjectPullRequest } from "./projectPullRequests.mjs";
import { issueShareLink, pullRequestShareLink } from "./projectShareLinks";
import { PROJECT_CONTEXT_ACTION_BUTTON_CLASS } from "./projectContextActionStyles";
import { ProjectSelectionDiscussAction } from "./ProjectSelectionDiscussAction";
import { useProjectDiscussInChannel, type ProjectDiscussInChannel } from "./useProjectDiscussInChannel";
import { useProjectRightPanelChat } from "./ProjectDetailRightPanel";
import { selectionItemFromReview, selectionItemFromTask, type ProjectSelectionItem } from "./lib/projectSelection";

export function ProjectWorkItemCommunicationActions({ issue, pullRequest, channelId, scopeKey, onDiscuss }: (
  { issue: ProjectIssue; pullRequest?: never } | { issue?: never; pullRequest: ProjectPullRequest }
) & { channelId?: string | null; scopeKey: string; onDiscuss?: ProjectDiscussInChannel }) {
  const t = useUiT();
  const chat = useProjectRightPanelChat();
  const items = useMemo<ProjectSelectionItem[]>(() => issue
    ? [selectionItemFromTask({ author: issue.author, channelId, id: issue.id, shareLink: issueShareLink(issue), title: issue.title })]
    : [selectionItemFromReview({ author: pullRequest.author, channelId, id: pullRequest.id, shareLink: pullRequestShareLink(pullRequest), title: pullRequest.title })],
  [issue, pullRequest, channelId]);
  if (!chat && !onDiscuss) return null;
  return <div className="space-y-0.5" data-testid="project-context-communication-actions">
    {chat ? <Button className={PROJECT_CONTEXT_ACTION_BUTTON_CLASS} data-testid="project-context-chat-agent" onClick={() => chat.openSelectionChat(items)}
      size="sm" type="button" variant="ghost">
      <Bot className="h-3.5 w-3.5"/>{t("projects.agentChat.chatWithAgent")}
    </Button> : null}
    {onDiscuss ? <DiscussAction items={items} onDiscuss={onDiscuss} scopeKey={scopeKey}/> : null}
  </div>;
}

function DiscussAction({ items, onDiscuss, scopeKey }: { items: ProjectSelectionItem[]; onDiscuss: ProjectDiscussInChannel; scopeKey: string }) {
  const discussInChannel = useProjectDiscussInChannel(items, onDiscuss);
  return <ProjectSelectionDiscussAction key={scopeKey} scopeKey={scopeKey} items={items} onSelectChannel={discussInChannel} testIdPrefix="project-context"/>;
}
