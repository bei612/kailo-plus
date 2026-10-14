// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/lib/projectsActivityDigest.ts. Same weekly
// highlight and fallback totals; wording comes from the shared catalog. The
// original local Git snapshot commit count has no Web/Desktop producer here,
// so no commit highlight is synthesized.
import type { PlatformMessageKey } from "../../../i18n";
import type { Translate } from "../../context";
import type { Project } from "../projectModels";
import type { ProjectInboxWorkItem } from "../projectWorkItems";
import type { ProjectActivitySummary } from "./projectActivitySummaries";

const WEEK_SECONDS = 7 * 24 * 60 * 60;

export type ProjectsActivityDigest = {
  highlights: string[];
  prefix: string;
  suffix: string;
};

function plural(t: Translate, count: number, key: string) {
  return t(`${key}.${count === 1 ? "one" : "other"}` as PlatformMessageKey, { count });
}

/** Builds a short, deterministic sentence from the currently loaded activity. */
export function buildProjectsActivityDigest({
  issues,
  nowSeconds,
  projects,
  pullRequests,
  summaries,
  t,
}: {
  issues: Extract<ProjectInboxWorkItem, { type: "issue" }>[];
  nowSeconds: number;
  projects: Project[];
  pullRequests: Extract<ProjectInboxWorkItem, { type: "pull-request" }>[];
  summaries?: Record<string, ProjectActivitySummary>;
  t: Translate;
}): ProjectsActivityDigest {
  const since = nowSeconds - WEEK_SECONDS;
  const activeProjectIds = new Set<string>();
  const taskCount = issues.filter(({ issue, project }) => {
    const recent = issue.createdAt >= since;
    if (recent) activeProjectIds.add(project.id);
    return recent;
  }).length;
  const reviewCount = pullRequests.filter(({ project, pullRequest }) => {
    const recent = pullRequest.createdAt >= since;
    if (recent) activeProjectIds.add(project.id);
    return recent;
  }).length;
  const highlights = [
    taskCount > 0 ? plural(t, taskCount, "projects.activity.digest.tasksOpened") : null,
    reviewCount > 0 ? plural(t, reviewCount, "projects.activity.digest.reviewsOpened") : null,
  ].filter((value): value is string => value !== null);

  if (highlights.length > 0) {
    highlights.push(plural(t, activeProjectIds.size, "projects.activity.digest.activeProjects"));
    return {
      highlights,
      prefix: t("projects.activity.digest.thisWeek"),
      suffix: t("projects.activity.digest.suffix"),
    };
  }

  const totals = Object.values(summaries ?? {}).reduce(
    (result, summary) => ({
      reviews: result.reviews + summary.prCount,
      tasks: result.tasks + summary.issueCount,
    }),
    { reviews: 0, tasks: 0 },
  );
  return {
    highlights: [
      plural(t, projects.length, "projects.activity.digest.projects"),
      plural(t, totals.tasks, "projects.activity.digest.tasks"),
      plural(t, totals.reviews, "projects.activity.digest.reviews"),
    ],
    prefix: t("projects.activity.digest.tracking"),
    suffix: t("projects.activity.digest.suffix"),
  };
}
