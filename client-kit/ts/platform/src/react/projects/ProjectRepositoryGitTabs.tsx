// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectWorkspaceTabs.tsx
// "overview"/"activity"/"files"/"contributors" contents with ProjectDetailScreen's git views
// (useRetainedProjectGitViews.ts::useProjectDetailGitViews, remote source, default branch) and the
// selected review's Files changed (projectReviewDisplay.ts::reviewDiffWorkspaceBranch and
// projectReviewFilesChangedBody).
// DD-118: ProjectDetailScreen's branch state (useRepoStateQuery, resolveProjectDefaultBranch,
// useOptimisticProjectBranches, useProjectRepositoryRefSelection, projectBranchManagementState,
// useProjectBranchActions, handleFetchRepo) lives in useRepositoryGitState so that the tab contents
// and the original repository right panel (branch picker, Fetch, details) read the same state.
// Create/delete appear only when the host offers ref writes. Local checkouts, tags and
// clone/pull/push are Desktop-local and not part of this shared remote read.
import { Files as FilesIcon, GitCommitHorizontal } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useUiT } from "../context";
import { ActivityPanel } from "./ProjectCommitsPanel";
import { ProjectCommitDetailPanel } from "./ProjectCommitDetailPanel";
import { ContributorsPanel } from "./ProjectContributorsPanel";
import { ProjectPullRequestFilesChangedPanel, type ReviewFilesChangedControls } from "./ProjectPullRequestFilesChangedPanel";
import { findReadmeFile, type GitDataState, ProjectOverviewPanel } from "./ProjectReadmePanel";
import { RepositoryFilesPanel } from "./ProjectRepositoryPanel";
import { ProjectRepositoryUnavailableState } from "./ProjectRepositoryUnavailableState";
import { ProjectSectionHeader } from "./ProjectSectionHeader";
import type { RepoBranchHeaderControls } from "./ProjectRepositorySource";
import { BuzzLoadingState } from "./BuzzLoadingState";
import { useProjectBranchActions } from "./branchMutations";
import { projectBranchCreationReason, projectBranchManagementState, resolveProjectDefaultBranch } from "./lib/projectBranches";
import { gitContributorPubkeysFromCommits, type ProjectContributorActivityCounts } from "./lib/projectContributorMatching";
import { projectReviewFilesChangedBody, reviewDiffWorkspaceBranch } from "./lib/projectReviewDisplay";
import { useRepoStateQuery } from "./projectRepoState";
import { useOptimisticProjectBranches } from "./useOptimisticProjectBranches";
import { useProjectRepositoryRefSelection } from "./useProjectRepositoryRefSelection";
import type { ProjectsHost } from "./projectEnumeration";
import { useProjectCommitDiffQuery, useProjectRepoDiffQuery, useProjectRepoSnapshotQuery } from "./projectGitQueries";
import type { Repository } from "./projectModels";
import { PROJECT_SECTION_HEADER_CLASS } from "./projectPanelStyles";
import type { ProjectPullRequest } from "./projectPullRequests.mjs";
import { projectRepoUnavailablePresentation, projectRepoUnavailableReason } from "./lib/projectRepoAvailability";
import { useRepositoryFileContentSource } from "./useRepositoryFileContent";
import { useProjectLocalCheckout, type ProjectCheckoutSource } from "./useProjectLocalCheckout";
import { useQueryClient } from "@tanstack/react-query";
import type { UserProfileLookup } from "../messages/system/identity";

const NO_BRANCHES: Array<{ name: string; commit: string }> = [];

/** The original repository Fetch: refresh the remote snapshot and refs, report a failure by its reason. */
export type RepositoryFetchControls = { onFetch: () => void; fetchPending: boolean };

