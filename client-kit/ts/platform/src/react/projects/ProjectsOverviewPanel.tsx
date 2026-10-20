// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectsOverviewPanel.tsx; wording comes from
// the shared catalog. The multi-item selection branch (ProjectsSelectionCountMenu
// with Agent chat / review creation) has no shared consumer, so only the
// original unselected context pod is rendered. Its Create review action (DD-118)
// exists only while the caller passes the review writer.
import {
  CheckCircle2,
  CircleDot,
  FolderGit2,
  Folders,
  GitMerge,
  GitPullRequest,
  Hash,
  Plus,
} from "lucide-react";
import * as React from "react";

import { useUiT } from "../context";
import type { UserProfileLookup } from "../messages/system/identity";
import { Button } from "../profile/buzz/shared/ui/button";
import type { ProjectActivitySummary } from "./lib/projectActivitySummaries";
import type { ProjectsActivityDigest } from "./lib/projectsActivityDigest";
import type { ProjectIssue } from "./projectIssues.mjs";
import type { Project } from "./projectModels";
import type { ProjectPullRequest } from "./projectPullRequests.mjs";
import { ProjectsOverviewPeople } from "./ProjectsOverviewRail";
import {
  type OverviewContextAction,
  type OverviewContextStatIcon,
  type ProjectsOverviewSection,
  projectsOverviewContext,
} from "./projectsOverviewContext";
import type { ProjectsFilter } from "./ProjectsToolbar";

export type { ProjectsOverviewSection };

const STAT_ICONS: Record<
  OverviewContextStatIcon,
  React.ComponentType<{ className?: string }>
> = {
  channels: Hash,
  completed: CheckCircle2,
  merged: GitMerge,
  projects: Folders,
  repositories: FolderGit2,
  reviews: GitPullRequest,
  tasks: CircleDot,
};

type ProjectsOverviewPanelProps = {
  children: React.ReactNode;
};

