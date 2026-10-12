// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectsPullRequestsList.tsx.
// Atomic governed loading replaces upstream partial-section fallback; selection/share-link consumers remain missing.
import { useUiT } from "../context";
import { translateCurrent } from "../../i18n";
import { FolderKanban, GitPullRequest } from "lucide-react";
import * as React from "react";

import type { Project, Repository } from "./projectModels";
import type { ProjectPullRequest } from "./projectPullRequests.mjs";
import {
  countGroupedRows,
  sliceGroupedRows,
  useIncrementalMount,
} from "./useIncrementalMount";
import { cn } from "../profile/buzz/shared/lib/cn";
import {
  resolveUserLabel,
  type UserProfileLookup,
} from "../messages/system/identity";
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
  Open: "projects.status.open",
  Draft: "projects.status.draft",
  Merged: "projects.status.merged",
  Closed: "projects.status.closed",
} as const;

type ProjectPullRequestListItem = {
  project: Project;
  repository: Repository;
  pullRequest: ProjectPullRequest;
};

type ProjectsPullRequestsListProps = {
  /** Render without container chrome — a parent table container provides border and rounding. */
  embedded?: boolean;
  emptyMessage?: string;
  onOpen: (
    project: Project,
    repository: Repository,
    pullRequest: ProjectPullRequest,
  ) => void;
  profiles?: UserProfileLookup;
  pullRequests: ProjectPullRequestListItem[];
  viewMode: "grid" | "list";
};

function nextStepLabel(status: ProjectPullRequest["status"]) {
  const t = translateCurrent;
  if (status === "Draft") return t("projects.list.viewDraft");
  if (status === "Merged") return t("projects.list.viewMerge");
  if (status === "Closed") return t("projects.list.viewClosed");
  return t("projects.inbox.openReview");
}

const PullRequestGridCard = React.memo(function PullRequestGridCard({
  project,
  pullRequest,
  onOpen,
  repository,
}: {
  project: Project;
  pullRequest: ProjectPullRequest;
  onOpen: (
    project: Project,
    repository: Repository,
    pullRequest: ProjectPullRequest,
  ) => void;
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
        onClick={() => onOpen(project, repository, pullRequest)}
        type="button"
      >
        <span className="sr-only">{t("projects.list.viewReviewNamed", { name: pullRequest.title })}</span>
      </button>
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <h3
          className="truncate text-sm font-semibold leading-5 text-foreground"
          data-testid="projects-grid-card-title"
        >
          {pullRequest.title}
        </h3>
        <p
          className={cn(PROJECT_GRID_CARD_BODY_CLASS, "text-muted-foreground")}
          data-testid="projects-grid-card-body"
        >
          {pullRequest.content || t("projects.list.noDescription")}
        </p>
        <div
          className="mt-auto flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
          data-testid="projects-grid-card-indicator"
        >
          <ProjectEventTypeIcon className="h-3.5 w-3.5" kind="pull-request" />
          <span>{t(statusKey[pullRequest.status])}</span>
        </div>
      </div>
    </div>
  );
});

// Memoized: these rows render in unbounded lists, and any Projects-view
// state change used to re-render every row. Props are kept identity-stable
// by the list (memoized groups/selection arrays, stable onOpen).
const PullRequestListRow = React.memo(function PullRequestListRow({
  project,
  profiles,
  pullRequest,
  repository,
  onOpen,
}: {
  project: Project;
  profiles?: UserProfileLookup;
  pullRequest: ProjectPullRequest;
  repository: Repository;
  onOpen: (
    project: Project,
    repository: Repository,
    pullRequest: ProjectPullRequest,
  ) => void;
}) {
  const t = useUiT();
  const authorLabel = resolveUserLabel({
    profiles,
    pubkey: pullRequest.author,
  });

  return (
    <ProjectEntityListRow
      affiliation={repository.name}
      count={pullRequest.comments.length}
      dateSeconds={pullRequest.updatedAt}
      dateTestId="projects-row-date"
      icon={null}
      onClick={() => onOpen(project, repository, pullRequest)}
      peopleSlot={
        <ProjectAuthorIdentity
          label={authorLabel}
          labelClassName="sr-only"
          profiles={profiles}
          pubkey={pullRequest.author}
          testId="projects-pr-author"
        />
      }
      testId={`projects-pr-row-${pullRequest.id}`}
      title={pullRequest.title}
      titleAttr={t("projects.list.openReviewNamed", { name: pullRequest.title })}
      titleIcon={
        <ProjectEventTypeIcon className="h-3.5 w-3.5" kind="pull-request" />
      }
      trailing={
        <ProjectListRowMenu label={t("projects.moreOptions", { name: pullRequest.title })}>
          <DropdownMenuItem
            onSelect={() => onOpen(project, repository, pullRequest)}
          >
            <GitPullRequest className="h-4 w-4" />
            {nextStepLabel(pullRequest.status)}
          </DropdownMenuItem>
        </ProjectListRowMenu>
      }
    />
  );
});

export function ProjectsPullRequestsList({
  embedded,
  emptyMessage,
  onOpen,
  profiles,
  pullRequests,
  viewMode,
}: ProjectsPullRequestsListProps) {
  const t = useUiT();
  // Grouping and per-group selection arrays are identity-stable across
  // re-renders so the memoized rows only re-render when their data changes.
  const allGroups = React.useMemo(
    () => groupProjectWorkItemsByProject(pullRequests),
    [pullRequests],
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
    pullRequests.length,
    30,
    60,
    viewMode === "grid",
  );
  const groups = React.useMemo(
    () => sliceGroupedRows(allGroups, mountedRowCount),
    [allGroups, mountedRowCount],
  );

  if (pullRequests.length === 0) {
    return (
      <div className="space-y-3">
        <ProjectPanelState
          className={cn(!embedded && "border border-dashed border-border/60")}
          panel={false}
          title={emptyMessage ?? t("projects.list.reviewsEmpty")}
        />
      </div>
    );
  }

  if (viewMode === "grid") {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {pullRequests
            .slice(0, mountedGridCount)
            .map(({ project, pullRequest, repository }) => (
              <PullRequestGridCard
                key={`${repository.id}:${pullRequest.id}`}
                onOpen={onOpen}
                project={project}
                pullRequest={pullRequest}
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
              headerTestId="projects-review-project-group-header"
              icon={<FolderKanban className="h-4 w-4" />}
              key={group.project.id}
              label={group.project.name}
              labelTestId="project-review-project"
              testId="projects-review-project-group"
            >
              <ul>
                {group.rows.map(({ project, pullRequest, repository }) => (
                  <li
                    className="[contain-intrinsic-size:auto_3.5rem] [content-visibility:auto]"
                    key={`${repository.id}:${pullRequest.id}`}
                  >
                    <PullRequestListRow
                      onOpen={onOpen}
                      profiles={profiles}
                      project={project}
                      pullRequest={pullRequest}
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
