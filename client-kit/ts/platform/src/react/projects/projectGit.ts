// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/shared/api/projectGit.ts::getProjectRepoSnapshot/getProjectRepoFileContent/getProjectRepoDiff
// and desktop/src/shared/api/types.ts::ProjectRepo*. DD-118: the repository is named by its 30617
// coordinate instead of a clone URL; the host maps the typed BFF query back to the original shapes
// (absent latestCommit -> null) so restored components keep the original types.
// createProjectRemoteBranch/deleteProjectRemoteBranch (original input names, 30617 coordinate instead
// of cloneUrl) travel as the typed ProjectsGitRefRequest with the intent's Idempotency-Key.
// mergeProjectPullRequest keeps the original input names without the clone URLs, the 1631 signing
// metadata (targetOwner/pullRequestAuthor/statusCreatedAt: Core reads them from the coordinate and
// the 1618 and publishes the owner-signed status) and travels as the typed ProjectsGitMergeRequest.
import {
  ProjectGitRefOperation,
  ProjectsGitQueryRequestView,
  type ProjectsGitMergeRequest,
  type ProjectsGitMergeResponse,
  type ProjectsGitQueryRequest,
  type ProjectsGitQueryResponse,
  type ProjectsGitRefRequest,
  type ProjectsGitRefResponse,
  type ProjectRepoCommit as ContractRepoCommit,
} from "@client-kit/contracts";
import { TransportError } from "../../transport";

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

/** Original ProjectRepoBranchResult without its English message: the branch and its head. */
export type ProjectRepoBranchResult = { branch: string; commit: string };

/** Original createProjectRemoteBranch input with `cloneUrl` replaced by the 30617 coordinate. */
export type CreateProjectRemoteBranchInput = { repository: string; sourceBranch: string; expectedCommit: string; newBranch: string };

/** Original deleteProjectRemoteBranch input with `cloneUrl` replaced by the 30617 coordinate. */
export type DeleteProjectRemoteBranchInput = { repository: string; branch: string; expectedCommit: string };

/**
 * Original mergeProjectPullRequest input without clone URLs and 1631 signing metadata; `repoAddress`
 * is the 30617 coordinate whose owner merges.
 */
export type MergeProjectPullRequestInput = {
  repoAddress: string;
  pullRequestId: string;
  targetBranch: string;
  sourceBranch: string;
  expectedCommit: string;
};

/**
 * Original ProjectRepoMergeResult without its English message and client-signed status event:
 * `statusEventId` is the owner-signed 1631 once Core's publication of it was accepted.
 */
export type ProjectRepoMergeResult = { mergeCommit: string; statusEventId: string | null };

/** Remote repository reads of the original Desktop, behind the Projects host seam. */
export type ProjectsGitHost = {
  getProjectRepoSnapshot: (input: ProjectRepoRefInput) => Promise<ProjectRepoSnapshot>;
  getProjectRepoFileContent: (input: Omit<ProjectRepoRefInput, "baseBranch"> & { path: string }) => Promise<string | null>;
  getProjectRepoDiff: (input: ProjectRepoRefInput) => Promise<ProjectRepoDiff>;
  /**
   * DD-118 branch writes; hosts without them offer no branch actions. `idempotencyKey` is the
   * retained intent's key: an UNKNOWN outcome is resent only with the same key and request.
   */
  createProjectRemoteBranch?: (input: CreateProjectRemoteBranchInput, idempotencyKey: string) => Promise<ProjectRepoBranchResult>;
  deleteProjectRemoteBranch?: (input: DeleteProjectRemoteBranchInput, idempotencyKey: string) => Promise<ProjectRepoBranchResult>;
  /**
   * DD-118 review merge by the repository owner's own SERVER identity; hosts without it offer no
   * Merge. Same retained-intent rule as the branch writes.
   */
  mergeProjectPullRequest?: (input: MergeProjectPullRequestInput, idempotencyKey: string) => Promise<ProjectRepoMergeResult>;
};

const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const EVENT_ID = /^[0-9a-f]{64}$/;