/** ProjectDetailScreen's repository git state, shared by the tab contents and the right panel. */
export function useRepositoryGitState({ host, repository, pullRequests, commitHash, checkoutSource }: {
  host: ProjectsHost;
  repository: Repository;
  pullRequests: ProjectPullRequest[];
  commitHash: string | null;
  checkoutSource: ProjectCheckoutSource;
}) {
  const t = useUiT();
  const cache = useQueryClient();
  const lifetime = React.useMemo(() => ({ active: true }), [host.scopeKey, repository.repoAddress]);
  React.useEffect(() => { lifetime.active = true; return () => { lifetime.active = false; }; }, [lifetime]);
  // Repository refs only serve the Git tabs and the branch picker: no Git seam, no ref read.
  const repoStateQuery = useRepoStateQuery(host, host.git ? repository : null);
  const defaultBranch = resolveProjectDefaultBranch(repository.defaultBranch, repoStateQuery.data);
  const referencedBranches = React.useMemo(() => pullRequests.map(pullRequest => pullRequest.branchName ?? null), [pullRequests]);
  const { branchOptions, forgetBranch, managedBranches, rememberBranch } = useOptimisticProjectBranches({
    defaultBranch,
    observedBranches: repoStateQuery.data?.branches ?? NO_BRANCHES,
    projectId: repository.id,
    referencedBranches,
  });
  const { activeBranch: selectedBranch, selectBranch } = useProjectRepositoryRefSelection({
    branchOptions,
    defaultBranch,
    projectAvailable: true,
    projectPending: false,
    repositoryId: repository.id,
    tags: NO_BRANCHES,
  });
  const activeBranch = selectedBranch ?? defaultBranch;
  const localCheckout = useProjectLocalCheckout(host, repository, activeBranch, checkoutSource);
  const remoteSnapshotQuery = useProjectRepoSnapshotQuery(host, repository, activeBranch, null, localCheckout.source === "remote");
  const snapshotQuery = localCheckout.source === "local" ? localCheckout.snapshot : remoteSnapshotQuery;
  const commitDiffQuery = useProjectCommitDiffQuery(host, repository, commitHash, localCheckout.source);
  const fileContentSource = useRepositoryFileContentSource({ activeBranch, host, pullRequest: null, repository, source: localCheckout.source });
  const snapshot = snapshotQuery.data ?? null;
  const files = React.useMemo(() => snapshot?.files ?? [], [snapshot]);
  const readmeFile = React.useMemo(() => findReadmeFile(files), [files]);
  const gitDataState: GitDataState = snapshot ? (files.length === 0 ? "empty" : "available") : snapshotQuery.isLoading ? "checking" : "unavailable";
  const unavailableReason = gitDataState === "unavailable" ? projectRepoUnavailableReason(snapshotQuery.error) : undefined;
  const { activeBranchCommit, activeRemoteBranch, deleteBranchReason } = projectBranchManagementState({
    activeBranch,
    branches: managedBranches,
    defaultBranch,
    hasOpenPullRequest: pullRequests.some(pullRequest => pullRequest.branchName === activeBranch
      && (pullRequest.status === "Open" || pullRequest.status === "Draft")),
    snapshotCommit: snapshot?.latestCommit?.hash,
  });
  const branchActions = useProjectBranchActions({
    activeBranch,
    activeBranchCommit,
    activeRemoteBranch,
    defaultBranch,
    deleteBranchReason,
    forgetBranch,
    host,
    project: repository,
    refetchRepoState: repoStateQuery.refetch,
    rememberBranch,
    selectBranch,
  });
  const createBranchReason = projectBranchCreationReason({ activeBranch, activeBranchCommit });
  const unconfirmed = t("projects.branch.unknown");
  const otherRetained = (retained: unknown) => Boolean(branchActions.retainedCreate || branchActions.retainedDelete) && !retained;
  const sourceControls: RepoBranchHeaderControls = {
    branch: activeBranch,
    branchOptions,
    onBranchChange: selectBranch,
    ...(branchActions.available ? {
      onCreateBranch: () => branchActions.setCreateOpen(true),
      createBranchDisabled: branchActions.createPending || otherRetained(branchActions.retainedCreate)
        || (!branchActions.retainedCreate && !activeBranchCommit),
      createBranchTitle: otherRetained(branchActions.retainedCreate) ? unconfirmed
        : branchActions.retainedCreate ? t("projects.branch.recheck") : createBranchReason ?? t("projects.branch.createTitle"),
      onDeleteBranch: () => branchActions.setDeleteOpen(true),
      deleteBranchDisabled: branchActions.deletePending || otherRetained(branchActions.retainedDelete)
        || (!branchActions.retainedDelete && Boolean(deleteBranchReason)),
      deleteBranchTitle: otherRetained(branchActions.retainedDelete) ? unconfirmed
        : branchActions.retainedDelete ? t("projects.branch.recheck") : deleteBranchReason ?? t("projects.branch.deleteTitle"),
    } : {}),
  };
  // Original handleFetchRepo: refetch, then report the classified failure or the refresh.
  const refetchSnapshot = snapshotQuery.refetch, refetchState = repoStateQuery.refetch, refetchLocal = localCheckout.status.refetch;
  const onFetch = React.useCallback(() => {
    if (!lifetime.active) return;
    void Promise.all([refetchSnapshot(), refetchState(), ...(host.git?.checkout ? [refetchLocal()] : [])]).then(async results => {
      if (!lifetime.active) return;
      await cache.invalidateQueries({ queryKey: ["project-repository-file-content", host.scopeKey, repository.id] });
      if (!lifetime.active) return;
      const error = results.find(result => result.error)?.error;
      if (error) {
        const presentation = projectRepoUnavailablePresentation(projectRepoUnavailableReason(error));
        toast.error(presentation.title, { description: presentation.description });
        return;
      }
      toast.success(t("projects.repository.fetched"));
    });
  }, [refetchSnapshot, refetchState, refetchLocal, host, t, cache, repository.id, lifetime]);
  const fetch: RepositoryFetchControls = { onFetch, fetchPending: snapshotQuery.isFetching || repoStateQuery.isFetching };
  return { activeBranch, activeBranchCommit, branchActions, branchOptions, commitDiffQuery, fetch, fileContentSource, files,
    gitDataState, readmeFile, snapshot, snapshotQuery, sourceControls, unavailableReason, localCheckout };
}

