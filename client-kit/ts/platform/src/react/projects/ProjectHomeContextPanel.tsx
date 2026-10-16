// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectHomeContextPanel.tsx.
// Original channel and Tasks/Reviews sections, plus Commits/Files when the host offers Git reads
// (DD-118). People, activity counts and management consumers remain un-restored; do not turn
// those missing consumers into empty or alternative destinations.
import { ChevronDown, CircleDot, FileCode2, GitCommitHorizontal, GitPullRequest, Hash } from "lucide-react";
import * as React from "react";
import { useUiT } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Button } from "../profile/buzz/shared/ui/button";
import { SECTION_ACTION_VISIBILITY_CLASS } from "../sidebar/sidebarSectionStyles";
import { ProjectChannelIcon } from "./ProjectChannelIcon";
import { listProjectBoundChannels } from "./lib/projectRelatedChannels";
import type { Project } from "./projectModels";
import type { ProjectsHost } from "./projectEnumeration";
import { useProjectRepoSnapshotQuery } from "./projectGitQueries";
import type { ProjectHomeWorkspaceSheetTab } from "./ProjectHomeWorkspaceSheet";
type Channel = { id: string; name: string };
const PROJECT_HOME_SIDEBAR_ROW_CLASS =
  "h-8 w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left text-sm font-normal text-sidebar-foreground/80 transition-[background-color,color] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50";

function ContextSection({
  children,
  collapsible = false,
  headerAction,
  testId,
  title,
}: {
  children: React.ReactNode;
  collapsible?: boolean;
  headerAction?: React.ReactNode;
  testId?: string;
  title?: string;
}) {
  const [expanded, setExpanded] = React.useState(true);
  return (
    <section className="group/sidebar-section space-y-1" data-testid={testId}>
      {title || headerAction ? (
        <div className="flex h-8 min-w-0 items-center justify-between gap-2 px-2">
          {title && collapsible ? (
            <button
              aria-expanded={expanded}
              className="group/section-label flex min-w-0 items-center gap-1 text-left text-xs font-medium text-sidebar-foreground/70"
              onClick={() => setExpanded((current) => !current)}
              type="button"
            >
              <span className="truncate">{title}</span>
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "size-3 shrink-0 opacity-0 transition-[opacity,transform] group-hover/sidebar-section:opacity-100 group-focus-within/sidebar-section:opacity-100",
                  expanded ? "rotate-0" : "-rotate-90",
                )}
              />
            </button>
          ) : title ? (
            <h3 className="min-w-0 truncate text-xs font-medium text-sidebar-foreground/70">
              {title}
            </h3>
          ) : (
            <span />
          )}
          {headerAction ? (
            <span className={SECTION_ACTION_VISIBILITY_CLASS}>
              {headerAction}
            </span>
          ) : null}
        </div>
      ) : null}
      {!collapsible || expanded ? children : null}
    </section>
  );
}

function ContextRowContent({
  children,
  count,
  icon,
}: {
  children: React.ReactNode;
  count?: number;
  icon: React.ReactNode;
}) {
  return (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center text-current">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-left">{children}</span>
      <span className="w-8 shrink-0 text-right tabular-nums text-current opacity-60">
        {count ?? ""}
      </span>
    </>
  );
}

function ContextNavButton({
  children,
  count,
  disabled,
  icon,
  onClick,
  pressed,
  testId,
  title,
}: {
  children: React.ReactNode;
  count?: number;
  disabled?: boolean;
  icon: React.ReactNode;
  onClick?: () => void;
  pressed?: boolean;
  testId?: string;
  title?: string;
}) {
  return (
    <Button
      aria-pressed={pressed}
      className={cn(
        PROJECT_HOME_SIDEBAR_ROW_CLASS,
        pressed &&
          "bg-sidebar-active text-sidebar-active-foreground shadow-xs hover:bg-sidebar-active hover:text-sidebar-active-foreground",
      )}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      size="sm"
      title={title}
      type="button"
      variant="ghost"
    >
      <ContextRowContent count={count} icon={icon}>
        {children}
      </ContextRowContent>
    </Button>
  );
}

function ChannelContextRow({
  channel,
  onClick,
  projectHome,
  testId,
}: {
  channel: Channel;
  onClick?: () => void;
  projectHome?: boolean;
  testId: string;
}) {
  const Icon = projectHome ? ProjectChannelIcon : Hash;
  if (onClick) {
    return (
      <ContextNavButton icon={<Icon />} onClick={onClick} testId={testId}>
        {channel.name}
      </ContextNavButton>
    );
  }
  return (
    <div
      className={`${PROJECT_HOME_SIDEBAR_ROW_CLASS} pointer-events-none flex items-center`}
      data-testid={testId}
    >
      <ContextRowContent icon={<Icon />}>{channel.name}</ContextRowContent>
    </div>
  );
}


