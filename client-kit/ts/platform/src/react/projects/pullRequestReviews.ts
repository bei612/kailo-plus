// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/pullRequestReviews.ts::canReviewProjectPullRequest and
// submitProjectPullRequestReview("approve"). DD-118(5): the original labeled kind-1 approval travels
// through the governed Projects publication host (APPROVE_PULL_REQUEST); the signer re-reads the
// review head and the original reviewer authority before signing. Same retained-intent rule as the
// other publications: an UNKNOWN outcome keeps the exact intent (its key, the approved head and a
// digest of the summary, never the summary itself) and a retry only re-sends that intent.
import { hashPayload } from "nostr-tools/nip98";
import { ProjectPublicationOperation, ReasonCode } from "@client-kit/contracts";
import { newIdempotencyKey } from "../../governance";
import { translateCurrent as t } from "../../i18n";
import { BffError, isOutcomeUnknown, TransportError, writeFailure } from "../../transport";
import type { ProjectsHost } from "./projectEnumeration";
import type { Repository } from "./projectModels";
import { PR_APPROVAL_LABEL, type ProjectPullRequest } from "./projectPullRequests.mjs";
import { loadProjectWorkItems } from "./projectWorkItems";

/** Original REVIEW_DECISION_DETAILS.approve.content: the signed content without a summary. */
export const PR_APPROVAL_CONTENT = "Approved these changes";

/** The review head moved since the reviewer looked at it (also Core's TARGET_STATE_CONFLICT). */
export class ProjectPullRequestHeadChangedError extends Error {
  constructor() {
    super(t("projects.review.headChanged"));
    this.name = "ProjectPullRequestHeadChangedError";
  }
}

/** A definite review-write refusal because the review head moved; the caller shows the refresh copy. */
export function isProjectPullRequestHeadChanged(error: unknown) {
  return error instanceof ProjectPullRequestHeadChangedError
    || error instanceof BffError && error.reason === ReasonCode.TargetStateConflict;
}

/** Original canReviewProjectPullRequest: owner or requested reviewer, never the author, on an open or draft review. */
export function canReviewProjectPullRequest(repository: Pick<Repository, "owner">,
  pullRequest: Pick<ProjectPullRequest, "author" | "commit" | "status" | "reviewers">, viewer: string | null | undefined) {
  if (!viewer || !pullRequest.commit || (pullRequest.status !== "Open" && pullRequest.status !== "Draft")) return false;
  const self = viewer.toLowerCase();
  if (self === pullRequest.author.toLowerCase()) return false;
  return self === repository.owner.toLowerCase() || pullRequest.reviewers.some(reviewer => reviewer.toLowerCase() === self);
}

/** Original PullRequestReviewCard hasApproved: a current-commit approval by the viewer. */
export function hasApprovedProjectPullRequest(pullRequest: Pick<ProjectPullRequest, "approvals">, viewer: string | null | undefined) {
  const self = viewer?.toLowerCase();
  return Boolean(self) && pullRequest.approvals.some(approval => approval.author.toLowerCase() === self);
}

/** Original submitProjectPullRequestReview event: root, repository, owner then author, label, head. */
export function buildProjectPullRequestApproval(repository: Pick<Repository, "owner" | "repoAddress">,
  pullRequest: Pick<ProjectPullRequest, "id" | "author">, commit: string, summary: string) {
  const recipients = new Set([repository.owner.toLowerCase(), pullRequest.author.toLowerCase()]);
  return {
    kind: 1,
    content: summary.trim() || PR_APPROVAL_CONTENT,
    tags: [["e", pullRequest.id, "", "root"], ["a", repository.repoAddress], ...[...recipients].map(key => ["p", key]),
      ["t", PR_APPROVAL_LABEL], ["c", commit]],
  };
}

type Intent = { key: string; digest: string; targetEventId: string; viewer: string; commit: string; eventId?: string; acceptedEventId?: string };
const eventId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const unknown = () => new TransportError(t("projects.review.approve.unknown"));
function recover<T>(action: () => T): T { try { return action(); } catch { throw unknown(); } }
const intentSlot = (host: ProjectsHost, projectId: string, repository: Pick<Repository, "repoAddress">, pullRequest: Pick<ProjectPullRequest, "id">) =>
  JSON.stringify(["project-pull-request-approval", host.scopeKey, projectId, repository.repoAddress, pullRequest.id]);
const intentDigest = (summary: string, commit: string, repository: Pick<Repository, "repoAddress">, pullRequest: Pick<ProjectPullRequest, "id">, viewer: string) =>
  hashPayload([summary.trim(), commit, repository.repoAddress, pullRequest.id, viewer]);

