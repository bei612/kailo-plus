// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectWorkspaceTabs.tsx
// "overview"/"activity"/"files" contents with ProjectDetailScreen's git views
// (useRetainedProjectGitViews.ts::useProjectDetailGitViews, remote source, default branch) and the
// selected review's Files changed (projectReviewDisplay.ts::reviewDiffWorkspaceBranch).
import { Files as FilesIcon, GitCommitHorizontal } from "lucide-react";
import * as React from "react";
import { useUiT } from "../context";
import { useUsersBatchQuery } from "../pulse/host";
import { ActivityPanel } from "./ProjectCommitsPanel";
import { ProjectCommitDetailPanel } from "./ProjectCommitDetailPanel";
import { ProjectPullRequestFilesChangedPanel } from "./ProjectPullRequestFilesChangedPanel";
import { findReadmeFile, type GitDataState, ProjectOverviewPanel } from "./ProjectReadmePanel";
import { RepositoryFilesPanel } from "./ProjectRepositoryPanel";
import { ProjectRepositoryUnavailableState } from "./ProjectRepositoryUnavailableState";
import { ProjectSectionHeader } from "./ProjectSectionHeader";
import type { ProjectsHost } from "./projectEnumeration";
import { useProjectCommitDiffQuery, useProjectRepoDiffQuery, useProjectRepoSnapshotQuery } from "./projectGitQueries";
import type { Repository } from "./projectModels";
import { PROJECT_SECTION_HEADER_CLASS } from "./projectPanelStyles";
import type { ProjectPullRequest } from "./projectPullRequests.mjs";
import { WorkspaceTabs, type ProjectWorkspaceTab } from "./ProjectWorkspaceTabs";
import { projectRepoUnavailableReason } from "./lib/projectRepoAvailability";
import { useRepositoryFileContentSource } from "./useRepositoryFileContent";

/** Original repository workspace on a Git tab: tab menu, section header and tab content. */
export function RepositoryGitWorkspace({ host, repository, projectId, pullRequests, tab, commitHash, filePath, onSelectedCommitHashChange, onTabChange, onBack }: {
  host: ProjectsHost;
  repository: Repository;
  projectId: string;
  pullRequests: ProjectPullRequest[];
  tab: "overview" | "files" | "activity";
  commitHash: string | null;
  filePath?: string;
  onSelectedCommitHashChange: (hash: string | null) => void;
  onTabChange: (tab: ProjectWorkspaceTab) => void;
  onBack: () => void;
}) {
  const t = useUiT();
  const activeBranch = repository.defaultBranch;
  const snapshotQuery = useProjectRepoSnapshotQuery(host, repository, activeBranch, null, true);
  const commitDiffQuery = useProjectCommitDiffQuery(host, repository, commitHash);
  const fileContentSource = useRepositoryFileContentSource({ activeBranch, host, pullRequest: null, repository });
  const people = React.useMemo(() => [...new Set([repository.owner, ...repository.contributors,
    ...pullRequests.flatMap(pullRequest => [pullRequest.author, ...pullRequest.updates.map(update => update.author)])])], [pullRequests, repository]);
  const profiles = useUsersBatchQuery(people).data?.profiles;
  const snapshot = snapshotQuery.data ?? null;
  const files = snapshot?.files ?? [];
  const readmeFile = React.useMemo(() => findReadmeFile(files), [files]);
  const gitDataState: GitDataState = snapshot ? (files.length === 0 ? "empty" : "available") : snapshotQuery.isLoading ? "checking" : "unavailable";
  const unavailableReason = gitDataState === "unavailable" ? projectRepoUnavailableReason(snapshotQuery.error) : undefined;
  const repositoryUnavailableState = unavailableReason ? <ProjectRepositoryUnavailableState reason={unavailableReason} /> : null;
  const selectedCommitPullRequest = commitHash
    ? pullRequests.find(pullRequest => pullRequest.commit === commitHash || pullRequest.initialCommit === commitHash) : undefined;

  const sectionHeader = tab === "files" && files.length > 0
    ? <ProjectSectionHeader className={PROJECT_SECTION_HEADER_CLASS} icon={FilesIcon} title={t("projects.git.files")} />
    : tab === "activity" && !commitHash
      ? <ProjectSectionHeader className={PROJECT_SECTION_HEADER_CLASS} icon={GitCommitHorizontal} title={t("projects.workItem.commits")} />
      : null;
  const content = tab === "overview" ? (
    <ProjectOverviewPanel file={readmeFile} fileContentSource={fileContentSource} gitDataState={gitDataState} hideHeader unavailableReason={unavailableReason} />
  ) : tab === "activity" ? (
    repositoryUnavailableState ?? (commitHash ? (
      <ProjectCommitDetailPanel commit={snapshot?.commits.find(commit => commit.hash === commitHash) ?? null} commitHash={commitHash}
        diff={commitDiffQuery.data} diffError={commitDiffQuery.error} diffLoading={commitDiffQuery.isLoading}
        originAgentName={selectedCommitPullRequest?.originAgentName} originChannelId={selectedCommitPullRequest?.channelId} />
    ) : (
      <ActivityPanel branch={activeBranch} error={snapshotQuery.error} isLoading={snapshotQuery.isLoading}
        onSelectCommit={commit => onSelectedCommitHashChange(commit.hash)} profiles={profiles} project={repository} projectId={projectId}
        pullRequests={pullRequests} repoContributors={snapshot?.contributors ?? []} snapshot={snapshot} />
    ))
  ) : (
    repositoryUnavailableState ?? (
      <RepositoryFilesPanel error={snapshotQuery.error} fallbackAuthorPubkey={repository.owner} fileContentSource={fileContentSource} files={files}
        initialPath={filePath} isLoading={snapshotQuery.isLoading} onOpenCommit={onSelectedCommitHashChange} profiles={profiles} snapshot={snapshot} />
    )
  );
  return <WorkspaceTabs tab={tab} onTabChange={onTabChange} onBack={onBack} git detailSelected={tab === "activity" && Boolean(commitHash)}
    sectionHeader={sectionHeader}>{content}</WorkspaceTabs>;
}

/** Original selected-review Files changed body, diff stats and count. */
export function useReviewFilesChanged(host: ProjectsHost, repository: Repository, pullRequest: ProjectPullRequest) {
  const reviewDiffBranch = pullRequest.targetBranch || repository.defaultBranch;
  const diffQuery = useProjectRepoDiffQuery(host, repository, reviewDiffBranch, pullRequest, true);
  if (!host.git) return null;
  const diff = diffQuery.data;
  return {
    diffStats: diff ? { additions: diff.additions, deletions: diff.deletions } : null,
    filesChanged: <ProjectPullRequestFilesChangedPanel diff={diff} error={diffQuery.error} isLoading={diffQuery.isLoading} pullRequest={pullRequest} />,
    filesCount: diff?.files.length,
  };
}
