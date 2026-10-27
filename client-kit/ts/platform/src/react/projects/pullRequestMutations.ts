// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/pullRequestMutations.ts::publishProjectPullRequest and
// useMergeProjectPullRequestMutation (updates live in pullRequestUpdates.ts), with
// desktop/src/shared/api/projectGit.ts::ProjectPullRequestMergeError/parseProjectPullRequestMergeError.
// DD-118: the original kind-1618 review is published as CREATE_PULL_REQUEST through the governed
// Projects publication host, with the same retained-intent rule as the other publications: an
// UNKNOWN outcome keeps the exact intent and a retry only re-sends (observes) that intent under its
// original Idempotency-Key. Merge is the repository owner's governed git write through the Projects
// Git host: one typed merge intent per review is retained before sending, a definite answer settles
// it, an UNKNOWN outcome keeps it and only that exact request is resent with the same key. The
// shared path has no terminal conflict recovery (Desktop-only), so a conflict carries no recovery.
import { hashPayload } from "nostr-tools/nip98";
import { ProjectPublicationOperation, ReasonCode, type ProjectsGitMergeRequest, type ProjectsPublishRequest } from "@client-kit/contracts";
import { newIdempotencyKey } from "../../governance";
import { translateCurrent as t } from "../../i18n";
import { BffError, TransportError, writeFailure } from "../../transport";
import { isProjectBranchOutcomeUnknown } from "./lib/projectBranchErrors";
import { loadProjectDirectory, type ProjectsHost } from "./projectEnumeration";
import { projectGitMergeRequest, type ProjectRepoMergeResult } from "./projectGit";
import type { Repository } from "./projectModels";
import type { ProjectPullRequest } from "./projectPullRequests.mjs";
import { loadProjectWorkItems } from "./projectWorkItems";

export type CreateProjectPullRequestInput = {
  title: string;
  body: string;
  branch: string;
  targetBranch: string;
  commit: string;
  mergeBase: string | null;
  reviewers: string[];
};

type Intent = { key: string; digest: string; targetEventId: string; eventId?: string; acceptedEventId?: string };
const eventId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const unknown = () => new TransportError(t("projects.review.unknown"));
function recover<T>(action: () => T): T { try { return action(); } catch { throw unknown(); } }
const intentSlot = (host: ProjectsHost, projectId: string, repository: Pick<Repository, "repoAddress">) =>
  JSON.stringify(["project-pull-request-publication", host.scopeKey, projectId, repository.repoAddress]);

/** Original 1618 validation before signing, with the shared catalog's copy. */
function validate(input: CreateProjectPullRequestInput) {
  const title = input.title.trim();
  if (!title || title.length > 256 || input.branch === input.targetBranch || !input.branch || !input.targetBranch
    || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(input.commit)) throw new Error(t("projects.review.createFailed"));
  return title;
}

