// REQ-24. Original Buzz 779af8886caae1317b4de962082429867ab61503
// ProjectsView / ProjectCards / ProjectEntityListRow presentation. This host
// reads announcements and uses the existing governed creation/deletion hosts;
// Git work-item/terminal consumers still require their separate production chain.
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CreateActionKey, type DiscoverableWorkspace } from "@client-kit/contracts";
import { Folders, Hash, X, Trash2 } from "lucide-react";
import { useBffClient, useUiT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import { DropdownMenuItem } from "../sidebar/dropdown-menu";
import { EmptyFilteredState, EmptyState, ProjectGridCard, ProjectListRow } from "./ProjectCards";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { ProjectDeleteAction } from "./ProjectDeleteAction";
import { ProjectListRowMenu } from "./ProjectListRowMenu";
import { useCreateProject } from "./useCreateProject";
import { readStoredViewMode, writeStoredViewMode, type ProjectsViewMode } from "./lib/projectsViewHelpers";
import { ProjectDetailMetaList, ProjectDetailMetaRow } from "./ProjectDetailMeta";
import { ProjectSectionHeader } from "./ProjectSectionHeader";
import { loadProjectDirectory, type ProjectsHost } from "./projectEnumeration";
import type { Project } from "./projectModels";
import { ProjectsChannelsList } from "./ProjectsChannelsList";
import type { ProjectsFilter } from "./ProjectsToolbar";
import { ProjectsSectionSearch } from "./ProjectsSectionSearch";
import { ProjectsListHeaderBar } from "./ProjectsListHeaderBar";
import type { ProjectMemberRenderer } from "./ProjectChannelMembers";

type ProjectsViewProps={host:ProjectsHost;selectedProjectId?:string|null;onSelectedProjectChange?:(id:string|null)=>void|Promise<void>;
  onOpenChannel?:(workspace:DiscoverableWorkspace)=>void|Promise<void>;lastMessageAtByChannelId?:ReadonlyMap<string,string|null>;renderMember?:ProjectMemberRenderer};
export function ProjectsView(props:ProjectsViewProps) {
  return <ProjectDirectory key={props.host.scopeKey} {...props}/>;
}

function ProjectDirectory({host,selectedProjectId,onSelectedProjectChange,onOpenChannel,lastMessageAtByChannelId,renderMember}:ProjectsViewProps) {
  const t=useUiT(); const cache=useQueryClient();const client=useBffClient();
  const [search,setSearch]=useState("");
  const [filter,setFilter]=useState<ProjectsFilter>("projects");
  const [view,setView]=useState<ProjectsViewMode>(()=>readStoredViewMode()??"grid");
  const [sort,setSort]=useState<"created"|"name">("created");
  const [createOpen,setCreateOpen]=useState(false);
  const [navigationFailed,setNavigationFailed]=useState<"created"|"open"|null>(null);
  const creation=useCreateProject(host);
  const lifetime=useMemo(()=>({active:true}),[host]);
  useEffect(()=>{lifetime.active=true;return()=>{lifetime.active=false;};},[lifetime]);
  const [localSelected,setLocalSelected]=useState<string|null>(null);
  const selected=selectedProjectId===undefined?localSelected:selectedProjectId;
  const setSelected=async(id:string|null)=>{if(!lifetime.active)return;setLocalSelected(id);await onSelectedProjectChange?.(id);};
  const query=useQuery({queryKey:["projects",host.scopeKey],queryFn:({signal})=>loadProjectDirectory(host,signal),retry:false,refetchOnWindowFocus:"always"});
  const createCapability=useQuery({queryKey:["project-create-capability",host.scopeKey],queryFn:()=>client.roleWorkspaces(),
    enabled:Boolean(host.publish)&&query.isSuccess&&!query.isFetching,retry:false,refetchOnWindowFocus:"always"});
  useEffect(()=>()=>{void cache.cancelQueries({queryKey:["projects",host.scopeKey]});cache.removeQueries({queryKey:["projects",host.scopeKey]});},[cache,host.scopeKey]);
  // A failed fresh read must not keep a previously accessible announcement open.
  const projects=query.isSuccess&&!query.isFetching?query.data.projects:[];
  const active=projects.find(project=>project.id===selected);
  const searchText=search.trim().toLowerCase();
  const visible=projects.filter(project=>[project.name,project.description,...project.repositories.flatMap(repo=>[repo.name,repo.description])]
    .some(value=>value.toLowerCase().includes(searchText)))
    .sort((a,b)=>sort==="name"?a.name.localeCompare(b.name):b.createdAt-a.createdAt);
  const canCreate=Boolean(host.publish&&query.isSuccess&&!query.isFetching&&(
    createCapability.isSuccess&&!createCapability.isFetching&&createCapability.data.createActionKey===CreateActionKey.WorkspaceCreate||creation.intent));
  const onOpen=(project:Project)=>{void setSelected(project.id).catch(()=>{if(lifetime.active)setNavigationFailed("open");});};
  const changeView=(next:ProjectsViewMode)=>{setView(next);writeStoredViewMode(next);};
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
  return <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden" data-testid="projects-screen">
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-4">
      <div className="sticky top-0 z-30 -mx-4 flex h-13 min-w-0 items-center gap-1.5 bg-background/90 px-4">
        <ProjectsSectionSearch filter={filter} onFilterChange={setFilter} onQueryChange={setSearch} onSortChange={setSort}
          sort={sort} channelsAvailable={Boolean(onOpenChannel)}/>
      </div>
      <ProjectSectionHeader className="mb-2 rounded-md bg-muted/40" icon={filter==="channels"?Hash:Folders} testId="projects-page-header"
        title={t(filter==="channels"?"sidebar.channels":"platform.tab.projects")}
        trailing={filter==="channels"?undefined:<ProjectsListHeaderBar viewMode={view} onViewModeChange={changeView}/>}/>
      {navigationFailed?<p role="alert">{t(navigationFailed==="created"?"projects.create.navigationFailed":"platform.loadFailed")}</p>:null}
      {query.isError?<p role="alert">{t("platform.loadFailed")}</p>:query.isFetching||query.isPending?<p role="status">{t("platform.loading")}</p>:filter==="channels"&&onOpenChannel?
        <ProjectsChannelsList key={host.scopeKey} projects={projects} scopeKey={host.scopeKey} searchQuery={search}
          lastMessageAtByChannelId={lastMessageAtByChannelId} onOpenChannel={onOpenChannel} renderMember={renderMember}/>:visible.length===0?
        searchText?<EmptyFilteredState/>:<EmptyState onCreateProject={canCreate?()=>setCreateOpen(true):undefined}/>:
        <section className={view==="grid"?"grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3":"flex flex-col"}>
          {visible.map(projectRow)}
        </section>}
    </div>
    {active&&filter==="projects"?<aside className="flex w-96 max-w-full shrink-0 flex-col overflow-auto border-l border-border bg-background" aria-label={t("projects.announcement")}>
      <header className="flex items-center gap-2 px-6 py-4"><h2 className="min-w-0 flex-1 break-words text-lg font-semibold">{active.name}</h2>
        <Button variant="ghost" size="icon" aria-label={t("projects.close")} onClick={()=>{void setSelected(null).catch(()=>{if(lifetime.active)setNavigationFailed("open");});}}><X className="h-4 w-4"/></Button></header>
      <p className="whitespace-pre-wrap break-words px-6 text-sm text-muted-foreground">{active.description}</p>
      <ProjectDetailMetaList><ProjectDetailMetaRow label={t("projects.owner")}><code className="break-all text-xs">{active.owner}</code></ProjectDetailMetaRow><ProjectDetailMetaRow label={t("projects.address")}><code className="break-all text-xs">{active.projectAddress}</code></ProjectDetailMetaRow></ProjectDetailMetaList>
      <div className="space-y-3 px-6 pb-6"><h3 className="text-sm font-semibold">{t("projects.repositories")}</h3>
        {active.repositories.map(repo=><div key={repo.repoAddress} className="space-y-1 rounded-lg bg-muted/35 p-3"><p className="break-words text-sm font-medium">{repo.name}</p><p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{repo.description}</p><code className="block break-all text-xs">{repo.repoAddress}</code></div>)}
        {active.unavailableRepositoryAddresses?.map(address=><p key={address} className="break-all text-xs">{t("projects.unavailable")} <code>{address}</code></p>)}
        <p className="text-xs text-muted-foreground">{t("projects.readBoundary")}</p>
      </div>
    </aside>:null}
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
