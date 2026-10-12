// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectWorkItemContextDetails.tsx: Task branch.
import { CircleDot, MessageCircle, Users, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useUiT } from "../context";
import type { ProjectIssue } from "./projectIssues.mjs";

function ContextDetailRow({icon:Icon,label,value}:{icon:LucideIcon;label:string;value:ReactNode}){
  return <div className="flex items-center justify-between gap-3">
    <dt className="flex items-center gap-3 text-muted-foreground"><Icon className="h-3.5 w-3.5"/>{label}</dt>
    <dd className="font-medium text-foreground">{value}</dd>
  </div>;
}
const statusKey={Triage:"projects.status.triage",Backlog:"projects.status.backlog","In Progress":"projects.status.inProgress","In Review":"projects.status.inReview",Done:"projects.status.done",Closed:"projects.status.closed"} as const;
export function ProjectWorkItemContextDetails({issue}:{issue:ProjectIssue}){
  const t=useUiT();
  return <>
    <ContextDetailRow icon={CircleDot} label={t("projects.workItem.status")} value={t(statusKey[issue.status])}/>
    <ContextDetailRow icon={Users} label={t("projects.workItem.assignees")} value={issue.assignees.length}/>
    <ContextDetailRow icon={MessageCircle} label={t("projects.context.comments")} value={issue.comments.length}/>
  </>;
}
