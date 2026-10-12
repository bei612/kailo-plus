// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectIssuesPanel.tsx.
// Original repository Tasks grouping/rows; read detail is the existing shared component.
// Write/selection consumers remain unavailable, not replaced with fake controls.
import {MessageSquare,User} from "lucide-react";
import {useUiT} from "../context";
import {normalizePubkey} from "../conversations/pubkey";
import {resolveUserLabel,type UserProfileLookup} from "../messages/system/identity";
import type {ProjectIssue} from "./projectIssues.mjs";
import type {Repository} from "./projectModels";
import type {ProjectsHost} from "./projectEnumeration";
import {relativeTime} from "./lib/projectsViewHelpers";
import {issueStatusVisual,ProjectIssueDetail} from "./ProjectIssueDetail";
import {IssueAssigneeFacepile} from "./IssueAssigneeFacepile";
import {ProfileIdentityButton} from "./ProjectProfileIdentity";
import {ProjectStatusProgressIcon} from "./ProjectStatusProgressIcon";
import {ProjectWorkItemRow} from "./ProjectWorkItemRow";
import {ProjectWorkItemGroup} from "./ProjectWorkItemGroup";
import {ProjectPanelState} from "./ProjectPanelState";
const statusKey={"Triage":"projects.status.triage","Backlog":"projects.status.backlog","In Progress":"projects.status.inProgress","In Review":"projects.status.inReview","Done":"projects.status.done","Closed":"projects.status.closed"} as const;
const categoryKey={"issue":"projects.category.issue","change-request":"projects.category.changeRequest","improvement":"projects.category.improvement"} as const;
const ISSUE_STATUS_ORDER:readonly ProjectIssue["status"][]=["In Review","In Progress","Triage","Backlog","Done","Closed"];
export type ProjectIssuePanelItem={issue:ProjectIssue;project:Repository};
function IssueRow({
  issue,
  onOpen,
  profiles,
}: {
  issue: ProjectIssue;
  onOpen: () => void;
  profiles?: UserProfileLookup;
}) {
  const t = useUiT();
  const authorProfile = profiles?.[normalizePubkey(issue.author)];
  const authorLabel = resolveUserLabel({ profiles, pubkey: issue.author });
  const status = issueStatusVisual(issue.status);

  return (
    <ProjectWorkItemRow
      eventId={issue.id}
      identifier={`#${issue.id.slice(0, 8)}`}
      identifierTitle={t("projects.list.viewTask")}
      onOpen={onOpen}
      statusIcon={
        <ProjectStatusProgressIcon
          aria-label={t(statusKey[issue.status])}
          className={`h-3.5 w-3.5 shrink-0 ${status.className}`}
          state={status.progress}
        />
      }
      testId="project-issue-row"
      title={issue.title}
      trailing={
        <>
          <span
            className="hidden w-24 shrink-0 truncate text-right text-xs text-muted-foreground/60 md:block"
            data-testid="project-issue-row-category"
          >
            {t(categoryKey[issue.category])}
          </span>
          <span className="flex w-20 shrink-0 items-center justify-end gap-1">
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center"
              data-testid="project-issue-creator"
              title={t("projects.sheet.createdBy",{name:authorLabel})}
            >
              <ProfileIdentityButton
                avatarClassName="shrink-0"
                avatarSize="xs"
                avatarUrl={authorProfile?.avatarUrl ?? null}
                isAgent={authorProfile?.isAgent === true}
                label={authorLabel}
                pubkey={issue.author}
                showLabel={false}
              />
            </span>
            <span
              className="flex min-w-5 shrink-0 justify-end text-muted-foreground/45"
              data-testid="project-issue-assignee-cell"
            >
              {issue.assignees.length > 0 ? (
                <IssueAssigneeFacepile
                  assignees={issue.assignees}
                  profiles={profiles}
                />
              ) : (
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full border border-border/70 bg-muted/35"
                  data-testid="project-issue-assignee-placeholder"
                  title={t("projects.sheet.unassigned")}
                >
                  <User aria-hidden="true" className="h-3 w-3" />
                  <span className="sr-only">{t("projects.sheet.unassigned")}</span>
                </span>
              )}
            </span>
          </span>
          <span className="flex w-8 shrink-0 justify-end">
            <button
              aria-label={
                issue.comments.length > 0
                  ? t("projects.sheet.viewCommentsCount",{count:issue.comments.length})
                  : t("projects.sheet.viewComments")
              }
              className={`flex items-center gap-1 rounded-md text-xs hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${
                issue.comments.length > 0
                  ? "text-muted-foreground/60"
                  : "text-muted-foreground/45"
              }`}
              data-testid="project-issue-comments"
              onClick={onOpen}
              type="button"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {issue.comments.length}
            </button>
          </span>
          <span
            className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground/55 sm:block"
            data-testid="project-issue-row-date"
            title={new Date(issue.createdAt * 1_000).toLocaleString()}
          >
            {relativeTime(issue.createdAt)}
          </span>
        </>
      }
    />
  );
}

export function ProjectIssuesPanel({issueItems,onSelectedIssueIdChange,profiles,selectedIssueId,host,projectId}:{
  issueItems:ProjectIssuePanelItem[];onSelectedIssueIdChange:(id:string|null)=>void;profiles?:UserProfileLookup;selectedIssueId:string|null;
  host?:ProjectsHost;projectId?:string;
}) {
 const t=useUiT();
 const selectedItem=issueItems.find(({issue})=>issue.id===selectedIssueId);
 if(selectedItem)return <ProjectIssueDetail issue={selectedItem.issue} profiles={profiles} publication={host&&projectId?{host,projectId,repository:selectedItem.project}:undefined}/>;
 if(issueItems.length===0)return <ProjectPanelState title={t("projects.sheet.noTasks")} description={t("projects.sheet.tasksHint")}/>;
 const groups=ISSUE_STATUS_ORDER.map(status=>({items:issueItems.filter(({issue})=>issue.status===status),status})).filter(group=>group.items.length>0);
 return <div>{groups.map(({items,status})=>{const visual=issueStatusVisual(status);return <ProjectWorkItemGroup key={status} count={items.length}
  icon={<ProjectStatusProgressIcon className={`h-4 w-4 ${visual.className}`} state={visual.progress} aria-label={t(statusKey[status])}/>} label={t(statusKey[status])}>
  {items.map(({issue})=><IssueRow key={issue.id} issue={issue} profiles={profiles} onOpen={()=>onSelectedIssueIdChange(issue.id)}/>)}
 </ProjectWorkItemGroup>;})}</div>;
}
