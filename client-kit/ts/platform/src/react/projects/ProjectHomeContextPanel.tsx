// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectHomeContextPanel.tsx.
// Original channel and Tasks/Reviews sections, plus Commits/Files/People when the host offers Git
// reads (DD-118), the Channels section's ProjectChannelManagement and the Codebase section with
// ProjectRepositoryManagement (REQ-24, DD-80, DD-118). The workspace activity counts read the
// project activity summaries, which this rail does not load; no count is invented.
import { ChevronDown, CircleDot, FileCode2, FolderGit2, GitCommitHorizontal, GitPullRequest, Hash, Users } from "lucide-react";
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
import { ProjectChannelManagement } from "./ProjectChannelManagement";
import { ProjectRepositoryManagement } from "./ProjectRepositoryManagement";
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


/** Original Commits/Files/People rows; the Files count is the first repository's snapshot size. */
function ProjectHomeGitNav({ host, project, activeWorkspaceTab, onAddRepository, onOpenWorkspace, onOpenRepositoryTab }: {
  host: ProjectsHost;
  project: Project;
  activeWorkspaceTab?: ProjectHomeWorkspaceSheetTab | null;
  onAddRepository?: () => void;
  onOpenWorkspace: (tab: ProjectHomeWorkspaceSheetTab, repositoryId: string) => void;
  onOpenRepositoryTab?: (repositoryId: string, tab: string) => void;
}) {
  const t = useUiT();
  const firstRepository = project.repositories[0] ?? null;
  const snapshotQuery = useProjectRepoSnapshotQuery(host, firstRepository, firstRepository?.defaultBranch ?? null, null, Boolean(firstRepository));
  const fileCount = snapshotQuery.data?.files.length;
  const peopleCount = new Set([project.owner, ...project.repositories.flatMap(repository => repository.contributors)]).size;
  const addRepositoryTitle = firstRepository ? undefined : t("projects.home.addRepositoryHint");
  const open = (tab: ProjectHomeWorkspaceSheetTab) => {
    if (firstRepository) onOpenWorkspace(tab, firstRepository.id);
    else onAddRepository?.();
  };
  return <>
    <ContextNavButton disabled={!firstRepository && !onAddRepository} icon={<GitCommitHorizontal/>}
      onClick={() => open("commits")} title={addRepositoryTitle}
      pressed={activeWorkspaceTab === "commits"} testId="project-home-context-commits">
      {t("projects.workItem.commits")}
    </ContextNavButton>
    <ContextNavButton count={fileCount != null && fileCount > 0 ? fileCount : undefined} disabled={!firstRepository && !onAddRepository} icon={<FileCode2/>}
      onClick={() => open("files")} title={addRepositoryTitle}
      pressed={activeWorkspaceTab === "files"} testId="project-home-context-files">
      {t("projects.git.files")}
    </ContextNavButton>
    {onOpenRepositoryTab ? <ContextNavButton count={peopleCount > 0 ? peopleCount : undefined} disabled={!firstRepository} icon={<Users/>}
      onClick={() => { if (firstRepository) onOpenRepositoryTab(firstRepository.id, "contributors"); }} title={addRepositoryTitle}
      testId="project-home-context-people">
      {t("projects.home.people")}
    </ContextNavButton> : null}
  </>;
}

export function ProjectHomeContextPanel({ project, channels, onOpenChannel, activeWorkspaceTab, onOpenWorkspace, host,
  identityPubkey, projects, onAddRepository, onOpenRepository, onOpenRepositoryTab, onRepositoryChange }: {
  project: Project;
  channels: Channel[];
  onOpenChannel: (channelId: string) => void;
  activeWorkspaceTab?: ProjectHomeWorkspaceSheetTab | null;
  onOpenWorkspace?: (tab: ProjectHomeWorkspaceSheetTab, repositoryId: string) => void;
  host?: ProjectsHost;
  /** The signing identity of the Projects host; management is owner-only. */
  identityPubkey?: string;
  projects?: Project[];
  /** Original: a workspace row without a repository opens Add repository. */
  onAddRepository?: () => void;
  onOpenRepository?: (repositoryId: string) => void;
  onOpenRepositoryTab?: (repositoryId: string, tab: string) => void;
  onRepositoryChange?: (repositoryId: string) => void;
}) {
  const t = useUiT();
  const firstRepository = project.repositories[0] ?? null;
  const openWorkspace = (tab: ProjectHomeWorkspaceSheetTab) => {
    if (firstRepository) onOpenWorkspace?.(tab, firstRepository.id);
    else onAddRepository?.();
  };
  const channelsById = new Map(channels.map(channel => [channel.id, channel]));
  const listedChannels = listProjectBoundChannels(project).flatMap(binding => {
    const channel = channelsById.get(binding.channelId);
    return channel ? [{ ...binding, channel }] : [];
  });
  return <div className="space-y-4 px-2 pb-8 pt-3" data-testid="project-home-context-panel">
      {onOpenWorkspace ? <ContextSection testId="project-home-context-workspace">
        <ContextNavButton disabled={!firstRepository && !onAddRepository} icon={<CircleDot/>}
          onClick={() => openWorkspace("issues")} title={firstRepository ? undefined : t("projects.home.addRepositoryHint")}
          pressed={activeWorkspaceTab === "issues"} testId="project-home-context-tasks">
          {t("projects.list.tasks")}
        </ContextNavButton>
        <ContextNavButton disabled={!firstRepository && !onAddRepository} icon={<GitPullRequest/>}
          onClick={() => openWorkspace("prs")} title={firstRepository ? undefined : t("projects.home.addRepositoryHint")}
          pressed={activeWorkspaceTab === "prs"} testId="project-home-context-reviews">
          {t("projects.list.reviews")}
        </ContextNavButton>
        {host?.git ? <ProjectHomeGitNav host={host} project={project} activeWorkspaceTab={activeWorkspaceTab} onAddRepository={onAddRepository}
          onOpenWorkspace={onOpenWorkspace} onOpenRepositoryTab={onOpenRepositoryTab}/> : null}
      </ContextSection> : null}
      <ContextSection
        collapsible
        headerAction={host ? <ProjectChannelManagement host={host} identityPubkey={identityPubkey} onOpenChannel={onOpenChannel} project={project}/> : undefined}
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
      <ContextSection
        collapsible
        headerAction={host && onRepositoryChange ? <ProjectRepositoryManagement compact host={host} identityPubkey={identityPubkey}
          onChange={onRepositoryChange} project={project} projects={projects ?? [project]}/> : undefined}
        testId="project-home-context-codebase"
        title={t("projects.home.codebase")}
      >
        {project.repositories.length > 0 ? (
          project.repositories.map((repository) => (
            <ContextNavButton
              disabled={!onOpenRepository}
              icon={<FolderGit2 />}
              key={repository.id}
              onClick={() => onOpenRepository?.(repository.id)}
              testId={`project-home-context-repo-${repository.dtag}`}
            >
              {repository.name}
            </ContextNavButton>
          ))
        ) : (
          <p className="px-2 py-1 text-sm text-sidebar-foreground/60">
            {t("projects.home.noRepositories")}
          </p>
        )}
      </ContextSection>
  </div>;
}
