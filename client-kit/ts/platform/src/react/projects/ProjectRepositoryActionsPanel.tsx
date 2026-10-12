// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectRepositoryActionsPanel.tsx.
// Selected Task branch only. Git/source/Agent communication are not empty controls.
import type { ComponentProps,ReactNode } from "react";
import { Plus } from "lucide-react";
import { useUiT } from "../context";
import { RightAuxiliaryPane } from "../messages/thread/RightAuxiliaryPane";
import { Button } from "../profile/buzz/shared/ui/button";
import { PROJECT_CONTEXT_ACTION_BUTTON_CLASS } from "./projectContextActionStyles";
import type { ProjectIssue } from "./projectIssues.mjs";
import { ProjectWorkItemContextDetails } from "./ProjectWorkItemContextDetails";

export function ProjectRepositoryActionsPanel({issue,actions,onCreateTask,...pane}:{
  issue:ProjectIssue;actions:ReactNode;onCreateTask?:()=>void;
}&Pick<ComponentProps<typeof RightAuxiliaryPane>,"widthPx"|"onResizeStart"|"canResetWidth"|"onResetWidth">){
  const t=useUiT();
  return <RightAuxiliaryPane {...pane} detached constrainToAvailableSpace={false} testId="project-repository-actions-panel">
    <div className="relative z-30 min-h-0 flex-1 overflow-y-auto">
      <div className="rounded-2xl bg-background" data-testid="project-context-card">
        <div className="flex min-w-0 items-center justify-between gap-2 px-4 pt-3">
          <h2 className="min-w-0 truncate text-sm font-normal text-muted-foreground/70">{issue.title}</h2>
        </div>
        <div className="space-y-0.5 px-4 pb-3 pt-2">
          <section className="space-y-0.5" data-testid="project-context-actions">
            {actions}
            {onCreateTask?<Button className={PROJECT_CONTEXT_ACTION_BUTTON_CLASS} onClick={onCreateTask} size="sm" type="button" variant="ghost">
              <Plus className="h-3.5 w-3.5"/>{t("projects.issue.create")}
            </Button>:null}
          </section>
          <section className="!mt-2 space-y-0.5 pt-2" data-testid="project-context-details">
            <h3 className="flex h-7 min-w-0 items-center truncate text-sm font-normal text-muted-foreground/70">{t("projects.context.details")}</h3>
            <dl className="text-sm [&>div]:h-7 [&_dd]:ml-auto [&_dd]:tabular-nums [&_dt]:gap-3 [&_dt]:text-foreground [&_dt_svg]:h-4 [&_dt_svg]:w-4 [&_dt_svg]:shrink-0 [&_dt_svg]:text-muted-foreground">
              <ProjectWorkItemContextDetails issue={issue}/>
            </dl>
          </section>
        </div>
      </div>
    </div>
  </RightAuxiliaryPane>;
}
