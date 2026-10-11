// Read JSX from Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectIssuesPanel.tsx::ProjectIssueDetail.
// Assignment/comment writes and absent Git/discussion/deep-link consumers are
// not exposed; the original read layout and canonical event reducer remain.
import { Circle, CircleCheck, CircleDashed, CircleDot, CircleX, Tag, User, type LucideIcon } from "lucide-react";
import type { ProjectIssue } from "./projectIssues.mjs";
import { projectTaskUserLabels } from "./projectTaskCategories";
import { relativeTime } from "./lib/projectsViewHelpers";
import { resolveUserLabel, type UserProfileLookup } from "../messages/system/identity";
import { ProjectDetailMetaList, ProjectDetailMetaPills, ProjectDetailMetaRow } from "./ProjectDetailMeta";
import { ProjectDetailSection } from "./ProjectDetailSection";
import { ProjectIssueCommentTimeline } from "./ProjectIssueCommentTimeline";
import {UserAvatar} from "../messages/UserAvatar";
import {Tooltip,TooltipContent,TooltipTrigger} from "../sidebar/tooltip";
import { ProjectRichContent } from "./ProjectRichContent";
import { ProjectOriginReference } from "./ProjectOriginReference";
import { useT } from "../context";
const issueStatusKey = {"Triage":"projects.status.triage","Backlog":"projects.status.backlog","In Progress":"projects.status.inProgress","In Review":"projects.status.inReview","Done":"projects.status.done","Closed":"projects.status.closed"} as const;
const taskCategoryKey = {"issue":"projects.category.issue","change-request":"projects.category.changeRequest","improvement":"projects.category.improvement"} as const;
export function issueStatusClassName(status: ProjectIssue["status"]) {
  if (status === "Triage" || status === "In Progress") return "text-amber-500";
  if (status === "Backlog") return "text-muted-foreground";
  if (status === "In Review") return "text-green-500";
  if (status === "Done") return "text-purple-400";
  if (status === "Closed") return "text-destructive";
  return "text-muted-foreground";
}

function issueStatusVisual(status: ProjectIssue["status"]): {
  className: string;
  icon: LucideIcon;
} {
  if (status === "Done") {
    return {
      className: "text-purple-400",
      icon: CircleCheck,
    };
  }
  if (status === "Closed") {
    return {
      className: "text-destructive",
      icon: CircleX,
    };
  }
  if (status === "Backlog") {
    return {
      className: issueStatusClassName(status),
      icon: Circle,
    };
  }
  if (status === "Triage") {
    return {
      className: issueStatusClassName(status),
      icon: CircleDashed,
    };
  }
  return {
    className: issueStatusClassName(status),
    icon: CircleDot,
  };
}

export function ProjectIssueDetail({issue,profiles}:{issue:ProjectIssue;profiles?:UserProfileLookup}) {
  const t=useT();
  const status=issueStatusVisual(issue.status);
  const labels=projectTaskUserLabels(issue.labels);
  return (
    <div
      className="mx-auto w-full max-w-3xl overflow-hidden"
      data-project-detail-panel
      data-testid="project-issue-detail"
    >
      <header className="space-y-2 px-6 pb-3 pt-5">
        <h3 className="line-clamp-2 text-lg font-semibold leading-6 text-foreground">
          {issue.title}{" "}
          <span className="font-normal text-muted-foreground">
            #{issue.id.slice(0, 8)}
          </span>
        </h3>
        <p className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted-foreground">
          <span>{t("projects.task.created")}</span>
          <span
            className="shrink-0 whitespace-nowrap"
            title={new Date(issue.createdAt * 1_000).toLocaleString()}
          >
            {relativeTime(issue.createdAt)}
          </span>
          <ProjectOriginReference agentName={issue.originAgentName} channelId={issue.channelId}/>
        </p>
      </header>
      <ProjectDetailMetaList>
        <ProjectDetailMetaRow icon={status.icon} label={t("projects.workItem.status")}>
          <span className={`font-medium ${status.className}`}>
            {t(issueStatusKey[issue.status])}
          </span>
        </ProjectDetailMetaRow>
        <ProjectDetailMetaRow icon={CircleDot} label={t("projects.workItem.category")}>
          {t(taskCategoryKey[issue.category])}
        </ProjectDetailMetaRow>
        {issue.assignees.length > 0 ? (
          <ProjectDetailMetaRow icon={User} label={t("projects.workItem.assignees")}>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {issue.assignees.map(pubkey => {const profile=profiles?.[pubkey];const label=resolveUserLabel({pubkey,profiles});return <Tooltip key={pubkey}><TooltipTrigger asChild><span className="inline-flex"><UserAvatar accent={profile?.isAgent===true} avatarUrl={profile?.avatarUrl??null} displayName={label} shape={profile?.isAgent?"squircle":"circle"} size="xs"/></span></TooltipTrigger><TooltipContent>{t("projects.task.assigned",{name:label})}</TooltipContent></Tooltip>;})}
            </div>
          </ProjectDetailMetaRow>
        ) : null}
        {labels.length > 0 ? (
          <ProjectDetailMetaRow icon={Tag} label={t("projects.workItem.labels")}>
            <ProjectDetailMetaPills labels={labels} />
          </ProjectDetailMetaRow>
        ) : null}
      </ProjectDetailMetaList>
      {issue.content ? (
        <ProjectDetailSection defaultOpen title={t("projects.workItem.description")}>
          <ProjectRichContent content={issue.content} tags={issue.tags} />
        </ProjectDetailSection>
      ) : null}
      <ProjectDetailSection defaultOpen title={t("projects.workItem.activity")}>
        <div className="space-y-3">
          <ProjectIssueCommentTimeline
            comments={issue.comments}
            key={issue.id}
            profiles={profiles}
          />
        </div>
      </ProjectDetailSection>
    </div>
  );
}
