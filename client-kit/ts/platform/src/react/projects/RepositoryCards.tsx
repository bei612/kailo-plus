// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/RepositoryCards.tsx. Same card/row layout,
// people stack, stats and activity bar from the governed Projects read. Git
// host classification needs the Relay origin and terminal checkout needs the
// native Git chain; neither is available to this shared read, so the icon is
// the original unresolved-host mark and no terminal action is rendered.
import * as React from "react";
import { FolderGit2 } from "lucide-react";

import { useUiT } from "../context";
import { normalizePubkey } from "../conversations/pubkey";
import type { UserProfileLookup } from "../messages/system/identity";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "../sidebar/tooltip";
import { CopyShareLinkMenuItem } from "./CopyShareLinkMenuItem";
import type { ProjectActivitySummary } from "./lib/projectActivitySummaries";
import { ProjectActivityBar, ProjectPeopleStack, ProjectStatsRow } from "./ProjectCards";
import { ProjectEntityFacepile } from "./ProjectEntityFacepile";
import { ProjectEntityListRow } from "./ProjectEntityListRow";
import { PROJECT_GRID_CARD_BODY_CLASS } from "./projectGridCardStyles";
import { PROJECT_LIST_ROW_PREVIEW_CLASS, PROJECT_LIST_ROW_TITLE_CLASS } from "./projectListRowStyles";
import { ProjectListRowMenu } from "./ProjectListRowMenu";
import type { Project, Repository } from "./projectModels";
import { repositoryShareLink } from "./projectShareLinks";
import { selectionItemFromRepository, type ProjectSelectionItem } from "./lib/projectSelection";

export type RepositoryListItem = {
  project: Project;
  repository: Repository;
};

type RepositoryItemProps = RepositoryListItem & {
  onOpen: (project: Project, repository: Repository) => void;
  profiles?: UserProfileLookup;
  summary?: ProjectActivitySummary;
  /** The share action copies through the work-item host. */
  canCopyLink: boolean;
  /** Original selectionRangeItems: the visible repositories in order (list rows only). */
  selectionRangeItems?: ProjectSelectionItem[];
};

/** Original ProjectsOverviewItems repository selection item. */
export function repositorySelectionItem(project: Project, repository: Repository): ProjectSelectionItem {
  return selectionItemFromRepository({
    channelId: repository.channelId ?? project.projectChannelId,
    id: repository.id,
    owner: repository.owner,
    shareLink: repositoryShareLink(repository),
    title: repository.name,
  });
}

