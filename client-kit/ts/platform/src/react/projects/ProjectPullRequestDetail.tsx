// Original read branches of Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectPullRequestsPanel.tsx.
import {Check,ChevronDown,ChevronUp,GitBranch,History,MessageSquare,TriangleAlert,UserPlus} from "lucide-react";
import * as React from "react";
import {translateCurrent as t} from "../../i18n";
import type {ProjectPullRequest} from "./projectPullRequests.mjs";
import {projectPullRequestCommentTimelineKind} from "./projectPullRequests.mjs";
import type {Repository as Project} from "./projectModels";
import type {UserProfileLookup} from "../messages/system/identity";
import {normalizePubkey,truncateNpub} from "../conversations/pubkey";
import {relativeTime,formatExactTimestamp} from "./lib/projectsViewHelpers";
import {ProjectFeedRow,ProjectFeedRowCluster,ProjectFeedRowMonoCell} from "./ProjectFeedRow";
import {CopyCommitHashButton} from "./ProjectCommitCopyButton";
import {ProjectDetailSection} from "./ProjectDetailSection";
import {ProfileAuthorName,ProfileIdentityButton} from "./ProjectProfileIdentity";
import {ProjectRichContent} from "./ProjectRichContent";
import {PullRequestMetaHeader} from "./PullRequestMetaHeader";
import {ProjectOriginReference} from "./ProjectOriginReference";
import { ShareLinkButton } from "./ShareLinkButton";
import { pullRequestShareLink } from "./projectShareLinks";
import {useQueryClient} from "@tanstack/react-query";
import {toast} from "sonner";
import type {WebMessageAttachment} from "@client-kit/contracts";
import {ForumComposer,usePulseHost} from "../pulse/host";
import {isOutcomeUnknown,TransportError} from "../../transport";
import type {ProjectsHost} from "./projectEnumeration";
import {publishProjectPullRequestComment} from "./issueMutations";
import {publishProjectPullRequestStatus,readProjectPullRequestStatusIntent,type ProjectPullRequestLifecycle} from "./pullRequestStatus";
import {PullRequestReviewCard} from "./PullRequestReviewCard";
import {ProjectPanelState} from "./ProjectPanelState";
import {buildOutgoingMessage} from "../composer/features/messages/lib/imetaMediaMarkdown";
import {useUiT} from "../context";
import {DiscussedInChannels} from "./DiscussionChannels";
import {entityDiscussionQuery} from "./discussionChannels";
import {ProjectDetailRightPanel} from "./ProjectDetailRightPanel";
import {ProjectWorkItemCommunicationActions} from "./ProjectWorkItemCommunicationActions";
import type {ProjectDiscussInChannel} from "./useProjectDiscussInChannel";
function profileForPubkey(pubkey: string, profiles?: UserProfileLookup) {
  return profiles?.[normalizePubkey(pubkey)] ?? null;
}

function labelForPubkey(pubkey: string, profiles?: UserProfileLookup) {
  const profile = profileForPubkey(pubkey, profiles);
  return (
    profile?.displayName?.trim() ||
    profile?.nip05Handle?.trim() ||
    truncateNpub(pubkey)
  );
}

function AuthorIdentity({
  avatarSize = "md",
  profiles,
  pubkey,
  role,
  showLabel = true,
}: {
  avatarSize?: "xs" | "sm" | "md";
  profiles?: UserProfileLookup;
  pubkey: string;
  role?: React.ReactNode;
  showLabel?: boolean;
}) {
  const profile = profileForPubkey(pubkey, profiles);
  return (
    <ProfileIdentityButton
      align="center"
      avatarSize={avatarSize}
      avatarUrl={profile?.avatarUrl ?? null}
      isAgent={profile?.isAgent === true}
      label={labelForPubkey(pubkey, profiles)}
      pubkey={pubkey}
      role={role}
      showLabel={showLabel}
    />
  );
}