export function ProjectsOverviewPanel({
  children,
}: ProjectsOverviewPanelProps) {
  return (
    <section data-testid="projects-overview-panel">
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function ProjectsActivityIntro({
  digest,
}: {
  digest: ProjectsActivityDigest;
}) {
  const t = useUiT();
  return (
    <section
      className="pb-6 pt-8 text-left"
      data-testid="projects-activity-intro"
    >
      <h2
        className="text-xl font-semibold tracking-tight text-foreground"
        data-testid="projects-page-header"
      >
        {t("projects.activity.title")}
      </h2>
      <p
        className="mt-2 max-w-2xl text-sm text-muted-foreground"
        data-testid="projects-activity-summary"
      >
        {digest.prefix}{" "}
        {digest.highlights.map((highlight, index) => (
          <span key={highlight}>
            {index > 0
              ? index === digest.highlights.length - 1
                ? t("projects.activity.digest.and")
                : t("projects.discussion.separator")
              : null}
            <strong className="font-medium text-foreground/90">
              {highlight}
            </strong>
          </span>
        ))}
        {digest.suffix}
      </p>
    </section>
  );
}

type ProjectsOverviewContextPanelProps = {
  filter: ProjectsFilter;
  issues: ProjectIssue[];
  onCreateIssue?: () => void;
  onCreatePullRequest?: () => void;
  onCreateProject?: () => void;
  /** Original Add channel / Add repository of the Channels and Repositories sections. */
  onAddChannel?: () => void;
  onAddRepository?: () => void;
  /** The viewer owns at least one explicit project to add to. */
  canCreateTarget?: boolean;
  onSelectSection: (section: ProjectsOverviewSection) => void;
  profiles?: UserProfileLookup;
  projectReadModels: Project[];
  projects: Project[];
  pullRequests: ProjectPullRequest[];
  repositorySummaries?: Record<string, ProjectActivitySummary>;
  summaries?: Record<string, ProjectActivitySummary>;
};

function OverviewCreateButton({
  action,
  canCreateTarget = false,
  onAddChannel,
  onAddRepository,
  onCreateIssue,
  onCreatePullRequest,
  onCreateProject,
}: {
  action: Exclude<OverviewContextAction, null>;
  canCreateTarget?: boolean;
  onAddChannel?: () => void;
  onAddRepository?: () => void;
  onCreateIssue?: () => void;
  onCreatePullRequest?: () => void;
  onCreateProject?: () => void;
}) {
  const t = useUiT();
  const actionHandler = action.kind === "issue" ? onCreateIssue : action.kind === "pullRequest" ? onCreatePullRequest
    : action.kind === "project" ? onCreateProject : action.kind === "channel" ? onAddChannel : onAddRepository;
  const requiresProject = action.kind === "channel" || action.kind === "repository";
  // A section's create action exists only while its governed writer is available.
  if (!actionHandler) return null;
  return (
    <Button
      aria-label={t(action.label)}
      className="h-6 w-6 shrink-0 rounded-md text-muted-foreground hover:bg-muted/70 hover:text-foreground"
      data-testid={action.testId}
      disabled={requiresProject && !canCreateTarget}
      onClick={actionHandler}
      size="icon"
      title={t(action.label)}
      type="button"
      variant="ghost"
    >
      <Plus className="h-4 w-4" />
    </Button>
  );
}

function OverviewStatRow({
  count,
  icon: Icon,
  label,
  onClick,
}: {
  count: number;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="-mx-2 flex h-7 w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-md px-2 text-left text-sm hover:bg-muted/70 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
      data-testid="projects-overview-stat"
      onClick={onClick}
      type="button"
    >
      <span className="flex min-w-0 items-center gap-3 text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {label}
      </span>
      <span className="font-medium tabular-nums text-muted-foreground/65">
        {count}
      </span>
    </button>
  );
}

export function ProjectsOverviewContextPanel({
  filter,
  issues,
  onCreateIssue,
  onCreatePullRequest,
  onCreateProject,
  onAddChannel,
  onAddRepository,
  canCreateTarget,
  onSelectSection,
  profiles,
  projectReadModels,
  projects,
  pullRequests,
  repositorySummaries,
  summaries,
}: ProjectsOverviewContextPanelProps) {
  const t = useUiT();
  // Memoized: the rail re-renders with every Projects-view state change, and
  // the context stats walk every issue and pull request in the community.
  const context = React.useMemo(
    () =>
      projectsOverviewContext({
        filter,
        issues,
        projectReadModels,
        projects,
        pullRequests,
        repositorySummaries,
        summaries,
      }),
    [filter, issues, projectReadModels, projects, pullRequests, repositorySummaries, summaries],
  );
  return (
    <div
      className="min-w-0 overflow-hidden"
      data-testid="projects-overview-context-panel"
    >
      <div className="px-4 pb-3 pt-3">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <h2
            className="min-w-0 truncate text-sm font-normal text-muted-foreground/70"
            data-testid="projects-overview-context-title"
          >
            {t(context.title)}
          </h2>
          {context.action ? (
            <OverviewCreateButton
              action={context.action}
              onCreateIssue={onCreateIssue}
              onCreatePullRequest={onCreatePullRequest}
              onCreateProject={onCreateProject}
              onAddChannel={onAddChannel}
              onAddRepository={onAddRepository}
              canCreateTarget={canCreateTarget}
            />
          ) : null}
        </div>
        <div className="space-y-2.5 pt-2">
          <section
            className="space-y-2.5 text-sm"
            data-testid="projects-overview-stats-pod"
          >
            {context.stats.map((stat) => (
              <OverviewStatRow
                count={stat.count}
                icon={STAT_ICONS[stat.icon]}
                key={`${stat.section}:${stat.label}`}
                label={t(stat.label)}
                onClick={() => onSelectSection(stat.section)}
              />
            ))}
          </section>
          {context.people.length > 0 ? (
            <div className="mt-3 space-y-3 py-3">
              <ProjectsOverviewPeople
                people={context.people}
                profiles={profiles}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
