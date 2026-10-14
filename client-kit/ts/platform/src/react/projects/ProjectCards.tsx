// Original ProjectGridCard, Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectCards.tsx.
// Existing governed management actions occupy the original action slot. The
// people stack and activity bar read the shared summaries of the governed
// Projects work-item read; Git repository availability and terminal actions
// still require their actual production chains.
import * as React from "react";
import {CircleDot,FolderGit2,Folders,GitCommit,GitPullRequest,Plus} from "lucide-react";
import {twMerge as cn} from "tailwind-merge";
import {useUiT} from "../context";
import type {PlatformMessageKey} from "../../i18n";
import type {Project} from "./projectModels";
import {Button} from "../profile/buzz/shared/ui/button";
import {normalizePubkey} from "../conversations/pubkey";
import {resolveUserLabel,type UserProfileLookup} from "../messages/system/identity";
import {UserAvatar} from "../messages/UserAvatar";
import {UserProfilePopover} from "../pulse/UserProfilePopover";
import {Tooltip,TooltipContent,TooltipTrigger} from "../sidebar/tooltip";
import {getProjectUpdatedAt,listRowDescription} from "./lib/projectsViewHelpers";
import type {ProjectActivitySummary} from "./lib/projectActivitySummaries";
import {ProjectEntityFacepile} from "./ProjectEntityFacepile";
import {ProjectEntityListRow} from "./ProjectEntityListRow";
import {PROJECT_GRID_CARD_BODY_CLASS} from "./projectGridCardStyles";

export function ProjectPeopleStack({
  pubkeys,
  profiles,
  workOwnerPubkey,
}: {
  pubkeys: string[];
  profiles?: UserProfileLookup;
  workOwnerPubkey: string;
}) {
  const t = useUiT();
  const visible = pubkeys.slice(0, 5);
  const remaining = pubkeys.length - visible.length;

  if (visible.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-auto flex items-center justify-end -space-x-1.5">
      {visible.map((pubkey, index) => {
        const profile = profiles?.[normalizePubkey(pubkey)];
        const label = resolveUserLabel({ pubkey, profiles, t });
        return (
          // First avatar sits on the top layer, cascading down rightward.
          <span
            className="relative inline-flex"
            key={pubkey}
            style={{ zIndex: visible.length - index }}
          >
            <UserProfilePopover pubkey={pubkey} triggerElement="span">
              <button
                aria-label={t("projects.discussion.viewProfile", { name: label })}
                className={cn(
                  "inline-flex focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                  profile?.isAgent ? "rounded-[30%]" : "rounded-full",
                )}
                type="button"
              >
                <UserAvatar
                  accent={
                    normalizePubkey(pubkey) === normalizePubkey(workOwnerPubkey)
                  }
                  avatarUrl={profile?.avatarUrl ?? null}
                  className="ring-2 ring-card"
                  displayName={label}
                  shape={profile?.isAgent ? "squircle" : "circle"}
                  size="xs"
                />
              </button>
            </UserProfilePopover>
          </span>
        );
      })}
      {remaining > 0 ? (
        <span className="relative z-0 flex h-5 min-w-5 items-center justify-center rounded-sm bg-muted px-1 text-3xs font-semibold text-muted-foreground ring-2 ring-card">
          +{remaining}
        </span>
      ) : null}
    </div>
  );
}

const PROJECT_STAT_ITEMS = [
  {
    key: "commitCount",
    icon: GitCommit,
    iconClass: "text-primary/60",
    barClass: "bg-primary/60",
    columnClass: "w-24",
    label: "projects.stats.commits",
  },
  {
    key: "prCount",
    icon: GitPullRequest,
    iconClass: "text-primary",
    barClass: "bg-primary",
    columnClass: "w-16",
    label: "projects.stats.reviews",
  },
  {
    key: "issueCount",
    icon: CircleDot,
    iconClass: "text-orange-500",
    barClass: "bg-orange-500",
    columnClass: "w-20",
    label: "projects.stats.tasks",
  },
] as const;

