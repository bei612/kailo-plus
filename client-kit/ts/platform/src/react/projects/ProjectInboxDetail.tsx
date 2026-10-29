// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/home/ui/ProjectInboxDetailPane.tsx read detail.
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import { UserAvatar } from "../messages/UserAvatar";
import { resolveUserLabel } from "../messages/system/identity";
import { useProjectProfiles } from "./useProjectProfiles";
import { projectIssueAssignmentPubkeys } from "./projectAssignmentText";
import { ProjectIssueDetail } from "./ProjectIssueDetail";
import { ProjectPullRequestDetail } from "./ProjectPullRequestDetail";
import type { ProjectInboxWorkItem } from "./projectWorkItems";
import {useElementWidth} from "../sidebar/use-mobile";
import type {ProjectsHost} from "./projectEnumeration";

export function ProjectInboxDetail({workItem,onBack,onOpenProject,host}:{workItem:ProjectInboxWorkItem;onBack?:()=>void;onOpenProject?:()=>void;host?:ProjectsHost}) {
  const t=useT();
  const [detailContentRef,detailContentWidth]=useElementWidth<HTMLDivElement>();
  const showWideActions=detailContentWidth>=760;
  const openLabel=t(workItem.type==="issue"?"projects.inbox.openTask":"projects.inbox.openReview");
  const item=workItem.type==="issue"?workItem.issue:workItem.pullRequest;
  const keys=[...new Set([item.author,...item.comments.map(comment=>comment.author),
    ...(workItem.type==="issue"?[...workItem.issue.assignees,...projectIssueAssignmentPubkeys(workItem.issue)]:[...workItem.pullRequest.reviewers,...workItem.pullRequest.updates.map(update=>update.author)])])];
  const query=useProjectProfiles(keys);
  const profiles=query.data?.profiles;
  const authorLabel=resolveUserLabel({pubkey:item.author,profiles});
  const author=profiles?.[item.author];
  const inboxTitle=t(workItem.type==="issue"?"projects.inbox.task":"projects.inbox.review",{author:authorLabel});
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background/60" data-testid="home-project-inbox-detail">
    <div className="relative z-40 shrink-0">
      <div className="px-5 py-2"><div className="flex min-h-9 min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1">
          {onBack?<Button aria-label={t("projects.inbox.back")} onClick={onBack} size="icon" type="button" variant="ghost"><ArrowLeft className="h-4 w-4"/></Button>:null}
          <UserAvatar avatarUrl={author?.avatarUrl??null} className="shrink-0" displayName={authorLabel} shape={author?.isAgent?"squircle":"circle"} size="sm" testId="project-inbox-author-avatar"/>
          <h2 className="min-w-0 translate-y-px truncate text-sm font-semibold leading-5 tracking-tight text-foreground" title={inboxTitle+" · "+workItem.project.name}>{inboxTitle}</h2>
        </div>
        {onOpenProject?<Button aria-label={openLabel} className="shrink-0" onClick={onOpenProject} size={showWideActions?"sm":"icon"} title={openLabel} type="button" variant="ghost"><ExternalLink className="h-4 w-4"/>{showWideActions?openLabel:null}</Button>:null}
      </div></div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" ref={detailContentRef}>
      <div className="p-3"><div className="overflow-hidden rounded-xl border border-border/60 bg-card" data-testid="project-inbox-work-item-card">
        <div data-testid="project-inbox-work-item-layout">
          {workItem.type==="issue"?<ProjectIssueDetail issue={workItem.issue} profiles={profiles} publication={host?{host,projectId:workItem.project.id,repository:workItem.repository}:undefined}/>:<ProjectPullRequestDetail project={workItem.repository} pullRequest={workItem.pullRequest} profiles={profiles} publication={host?{host,projectId:workItem.project.id}:undefined}/>}
        </div>
      </div></div>
    </div>
  </section>;
}