/** Commit hash chip that jumps to the commit detail when a handler is given. */
function CommitHashChip({
  hash,
  onOpenCommit,
}: {
  hash: string;
  onOpenCommit?: (commitHash: string) => void;
}) {
  const short = hash.slice(0, 7);
  if (!onOpenCommit) {
    return (
      <code className="shrink-0 rounded-md bg-background/55 px-2 py-1 text-xs text-muted-foreground">
        {short}
      </code>
    );
  }
  return (
    <button
      aria-label={t("projects.commit.view",{hash:short})}
      className="shrink-0 rounded-md bg-background/55 px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onOpenCommit(hash)}
      type="button"
    >
      {short}
    </button>
  );
}

function PullRequestCommitRow({
  author,
  branch,
  createdAt,
  hash,
  message,
  onOpenCommit,
  profiles,
}: {
  author: string;
  branch: string | null;
  createdAt: number;
  hash: string | null;
  message: string;
  onOpenCommit?: (commitHash: string) => void;
  profiles?: UserProfileLookup;
}) {
  const authorProfile = profileForPubkey(author, profiles);
  const authorLabel = labelForPubkey(author, profiles);
  const openCommit =
    hash && onOpenCommit ? () => onOpenCommit(hash) : undefined;

  return (
    <ProjectFeedRow
      meta={
        <>
          <ProfileIdentityButton
            avatarClassName="shrink-0"
            avatarSize="xs"
            avatarUrl={authorProfile?.avatarUrl ?? null}
            isAgent={authorProfile?.isAgent === true}
            label={authorLabel}
            pubkey={author}
            showLabel={false}
          />
          <span className="truncate">
            <ProfileAuthorName pubkey={author}>{authorLabel}</ProfileAuthorName>{" "}
            {t("projects.commit.authored")}
          </span>
          {branch ? (
            <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-border/60 px-1.5 py-0.5 font-mono text-2xs">
              <GitBranch className="h-3 w-3 shrink-0" />
              <span className="truncate">{branch}</span>
            </span>
          ) : null}
        </>
      }
      onOpen={openCommit}
      testId="project-pull-request-commit-row"
      title={message}
      trailing={
        <>
          {hash ? (
            <ProjectFeedRowCluster>
              <ProjectFeedRowMonoCell
                label={hash.slice(0, 7)}
                onClick={openCommit}
                title={t("projects.commit.view",{hash:hash.slice(0,7)})}
              />
              <CopyCommitHashButton hash={hash} />
            </ProjectFeedRowCluster>
          ) : null}
          <span
            className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground sm:block"
            data-testid="project-pull-request-commit-row-date"
            title={formatExactTimestamp(createdAt)}
          >
            {relativeTime(createdAt)}
          </span>
        </>
      }
    />
  );
}

export function PullRequestDetailHeader({
  pullRequest,
}: {
  pullRequest: ProjectPullRequest;
}) {
  return (
    <header className="min-w-0 space-y-2 px-6 pb-3 pt-5">
      <h3 className="line-clamp-2 min-w-0 text-lg font-semibold leading-6 text-foreground">
        {pullRequest.title}{" "}
        <span className="font-normal text-muted-foreground">
          #{pullRequest.id.slice(0, 8)}
        </span>
        <ShareLinkButton
          className="ml-1 inline-flex h-7 w-7 align-text-bottom"
          label={t("projects.share.copyReview")}
          link={pullRequestShareLink(pullRequest)}
          testId="project-pull-request-copy-link"
        />
      </h3>
      <p
        className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted-foreground"
        data-testid="project-pull-request-detail-metadata"
      >
        <span data-project-metadata-phrase>{t("projects.review.opened")}</span>
        <span
          className="shrink-0 whitespace-nowrap"
          data-project-metadata-phrase
          title={formatExactTimestamp(pullRequest.createdAt)}
        >
          {relativeTime(pullRequest.createdAt)}
        </span>
        <ProjectOriginReference agentName={pullRequest.originAgentName} channelId={pullRequest.channelId}/>
      </p>
    </header>
  );
}

