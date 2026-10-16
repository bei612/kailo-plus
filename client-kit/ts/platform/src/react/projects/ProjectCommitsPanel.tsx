// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/
// ProjectDetailFeedPanels.tsx::ActivityPanel and ProjectHomeCommitsPanel.tsx. Same rows, author
// matching, repository/branch metadata and partial-failure notice. Row selection-to-Agent is a
// missing consumer of the restored ProjectWorkItemRow and is not rendered.
import { AlertTriangle, FolderGit2, GitBranch, GitCommitHorizontal } from "lucide-react";
import { useUiT } from "../context";
import { resolveUserLabel, type UserProfileLookup } from "../messages/system/identity";
import { BuzzLoadingState } from "./BuzzLoadingState";
import { CopyCommitHashButton } from "./ProjectCommitCopyButton";
import { ProjectPanelState } from "./ProjectPanelState";
import { ProfileIdentityButton } from "./ProjectProfileIdentity";
import { ProjectWorkItemRow } from "./ProjectWorkItemRow";
import type { ProjectRepoCommit, ProjectRepoContributor, ProjectRepoSnapshot } from "./projectGit";
import type { ProjectRepositorySnapshotResult } from "./projectGitQueries";
import type { Repository } from "./projectModels";
import { PROJECT_DETAIL_PANEL_CLASS } from "./projectPanelStyles";
import type { ProjectPullRequest } from "./projectPullRequests.mjs";
import { commitAuthorPubkeysFromPullRequests, profileForCommit, type ViewerGitIdentity } from "./lib/projectContributorMatching";
import { projectRepoUnavailablePresentation, projectRepoUnavailableReason } from "./lib/projectRepoAvailability";
import { relativeTime } from "./lib/projectsViewHelpers";

type CommitItem = {
  branch?: string;
  commit: ProjectRepoCommit;
  project: Repository;
  projectId: string;
  pullRequests?: ProjectPullRequest[];
  repoContributors?: ProjectRepoContributor[];
};

export function ActivityPanel({
  branch, commitItems, snapshot, isLoading, error, onSelectCommit, profiles, project, projectId, pullRequests, repoContributors, viewerGitIdentity,
}: {
  branch?: string;
  commitItems?: CommitItem[];
  snapshot: ProjectRepoSnapshot | null | undefined;
  isLoading: boolean;
  error: unknown;
  onSelectCommit?: (commit: ProjectRepoCommit, project: Repository) => void;
  profiles?: UserProfileLookup;
  project: Repository;
  projectId: string;
  pullRequests?: ProjectPullRequest[];
  repoContributors: ProjectRepoContributor[];
  viewerGitIdentity?: ViewerGitIdentity | null;
}) {
  const t = useUiT();
  const items: CommitItem[] =
    commitItems ?? (snapshot?.commits ?? []).map((commit) => ({ branch, commit, project, projectId, pullRequests, repoContributors }));
  const showRepositoryName = commitItems !== undefined && new Set(items.map((item) => item.project.repoAddress)).size > 1;

  if (isLoading) return <BuzzLoadingState label={t("projects.git.loadingActivity")} />;
  if (items.length === 0) {
    return (
      <ProjectPanelState
        description={t(error ? "projects.git.commitsErrorHint" : commitItems ? "projects.git.projectCommitsHint" : "projects.git.repositoryCommitsHint")}
        error={Boolean(error)}
        title={t(error ? "projects.git.commitsError" : "projects.git.noCommits")}
      />
    );
  }

  return (
    <section className={PROJECT_DETAIL_PANEL_CLASS} data-project-detail-panel data-testid="project-commits">
      <div className="space-y-0.5 px-2">
        {items.map((item) => {
          const commitAuthorPubkeys = commitAuthorPubkeysFromPullRequests(item.pullRequests ?? []);
          const matchedProfile = profileForCommit(item.commit, profiles, commitAuthorPubkeys, viewerGitIdentity);
          const authorLabel = matchedProfile
            ? resolveUserLabel({ pubkey: matchedProfile.pubkey, profiles })
            : item.commit.authorName || item.commit.authorEmail || t("projects.git.unknownAuthor");
          const matchingContributor = (item.repoContributors ?? []).find(
            (contributor) =>
              contributor.name.trim().toLowerCase() === item.commit.authorName.trim().toLowerCase() ||
              contributor.email.trim().toLowerCase() === item.commit.authorEmail.trim().toLowerCase(),
          );
          const commitTitle = matchingContributor?.commitCount
            ? t(matchingContributor.commitCount === 1 ? "projects.git.committedByOne" : "projects.git.committedByMany",
              { name: authorLabel, count: matchingContributor.commitCount })
            : t("projects.git.committedBy", { name: authorLabel });
          return (
            <ProjectWorkItemRow
              eventId={item.commit.hash}
              identifier={item.commit.shortHash}
              identifierClassName="font-mono"
              identifierTitle={t("projects.commit.view", { hash: item.commit.shortHash })}
              key={`${item.project.repoAddress}:${item.commit.hash}`}
              metadata={
                showRepositoryName || item.branch ? (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    {showRepositoryName ? (
                      <>
                        <FolderGit2 className="h-3 w-3 shrink-0" />
                        <span className="truncate">{item.project.name}</span>
                      </>
                    ) : (
                      <>
                        <GitBranch className="h-3 w-3 shrink-0" />
                        <span className="truncate">{item.branch}</span>
                      </>
                    )}
                  </span>
                ) : undefined
              }
              onOpen={onSelectCommit ? () => onSelectCommit(item.commit, item.project) : undefined}
              statusIcon={<GitCommitHorizontal className="h-3.5 w-3.5 text-muted-foreground/70" />}
              testId="project-activity-feed-item"
              title={item.commit.subject}
              trailing={
                <>
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center" data-testid="project-commit-author" title={commitTitle}>
                    <ProfileIdentityButton avatarClassName="shrink-0" avatarSize="xs" avatarUrl={matchedProfile?.profile.avatarUrl ?? null}
                      isAgent={matchedProfile?.profile.isAgent === true} label={authorLabel} pubkey={matchedProfile?.pubkey ?? null} showLabel={false} />
                  </span>
                  <CopyCommitHashButton className="h-5 w-5 shrink-0 text-muted-foreground/60" hash={item.commit.hash} />
                  <span className="hidden w-20 shrink-0 whitespace-nowrap text-right text-xs text-muted-foreground/55 sm:block"
                    data-testid="project-commit-row-date" title={new Date(item.commit.timestamp * 1_000).toLocaleString()}>
                    {relativeTime(item.commit.timestamp)}
                  </span>
                </>
              }
            />
          );
        })}
      </div>
    </section>
  );
}

