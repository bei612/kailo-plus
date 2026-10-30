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
  ErrorClass,
  ReasonCode,
  ProjectsGitQueryRequestView,
  type ProjectsGitMergeRequest,
  type ProjectsGitMergeResponse,
  type ProjectsGitQueryRequest,
  type ProjectsGitQueryResponse,
  type ProjectsGitRefRequest,
  type ProjectsGitRefResponse,
  type ProjectRepoCommit as ContractRepoCommit,
} from "@client-kit/contracts";
import { BffError, TransportError } from "../../transport";

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

/** Original 30618 tag selection, bounded by ProjectsGitQueryRequest and the shared git ref reader.
 * Reject malformed published refs instead of letting clean_target_ref drop them and read HEAD.
 */
export function projectTagTarget(tag: { name: string; commit: string }) {
  const name = tag.name;
  const targetRef = `refs/tags/${name}`;
  if (!name || name.trim() !== name || name.startsWith("-") || name.startsWith("/") || name.endsWith("/")
    || name.startsWith("refs/heads/") || name.includes("..") || !/^[A-Za-z0-9/_.-]+$/.test(name)
    || targetRef.length > 255 || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(tag.commit))
    throw new Error("Invalid repository tag");
  return { targetRef, targetCommit: tag.commit };
}

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
  /** DD-160: offered by Desktop only, using the same shared Projects pages. */
  checkout?: ProjectsCheckoutHost;
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
 * native host exposes the original branch and owner-merge commands (DD-160(2)).
 */
function decodeNativeProjectRepoSnapshot(raw: unknown): ProjectRepoSnapshot {
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
}

function decodeNativeProjectRepoDiff(raw: unknown): ProjectRepoDiff {
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
}

export type ProjectPendingPush = {
  branch: string; oldCommit: string | null; newCommit: string;
  outcome: "retry_same_intent" | "unknown" | "conflict";
};
export type ProjectRepoSyncStatus = {
  localPath: string | null; localBranch: string | null; localBranches: string[];
  localHead: string | null; remoteBranch: string | null; remoteHead: string | null; mergeBase?: string | null;
  aheadCount: number; behindCount: number; hasUncommittedChanges: boolean; hasUntrackedFiles: boolean;
  canPush: boolean; canPull: boolean; pushBlockReason: string | null; pullBlockReason: string | null;
  pendingPush: ProjectPendingPush | null;
};
type CheckoutRef = Pick<ProjectRepoRefInput, "repository" | "defaultBranch" | "baseBranch">;
type CheckoutBranch = { repository: string; branchName?: string | null; baseBranch?: string | null };

/** The original Desktop local Git operations; paths and credentials remain native-owned. */
export type ProjectsCheckoutHost = {
  cloneProjectRepository(input: CheckoutRef): Promise<{ path: string; cloned: boolean }>;
  getProjectRepoSyncStatus(input: CheckoutBranch): Promise<ProjectRepoSyncStatus | null>;
  pushProjectLocalRepository(input: CheckoutBranch): Promise<{ branch: string; commit: string; mergeBase?: string | null }>;
  pullProjectLocalRepository(input: CheckoutBranch): Promise<void>;
  getProjectLocalRepoSnapshot(input: CheckoutRef): Promise<{ path: string; snapshot: ProjectRepoSnapshot } | null>;
  getProjectLocalRepoDiff(input: CheckoutRef & { baseCommit?: string | null; targetCommit?: string | null }): Promise<ProjectRepoDiff | null>;
  getProjectLocalRepoFileContent(input: { repository: string; path: string }): Promise<string | null>;
  openProjectRepositoryFolder(input: { repository: string }): Promise<void>;
  /** DD-161: the original "Open in Terminal" at the scoped checkout (OS terminal, no credentials). */
  openProjectTerminal?(input: { repository: string }): Promise<void>;
  /**
   * DD-161: the original "Resolve in Terminal" for a conflicting review. Native fetches the target
   * and the exact reviewed commit into recovery refs, then opens the OS terminal at the checkout.
   */
  openProjectMergeRecoveryTerminal?(input: ProjectMergeRecoveryInput): Promise<ProjectMergeRecoveryRefs>;
};

