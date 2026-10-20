// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/projectsOverviewContext.ts. Same title,
// people and stat derivation per section; labels are catalog keys. The panel
// hides an action whose handler the caller does not pass (Create review needs
// DD-118 Git; Add channel / Add repository need the Projects publication host).
import type { PlatformMessageKey } from "../../i18n";
import { projectContributorActivityCounts } from "./lib/projectContributorMatching";
import type { ProjectActivitySummary } from "./lib/projectActivitySummaries";
import { uniqueProjectRelatedChannelCount } from "./lib/projectRelatedChannels";
import { normalizePubkey } from "../conversations/pubkey";
import type { ProjectIssue } from "./projectIssues.mjs";
import type { Project } from "./projectModels";
import type { ProjectPullRequest } from "./projectPullRequests.mjs";
import {
  projectReviewActivity,
  projectTaskActivity,
} from "./projectRightPanelContext";
import { projectsSectionTitleKey } from "./projectsSectionMeta";
import type { ProjectsFilter } from "./ProjectsToolbar";

export type ProjectsOverviewSection = Exclude<ProjectsFilter, "all">;

export type OverviewContextStatIcon =
  | "projects"
  | "repositories"
  | "channels"
  | "tasks"
  | "reviews"
  | "completed"
  | "merged";

export type OverviewContextAction = {
  kind: "channel" | "issue" | "project" | "pullRequest" | "repository";
  label: PlatformMessageKey;
  testId: string;
} | null;

export type OverviewContextStat = {
  count: number;
  icon: OverviewContextStatIcon;
  label: PlatformMessageKey;
  section: ProjectsOverviewSection;
};

export type OverviewContextPresentation = {
  action: OverviewContextAction;
  people: string[];
  stats: OverviewContextStat[];
  title: PlatformMessageKey;
};

type OverviewContextInput = {
  filter: ProjectsFilter;
  issues: ProjectIssue[];
  projectReadModels?: Project[];
  projects: Project[];
  pullRequests: ProjectPullRequest[];
  repositorySummaries?: Record<string, ProjectActivitySummary>;
  summaries?: Record<string, ProjectActivitySummary>;
};

function repositoryCount(projects: Project[]) {
  return projects.reduce(
    (count, project) => count + project.repositories.length,
    0,
  );
}

function summaryWorkItemCounts(
  projects: Project[],
  summaries: Record<string, ProjectActivitySummary> | undefined,
) {
  return projects.reduce(
    (stats, project) => {
      const summary = summaries?.[project.id];
      return {
        issues: stats.issues + (summary?.issueCount ?? 0),
        prs: stats.prs + (summary?.prCount ?? 0),
      };
    },
    { issues: 0, prs: 0 },
  );
}

function resolvedTaskActivity(
  issues: ProjectIssue[],
  summaryIssueCount: number,
) {
  if (issues.length > 0) return projectTaskActivity(issues);
  return {
    active: summaryIssueCount,
    completed: 0,
    total: summaryIssueCount,
  };
}

function resolvedReviewActivity(
  pullRequests: ProjectPullRequest[],
  summaryPrCount: number,
) {
  if (pullRequests.length > 0) return projectReviewActivity(pullRequests);
  return {
    merged: 0,
    open: summaryPrCount,
    total: summaryPrCount,
  };
}

function uniquePubkeys(pubkeys: Array<string | null | undefined>) {
  return [
    ...new Set(
      pubkeys
        .filter(
          (pubkey): pubkey is string =>
            typeof pubkey === "string" && pubkey.trim().length > 0,
        )
        .map((pubkey) => normalizePubkey(pubkey)),
    ),
  ];
}

function latestCommitAuthors(
  summaries: Record<string, ProjectActivitySummary> | undefined,
) {
  if (!summaries) return [];
  return uniquePubkeys(
    Object.values(summaries)
      .map((summary) => summary.latestCommit?.author)
      .filter((author): author is string => Boolean(author)),
  );
}

function workspaceActorCounts(
  issues: ProjectIssue[],
  pullRequests: ProjectPullRequest[],
) {
  return projectContributorActivityCounts({
    owner: "",
    contributors: [],
    issues: issues
      .filter((issue) => issue.author)
      .map((issue) => ({
        author: issue.author,
        comments: issue.comments ?? [],
      })),
    pullRequests: pullRequests
      .filter((pullRequest) => pullRequest.author)
      .map((pullRequest) => ({
        author: pullRequest.author,
        approvals: pullRequest.approvals ?? [],
        comments: pullRequest.comments ?? [],
        commit: pullRequest.commit,
        initialCommit: pullRequest.initialCommit,
        updates: pullRequest.updates ?? [],
      })),
  });
}

function peopleWithKind(
  counts: ReturnType<typeof workspaceActorCounts>,
  kind: "any" | "commits" | "reviews" | "tasks",
) {
  return Object.entries(counts)
    .filter(([, activity]) => {
      if (kind === "tasks") return activity.tasks > 0;
      if (kind === "reviews") return activity.reviews > 0;
      if (kind === "commits") return activity.commits > 0;
      return activity.tasks + activity.reviews + activity.commits > 0;
    })
    .map(([pubkey]) => pubkey);
}

function projectOwners(projects: Project[]) {
  return uniquePubkeys(
    projects.flatMap((project) => [
      project.owner,
      ...project.repositories.map((repository) => repository.owner),
    ]),
  );
}

