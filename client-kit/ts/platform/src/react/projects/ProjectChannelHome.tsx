// Fixed Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/projects/ui/ProjectChannelHome.tsx.
// The original channel host, overview rail, toggle and chrome are shared.
// Commits/Files sheets use the host's DD-118 Git reads. The owner's home-repository healing
// (useHealProjectHomeRepositories) and the overview's repository/channel management publish the
// owner's own announcements through the Projects publication host (REQ-24, DD-80, DD-118).
import * as React from "react";
import {Maximize2,Plus} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { WorkspaceChannelCreateChannelType, WorkspaceMembershipState, type DiscoverableWorkspace } from "@client-kit/contracts";
import { useBffClient, useUiT } from "../context";
import { loadChannelDirectory } from "../channel-browser/loadChannelDirectory";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Button } from "../profile/buzz/shared/ui/button";
import { DrawerPanelIcon } from "../sidebar/DrawerPanelIcon";
import { SIDEBAR_WIDTH_MIN, useOptionalSidebar } from "../sidebar/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "../sidebar/tooltip";
import { useThreadPanelWidth } from "../messages/thread/useThreadPanelWidth";
import { ChannelLoadingFallback } from "../messages/ChannelLoadingFallback";
import { ProjectContextRail } from "./ProjectContextRail";
import { ProjectDetailChrome } from "./ProjectDetailChrome";
import { ProjectHomeColumn } from "./ProjectHomeColumn";
import { ProjectHomeContextPanel } from "./ProjectHomeContextPanel";
import type { Project } from "./projectModels";
import { ProjectRepositoryManagement, invalidateProjectAnnouncements } from "./ProjectRepositoryManagement";
import { canHealProjectHomeRepositories, healProjectHomeRepositories } from "./projectRepositoryManagement";
import type { IdleAuxiliaryProps } from "../messages/thread/IdleAuxiliarySurface";
import type { ProjectsHost } from "./projectEnumeration";
import type { ProjectWorkItemTarget } from "./projectWorkItems";
import { ProjectHomeWorkspaceSheet, type ProjectHomeWorkspaceCreateAction, type ProjectHomeWorkspaceDetail, type ProjectHomeWorkspaceSheetTab, type ProjectWorkItemsRenderer } from "./ProjectHomeWorkspaceSheet";

const PROJECT_HOME_SUMMARY_WIDTH_SESSION_KEY = "buzz.desktop.project-home-summary-width";

export type ProjectChannelRenderer = (workspace: DiscoverableWorkspace, auxiliary?: IdleAuxiliaryProps) => React.ReactNode;