export async function publishProjectPullRequest(host: ProjectsHost, projectId: string, repository: Repository,
  input: CreateProjectPullRequestInput, signal: AbortSignal) {
  if (!host.publish) throw new Error(t("projects.review.createFailed"));
  signal.throwIfAborted();
  const title = validate(input), body = input.body.trim();
  const mergeBase = input.mergeBase ?? undefined;
  const reviewers = [...new Set(input.reviewers.map(key => key.toLowerCase()))];
  const slot = intentSlot(host, projectId, repository);
  const digest = hashPayload([repository.repoAddress, title, body, input.branch, input.targetBranch, input.commit, mergeBase ?? null, reviewers]);
  const stored = recover(() => localStorage.getItem(slot));
  const previous: Intent | null = stored === null ? null : recover(() => JSON.parse(stored));
  if (stored !== null && (!previous || typeof previous.key !== "string" || !/^[0-9a-f-]{36}$/.test(previous.key) || previous.digest !== digest
    || !eventId(previous.targetEventId) || previous.eventId !== undefined && !eventId(previous.eventId)
    || previous.acceptedEventId !== undefined && !eventId(previous.acceptedEventId)
    || previous.eventId && previous.acceptedEventId && previous.eventId !== previous.acceptedEventId))
    throw unknown();
  // Re-read the project/repository relationship; a selected option is no grant.
  const directory = await loadProjectDirectory(host, signal).catch(error => { if (stored !== null) throw unknown(); throw error; });
  const current = directory.projects.find(project => project.id === projectId)?.repositories.find(repo => repo.repoAddress === repository.repoAddress);
  if (!current) throw new TransportError("Project repository changed");
  const heads = directory.repositoryEvents.filter(event => event.kind === 30617 && event.pubkey === current.owner
    && event.tags.some(tag => tag[0] === "d" && tag[1] === current.dtag));
  if (heads.length !== 1 || !eventId(heads[0]?.id)) throw new TransportError("Project repository head unavailable");
  const intent: Intent = previous ?? { key: newIdempotencyKey(), digest, targetEventId: heads[0].id };
  signal.throwIfAborted();
  // Only recovery references and a request digest; no review body or signed event.
  recover(() => localStorage.setItem(slot, JSON.stringify(intent)));
  try {
    if (!intent.acceptedEventId) {
      const request: ProjectsPublishRequest = { operation: ProjectPublicationOperation.CreatePullRequest, targetEventId: intent.targetEventId,
        title, body, branchName: input.branch, targetBranch: input.targetBranch, commit: input.commit,
        ...(mergeBase ? { mergeBase } : {}), ...(reviewers.length > 0 ? { reviewers } : {}) };
      const receipt = await host.publish(request, intent.key, stored !== null, { eventId: intent.eventId, onPrepared: id => {
        signal.throwIfAborted();
        if (!eventId(id)) throw new TransportError("Project publication event unavailable");
        intent.eventId = id; recover(() => localStorage.setItem(slot, JSON.stringify(intent)));
      } });
      if (!eventId(receipt?.eventId) || intent.eventId && intent.eventId !== receipt.eventId) throw unknown();
      intent.acceptedEventId = receipt.eventId; recover(() => localStorage.setItem(slot, JSON.stringify(intent)));
    }
    signal.throwIfAborted();
    // Confirmation is the fresh read: the viewer's own 1618 for this repository and branches.
    const snapshot = await loadProjectWorkItems(host, signal, projectId);
    const published = snapshot.events.find(event => event.id === intent.acceptedEventId);
    const item = snapshot.items.find(value => value.type === "pull-request" && value.pullRequest.id === published?.id
      && value.repository.repoAddress === current.repoAddress);
    if (snapshot.viewerPubkey !== directory.viewerPubkey || !published || published.kind !== 1618 || published.pubkey !== directory.viewerPubkey
      || published.content !== body || !published.tags.some(tag => tag[0] === "a" && tag[1] === current.repoAddress)
      || !item || item.type !== "pull-request" || item.pullRequest.title !== title || item.pullRequest.branchName !== input.branch
      || item.pullRequest.targetBranch !== input.targetBranch || item.pullRequest.initialCommit !== input.commit) throw unknown();
    return { eventId: published.id, pullRequest: item.pullRequest, snapshot, complete: () => {
      signal.throwIfAborted(); host.completePublication?.(intent.key, published.id); recover(() => localStorage.removeItem(slot));
    } };
  } catch (error) {
    if (stored === null && !intent.acceptedEventId && writeFailure(error).kind !== "unknown") recover(() => localStorage.removeItem(slot));
    if (stored !== null || intent.acceptedEventId) throw unknown();
    throw error;
  }
}

/** Machine-readable merge failure (original ProjectPullRequestMergeError without terminal recovery). */
export type ProjectPullRequestMergeErrorCode = "branch_changed" | "merge_conflict" | "merge_failed";
export class ProjectPullRequestMergeError extends Error {
  readonly code: ProjectPullRequestMergeErrorCode;
  constructor(code: ProjectPullRequestMergeErrorCode, message: string) {
    super(message);
    this.name = "ProjectPullRequestMergeError";
    this.code = code;
  }
}

/**
 * Classify a definite merge refusal by its contract reason (the original parsed the native error
 * code); anything else stays unclassified. UNKNOWN outcomes are never classified as failures.
 */
export function parseProjectPullRequestMergeError(error: unknown): ProjectPullRequestMergeError | null {
  if (error instanceof ProjectPullRequestMergeError) return error;
  if (!(error instanceof BffError) || isProjectBranchOutcomeUnknown(error)) return null;
  switch (error.reason) {
    // A moved target/source branch and a merge conflict share the contract reason.
    case ReasonCode.TargetStateConflict: return new ProjectPullRequestMergeError("merge_conflict", t("projects.review.merge.conflict"));
    case ReasonCode.PublishRejected: return new ProjectPullRequestMergeError("merge_failed", t("projects.review.merge.rejected"));
    case ReasonCode.PermissionDenied: return new ProjectPullRequestMergeError("merge_failed", t("projects.review.merge.ownerOnly"));
    case ReasonCode.TargetNotFound: return new ProjectPullRequestMergeError("merge_failed", t("projects.review.merge.notFound"));
    case ReasonCode.DependencyUnavailable: return new ProjectPullRequestMergeError("merge_failed", t("projects.branch.error.unavailable"));
    default: return null;
  }
}

