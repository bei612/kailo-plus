// Original ProjectGridCard, Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectCards.tsx.
// Existing governed management actions occupy the original action slot. Git
// statistics/terminal actions still require their actual production chains.
import * as React from "react";
import {FolderGit2,Folders,Plus} from "lucide-react";
import {twMerge as cn} from "tailwind-merge";
import {useUiT} from "../context";
import type {Project} from "./projectModels";
import {Button} from "../profile/buzz/shared/ui/button";
import {listRowDescription} from "./lib/projectsViewHelpers";
import {ProjectEntityListRow} from "./ProjectEntityListRow";

function StatusPill({status}:{status:string}) {
  const t=useUiT();
  if(status==="active")return null;
  return <span className="shrink-0 rounded-full border border-border/60 bg-muted/40 px-2 pb-[3px] pt-[5px] text-2xs font-semibold uppercase leading-none tracking-[0.18em] text-muted-foreground">
    {status==="unlisted"?t("projects.unlisted"):status}
  </span>;
}

export function EmptyState({onCreateProject}:{onCreateProject?:()=>void}) {
  const t=useUiT();
  return <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center">
    <Folders className="h-10 w-10 text-muted-foreground/40"/>
    <div className="space-y-1"><p className="text-sm font-medium text-foreground">{t("projects.empty")}</p>
      <p className="text-sm text-muted-foreground">{t("projects.emptyHint")}</p></div>
    {onCreateProject?<Button onClick={onCreateProject} size="sm" type="button"><Plus className="h-4 w-4"/>{t("projects.create.submit")}</Button>:null}
  </div>;
}

export function EmptyFilteredState() {
  const t=useUiT();
  return <div className="flex flex-1 flex-col items-center justify-center gap-3 border border-dashed border-border/60 px-4 py-12 text-center">
    <Folders className="h-9 w-9 text-muted-foreground/40"/>
    <div className="space-y-1"><p className="text-sm font-medium text-foreground">{t("projects.noMatch")}</p>
      <p className="text-sm text-muted-foreground">{t("projects.filteredHint")}</p></div>
  </div>;
}

export const ProjectGridCard = React.memo(function ProjectGridCard({
  project,
  onOpen,
  actions,
}: {project:Project;onOpen:(project:Project)=>void;actions?:React.ReactNode}) {
  const t=useUiT();
  return (
    <div
      className="group relative flex h-full min-h-40 flex-col overflow-hidden rounded-xl border border-border/60 bg-transparent text-card-foreground shadow-none transition-colors duration-150 hover:bg-muted/20"
      data-projects-grid-card
      data-testid={`project-card-${project.dtag}`}
    >
      <button className="absolute inset-0 z-0 cursor-pointer" onClick={()=>onOpen(project)} type="button"><span className="sr-only">{t("projects.view",{name:project.name})}</span></button>
      <div className="pointer-events-none relative z-10 flex min-h-0 flex-1 flex-col">
        <div className="flex min-w-0 items-start justify-between gap-3 px-4 pt-3">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40">
              <Folders className="h-4.5 w-4.5 text-muted-foreground" />
            </span>
            <div className="min-w-0 flex-1">
              <span
                className="block break-words text-sm font-semibold leading-5 text-foreground"
                data-projects-text-priority="primary"
                data-testid="project-grid-card-name"
              >
                {project.name}
              </span>
              <div
                className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
                data-projects-text-priority="secondary"
              >
                <span>
                  {t(project.repositoryAddresses.length===1?"projects.oneRepository":"projects.repositoryCount",{count:project.repositoryAddresses.length})}
                </span>
                <StatusPill status={project.status}/>
              </div>
            </div>
          </div>
          {actions?<div className="pointer-events-auto relative z-10 shrink-0">{actions}</div>:null}
        </div>

        <p
          className={cn(
            "line-clamp-2 max-h-10 shrink-0 overflow-hidden text-sm leading-5",
            "mx-4 my-2 text-muted-foreground",
          )}
          data-testid="projects-grid-card-body"
        >
          {project.description || t("projects.defaultDescription")}
        </p>


      </div>
    </div>
  );
});

// Original ProjectListRow consumes the same shared row as project channels.
// Until the Git activity read chain is restored, use the original
// getProjectUpdatedAt fallback (project.createdAt), not fabricated activity.
export const ProjectListRow = React.memo(function ProjectListRow({project,onOpen,actions}:{
  project:Project;onOpen:(project:Project)=>void;actions?:React.ReactNode;
}) {
  const t=useUiT();
  return <ProjectEntityListRow
    affiliation={
      <span className="flex items-center justify-end gap-1"><FolderGit2 className="h-3.5 w-3.5"/><span>{project.repositoryAddresses.length}</span></span>
    }
    affiliationClassName="w-auto"
    affiliationTestId="projects-row-context"
    affiliationTitle={t(project.repositoryAddresses.length===1?"projects.oneRepository":"projects.repositoryCount",{count:project.repositoryAddresses.length})}
    dateSeconds={project.createdAt}
    dateTestId="projects-row-date"
    icon={<Folders className="h-3.5 w-3.5 text-muted-foreground/70"/>}
    onClick={()=>onOpen(project)}
    testId={`project-row-${project.dtag}`}
    title={<span className="flex min-w-0 items-center gap-2">
      <span className="truncate">{project.name}</span>
      <StatusPill status={project.status}/>
    </span>}
    titleAttr={project.name}
    titleSecondary={listRowDescription(project.description,project.name)}
    titleSecondaryTestId="projects-row-description"
    trailing={actions}
  />;
});