function statLabel(t: ReturnType<typeof useUiT>, label: (typeof PROJECT_STAT_ITEMS)[number]["label"], count: number) {
  return t(`${label}.${count === 1 ? "one" : "other"}` as PlatformMessageKey);
}

// Segmented commits/PRs/issues distribution — the card's "progress bar".
// Hovering thickens the bar and reveals a tooltip with the exact breakdown.
export function ProjectActivityBar({
  summary,
}: {
  summary: ProjectActivitySummary | undefined;
}) {
  const t = useUiT();
  const items = PROJECT_STAT_ITEMS.map(({ key, barClass, label }) => {
    const count = summary?.[key] ?? 0;
    return { barClass, count, text: statLabel(t, label, count) };
  });
  const total = items.reduce((sum, item) => sum + item.count, 0);

  return (
    // z-10 lifts the bar above the card's full-surface open button so it
    // can receive hover events. Fixed h-2 wrapper keeps layout stable
    // while the inner bar grows on hover.
    <div
      className="group/activity-bar relative z-10 flex h-2 w-full items-center"
      data-testid="project-activity-bar"
    >
      <div className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-muted/60 transition-all duration-150 group-hover/activity-bar:h-2">
        {total > 0
          ? items
              .filter((item) => item.count > 0)
              .map((item) => (
                <Tooltip key={item.barClass}>
                  <TooltipTrigger asChild>
                    <div
                      aria-label={`${item.count} ${item.text}`}
                      className={cn("h-full", item.barClass)}
                      data-testid="project-activity-segment"
                      role="img"
                      style={{ width: `${(item.count / total) * 100}%` }}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn("h-2 w-2 rounded-full", item.barClass)}
                      />
                      {item.count} {item.text}
                    </span>
                  </TooltipContent>
                </Tooltip>
              ))
          : null}
      </div>
    </div>
  );
}

function StatusPill({status}:{status:string}) {
  const t=useUiT();
  if(status==="active")return null;
  return <span className="shrink-0 rounded-full border border-border/60 bg-muted/40 px-2 pb-[3px] pt-[5px] text-2xs font-semibold uppercase leading-none tracking-[0.18em] text-muted-foreground">
    {status==="unlisted"?t("projects.unlisted"):status}
  </span>;
}

export function EmptyState({onCreateProject}:{onCreateProject?:()=>void}) {
  const t=useUiT();
  return <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center">
    <Folders className="h-10 w-10 text-muted-foreground/40"/>
    <div className="space-y-1"><p className="text-sm font-medium text-foreground">{t("projects.empty")}</p>
      <p className="text-sm text-muted-foreground">{t("projects.emptyHint")}</p></div>
    {onCreateProject?<Button onClick={onCreateProject} size="sm" type="button"><Plus className="h-4 w-4"/>{t("projects.create.submit")}</Button>:null}
  </div>;
}

export function EmptyFilteredState() {
  const t=useUiT();
  return <div className="flex flex-1 flex-col items-center justify-center gap-3 border border-dashed border-border/60 px-4 py-12 text-center">
    <Folders className="h-9 w-9 text-muted-foreground/40"/>
    <div className="space-y-1"><p className="text-sm font-medium text-foreground">{t("projects.noMatch")}</p>
      <p className="text-sm text-muted-foreground">{t("projects.filteredHint")}</p></div>
  </div>;
}

type ProjectItemProps={project:Project;onOpen:(project:Project)=>void;actions?:React.ReactNode;
  /** Present only after the governed work-item read; absent while loading or failed. */
  activity?:{people:string[];profiles?:UserProfileLookup;summary:ProjectActivitySummary|undefined}};

