// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectWorkItemContextDetails.tsx.
import { CheckCircle2, CircleDot, GitBranch, GitPullRequest, MessageCircle, Users, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useUiT } from "../context";
import type { ProjectIssue } from "./projectIssues.mjs";
import type { ProjectPullRequest } from "./projectPullRequests.mjs";
import type { Repository } from "./projectModels";

export type ProjectWorkItemContext =
  | {issue:ProjectIssue;pullRequest?:never;repository?:never}
  | {issue?:never;pullRequest:ProjectPullRequest;repository:Repository};

function ContextDetailRow({icon:Icon,label,value}:{icon:LucideIcon;label:string;value:ReactNode}){
  return <div className="flex items-center justify-between gap-3">
    <dt className="flex items-center gap-3 text-muted-foreground"><Icon className="h-3.5 w-3.5"/>{label}</dt>
    <dd className="font-medium text-foreground">{value}</dd>
  </div>;
}
const statusKey={Triage:"projects.status.triage",Backlog:"projects.status.backlog","In Progress":"projects.status.inProgress","In Review":"projects.status.inReview",Done:"projects.status.done",Closed:"projects.status.closed"} as const;
const reviewStatusKey={Open:"projects.status.open",Draft:"projects.status.draft",Merged:"projects.status.merged",Closed:"projects.status.closed"} as const;
export function ProjectWorkItemContextDetails({issue,pullRequest,repository}:ProjectWorkItemContext){
  const t=useUiT();
  if(pullRequest){
    const sourceBranch=pullRequest.branchName||t("projects.context.unknownBranch");
    const targetBranch=pullRequest.targetBranch||repository.defaultBranch||t("projects.context.defaultBranch");
    const branchLabel=`${sourceBranch} → ${targetBranch}`;
    return <>
      <ContextDetailRow icon={GitBranch} label={t("projects.workItem.branch")} value={
        <span className="block max-w-40 truncate" data-testid="project-context-branch" title={branchLabel}>{branchLabel}</span>}/>
      <ContextDetailRow icon={GitPullRequest} label={t("projects.workItem.status")} value={t(reviewStatusKey[pullRequest.status])}/>
      <ContextDetailRow icon={Users} label={t("projects.workItem.reviewers")} value={pullRequest.reviewers.length}/>
      <ContextDetailRow icon={CheckCircle2} label={t("projects.context.approvals")} value={pullRequest.approvals.length}/>
    </>;
  }
  return <>
    <ContextDetailRow icon={CircleDot} label={t("projects.workItem.status")} value={t(statusKey[issue.status])}/>
    <ContextDetailRow icon={Users} label={t("projects.workItem.assignees")} value={issue.assignees.length}/>
    <ContextDetailRow icon={MessageCircle} label={t("projects.context.comments")} value={issue.comments.length}/>
  </>;
}
