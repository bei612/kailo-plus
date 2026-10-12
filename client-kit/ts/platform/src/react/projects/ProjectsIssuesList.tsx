// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectsIssuesList.tsx.
// Atomic governed loading replaces upstream partial-section fallback; selection/share-link consumers remain missing.
import { useUiT } from "../context";
import { translateCurrent } from "../../i18n";
import { Eye, FolderKanban } from "lucide-react";
import * as React from "react";

import type { Project, Repository } from "./projectModels";
import type { ProjectIssue } from "./projectIssues.mjs";
import {
  resolveUserLabel,
  type UserProfileLookup,
} from "../messages/system/identity";
import {
  countGroupedRows,
  sliceGroupedRows,
  useIncrementalMount,
} from "./useIncrementalMount";
import { cn } from "../profile/buzz/shared/lib/cn";
import { DropdownMenuItem } from "../sidebar/dropdown-menu";
import { ProjectAuthorIdentity } from "./ProjectAuthorIdentity";
import { ProjectEntityListRow } from "./ProjectEntityListRow";
import { ProjectEventTypeIcon } from "./ProjectEventTypeIcon";
import { PROJECT_GRID_CARD_BODY_CLASS } from "./projectGridCardStyles";
import { ProjectListRowMenu } from "./ProjectListRowMenu";
import { ProjectSelectableGroup } from "./ProjectSelectableGroup";
import { ProjectPanelState } from "./ProjectPanelState";
import { groupProjectWorkItemsByProject } from "./projectWorkItemGroups";

const statusKey = {
  Triage: "projects.status.triage",
  Backlog: "projects.status.backlog",
  "In Progress": "projects.status.inProgress",
  "In Review": "projects.status.inReview",
  Done: "projects.status.done",
  Closed: "projects.status.closed",
} as const;

type ProjectIssueListItem = {
  project: Project;
  repository: Repository;
  issue: ProjectIssue;
};

type ProjectsIssuesListProps = {
  /** Render without container chrome — a parent table container provides border and rounding. */
  embedded?: boolean;
  emptyMessage?: string;
  onOpen: (
    project: Project,
    repository: Repository,
    issue: ProjectIssue,
  ) => void;
  profiles?: UserProfileLookup;
  issues: ProjectIssueListItem[];
  viewMode: "grid" | "list";
};

function nextStepLabel(status: ProjectIssue["status"]) {
  const t = translateCurrent;
  if (status === "Done" || status === "Closed") return t("projects.list.viewTask");
  if (status === "In Review") return t("projects.list.reviewTask");
  if (status === "Triage") return t("projects.list.triageTask");
  return t("projects.inbox.openTask");
}

const IssueGridCard = React.memo(function IssueGridCard({
  issue,
  onOpen,
  project,
  repository,
}: {
  issue: ProjectIssue;
  onOpen: (
    project: Project,
    repository: Repository,
    issue: ProjectIssue,
  ) => void;
  project: Project;
  repository: Repository;
}) {
  const t = useUiT();
  return (
    <div
      className="rounded-xl border text-card-foreground group relative flex min-h-32 flex-col overflow-hidden border-border/60 bg-transparent p-4 shadow-none transition-colors duration-150 hover:bg-muted/20"
      data-projects-grid-card
    >
      <button
        className="absolute inset-0"
        onClick={() => onOpen(project, repository, issue)}
        type="button"
      >
        <span className="sr-only">{t("projects.list.viewTaskNamed", { name: issue.title })}</span>
      </button>
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <h3
          className="truncate text-sm font-semibold leading-5 text-foreground"
          data-testid="projects-grid-card-title"
        >
          {issue.title}
        </h3>
        <p
          className={cn(PROJECT_GRID_CARD_BODY_CLASS, "text-muted-foreground")}
          data-testid="projects-grid-card-body"
        >
          {issue.content || t("projects.list.noDescription")}
        </p>
        <div
          className="mt-auto flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
          data-testid="projects-grid-card-indicator"
        >
          <ProjectEventTypeIcon className="h-3.5 w-3.5" kind="issue" />
          <span>{t(statusKey[issue.status])}</span>
        </div>
      </div>
    </div>
  );
});