export const ProjectGridCard = React.memo(function ProjectGridCard({
  project,
  onOpen,
  actions,
  activity,
}: ProjectItemProps) {
  const t=useUiT();
  return (
    <div
      className="group relative flex h-full min-h-40 flex-col overflow-hidden rounded-xl border border-border/60 bg-transparent text-card-foreground shadow-none transition-colors duration-150 hover:bg-muted/20"
      data-projects-grid-card
      data-testid={`project-card-${project.dtag}`}
    >
      <button className="absolute inset-0 z-0 cursor-pointer" onClick={()=>onOpen(project)} type="button"><span className="sr-only">{t("projects.view",{name:project.name})}</span></button>
      <div className="pointer-events-none relative z-10 flex min-h-0 flex-1 flex-col">
        <div className="flex min-w-0 items-start justify-between gap-3 px-4 pt-3">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40">
              <Folders className="h-4.5 w-4.5 text-muted-foreground" />
            </span>
            <div className="min-w-0 flex-1">
              <span
                className="block break-words text-sm font-semibold leading-5 text-foreground"
                data-projects-text-priority="primary"
                data-testid="project-grid-card-name"
              >
                {project.name}
              </span>
              <div
                className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
                data-projects-text-priority="secondary"
              >
                <span>
                  {t(project.repositoryAddresses.length===1?"projects.oneRepository":"projects.repositoryCount",{count:project.repositoryAddresses.length})}
                </span>
                <StatusPill status={project.status}/>
              </div>
            </div>
          </div>
          {actions?<div className="pointer-events-auto relative z-10 shrink-0">{actions}</div>:null}
        </div>

        <p
          className={cn(
            PROJECT_GRID_CARD_BODY_CLASS,
            "mx-4 my-2 text-muted-foreground",
          )}
          data-testid="projects-grid-card-body"
        >
          {project.description || t("projects.defaultDescription")}
        </p>

        {activity?<>
          <div className="relative z-10 flex items-center px-4 pb-1">
            <ProjectPeopleStack
              profiles={activity.profiles}
              pubkeys={activity.people}
              workOwnerPubkey={project.owner}
            />
          </div>

          <div className="mt-auto px-4 pb-3 pt-2">
            <ProjectActivityBar summary={activity.summary} />
          </div>
        </>:null}
      </div>
    </div>
  );
});

// Original ProjectListRow consumes the same shared row as project channels.
// Without a completed work-item read the original getProjectUpdatedAt fallback
// (project.createdAt) is used, not fabricated activity.
export const ProjectListRow = React.memo(function ProjectListRow({project,onOpen,actions,activity}:ProjectItemProps) {
  const t=useUiT();
  return <ProjectEntityListRow
    affiliation={
      <span className="flex items-center justify-end gap-1"><FolderGit2 className="h-3.5 w-3.5"/><span>{project.repositoryAddresses.length}</span></span>
    }
    affiliationClassName="w-auto"
    affiliationTestId="projects-row-context"
    affiliationTitle={t(project.repositoryAddresses.length===1?"projects.oneRepository":"projects.repositoryCount",{count:project.repositoryAddresses.length})}
    dateSeconds={getProjectUpdatedAt(project,activity?.summary)}
    dateTestId="projects-row-date"
    icon={<Folders className="h-3.5 w-3.5 text-muted-foreground/70"/>}
    onClick={()=>onOpen(project)}
    peopleSlot={activity&&activity.people.length>0?<ProjectEntityFacepile interactive participants={activity.people} profiles={activity.profiles}/>:undefined}
    peopleTestId="projects-row-people"
    testId={`project-row-${project.dtag}`}
    title={<span className="flex min-w-0 items-center gap-2">
      <span className="truncate">{project.name}</span>
      <StatusPill status={project.status}/>
    </span>}
    titleAttr={project.name}
    titleSecondary={listRowDescription(project.description,project.name)}
    titleSecondaryTestId="projects-row-description"
    trailing={actions}
  />;
});