export type ProjectMergeRecoveryInput = { repository: string; targetBranch: string; sourceBranch: string; expectedCommit: string };
export type ProjectMergeRecoveryRefs = { recoveryRef: string; targetRef: string };

/** Accept only the original recovery namespaces, pinned to the reviewed commit. */
export function decodeMergeRecoveryRefs(raw: unknown, expectedCommit: string): ProjectMergeRecoveryRefs {
  const commit = expectedCommit.trim().toLowerCase();
  if (!isRecord(raw) || typeof raw.recoveryRef !== "string" || typeof raw.targetRef !== "string"
    || raw.recoveryRef !== `refs/buzz/merge-recovery/${commit}`
    || !/^refs\/buzz\/merge-recovery-target\/(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(raw.targetRef))
    throw new TransportError("Invalid merge recovery response");
  return { recoveryRef: raw.recoveryRef, targetRef: raw.targetRef };
}

function localStatus(raw: unknown): ProjectRepoSyncStatus | null {
  if (raw === null) return null;
  if (!isRecord(raw) || !Array.isArray(raw.local_branches) || !raw.local_branches.every(v => typeof v === "string")
    || ![raw.ahead_count, raw.behind_count].every(v => typeof v === "number" && Number.isSafeInteger(v) && v >= 0)
    || ![raw.can_push, raw.can_pull, raw.has_uncommitted_changes, raw.has_untracked_files].every(v => typeof v === "boolean"))
    throw new TransportError("Invalid local repository status");
  if (raw.merge_base != null && (typeof raw.merge_base !== "string" || !COMMIT.test(raw.merge_base))) throw new TransportError("Invalid sync merge base");
  let pendingPush: ProjectPendingPush | null = null;
  if (raw.pending_push !== null && raw.pending_push !== undefined) {
    const pending = raw.pending_push;
    if (!isRecord(pending) || typeof pending.branch !== "string" || typeof pending.new_commit !== "string" || !COMMIT.test(pending.new_commit)
      || pending.old_commit !== null && (typeof pending.old_commit !== "string" || !COMMIT.test(pending.old_commit))
      || !["retry_same_intent", "unknown", "conflict"].includes(String(pending.outcome))) throw new TransportError("Invalid pending repository push");
    if (raw.can_pull || raw.can_push && pending.outcome !== "retry_same_intent")
      throw new TransportError("Inconsistent pending repository push");
    pendingPush = { branch: pending.branch, oldCommit: pending.old_commit as string | null,
      newCommit: pending.new_commit, outcome: pending.outcome as ProjectPendingPush["outcome"] };
  }
  return { localPath: nullableString(raw.local_path), localBranch: nullableString(raw.local_branch),
    localBranches: raw.local_branches as string[], localHead: nullableString(raw.local_head), remoteBranch: nullableString(raw.remote_branch),
    remoteHead: nullableString(raw.remote_head), mergeBase: nullableString(raw.merge_base), aheadCount: raw.ahead_count as number, behindCount: raw.behind_count as number,
    hasUncommittedChanges: raw.has_uncommitted_changes as boolean, hasUntrackedFiles: raw.has_untracked_files as boolean,
    canPush: raw.can_push as boolean, canPull: raw.can_pull as boolean,
    pushBlockReason: nullableString(raw.push_block_reason), pullBlockReason: nullableString(raw.pull_block_reason), pendingPush };
}

export function createNativeProjectsGitHost(invoke: NativeProjectsGitInvoke, scope: NativeProjectsGitScope): ProjectsGitHost {
  const send = async (command: string, args: Record<string, unknown>) => {
    try { return await invoke(command, { ...args, ...scope }); }
    catch (error) {
      if (isRecord(error) && typeof error.code === "string") {
        const operationId = typeof error.operationId === "string" ? error.operationId : undefined;
        const reasons: Record<string, [number, ErrorClass, ReasonCode]> = {
          PUBLISH_RESULT_UNKNOWN: [202, ErrorClass.Unknown, ReasonCode.PublishResultUnknown],
          TARGET_STATE_CONFLICT: [409, ErrorClass.Conflict, ReasonCode.TargetStateConflict],
          TARGET_NOT_FOUND: [404, ErrorClass.Denied, ReasonCode.TargetNotFound],
          PUBLISH_REJECTED: [403, ErrorClass.Denied, ReasonCode.PublishRejected],
          PAYLOAD_TOO_LARGE: [413, ErrorClass.Limit, ReasonCode.PayloadTooLarge],
          PERMISSION_DENIED: [403, ErrorClass.Denied, ReasonCode.PermissionDenied],
          DEPENDENCY_UNAVAILABLE: [503, ErrorClass.Precondition, ReasonCode.DependencyUnavailable],
          IDEMPOTENCY_KEY_REUSED: [409, ErrorClass.Conflict, ReasonCode.IdempotencyKeyReused],
        };
        const mapped = reasons[error.code];
        if (mapped) throw new BffError(mapped[0], error.code, { class: mapped[1], reason: mapped[2], operationId });
        // A typed refusal before dispatch is safe to report; unstructured IPC
        // loss below still keeps the original retained request.
        if (error.code === "INVALID_REQUEST") throw new BffError(400, error.code);
      }
      const code = typeof error === "string" ? error : error instanceof Error ? error.message : isRecord(error) && typeof error.code === "string" ? error.code : "";
      if (code === "project_repo_not_found") throw new BffError(404, code, { class: ErrorClass.Denied, reason: ReasonCode.TargetNotFound });
      if (code === "project_repo_unavailable" || code === "project_repo_timeout")
        throw new BffError(503, code, { class: ErrorClass.Precondition, reason: ReasonCode.DependencyUnavailable });
      if (code === "project_repo_conflict") throw new BffError(409, code, { class: ErrorClass.Conflict, reason: ReasonCode.TargetStateConflict });
      // Unrecognized native failures and lost replies are never a definitive write rejection.
      throw new TransportError(code === "project_repo_outcome_unknown" ? code : "project_repo_unavailable");
    }
  };
  const localRef = (input: CheckoutRef) => ({ repository: input.repository,
    defaultBranch: input.defaultBranch ?? null, baseBranch: input.baseBranch ?? null });
  const localBranch = (input: CheckoutBranch) => ({ repository: input.repository,
    branchName: input.branchName ?? null, baseBranch: input.baseBranch ?? null });
  const writeRef = async (command: string, input: CreateProjectRemoteBranchInput | DeleteProjectRemoteBranchInput, idempotencyKey: string) => {
    const request = projectGitRefRequest(input);
    const raw = await send(command, { input: request, idempotencyKey });
    if (!isRecord(raw) || typeof raw.branch !== "string" || typeof raw.commit !== "string") throw new TransportError("Invalid repository ref response");
    return refAnswer({ branch: raw.branch, commit: raw.commit }, request);
  };
  return {
    createProjectRemoteBranch: (input, key) => writeRef("create_project_remote_branch", input, key),
    deleteProjectRemoteBranch: (input, key) => writeRef("delete_project_remote_branch", input, key),
    mergeProjectPullRequest: async (input, idempotencyKey) => {
      if (input.repoAddress.split(":")[1] !== scope.expectedSignerPubkey)
        throw new BffError(403, "PERMISSION_DENIED", { class: ErrorClass.Denied, reason: ReasonCode.PermissionDenied });
      const raw = await send("merge_project_pull_request", { idempotencyKey, input: {
        operation: "MERGE", repository: input.repoAddress, branch: input.targetBranch, sourceBranch: input.sourceBranch,
        expectedCommit: input.expectedCommit, pullRequestEventId: input.pullRequestId,
      } });
      if (!isRecord(raw) || typeof raw.mergeCommit !== "string" || !(raw.statusEventId === null || typeof raw.statusEventId === "string"))
        throw new TransportError("Invalid repository merge response");
      return mergeAnswer({ mergeCommit: raw.mergeCommit, ...(raw.statusEventId === null ? {} : { statusEventId: raw.statusEventId }) });
    },
    getProjectRepoSnapshot: async input => decodeNativeProjectRepoSnapshot(await send("get_project_repo_snapshot", refArgs(input, scope))),
    getProjectRepoFileContent: async input => {
      const content = await send("get_project_repo_file_content", { repository: input.repository,
        defaultBranch: input.defaultBranch ?? null, targetRef: input.targetRef ?? null, targetCommit: input.targetCommit ?? null, path: input.path });
      if (content !== null && typeof content !== "string") throw new Error("Invalid repository file content");
      return content;
    },
    getProjectRepoDiff: async input => decodeNativeProjectRepoDiff(await send("get_project_repo_diff", refArgs(input, scope))),
    checkout: {
      cloneProjectRepository: async input => {
        const raw = await send("clone_project_repository", localRef(input));
        if (!isRecord(raw) || typeof raw.path !== "string" || typeof raw.cloned !== "boolean") throw new TransportError("Invalid clone response");
        return { path: raw.path, cloned: raw.cloned };
      },
      getProjectRepoSyncStatus: async input => localStatus(await send("get_project_repo_sync_status", localBranch(input))),
      pushProjectLocalRepository: async input => {
        const raw = await send("push_project_local_repository", localBranch(input));
        if (!isRecord(raw) || raw.pushed !== true || typeof raw.branch !== "string" || typeof raw.commit !== "string" || !COMMIT.test(raw.commit)
          || input.branchName != null && raw.branch !== input.branchName)
          throw new TransportError("Unconfirmed repository push");
        if (raw.merge_base != null && (typeof raw.merge_base !== "string" || !COMMIT.test(raw.merge_base))) throw new TransportError("Invalid push merge base");
        return { branch: raw.branch, commit: raw.commit, mergeBase: nullableString(raw.merge_base) };
      },
      pullProjectLocalRepository: async input => {
        const raw = await send("pull_project_local_repository", { repository: input.repository, branchName: input.branchName ?? null });
        if (!isRecord(raw) || raw.pulled !== true) throw new TransportError("Unconfirmed repository pull");
      },
      getProjectLocalRepoSnapshot: async input => {
        const raw = await send("get_project_local_repo_snapshot", localRef(input));
        if (raw === null) return null;
        if (!isRecord(raw) || typeof raw.path !== "string") throw new TransportError("Invalid local repository snapshot");
        return { path: raw.path, snapshot: decodeNativeProjectRepoSnapshot(raw.snapshot) };
      },
      getProjectLocalRepoDiff: async input => {
        const raw = await send("get_project_local_repo_diff", { ...localRef(input), baseCommit: input.baseCommit ?? null, targetCommit: input.targetCommit ?? null });
        return raw === null ? null : decodeNativeProjectRepoDiff(raw);
      },
      getProjectLocalRepoFileContent: async input => {
        const raw = await send("get_project_local_repo_file_content", { repository: input.repository, path: input.path });
        if (raw !== null && typeof raw !== "string") throw new TransportError("Invalid local repository content");
        return raw;
      },
      openProjectRepositoryFolder: async input => { await send("open_project_repository_folder", { repository: input.repository }); },
      openProjectTerminal: async input => { await send("open_project_terminal", { repository: input.repository }); },
      openProjectMergeRecoveryTerminal: async input => decodeMergeRecoveryRefs(await send("open_project_merge_recovery_terminal", {
        repository: input.repository, targetBranch: input.targetBranch, sourceBranch: input.sourceBranch, expectedCommit: input.expectedCommit,
      }), input.expectedCommit),
    },
  };
}