/** A retained, unconfirmed approval: the UI may only re-check this exact one (same summary). */
export function readProjectPullRequestApprovalIntent(host: ProjectsHost, projectId: string, repository: Pick<Repository, "repoAddress">,
  pullRequest: Pick<ProjectPullRequest, "id">, viewer: string): Intent | null {
  const stored = recover(() => localStorage.getItem(intentSlot(host, projectId, repository, pullRequest)));
  if (stored === null) return null;
  const intent: Intent = recover(() => JSON.parse(stored));
  if (!intent || typeof intent.key !== "string" || !/^[0-9a-f-]{36}$/.test(intent.key) || typeof intent.digest !== "string"
    || intent.targetEventId !== pullRequest.id || intent.viewer !== viewer || typeof intent.commit !== "string" || !COMMIT.test(intent.commit)
    || intent.eventId !== undefined && !eventId(intent.eventId)
    || intent.acceptedEventId !== undefined && !eventId(intent.acceptedEventId)
    || intent.eventId && intent.acceptedEventId && intent.eventId !== intent.acceptedEventId) throw unknown();
  return intent;
}

/**
 * Approve the review head the reviewer looked at, or re-check the retained approval. A fresh read decides
 * authority; the visible button is no grant, and Core refuses a moved head (TARGET_STATE_CONFLICT).
 */
export async function publishProjectPullRequestApproval(host: ProjectsHost, projectId: string, repository: Repository,
  pullRequest: ProjectPullRequest, viewer: string, summary: string, signal: AbortSignal, onReadUnavailable: () => void) {
  signal.throwIfAborted();
  if (!host.publish || !eventId(viewer)) throw new Error(t("projects.review.approve.failed"));
  const slot = intentSlot(host, projectId, repository, pullRequest);
  const previous = readProjectPullRequestApprovalIntent(host, projectId, repository, pullRequest, viewer);
  const commit = previous?.commit ?? pullRequest.commit ?? "";
  if (!COMMIT.test(commit)) throw new Error(t("projects.review.approve.failed"));
  const digest = intentDigest(summary, commit, repository, pullRequest, viewer);
  if (previous && previous.digest !== digest) throw unknown();
  const read = async () => {
    try { return await loadProjectWorkItems(host, signal, projectId); }
    catch (error) { onReadUnavailable(); throw error; }
  };
  const find = (snapshot: Awaited<ReturnType<typeof read>>) => snapshot.items.find(item => item.type === "pull-request"
    && item.pullRequest.id === pullRequest.id && item.repository.repoAddress === repository.repoAddress);
  let intent = previous;
  try {
    const before = await read();
    const current = find(before);
    if (before.viewerPubkey !== viewer || !current || current.type !== "pull-request") {
      onReadUnavailable(); throw new Error(t("projects.review.approve.failed"));
    }
    if (!previous && (!canReviewProjectPullRequest(current.repository, current.pullRequest, viewer)
      || hasApprovedProjectPullRequest(current.pullRequest, viewer))) throw new Error(t("projects.review.approve.failed"));
    if (!previous && current.pullRequest.commit !== commit) throw new ProjectPullRequestHeadChangedError();
    intent ??= { key: newIdempotencyKey(), digest, targetEventId: pullRequest.id, viewer, commit };
    const template = buildProjectPullRequestApproval(current.repository, current.pullRequest, commit, summary);
    // Only recovery references and a digest; never the summary or a signed event.
    recover(() => localStorage.setItem(slot, JSON.stringify(intent)));
    if (!intent.acceptedEventId) {
      const pending = intent, body = summary.trim();
      const receipt = await host.publish({ operation: ProjectPublicationOperation.ApprovePullRequest, targetEventId: pullRequest.id,
        commit, ...(body ? { body } : {}) }, pending.key, previous !== null, { eventId: pending.eventId, onPrepared: id => {
        signal.throwIfAborted();
        if (!eventId(id)) throw unknown();
        pending.eventId = id; recover(() => localStorage.setItem(slot, JSON.stringify(pending)));
      } });
      if (!eventId(receipt?.eventId) || pending.eventId && pending.eventId !== receipt.eventId) throw unknown();
      pending.acceptedEventId = receipt.eventId; recover(() => localStorage.setItem(slot, JSON.stringify(pending)));
    }
    signal.throwIfAborted();
    const snapshot = await read();
    const published = snapshot.events.find(event => event.id === intent?.acceptedEventId);
    const updated = find(snapshot);
    if (snapshot.viewerPubkey !== viewer || !published || published.kind !== template.kind || published.pubkey !== viewer
      || published.content !== template.content || JSON.stringify(published.tags) !== JSON.stringify(template.tags)
      || !updated || updated.type !== "pull-request" || !updated.pullRequest.comments.some(comment => comment.id === published.id)) throw unknown();
    const confirmed = intent;
    return { pullRequest: updated.pullRequest, snapshot, complete: () => {
      signal.throwIfAborted(); host.completePublication?.(confirmed.key, published.id);
      recover(() => localStorage.removeItem(slot));
    } };
  } catch (error) {
    // The BFF answered this key definitively (refused, conflict): nothing was published under it.
    const definite = !intent?.acceptedEventId && error instanceof BffError && !isOutcomeUnknown(error);
    if (definite || previous === null && !intent?.acceptedEventId && writeFailure(error).kind !== "unknown") recover(() => localStorage.removeItem(slot));
    if (!definite && (previous !== null || intent?.acceptedEventId)) throw unknown();
    throw error;
  }
}
