// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/
// hooks.ts::useProjectRepoSnapshotQuery/useProjectRepoDiffQuery, useProjectCommitDiff.ts and
// useProjectRepositorySnapshots.ts (remote source only). Same keys, ref semantics, retry and
// staleness; the repository is the 30617 coordinate and keys are scoped to the host session.
// The repo-state (30618) HEAD resolution has no governed read here, so the announced default
// branch is used, exactly as the original does when no repo state is published.
import { useQueries, useQuery } from "@tanstack/react-query";
import type { ProjectsHost } from "./projectEnumeration";
import type { Repository } from "./projectModels";
import type { ProjectPullRequest } from "./projectPullRequests.mjs";
import { projectTagTarget, type ProjectRepoSnapshot } from "./projectGit";

type PullRequestRef = Pick<ProjectPullRequest, "id" | "commit"> | null | undefined;

export function useProjectRepoSnapshotQuery(host: ProjectsHost, project: Repository | null | undefined,
  branchName?: string | null, pullRequest?: PullRequestRef, enabled = true, tag?: { name: string; commit: string } | null) {
  const selectedBranch = branchName ?? project?.defaultBranch ?? null;
  return useQuery({
    enabled: Boolean(enabled && host.git && project),
    queryKey: ["project", host.scopeKey, project?.id ?? "none", "repo-snapshot", selectedBranch ?? "default",
      pullRequest?.id ?? "none", pullRequest?.commit ?? "none", tag?.name ?? "no-tag", tag?.commit ?? "no-tag-commit"],
    queryFn: () => {
      if (!project || !host.git) throw new Error("No project selected.");
      return host.git.getProjectRepoSnapshot({
        repository: project.repoAddress,
        defaultBranch: selectedBranch ?? project.defaultBranch,
        baseBranch: project.defaultBranch,
        targetCommit: pullRequest?.commit ?? null,
        targetRef: pullRequest ? `refs/nostr/${pullRequest.id}` : null,
        ...(tag ? projectTagTarget(tag) : {}),
      });
    },
    staleTime: 30_000,
    retry: 1,
  });
}

/** Original review diff: `target...head` keyed on the review's target branch. */
export function useProjectRepoDiffQuery(host: ProjectsHost, project: Repository | null | undefined,
  branchName?: string | null, pullRequest?: PullRequestRef, enabled = true) {
  const selectedBranch = branchName ?? project?.defaultBranch ?? null;
  return useQuery({
    enabled: Boolean(enabled && host.git && project && pullRequest),
    queryKey: ["project", host.scopeKey, project?.id ?? "none", "repo-diff", selectedBranch ?? "default",
      pullRequest?.id ?? "none", pullRequest?.commit ?? "none"],
    queryFn: () => {
      if (!project || !host.git) throw new Error("No project selected.");
      return host.git.getProjectRepoDiff({
        repository: project.repoAddress,
        defaultBranch: selectedBranch ?? project.defaultBranch,
        baseBranch: project.defaultBranch,
        targetCommit: pullRequest?.commit ?? null,
        targetRef: pullRequest ? `refs/nostr/${pullRequest.id}` : null,
      });
    },
    staleTime: 30_000,
    retry: 1,
  });
}

/** Diff of a single commit against its parent, for the commit detail view. */
export function useProjectCommitDiffQuery(host: ProjectsHost, project: Repository | null | undefined, commitHash: string | null, source: "remote" | "local" = "remote") {
  return useQuery({
    enabled: Boolean(host.git && project && commitHash),
    queryKey: ["project", host.scopeKey, project?.id ?? "none", "commit-diff", source, commitHash ?? "none"],
    queryFn: () => {
      if (!project || !commitHash || !host.git) return Promise.reject(new Error("No commit selected."));
      if (source === "local") {
        const checkout = host.git.checkout;
        if (!checkout) return Promise.reject(new Error("Local checkout unavailable"));
        return checkout.getProjectLocalRepoDiff({ repository: project.repoAddress, targetCommit: commitHash }).then(diff => {
          if (!diff) throw new Error("Local checkout unavailable");
          return diff;
        });
      }
      // Passing only the target commit makes the backend diff it against its parent.
      return host.git.getProjectRepoDiff({ repository: project.repoAddress, defaultBranch: project.defaultBranch, targetCommit: commitHash });
    },
    // A commit's diff is immutable, so never refetch it while cached.
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });
}

export type ProjectRepositorySnapshotResult = {
  error: unknown;
  isLoading: boolean;
  repository: Repository;
  snapshot: ProjectRepoSnapshot | null;
};

/** Loads each project repository independently so one failure stays partial. */
export function useProjectRepositorySnapshots(host: ProjectsHost, repositories: Repository[], enabled = true): ProjectRepositorySnapshotResult[] {
  const queries = useQueries({
    queries: repositories.map(repository => ({
      enabled: Boolean(enabled && host.git),
      queryFn: () => {
        if (!host.git) throw new Error("Repository not found on the relay.");
        return host.git.getProjectRepoSnapshot({ repository: repository.repoAddress,
          baseBranch: repository.defaultBranch, defaultBranch: repository.defaultBranch });
      },
      queryKey: ["project", host.scopeKey, repository.id, "repo-snapshot", repository.defaultBranch,
        "none", "none", "no-tag", "no-tag-commit"],
      retry: 1,
      staleTime: 30_000,
    })),
  });
  return repositories.map((repository, index) => {
    const query = queries[index];
    return { error: query?.error, isLoading: query?.isLoading ?? false, repository, snapshot: query?.data ?? null };
  });
}