const MERGE_COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
/** The 30617 coordinate's owner: the only identity that merges (DD-118). */
const coordinateOwner = (repository: Pick<Repository, "repoAddress">) => repository.repoAddress.split(":")[1]?.toLowerCase() ?? "";

/**
 * Original canMerge: the viewer's own (SERVER) pubkey is the repository coordinate owner and the
 * review is open with a resolvable source head. Another key of the same person is not the owner.
 */
export function canMergeProjectPullRequest(repository: Pick<Repository, "repoAddress">,
  pullRequest: Pick<ProjectPullRequest, "status" | "branchName" | "commit">, viewer: string | null | undefined) {
  const self = viewer?.toLowerCase();
  return Boolean(self) && self === coordinateOwner(repository) && pullRequest.status === "Open"
    && Boolean(pullRequest.branchName) && MERGE_COMMIT.test(pullRequest.commit?.toLowerCase() ?? "");
}

export type ProjectPullRequestMergeIntent = { key: string; digest: string; viewer: string; request: ProjectsGitMergeRequest };
const mergeUnknown = () => new TransportError(t("projects.review.merge.unknown"));
function recoverMerge<T>(action: () => T): T { try { return action(); } catch { throw mergeUnknown(); } }
const mergeSlot = (host: ProjectsHost, repository: Pick<Repository, "repoAddress">, pullRequest: Pick<ProjectPullRequest, "id">) =>
  JSON.stringify(["project-pull-request-merge", host.scopeKey, repository.repoAddress, pullRequest.id]);
const mergeDigest = (request: ProjectsGitMergeRequest, viewer: string) =>
  hashPayload([request.repository, request.pullRequestEventId, request.targetBranch, request.sourceBranch, request.expectedCommit, viewer]);

function validMergeRequest(value: unknown, repository: Pick<Repository, "repoAddress">, pullRequest: Pick<ProjectPullRequest, "id">): value is ProjectsGitMergeRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<ProjectsGitMergeRequest>;
  return request.repository === repository.repoAddress && request.pullRequestEventId === pullRequest.id
    && typeof request.targetBranch === "string" && request.targetBranch.length > 0
    && typeof request.sourceBranch === "string" && request.sourceBranch.length > 0
    && typeof request.expectedCommit === "string" && MERGE_COMMIT.test(request.expectedCommit);
}

/** A retained, unconfirmed merge of this review: the UI may only resend this exact one. */
export function readProjectPullRequestMergeIntent(host: ProjectsHost, repository: Pick<Repository, "repoAddress">,
  pullRequest: Pick<ProjectPullRequest, "id">, viewer: string): ProjectPullRequestMergeIntent | null {
  const stored = recoverMerge(() => localStorage.getItem(mergeSlot(host, repository, pullRequest)));
  if (stored === null) return null;
  const intent: ProjectPullRequestMergeIntent = recoverMerge(() => JSON.parse(stored));
  if (!intent || typeof intent.key !== "string" || !/^[0-9a-f-]{36}$/.test(intent.key) || intent.viewer !== viewer
    || !validMergeRequest(intent.request, repository, pullRequest) || intent.digest !== mergeDigest(intent.request, viewer)) throw mergeUnknown();
  return intent;
}

export type ProjectPullRequestMergeOutcome = {
  mergeCommit: string;
  sourceBranch: string;
  targetBranch: string;
  /** The review as re-read once its owner-signed 1631 is visible; null while that is not confirmed. */
  pullRequest: ProjectPullRequest | null;
  snapshot: Awaited<ReturnType<typeof loadProjectWorkItems>> | null;
};

/**
 * Merge the review's source head into its target branch, or resend the retained merge intent.
 * A fresh read decides authority and the observed head; the visible control is no grant.
 */
