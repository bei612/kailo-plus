// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectPullRequestsPanel.tsx.
import {GitBranch,MessageSquare} from "lucide-react";
import {useUiT} from "../context";
import {normalizePubkey} from "../conversations/pubkey";
import {resolveUserLabel,type UserProfileLookup} from "../messages/system/identity";
import type {ProjectPullRequest} from "./projectPullRequests.mjs";
import type {Repository} from "./projectModels";
import {relativeTime,formatExactTimestamp} from "./lib/projectsViewHelpers";
import {ProjectPullRequestDetail} from "./ProjectPullRequestDetail";
import {ProfileIdentityButton} from "./ProjectProfileIdentity";
import {ProjectStatusProgressIcon,type ProjectStatusProgressState} from "./ProjectStatusProgressIcon";
import {ProjectWorkItemRow} from "./ProjectWorkItemRow";
import {ProjectWorkItemGroup} from "./ProjectWorkItemGroup";
import {ProjectPanelState} from "./ProjectPanelState";
const statusKey={"Open":"projects.status.open","Draft":"projects.status.draft","Merged":"projects.status.merged","Closed":"projects.status.closed"} as const;
function pullRequestStatusClassName(status: ProjectPullRequest["status"]) {
  if (status === "Closed") return "text-destructive";
  if (status === "Draft") return "text-muted-foreground";
  if (status === "Merged") return "text-purple-400";
  return "text-green-500";
}

const PULL_REQUEST_STATUS_ORDER: readonly ProjectPullRequest["status"][] = [
  "Open",
  "Draft",
  "Merged",
  "Closed",
];

function pullRequestProgressState(
  status: ProjectPullRequest["status"],
): ProjectStatusProgressState {
  if (status === "Draft") return "queued";
  if (status === "Merged") return "completed";
  if (status === "Closed") return "canceled";
  return "review";
}

function PullRequestRow({
  onOpen,
  profiles,
  pullRequest,
}: {
  onOpen: () => void;
  profiles?: UserProfileLookup;
  pullRequest: ProjectPullRequest;
}) {
  const t=useUiT();
  const authorProfile = profiles?.[normalizePubkey(pullRequest.author)];
  const authorLabel = resolveUserLabel({pubkey:pullRequest.author,profiles});
  const statusClassName = pullRequestStatusClassName(pullRequest.status);

  return (
    <ProjectWorkItemRow
      eventId={pullRequest.id}
      identifier={`#${pullRequest.id.slice(0, 8)}`}
      identifierTitle={t("projects.sheet.viewReview")}
      metadata={
        pullRequest.branchName ? (
          <span className="inline-flex min-w-0 items-center gap-1">
            <GitBranch className="h-3 w-3 shrink-0" />
            <span className="truncate">{pullRequest.branchName}</span>
          </span>
        ) : undefined
      }
      onOpen={onOpen}
      statusIcon={
        <ProjectStatusProgressIcon
          aria-label={t(statusKey[pullRequest.status])}
          className={`h-3.5 w-3.5 shrink-0 ${statusClassName}`}
          state={pullRequestProgressState(pullRequest.status)}
        />
      }
      testId="project-pull-request-row"
      title={pullRequest.title}
      trailing={
        <>
          <span className="flex w-8 shrink-0 justify-end">
            <button
              aria-label={
                pullRequest.comments.length > 0
                  ? t("projects.sheet.viewCommentsCount",{count:pullRequest.comments.length})
                  : t("projects.sheet.viewComments")
              }
              className={`flex items-center gap-1 rounded-md text-xs hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${
                pullRequest.comments.length > 0
                  ? "text-muted-foreground/60"
                  : "text-muted-foreground/45"
              }`}
              data-testid="project-pull-request-comments"
              onClick={onOpen}
              type="button"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {pullRequest.comments.length}
            </button>
          </span>
          <ProfileIdentityButton
            avatarClassName="shrink-0"
            avatarSize="xs"
            avatarUrl={authorProfile?.avatarUrl ?? null}
            isAgent={authorProfile?.isAgent === true}
            label={authorLabel}
            pubkey={pullRequest.author}
            showLabel={false}
          />
          <span
            className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground/55 sm:block"
            data-testid="project-pull-request-row-date"
            title={formatExactTimestamp(pullRequest.createdAt)}
          >
            {relativeTime(pullRequest.createdAt)}
          </span>
        </>
      }
    />
  );
}

export function PullRequestsPanel({project,pullRequests,selectedPullRequest,onSelectedPullRequestIdChange,profiles}:{
 project:Repository;pullRequests:ProjectPullRequest[];selectedPullRequest:ProjectPullRequest|null;
 onSelectedPullRequestIdChange:(id:string|null)=>void;profiles?:UserProfileLookup;
}) {
 const t=useUiT();
 if(selectedPullRequest)return <ProjectPullRequestDetail project={project} pullRequest={selectedPullRequest} profiles={profiles}/>;
 if(pullRequests.length===0)return <ProjectPanelState testId="project-pull-requests-empty" title={t("projects.list.reviewsEmpty")} description={t("projects.sheet.reviewsHint")}/>;
 const groups=PULL_REQUEST_STATUS_ORDER.map(status=>({items:pullRequests.filter(value=>value.status===status),status})).filter(group=>group.items.length>0);
 return <div>{groups.map(({items,status})=><ProjectWorkItemGroup key={status} count={items.length} label={t(statusKey[status])}
  icon={<ProjectStatusProgressIcon className={`h-4 w-4 ${pullRequestStatusClassName(status)}`} state={pullRequestProgressState(status)} aria-label={t(statusKey[status])}/>}>
  {items.map(pullRequest=><PullRequestRow key={pullRequest.id} pullRequest={pullRequest} profiles={profiles} onOpen={()=>onSelectedPullRequestIdChange(pullRequest.id)}/>)}
 </ProjectWorkItemGroup>)}</div>;
}
