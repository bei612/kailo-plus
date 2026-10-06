// Original ProjectGridCard, Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectCards.tsx.
// Announcement-only host: no fabricated Git statistics or ungoverned action menu.
import * as React from "react";
import {Folders} from "lucide-react";
import {twMerge as cn} from "tailwind-merge";
import {useUiT} from "../context";
import type {Project} from "./projectModels";
export const ProjectGridCard = React.memo(function ProjectGridCard({
  project,
  onOpen,
}: {project:Project;onOpen:(project:Project)=>void}) {
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
                  {t("projects.repositoryCount",{count:project.repositoryAddresses.length})}
                </span>
                {project.visibility==="unlisted"?<span>{t("projects.unlisted")}</span>:null}

              </div>
            </div>
          </div>
        </div>

        <p
          className={cn(
            "line-clamp-2 max-h-10 shrink-0 overflow-hidden text-sm leading-5",
            "mx-4 my-2 text-muted-foreground",
          )}
          data-testid="projects-grid-card-body"
        >
          {project.description}
        </p>


      </div>
    </div>
  );
});
