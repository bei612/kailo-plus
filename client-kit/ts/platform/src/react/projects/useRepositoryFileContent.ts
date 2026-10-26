// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/
// useRepositoryFileContent.ts and useRepositoryFileContentSource.ts (remote source; no local
// checkout or tag picker in this host). The source names the 30617 coordinate, not a clone URL.
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { ProjectsHost } from "./projectEnumeration";
import type { ProjectRepoFile } from "./projectGit";
import type { Repository } from "./projectModels";
import type { ProjectPullRequest } from "./projectPullRequests.mjs";

export type RepositoryFileContentSource = {
  cacheKey: readonly unknown[];
  load: (path: string) => Promise<string | null>;
};

export function useRepositoryFileContent(file: ProjectRepoFile | null, source?: RepositoryFileContentSource) {
  const shouldLoad = Boolean(file && file.previewContent === null && source);
  const query = useQuery({
    enabled: shouldLoad,
    queryKey: ["project-repository-file-content", ...(source?.cacheKey ?? []), file?.path ?? "none"],
    queryFn: () => {
      if (!file || !source) return null;
      return source.load(file.path);
    },
    staleTime: 30_000,
    retry: 1,
  });

  return {
    content: file?.previewContent ?? query.data ?? null,
    error: query.error,
    isLoading: shouldLoad && query.isLoading,
  };
}

export function useRepositoryFileContentSource({ activeBranch, host, pullRequest, repository, source = "remote" }: {
  activeBranch: string | null;
  host: ProjectsHost;
  pullRequest: Pick<ProjectPullRequest, "id" | "commit"> | null;
  repository: Repository | null;
  source?: "remote" | "local";
}) {
  const git = host.git;
  return React.useMemo<RepositoryFileContentSource | undefined>(() => {
    if (!repository || !git) return undefined;
    if (source === "local") {
      const checkout = git.checkout;
      if (!checkout) return undefined;
      return {
        cacheKey: [host.scopeKey, repository.id, "local", activeBranch ?? "default"],
        load: path => checkout.getProjectLocalRepoFileContent({ repository: repository.repoAddress, path }),
      };
    }
    const targetRef = pullRequest ? `refs/nostr/${pullRequest.id}` : null;
    const targetCommit = pullRequest?.commit ?? null;
    return {
      cacheKey: [host.scopeKey, repository.id, "remote", activeBranch ?? "default", targetRef ?? "default", targetCommit ?? "default"],
      load: path => git.getProjectRepoFileContent({
        repository: repository.repoAddress,
        defaultBranch: activeBranch ?? repository.defaultBranch,
        targetRef,
        targetCommit,
        path,
      }),
    };
  }, [activeBranch, git, host.scopeKey, pullRequest, repository, source]);
}