function RepositoryHostIcon({ compact = false }: { compact?: boolean }) {
  const t = useUiT();
  const label = t("projects.repository.host");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={label}
          className={
            compact
              ? "pointer-events-auto flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground/70"
              : "pointer-events-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40 text-muted-foreground"
          }
          data-testid="repository-host-icon"
          role="img"
        >
          <FolderGit2 className={compact ? "h-3.5 w-3.5" : "h-4.5 w-4.5"} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function RepositoryOpenButton({
  onOpen,
  project,
  repository,
}: Pick<RepositoryItemProps, "onOpen" | "project" | "repository">) {
  const t = useUiT();
  return (
    <button
      className="absolute inset-0 z-0 cursor-pointer"
      onClick={() => onOpen(project, repository)}
      type="button"
    >
      <span className="sr-only">{t("projects.view", { name: repository.name })}</span>
    </button>
  );
}

function RepositoryIdentity({
  project,
  repository,
}: Pick<RepositoryItemProps, "project" | "repository">) {
  return (
    <>
      <RepositoryHostIcon />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className={PROJECT_LIST_ROW_TITLE_CLASS}>
            {repository.name}
          </span>
        </div>
        <p className={PROJECT_LIST_ROW_PREVIEW_CLASS}>
          {project.name}
          {` · ${repository.defaultBranch}`}
        </p>
      </div>
    </>
  );
}

export function repositoryPeople(
  repository: Repository,
  summary: ProjectActivitySummary | undefined,
) {
  return [
    ...new Set(
      [
        repository.owner,
        ...repository.contributors,
        ...(summary?.participantPubkeys ?? []),
      ].map(normalizePubkey),
    ),
  ];
}

function RepositoryActionsMenu({ repository, canCopyLink }: Pick<RepositoryItemProps, "repository" | "canCopyLink">) {
  const t = useUiT();
  const link = canCopyLink ? repositoryShareLink(repository) : null;
  if (!link) return null;
  return (
    <ProjectListRowMenu label={t("projects.moreOptions", { name: repository.name })}>
      <CopyShareLinkMenuItem
        label={t("buzz.copyLink")}
        link={link}
        testId={`repository-copy-link-${repository.dtag}`}
      />
    </ProjectListRowMenu>
  );
}

// Memoized: unbounded grids/lists; identity-stable caller props keep
// re-renders scoped to changed cards.
export const RepositoryGridCard = React.memo(function RepositoryGridCard(
  props: RepositoryItemProps,
) {
  const t = useUiT();
  const { canCopyLink, onOpen, profiles, project, repository, summary } = props;
  return (
    <div
      className="group relative flex h-full min-h-40 flex-col overflow-hidden rounded-xl border border-border/60 bg-transparent text-card-foreground shadow-none transition-colors duration-150 hover:bg-muted/20"
      data-testid={`repository-card-${repository.dtag}`}
    >
      <RepositoryOpenButton
        onOpen={onOpen}
        project={project}
        repository={repository}
      />
      <div className="pointer-events-none relative z-10 flex min-h-0 flex-1 flex-col p-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <RepositoryIdentity project={project} repository={repository} />
          <div className="pointer-events-auto ml-auto">
            <RepositoryActionsMenu canCopyLink={canCopyLink} repository={repository} />
          </div>
        </div>
        <p
          className={cn(
            PROJECT_GRID_CARD_BODY_CLASS,
            "my-2 text-muted-foreground",
          )}
          data-testid="projects-grid-card-body"
        >
          {repository.description || t("projects.repository.defaultDescription")}
        </p>
        <div className="pointer-events-auto mt-auto">
          <ProjectPeopleStack
            profiles={profiles}
            pubkeys={repositoryPeople(repository, summary)}
            workOwnerPubkey={repository.owner}
          />
        </div>
        <div className="mt-2">
          <ProjectStatsRow summary={summary} />
          <div className="mt-2">
            <ProjectActivityBar summary={summary} />
          </div>
        </div>
      </div>
    </div>
  );
});

export const RepositoryListRow = React.memo(function RepositoryListRow(
  props: RepositoryItemProps,
) {
  const { canCopyLink, onOpen, profiles, project, repository, selectionRangeItems, summary } = props;
  const updatedAt = summary?.updatedAt || repository.createdAt;
  const people = repositoryPeople(repository, summary);
  const selectionItem = repositorySelectionItem(project, repository);
  return (
    <ProjectEntityListRow
      beforeDate={
        <div className="w-44" data-testid="repositories-row-activity-bar">
          <ProjectActivityBar summary={summary} />
        </div>
      }
      dateSeconds={updatedAt}
      dateTestId="repositories-row-date"
      icon={<RepositoryHostIcon compact />}
      onClick={() => onOpen(project, repository)}
      peopleSlot={people.length > 0 ? <ProjectEntityFacepile interactive participants={people} profiles={profiles} /> : undefined}
      selection={selectionRangeItems ? { item: selectionItem, rangeItems: selectionRangeItems } : undefined}
      peopleTestId="repositories-row-people"
      testId={`repository-row-${repository.dtag}`}
      title={repository.name}
      titleAttr={repository.name}
      titleSecondary={repository.description || undefined}
      titleSecondaryTestId="repositories-row-description"
      trailing={<RepositoryActionsMenu canCopyLink={canCopyLink} repository={repository} />}
    />
  );
});
