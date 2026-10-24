// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectDetailFeedPanels.tsx::ContributorsPanel
// (the repository Contributors tab) and ui/useProjectDetailPeople.ts. Same rows, signed-identity
// matching, unverified Git-author hint and counts; copy comes from the shared catalog. The viewer's
// local `git config` identity is a Desktop-local read (useGitIdentityQuery) that this shared host
// does not have, so no viewer Git identity is assumed.
import * as React from "react";
import { CircleDot, GitCommitHorizontal, GitPullRequest } from "lucide-react";
import { useUiT } from "../context";
import { resolveUserLabel, type UserProfileLookup } from "../messages/system/identity";
import { useUsersBatchQuery } from "../pulse/host";
import {
  contributorKey,
  profileForContributor,
  projectContributorActivityCounts,
  signedProjectContributorPubkeys,
  type ProjectContributorActivityCounts,
} from "./lib/projectContributorMatching";
import { normalizePubkey } from "../conversations/pubkey";
import type { ProjectRepoContributor } from "./projectGit";
import type { ProjectIssue } from "./projectIssues.mjs";
import type { Repository } from "./projectModels";
import { PROJECT_DETAIL_PANEL_CLASS } from "./projectPanelStyles";
import type { ProjectPullRequest } from "./projectPullRequests.mjs";
import { ProjectPanelState } from "./ProjectPanelState";
import { ProfileIdentityButton } from "./ProjectProfileIdentity";

/** Original projectDetailHelpers.ts::projectPeople for one repository. */
function repositoryPeople(repository: Repository) {
  return [...new Set([repository.owner, ...repository.contributors].filter(Boolean).map(normalizePubkey))];
}

/** Original useProjectDetailPeople: profiles and signed contributor identity for the repository panels. */
export function useProjectDetailPeople({ issues, pullRequests, repository }: {
  issues: ProjectIssue[];
  pullRequests: ProjectPullRequest[];
  repository: Repository | null;
}) {
  const peoplePubkeys = React.useMemo(() => {
    if (!repository) return [];
    const pullRequestPubkeys = pullRequests.flatMap((pullRequest) => [
      pullRequest.author,
      ...pullRequest.updates.map((update) => update.author),
      ...pullRequest.comments.map((comment) => comment.author),
      ...pullRequest.reviewers,
      ...pullRequest.approvals.map((approval) => approval.author),
    ]);
    const issuePubkeys = issues.flatMap((issue) => [
      issue.author,
      ...issue.recipients,
      ...issue.assignees,
      ...issue.comments.map((comment) => comment.author),
    ]);
    return [...new Set([...repositoryPeople(repository), ...pullRequestPubkeys, ...issuePubkeys])];
  }, [issues, pullRequests, repository]);
  const profiles = useUsersBatchQuery(peoplePubkeys, { enabled: peoplePubkeys.length > 0 }).data?.profiles;
  const contributorPubkeys = React.useMemo(() => repository ? signedProjectContributorPubkeys({
    contributors: repository.contributors, issues, owner: repository.owner, pullRequests,
  }) : [], [issues, pullRequests, repository]);
  const contributorActivityCounts = React.useMemo(() => repository ? projectContributorActivityCounts({
    contributors: repository.contributors, issues, owner: repository.owner, pullRequests,
  }) : {}, [issues, pullRequests, repository]);
  return { contributorActivityCounts, contributorPubkeys, profiles };
}