export function ProjectHomeCommitsPanel({ onSelectCommit, profiles, projectId, pullRequests, results, viewerGitIdentity }: {
  onSelectCommit: (commit: ProjectRepoCommit, repository: Repository) => void;
  profiles?: UserProfileLookup;
  projectId: string;
  pullRequests: ProjectPullRequest[];
  results: ProjectRepositorySnapshotResult[];
  viewerGitIdentity?: ViewerGitIdentity | null;
}) {
  const t = useUiT();
  const loaded = results.filter((result) => (result.snapshot?.commits.length ?? 0) > 0);
  const commitItems = loaded
    .flatMap(({ repository, snapshot }) =>
      (snapshot?.commits ?? []).map((commit) => ({
        branch: repository.defaultBranch, commit, project: repository, projectId, pullRequests,
        repoContributors: snapshot?.contributors ?? [],
      })),
    )
    .sort((left, right) => right.commit.timestamp - left.commit.timestamp);
  const failed = results.filter((result) => result.error);
  const firstFailure = failed[0];
  const failure = firstFailure ? projectRepoUnavailablePresentation(projectRepoUnavailableReason(firstFailure.error)) : null;
  if (results.some((result) => result.isLoading) && loaded.length === 0) {
    return <BuzzLoadingState label={t("projects.git.loadingCommits")} />;
  }
  if (loaded.length === 0) {
    return (
      <ProjectPanelState
        description={
          failure && firstFailure
            ? `${firstFailure.repository.name}: ${failure.description}${
                failed.length > 1 ? ` ${t("projects.git.otherRepositoriesFailed", { count: failed.length - 1 })}` : ""
              }`
            : t("projects.git.projectCommitsHint")
        }
        error={failed.length > 0}
        title={failure?.title ?? t("projects.git.noCommits")}
      />
    );
  }
  const firstItem = commitItems[0];
  if (!firstItem) return null;
  return (
    <div className="space-y-3">
      {failed.length > 0 ? (
        <div className="mx-4 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm"
          data-testid="project-home-commits-degraded" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p>{t(failed.length === 1 ? "projects.git.commitsDegradedOne" : "projects.git.commitsDegradedMany",
            { loaded: loaded.length, total: results.length, failed: failed.length })}</p>
        </div>
      ) : null}
      <ActivityPanel commitItems={commitItems} error={null} isLoading={false} onSelectCommit={onSelectCommit} profiles={profiles}
        project={firstItem.project} projectId={projectId} pullRequests={pullRequests} repoContributors={firstItem.repoContributors}
        snapshot={null} viewerGitIdentity={viewerGitIdentity} />
    </div>
  );
}
