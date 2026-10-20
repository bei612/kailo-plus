// Buzz 779af8886caae1317b4de962082429867ab61503:
// ProjectDetailRightPanel / ProjectConversationPanelContext (detached fallback),
// useProjectPanelWidths, useProjectRepositoryPanel and ProjectRightPanelControls.
// The repository mode only: the original "chat" mode is the project Agent conversation and the
// terminal toggle opens the Desktop-local Buzz Term; neither has a governed consumer here.
import * as React from "react";
import { useUiT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import { DrawerPanelIcon } from "../sidebar/DrawerPanelIcon";
import { useOptionalSidebar } from "../sidebar/sidebar";
import { cn } from "../profile/buzz/shared/lib/cn";
import { useThreadPanelWidth } from "../messages/thread/useThreadPanelWidth";
import { AppTopChromePortal } from "./AppTopChromePortal";
import { ProjectContextRail } from "./ProjectContextRail";
import { ProjectRepositoryActionsPanel, type ProjectRepositoryActionsPanelProps } from "./ProjectRepositoryActionsPanel";
import type { ProjectWorkItemContext } from "./ProjectWorkItemContextDetails";

const REPOSITORY_PANEL_COLLAPSED_KEY = "buzz.desktop.project-repository-panel-collapsed";
/** Default width of the project context rail (repository details and overview). */
export const PROJECT_CONTEXT_PANEL_DEFAULT_WIDTH_PX = 280;
const PROJECT_CONTEXT_PANEL_MIN_WIDTH_PX = 240;

function initialCollapsed() {
  try { return globalThis.sessionStorage?.getItem(REPOSITORY_PANEL_COLLAPSED_KEY) === "true"; }
  catch { return false; }
}

/** Original useProjectRepositoryPanel (repository mode) with useProjectPanelWidths. */
export function useProjectRepositoryPanel() {
  const [collapsed, setCollapsedState] = React.useState(initialCollapsed);
  const width = useThreadPanelWidth(undefined, {
    defaultWidthPx: PROJECT_CONTEXT_PANEL_DEFAULT_WIDTH_PX,
    minWidthPx: PROJECT_CONTEXT_PANEL_MIN_WIDTH_PX,
    sessionKey: "buzz.desktop.project-context-width",
  });
  const setCollapsed = React.useCallback((next: boolean) => {
    setCollapsedState(next);
    try { globalThis.sessionStorage?.setItem(REPOSITORY_PANEL_COLLAPSED_KEY, String(next)); }
    catch { /* Original best-effort presentation preference. */ }
  }, []);
  return {
    collapse: React.useCallback(() => setCollapsed(true), [setCollapsed]),
    collapsed,
    expand: React.useCallback(() => setCollapsed(false), [setCollapsed]),
    width,
  };
}

export type ProjectRepositoryPanelState = ReturnType<typeof useProjectRepositoryPanel>;

/** Original ProjectRightPanelControls: the repository context toggle. */
export function ProjectRightPanelControls({ collapsed, onCollapse, onExpand }: {
  collapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
}) {
  const t = useUiT();
  const repositoryOpen = !collapsed;
  return (
    <div className="flex items-center gap-0.5">
      <Button
        aria-label={t(repositoryOpen ? "projects.context.hide" : "projects.context.show")}
        aria-pressed={repositoryOpen}
        className="h-7 w-7 text-sidebar-foreground hover:bg-sidebar-accent"
        data-testid="project-right-panel-repository-tab"
        onClick={() => { if (repositoryOpen) onCollapse(); else onExpand(); }}
        size="icon"
        title={t("projects.context.title")}
        type="button"
        variant="ghost"
      >
        <DrawerPanelIcon className="-scale-x-100" side={repositoryOpen ? "left" : "right"} testId="project-right-panel-repository-icon"/>
      </Button>
    </div>
  );
}

/** Original detached repository layout: the content pod beside the context rail. */
export function ProjectDetailPanelLayout({ panel, state, children }: {
  panel: React.ReactNode;
  state: ProjectRepositoryPanelState;
  children: React.ReactNode;
}) {
  const sidebar = useOptionalSidebar();
  return (
    <div className={cn("relative flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden bg-sidebar pb-2 pr-2 pt-px", sidebar?.open === false && "pl-2")}
      data-detached="true" data-project-context-detached="true" data-project-detail-screen data-testid="project-panel-layout">
      <div className="relative ml-px flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl bg-background" data-testid="project-content-pod">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden [container-type:inline-size]">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-none px-4 pb-4" data-testid="project-detail-scroll">
            <div className="flex min-h-full w-full flex-col space-y-3">{children}</div>
          </div>
        </div>
      </div>
      <ProjectContextRail open={!state.collapsed} panelWidthPx={state.width.widthPx} resizing={state.width.isResizing}>
        {panel}
      </ProjectContextRail>
    </div>
  );
}

/** A selected Task/Review: the same rail with the work-item context card. */
export function ProjectDetailRightPanel({children,...panel}:ProjectWorkItemContext&Pick<ProjectRepositoryActionsPanelProps,"actions"|"onCreateTask">&{children:React.ReactNode}) {
  const state = useProjectRepositoryPanel();
  return <>
    <AppTopChromePortal><div className="ml-auto flex shrink-0 items-center gap-0.5">
      <ProjectRightPanelControls collapsed={state.collapsed} onCollapse={state.collapse} onExpand={state.expand}/>
    </div></AppTopChromePortal>
    <ProjectDetailPanelLayout state={state} panel={<ProjectRepositoryActionsPanel {...panel} widthPx={state.width.widthPx}
      onResizeStart={state.width.onResizeStart} canResetWidth={state.width.canReset} onResetWidth={state.width.onResetWidth}/>}>
      {children}
    </ProjectDetailPanelLayout>
  </>;
}