function overviewContextPeople({
  filter,
  issues,
  projects,
  pullRequests,
  repositorySummaries,
  summaries,
}: OverviewContextInput) {
  const counts = workspaceActorCounts(issues, pullRequests);
  const commitAuthors = uniquePubkeys([
    ...peopleWithKind(counts, "commits"),
    ...latestCommitAuthors(
      filter === "repositories" ? repositorySummaries : summaries,
    ),
  ]);

  if (filter === "issues") return peopleWithKind(counts, "tasks");
  if (filter === "prs") return peopleWithKind(counts, "reviews");
  if (filter === "repositories") return commitAuthors;
  if (filter === "channels") return [];
  if (filter === "all") {
    return uniquePubkeys([...peopleWithKind(counts, "any"), ...commitAuthors]);
  }
  return projectOwners(projects);
}

/** Title, people, and stats for the Projects overview context pod. */
export function projectsOverviewContext(
  input: OverviewContextInput,
): OverviewContextPresentation {
  const {
    filter,
    issues,
    projectReadModels,
    projects,
    pullRequests,
    summaries,
  } = input;
  const readModels = projectReadModels ?? projects;
  const summaryCounts = summaryWorkItemCounts(projects, summaries);
  const tasks = resolvedTaskActivity(issues, summaryCounts.issues);
  const reviews = resolvedReviewActivity(pullRequests, summaryCounts.prs);
  const channelCount = uniqueProjectRelatedChannelCount(readModels);
  const repositories = repositoryCount(readModels);
  const people = overviewContextPeople(input);

  if (filter === "repositories") {
    return {
      action: {
        kind: "repository",
        label: "projects.repository.add",
        testId: "projects-overview-add-repository",
      },
      people,
      stats: [
        {
          count: repositories,
          icon: "repositories",
          label: "projects.section.repositories",
          section: "repositories",
        },
        {
          count: tasks.active,
          icon: "tasks",
          label: "projects.overview.activeTasks",
          section: "issues",
        },
        {
          count: reviews.open,
          icon: "reviews",
          label: "projects.overview.openReviews",
          section: "prs",
        },
      ],
      title: "projects.section.repositories",
    };
  }

  if (filter === "channels") {
    return {
      action: {
        kind: "channel",
        label: "projects.channel.add",
        testId: "projects-overview-add-channel",
      },
      people,
      stats: [
        {
          count: channelCount,
          icon: "channels",
          label: "sidebar.channels",
          section: "channels",
        },
        {
          count: projects.length,
          icon: "projects",
          label: "platform.tab.projects",
          section: "projects",
        },
        {
          count: repositories,
          icon: "repositories",
          label: "projects.section.repositories",
          section: "repositories",
        },
      ],
      title: "sidebar.channels",
    };
  }

  if (filter === "issues") {
    return {
      action: {
        kind: "issue",
        label: "projects.issue.create",
        testId: "projects-overview-create-issue",
      },
      people,
      stats: [
        {
          count: tasks.total,
          icon: "tasks",
          label: "projects.list.tasks",
          section: "issues",
        },
        {
          count: tasks.active,
          icon: "tasks",
          label: "projects.overview.active",
          section: "issues",
        },
        {
          count: tasks.completed,
          icon: "completed",
          label: "projects.overview.completed",
          section: "issues",
        },
      ],
      title: "projects.list.tasks",
    };
  }

  if (filter === "prs") {
    return {
      action: {
        kind: "pullRequest",
        label: "projects.review.create",
        testId: "projects-overview-create-pull-request",
      },
      people,
      stats: [
        {
          count: reviews.total,
          icon: "reviews",
          label: "projects.list.reviews",
          section: "prs",
        },
        {
          count: reviews.open,
          icon: "reviews",
          label: "projects.status.open",
          section: "prs",
        },
        {
          count: reviews.merged,
          icon: "merged",
          label: "projects.status.merged",
          section: "prs",
        },
      ],
      title: "projects.list.reviews",
    };
  }

  if (filter === "all") {
    return {
      action: null,
      people,
      stats: [
        {
          count: projects.length,
          icon: "projects",
          label: "platform.tab.projects",
          section: "projects",
        },
        {
          count: repositories,
          icon: "repositories",
          label: "projects.section.repositories",
          section: "repositories",
        },
        {
          count: channelCount,
          icon: "channels",
          label: "sidebar.channels",
          section: "channels",
        },
        {
          count: tasks.total,
          icon: "tasks",
          label: "projects.list.tasks",
          section: "issues",
        },
        {
          count: reviews.total,
          icon: "reviews",
          label: "projects.list.reviews",
          section: "prs",
        },
      ],
      title: "projects.section.activity",
    };
  }

  return {
    action: {
      kind: "project",
      label: "projects.create.submit",
      testId: "projects-overview-create-project",
    },
    people,
    stats: [
      {
        count: projects.length,
        icon: "projects",
        label: "platform.tab.projects",
        section: "projects",
      },
      {
        count: repositories,
        icon: "repositories",
        label: "projects.section.repositories",
        section: "repositories",
      },
      {
        count: channelCount,
        icon: "channels",
        label: "sidebar.channels",
        section: "channels",
      },
    ],
    title: projectsSectionTitleKey(filter),
  };
}