export type RepositoryGitState = ReturnType<typeof useRepositoryGitState>;

/** The Git tab section headers of the original WorkspaceTabs. */
export function repositoryGitSectionHeader(tab: "overview" | "files" | "activity", state: RepositoryGitState, commitHash: string | null,
  t: ReturnType<typeof useUiT>) {
  return tab === "files" && state.files.length > 0
    ? <ProjectSectionHeader className={PROJECT_SECTION_HEADER_CLASS} icon={FilesIcon} title={t("projects.git.files")} />
    : tab === "activity" && !commitHash
      ? <ProjectSectionHeader className={PROJECT_SECTION_HEADER_CLASS} icon={GitCommitHorizontal} title={t("projects.workItem.commits")} />
      : null;
}

/** The original Overview / Commits / Files / Contributors tab bodies over the shared git state. */
export function RepositoryGitContent({ state, repository, projectId, pullRequests, tab, commitHash, filePath, onSelectedCommitHashChange, profiles,
  contributorActivityCounts, contributorPubkeys }: {
  state: RepositoryGitState;
  repository: Repository;
  projectId: string;
  pullRequests: ProjectPullRequest[];
  tab: "overview" | "files" | "activity" | "contributors";
  commitHash: string | null;
  filePath?: string;
  onSelectedCommitHashChange: (hash: string | null) => void;
  profiles?: UserProfileLookup;
  contributorActivityCounts: Record<string, ProjectContributorActivityCounts>;
  contributorPubkeys: string[];
}) {
  const t = useUiT();
  const { snapshot, snapshotQuery, files, unavailableReason } = state;
  const contributorPubkeysByGitIdentity = React.useMemo(() => gitContributorPubkeysFromCommits(snapshot?.commits ?? [], pullRequests),
    [pullRequests, snapshot?.commits]);
  const repositoryUnavailableState = unavailableReason
    ? <ProjectRepositoryUnavailableState onRetry={state.fetch.onFetch} reason={unavailableReason} retryPending={state.fetch.fetchPending} /> : null;
  const selectedCommitPullRequest = commitHash
    ? pullRequests.find(pullRequest => pullRequest.commit === commitHash || pullRequest.initialCommit === commitHash) : undefined;
  if (tab === "overview") return (
    <ProjectOverviewPanel file={state.readmeFile} fileContentSource={state.fileContentSource} gitDataState={state.gitDataState} hideHeader unavailableReason={unavailableReason} />
  );
  if (tab === "contributors") return snapshotQuery.isLoading
    ? <BuzzLoadingState label={t("projects.contributors.loading")} />
    : <ContributorsPanel activityCounts={contributorActivityCounts} contributorPubkeys={contributorPubkeys}
      contributorPubkeysByGitIdentity={contributorPubkeysByGitIdentity} profiles={profiles} repoContributors={snapshot?.contributors ?? []} />;
  if (tab === "activity") return repositoryUnavailableState ?? (commitHash ? (
    <ProjectCommitDetailPanel project={repository} commit={snapshot?.commits.find(commit => commit.hash === commitHash) ?? null} commitHash={commitHash}
      diff={state.commitDiffQuery.data} diffError={state.commitDiffQuery.error} diffLoading={state.commitDiffQuery.isLoading}
      originAgentName={selectedCommitPullRequest?.originAgentName} originChannelId={selectedCommitPullRequest?.channelId} />
  ) : (
    <ActivityPanel branch={state.activeBranch} error={snapshotQuery.error} isLoading={snapshotQuery.isLoading}
      onSelectCommit={commit => onSelectedCommitHashChange(commit.hash)} profiles={profiles} project={repository} projectId={projectId}
      pullRequests={pullRequests} repoContributors={snapshot?.contributors ?? []} snapshot={snapshot} />
  ));
  return repositoryUnavailableState ?? (
    <RepositoryFilesPanel error={snapshotQuery.error} fallbackAuthorPubkey={repository.owner} fileContentSource={state.fileContentSource} files={files}
      initialPath={filePath} isLoading={snapshotQuery.isLoading} onOpenCommit={onSelectedCommitHashChange} profiles={profiles} snapshot={snapshot} />
  );
}

