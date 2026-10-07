// Original Buzz 779af8886caae1317b4de962082429867ab61503 ProjectBrowserDialog
// browse branch. Creation remains absent until its governed host exists.
import { Check, Folders, Search } from "lucide-react";
import * as React from "react";
import { useUiT } from "../context";
import type { Project } from "./projectModels";
import { Button } from "../profile/buzz/shared/ui/button";
import { ChooserDialogContent } from "../composer/shared/ui/chooser-dialog-content";
import { Dialog } from "../composer/shared/ui/dialog";
import { MODAL_SEARCH_INPUT_CLASS, MODAL_SEARCH_SHELL_CLASS } from "../channel-browser/modalSearchStyles";

export function ProjectBrowserDialog({onOpenChange,onSelectProject,open,projects,selectedProjectAddresses,pending}: {
  onOpenChange:(open:boolean)=>void; onSelectProject:(project:Project)=>void;
  open:boolean; projects:readonly Project[]; selectedProjectAddresses:ReadonlySet<string>; pending:boolean;
}) {
  const t=useUiT();
  const [query,setQuery]=React.useState("");
  const inputRef=React.useRef<HTMLInputElement>(null);
  const deferredQuery=React.useDeferredValue(query.trim().toLocaleLowerCase());
  React.useEffect(()=>{if(!open)return;setQuery("");const timer=globalThis.setTimeout(()=>inputRef.current?.focus(),50);return()=>globalThis.clearTimeout(timer);},[open]);
  const visibleProjects=React.useMemo(()=>[...projects]
    .sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:"base"}))
    .filter(project=>!deferredQuery||[project.name,project.description,...project.repositories.flatMap(repo=>[repo.name,repo.description])]
      .filter(Boolean).join(" ").toLocaleLowerCase().includes(deferredQuery)),[projects,deferredQuery]);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <ChooserDialogContent className="max-w-lg" contentClassName="space-y-3 pt-1" data-testid="project-browser-dialog"
      headerClassName="pb-2" scrollAreaClassName="px-3" title={t("sidebar.projects.addTitle")}>
      <div className={MODAL_SEARCH_SHELL_CLASS}><Search className="h-4 w-4 shrink-0 text-muted-foreground"/>
        <input aria-label={t("projects.search")} className={MODAL_SEARCH_INPUT_CLASS} onChange={event=>setQuery(event.target.value)}
          placeholder={t("projects.search")} ref={inputRef} type="search" value={query}/></div>
      <div className="border-t border-border/60 pt-2">{visibleProjects.length>0?<div className="space-y-0.5">{visibleProjects.map(project=><Button
        className="h-auto w-full justify-start gap-3 rounded-lg px-3 py-2.5 text-left" data-testid={`project-browser-result-${project.dtag}`}
        key={project.id} disabled={pending} onClick={()=>{onOpenChange(false);onSelectProject(project);}} type="button" variant="ghost">
        <Folders className="h-4 w-4 shrink-0 text-muted-foreground"/><span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{project.name}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">{project.description||t("projects.repositoryCount",{count:project.repositories.length})}</span></span>
        {selectedProjectAddresses.has(project.projectAddress)?<span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5"/>{t("sidebar.projects.added")}</span>:null}
      </Button>)}</div>:<div className="px-4 py-10 text-center"><p className="text-sm font-medium text-foreground">{t("projects.noMatch")}</p></div>}</div>
    </ChooserDialogContent>
  </Dialog>;
}