type PullRequestDetailProps={profiles?:UserProfileLookup;project:Project;pullRequest:ProjectPullRequest;publication?:{host:ProjectsHost;projectId:string};contextPanel?:{channelId?:string|null;onDiscussInChannel:ProjectDiscussInChannel}};
export function ProjectPullRequestDetail(props:PullRequestDetailProps) {
 return <PullRequestDetailBody key={`${props.publication?.host.scopeKey??"read"}:${props.pullRequest.id}`} {...props}/>;
}
function PullRequestDetailBody({profiles,project,pullRequest:source,publication,contextPanel}:PullRequestDetailProps) {
 const t=useUiT();
 const cache=useQueryClient();
 const [confirmed,setConfirmed]=React.useState<{source:ProjectPullRequest;pullRequest:ProjectPullRequest}|null>(null);
 const pullRequest=confirmed?.source===source?confirmed.pullRequest:source;
 const [isSending,setIsSending]=React.useState(false);
 const [readUnavailable,setReadUnavailable]=React.useState(false);
 const sending=React.useRef(false);
 const viewer=usePulseHost().pubkey;
 let statusIntent:ReturnType<typeof readProjectPullRequestStatusIntent>=null;
 try{if(publication&&viewer)statusIntent=readProjectPullRequestStatusIntent(publication.host,publication.projectId,project,pullRequest,viewer);}
 catch{/* The click consumer reports unknown; a corrupt slot is never removed. */}
 const lifetime=React.useMemo(()=>({controller:new AbortController()}),[publication?.host]);
 React.useEffect(()=>{if(lifetime.controller.signal.aborted)lifetime.controller=new AbortController();return()=>lifetime.controller.abort();},[lifetime]);
 const members=React.useMemo(()=>[...new Set([project.owner,pullRequest.author,...project.contributors,...pullRequest.recipients])].map(pubkey=>{
   const profile=profileForPubkey(pubkey,profiles);
   return {pubkey,role:"member",isAgent:profile?.isAgent===true,joinedAt:new Date(0).toISOString(),displayName:profile?.displayName?.trim()||profile?.nip05Handle?.trim()||null};
 }),[project,pullRequest,profiles]);
 async function handleCommentSubmit(content:string,mentions:string[],attachments:WebMessageAttachment[]=[],contentIncludesAttachments=false){
   if(!publication||sending.current)throw new TransportError(t("projects.comment.unknown"));
   sending.current=true;setIsSending(true);
   try{
     const {host,projectId}=publication;
     const body=contentIncludesAttachments?content:buildOutgoingMessage(content,attachments,new Set(attachments.filter(item=>item.spoiler).map(item=>item.url))).content;
     const result=await publishProjectPullRequestComment(host,projectId,project,pullRequest,body,mentions,attachments.filter(item=>item.sha256.length>0),lifetime.controller.signal,
       ()=>{if(!lifetime.controller.signal.aborted)setReadUnavailable(true);});
     lifetime.controller.signal.throwIfAborted();
     result.complete();setConfirmed({source,pullRequest:result.pullRequest});
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
 async function handleStatusChange(status:ProjectPullRequestLifecycle){
   if(!publication||!viewer||sending.current)return;
   sending.current=true;setIsSending(true);
   const requested=statusIntent?.status??status;
   try{
     const {host,projectId}=publication;
     const result=await publishProjectPullRequestStatus(host,projectId,project,pullRequest,viewer,requested,lifetime.controller.signal,
       ()=>{if(!lifetime.controller.signal.aborted)setReadUnavailable(true);});
     lifetime.controller.signal.throwIfAborted();
     result.complete();setConfirmed({source,pullRequest:result.pullRequest});
     cache.setQueryData(["project-home-work-items",host.scopeKey,projectId],result.snapshot);
     cache.setQueriesData({predicate:query=>query.queryKey[0]==="project-work-item-target"&&query.queryKey[1]===host.scopeKey&&query.queryKey[2]===projectId},result.snapshot);
     void cache.invalidateQueries({queryKey:["projects-work-items",host.scopeKey]});
     void cache.invalidateQueries({queryKey:["projects",host.scopeKey,"inbox-work-items"]});
     // Original toast copy per transition (PullRequestReviewCard.handleStatusChange).
     toast.success(t(requested==="draft"?"projects.review.status.drafted":requested==="closed"?"projects.review.status.closed"
       :pullRequest.status==="Closed"?"projects.review.status.reopened":"projects.review.status.readied"));
   }catch(error){
     if(!lifetime.controller.signal.aborted){
       if(isOutcomeUnknown(error))toast.message(t("projects.review.status.unknown"));
       else toast.error(t("projects.review.status.failed"));
     }
   }finally{sending.current=false;if(!lifetime.controller.signal.aborted)setIsSending(false);}
 }
 const [expandedReviewHistoryPullRequestIds,setExpandedReviewHistoryPullRequestIds]=React.useState<Set<string>>(()=>new Set());
 const [collapsedReviewHistoryPullRequestIds,setCollapsedReviewHistoryPullRequestIds]=React.useState<Set<string>>(()=>new Set());
  const commitCount = Math.max(1, pullRequest.updates.length + 1);
  const reviewHistory = pullRequest.comments
    .map((item) => ({
      item,
      timelineKind: projectPullRequestCommentTimelineKind(item),
    }))
    .sort(
      (left, right) =>
        left.item.createdAt - right.item.createdAt ||
        left.item.id.localeCompare(right.item.id),
    );
  const reviewHistoryCollapsed = collapsedReviewHistoryPullRequestIds.has(
    pullRequest.id,
  );
  const reviewHistoryExpanded = expandedReviewHistoryPullRequestIds.has(
    pullRequest.id,
  );
  const earlierReviewHistoryCount = Math.max(0, reviewHistory.length - 3);
  const visibleReviewHistory =
    reviewHistoryExpanded || earlierReviewHistoryCount === 0
      ? reviewHistory
      : reviewHistory.slice(-3);
  const displayedReviewHistory = reviewHistoryCollapsed
    ? []
    : visibleReviewHistory;
  if(readUnavailable)return <ProjectPanelState error title={t("platform.loadFailed")}/>;
  const detail = (
    <div
      className="mx-auto w-full max-w-3xl overflow-hidden"
      data-project-detail-panel
      data-testid="project-pull-request-detail"
    >
      <PullRequestDetailHeader pullRequest={pullRequest} />
      <PullRequestMetaHeader
        profiles={profiles}
        project={project}
        pullRequest={pullRequest}
      />
      {pullRequest.content || pullRequest.updates.length > 0 ? (
        <ProjectDetailSection defaultOpen title={t("projects.workItem.description")}>
          {pullRequest.content ? (
            <ProjectRichContent
              content={pullRequest.content}
              tags={pullRequest.tags}
            />
          ) : null}
          {pullRequest.updates.length > 0 ? (
            <div
              className={pullRequest.content ? "mt-4 space-y-4" : "space-y-4"}
            >
              <h4 className="text-sm font-semibold text-foreground">{t("projects.workItem.updates")}</h4>
              {pullRequest.updates.map((update) => (
                <article className="space-y-1" key={update.id}>
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <AuthorIdentity
                      avatarSize="sm"
                      profiles={profiles}
                      pubkey={update.author}
                      role={
                        <span title={formatExactTimestamp(update.createdAt)}>
                          {relativeTime(update.createdAt)}
                        </span>
                      }
                    />
                    {update.commit ? (
                      <CommitHashChip
                        hash={update.commit}
                      />
                    ) : null}
                  </div>
                  {update.content ? (
                    <ProjectRichContent
                      className="text-sm text-muted-foreground"
                      content={update.content}
                      tags={update.tags}
                    />
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
        </ProjectDetailSection>
      ) : null}
      <ProjectDetailSection
        count={commitCount}
        defaultOpen={false}
        title={t("projects.workItem.commits")}
      >
        <div className="-mx-6">
          <PullRequestCommitRow
            author={pullRequest.author}
            branch={pullRequest.branchName}
            createdAt={pullRequest.createdAt}
            hash={pullRequest.commit}
            message={pullRequest.title}
            profiles={profiles}
          />
          {pullRequest.updates.map((update) => (
            <PullRequestCommitRow
              author={update.author}
              branch={pullRequest.branchName}
              createdAt={update.createdAt}
              hash={update.commit}
              key={update.id}
              message={update.content.trim() || t("projects.review.updatedBranch")}
                profiles={profiles}
            />
          ))}
        </div>
      </ProjectDetailSection>
      <ProjectDetailSection defaultOpen={false} title={t("projects.workItem.checks")}>
        <p className="text-sm text-muted-foreground">
          {t("projects.review.noChecks")}
        </p>
      </ProjectDetailSection>
      <ProjectDetailSection defaultOpen title={t("projects.workItem.activity")}>
        <div className="space-y-3">
          <DiscussedInChannels entityLabel={t("projects.discussion.thisReview")}
            originChannelId={pullRequest.channelId} originCreatedAt={pullRequest.createdAt}
            originPubkey={pullRequest.author} query={entityDiscussionQuery(pullRequest.id)} testId="pull-request-discussed-in"/>
          <div className="group/timeline -mx-6 overflow-hidden">
            {reviewHistory.length > 0 ? (
              <button
                aria-expanded={!reviewHistoryCollapsed}
                className="flex min-h-10 w-full items-center gap-2 px-3 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
                data-testid="project-pull-request-review-history-toggle"
                onClick={() => {
                  setCollapsedReviewHistoryPullRequestIds((current) => {
                    const next = new Set(current);
                    if (reviewHistoryCollapsed) {
                      next.delete(pullRequest.id);
                    } else {
                      next.add(pullRequest.id);
                    }
                    return next;
                  });
                }}
                type="button"
              >
                <span className="relative flex w-5 shrink-0 justify-center self-stretch">
                  {reviewHistoryCollapsed ? (
                    <span className="absolute top-2.5 -bottom-11 hidden w-px bg-border/80 group-has-[.pull-request-action-timeline]/timeline:block" />
                  ) : (
                    <span className="absolute top-2.5 -bottom-[1.875rem] w-px bg-border/80" />
                  )}
                  <span className="relative z-10 flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/35">
                    <History className="h-3 w-3" />
                  </span>
                </span>
                <span className="flex min-h-5 min-w-0 flex-1 items-center text-left">
                  {reviewHistoryCollapsed
                    ? t(reviewHistory.length===1?"projects.review.showOne":"projects.review.showMany",{count:reviewHistory.length})
                    : t("projects.review.collapse")}
                </span>
                {reviewHistoryCollapsed ? (
                  <ChevronDown className="mt-0.5 h-3.5 w-3.5" />
                ) : (
                  <ChevronUp className="mt-0.5 h-3.5 w-3.5" />
                )}
              </button>
            ) : null}
            {!reviewHistoryCollapsed &&
            earlierReviewHistoryCount > 0 &&
            !reviewHistoryExpanded ? (
              <button
                className="flex min-h-10 w-full items-center gap-2 px-3 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
                data-testid="project-pull-request-earlier-activities"
                onClick={() => {
                  setExpandedReviewHistoryPullRequestIds((current) => {
                    const next = new Set(current);
                    next.add(pullRequest.id);
                    return next;
                  });
                }}
                type="button"
              >
                <span className="relative flex w-5 shrink-0 justify-center self-stretch">
                  <span className="absolute top-2.5 -bottom-[1.875rem] w-px bg-border/80" />
                  <span className="relative z-10 flex h-5 w-5 items-center justify-center rounded-full bg-background ring-1 ring-border/70">
                    <ChevronDown className="h-3 w-3" />
                  </span>
                </span>
                <span className="min-w-0 flex-1 text-left">
                  {t(earlierReviewHistoryCount===1?"projects.review.showOne":"projects.review.showMany",{count:earlierReviewHistoryCount})}
                </span>
              </button>
            ) : null}
            {displayedReviewHistory.map(({ item, timelineKind }, index) => {
              const isHistoricalDecision =
                item.reviewDecisionStatus === "historical";
              const trimmedContent = item.content.trim();
              const activityContent =
                timelineKind === null
                  ? trimmedContent
                  : timelineKind === "changes-requested" &&
                      !/^requested changes\.?$/i.test(trimmedContent)
                    ? trimmedContent
                    : timelineKind === "approved" &&
                        !/^approved (these )?changes\.?$/i.test(trimmedContent)
                      ? trimmedContent
                      : null;
              return (
                <div
                  className="flex min-h-10 min-w-0 items-start gap-2 px-3 py-2.5 text-sm text-muted-foreground"
                  data-testid="project-pull-request-timeline-row"
                  key={item.id}
                >
                  <div className="relative flex w-5 shrink-0 justify-center self-stretch">
                    {index < displayedReviewHistory.length - 1 ? (
                      <span className="absolute top-2.5 -bottom-[1.875rem] w-px bg-border/80" />
                    ) : (
                      <span className="absolute top-2.5 -bottom-11 hidden w-px bg-border/80 group-has-[.pull-request-action-timeline]/timeline:block" />
                    )}
                    <span className="relative z-10 flex h-5 w-5 items-center justify-center rounded-full bg-background ring-1 ring-border/70">
                      {timelineKind === "approved" ? (
                        <Check
                          className={`h-3 w-3 ${
                            isHistoricalDecision
                              ? "text-muted-foreground"
                              : "text-green-600 dark:text-green-500"
                          }`}
                        />
                      ) : timelineKind === "changes-requested" ? (
                        <TriangleAlert
                          className={`h-3 w-3 ${
                            isHistoricalDecision
                              ? "text-muted-foreground"
                              : "text-amber-600 dark:text-amber-400"
                          }`}
                        />
                      ) : timelineKind === "review-request" ? (
                        <UserPlus className="h-3 w-3" />
                      ) : (
                        <MessageSquare className="h-3 w-3" />
                      )}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center">
                      <span className="min-w-0 truncate">
                        <ProfileAuthorName pubkey={item.author}>
                          {labelForPubkey(item.author, profiles)}
                        </ProfileAuthorName>
                        {timelineKind ? (
                          <>
                            {" "}
                            {timelineKind === "approved"
                              ? isHistoricalDecision
                                ? t("projects.review.approvedEarlier")
                                : t("projects.review.approved")
                              : timelineKind === "changes-requested"
                                ? isHistoricalDecision
                                  ? t("projects.review.changesEarlier")
                                  : t("projects.review.changes")
                                : trimmedContent || t("projects.review.requested")}
                          </>
                        ) : null}
                      </span>
                      <span
                        className="ml-auto w-20 shrink-0 text-right text-xs text-muted-foreground/70"
                        title={formatExactTimestamp(item.createdAt)}
                      >
                        {relativeTime(item.createdAt)}
                      </span>
                    </div>
                    {activityContent ? (
                      <ProjectRichContent
                        className="mt-1 text-sm text-foreground/90"
                        content={activityContent}
                        tags={item.tags}
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
            {publication?.host.publish?<div className="flex min-h-12 items-start justify-start px-3 py-2.5">
              <PullRequestReviewCard repository={project} pullRequest={pullRequest} viewer={viewer} pending={isSending}
                recoveryStatus={statusIntent?.status} onStatusChange={status=>void handleStatusChange(status)}/>
            </div>:null}
          </div>
        </div>
      </ProjectDetailSection>
      {publication?.host.publish?<div className="px-6 pb-6 pt-4" data-testid="project-pull-request-comment-composer">
        <ForumComposer className="border border-border/60 bg-background/45" disabled={isSending} isSending={isSending}
          members={members} profiles={profiles} onSubmit={handleCommentSubmit} placeholder={t("projects.comment.placeholder")}/>
      </div>:null}
    </div>
  );
  return contextPanel&&publication?<ProjectDetailRightPanel pullRequest={pullRequest} repository={project}
    actions={<ProjectWorkItemCommunicationActions pullRequest={pullRequest} channelId={contextPanel.channelId} scopeKey={publication.host.scopeKey} onDiscuss={contextPanel.onDiscussInChannel}/>}
  >{detail}</ProjectDetailRightPanel>:detail;
}