/** Original Commits/Files rows; the Files count is the first repository's snapshot size. */
function ProjectHomeGitNav({ host, project, activeWorkspaceTab, onOpenWorkspace }: {
  host: ProjectsHost;
  project: Project;
  activeWorkspaceTab?: ProjectHomeWorkspaceSheetTab | null;
  onOpenWorkspace: (tab: ProjectHomeWorkspaceSheetTab, repositoryId: string) => void;
}) {
  const t = useUiT();
  const firstRepository = project.repositories[0] ?? null;
  const snapshotQuery = useProjectRepoSnapshotQuery(host, firstRepository, firstRepository?.defaultBranch ?? null, null, Boolean(firstRepository));
  const fileCount = snapshotQuery.data?.files.length;
  return <>
    <ContextNavButton disabled={!firstRepository} icon={<GitCommitHorizontal/>}
      onClick={() => { if (firstRepository) onOpenWorkspace("commits", firstRepository.id); }}
      pressed={activeWorkspaceTab === "commits"} testId="project-home-context-commits">
      {t("projects.workItem.commits")}
    </ContextNavButton>
    <ContextNavButton count={fileCount != null && fileCount > 0 ? fileCount : undefined} disabled={!firstRepository} icon={<FileCode2/>}
      onClick={() => { if (firstRepository) onOpenWorkspace("files", firstRepository.id); }}
      pressed={activeWorkspaceTab === "files"} testId="project-home-context-files">
      {t("projects.git.files")}
    </ContextNavButton>
  </>;
}

export function ProjectHomeContextPanel({ project, channels, onOpenChannel, activeWorkspaceTab, onOpenWorkspace, host }: {
  project: Project;
  channels: Channel[];
  onOpenChannel: (channelId: string) => void;
  activeWorkspaceTab?: ProjectHomeWorkspaceSheetTab | null;
  onOpenWorkspace?: (tab: ProjectHomeWorkspaceSheetTab, repositoryId: string) => void;
  host?: ProjectsHost;
}) {
  const t = useUiT();
  const channelsById = new Map(channels.map(channel => [channel.id, channel]));
  const listedChannels = listProjectBoundChannels(project).flatMap(binding => {
    const channel = channelsById.get(binding.channelId);
    return channel ? [{ ...binding, channel }] : [];
  });
  return <div className="space-y-4 px-2 pb-8 pt-3" data-testid="project-home-context-panel">
      {onOpenWorkspace ? <ContextSection testId="project-home-context-workspace">
        <ContextNavButton disabled={!project.repositories[0]} icon={<CircleDot/>}
          onClick={() => { if (project.repositories[0]) onOpenWorkspace("issues", project.repositories[0].id); }}
          pressed={activeWorkspaceTab === "issues"} testId="project-home-context-tasks">
          {t("projects.list.tasks")}
        </ContextNavButton>
        <ContextNavButton disabled={!project.repositories[0]} icon={<GitPullRequest/>}
          onClick={() => { if (project.repositories[0]) onOpenWorkspace("prs", project.repositories[0].id); }}
          pressed={activeWorkspaceTab === "prs"} testId="project-home-context-reviews">
          {t("projects.list.reviews")}
        </ContextNavButton>
        {host?.git ? <ProjectHomeGitNav host={host} project={project} activeWorkspaceTab={activeWorkspaceTab} onOpenWorkspace={onOpenWorkspace}/> : null}
      </ContextSection> : null}
      <ContextSection
        collapsible
        testId="project-home-context-channel"
        title={t("sidebar.channels")}
      >
        {listedChannels.length > 0 ? (
          listedChannels.map((binding) => {
            const isHome = binding.role === "home";
            return (
              <ChannelContextRow
                channel={binding.channel}
                key={`${binding.role}:${binding.channel.id}`}
                onClick={
                  isHome || !onOpenChannel
                    ? undefined
                    : () => onOpenChannel(binding.channel.id)
                }
                projectHome={isHome}
                testId={
                  isHome
                    ? "project-home-context-home-channel"
                    : `project-home-context-channel-${binding.channel.name}`
                }
              />
            );
          })
        ) : (
          <p
            className={`${PROJECT_HOME_SIDEBAR_ROW_CLASS} pointer-events-none flex items-center`}
          >
            <ContextRowContent icon={<Hash />}>{t("projects.home.unavailable")}</ContextRowContent>
          </p>
        )}
      </ContextSection>
  </div>;
}