// Memoized: these rows render in unbounded lists, and any Projects-view
// state change used to re-render every row. Props are kept identity-stable
// by the list (memoized groups/selection arrays, stable onOpen).
const IssueListRow = React.memo(function IssueListRow({
  issue,
  onOpen,
  profiles,
  project,
  repository,
}: {
  issue: ProjectIssue;
  onOpen: (
    project: Project,
    repository: Repository,
    issue: ProjectIssue,
  ) => void;
  profiles?: UserProfileLookup;
  project: Project;
  repository: Repository;
}) {
  const t = useUiT();
  const authorLabel = resolveUserLabel({ profiles, pubkey: issue.author });

  return (
    <ProjectEntityListRow
      affiliation={repository.name}
      count={issue.comments.length}
      dateSeconds={issue.updatedAt}
      dateTestId="projects-row-date"
      icon={null}
      onClick={() => onOpen(project, repository, issue)}
      peopleSlot={
        <ProjectAuthorIdentity
          label={authorLabel}
          labelClassName="sr-only"
          profiles={profiles}
          pubkey={issue.author}
          testId="projects-issue-author"
        />
      }
      testId={`projects-issue-row-${issue.id}`}
      title={issue.title}
      titleAttr={t("projects.list.openTaskNamed", { name: issue.title })}
      titleIcon={<ProjectEventTypeIcon className="h-3.5 w-3.5" kind="issue" />}
      trailing={
        <ProjectListRowMenu label={t("projects.moreOptions", { name: issue.title })}>
          <DropdownMenuItem onSelect={() => onOpen(project, repository, issue)}>
            <Eye className="h-4 w-4" />
            {nextStepLabel(issue.status)}
          </DropdownMenuItem>
        </ProjectListRowMenu>
      }
    />
  );
});

export function ProjectsIssuesList({
  embedded,
  emptyMessage,
  issues,
  onOpen,
  profiles,
  viewMode,
}: ProjectsIssuesListProps) {
  const t = useUiT();
  // Grouping and per-group selection arrays are identity-stable across
  // re-renders so the memoized rows only re-render when their data changes.
  const allGroups = React.useMemo(
    () => groupProjectWorkItemsByProject(issues),
    [issues],
  );
  // Mount rows progressively: a one-shot mount of hundreds of rows blocked
  // the main thread for over a second on tab entry.
  // Each layout's counter grows only while that layout is active: otherwise
  // a layout switch would find the other counter already grown and mount the
  // whole collection in one commit.
  const mountedRowCount = useIncrementalMount(
    countGroupedRows(allGroups),
    30,
    60,
    viewMode !== "grid",
  );
  const mountedGridCount = useIncrementalMount(
    issues.length,
    30,
    60,
    viewMode === "grid",
  );
  const groups = React.useMemo(
    () => sliceGroupedRows(allGroups, mountedRowCount),
    [allGroups, mountedRowCount],
  );

  if (issues.length === 0) {
    return (
      <div className="space-y-3">
        <ProjectPanelState
          className={cn(!embedded && "border border-dashed border-border/60")}
          panel={false}
          title={emptyMessage ?? t("projects.list.tasksEmpty")}
        />
      </div>
    );
  }

  if (viewMode === "grid") {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {issues
            .slice(0, mountedGridCount)
            .map(({ project, issue, repository }) => (
              <IssueGridCard
                issue={issue}
                key={`${repository.id}:${issue.id}`}
                onOpen={onOpen}
                project={project}
                repository={repository}
              />
            ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div data-testid="projects-list-container">
        {groups.map((group) => {
          return (
            <ProjectSelectableGroup
              count={group.rows.length}
              groupKey={group.project.id}
              headerClassName="mx-0 gap-3 px-4"
              headerTestId="projects-issue-project-group-header"
              icon={<FolderKanban className="h-4 w-4" />}
              key={group.project.id}
              label={group.project.name}
              labelTestId="project-issue-project"
              testId="projects-issue-project-group"
            >
              <ul>
                {group.rows.map(({ project, issue, repository }) => (
                  <li
                    className="[contain-intrinsic-size:auto_3.5rem] [content-visibility:auto]"
                    key={`${repository.id}:${issue.id}`}
                  >
                    <IssueListRow
                      issue={issue}
                      onOpen={onOpen}
                      profiles={profiles}
                      project={project}
                      repository={repository}
                    />
                  </li>
                ))}
              </ul>
            </ProjectSelectableGroup>
          );
        })}
      </div>
    </div>
  );
}