export async function mergeProjectPullRequest(host: ProjectsHost, projectId: string, repository: Repository,
  pullRequest: ProjectPullRequest, viewer: string, signal: AbortSignal, onReadUnavailable: () => void): Promise<ProjectPullRequestMergeOutcome> {
  signal.throwIfAborted();
  const merge = host.git?.mergeProjectPullRequest;
  if (!merge || !/^[0-9a-f]{64}$/.test(viewer)) throw new ProjectPullRequestMergeError("merge_failed", t("projects.review.merge.failed"));
  const slot = mergeSlot(host, repository, pullRequest);
  const previous = readProjectPullRequestMergeIntent(host, repository, pullRequest, viewer);
  const find = (snapshot: Awaited<ReturnType<typeof loadProjectWorkItems>>) => snapshot.items.find(item => item.type === "pull-request"
    && item.pullRequest.id === pullRequest.id && item.repository.repoAddress === repository.repoAddress);
  let request = previous?.request;
  if (!request) {
    const before = await loadProjectWorkItems(host, signal, projectId).catch(error => { onReadUnavailable(); throw error; });
    const current = find(before);
    if (before.viewerPubkey !== viewer || !current || current.type !== "pull-request") {
      onReadUnavailable(); throw new ProjectPullRequestMergeError("merge_failed", t("projects.review.merge.failed"));
    }
    if (!canMergeProjectPullRequest(current.repository, current.pullRequest, viewer))
      throw new ProjectPullRequestMergeError("merge_failed", t("projects.review.merge.failed"));
    // The merged head is the one the owner confirmed; a newer review head must be looked at first.
    if (current.pullRequest.commit?.toLowerCase() !== pullRequest.commit?.toLowerCase() || current.pullRequest.branchName !== pullRequest.branchName)
      throw new ProjectPullRequestMergeError("branch_changed", t("projects.review.merge.branchChanged"));
    const sourceBranch = current.pullRequest.branchName!, targetBranch = current.pullRequest.targetBranch ?? current.repository.defaultBranch;
    if (!targetBranch || targetBranch === sourceBranch) throw new ProjectPullRequestMergeError("merge_failed", t("projects.review.merge.failed"));
    request = projectGitMergeRequest({ repoAddress: current.repository.repoAddress, pullRequestId: current.pullRequest.id,
      targetBranch, sourceBranch, expectedCommit: current.pullRequest.commit!.toLowerCase() });
  }
  signal.throwIfAborted();
  const intent: ProjectPullRequestMergeIntent = previous ?? { key: newIdempotencyKey(), digest: mergeDigest(request, viewer), viewer, request };
  // Persist only the typed request and its key before the push; never a credential.
  recoverMerge(() => localStorage.setItem(slot, JSON.stringify(intent)));
  const retained = intent.request;
  let result: ProjectRepoMergeResult;
  try {
    result = await merge({ repoAddress: retained.repository, pullRequestId: retained.pullRequestEventId, targetBranch: retained.targetBranch,
      sourceBranch: retained.sourceBranch, expectedCommit: retained.expectedCommit }, intent.key);
  } catch (error) {
    if (isProjectBranchOutcomeUnknown(error)) throw mergeUnknown();
    // The BFF answered definitively for this key (including after reconciliation).
    if (error instanceof BffError) { recoverMerge(() => localStorage.removeItem(slot)); throw error; }
    if (previous === null) recoverMerge(() => localStorage.removeItem(slot));
    throw previous === null ? error : mergeUnknown();
  }
  recoverMerge(() => localStorage.removeItem(slot));
  // The push is confirmed; the review shows Merged once the owner-signed 1631 is read back.
  let confirmed: ProjectPullRequest | null = null, snapshot: ProjectPullRequestMergeOutcome["snapshot"] = null;
  if (result.statusEventId) {
    try {
      const after = await loadProjectWorkItems(host, signal, projectId);
      const status = after.events.find(event => event.id === result.statusEventId);
      const updated = find(after);
      if (after.viewerPubkey === viewer && status?.kind === 1631 && status.pubkey.toLowerCase() === coordinateOwner(repository)
        && updated?.type === "pull-request" && updated.pullRequest.status === "Merged") { confirmed = updated.pullRequest; snapshot = after; }
    } catch { /* The merge stands; the review refreshes on its next read. */ }
  }
  return { mergeCommit: result.mergeCommit, sourceBranch: retained.sourceBranch, targetBranch: retained.targetBranch, pullRequest: confirmed, snapshot };
}
