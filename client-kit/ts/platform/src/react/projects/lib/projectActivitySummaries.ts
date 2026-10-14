// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/hooks.ts::fetchRepositoryActivitySummaries and
// fetchProjectActivitySummaries. The original Relay read is the existing
// governed Projects host snapshot; the reducer and per-project fold are unchanged.
// Kailo's Projects read does not expose kind 1617 patches, so patch commits are
// absent from commitCount rather than estimated.
import type { PulseEvent } from "../../pulse/host";
import { summarizeProjectActivityEvents, type ProjectActivitySummary } from "../projectActivity.mjs";
import type { Project, Repository } from "../projectModels";

export type { ProjectActivitySummary };

// Original summary query kinds: issue, statuses, patch, pull request, PR update.
const SUMMARY_KINDS = new Set([1621, 1630, 1631, 1632, 1633, 1617, 1618, 1619]);

export function repositoryActivitySummaries(
  events: readonly PulseEvent[],
  repositories: readonly Repository[],
): Record<string, ProjectActivitySummary> {
  if (repositories.length === 0) return {};
  return summarizeProjectActivityEvents(
    events.filter((event) => SUMMARY_KINDS.has(event.kind)),
    [...repositories],
  );
}

export function projectActivitySummaries(
  events: readonly PulseEvent[],
  projects: readonly Project[],
): Record<string, ProjectActivitySummary> {
  if (projects.length === 0) return {};

  const repositories = [
    ...new Map(
      projects
        .flatMap((project) => project.repositories)
        .map((repository) => [repository.repoAddress, repository]),
    ).values(),
  ];
  const summariesByRepository = repositoryActivitySummaries(events, repositories);
  return Object.fromEntries(
    projects.map((project) => {
      const summaries = project.repositories.map(
        (repository) => summariesByRepository[repository.repoAddress],
      );
      const latestCommit =
        summaries
          .map((summary) => summary?.latestCommit)
          .filter(
            (
              commit,
            ): commit is NonNullable<ProjectActivitySummary["latestCommit"]> =>
              Boolean(commit),
          )
          .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
      const activityByDay: Record<string, number> = {};
      for (const summary of summaries) {
        for (const [day, count] of Object.entries(
          summary?.activityByDay ?? {},
        )) {
          activityByDay[day] = (activityByDay[day] ?? 0) + count;
        }
      }
      return [
        project.id,
        {
          repoAddress: project.projectAddress,
          issueCount: summaries.reduce(
            (count, summary) => count + (summary?.issueCount ?? 0),
            0,
          ),
          prCount: summaries.reduce(
            (count, summary) => count + (summary?.prCount ?? 0),
            0,
          ),
          commitCount: summaries.reduce(
            (count, summary) => count + (summary?.commitCount ?? 0),
            0,
          ),
          activityCount: summaries.reduce(
            (count, summary) => count + (summary?.activityCount ?? 0),
            0,
          ),
          updatedAt: Math.max(
            0,
            ...summaries.map((summary) => summary?.updatedAt ?? 0),
          ),
          participantPubkeys: [
            ...new Set(
              summaries.flatMap((summary) => summary?.participantPubkeys ?? []),
            ),
          ],
          latestCommit,
          activityByDay,
        } satisfies ProjectActivitySummary,
      ];
    }),
  );
}