/** The typed merge request for an original merge input. */
export function projectGitMergeRequest(input: MergeProjectPullRequestInput): ProjectsGitMergeRequest {
  return { repository: input.repoAddress, pullRequestEventId: input.pullRequestId, targetBranch: input.targetBranch,
    sourceBranch: input.sourceBranch, expectedCommit: input.expectedCommit };
}

function mergeAnswer(response: ProjectsGitMergeResponse): ProjectRepoMergeResult {
  // A 2xx without a merge commit (or with a malformed status id) is no confirmation.
  const statusEventId: unknown = response?.statusEventId ?? null;
  if (!response || typeof response.mergeCommit !== "string" || !COMMIT.test(response.mergeCommit)
    || statusEventId !== null && (typeof statusEventId !== "string" || !EVENT_ID.test(statusEventId)))
    throw new TransportError("Invalid repository merge response");
  return { mergeCommit: response.mergeCommit, statusEventId: statusEventId as string | null };
}

/** The typed ref request for an original branch input. */
export function projectGitRefRequest(input: CreateProjectRemoteBranchInput | DeleteProjectRemoteBranchInput): ProjectsGitRefRequest {
  return "newBranch" in input
    ? { operation: ProjectGitRefOperation.CreateBranch, repository: input.repository, branch: input.newBranch,
      sourceBranch: input.sourceBranch, expectedCommit: input.expectedCommit }
    : { operation: ProjectGitRefOperation.DeleteBranch, repository: input.repository, branch: input.branch,
      expectedCommit: input.expectedCommit };
}

function refAnswer(response: ProjectsGitRefResponse, request: ProjectsGitRefRequest): ProjectRepoBranchResult {
  // Both operations answer the requested branch at the observed head; anything else is no confirmation.
  if (!response || response.branch !== request.branch || response.commit !== request.expectedCommit)
    throw new TransportError("Invalid repository ref response");
  return { branch: response.branch, commit: response.commit };
}

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

type ProjectsGitRefSend = (request: ProjectsGitRefRequest, idempotencyKey: string) => Promise<ProjectsGitRefResponse>;
type ProjectsGitMergeSend = (request: ProjectsGitMergeRequest, idempotencyKey: string) => Promise<ProjectsGitMergeResponse>;

function refWriter(ref: ProjectsGitRefSend) {
  return async (input: CreateProjectRemoteBranchInput | DeleteProjectRemoteBranchInput, idempotencyKey: string) => {
    const request = projectGitRefRequest(input);
    return refAnswer(await ref(request, idempotencyKey), request);
  };
}