export function ProjectChannelHome({ project, projects, scopeKey, viewerPubkey, renderChannel, onGoProjects, onOpenChannel, onOpenProject, host, renderWorkItems }: {
  project: Project;
  /** The directory's projects, for the original Add existing repository chooser. */
  projects?: Project[];
  scopeKey: string;
  /** The signing identity of this Projects host; owner-only management keys on it. */
  viewerPubkey?: string;
  renderChannel: ProjectChannelRenderer;
  onGoProjects: () => void | Promise<void>;
  onOpenChannel: (workspace: DiscoverableWorkspace) => void | Promise<void>;
  host?: ProjectsHost;
  renderWorkItems?: ProjectWorkItemsRenderer;
  onOpenProject?: (id:string|null,target?:ProjectWorkItemTarget)=>void|Promise<void>;
}) {
  const t = useUiT();
  const client = useBffClient();
  const cache = useQueryClient();
  const sidebar = useOptionalSidebar();
  const [summaryOpen, setSummaryOpen] = React.useState(true);
  const [workspaceTab, setWorkspaceTab] = React.useState<ProjectHomeWorkspaceSheetTab | null>(null);
  const [repositoryId, setRepositoryId] = React.useState<string | null>(null);
  const [workspaceDetail, setWorkspaceDetail] = React.useState<ProjectHomeWorkspaceDetail | null>(null);
  const [workspaceCreateAction,setWorkspaceCreateAction]=React.useState<ProjectHomeWorkspaceCreateAction|null>(null);
  const [addRepositoryOpen,setAddRepositoryOpen]=React.useState(false);
  const repository = project.repositories.find(item => item.id === repositoryId) ?? project.repositories[0];
  const workspaceOpen = Boolean(workspaceTab && repository && host && renderWorkItems);
  const previousWorkspaceOpenRef = React.useRef(workspaceOpen);
  const workspaceVisibilityChanged = previousWorkspaceOpenRef.current !== workspaceOpen;
  React.useEffect(() => { previousWorkspaceOpenRef.current = workspaceOpen; }, [workspaceOpen]);
  const summaryVisible = summaryOpen && !workspaceOpen;
  const closeWorkspace = React.useCallback(() => { setWorkspaceTab(null); setWorkspaceDetail(null); }, []);
  const openWorkspace = (tab: ProjectHomeWorkspaceSheetTab, id: string) => {
    setRepositoryId(id); setWorkspaceDetail(null); setWorkspaceTab(current => current === tab ? null : tab);
  };
  const [navigationFailed, setNavigationFailed] = React.useState(false);
  const lifetime = React.useMemo(() => ({ active: true }), [client, scopeKey]);
  React.useEffect(() => {
    lifetime.active = true;
    return () => { lifetime.active = false; };
  }, [lifetime]);
  const key = React.useMemo(() => ["project-home-channels", scopeKey, project.id], [scopeKey, project.id]);
  const channelsQuery = useQuery({ queryKey: key,
    queryFn: ({ signal }) => loadChannelDirectory(client, () => lifetime.active && !signal.aborted),
    retry: false, refetchOnWindowFocus: "always" });
  React.useEffect(() => () => {
    void cache.cancelQueries({ queryKey: key });
    cache.removeQueries({ queryKey: key });
  }, [cache, key]);
  // A signed project reference and a stale directory never grant channel access.
  const channels = channelsQuery.isSuccess && !channelsQuery.isFetching ? channelsQuery.data.filter(
    channel => channel.isMember && channel.membershipState === WorkspaceMembershipState.Active,
  ) : [];
  const homeChannel = channels.find(channel => channel.channel.channelId === project.projectChannelId
    && channel.channel.channelType === WorkspaceChannelCreateChannelType.Stream);
  const width = useThreadPanelWidth(undefined, {
    minWidthPx: SIDEBAR_WIDTH_MIN, sessionKey: PROJECT_HOME_SUMMARY_WIDTH_SESSION_KEY,
  });
  const navigate = (action: () => void | Promise<void>) => {
    void Promise.resolve().then(() => { if (lifetime.active) return action(); })
      .catch(() => { if (lifetime.active) setNavigationFailed(true); });
  };
  const openChannel = (channelId: string) => navigate(async () => {
    const current = (await loadChannelDirectory(client, () => lifetime.active, channelId))[0];
    if (!current?.isMember || current.membershipState !== WorkspaceMembershipState.Active)
      throw new Error("Project channel membership changed");
    if (lifetime.active) await onOpenChannel(current);
  });
  // Original useHealProjectHomeRepositories: Kailo project data is always a fresh Relay read.
  const healingEnabled = Boolean(host?.publish) && canHealProjectHomeRepositories({ identityPubkey: viewerPubkey, project, projectDataIsAuthoritative: true });
  const healingAttempted = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!healingEnabled || !host) return;
    const controller = new AbortController();
    void healProjectHomeRepositories(host, project, healingAttempted.current, controller.signal)
      .then(attached => { if (attached > 0 && !controller.signal.aborted) void invalidateProjectAnnouncements(cache, host.scopeKey); })
      .catch(() => { /* Already bound, raced, or not owner-writable this session. */ });
    return () => controller.abort();
  }, [cache, healingEnabled, host, project]);
  const openRepository = (repositoryId: string, tab?: string) => {
    if (!onOpenProject) return;
    navigate(() => onOpenProject(project.id, { repositoryId, ...(tab ? { tab } : {}) }));
  };
  const refreshProjectHome = () => {
    if (!onOpenProject) return;
    navigate(() => onOpenProject(project.id));
  };
  const toggleLabel = t(summaryVisible ? "projects.home.hideOverview" : "projects.home.showOverview");
  const sheetTitle = t(workspaceTab === "prs" ? "projects.list.reviews" : workspaceTab === "commits" ? "projects.workItem.commits"
    : workspaceTab === "files" ? "projects.git.files" : "projects.list.tasks");
  const expandLabel = t("projects.sheet.expand", {section:sheetTitle});
  const selectWorkspaceRepository = React.useCallback((id: string) => {
    setWorkspaceCreateAction(null); setWorkspaceDetail(null); setRepositoryId(id);
  }, []);
  const openCommit = (commitHash: string) => {
    if (!repository || !onOpenProject) return;
    navigate(() => onOpenProject(project.id, {repositoryId:repository.id,commitHash,tab:"commits"}));
  };
  const expandWorkspace = () => {
    if (!repository || !workspaceTab || !onOpenProject) return;
    navigate(() => onOpenProject(project.id, {repositoryId:repository.id,...workspaceDetail?.navigation,tab:workspaceTab}));
  };
  const workspaceSheet = workspaceOpen && host && renderWorkItems && repository && workspaceTab
    ? <ProjectHomeWorkspaceSheet key={`${scopeKey}:${project.id}:${repository.id}:${workspaceTab}`}
        host={host} project={project} repositoryId={repository.id} tab={workspaceTab}
        renderWorkItems={renderWorkItems} onDetailChange={setWorkspaceDetail} onCreateActionChange={setWorkspaceCreateAction}
        onOpenCommit={onOpenProject ? openCommit : undefined} onSelectRepository={selectWorkspaceRepository}/> : undefined;
  return <div className={cn("relative flex min-h-0 min-w-0 flex-1 overflow-hidden",
    summaryVisible && "bg-sidebar", summaryVisible && sidebar?.open === false && "pl-2")}
    data-project-context-detached={summaryVisible ? "true" : undefined}
    data-project-detail-screen data-repository-healing-enabled={healingEnabled} data-testid="project-channel-home">
    <div className={cn("relative flex min-h-0 min-w-60 flex-1 flex-col overflow-hidden",
      summaryVisible ? "mb-2 ml-px mt-px rounded-2xl bg-background" : "bg-muted/20")}>
      <ProjectDetailChrome actions={<Tooltip disableHoverableContent><TooltipTrigger asChild>
        <Button aria-label={toggleLabel} aria-pressed={summaryVisible}
          className="h-7 w-7 text-sidebar-foreground hover:bg-sidebar-accent"
          data-testid="project-home-drawer-toggle" onClick={() => { if (workspaceOpen) { closeWorkspace(); return; } setSummaryOpen(open => !open); }}
          size="icon" title={t("projects.home.overview")} type="button" variant="ghost">
          <DrawerPanelIcon className="-scale-x-100" side={summaryVisible ? "left" : "right"}/>
        </Button>
      </TooltipTrigger><TooltipContent>{t("projects.home.overview")}</TooltipContent></Tooltip>}
        activeTabCrumb={null} activeWorkItemCrumb={null} onGoProjectHome={() => undefined}
        onGoProjects={() => navigate(onGoProjects)} project={project}/>
      {navigationFailed ? <p role="alert">{t("platform.loadFailed")}</p> : null}
      {channelsQuery.isPending || channelsQuery.isFetching ? <ChannelLoadingFallback/>
        : channelsQuery.isError ? <p role="alert">{t("platform.loadFailed")}</p>
        : homeChannel ? renderChannel(homeChannel, {
            idleAuxiliaryPanel: workspaceSheet,
            idleAuxiliaryHeaderActions: {...workspaceDetail,actions:<>{workspaceCreateAction?<Tooltip disableHoverableContent>
              <TooltipTrigger asChild><Button aria-label={workspaceCreateAction.label}
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                data-testid="project-home-workspace-sheet-create" disabled={workspaceCreateAction.disabled}
                onClick={workspaceCreateAction.onClick} size="icon" title={workspaceCreateAction.label} type="button" variant="ghost">
                <Plus className="h-4 w-4"/>
              </Button></TooltipTrigger><TooltipContent>{workspaceCreateAction.label}</TooltipContent>
            </Tooltip>:null}{onOpenProject&&workspaceOpen?<Tooltip disableHoverableContent><TooltipTrigger asChild>
              <Button aria-label={expandLabel} className="shrink-0" data-testid="project-home-workspace-sheet-expand"
                onClick={expandWorkspace} size="icon" title={expandLabel} type="button" variant="ghost"><Maximize2/></Button>
            </TooltipTrigger><TooltipContent>{expandLabel}</TooltipContent></Tooltip>:null}</>},
            idleAuxiliaryOverridesThread: workspaceOpen,
            idleAuxiliaryTitle: sheetTitle,
            onCloseIdleAuxiliaryPanel: closeWorkspace,
          })
        : <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-8">
          <p className="text-sm text-muted-foreground">{t("projects.home.channelMissing")}</p>
        </div>}
    </div>
    {host ? <ProjectRepositoryManagement createOpen={addRepositoryOpen} hideTriggers host={host} identityPubkey={viewerPubkey}
      onChange={repositoryId => openWorkspace("files", repositoryId)} onCreateOpenChange={setAddRepositoryOpen} project={project} projects={projects ?? [project]}/> : null}
    <ProjectContextRail open={summaryVisible} panelWidthPx={width.widthPx} resizing={width.isResizing}
      animateWidth={!workspaceVisibilityChanged}
      rounded={false} testId="project-home-summary-rail">
      {summaryVisible ? <ProjectHomeColumn bodyClassName="overflow-y-auto overflow-x-hidden overscroll-contain"
        canResetWidth={width.canReset} onResetWidth={width.onResetWidth} onResizeStart={width.onResizeStart}
        testId="project-home-summary-column" widthPx={width.widthPx}>
        <ProjectHomeContextPanel project={project}
          channels={channels.map(channel => ({ id: channel.channel.channelId, name: channel.channel.name }))}
          onOpenChannel={openChannel} activeWorkspaceTab={workspaceTab}
          onOpenWorkspace={host && renderWorkItems ? openWorkspace : undefined} host={host}
          identityPubkey={viewerPubkey} projects={projects ?? [project]}
          onAddRepository={host?.publish ? () => setAddRepositoryOpen(true) : undefined}
          onOpenRepository={onOpenProject ? repositoryId => openRepository(repositoryId) : undefined}
          onOpenRepositoryTab={onOpenProject ? openRepository : undefined}
          onRepositoryChange={refreshProjectHome}/>
      </ProjectHomeColumn> : null}
    </ProjectContextRail>
  </div>;
}
