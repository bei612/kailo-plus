// Read JSX from Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectIssuesPanel.tsx::ProjectIssueDetail.
// Self assignment uses the governed host; assignment to others remains absent.
import { Circle, CircleCheck, CircleDashed, CircleDot, CircleX, Tag, User, type LucideIcon } from "lucide-react";
import type { ProjectIssue } from "./projectIssues.mjs";
import { projectTaskUserLabels } from "./projectTaskCategories";
import { relativeTime } from "./lib/projectsViewHelpers";
import { resolveUserLabel, type UserProfileLookup } from "../messages/system/identity";
import { ProjectDetailMetaList, ProjectDetailMetaPills, ProjectDetailMetaRow } from "./ProjectDetailMeta";
import { ProjectDetailSection } from "./ProjectDetailSection";
import { ProjectIssueCommentTimeline } from "./ProjectIssueCommentTimeline";
import { ProjectRichContent } from "./ProjectRichContent";
import { ProjectOriginReference } from "./ProjectOriginReference";
import { ShareLinkButton } from "./ShareLinkButton";
import { issueShareLink } from "./projectShareLinks";
import { useT } from "../context";
import type { ProjectStatusProgressState } from "./ProjectStatusProgressIcon";
import * as React from "react";
import {useQueryClient} from "@tanstack/react-query";
import {toast} from "sonner";
import {ForumComposer,usePulseHost} from "../pulse/host";
import {isOutcomeUnknown,TransportError} from "../../transport";
import type {ProjectsHost} from "./projectEnumeration";
import type {Repository} from "./projectModels";
import type {WebMessageAttachment} from "@client-kit/contracts";
import {publishProjectIssueComment} from "./issueMutations";
import {ProjectPanelState} from "./ProjectPanelState";
import {buildOutgoingMessage} from "../composer/features/messages/lib/imetaMediaMarkdown";
import {DiscussedInChannels} from "./DiscussionChannels";
import {entityDiscussionQuery} from "./discussionChannels";
import {IssueAssigneesRow} from "./IssueAssigneesRow";
import {publishProjectIssueSelfAssignment,readProjectIssueSelfAssignmentIntent,type IssueSelfAssignmentOperation} from "./issueAssignments";
type IssueDetailProps={issue:ProjectIssue;profiles?:UserProfileLookup;publication?:{host:ProjectsHost;projectId:string;repository:Repository}};
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

export function issueStatusVisual(status: ProjectIssue["status"]): {
  className: string;
  icon: LucideIcon;
  progress: ProjectStatusProgressState;
} {
  if (status === "Done") {
    return {
      className: "text-purple-400",
      icon: CircleCheck,
      progress: "completed",
    };
  }
  if (status === "Closed") {
    return {
      className: "text-destructive",
      icon: CircleX,
      progress: "canceled",
    };
  }
  if (status === "Backlog") {
    return {
      className: issueStatusClassName(status),
      icon: Circle,
      progress: "queued",
    };
  }
  if (status === "Triage") {
    return {
      className: issueStatusClassName(status),
      icon: CircleDashed,
      progress: "queued",
    };
  }
  return {
    className: issueStatusClassName(status),
    icon: CircleDot,
    progress: status === "In Review" ? "review" : "started",
  };
}