/** Adapt the typed BFF query (and, when given, the ref and merge writes) to the original Desktop calls. */
export function createProjectsGitHost(query: (request: ProjectsGitQueryRequest) => Promise<ProjectsGitQueryResponse>,
  ref?: ProjectsGitRefSend, merge?: ProjectsGitMergeSend): ProjectsGitHost {
  const write = ref ? refWriter(ref) : undefined;
  return {
    ...(write ? { createProjectRemoteBranch: write, deleteProjectRemoteBranch: write } : {}),
    ...(merge ? { mergeProjectPullRequest: async (input: MergeProjectPullRequestInput, idempotencyKey: string) =>
      mergeAnswer(await merge(projectGitMergeRequest(input), idempotencyKey)) } : {}),
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

/** Desktop's admitted Relay and device signer; every native read is refused for another scope. */
export type NativeProjectsGitScope = { expectedRelayUrl: string; expectedSignerPubkey: string };

/** The Desktop command invoker (Tauri `invoke`); kept abstract so the mapping is testable. */
export type NativeProjectsGitInvoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;

type RawCommit = { hash: string; short_hash: string; author_name: string; author_email: string; timestamp: number; subject: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rawCommit(value: unknown): ProjectRepoCommit | null {
  if (value === null || value === undefined) return null;
  const raw = value as RawCommit;
  if (!isRecord(value) || typeof raw.hash !== "string" || typeof raw.short_hash !== "string"
    || typeof raw.author_name !== "string" || typeof raw.author_email !== "string"
    || typeof raw.timestamp !== "number" || typeof raw.subject !== "string") throw new Error("Invalid repository commit");
  return { hash: raw.hash, shortHash: raw.short_hash, authorName: raw.author_name, authorEmail: raw.author_email,
    timestamp: raw.timestamp, subject: raw.subject };
}

const nullableNumber = (value: unknown) => typeof value === "number" ? value : null;
const nullableString = (value: unknown) => typeof value === "string" ? value : null;

function refArgs(input: ProjectRepoRefInput, scope: NativeProjectsGitScope) {
  return { repository: input.repository, defaultBranch: input.defaultBranch ?? null, baseBranch: input.baseBranch ?? null,
    targetRef: input.targetRef ?? null, targetCommit: input.targetCommit ?? null, ...scope };
}

/**
 * DD-160: the original Desktop `get_project_repo_*` commands behind the Projects host seam. The
 * native side names the repository only by its 30617 coordinate, signs NIP-98 in process with the
 * device key and answers the original raw snake_case shapes, mapped back here exactly like the
 * original `fromRawProjectRepoSnapshot`. A response of another shape is never rendered. The
 * native host has no branch or merge writes yet, so the views offer none (DD-160(2) is pending).
 */
export function createNativeProjectsGitHost(invoke: NativeProjectsGitInvoke, scope: NativeProjectsGitScope): ProjectsGitHost {
  return {
    getProjectRepoSnapshot: async input => {
      const raw = await invoke("get_project_repo_snapshot", refArgs(input, scope));
      if (!isRecord(raw) || !Array.isArray(raw.files) || !Array.isArray(raw.commits) || !Array.isArray(raw.contributors))
        throw new Error("Invalid repository snapshot");
      return {
        latestCommit: rawCommit(raw.latest_commit),
        commits: raw.commits.map(value => {
          const commit = rawCommit(value);
          if (!commit) throw new Error("Invalid repository commit");
          return commit;
        }),
        files: raw.files.map(value => {
          if (!isRecord(value) || typeof value.path !== "string" || typeof value.kind !== "string") throw new Error("Invalid repository file");
          return { path: value.path, kind: value.kind, size: nullableNumber(value.size), previewContent: nullableString(value.preview_content),
            lastChangedAt: nullableNumber(value.last_changed_at), latestCommit: rawCommit(value.latest_commit) };
        }),
        contributors: raw.contributors.map(value => {
          if (!isRecord(value) || typeof value.name !== "string" || typeof value.email !== "string"
            || typeof value.commit_count !== "number" || typeof value.last_commit_at !== "number") throw new Error("Invalid repository contributor");
          return { name: value.name, email: value.email, commitCount: value.commit_count, lastCommitAt: value.last_commit_at };
        }),
      };
    },
    getProjectRepoFileContent: async input => {
      const content = await invoke("get_project_repo_file_content", { repository: input.repository,
        defaultBranch: input.defaultBranch ?? null, targetRef: input.targetRef ?? null,
        targetCommit: input.targetCommit ?? null, path: input.path, ...scope });
      if (content !== null && typeof content !== "string") throw new Error("Invalid repository file content");
      return content;
    },
    getProjectRepoDiff: async input => {
      const raw = await invoke("get_project_repo_diff", refArgs(input, scope));
      if (!isRecord(raw) || !Array.isArray(raw.files) || typeof raw.additions !== "number" || typeof raw.deletions !== "number")
        throw new Error("Invalid repository diff");
      return {
        additions: raw.additions, deletions: raw.deletions, commitBody: nullableString(raw.commit_body),
        files: raw.files.map(value => {
          if (!isRecord(value) || typeof value.path !== "string" || typeof value.additions !== "number"
            || typeof value.deletions !== "number" || typeof value.patch !== "string" || typeof value.truncated !== "boolean")
            throw new Error("Invalid repository diff file");
          return { path: value.path, additions: value.additions, deletions: value.deletions, patch: value.patch, truncated: value.truncated };
        }),
      };
    },
  };
}