/** Original selected-review Files changed body (rendered by the detail with its line-comment controls), diff stats and count. */
export function useReviewFilesChanged(host: ProjectsHost, repository: Repository, pullRequest: ProjectPullRequest) {
  const reviewDiffBranch = reviewDiffWorkspaceBranch({ activeBranch: null, defaultBranch: repository.defaultBranch, pullRequest });
  const diffQuery = useProjectRepoDiffQuery(host, repository, reviewDiffBranch ?? null, pullRequest, true);
  if (!host.git) return null;
  const diff = diffQuery.data;
  // A populated diff stays mounted through a transient unavailable read (the files-section flicker).
  const unavailableReason = diffQuery.error && !diff ? projectRepoUnavailableReason(diffQuery.error) : undefined;
  const body = projectReviewFilesChangedBody({
    hasPopulatedDiff: (diff?.files.length ?? 0) > 0,
    hasSelectedPullRequest: true,
    repositoryUnavailable: unavailableReason !== undefined && unavailableReason !== "unknown",
  });
  return {
    diffStats: diff ? { additions: diff.additions, deletions: diff.deletions } : null,
    filesChanged: (controls: ReviewFilesChangedControls) => body === "unavailable"
      ? <ProjectRepositoryUnavailableState reason={unavailableReason} />
      : <ProjectPullRequestFilesChangedPanel diff={diff} error={diffQuery.error}
        focusedAnchor={controls.focusedAnchor} inlineComments={controls.inlineComments} isLoading={diffQuery.isLoading} pullRequest={controls.pullRequest} />,
    filesCount: diff?.files.length,
  };
}
