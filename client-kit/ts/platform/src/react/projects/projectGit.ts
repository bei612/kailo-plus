// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/shared/api/projectGit.ts::getProjectRepoSnapshot/getProjectRepoFileContent/getProjectRepoDiff
// and desktop/src/shared/api/types.ts::ProjectRepo*. DD-118: the repository is named by its 30617
// coordinate instead of a clone URL; the host maps the typed BFF query back to the original shapes
// (absent latestCommit -> null) so restored components keep the original types.
import {
  ProjectsGitQueryRequestView,
  type ProjectsGitQueryRequest,
  type ProjectsGitQueryResponse,
  type ProjectRepoCommit as ContractRepoCommit,
} from "@client-kit/contracts";

export type ProjectRepoCommit = {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  timestamp: number;
  subject: string;
};

export type ProjectRepoFile = {
  path: string;
  kind: string;
  size: number | null;
  previewContent: string | null;
  lastChangedAt: number | null;
  latestCommit: ProjectRepoCommit | null;
};

export type ProjectRepoContributor = {
  name: string;
  email: string;
  commitCount: number;
  lastCommitAt: number;
};

export type ProjectRepoSnapshot = {
  latestCommit: ProjectRepoCommit | null;
  commits: ProjectRepoCommit[];
  files: ProjectRepoFile[];
  contributors: ProjectRepoContributor[];
};

export type ProjectRepoDiffFile = {
  path: string;
  additions: number;
  deletions: number;
  patch: string;
  truncated: boolean;
};

export type ProjectRepoDiff = {
  files: ProjectRepoDiffFile[];
  additions: number;
  deletions: number;
  commitBody: string | null;
};

/** Original input with `cloneUrl` replaced by the repository's 30617 coordinate. */
export type ProjectRepoRefInput = {
  repository: string;
  defaultBranch?: string | null;
  baseBranch?: string | null;
  targetRef?: string | null;
  targetCommit?: string | null;
};

/** Remote repository reads of the original Desktop, behind the Projects host seam. */
export type ProjectsGitHost = {
  getProjectRepoSnapshot: (input: ProjectRepoRefInput) => Promise<ProjectRepoSnapshot>;
  getProjectRepoFileContent: (input: Omit<ProjectRepoRefInput, "baseBranch"> & { path: string }) => Promise<string | null>;
  getProjectRepoDiff: (input: ProjectRepoRefInput) => Promise<ProjectRepoDiff>;
};

function request(view: ProjectsGitQueryRequestView, input: ProjectRepoRefInput & { path?: string }): ProjectsGitQueryRequest {
  const body: ProjectsGitQueryRequest = { view, repository: input.repository };
  if (input.defaultBranch) body.defaultBranch = input.defaultBranch;
  if (input.baseBranch) body.baseBranch = input.baseBranch;
  if (input.targetRef) body.targetRef = input.targetRef;
  if (input.targetCommit) body.targetCommit = input.targetCommit;
  if (input.path !== undefined) body.path = input.path;
  return body;
}

function commit(value: ContractRepoCommit | undefined): ProjectRepoCommit | null {
  return value ? { hash: value.hash, shortHash: value.shortHash, authorName: value.authorName,
    authorEmail: value.authorEmail, timestamp: value.timestamp, subject: value.subject } : null;
}

function answer(response: ProjectsGitQueryResponse, view: ProjectsGitQueryRequestView) {
  // A response for another view is never rendered as this view's content.
  if (!response || response.view !== view) throw new Error("Invalid repository response");
  return response;
}

/** Adapt the typed BFF query to the original three Desktop reads. */
export function createProjectsGitHost(query: (request: ProjectsGitQueryRequest) => Promise<ProjectsGitQueryResponse>): ProjectsGitHost {
  return {
    getProjectRepoSnapshot: async input => {
      const snapshot = answer(await query(request(ProjectsGitQueryRequestView.Snapshot, input)), ProjectsGitQueryRequestView.Snapshot).snapshot;
      if (!snapshot || !Array.isArray(snapshot.files)) throw new Error("Invalid repository snapshot");
      return {
        latestCommit: commit(snapshot.latestCommit),
        commits: (snapshot.commits ?? []).map(value => commit(value)!),
        files: snapshot.files.map(file => ({ path: file.path, kind: file.kind, size: file.size,
          previewContent: file.previewContent, lastChangedAt: file.lastChangedAt, latestCommit: commit(file.latestCommit) })),
        contributors: (snapshot.contributors ?? []).map(contributor => ({ name: contributor.name, email: contributor.email,
          commitCount: contributor.commitCount, lastCommitAt: contributor.lastCommitAt })),
      };
    },
    getProjectRepoFileContent: async input =>
      answer(await query(request(ProjectsGitQueryRequestView.FileContent, input)), ProjectsGitQueryRequestView.FileContent).content ?? null,
    getProjectRepoDiff: async input => {
      const diff = answer(await query(request(ProjectsGitQueryRequestView.Diff, input)), ProjectsGitQueryRequestView.Diff).diff;
      if (!diff || !Array.isArray(diff.files)) throw new Error("Invalid repository diff");
      return { additions: diff.additions, deletions: diff.deletions, commitBody: diff.commitBody,
        files: diff.files.map(file => ({ path: file.path, additions: file.additions, deletions: file.deletions,
          patch: file.patch, truncated: file.truncated })) };
    },
  };
}
