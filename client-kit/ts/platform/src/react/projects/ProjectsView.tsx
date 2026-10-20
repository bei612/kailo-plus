// REQ-24. Original Buzz 779af8886caae1317b4de962082429867ab61503
// ProjectsView / ProjectCards / ProjectEntityListRow presentation and ProjectDetailScreen. This host
// reads announcements/work-item targets and uses the governed publication hosts. The repository
// surface is the original detail screen: WorkspaceTabs (Overview/Files/Commits/Tasks/Review/
// Channels/Contributors) beside the repository context rail; a project with an authoritative home
// binding opens its channel home. Terminal, local checkout and project Agent chat remain without a
// governed consumer.
import { Fragment, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { CreateActionKey, WorkspaceMembershipState, type DiscoverableWorkspace } from "@client-kit/contracts";
import { FolderGit2, Folders, Trash2 } from "lucide-react";
import { useBffClient, useUiT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import { DropdownMenuItem } from "../sidebar/dropdown-menu";
import { EmptyFilteredState, EmptyState, ProjectGridCard, ProjectListRow } from "./ProjectCards";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { ProjectDeleteAction } from "./ProjectDeleteAction";
import { ProjectListRowMenu } from "./ProjectListRowMenu";
import { useCreateProject } from "./useCreateProject";
import { readStoredViewMode, writeStoredViewMode, readStoredFilter,writeStoredFilter,readStoredSort,writeStoredSort,getProjectUpdatedAt,isProjectMine,projectPeople,type ProjectsViewMode } from "./lib/projectsViewHelpers";
import { ProjectChannelHome, type ProjectChannelRenderer } from "./ProjectChannelHome";
import { ProjectSectionHeader } from "./ProjectSectionHeader";
import { loadProjectDirectory, type ProjectsHost } from "./projectEnumeration";
import { selectProjectRepository, type Project } from "./projectModels";
import { ProjectsChannelsList } from "./ProjectsChannelsList";
import type { ProjectsFilter } from "./ProjectsToolbar";
import { ProjectsSectionSearch } from "./ProjectsSectionSearch";
import { ProjectsListHeaderBar, type ProjectsSort } from "./ProjectsListHeaderBar";
import type { ProjectMemberRenderer } from "./ProjectChannelMembers";
import {loadProjectWorkItems,resolveProjectWorkItemTarget,type ProjectWorkItemTarget,type ProjectInboxWorkItem} from "./projectWorkItems";
import {ProjectsIssuesList} from "./ProjectsIssuesList";
import {ProjectsPullRequestsList} from "./ProjectsPullRequestsList";
import {matchesProjectsSearch} from "./lib/projectsSearch";
import {usePulseHost,useUsersBatchQuery} from "../pulse/host";
import {ProjectIssueDetail} from "./ProjectIssueDetail";
import {ProjectPullRequestDetail} from "./ProjectPullRequestDetail";
import {ProjectPanelState} from "./ProjectPanelState";
import {BuzzLoadingState} from "./BuzzLoadingState";
import {CreateProjectIssueDialog} from "./CreateProjectIssueDialog";
import {CreatePullRequestDialog} from "./CreatePullRequestDialog";
import type {ProjectDiscussInChannel} from "./useProjectDiscussInChannel";
import {ProjectDetailChrome} from "./ProjectDetailChrome";
import {WorkspaceTabs,isProjectGitWorkspaceTab,projectWorkspaceTabNeedsGit,type ProjectWorkspaceTab} from "./ProjectWorkspaceTabs";
import {RepositoryGitContent,repositoryGitSectionHeader,useRepositoryGitState,useReviewFilesChanged} from "./ProjectRepositoryGitTabs";
import {ProjectIssuesPanel} from "./ProjectIssuesPanel";
import {PullRequestsPanel} from "./ProjectPullRequestsPanel";
import {CreateIssueDialog} from "./CreateIssueDialog";
import {publishProjectIssue} from "./issueMutations";
import {isOutcomeUnknown,TransportError} from "../../transport";
import {toast} from "sonner";
import {ProjectsActivityFeed,projectsActivityPubkeys} from "./ProjectsActivityFeed";
import {ProjectsActivityIntro,ProjectsOverviewPanel} from "./ProjectsOverviewPanel";
import {ProjectsWorkItemsLoadNotice} from "./ProjectsWorkItemsLoadNotice";
import {buildProjectsActivityDigest} from "./lib/projectsActivityDigest";
import {projectActivitySummaries,repositoryActivitySummaries,type ProjectActivitySummary} from "./lib/projectActivitySummaries";
import {RepositoryGridCard,RepositoryListRow} from "./RepositoryCards";
import {CopyShareLinkMenuItem} from "./CopyShareLinkMenuItem";
import {projectShareLink} from "./projectShareLinks";
import {normalizePubkey} from "../conversations/pubkey";
import {ProjectSelectableGroup} from "./ProjectSelectableGroup";
import type {UserProfileLookup} from "../messages/system/identity";
import {projectsSectionIcon,projectsSectionTitleKey} from "./projectsSectionMeta";
import {useNow} from "../useNow";
import {cn} from "../profile/buzz/shared/lib/cn";
import {topChromeInset} from "../messages/chromeLayout";
import {useOptionalSidebar} from "../sidebar/sidebar";
import {useMediaBreakpoint} from "../sidebar/use-mobile";
import {ProjectContextRail} from "./ProjectContextRail";
import {ProjectsWorkspaceChrome} from "./ProjectDetailChrome";
import {ProjectsOverviewChromeActions,ProjectsOverviewContextSheet,ProjectsOverviewNarrowContextToggle} from "./ProjectsOverviewChromeActions";
import {ProjectsOverviewContextPanel,type ProjectsOverviewSection} from "./ProjectsOverviewPanel";
import {projectsOverviewContext} from "./projectsOverviewContext";
import {useProjectsScrollIndicator} from "./useProjectsScrollIndicator";
import {ProjectDetailUnavailableState} from "./ProjectDetailUnavailableState";
import {hasAuthoritativeHomeBinding} from "./lib/projectHomeSelection";
import {ProjectDetailPanelLayout,ProjectRightPanelControls,useProjectRepositoryPanel,type ProjectRepositoryPanelState} from "./ProjectDetailRightPanel";
import {ProjectRepositoryContextPanel} from "./ProjectRepositoryActionsPanel";
import {ProjectBranchActionDialogs} from "./ProjectBranchActionDialogs";
import {DiscussionChannelsPanel} from "./DiscussionChannels";
import {repositoryDiscussionQuery} from "./discussionChannels";
import {useProjectDetailPeople} from "./ProjectContributorsPanel";
import {ProjectsCategoryCreateDialogs} from "./ProjectsCategoryCreateDialogs";
import {loadChannelDirectory} from "../channel-browser/loadChannelDirectory";
import type {ProjectIssue} from "./projectIssues.mjs";
import type {ProjectPullRequest} from "./projectPullRequests.mjs";

type ProjectsViewProps={host:ProjectsHost;selectedProjectId?:string|null;onSelectedProjectChange?:(id:string|null,target?:ProjectWorkItemTarget)=>void|Promise<void>;
  onDiscussInChannel?:ProjectDiscussInChannel;
  renderChannel?:ProjectChannelRenderer;
  renderWorkItems?:(children:ReactNode,viewerPubkey:string)=>ReactNode;
  workItemTarget?:ProjectWorkItemTarget;onOpenChannel?:(workspace:DiscoverableWorkspace)=>void|Promise<void>;lastMessageAtByChannelId?:ReadonlyMap<string,string|null>;renderMember?:ProjectMemberRenderer};

/** Original wantsProjectRepositorySurface for a route target: a repository (not a work item) is requested. */
function repositorySurfaceTarget(target:ProjectWorkItemTarget|undefined) {
  return Boolean(target&&(target.tab||target.repositoryId&&!target.issueId&&!target.pullRequestId));
}

export function ProjectsView(props:ProjectsViewProps) {
  if(repositorySurfaceTarget(props.workItemTarget))return <ProjectRepositoryPage key={props.host.scopeKey} {...props}/>;
  if(props.workItemTarget&&(props.workItemTarget.repositoryId||props.workItemTarget.issueId||props.workItemTarget.pullRequestId))return <ProjectWorkItemPage key={props.host.scopeKey} host={props.host} projectId={props.selectedProjectId} target={props.workItemTarget} renderWorkItems={props.renderWorkItems} onOpen={props.onSelectedProjectChange} onDiscussInChannel={props.onDiscussInChannel}/>;
  return <ProjectDirectory key={props.host.scopeKey} {...props}/>;
}

// Original workspace vocabulary; share/entity tabs say "commits" for the Commits tab (projectShareLinks.ts::workspaceTabForShareTab).
// Without a tab the original detail screen opens Overview, or the tab a commit/file selection implies.
function workspaceTabFor(target:ProjectWorkItemTarget,git:boolean):ProjectWorkspaceTab|null {
  const tab=target.tab;
  if(tab===undefined){
    if(target.commitHash)return git?"activity":null;
    if(target.filePath)return git?"files":null;
    return git?"overview":"issues";
  }
  if(tab==="issues"||tab==="prs"||tab==="channels")return tab;
  if(!git)return null;
  if(tab==="overview"||tab==="files"||tab==="contributors")return tab;
  return tab==="commits"||tab==="activity"?"activity":null;
}
const urlTab=(tab:ProjectWorkspaceTab)=>tab==="activity"?"commits":tab;
// Original PROJECT_TAB_CRUMB_LABELS: Overview is the repository itself and has no tab crumb.
const workspaceTabTitle={files:"projects.git.files",activity:"projects.workItem.commits",issues:"projects.list.tasks",prs:"projects.list.reviews",
  channels:"projects.workspace.channelsTab",contributors:"projects.workspace.contributorsTab"} as const;

function ProjectRepositoryPage(props:ProjectsViewProps) {
  const {host,selectedProjectId}=props;
  const target=props.workItemTarget!;
  const onOpen=props.onSelectedProjectChange;
  const t=useUiT();const cache=useQueryClient();
  const panel=useProjectRepositoryPanel();
  const lifetime=useMemo(()=>({controller:new AbortController()}),[host]);
  useEffect(()=>{if(lifetime.controller.signal.aborted)lifetime.controller=new AbortController();return()=>lifetime.controller.abort();},[lifetime]);
  const key=useMemo(()=>["project-work-item-target",host.scopeKey,selectedProjectId,{repositoryId:target.repositoryId,tab:target.tab,issueId:target.issueId,pullRequestId:target.pullRequestId}],
    [host.scopeKey,selectedProjectId,target.repositoryId,target.tab,target.issueId,target.pullRequestId]);
  const workspaceTab=workspaceTabFor(target,Boolean(host.git));
  const valid=Boolean(onOpen&&selectedProjectId&&workspaceTab
    &&!(target.issueId&&target.pullRequestId)&&!(workspaceTab==="issues"&&target.pullRequestId)&&!(workspaceTab==="prs"&&target.issueId)
    &&!(workspaceTab&&workspaceTab!=="issues"&&workspaceTab!=="prs"&&(target.issueId||target.pullRequestId))
    &&!(target.commitHash&&workspaceTab!=="activity")&&!(target.filePath&&workspaceTab!=="files"));
  const query=useQuery({queryKey:key,enabled:valid,queryFn:({signal})=>loadProjectWorkItems(host,signal,selectedProjectId!),retry:false,refetchOnWindowFocus:"always"});
  useEffect(()=>()=>{void cache.cancelQueries({queryKey:key});cache.removeQueries({queryKey:key});},[cache,key]);
  const snapshot=query.isSuccess&&!query.isFetching?query.data:undefined;
  const project=snapshot?.projects.find(value=>value.id===selectedProjectId);
  // Original selectProjectRepository: an unknown repository falls back to the project's primary one.
  const repository=selectProjectRepository(project,target.repositoryId);
  const items=snapshot&&repository?snapshot.items.filter(item=>item.project.id===selectedProjectId&&item.repository.id===repository.id):[];
  const selected=target.issueId||target.pullRequestId?resolveProjectWorkItemTarget(items,selectedProjectId,{...target,repositoryId:repository?.id}):undefined;
  const [navigationFailed,setNavigationFailed]=useState(false);
  const navigate=(id:string|null,next?:ProjectWorkItemTarget)=>{
    if(lifetime.controller.signal.aborted||!onOpen)return;
    void Promise.resolve().then(()=>{if(!lifetime.controller.signal.aborted)return onOpen(id,next);})
      .catch(()=>{if(!lifetime.controller.signal.aborted)setNavigationFailed(true);});
  };
  if(!valid)return <ProjectPanelState error title={t("projects.unavailable")}/>;
  if(query.isError&&!query.isFetching)return <ProjectDetailUnavailableState kind="load-error" onBack={()=>navigate(null)} onRetry={()=>{void query.refetch();}}/>;
  if(snapshot&&!project)return <ProjectDetailUnavailableState kind="not-found" onBack={()=>navigate(null)}/>;
  if(snapshot&&project&&!repository)return <ProjectDetailUnavailableState kind="repositories-unavailable" project={project}/>;
  if(snapshot&&(target.issueId||target.pullRequestId)&&!selected)return <ProjectPanelState error title={t("projects.unavailable")}/>;
  if(!snapshot||!project||!repository||!workspaceTab)return <BuzzLoadingState label={t(workspaceTab==="prs"?"projects.sheet.loadingReviews":workspaceTab==="issues"?"projects.sheet.loadingTasks":"projects.git.loadingRepository")}/>;
  const tab=workspaceTab;
  const commitHash=tab==="activity"?target.commitHash??null:null;
  const clear=()=>navigate(project.id,{repositoryId:repository.id,tab:urlTab(tab)});
  const detail=selected?<ProjectWorkItemDetail workItem={selected} host={host} onOpen={(id,next)=>onOpen?.(id,{...next,tab:"issues"})} onDiscussInChannel={props.onDiscussInChannel}/>:null;
  const tabCrumb=tab==="overview"?null:t(workspaceTabTitle[tab]);
  return <>
    <ProjectDetailChrome project={project} repository={repository}
      actions={selected?undefined:<ProjectRightPanelControls collapsed={panel.collapsed} onCollapse={panel.collapse} onExpand={panel.expand}/>}
      activeTabCrumb={selected||commitHash?null:tabCrumb}
      activeWorkItemCrumb={selected?{category:t(tab==="overview"?"projects.list.tasks":workspaceTabTitle[tab]),title:selected.type==="issue"?selected.issue.title:selected.pullRequest.title,clear}
        :commitHash?{category:t(workspaceTabTitle.activity),title:commitHash.slice(0,7),clear}:null}
      onGoProjects={()=>navigate(null)} onGoProjectHome={()=>navigate(project.id)}/>
    {navigationFailed?<p role="alert">{t("platform.loadFailed")}</p>:null}
    {selected?(props.renderWorkItems?props.renderWorkItems(detail,snapshot.viewerPubkey):detail):
      <RepositoryWorkspace host={host} snapshot={snapshot} project={project} repository={repository} panel={panel} renderWorkItems={props.renderWorkItems}
        tab={tab} onBack={()=>navigate(project.id)} onTabChange={next=>navigate(project.id,{repositoryId:repository.id,tab:urlTab(next)})}
        commitHash={commitHash} filePath={tab==="files"?target.filePath:undefined}
        onSelectCommit={hash=>navigate(project.id,{repositoryId:repository.id,tab:"commits",...(hash?{commitHash:hash}:{})})}
        onRepositoryChange={repositoryId=>navigate(project.id,{repositoryId,tab:urlTab(tab)})}
        onOpen={next=>onOpen?.(project.id,{repositoryId:repository.id,tab:urlTab(tab),...next})}/>}
  </>;
}

type WorkItemsSnapshot=Awaited<ReturnType<typeof loadProjectWorkItems>>;

/**
 * Original ProjectDetailScreen repository surface: the shared git state, the repository context rail
 * and the WorkspaceTabs content. Profiles and discussion reads come from the work-item host, so the
 * tab content renders inside `renderWorkItems`; the rail and its management actions do not need it.
 */
function RepositoryWorkspace({host,snapshot,project,repository,panel,renderWorkItems,tab,onBack,onTabChange,onOpen,commitHash,filePath,onSelectCommit,onRepositoryChange}:{
  host:ProjectsHost;snapshot:WorkItemsSnapshot;project:Project;repository:Project["repositories"][number];panel:ProjectRepositoryPanelState;
  renderWorkItems:ProjectsViewProps["renderWorkItems"];tab:ProjectWorkspaceTab;
  onBack:()=>void;onTabChange:(tab:ProjectWorkspaceTab)=>void;onOpen:(target:ProjectWorkItemTarget)=>void|Promise<void>;
  commitHash:string|null;filePath?:string;onSelectCommit:(hash:string|null)=>void;onRepositoryChange:(repositoryId:string)=>void;
}) {
  const t=useUiT();const cache=useQueryClient();const [createOpen,setCreateOpen]=useState(false);const [creating,setCreating]=useState(false);
  const [createReviewOpen,setCreateReviewOpen]=useState(false);
  // Original "Create review" (DD-118): only with the governed publication and the repository Git seam.
  const canCreateReview=Boolean(host.publish&&host.git);
  const [navigationFailed,setNavigationFailed]=useState(false);const sending=useRef(false);
  const lifetime=useMemo(()=>({controller:new AbortController()}),[host,repository.id]);
  useEffect(()=>{if(lifetime.controller.signal.aborted)lifetime.controller=new AbortController();return()=>lifetime.controller.abort();},[lifetime]);
  const items=useMemo(()=>snapshot.items.filter(item=>item.repository.id===repository.id),[snapshot,repository.id]);
  const issues=useMemo(()=>items.flatMap(item=>item.type==="issue"?[item.issue]:[]),[items]);
  const pullRequests=useMemo(()=>items.flatMap(item=>item.type==="pull-request"?[item.pullRequest]:[]),[items]);
  const git=useRepositoryGitState({host,repository,pullRequests,commitHash});
  const open=(next:ProjectWorkItemTarget)=>{void Promise.resolve().then(()=>{if(!lifetime.controller.signal.aborted)return onOpen(next);})
    .catch(()=>{if(!lifetime.controller.signal.aborted)setNavigationFailed(true);});};
  const onCreateTask=host.publish?()=>setCreateOpen(true):undefined;
  const onCreatePullRequest=canCreateReview?()=>setCreateReviewOpen(true):undefined;
  const tabs=<RepositoryWorkspaceTabs host={host} project={project} repository={repository} items={items} issues={issues} pullRequests={pullRequests}
    tab={tab} git={git} commitHash={commitHash} filePath={filePath} onBack={onBack} onTabChange={onTabChange} open={open} onSelectCommit={onSelectCommit}
    onCreateTask={onCreateTask} onCreatePullRequest={onCreatePullRequest}/>;
  return <>
    {host.git&&git.branchActions.available?<ProjectBranchActionDialogs actions={git.branchActions} activeBranch={git.activeBranch}
      activeBranchCommit={git.activeBranchCommit} existingBranches={git.branchOptions}/>:null}
    <ProjectDetailPanelLayout state={panel} panel={<ProjectRepositoryContextPanel activeTab={tab} fetch={host.git?git.fetch:undefined} host={host}
      identityPubkey={snapshot.viewerPubkey} issues={issues} onCreatePullRequest={onCreatePullRequest} onCreateTask={onCreateTask}
      onRepositoryChange={onRepositoryChange} project={project} projects={snapshot.projects} pullRequests={pullRequests} repository={repository}
      snapshot={host.git?git.snapshot:undefined} sourceControls={host.git?git.sourceControls:undefined}
      widthPx={panel.width.widthPx} onResizeStart={panel.width.onResizeStart} canResetWidth={panel.width.canReset} onResetWidth={panel.width.onResetWidth}/>}>
      {navigationFailed?<p role="alert">{t("platform.loadFailed")}</p>:null}
      {renderWorkItems?renderWorkItems(tabs,snapshot.viewerPubkey):tabs}
    </ProjectDetailPanelLayout>
    {canCreateReview&&createReviewOpen?<CreatePullRequestDialog host={host} initialProjectId={project.id} initialRepositoryId={repository.id}
      projects={snapshot.projects} workItems={snapshot.items} open onOpenChange={setCreateReviewOpen}
      onCreated={(_project,_repository,pullRequestId)=>open({pullRequestId})}/>:null}
    <CreateIssueDialog open={createOpen} onOpenChange={setCreateOpen} isCreating={creating} projectName={repository.name}
      onCreate={async input=>{
        if(sending.current)throw new TransportError(t("projects.issue.unknown"));
        sending.current=true;setCreating(true);
        try{
          const result=await publishProjectIssue(host,project.id,repository,input,lifetime.controller.signal);
          lifetime.controller.signal.throwIfAborted();
          cache.setQueryData(["project-home-work-items",host.scopeKey,project.id],result.snapshot);
          result.complete();setCreateOpen(false);toast.success(t("projects.issue.created"));
          // A confirmed write is not reissued if navigation fails afterwards.
          open({issueId:result.eventId});
        }catch(error){throw new Error(t(isOutcomeUnknown(error)?"projects.issue.unknown":"projects.issue.createFailed"));}
        finally{sending.current=false;if(!lifetime.controller.signal.aborted)setCreating(false);}
      }}/>
  </>;
}

/** The original WorkspaceTabs bodies over the work-item read and the shared git state. */
function RepositoryWorkspaceTabs({host,project,repository,items,issues,pullRequests,tab,git,commitHash,filePath,onBack,onTabChange,open,onSelectCommit,onCreateTask,onCreatePullRequest}:{
  host:ProjectsHost;project:Project;repository:Project["repositories"][number];items:ProjectInboxWorkItem[];issues:ProjectIssue[];pullRequests:ProjectPullRequest[];
  tab:ProjectWorkspaceTab;git:ReturnType<typeof useRepositoryGitState>;commitHash:string|null;filePath?:string;
  onBack:()=>void;onTabChange:(tab:ProjectWorkspaceTab)=>void;open:(target:ProjectWorkItemTarget)=>void;onSelectCommit:(hash:string|null)=>void;
  onCreateTask?:()=>void;onCreatePullRequest?:()=>void;
}) {
  const t=useUiT();
  const discussions=Boolean(usePulseHost().discussions);
  const people=useProjectDetailPeople({issues,pullRequests,repository});
  const profiles=people.profiles;
  const content=tab==="issues"?<ProjectIssuesPanel issueItems={items.flatMap(item=>item.type==="issue"?[{issue:item.issue,project:item.repository}]:[])}
      selectedIssueId={null} onSelectedIssueIdChange={id=>{if(id)open({issueId:id});}} profiles={profiles}/>
    :tab==="prs"?<PullRequestsPanel project={repository} pullRequests={pullRequests}
      selectedPullRequest={null} onSelectedPullRequestIdChange={id=>{if(id)open({pullRequestId:id});}} profiles={profiles}/>
    :tab==="channels"?(discussions?<DiscussionChannelsPanel query={repositoryDiscussionQuery(repository)} repositoryName={repository.name}/>
      :<ProjectPanelState error title={t("projects.unavailable")}/>)
    :<RepositoryGitContent state={git} repository={repository} projectId={project.id} pullRequests={pullRequests} tab={tab}
      commitHash={commitHash} filePath={filePath} onSelectedCommitHashChange={onSelectCommit} profiles={profiles}
      contributorActivityCounts={people.contributorActivityCounts} contributorPubkeys={people.contributorPubkeys}/>;
  return <WorkspaceTabs tab={tab} onTabChange={onTabChange} onBack={onBack} git={Boolean(host.git)} channels={discussions}
    onCreateTask={tab==="issues"?onCreateTask:undefined} onCreatePullRequest={tab==="prs"?onCreatePullRequest:undefined}
    detailSelected={tab==="activity"&&Boolean(commitHash)}
    sectionHeader={isProjectGitWorkspaceTab(tab)?repositoryGitSectionHeader(tab,git,commitHash,t):undefined}>
    {projectWorkspaceTabNeedsGit(tab)&&!host.git?<ProjectPanelState error title={t("projects.unavailable")}/>:content}
  </WorkspaceTabs>;
}

function ProjectWorkItemPage({host,projectId,target,renderWorkItems,onOpen,onDiscussInChannel}:{host:ProjectsHost;projectId?:string|null;target:ProjectWorkItemTarget;renderWorkItems:ProjectsViewProps["renderWorkItems"];onOpen:ProjectsViewProps["onSelectedProjectChange"];onDiscussInChannel?:ProjectDiscussInChannel}) {
  const t=useUiT();const cache=useQueryClient();
  const query=useQuery({queryKey:["project-work-item-target",host.scopeKey,projectId,target],
    queryFn:({signal})=>loadProjectWorkItems(host,signal),retry:false,refetchOnWindowFocus:"always"});
  useEffect(()=>()=>{void cache.cancelQueries({queryKey:["project-work-item-target",host.scopeKey]});cache.removeQueries({queryKey:["project-work-item-target",host.scopeKey]});},[cache,host.scopeKey]);
  const workItem=query.isSuccess&&!query.isFetching?resolveProjectWorkItemTarget(query.data.items,projectId,target):undefined;
  const detail=workItem?<ProjectWorkItemDetail key={workItem.type==="issue"?workItem.issue.id:workItem.pullRequest.id} workItem={workItem} host={host} onOpen={onOpen} onDiscussInChannel={onDiscussInChannel}/>:null;
  if(workItem&&(workItem.type==="issue"||onDiscussInChannel))return <>{renderWorkItems?renderWorkItems(detail,query.data!.viewerPubkey):detail}</>;
  // Original ProjectDetailScreen scroll chain and selected WorkspaceTabs detail
  // branch. Git, other tabs, and writes remain separately un-restored.
  return <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden [container-type:inline-size]">
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-none px-4 pb-4" data-testid="project-detail-scroll">
      <div className="flex min-h-full w-full flex-col space-y-3">
        {query.isPending||query.isFetching?<ProjectPanelState title={t("platform.loading")}/>:!workItem?<ProjectPanelState error title={t(query.isError?"platform.loadFailed":"projects.unavailable")}/>:<div className="m-0" data-project-detail-panel>
          {renderWorkItems?renderWorkItems(detail,query.data!.viewerPubkey):detail}
        </div>}
      </div>
    </div>
  </div>;
}

function ProjectWorkItemDetail({workItem,host,onOpen,onDiscussInChannel}:{workItem:ProjectInboxWorkItem;host:ProjectsHost;onOpen:ProjectsViewProps["onSelectedProjectChange"];onDiscussInChannel?:ProjectDiscussInChannel}) {
  const [createOpen,setCreateOpen]=useState(false);
  const item=workItem.type==="issue"?workItem.issue:workItem.pullRequest;
  const channelId=workItem.repository.channelId??workItem.project.projectChannelId;
  const profiles=useUsersBatchQuery([item.author,...item.comments.map(comment=>comment.author),...(workItem.type==="issue"?workItem.issue.assignees:[...workItem.pullRequest.reviewers,...workItem.pullRequest.updates.map(update=>update.author)])]).data?.profiles;
  return workItem.type==="issue"?<>
    <ProjectIssueDetail issue={workItem.issue} profiles={profiles} publication={{host,projectId:workItem.project.id,repository:workItem.repository}}
      contextPanel={{channelId,onCreateTask:host.publish&&onOpen?()=>setCreateOpen(true):undefined,onDiscussInChannel}}/>
    {host.publish&&onOpen?<CreateProjectIssueDialog host={host} initialProjectId={workItem.project.id} initialRepositoryId={workItem.repository.id} projects={[workItem.project]}
      open={createOpen} onOpenChange={setCreateOpen} onCreated={(project,repo,issueId)=>onOpen(project.id,{repositoryId:repo.id,issueId})}/>:null}
  </>:<PullRequestWorkItemDetail workItem={workItem} host={host} profiles={profiles} contextPanel={onDiscussInChannel?{channelId,onDiscussInChannel}:undefined}/>;
}

// Original WorkspaceTabs selected-review branch: Files changed from the review diff (DD-118).
function PullRequestWorkItemDetail({workItem,host,profiles,contextPanel}:{workItem:Extract<ProjectInboxWorkItem,{type:"pull-request"}>;host:ProjectsHost;
  profiles?:UserProfileLookup;contextPanel?:ComponentProps<typeof ProjectPullRequestDetail>["contextPanel"]}) {
  const files=useReviewFilesChanged(host,workItem.repository,workItem.pullRequest);
  return <ProjectPullRequestDetail project={workItem.repository} pullRequest={workItem.pullRequest} profiles={profiles} publication={{host,projectId:workItem.project.id}}
    contextPanel={contextPanel} filesChanged={files?.filesChanged} filesCount={files?.filesCount} diffStats={files?.diffStats}/>;
}

function ProjectWorkItemsList({host,query,filter,search,sort,view,onOpen,renderWorkItems}:{host:ProjectsHost;query:ProjectWorkItemsQuery;filter:"issues"|"prs";search:string;sort:ProjectsSort;view:ProjectsViewMode;onOpen:NonNullable<ProjectsViewProps["onSelectedProjectChange"]>;renderWorkItems:ProjectsViewProps["renderWorkItems"]}) {
  const t=useUiT();
  const [navigationFailed,setNavigationFailed]=useState(false);
  const lifetime=useMemo(()=>({active:true}),[host]);
  useEffect(()=>{lifetime.active=true;return()=>{lifetime.active=false;};},[lifetime]);
  // A stale cache or failed section never becomes an accessible/empty list.
  const items=query.isSuccess&&!query.isFetching?query.data.items:[];
  const visible=items.filter(item=>{
    const value=item.type==="issue"?item.issue:item.pullRequest;
    return (filter==="issues"?item.type==="issue":item.type==="pull-request")&&matchesProjectsSearch(search,[value.title,value.content,value.status,item.project.name,item.repository.name]);
  }).sort((a,b)=>{
    const left=a.type==="issue"?a.issue:a.pullRequest;const right=b.type==="issue"?b.issue:b.pullRequest;
    if(sort==="name")return left.title.localeCompare(right.title);
    if(sort==="created")return right.createdAt-left.createdAt;
    return right.updatedAt-left.updatedAt;
  });
  const open=(project:Project,repository:Project["repositories"][number],target:{id:string})=>{
    void Promise.resolve().then(()=>{if(lifetime.active)return onOpen(project.id,{repositoryId:repository.id,...(filter==="issues"?{issueId:target.id}:{pullRequestId:target.id})});})
      .catch(()=>{if(lifetime.active)setNavigationFailed(true);});
  };
  const content=<ProjectWorkItemsContent items={visible} filter={filter} view={view} search={search} onOpen={open}/>;
  const retry=<Button onClick={()=>{void query.refetch();}} size="sm" variant="outline">{t("projects.list.retry")}</Button>;
  return <>
    {navigationFailed?<p role="alert">{t("platform.loadFailed")}</p>:null}
    {query.isPending||query.isFetching?<BuzzLoadingState label={t(filter==="issues"?"projects.sheet.loadingTasks":"projects.sheet.loadingReviews")}/>:query.isError?
      <ProjectPanelState error panel={false} title={t(filter==="issues"?"projects.list.tasksFailed":"projects.list.reviewsFailed")} description={t("projects.list.relayFailed")} action={retry}/>:
      renderWorkItems?renderWorkItems(content,query.data.viewerPubkey):content}
  </>;
}

function ProjectWorkItemsContent({items,filter,view,search,onOpen}:{items:ProjectInboxWorkItem[];filter:"issues"|"prs";view:ProjectsViewMode;search:string;onOpen:(project:Project,repository:Project["repositories"][number],target:{id:string})=>void}) {
  const t=useUiT();
  const profiles=useUsersBatchQuery(items.map(item=>item.type==="issue"?item.issue.author:item.pullRequest.author)).data?.profiles;
  const common={profiles,viewMode:view,embedded:view==="list",onOpen};
  // One block child inside the work-item host's flex row.
  return <div className="min-w-0 flex-1">{filter==="issues"?<ProjectsIssuesList {...common} issues={items.filter(item=>item.type==="issue")} emptyMessage={search.trim()?t("projects.list.tasksNoMatch"):undefined}/>:
    <ProjectsPullRequestsList {...common} pullRequests={items.filter(item=>item.type==="pull-request")} emptyMessage={search.trim()?t("projects.list.reviewsNoMatch"):undefined}/>}</div>;
}

type ProjectWorkItemsSnapshot=Awaited<ReturnType<typeof loadProjectWorkItems>>;
type ProjectWorkItemsQuery=UseQueryResult<ProjectWorkItemsSnapshot>;

// Original ProjectsView constants.
const PROJECTS_CONTEXT_POD_MIN_VIEWPORT_PX=1024;
// desktop/src/features/projects/ui/useProjectPanelWidths.ts::PROJECT_CONTEXT_PANEL_DEFAULT_WIDTH_PX
const PROJECT_CONTEXT_PANEL_DEFAULT_WIDTH_PX=280;
// desktop/src/features/projects/ui/projectPanelStyles.ts::PROJECT_COLUMN_HEADER_BACKDROP_CLASS
const PROJECT_COLUMN_HEADER_BACKDROP_CLASS="bg-background/80 backdrop-blur-md supports-backdrop-filter:bg-background/70 dark:bg-background/70 dark:backdrop-blur-xl dark:supports-backdrop-filter:bg-background/55";

// Original ProjectsView filter "all": ProjectsOverviewPanel > ProjectsActivityIntro
// + ProjectsWorkItemsLoadNotice + ProjectsActivityFeed, over the same work-item
// read and cache key as the Tasks/Reviews sections.
function ProjectsActivityOverview({host,query,search,onOpenProject,onOpen,renderWorkItems}:{host:ProjectsHost;query:ProjectWorkItemsQuery;search:string;onOpenProject:(project:Project)=>void;
  onOpen:NonNullable<ProjectsViewProps["onSelectedProjectChange"]>;renderWorkItems:ProjectsViewProps["renderWorkItems"]}) {
  const t=useUiT();
  const [navigationFailed,setNavigationFailed]=useState(false);
  const lifetime=useMemo(()=>({active:true}),[host]);
  useEffect(()=>{lifetime.active=true;return()=>{lifetime.active=false;};},[lifetime]);
  const open=(project:Project,target:ProjectWorkItemTarget)=>{
    void Promise.resolve().then(()=>{if(lifetime.active)return onOpen(project.id,target);})
      .catch(()=>{if(lifetime.active)setNavigationFailed(true);});
  };
  // A stale cache or failed read never becomes an empty or partial timeline.
  const snapshot=query.isSuccess&&!query.isFetching?query.data:undefined;
  const content=snapshot?<ProjectsActivityBody snapshot={snapshot} search={search} onOpenProject={onOpenProject} onOpen={open}/>:null;
  return <>
    {navigationFailed?<p role="alert">{t("platform.loadFailed")}</p>:null}
    <ProjectsOverviewPanel>
      {query.isError?<ProjectsWorkItemsLoadNotice error={query.error} isRetrying={query.isFetching} onRetry={()=>{void query.refetch();}}/>
        :!snapshot?<BuzzLoadingState label={t("projects.activity.loading")}/>
        :renderWorkItems?renderWorkItems(content,snapshot.viewerPubkey):content}
    </ProjectsOverviewPanel>
  </>;
}

function ProjectsActivityBody({snapshot,search,onOpenProject,onOpen}:{snapshot:ProjectWorkItemsSnapshot;search:string;
  onOpenProject:(project:Project)=>void;onOpen:(project:Project,target:ProjectWorkItemTarget)=>void}) {
  const t=useUiT();
  // Original overview counts only explicit projects; standalone repositories
  // remain part of the read model for the work items they own.
  const projects=useMemo(()=>snapshot.projects.filter(project=>!project.legacy),[snapshot]);
  const issues=useMemo(()=>snapshot.items.filter((item):item is Extract<ProjectInboxWorkItem,{type:"issue"}>=>item.type==="issue"),[snapshot]);
  const pullRequests=useMemo(()=>snapshot.items.filter((item):item is Extract<ProjectInboxWorkItem,{type:"pull-request"}>=>item.type==="pull-request"),[snapshot]);
  const summaries=useMemo(()=>projectActivitySummaries(snapshot.events,projects),[snapshot,projects]);
  const now=useNow(600_000);
  const digest=useMemo(()=>buildProjectsActivityDigest({issues,nowSeconds:Math.floor(now/1_000),projects,pullRequests,summaries,t}),[issues,now,projects,pullRequests,summaries,t]);
  const pubkeys=useMemo(()=>projectsActivityPubkeys({issues,projects,pullRequests}),[issues,projects,pullRequests]);
  const profiles=useUsersBatchQuery(pubkeys,{enabled:pubkeys.length>0}).data?.profiles;
  // The work-item host wraps its children in a flex row (for its profile
  // panel); keep the original stacked intro + timeline as one block child.
  return <div className="min-w-0 flex-1">
    <ProjectsActivityIntro digest={digest}/>
    <section className="space-y-3">
      <ProjectsActivityFeed issues={issues} pullRequests={pullRequests} projects={projects} profiles={profiles} searchQuery={search}
        onOpenProject={onOpenProject}
        onOpenIssue={(project,repository,issue)=>onOpen(project,{repositoryId:repository.id,issueId:issue.id})}
        onOpenPullRequest={(project,repository,pullRequest)=>onOpen(project,{repositoryId:repository.id,pullRequestId:pullRequest.id})}/>
    </section>
  </div>;
}

// Original ProjectsOverviewItems.tsx::ProjectsOverviewProjectItems: Mine / Other
// projects collection groups over the responsive card grid or list rows.
const RESPONSIVE_CARD_GRID_CLASS="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr))]";
type ProjectItemActivity={people:string[];profiles?:UserProfileLookup;summary:ProjectActivitySummary|undefined};
function ProjectsOverviewProjectItems({visible,viewerPubkey,view,activityFor,renderRow}:{visible:Project[];viewerPubkey:string;view:ProjectsViewMode;
  activityFor:(project:Project)=>ProjectItemActivity|undefined;renderRow:(project:Project,activity:ProjectItemActivity|undefined)=>ReactNode}) {
  const t=useUiT();
  if(visible.length===0)return <EmptyFilteredState/>;
  const groups=[
    {items:visible.filter(project=>isProjectMine(project,viewerPubkey)),key:"mine",title:t("projects.group.mine")},
    {items:visible.filter(project=>!isProjectMine(project,viewerPubkey)),key:"other",title:t("projects.group.other")},
  ].filter(group=>group.items.length>0);
  return <div className="space-y-0" data-testid={view==="list"?"projects-list-container":undefined}>
    {groups.map(group=><ProjectSelectableGroup contentClassName="mt-2 space-y-0" count={group.items.length} groupKey={group.key}
      headerClassName="mx-0 gap-3 px-3" headerTestId="projects-collection-group-header" icon={<Folders className="h-4 w-4"/>} key={group.key}
      label={group.title} labelClassName="text-sm font-normal text-foreground/80" labelTestId="projects-collection-group-label" testId="projects-collection-group">
      {view==="grid"?<div className={RESPONSIVE_CARD_GRID_CLASS}>
        {group.items.map(project=><div className="[contain-intrinsic-size:auto_11rem] [content-visibility:auto]" key={project.id}>{renderRow(project,activityFor(project))}</div>)}
      </div>:<div>
        {group.items.map(project=><div className="[contain-intrinsic-size:auto_3.5rem] [content-visibility:auto]" key={project.id}>{renderRow(project,activityFor(project))}</div>)}
      </div>}
    </ProjectSelectableGroup>)}
  </div>;
}

// Profiles for the original people stacks come from the work-item host.
function ProjectsOverviewProjectItemsWithActivity({visible,viewerPubkey,view,summaries,renderRow}:{visible:Project[];viewerPubkey:string;view:ProjectsViewMode;
  summaries:Record<string,ProjectActivitySummary>;renderRow:(project:Project,activity:ProjectItemActivity|undefined)=>ReactNode}) {
  // Identity-stable people arrays keep memoized cards from re-rendering.
  const peopleByProject=useMemo(()=>new Map(visible.map(project=>[project.id,projectPeople(project,summaries[project.id])])),[summaries,visible]);
  const pubkeys=useMemo(()=>[...new Set([...peopleByProject.values()].flat())],[peopleByProject]);
  const profiles=useUsersBatchQuery(pubkeys,{enabled:pubkeys.length>0}).data?.profiles;
  // One block child inside the work-item host's flex row.
  return <div className="min-w-0 flex-1"><ProjectsOverviewProjectItems visible={visible} viewerPubkey={viewerPubkey} view={view} renderRow={renderRow}
    activityFor={project=>({people:peopleByProject.get(project.id)??[],profiles,summary:summaries[project.id]})}/></div>;
}

type RepositoryRow={project:Project;repository:Project["repositories"][number]};
const NO_PROJECTS:Project[]=[];
// Unique repositories of the directory read models (original visibleRepositories).
function directoryRepositories(projects:Project[]):RepositoryRow[] {
  return [...new Map(projects.flatMap(project=>project.repositories.map(repository=>({project,repository})))
    .map(item=>[item.repository.repoAddress,item])).values()];
}
function repositoryIsMine(repository:Project["repositories"][number],currentPubkey:string) {
  const viewer=normalizePubkey(currentPubkey);
  return normalizePubkey(repository.owner)===viewer||repository.contributors.some(pubkey=>normalizePubkey(pubkey)===viewer);
}

// Original ProjectsOverviewItems.tsx::ProjectsOverviewRepositoryItems: Mine / Other
// repositories collection groups. Opening a repository uses the restored
// repository workspace (Tasks/Review); Git Overview/Files/Commits tabs are not
// part of the shared governed read.
function ProjectsOverviewRepositoryItems({visible,viewerPubkey,view,summaries,profiles,canCopyLink,onOpen}:{visible:RepositoryRow[];viewerPubkey:string;view:ProjectsViewMode;
  summaries?:Record<string,ProjectActivitySummary>;profiles?:UserProfileLookup;canCopyLink:boolean;onOpen:(project:Project,repository:Project["repositories"][number])=>void}) {
  const t=useUiT();
  if(visible.length===0)return <EmptyFilteredState/>;
  const groups=[
    {items:visible.filter(row=>repositoryIsMine(row.repository,viewerPubkey)),key:"mine",title:t("projects.group.mine")},
    {items:visible.filter(row=>!repositoryIsMine(row.repository,viewerPubkey)),key:"other",title:t("projects.group.otherRepositories")},
  ].filter(group=>group.items.length>0);
  return <div className="min-w-0 flex-1 space-y-0" data-testid={view==="list"?"projects-list-container":undefined}>
    {groups.map(group=><ProjectSelectableGroup contentClassName="mt-2 space-y-0" count={group.items.length} groupKey={group.key}
      headerClassName="mx-0 gap-3 px-3" headerTestId="projects-collection-group-header" icon={<FolderGit2 className="h-4 w-4"/>} key={group.key}
      label={group.title} labelClassName="text-sm font-normal text-foreground/80" labelTestId="projects-collection-group-label" testId="projects-collection-group">
      {view==="grid"?<div className={RESPONSIVE_CARD_GRID_CLASS}>
        {group.items.map(({project,repository})=><div className="[contain-intrinsic-size:auto_11rem] [content-visibility:auto]" key={repository.repoAddress}>
          <RepositoryGridCard project={project} repository={repository} summary={summaries?.[repository.repoAddress]} profiles={profiles} onOpen={onOpen} canCopyLink={canCopyLink}/></div>)}
      </div>:<div>
        {group.items.map(({project,repository})=><div className="[contain-intrinsic-size:auto_3.5rem] [content-visibility:auto]" key={repository.repoAddress}>
          <RepositoryListRow project={project} repository={repository} summary={summaries?.[repository.repoAddress]} profiles={profiles} onOpen={onOpen} canCopyLink={canCopyLink}/></div>)}
      </div>}
    </ProjectSelectableGroup>)}
  </div>;
}

function ProjectsOverviewRepositoryItemsWithActivity(props:Omit<ComponentProps<typeof ProjectsOverviewRepositoryItems>,"profiles"|"canCopyLink">&{summaries:Record<string,ProjectActivitySummary>}) {
  const pubkeys=useMemo(()=>[...new Set(props.visible.flatMap(({repository})=>[repository.owner,...repository.contributors,
    ...(props.summaries[repository.repoAddress]?.participantPubkeys??[])].map(normalizePubkey)))],[props.visible,props.summaries]);
  const profiles=useUsersBatchQuery(pubkeys,{enabled:pubkeys.length>0}).data?.profiles;
  return <ProjectsOverviewRepositoryItems {...props} profiles={profiles} canCopyLink/>;
}

// Original ProjectsView context rail: the section-following ProjectsOverviewContextPanel
// over the same directory and work-item reads; profiles come from the work-item host.
function ProjectsOverviewContextRailContent({snapshot,projectReadModels,filter,onSelectSection,onCreateIssue,onCreatePullRequest,onCreateProject,onAddChannel,onAddRepository,canCreateTarget}:{snapshot:ProjectWorkItemsSnapshot;
  projectReadModels:Project[];filter:ProjectsFilter;onSelectSection:(section:ProjectsOverviewSection)=>void;onCreateIssue?:()=>void;onCreatePullRequest?:()=>void;onCreateProject?:()=>void;
  onAddChannel?:()=>void;onAddRepository?:()=>void;canCreateTarget:boolean}) {
  const projects=useMemo(()=>snapshot.projects.filter(project=>!project.legacy),[snapshot]);
  const issues=useMemo(()=>snapshot.items.flatMap(item=>item.type==="issue"?[item.issue]:[]),[snapshot]);
  const pullRequests=useMemo(()=>snapshot.items.flatMap(item=>item.type==="pull-request"?[item.pullRequest]:[]),[snapshot]);
  const summaries=useMemo(()=>projectActivitySummaries(snapshot.events,projects),[snapshot,projects]);
  const repositorySummaries=useMemo(()=>repositoryActivitySummaries(snapshot.events,directoryRepositories(projectReadModels).map(row=>row.repository)),[snapshot,projectReadModels]);
  const people=useMemo(()=>projectsOverviewContext({filter,issues,projectReadModels,projects,pullRequests,repositorySummaries,summaries}).people,[filter,issues,projectReadModels,projects,pullRequests,repositorySummaries,summaries]);
  const profiles=useUsersBatchQuery(people,{enabled:people.length>0}).data?.profiles;
  return <div className="min-w-0 flex-1"><ProjectsOverviewContextPanel filter={filter} issues={issues} projectReadModels={projectReadModels} projects={projects} pullRequests={pullRequests}
    repositorySummaries={repositorySummaries} summaries={summaries} profiles={profiles} onSelectSection={onSelectSection} onCreateIssue={onCreateIssue} onCreatePullRequest={onCreatePullRequest} onCreateProject={onCreateProject}
    onAddChannel={onAddChannel} onAddRepository={onAddRepository} canCreateTarget={canCreateTarget}/></div>;
}

function ProjectDirectory({host,selectedProjectId,onSelectedProjectChange,onOpenChannel,lastMessageAtByChannelId,renderMember,renderWorkItems,renderChannel}:ProjectsViewProps) {
  const t=useUiT(); const cache=useQueryClient();const client=useBffClient();
  const [search,setSearch]=useState("");
  const [filter,setFilter]=useState<ProjectsFilter>(()=>{
    const stored=readStoredFilter();
    return stored==="channels"&&!onOpenChannel||(stored==="all"||stored==="issues"||stored==="prs")&&!onSelectedProjectChange?"projects":stored;
  });
  const [view,setView]=useState<ProjectsViewMode>(()=>readStoredViewMode()??"grid");
  const [sort,setSort]=useState<ProjectsSort>(()=>readStoredSort());
  const [createOpen,setCreateOpen]=useState(false);
  const [createIssueOpen,setCreateIssueOpen]=useState(false);
  const [createReviewOpen,setCreateReviewOpen]=useState(false);
  const [createChannelOpen,setCreateChannelOpen]=useState(false);
  const [createRepositoryOpen,setCreateRepositoryOpen]=useState(false);
  const [navigationFailed,setNavigationFailed]=useState<"created"|"open"|null>(null);
  const creation=useCreateProject(host);
  const sidebar=useOptionalSidebar();
  const {handleContentScroll,scrollIndicatorRef}=useProjectsScrollIndicator();
  const [overviewPanelOpen,setOverviewPanelOpen]=useState(true);
  const [narrowContextOpen,setNarrowContextOpen]=useState(false);
  const contextToggleRef=useRef<HTMLButtonElement|null>(null);
  const isNarrowProjectsLayout=useMediaBreakpoint(PROJECTS_CONTEXT_POD_MIN_VIEWPORT_PX);
  const lifetime=useMemo(()=>({active:true}),[host]);
  useEffect(()=>{lifetime.active=true;return()=>{lifetime.active=false;};},[lifetime]);
  const [localSelected,setLocalSelected]=useState<string|null>(null);
  const selected=selectedProjectId===undefined?localSelected:selectedProjectId;
  const setSelected=async(id:string|null)=>{if(!lifetime.active)return;await onSelectedProjectChange?.(id);if(lifetime.active)setLocalSelected(id);};
  // One work-item read feeds Activity, Tasks, Reviews and the context rail;
  // an open project home owns its own scoped read.
  const workItems=useQuery({queryKey:["projects-work-items",host.scopeKey],enabled:Boolean(onSelectedProjectChange)&&!selected,
    queryFn:({signal})=>loadProjectWorkItems(host,signal),retry:false,refetchOnWindowFocus:"always"});
  useEffect(()=>()=>{void cache.cancelQueries({queryKey:["projects-work-items",host.scopeKey]});cache.removeQueries({queryKey:["projects-work-items",host.scopeKey]});},[cache,host.scopeKey]);
  const query=useQuery({queryKey:["projects",host.scopeKey],queryFn:({signal})=>loadProjectDirectory(host,signal),retry:false,refetchOnWindowFocus:"always"});
  const createCapability=useQuery({queryKey:["project-create-capability",host.scopeKey],queryFn:()=>client.roleWorkspaces(),
    enabled:Boolean(host.publish)&&query.isSuccess&&!query.isFetching,retry:false,refetchOnWindowFocus:"always"});
  useEffect(()=>()=>{void cache.cancelQueries({queryKey:["projects",host.scopeKey]});cache.removeQueries({queryKey:["projects",host.scopeKey]});},[cache,host.scopeKey]);
  // A failed fresh read must not keep a previously accessible announcement open.
  const projects=query.isSuccess&&!query.isFetching?query.data.projects:NO_PROJECTS;
  const workSnapshot=workItems.isSuccess&&!workItems.isFetching?workItems.data:undefined;
  // Original per-project activity summaries over the completed work-item read;
  // absent while loading or failed, never a zero-activity stand-in.
  const directorySummaries=useMemo(()=>workSnapshot?projectActivitySummaries(workSnapshot.events,projects):undefined,[workSnapshot,projects]);
  // Recent-activity order needs those summaries; otherwise the visible order
  // falls back to the creation date without rewriting the stored preference.
  const effectiveSort=sort==="updated"&&filter!=="issues"&&filter!=="prs"&&!directorySummaries?"created":sort;
  const active=projects.find(project=>project.id===selected);
  // Original editableProjects: the viewer's own explicit projects (no Agent signs for a Human).
  const viewerPubkey=query.isSuccess&&!query.isFetching?query.data.viewerPubkey:undefined;
  const editableProjects=useMemo(()=>projects.filter(project=>!project.legacy&&project.owner===viewerPubkey),[projects,viewerPubkey]);
  // Original Projects section lists explicit projects; standalone repositories
  // belong to the Repositories section.
  const visible=projects.filter(project=>!project.legacy).filter(project=>matchesProjectsSearch(search,[
    project.name,project.description,...project.repositories.flatMap(repo=>[repo.name,repo.description]),
  ]))
    .sort((a,b)=>effectiveSort==="name"?a.name.localeCompare(b.name):effectiveSort==="created"?b.createdAt-a.createdAt
      :getProjectUpdatedAt(b,directorySummaries?.[b.id])-getProjectUpdatedAt(a,directorySummaries?.[a.id]));
  const repositorySummaries=useMemo(()=>workSnapshot?repositoryActivitySummaries(workSnapshot.events,directoryRepositories(projects).map(row=>row.repository)):undefined,[workSnapshot,projects]);
  const visibleRepositories=directoryRepositories(projects).filter(({project,repository})=>matchesProjectsSearch(search,[repository.name,repository.description,project.name]))
    .sort((left,right)=>effectiveSort==="name"?left.repository.name.localeCompare(right.repository.name)
      :effectiveSort==="created"?right.repository.createdAt-left.repository.createdAt
      :(repositorySummaries?.[right.repository.repoAddress]?.updatedAt??right.repository.createdAt)-(repositorySummaries?.[left.repository.repoAddress]?.updatedAt??left.repository.createdAt));
  const openRepository=(project:Project,repository:Project["repositories"][number])=>{
    if(!onSelectedProjectChange)return;
    void Promise.resolve(onSelectedProjectChange(project.id,{repositoryId:repository.id,tab:"issues"})).catch(()=>{if(lifetime.active)setNavigationFailed("open");});
  };
  const canCreate=Boolean(host.publish&&query.isSuccess&&!query.isFetching&&(
    createCapability.isSuccess&&!createCapability.isFetching&&createCapability.data.createActionKey===CreateActionKey.WorkspaceCreate||creation.intent));
  const onOpen=(project:Project)=>{void setSelected(project.id).catch(()=>{if(lifetime.active)setNavigationFailed("open");});};
  const changeView=(next:ProjectsViewMode)=>{setView(next);writeStoredViewMode(next);};
  const changeFilter=(next:ProjectsFilter)=>{setFilter(next);writeStoredFilter(next);};
  const changeSort=(next:ProjectsSort)=>{setSort(next);writeStoredSort(next);};
  const invalidateProjects=()=>Promise.all([
    cache.invalidateQueries({queryKey:["projects",host.scopeKey]}),
    cache.invalidateQueries({queryKey:["sidebar-projects",host.scopeKey]}),
  ]);
  const projectRow=(project:Project,activity?:ProjectItemActivity)=>{
    const row=(actions?:ReactNode)=>view==="grid"?<ProjectGridCard project={project} onOpen={onOpen} actions={actions} activity={activity}/>
      :<ProjectListRow project={project} onOpen={onOpen} actions={actions} activity={activity}/>;
    // Use the same winning replaceable event as projectModels (timestamp, then
    // lowest event ID). A stale earlier revision must not be deletion's target.
    const head=[...query.data!.projectEvents,...query.data!.repositoryEvents]
      .filter(event=>`${event.kind}:${event.pubkey}:${event.tags.find(tag=>tag[0]==="d")?.[1]}`===project.projectAddress)
      .sort((a,b)=>b.created_at-a.created_at||a.id.localeCompare(b.id))[0];
    // Original ProjectActionsMenu: Copy link and Delete project (disabled unless
    // this viewer may delete). The copy action uses the work-item host, present
    // with activity; the native terminal action has no shared consumer.
    const link=activity?projectShareLink(project):null;
    const menu=(deleteItem:ReactNode)=><ProjectListRowMenu label={t("projects.moreOptions",{name:project.name})}>
      {link?<CopyShareLinkMenuItem label={t("buzz.copyLink")} link={link} testId={`project-copy-link-${project.dtag}`}/>:null}
      {deleteItem}
    </ProjectListRowMenu>;
    return host.publish&&project.owner===query.data?.viewerPubkey&&head?<ProjectDeleteAction key={project.id} project={project}
      headId={head.id} viewerPubkey={query.data.viewerPubkey} host={host} onDeleted={()=>{
        if(!lifetime.active)return;
        if(selected===project.id)void setSelected(null).catch(()=>{if(lifetime.active)setNavigationFailed("open");});
        void invalidateProjects();
      }} renderTrigger={({onOpen:onDelete,pending})=>row(menu(
        <DropdownMenuItem className="text-destructive focus:text-destructive" disabled={pending}
          onSelect={event=>{event.preventDefault();event.stopPropagation();onDelete();}}><Trash2 className="h-4 w-4"/>{t("projects.delete")}</DropdownMenuItem>))}/>
      :<Fragment key={project.id}>{row(link?menu(<DropdownMenuItem className="text-destructive focus:text-destructive" disabled>
        <Trash2 className="h-4 w-4"/>{t("projects.delete")}</DropdownMenuItem>):undefined)}</Fragment>;
  };
  // Original ProjectDetailScreen: a project with an authoritative home binding opens its channel
  // home; otherwise its primary repository surface, or the original unavailable states.
  if (selected) {
    const back=()=>{void setSelected(null).catch(()=>{if(lifetime.active)setNavigationFailed("open");});};
    if (!active) return query.isPending||query.isFetching ? <ProjectPanelState title={t("platform.loading")}/>
      : query.isError ? <ProjectDetailUnavailableState kind="load-error" onBack={back} onRetry={()=>{void query.refetch();}}/>
      : <ProjectDetailUnavailableState kind="not-found" onBack={back}/>;
    if (hasAuthoritativeHomeBinding(active)) return renderChannel && onOpenChannel
      ? <ProjectChannelHome key={`${host.scopeKey}:${active.id}`} project={active} projects={projects} scopeKey={host.scopeKey} viewerPubkey={query.data?.viewerPubkey}
          renderChannel={renderChannel} onOpenChannel={onOpenChannel} onOpenProject={onSelectedProjectChange} onGoProjects={back} host={host} renderWorkItems={renderWorkItems}/>
      : <ProjectPanelState error title={t("projects.home.channelMissing")}/>;
    const repository=selectProjectRepository(active,null);
    if (!repository) return <ProjectDetailUnavailableState kind="repositories-unavailable" project={active}/>;
    return onSelectedProjectChange ? <ProjectRepositoryPage key={`${host.scopeKey}:${active.id}`} host={host} selectedProjectId={active.id}
        onSelectedProjectChange={onSelectedProjectChange} workItemTarget={{repositoryId:repository.id}} renderWorkItems={renderWorkItems}/>
      : <ProjectPanelState error title={t("projects.unavailable")}/>;
  }
  const createDialog=<CreateProjectDialog open={createOpen&&(canCreate||creation.busy)} onOpenChange={setCreateOpen} isCreating={creation.busy} frozen={creation.intent?.input}
      onCreate={async input=>{
        const project=await creation.create(input);
        if(!lifetime.active)return;
        await invalidateProjects();
        if(!lifetime.active)return;
        try{await setSelected(project.id);if(lifetime.active)setNavigationFailed(null);}
        catch{if(lifetime.active)setNavigationFailed("created");}
      }}/>;
  // Original ProjectsView: a failed directory read is a page-level error with
  // Retry (Kailo wording keeps the unknown outcome), not an empty section.
  if(query.isError&&!query.isFetching)return <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
    <p className="text-sm text-red-400" role="alert">{t("platform.loadFailed")}</p>
    <Button onClick={()=>{void query.refetch();}} size="sm" variant="outline">{t("projects.list.retry")}</Button>
  </div>;
  // Original ProjectsView: an empty directory is the page-level EmptyState,
  // without section tabs.
  if(query.isSuccess&&!query.isFetching&&projects.length===0)return <>
    {navigationFailed?<p role="alert">{t(navigationFailed==="created"?"projects.create.navigationFailed":"platform.loadFailed")}</p>:null}
    <EmptyState onCreateProject={canCreate?()=>setCreateOpen(true):undefined}/>
    {createDialog}
  </>;
  const contextAvailable=Boolean(onSelectedProjectChange);
  const explicitProjects=workSnapshot?workSnapshot.projects.filter(project=>!project.legacy):[];
  const categoryCreateAvailable=Boolean(host.publish&&onSelectedProjectChange);
  // Original goChannel after a project channel is created: re-read its admitted directory row.
  const openChannelById=(channelId:string)=>{
    if(!onOpenChannel)return;
    void loadChannelDirectory(client,()=>lifetime.active,channelId).then(rows=>{
      const row=rows.find(candidate=>candidate.isMember&&candidate.membershipState===WorkspaceMembershipState.Active);
      if(!row)throw new Error("Project channel membership changed");
      if(lifetime.active)return onOpenChannel(row);
    }).catch(()=>{if(lifetime.active)setNavigationFailed("open");});
  };
  const selectSection=(section:ProjectsOverviewSection)=>changeFilter(section);
  const railContent=workSnapshot&&query.isSuccess&&!query.isFetching?<ProjectsOverviewContextRailContent snapshot={workSnapshot} projectReadModels={projects} filter={filter}
    onSelectSection={section=>{selectSection(section);if(isNarrowProjectsLayout)setNarrowContextOpen(false);}}
    onCreateIssue={host.publish&&explicitProjects.length>0?()=>setCreateIssueOpen(true):undefined}
    onCreatePullRequest={host.publish&&host.git&&explicitProjects.length>0?()=>setCreateReviewOpen(true):undefined}
    onCreateProject={canCreate?()=>setCreateOpen(true):undefined}
    onAddChannel={categoryCreateAvailable?()=>setCreateChannelOpen(true):undefined}
    onAddRepository={categoryCreateAvailable?()=>setCreateRepositoryOpen(true):undefined}
    canCreateTarget={editableProjects.length>0}/>:null;
  const rail=railContent&&workSnapshot?renderWorkItems?renderWorkItems(railContent,workSnapshot.viewerPubkey):railContent:null;
  const overviewContextOpen=contextAvailable&&overviewPanelOpen&&!isNarrowProjectsLayout;
  const overviewDetached=overviewContextOpen;
  const chromeActions=!contextAvailable?null:isNarrowProjectsLayout?
    <ProjectsOverviewNarrowContextToggle onToggle={()=>setNarrowContextOpen(open=>!open)} open={narrowContextOpen} ref={contextToggleRef}/>:
    <ProjectsOverviewChromeActions contextOpen={overviewPanelOpen} onToggleContext={()=>setOverviewPanelOpen(open=>!open)}/>;
  return <div className={cn("relative flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden",!isNarrowProjectsLayout&&"bg-sidebar pb-2 pr-2 pt-px",
      !isNarrowProjectsLayout&&sidebar?.open===false&&"pl-2")}
    data-project-context-detached={isNarrowProjectsLayout?undefined:"true"} data-testid="projects-overview-layout">
    <ProjectsWorkspaceChrome actions={chromeActions} onActivity={filter==="all"} onGoActivity={contextAvailable?()=>changeFilter("all"):undefined}
      section={t(projectsSectionTitleKey(filter))}/>
    <div className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",!isNarrowProjectsLayout?"ml-px rounded-2xl bg-background":cn("rounded-tl-xl",topChromeInset.divider))}
      data-testid={overviewDetached?"projects-overview-content-pod":undefined}>
      {createDialog}
      {categoryCreateAvailable&&onSelectedProjectChange?<ProjectsCategoryCreateDialogs channelOpen={createChannelOpen} editableProjects={editableProjects} host={host}
        onChannelOpenChange={setCreateChannelOpen} onOpenChannel={onOpenChannel?openChannelById:undefined} onOpenProject={onSelectedProjectChange}
        onRepositoryOpenChange={setCreateRepositoryOpen} repositoryOpen={createRepositoryOpen}/>:null}
      {host.publish&&onSelectedProjectChange&&explicitProjects.length>0?<CreateProjectIssueDialog host={host} projects={explicitProjects} open={createIssueOpen} onOpenChange={setCreateIssueOpen}
        onCreated={(project,repository,issueId)=>onSelectedProjectChange(project.id,{repositoryId:repository.id,issueId})}/>:null}
      {host.publish&&host.git&&onSelectedProjectChange&&workSnapshot&&explicitProjects.length>0&&createReviewOpen?<CreatePullRequestDialog host={host}
        projects={explicitProjects} workItems={workSnapshot.items} open onOpenChange={setCreateReviewOpen}
        onCreated={(project,repository,pullRequestId)=>onSelectedProjectChange(project.id,{repositoryId:repository.id,pullRequestId})}/>:null}
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">
          <div aria-hidden="true" className="pointer-events-none absolute right-[3px] top-0 z-50 w-1 rounded-full bg-border/80 opacity-0 transition-opacity duration-200" ref={scrollIndicatorRef}/>
          <div className="buzz-content-scrollbar h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-scroll" onScroll={handleContentScroll}>
            <div className="px-4 pb-4">
              <div className="w-full space-y-3">
                <div className={cn("sticky top-0 z-30 -mx-4 flex h-13 min-w-0 items-center gap-1.5 px-4",PROJECT_COLUMN_HEADER_BACKDROP_CLASS,overviewDetached&&"rounded-t-2xl")} data-testid="projects-page-tabs">
                  <ProjectsSectionSearch filter={filter} onFilterChange={changeFilter} onQueryChange={setSearch} onSortChange={changeSort}
                    sort={effectiveSort} channelsAvailable={Boolean(onOpenChannel)} workItemsAvailable={contextAvailable}
                    projectActivityAvailable={Boolean(directorySummaries)}/>
                </div>
                {navigationFailed?<p role="alert">{t(navigationFailed==="created"?"projects.create.navigationFailed":"platform.loadFailed")}</p>:null}
                <div className={filter==="all"?"mx-auto w-full max-w-6xl":"w-full"}>
                  {filter==="all"&&onSelectedProjectChange?
                    <ProjectsActivityOverview key={host.scopeKey} host={host} query={workItems} search={search} onOpenProject={onOpen} onOpen={onSelectedProjectChange} renderWorkItems={renderWorkItems}/>:<>
                    <ProjectSectionHeader className="mb-2 rounded-md bg-muted/40" icon={projectsSectionIcon(filter)} testId="projects-page-header"
                      title={t(projectsSectionTitleKey(filter))}
                      trailing={filter==="channels"?undefined:<ProjectsListHeaderBar viewMode={view} onViewModeChange={changeView}/>}/>
                    <section><div className="space-y-3">
                      {(filter==="issues"||filter==="prs")&&onSelectedProjectChange?<ProjectWorkItemsList key={host.scopeKey+filter} host={host} query={workItems} filter={filter} search={search} sort={sort} view={view} onOpen={onSelectedProjectChange} renderWorkItems={renderWorkItems}/>:query.isError?<p role="alert">{t("platform.loadFailed")}</p>:query.isFetching||query.isPending?<p role="status">{t("platform.loading")}</p>:filter==="channels"&&onOpenChannel?
                        <ProjectsChannelsList key={host.scopeKey} projects={projects} scopeKey={host.scopeKey} searchQuery={search}
                          lastMessageAtByChannelId={lastMessageAtByChannelId} onOpenChannel={onOpenChannel} renderMember={renderMember}/>:filter==="repositories"?<>
                        {workItems.isError?<ProjectsWorkItemsLoadNotice error={workItems.error} isRetrying={workItems.isFetching} onRetry={()=>{void workItems.refetch();}}/>:null}
                        {repositorySummaries&&workSnapshot?(()=>{
                          const items=<ProjectsOverviewRepositoryItemsWithActivity visible={visibleRepositories} viewerPubkey={query.data!.viewerPubkey} view={view}
                            summaries={repositorySummaries} onOpen={openRepository}/>;
                          return renderWorkItems?renderWorkItems(items,workSnapshot.viewerPubkey):items;
                        })():<ProjectsOverviewRepositoryItems visible={visibleRepositories} viewerPubkey={query.data!.viewerPubkey} view={view} canCopyLink={false} onOpen={openRepository}/>}
                      </>:<>
                        {workItems.isError?<ProjectsWorkItemsLoadNotice error={workItems.error} isRetrying={workItems.isFetching} onRetry={()=>{void workItems.refetch();}}/>:null}
                        {directorySummaries&&workSnapshot?(()=>{
                          const items=<ProjectsOverviewProjectItemsWithActivity visible={visible} viewerPubkey={query.data!.viewerPubkey} view={view}
                            summaries={directorySummaries} renderRow={projectRow}/>;
                          return renderWorkItems?renderWorkItems(items,workSnapshot.viewerPubkey):items;
                        })():<ProjectsOverviewProjectItems visible={visible} viewerPubkey={query.data!.viewerPubkey} view={view} renderRow={projectRow} activityFor={()=>undefined}/>}
                      </>}
                    </div></section>
                  </>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    {contextAvailable?<ProjectContextRail open={overviewContextOpen} panelWidthPx={PROJECT_CONTEXT_PANEL_DEFAULT_WIDTH_PX} rounded={false} testId="projects-overview-context-rail">
      <aside aria-label={t("projects.context.title")} className="relative z-30 flex h-full flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
        <div className="min-h-0 flex-1 overflow-y-auto">{overviewContextOpen?rail:null}</div>
      </aside>
    </ProjectContextRail>:null}
    {contextAvailable&&isNarrowProjectsLayout?<ProjectsOverviewContextSheet onOpenChange={setNarrowContextOpen} open={narrowContextOpen}
      onCloseAutoFocus={event=>{
        // Return focus to the chrome toggle so the keyboard journey can
        // continue where it started.
        event.preventDefault();
        contextToggleRef.current?.focus();
      }}>{rail}</ProjectsOverviewContextSheet>:null}
  </div>;
}
