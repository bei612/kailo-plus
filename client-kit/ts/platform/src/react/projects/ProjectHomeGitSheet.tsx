// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectHomeWorkspaceSheet.tsx "commits" and "files" branches:
// the project-wide commit list with commit detail, and the selected repository's file tree, with
// the original back/expand navigation. Reviews come from the governed work-item read.
import * as React from "react";
import { useUiT } from "../context";
import { useProjectProfiles } from "./useProjectProfiles";
import { ProjectCommitDetailPanel } from "./ProjectCommitDetailPanel";
import { ProjectHomeCommitsPanel } from "./ProjectCommitsPanel";
import { ProjectHomeCodebasePanel } from "./ProjectHomeCodebasePanel";
import type { ProjectsHost } from "./projectEnumeration";
import { useProjectCommitDiffQuery, useProjectRepositorySnapshots } from "./projectGitQueries";
import type { Project, Repository } from "./projectModels";
import type { ProjectPullRequest } from "./projectPullRequests.mjs";
import type { RepositoryFilesContext } from "./useRepositoryFilesNavigation";

export type ProjectHomeGitDetail = {
  backLabel: string;
  onBack: () => void;
  navigation: { repositoryId: string; commitHash?: string; filePath?: string };
};

export function ProjectHomeCommitsSheet({ host, project, repository, pullRequests, onDetailChange }: {
  host: ProjectsHost;
  project: Project;
  repository: Repository;
  pullRequests: ProjectPullRequest[];
  onDetailChange: (detail: ProjectHomeGitDetail | null) => void;
}) {
  const t = useUiT();
  const [selectedCommitHash, setSelectedCommitHash] = React.useState<string | null>(null);
  const [selectedCommitRepositoryId, setSelectedCommitRepositoryId] = React.useState<string | null>(null);
  const repositorySnapshots = useProjectRepositorySnapshots(host, project.repositories, true);
  const selectedCommitResult = repositorySnapshots.find(({ repository: candidate }) => candidate.id === selectedCommitRepositoryId) ?? null;
  const selectedCommitRepository = selectedCommitResult?.repository ?? repository;
  const commitDiffQuery = useProjectCommitDiffQuery(host, selectedCommitRepository, selectedCommitHash);
  const people = React.useMemo(() => [...new Set([repository.owner, ...repository.contributors,
    ...pullRequests.flatMap(pullRequest => [pullRequest.author, ...pullRequest.updates.map(update => update.author)])])], [pullRequests, repository]);
  const profiles = useProjectProfiles(people).data?.profiles;
  const selectedCommit = selectedCommitResult?.snapshot?.commits.find(commit => commit.hash === selectedCommitHash) ?? null;
  const selectedCommitPullRequest = selectedCommitHash && selectedCommitRepository.id === repository.id
    ? pullRequests.find(pullRequest => pullRequest.commit === selectedCommitHash || pullRequest.initialCommit === selectedCommitHash)
    : undefined;
  const detail = React.useMemo<ProjectHomeGitDetail | null>(() => selectedCommitHash ? {
    backLabel: t("projects.git.backCommits"),
    navigation: { commitHash: selectedCommitHash, repositoryId: selectedCommitRepository.id },
    onBack: () => { setSelectedCommitHash(null); setSelectedCommitRepositoryId(null); },
  } : null, [selectedCommitHash, selectedCommitRepository.id, t]);
  React.useEffect(() => { onDetailChange(detail); }, [detail, onDetailChange]);
  React.useEffect(() => () => onDetailChange(null), [onDetailChange]);

  return selectedCommitHash ? (
    <ProjectCommitDetailPanel project={selectedCommitRepository} commit={selectedCommit} commitHash={selectedCommitHash} diff={commitDiffQuery.data} diffError={commitDiffQuery.error}
      diffLoading={commitDiffQuery.isLoading} originAgentName={selectedCommitPullRequest?.originAgentName}
      originChannelId={selectedCommitPullRequest?.channelId} />
  ) : (
    <ProjectHomeCommitsPanel onSelectCommit={(commit, commitRepository) => {
      setSelectedCommitRepositoryId(commitRepository.id);
      setSelectedCommitHash(commit.hash);
    }} profiles={profiles} projectId={project.id} pullRequests={pullRequests} results={repositorySnapshots} />
  );
}

export function ProjectHomeFilesSheet({ host, project, repository, onDetailChange, onOpenCommit, onSelectRepository }: {
  host: ProjectsHost;
  project: Project;
  repository: Repository;
  onDetailChange: (detail: ProjectHomeGitDetail | null) => void;
  onOpenCommit?: (commitHash: string) => void;
  onSelectRepository: (repositoryId: string) => void;
}) {
  const t = useUiT();
  const [filesContext, setFilesContext] = React.useState<RepositoryFilesContext | null>(null);
  const detail = React.useMemo<ProjectHomeGitDetail | null>(() => filesContext?.onBack ? {
    backLabel: t("projects.git.backFiles"),
    navigation: { filePath: filesContext.path, repositoryId: repository.id },
    onBack: filesContext.onBack,
  } : null, [filesContext, repository.id, t]);
  React.useEffect(() => { onDetailChange(detail); }, [detail, onDetailChange]);
  React.useEffect(() => () => onDetailChange(null), [onDetailChange]);
  return <ProjectHomeCodebasePanel host={host} onFilesContextChange={setFilesContext} onOpenCommit={onOpenCommit}
    onSelectRepository={onSelectRepository} project={project} repository={repository} />;
}