export function ProjectIssueDetail(props:IssueDetailProps) {
  return <IssueDetailBody key={`${props.publication?.host.scopeKey??"read"}:${props.issue.id}`} {...props}/>;
}
function IssueDetailBody({issue:source,profiles,publication}:IssueDetailProps) {
  const t=useT();
  const cache=useQueryClient();
  const viewer=usePulseHost().pubkey;
  const [confirmed,setConfirmed]=React.useState<{source:ProjectIssue;issue:ProjectIssue}|null>(null);
  const issue=confirmed?.source===source?confirmed.issue:source;
  const [isSending,setIsSending]=React.useState(false);
  const [readUnavailable,setReadUnavailable]=React.useState(false);
  const sending=React.useRef(false);
  let assignmentIntent:ReturnType<typeof readProjectIssueSelfAssignmentIntent>=null;
  try{if(publication)assignmentIntent=readProjectIssueSelfAssignmentIntent(publication.host,publication.projectId,publication.repository,issue,viewer);}
  catch{/* The click consumer reports unknown; a corrupt slot is never removed. */}
  const lifetime=React.useMemo(()=>({controller:new AbortController()}),[publication?.host]);
  React.useEffect(()=>{if(lifetime.controller.signal.aborted)lifetime.controller=new AbortController();return()=>lifetime.controller.abort();},[lifetime]);
  const members=React.useMemo(()=>publication?[...new Set([publication.repository.owner,issue.author,...publication.repository.contributors,...issue.recipients])].map(pubkey=>{
    const profile=profiles?.[pubkey.toLowerCase()];
    return {pubkey,role:"member",isAgent:profile?.isAgent===true,joinedAt:new Date(0).toISOString(),displayName:profile?.displayName?.trim()||profile?.nip05Handle?.trim()||null};
  }):[],[publication?.repository,issue,profiles]);
  async function handleSelfAssignment(operation:IssueSelfAssignmentOperation){
    if(!publication||sending.current)return;
    sending.current=true;setIsSending(true);
    try{
      const {host,projectId,repository}=publication;
      const result=await publishProjectIssueSelfAssignment(host,projectId,repository,issue,viewer,assignmentIntent?.operation??operation,
        assignmentIntent?.assigneeLabel??resolveUserLabel({pubkey:viewer,profiles}),lifetime.controller.signal,
        ()=>{if(!lifetime.controller.signal.aborted)setReadUnavailable(true);});
      lifetime.controller.signal.throwIfAborted();
      result.complete();
      setConfirmed({source,issue:result.issue});
      cache.setQueryData(["project-home-work-items",host.scopeKey,projectId],result.snapshot);
      cache.setQueriesData({predicate:query=>query.queryKey[0]==="project-work-item-target"&&query.queryKey[1]===host.scopeKey&&query.queryKey[2]===projectId},result.snapshot);
      void cache.invalidateQueries({queryKey:["projects-work-items",host.scopeKey]});
      void cache.invalidateQueries({queryKey:["projects",host.scopeKey,"inbox-work-items"]});
      toast.success(t(operation==="assign"?"projects.assignment.assigned":"projects.assignment.unassigned"));
    }catch(error){
      if(!lifetime.controller.signal.aborted){
        if(isOutcomeUnknown(error))toast.message(t("projects.assignment.unknown"));
        else toast.error(t("projects.assignment.failed"));
      }
    }finally{sending.current=false;if(!lifetime.controller.signal.aborted)setIsSending(false);}
  }
  async function handleCommentSubmit(content:string,mentions:string[],attachments:WebMessageAttachment[]=[],contentIncludesAttachments=false){
    if(!publication||sending.current)throw new TransportError(t("projects.comment.unknown"));
    sending.current=true;setIsSending(true);
    try{
      const {host,projectId,repository}=publication;
      const body=contentIncludesAttachments?content:buildOutgoingMessage(content,attachments,new Set(attachments.filter(item=>item.spoiler).map(item=>item.url))).content;
      const result=await publishProjectIssueComment(host,projectId,repository,issue,body,mentions,attachments.filter(item=>item.sha256.length>0),lifetime.controller.signal,
        ()=>{if(!lifetime.controller.signal.aborted)setReadUnavailable(true);});
      lifetime.controller.signal.throwIfAborted();
      result.complete();
      setConfirmed({source,issue:result.issue});
      cache.setQueryData(["project-home-work-items",host.scopeKey,projectId],result.snapshot);
      cache.setQueriesData({predicate:query=>query.queryKey[0]==="project-work-item-target"&&query.queryKey[1]===host.scopeKey&&query.queryKey[2]===projectId},result.snapshot);
      void cache.invalidateQueries({queryKey:["projects-work-items",host.scopeKey]});
      void cache.invalidateQueries({queryKey:["projects",host.scopeKey,"inbox-work-items"]});
      toast.success(t("projects.comment.posted"));
    }catch(error){
      if(!lifetime.controller.signal.aborted){
        if(isOutcomeUnknown(error))toast.message(t("projects.comment.unknown"));
        else toast.error(t("video.postFailed"));
      }
      throw error;
    }finally{sending.current=false;if(!lifetime.controller.signal.aborted)setIsSending(false);}
  }
  const status=issueStatusVisual(issue.status);
  const labels=projectTaskUserLabels(issue.labels);
  if(readUnavailable)return <ProjectPanelState error title={t("platform.loadFailed")}/>;
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
          <ShareLinkButton
            className="ml-1 inline-flex h-7 w-7 align-text-bottom"
            label={t("projects.share.copyTask")}
            link={issueShareLink(issue)}
            testId="project-issue-copy-link"
          />
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
        {issue.assignees.length > 0 || publication?.host.publish && viewer ? (
          <ProjectDetailMetaRow icon={User} label={t("projects.workItem.assignees")}>
            <IssueAssigneesRow issue={issue} profiles={profiles} viewerPubkey={publication?.host.publish?viewer:null}
              pending={isSending} recoveryOperation={assignmentIntent?.operation} onAssign={()=>void handleSelfAssignment("assign")}
              onUnassign={()=>void handleSelfAssignment("unassign")}/>
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
          <DiscussedInChannels entityLabel={t("projects.discussion.thisTask")}
            originChannelId={issue.channelId} originCreatedAt={issue.createdAt}
            originPubkey={issue.author} query={entityDiscussionQuery(issue.id)} testId="issue-discussed-in"/>
          <ProjectIssueCommentTimeline
            comments={issue.comments}
            key={issue.id}
            profiles={profiles}
          />
        </div>
      </ProjectDetailSection>
      {publication?.host.publish?<div className="px-6 pb-6 pt-4" data-testid="project-issue-comment-composer">
        <ForumComposer className="border border-border/60 bg-background/45" disabled={isSending} isSending={isSending}
          members={members} profiles={profiles} onSubmit={handleCommentSubmit} placeholder={t("projects.comment.placeholder")}/>
      </div>:null}
    </div>
  );
}