export function ContributorsPanel({
  activityCounts,
  contributorPubkeys,
  contributorPubkeysByGitIdentity,
  profiles,
  repoContributors,
}: {
  activityCounts: Record<string, ProjectContributorActivityCounts>;
  contributorPubkeys: string[];
  contributorPubkeysByGitIdentity: ReadonlyMap<string, string>;
  profiles?: UserProfileLookup;
  repoContributors: ProjectRepoContributor[];
}) {
  const t = useUiT();
  const count = (value: number, one: Parameters<typeof t>[0], many: Parameters<typeof t>[0]) =>
    t(value === 1 ? one : many, { count: value });
  const gitRows = repoContributors.map((contributor) => {
    const signedPubkey = contributorPubkeysByGitIdentity.get(contributorKey(contributor));
    const signedProfile = signedPubkey ? profiles?.[signedPubkey] : undefined;
    const heuristicProfile = signedPubkey ? null : profileForContributor(contributor, profiles);
    const matchedPubkey = signedPubkey ?? heuristicProfile?.pubkey ?? null;
    const matchedProfile = signedProfile ?? heuristicProfile?.profile;
    const label = matchedProfile
      ? resolveUserLabel({ pubkey: matchedPubkey ?? "", profiles })
      : contributor.name || contributor.email || t("projects.contributors.unknown");
    const signedCounts = matchedPubkey ? activityCounts[matchedPubkey] : undefined;
    return {
      avatarUrl: matchedProfile?.avatarUrl ?? null,
      commitCount: contributor.commitCount as number | null,
      id: `git:${contributorKey(contributor)}`,
      isAgent: matchedProfile?.isAgent === true,
      label,
      pubkey: matchedPubkey,
      profileLinked: matchedPubkey !== null,
      reviewCount: signedCounts?.reviews ?? null,
      role: signedPubkey
        ? matchedProfile?.nip05Handle || contributor.email || t("projects.contributors.buzz")
        : heuristicProfile
          ? t("projects.contributors.unverified", {
            identity: heuristicProfile.profile.nip05Handle || contributor.email || t("projects.contributors.git"),
          })
          : contributor.email || t("projects.contributors.git"),
      taskCount: signedCounts?.tasks ?? null,
    };
  });
  const matchedPubkeys = new Set(
    gitRows.map((row) => row.pubkey).filter((pubkey): pubkey is string => pubkey !== null),
  );
  const linkedRows = contributorPubkeys
    .filter((pubkey) => !matchedPubkeys.has(pubkey))
    .map((pubkey) => {
      const profile = profiles?.[pubkey];
      const isAgent = profile?.isAgent === true;
      const signedCounts = activityCounts[pubkey] ?? { commits: 0, reviews: 0, tasks: 0 };
      return {
        avatarUrl: profile?.avatarUrl ?? null,
        commitCount: signedCounts.commits as number | null,
        id: `buzz:${pubkey}`,
        isAgent,
        label: resolveUserLabel({ profiles, pubkey }),
        profileLinked: true,
        pubkey: pubkey as string | null,
        reviewCount: signedCounts.reviews as number | null,
        role: profile?.nip05Handle || t(isAgent ? "projects.contributors.agent" : "projects.contributors.buzz"),
        taskCount: signedCounts.tasks as number | null,
      };
    });
  const rows = [
    ...gitRows.filter((row) => row.profileLinked),
    ...linkedRows,
    ...gitRows.filter((row) => !row.profileLinked),
  ].sort(
    (left, right) =>
      (right.commitCount ?? -1) - (left.commitCount ?? -1) ||
      left.label.localeCompare(right.label),
  );

  if (rows.length === 0) {
    return (
      <ProjectPanelState
        description={t("projects.contributors.emptyHint")}
        title={t("projects.contributors.empty")}
      />
    );
  }

  return (
    <div
      className={`${PROJECT_DETAIL_PANEL_CLASS} mx-4`}
      data-project-detail-panel
    >
      {rows.map((row) => (
        <div
          className="flex min-h-9 min-w-0 items-center gap-2 px-4 py-1.5 transition-colors hover:bg-muted/35"
          data-project-contributor-kind={row.isAgent ? "agent" : "human"}
          data-testid="project-contributor-row"
          key={row.id}
        >
          <ProfileIdentityButton
            avatarClassName="shrink-0"
            avatarSize="xs"
            avatarUrl={row.avatarUrl}
            isAgent={row.isAgent}
            label={row.label}
            pubkey={row.pubkey}
            showLabel={false}
          />
          <span
            className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
            data-projects-text-priority="primary"
            title={row.label}
          >
            {row.label}
          </span>
          <span
            className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground md:block"
            data-testid="project-contributor-identity"
            title={row.role}
          >
            {row.role}
          </span>
          <span
            className="flex w-14 shrink-0 items-center justify-end gap-1 text-xs tabular-nums text-muted-foreground"
            data-testid="project-contributor-commit-count"
            title={row.commitCount === null ? t("projects.contributors.noCommits")
              : count(row.commitCount, "projects.contributors.commitOne", "projects.contributors.commitMany")}
          >
            <GitCommitHorizontal className="h-3.5 w-3.5" />
            {row.commitCount ?? 0}
          </span>
          <span
            className="flex w-14 shrink-0 items-center justify-end gap-1 text-xs tabular-nums text-muted-foreground"
            data-testid="project-contributor-review-count"
            title={row.reviewCount === null ? t("projects.contributors.noReviews")
              : count(row.reviewCount, "projects.contributors.reviewOne", "projects.contributors.reviewMany")}
          >
            <GitPullRequest className="h-3.5 w-3.5" />
            {row.reviewCount ?? 0}
          </span>
          <span
            className="flex w-14 shrink-0 items-center justify-end gap-1 text-xs tabular-nums text-muted-foreground"
            data-testid="project-contributor-task-count"
            title={row.taskCount === null ? t("projects.contributors.noTasks")
              : count(row.taskCount, "projects.contributors.taskOne", "projects.contributors.taskMany")}
          >
            <CircleDot className="h-3.5 w-3.5" />
            {row.taskCount ?? 0}
          </span>
        </div>
      ))}
    </div>
  );
}
