// REQ-24. Original Buzz 779af8886caae1317b4de962082429867ab61503
// ProjectsView / ProjectCards / ProjectEntityListRow presentation. This host
// reads announcements/work-item targets and uses the governed publication hosts;
// Git, terminal and unsupported work-item operations retain missing consumers.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CreateActionKey, type DiscoverableWorkspace } from "@client-kit/contracts";
import { Folders, Hash, Trash2, CircleDot, GitPullRequest } from "lucide-react";
import { useBffClient, useUiT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import { DropdownMenuItem } from "../sidebar/dropdown-menu";
import { EmptyFilteredState, EmptyState, ProjectGridCard, ProjectListRow } from "./ProjectCards";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { ProjectDeleteAction } from "./ProjectDeleteAction";
import { ProjectListRowMenu } from "./ProjectListRowMenu";
import { useCreateProject } from "./useCreateProject";
import { readStoredViewMode, writeStoredViewMode, readStoredFilter,writeStoredFilter,readStoredSort,writeStoredSort,type ProjectsViewMode } from "./lib/projectsViewHelpers";
import { ProjectChannelHome, type ProjectChannelRenderer } from "./ProjectChannelHome";
import { ProjectSectionHeader } from "./ProjectSectionHeader";
import { loadProjectDirectory, type ProjectsHost } from "./projectEnumeration";
import type { Project } from "./projectModels";
import { ProjectsChannelsList } from "./ProjectsChannelsList";
import type { ProjectsFilter } from "./ProjectsToolbar";
import { ProjectsSectionSearch } from "./ProjectsSectionSearch";
import { ProjectsListHeaderBar, type ProjectsSort } from "./ProjectsListHeaderBar";
import type { ProjectMemberRenderer } from "./ProjectChannelMembers";
import {loadProjectWorkItems,resolveProjectWorkItemTarget,type ProjectWorkItemTarget,type ProjectInboxWorkItem} from "./projectWorkItems";
import {ProjectsIssuesList} from "./ProjectsIssuesList";
import {ProjectsPullRequestsList} from "./ProjectsPullRequestsList";
import {matchesProjectsSearch} from "./lib/projectsSearch";
import {useUsersBatchQuery} from "../pulse/host";
import {ProjectIssueDetail} from "./ProjectIssueDetail";
import {ProjectPullRequestDetail} from "./ProjectPullRequestDetail";
import {ProjectPanelState} from "./ProjectPanelState";
import {BuzzLoadingState} from "./BuzzLoadingState";
import {CreateProjectIssueDialog} from "./CreateProjectIssueDialog";
import type {ProjectDiscussInChannel} from "./useProjectDiscussInChannel";
import {ProjectDetailChrome} from "./ProjectDetailChrome";
import {WorkspaceTabs} from "./ProjectWorkspaceTabs";
import {ProjectIssuesPanel} from "./ProjectIssuesPanel";
import {PullRequestsPanel} from "./ProjectPullRequestsPanel";
import {CreateIssueDialog} from "./CreateIssueDialog";
import {publishProjectIssue} from "./issueMutations";
import {isOutcomeUnknown,TransportError} from "../../transport";
import {toast} from "sonner";

type ProjectsViewProps={host:ProjectsHost;selectedProjectId?:string|null;onSelectedProjectChange?:(id:string|null,target?:ProjectWorkItemTarget)=>void|Promise<void>;
  onDiscussInChannel?:ProjectDiscussInChannel;
  renderChannel?:ProjectChannelRenderer;
  renderWorkItems?:(children:ReactNode,viewerPubkey:string)=>ReactNode;
  workItemTarget?:ProjectWorkItemTarget;onOpenChannel?:(workspace:DiscoverableWorkspace)=>void|Promise<void>;lastMessageAtByChannelId?:ReadonlyMap<string,string|null>;renderMember?:ProjectMemberRenderer};
export function ProjectsView(props:ProjectsViewProps) {
  if(props.workItemTarget?.tab)return <ProjectRepositoryPage key={props.host.scopeKey} {...props}/>;
  if(props.workItemTarget&&(props.workItemTarget.repositoryId||props.workItemTarget.issueId||props.workItemTarget.pullRequestId))return <ProjectWorkItemPage key={props.host.scopeKey} host={props.host} projectId={props.selectedProjectId} target={props.workItemTarget} renderWorkItems={props.renderWorkItems} onOpen={props.onSelectedProjectChange} onDiscussInChannel={props.onDiscussInChannel}/>;
  return <ProjectDirectory key={props.host.scopeKey} {...props}/>;
}

function ProjectRepositoryPage(props:ProjectsViewProps) {
  const {host,selectedProjectId}=props;
  const target=props.workItemTarget!;
  const onOpen=props.onSelectedProjectChange;
  const t=useUiT();const cache=useQueryClient();
  const lifetime=useMemo(()=>({controller:new AbortController()}),[host]);
  useEffect(()=>{if(lifetime.controller.signal.aborted)lifetime.controller=new AbortController();return()=>lifetime.controller.abort();},[lifetime]);
  const key=useMemo(()=>["project-work-item-target",host.scopeKey,selectedProjectId,{repositoryId:target.repositoryId,tab:target.tab,issueId:target.issueId,pullRequestId:target.pullRequestId}],
    [host.scopeKey,selectedProjectId,target.repositoryId,target.tab,target.issueId,target.pullRequestId]);
  const valid=Boolean(onOpen&&selectedProjectId&&target.repositoryId&&(target.tab==="issues"||target.tab==="prs")
    &&!(target.issueId&&target.pullRequestId)&&!(target.tab==="issues"&&target.pullRequestId)&&!(target.tab==="prs"&&target.issueId));
  const query=useQuery({queryKey:key,enabled:valid,queryFn:({signal})=>loadProjectWorkItems(host,signal,selectedProjectId!),retry:false,refetchOnWindowFocus:"always"});
  useEffect(()=>()=>{void cache.cancelQueries({queryKey:key});cache.removeQueries({queryKey:key});},[cache,key]);
  const snapshot=query.isSuccess&&!query.isFetching?query.data:undefined;
  const project=snapshot?.projects.find(value=>value.id===selectedProjectId);
  const repository=project?.repositories.find(value=>value.id===target.repositoryId);
  const items=snapshot?.items.filter(item=>item.project.id===selectedProjectId&&item.repository.id===target.repositoryId)??[];
  const selected=target.issueId||target.pullRequestId?resolveProjectWorkItemTarget(items,selectedProjectId,target):undefined;
  const [navigationFailed,setNavigationFailed]=useState(false);
  const navigate=(id:string|null,next?:ProjectWorkItemTarget)=>{
    if(lifetime.controller.signal.aborted||!onOpen)return;
    void Promise.resolve().then(()=>{if(!lifetime.controller.signal.aborted)return onOpen(id,next);})
      .catch(()=>{if(!lifetime.controller.signal.aborted)setNavigationFailed(true);});
  };
  if(!valid||query.isError||snapshot&&(!project||!repository||(target.issueId||target.pullRequestId)&&!selected))return <ProjectPanelState error title={t("projects.unavailable")}/>;
  if(!snapshot||!project||!repository)return <BuzzLoadingState label={t(target.tab==="prs"?"projects.sheet.loadingReviews":"projects.sheet.loadingTasks")}/>;
  const tab=target.tab==="prs"?"prs":"issues";
  const clear=()=>navigate(project.id,{repositoryId:repository.id,tab});
  const detail=selected?<ProjectWorkItemDetail workItem={selected} host={host} onOpen={(id,next)=>onOpen?.(id,{...next,tab:"issues"})} onDiscussInChannel={props.onDiscussInChannel}/>:null;
  const content=selected?detail:<RepositoryWorkspace host={host} snapshot={snapshot} project={project} repository={repository}
    tab={tab} onBack={()=>navigate(project.id)} onTabChange={next=>navigate(project.id,{repositoryId:repository.id,tab:next})}
    onOpen={next=>onOpen?.(project.id,{repositoryId:repository.id,tab,...next})}/>;
  return <>
    <ProjectDetailChrome project={project} repository={repository} actions={undefined}
      activeTabCrumb={selected?null:t(tab==="issues"?"projects.list.tasks":"projects.list.reviews")}
      activeWorkItemCrumb={selected?{category:t(tab==="issues"?"projects.list.tasks":"projects.list.reviews"),title:selected.type==="issue"?selected.issue.title:selected.pullRequest.title,clear}:null}
      onGoProjects={()=>navigate(null)} onGoProjectHome={()=>navigate(project.id)}/>
    {navigationFailed?<p role="alert">{t("platform.loadFailed")}</p>:null}
    {selected?(props.renderWorkItems?props.renderWorkItems(content,snapshot.viewerPubkey):content):
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden [container-type:inline-size]">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-none px-4 pb-4" data-testid="project-detail-scroll">
          <div className="flex min-h-full w-full flex-col space-y-3">{props.renderWorkItems?props.renderWorkItems(content,snapshot.viewerPubkey):content}</div>
        </div>
      </div>}
  </>;
}

function RepositoryWorkspace({host,snapshot,project,repository,tab,onBack,onTabChange,onOpen}:{
  host:ProjectsHost;snapshot:Awaited<ReturnType<typeof loadProjectWorkItems>>;project:Project;repository:Project["repositories"][number];tab:"issues"|"prs";
  onBack:()=>void;onTabChange:(tab:"issues"|"prs")=>void;onOpen:(target:ProjectWorkItemTarget)=>void|Promise<void>;
}) {
  const t=useUiT();const cache=useQueryClient();const [createOpen,setCreateOpen]=useState(false);const [creating,setCreating]=useState(false);
  const [navigationFailed,setNavigationFailed]=useState(false);const sending=useRef(false);
  const lifetime=useMemo(()=>({controller:new AbortController()}),[host,repository.id]);
  useEffect(()=>{if(lifetime.controller.signal.aborted)lifetime.controller=new AbortController();return()=>lifetime.controller.abort();},[lifetime]);
  const items=snapshot.items.filter(item=>item.repository.id===repository.id);
  const profiles=useUsersBatchQuery(items.map(item=>item.type==="issue"?item.issue.author:item.pullRequest.author)).data?.profiles;
  const open=(next:ProjectWorkItemTarget)=>{void Promise.resolve().then(()=>{if(!lifetime.controller.signal.aborted)return onOpen(next);})
    .catch(()=>{if(!lifetime.controller.signal.aborted)setNavigationFailed(true);});};
  return <>
    {navigationFailed?<p role="alert">{t("platform.loadFailed")}</p>:null}
    <WorkspaceTabs tab={tab} onTabChange={onTabChange} onBack={onBack} onCreateTask={host.publish?()=>setCreateOpen(true):undefined}>
      {tab==="issues"?<ProjectIssuesPanel issueItems={items.filter(item=>item.type==="issue").map(item=>({issue:item.issue,project:item.repository}))}
        selectedIssueId={null} onSelectedIssueIdChange={id=>{if(id)open({issueId:id});}} profiles={profiles}/>:
        <PullRequestsPanel project={repository} pullRequests={items.filter(item=>item.type==="pull-request").map(item=>item.pullRequest)}
          selectedPullRequest={null} onSelectedPullRequestIdChange={id=>{if(id)open({pullRequestId:id});}} profiles={profiles}/>}
    </WorkspaceTabs>
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
  </>:<ProjectPullRequestDetail project={workItem.repository} pullRequest={workItem.pullRequest} profiles={profiles} publication={{host,projectId:workItem.project.id}}
    contextPanel={onDiscussInChannel?{channelId,onDiscussInChannel}:undefined}/>;
}

function ProjectWorkItemsList({host,filter,search,sort,view,onOpen,renderWorkItems}:{host:ProjectsHost;filter:"issues"|"prs";search:string;sort:ProjectsSort;view:ProjectsViewMode;onOpen:NonNullable<ProjectsViewProps["onSelectedProjectChange"]>;renderWorkItems:ProjectsViewProps["renderWorkItems"]}) {
  const t=useUiT();const cache=useQueryClient();
  const [navigationFailed,setNavigationFailed]=useState(false);
  const lifetime=useMemo(()=>({active:true}),[host]);
  useEffect(()=>{lifetime.active=true;return()=>{lifetime.active=false;};},[lifetime]);
  const query=useQuery({queryKey:["projects-work-items",host.scopeKey],queryFn:({signal})=>loadProjectWorkItems(host,signal),retry:false,refetchOnWindowFocus:"always"});
  useEffect(()=>()=>{void cache.cancelQueries({queryKey:["projects-work-items",host.scopeKey]});cache.removeQueries({queryKey:["projects-work-items",host.scopeKey]});},[cache,host.scopeKey]);
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
  return filter==="issues"?<ProjectsIssuesList {...common} issues={items.filter(item=>item.type==="issue")} emptyMessage={search.trim()?t("projects.list.tasksNoMatch"):undefined}/>:
    <ProjectsPullRequestsList {...common} pullRequests={items.filter(item=>item.type==="pull-request")} emptyMessage={search.trim()?t("projects.list.reviewsNoMatch"):undefined}/>;
}

function ProjectDirectory({host,selectedProjectId,onSelectedProjectChange,onOpenChannel,lastMessageAtByChannelId,renderMember,renderWorkItems,renderChannel}:ProjectsViewProps) {
  const t=useUiT(); const cache=useQueryClient();const client=useBffClient();
  const [search,setSearch]=useState("");
  const [filter,setFilter]=useState<ProjectsFilter>(()=>{
    const stored=readStoredFilter();
    return stored==="channels"&&!onOpenChannel||(stored==="issues"||stored==="prs")&&!onSelectedProjectChange?"projects":stored;
  });
  const [view,setView]=useState<ProjectsViewMode>(()=>readStoredViewMode()??"grid");
  const [sort,setSort]=useState<ProjectsSort>(()=>readStoredSort());
  // Directory activity summaries remain un-restored. The visible fallback is
  // not a new user preference: keep the original stored sort for work items.
  const effectiveSort=sort==="updated"&&filter!=="issues"&&filter!=="prs"?"created":sort;
  const [createOpen,setCreateOpen]=useState(false);
  const [navigationFailed,setNavigationFailed]=useState<"created"|"open"|null>(null);
  const creation=useCreateProject(host);
  const lifetime=useMemo(()=>({active:true}),[host]);
  useEffect(()=>{lifetime.active=true;return()=>{lifetime.active=false;};},[lifetime]);
  const [localSelected,setLocalSelected]=useState<string|null>(null);
  const selected=selectedProjectId===undefined?localSelected:selectedProjectId;
  const setSelected=async(id:string|null)=>{if(!lifetime.active)return;await onSelectedProjectChange?.(id);if(lifetime.active)setLocalSelected(id);};
  const query=useQuery({queryKey:["projects",host.scopeKey],queryFn:({signal})=>loadProjectDirectory(host,signal),retry:false,refetchOnWindowFocus:"always"});
  const createCapability=useQuery({queryKey:["project-create-capability",host.scopeKey],queryFn:()=>client.roleWorkspaces(),
    enabled:Boolean(host.publish)&&query.isSuccess&&!query.isFetching,retry:false,refetchOnWindowFocus:"always"});
  useEffect(()=>()=>{void cache.cancelQueries({queryKey:["projects",host.scopeKey]});cache.removeQueries({queryKey:["projects",host.scopeKey]});},[cache,host.scopeKey]);
  // A failed fresh read must not keep a previously accessible announcement open.
  const projects=query.isSuccess&&!query.isFetching?query.data.projects:[];
  const active=projects.find(project=>project.id===selected);
  const searchText=search.trim().toLowerCase();
  const visible=projects.filter(project=>matchesProjectsSearch(search,[
    project.name,project.description,...project.repositories.flatMap(repo=>[repo.name,repo.description]),
  ]))
    .sort((a,b)=>effectiveSort==="name"?a.name.localeCompare(b.name):b.createdAt-a.createdAt);
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
  const projectRow=(project:Project)=>{
    const row=(actions?:ReactNode)=>view==="grid"?<ProjectGridCard project={project} onOpen={onOpen} actions={actions}/>
      :<ProjectListRow project={project} onOpen={onOpen} actions={actions}/>;
    // Use the same winning replaceable event as projectModels (timestamp, then
    // lowest event ID). A stale earlier revision must not be deletion's target.
    const head=[...query.data!.projectEvents,...query.data!.repositoryEvents]
      .filter(event=>`${event.kind}:${event.pubkey}:${event.tags.find(tag=>tag[0]==="d")?.[1]}`===project.projectAddress)
      .sort((a,b)=>b.created_at-a.created_at||a.id.localeCompare(b.id))[0];
    return host.publish&&project.owner===query.data?.viewerPubkey&&head?<ProjectDeleteAction key={project.id} project={project}
      headId={head.id} viewerPubkey={query.data.viewerPubkey} host={host} onDeleted={()=>{
        if(!lifetime.active)return;
        if(selected===project.id)void setSelected(null).catch(()=>{if(lifetime.active)setNavigationFailed("open");});
        void invalidateProjects();
      }} renderTrigger={({onOpen:onDelete,pending})=>row(<ProjectListRowMenu label={t("projects.moreOptions",{name:project.name})}>
        <DropdownMenuItem className="text-destructive focus:text-destructive" disabled={pending}
          onSelect={event=>{event.preventDefault();event.stopPropagation();onDelete();}}><Trash2 className="h-4 w-4"/>{t("projects.delete")}</DropdownMenuItem>
      </ProjectListRowMenu>)}/>:<Fragment key={project.id}>{row()}</Fragment>;
  };
  if (selected) return active && renderChannel && onOpenChannel
    ? <ProjectChannelHome key={`${host.scopeKey}:${active.id}`} project={active} scopeKey={host.scopeKey}
        renderChannel={renderChannel} onOpenChannel={onOpenChannel} onOpenProject={onSelectedProjectChange} onGoProjects={()=>setSelected(null)} host={host} renderWorkItems={renderWorkItems}/>
    : <ProjectPanelState error={!query.isPending&&!query.isFetching}
        title={t(query.isPending||query.isFetching?"platform.loading":query.isError?"platform.loadFailed":"projects.home.channelMissing")}/>;
  return <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden" data-testid="projects-screen">
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-4">
      <div className="sticky top-0 z-30 -mx-4 flex h-13 min-w-0 items-center gap-1.5 bg-background/90 px-4">
        <ProjectsSectionSearch filter={filter} onFilterChange={changeFilter} onQueryChange={setSearch} onSortChange={changeSort}
          sort={effectiveSort} channelsAvailable={Boolean(onOpenChannel)} workItemsAvailable={Boolean(onSelectedProjectChange)}/>
      </div>
      <ProjectSectionHeader className="mb-2 rounded-md bg-muted/40" icon={filter==="channels"?Hash:filter==="issues"?CircleDot:filter==="prs"?GitPullRequest:Folders} testId="projects-page-header"
        title={t(filter==="channels"?"sidebar.channels":filter==="issues"?"projects.list.tasks":filter==="prs"?"projects.list.reviews":"platform.tab.projects")}
        trailing={filter==="channels"?undefined:<ProjectsListHeaderBar viewMode={view} onViewModeChange={changeView}/>}/>
      {navigationFailed?<p role="alert">{t(navigationFailed==="created"?"projects.create.navigationFailed":"platform.loadFailed")}</p>:null}
      {(filter==="issues"||filter==="prs")&&onSelectedProjectChange?<ProjectWorkItemsList key={host.scopeKey+filter} host={host} filter={filter} search={search} sort={sort} view={view} onOpen={onSelectedProjectChange} renderWorkItems={renderWorkItems}/>:query.isError?<p role="alert">{t("platform.loadFailed")}</p>:query.isFetching||query.isPending?<p role="status">{t("platform.loading")}</p>:filter==="channels"&&onOpenChannel?
        <ProjectsChannelsList key={host.scopeKey} projects={projects} scopeKey={host.scopeKey} searchQuery={search}
          lastMessageAtByChannelId={lastMessageAtByChannelId} onOpenChannel={onOpenChannel} renderMember={renderMember}/>:visible.length===0?
        searchText?<EmptyFilteredState/>:<EmptyState onCreateProject={canCreate?()=>setCreateOpen(true):undefined}/>:
        <section className={view==="grid"?"grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3":"flex flex-col"}>
          {visible.map(projectRow)}
        </section>}
    </div>
    <CreateProjectDialog open={createOpen&&(canCreate||creation.busy)} onOpenChange={setCreateOpen} isCreating={creation.busy} frozen={creation.intent?.input}
      onCreate={async input=>{
        const project=await creation.create(input);
        if(!lifetime.active)return;
        await invalidateProjects();
        if(!lifetime.active)return;
        try{await setSelected(project.id);if(lifetime.active)setNavigationFailed(null);}
        catch{if(lifetime.active)setNavigationFailed("created");}
      }}/>
  </div>;
}
