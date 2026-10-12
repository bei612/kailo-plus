// Buzz 779af8886caae1317b4de962082429867ab61503:
// ProjectDetailRightPanel / ProjectConversationPanelContext (detached fallback),
// useProjectPanelWidths, useProjectRepositoryPanel and ProjectRightPanelControls.
// Only the repository Task branch has an executable governed host here.
import * as React from "react";
import { useUiT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import { DrawerPanelIcon } from "../sidebar/DrawerPanelIcon";
import { useOptionalSidebar } from "../sidebar/sidebar";
import { cn } from "../profile/buzz/shared/lib/cn";
import { useThreadPanelWidth } from "../messages/thread/useThreadPanelWidth";
import { AppTopChromePortal } from "./AppTopChromePortal";
import { ProjectContextRail } from "./ProjectContextRail";
import { ProjectRepositoryActionsPanel } from "./ProjectRepositoryActionsPanel";

const REPOSITORY_PANEL_COLLAPSED_KEY = "buzz.desktop.project-repository-panel-collapsed";
function initialCollapsed() {
  try { return globalThis.sessionStorage?.getItem(REPOSITORY_PANEL_COLLAPSED_KEY) === "true"; }
  catch { return false; }
}

export function ProjectDetailRightPanel({children,...panel}:Omit<React.ComponentProps<typeof ProjectRepositoryActionsPanel>,"widthPx"|"onResizeStart"|"canResetWidth"|"onResetWidth">&{children:React.ReactNode}) {
  const t=useUiT();
  const sidebar=useOptionalSidebar();
  const [collapsed,setCollapsedState]=React.useState(initialCollapsed);
  const width=useThreadPanelWidth(undefined,{defaultWidthPx:280,minWidthPx:240,sessionKey:"buzz.desktop.project-context-width"});
  const setCollapsed=(next:boolean)=>{
    setCollapsedState(next);
    try {globalThis.sessionStorage?.setItem(REPOSITORY_PANEL_COLLAPSED_KEY,String(next));}
    catch {/* Original best-effort presentation preference. */}
  };
  return <>
    <AppTopChromePortal><div className="ml-auto flex shrink-0 items-center gap-0.5">
      <div className="flex items-center gap-0.5"><Button
        aria-label={t(collapsed?"projects.context.show":"projects.context.hide")} aria-pressed={!collapsed}
        className="h-7 w-7 text-sidebar-foreground hover:bg-sidebar-accent" data-testid="project-right-panel-repository-tab"
        onClick={()=>setCollapsed(!collapsed)} size="icon" title={t("projects.context.title")} type="button" variant="ghost">
        <DrawerPanelIcon className="-scale-x-100" side={collapsed?"right":"left"} testId="project-right-panel-repository-icon"/>
      </Button></div>
    </div></AppTopChromePortal>
    <div className={cn("relative flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden bg-sidebar pb-2 pr-2 pt-px",sidebar?.open===false&&"pl-2")}
      data-detached="true" data-project-context-detached="true" data-project-detail-screen data-testid="project-panel-layout">
      <div className="relative ml-px flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl bg-background" data-testid="project-content-pod">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden [container-type:inline-size]">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-none px-4 pb-4" data-testid="project-detail-scroll">
            <div className="flex min-h-full w-full flex-col space-y-3">{children}</div>
          </div>
        </div>
      </div>
      <ProjectContextRail open={!collapsed} panelWidthPx={width.widthPx} resizing={width.isResizing}>
        <ProjectRepositoryActionsPanel {...panel} widthPx={width.widthPx} onResizeStart={width.onResizeStart}
          canResetWidth={width.canReset} onResetWidth={width.onResetWidth}/>
      </ProjectContextRail>
    </div>
  </>;
}
