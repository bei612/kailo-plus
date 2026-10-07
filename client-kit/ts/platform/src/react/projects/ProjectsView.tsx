// REQ-24. Original Buzz 779af8886caae1317b4de962082429867ab61503
// ProjectsView / ProjectCards / ProjectEntityListRow presentation. This host
// reads announcements only; Git work-item/terminal/mutation consumers are separate.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Folders, FolderGit2, LayoutGrid, List, Search, X, RefreshCw } from "lucide-react";
import { useUiT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import { ProjectGridCard } from "./ProjectCards";
import { ProjectDetailMetaList, ProjectDetailMetaRow } from "./ProjectDetailMeta";
import { ProjectSectionHeader } from "./ProjectSectionHeader";
import { loadProjectDirectory, type ProjectsHost } from "./projectEnumeration";
import type { Project } from "./projectModels";

type ProjectsViewProps={host:ProjectsHost;selectedProjectId?:string|null;onSelectedProjectChange?:(id:string|null)=>void};
export function ProjectsView(props:ProjectsViewProps) {
  return <ProjectDirectory key={props.host.scopeKey} {...props}/>;
}

function ProjectDirectory({host,selectedProjectId,onSelectedProjectChange}:ProjectsViewProps) {
  const t=useUiT(); const cache=useQueryClient();
  const [search,setSearch]=useState("");
  const [view,setView]=useState<"grid"|"list">("grid");
  const [sort,setSort]=useState<"created"|"name">("created");
  const [localSelected,setLocalSelected]=useState<string|null>(null);
  const selected=selectedProjectId===undefined?localSelected:selectedProjectId;
  const setSelected=(id:string|null)=>{setLocalSelected(id);onSelectedProjectChange?.(id);};
  const query=useQuery({queryKey:["projects",host.scopeKey],queryFn:({signal})=>loadProjectDirectory(host,signal),retry:false,refetchOnWindowFocus:"always"});
  useEffect(()=>()=>{void cache.cancelQueries({queryKey:["projects",host.scopeKey]});cache.removeQueries({queryKey:["projects",host.scopeKey]});},[cache,host.scopeKey]);
  // A failed fresh read must not keep a previously accessible announcement open.
  const projects=query.isSuccess&&!query.isFetching?query.data.projects:[];
  const active=projects.find(project=>project.id===selected);
  const searchText=search.trim().toLowerCase();
  const visible=projects.filter(project=>[project.name,project.description,...project.repositories.flatMap(repo=>[repo.name,repo.description])]
    .some(value=>value.toLowerCase().includes(searchText)))
    .sort((a,b)=>sort==="name"?a.name.localeCompare(b.name):b.createdAt-a.createdAt);
  const onOpen=(project:Project)=>setSelected(project.id);
  return <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden" data-testid="projects-screen">
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-4">
      <div className="sticky top-0 z-30 -mx-4 flex h-13 min-w-0 items-center gap-1.5 bg-background/90 px-4">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground"/>
        <input aria-label={t("projects.search")} placeholder={t("projects.search")} value={search} onChange={e=>setSearch(e.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-hidden"/>
        <label className="flex items-center gap-2 text-xs text-muted-foreground"><span className="sr-only">{t("projects.sort")}</span>
          <select className="h-8 rounded-md bg-transparent px-2 text-xs text-foreground outline-hidden hover:bg-muted/50 focus:ring-1 focus:ring-ring"
            value={sort} onChange={e=>setSort(e.target.value==="name"?"name":"created")}>
            <option value="created">{t("projects.created")}</option><option value="name">{t("projects.name")}</option>
          </select></label>
        <Button variant="ghost" size="icon" aria-label={t("platform.retry")} onClick={()=>void query.refetch()} disabled={query.isFetching}><RefreshCw className="h-4 w-4"/></Button>
      </div>
      <ProjectSectionHeader className="mb-2 rounded-md bg-muted/40" icon={Folders} title={t("platform.tab.projects")} trailing={
        <fieldset className="flex items-center rounded-lg bg-muted/30 p-0.5"><legend className="sr-only">{t("projects.layout")}</legend>
          <Button aria-label={t("projects.grid")} aria-pressed={view==="grid"} className="h-7 w-7 px-0" size="sm" variant={view==="grid"?"secondary":"ghost"} onClick={()=>setView("grid")}><LayoutGrid className="h-3.5 w-3.5"/></Button>
          <Button aria-label={t("projects.list")} aria-pressed={view==="list"} className="h-7 w-7 px-0" size="sm" variant={view==="list"?"secondary":"ghost"} onClick={()=>setView("list")}><List className="h-3.5 w-3.5"/></Button>
        </fieldset>
      } />
      {query.isError?<p role="alert">{t("platform.loadFailed")}</p>:query.isFetching||query.isPending?<p role="status">{t("platform.loading")}</p>:visible.length===0?
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center"><Folders className="h-10 w-10 text-muted-foreground/40"/><div className="space-y-1"><p className="text-sm font-medium">{t(searchText?"projects.noMatch":"projects.empty")}</p><p className="text-sm text-muted-foreground">{t("projects.emptyHint")}</p></div></div>:
        <section className={view==="grid"?"grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3":"flex flex-col"}>
          {visible.map(project=>view==="grid"?<ProjectGridCard key={project.id} project={project} onOpen={onOpen}/>:
            <button key={project.id} type="button" onClick={()=>onOpen(project)} className="mx-2 flex min-h-9 min-w-0 items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/30">
              <Folders className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"/><span className="min-w-0 flex-1 text-sm font-medium"><span className="flex min-w-0 items-baseline gap-2 overflow-hidden"><span className="max-w-full shrink-0 truncate">{project.name}</span><span className="min-w-0 flex-1 truncate text-left font-normal text-muted-foreground/65">{project.description}</span></span></span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground/65"><FolderGit2 className="h-3.5 w-3.5"/>{project.repositoryAddresses.length}</span>
            </button>)}
        </section>}
    </div>
    {active?<aside className="flex w-96 max-w-full shrink-0 flex-col overflow-auto border-l border-border bg-background" aria-label={t("projects.announcement")}>
      <header className="flex items-center gap-2 px-6 py-4"><h2 className="min-w-0 flex-1 break-words text-lg font-semibold">{active.name}</h2>
        <Button variant="ghost" size="icon" aria-label={t("projects.close")} onClick={()=>setSelected(null)}><X className="h-4 w-4"/></Button></header>
      <p className="whitespace-pre-wrap break-words px-6 text-sm text-muted-foreground">{active.description}</p>
      <ProjectDetailMetaList><ProjectDetailMetaRow label={t("projects.owner")}><code className="break-all text-xs">{active.owner}</code></ProjectDetailMetaRow><ProjectDetailMetaRow label={t("projects.address")}><code className="break-all text-xs">{active.projectAddress}</code></ProjectDetailMetaRow></ProjectDetailMetaList>
      <div className="space-y-3 px-6 pb-6"><h3 className="text-sm font-semibold">{t("projects.repositories")}</h3>
        {active.repositories.map(repo=><div key={repo.repoAddress} className="space-y-1 rounded-lg bg-muted/35 p-3"><p className="break-words text-sm font-medium">{repo.name}</p><p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{repo.description}</p><code className="block break-all text-xs">{repo.repoAddress}</code></div>)}
        {active.unavailableRepositoryAddresses?.map(address=><p key={address} className="break-all text-xs">{t("projects.unavailable")} <code>{address}</code></p>)}
        <p className="text-xs text-muted-foreground">{t("projects.readBoundary")}</p>
      </div>
    </aside>:null}
  </div>;
}
