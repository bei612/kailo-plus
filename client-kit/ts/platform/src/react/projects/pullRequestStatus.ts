// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/pullRequestReviews.ts::updateProjectPullRequestStatus.
// The original NIP-34 lifecycle event travels through the governed publication host.
import { hashPayload } from "nostr-tools/nip98";
import { ProjectPublicationOperation, ProjectPullRequestLifecycleStatus } from "@client-kit/contracts";
import { newIdempotencyKey } from "../../governance";
import { TransportError, writeFailure } from "../../transport";
import { translateCurrent as t } from "../../i18n";
import type { ProjectsHost } from "./projectEnumeration";
import { loadProjectWorkItems } from "./projectWorkItems";
import type { Repository } from "./projectModels";
import type { ProjectPullRequest } from "./projectPullRequests.mjs";

/** NIP-34 lifecycle states the original UI publishes. Merged (1631) happens through git. */
export type ProjectPullRequestLifecycle = "open" | "draft" | "closed";
export const PULL_REQUEST_STATUS_KINDS: Record<ProjectPullRequestLifecycle, number> = { open: 1630, draft: 1633, closed: 1632 };
const STATUS_LABEL: Record<ProjectPullRequestLifecycle, ProjectPullRequest["status"]> = { open: "Open", draft: "Draft", closed: "Closed" };
const WIRE: Record<ProjectPullRequestLifecycle, ProjectPullRequestLifecycleStatus> = {
  open: ProjectPullRequestLifecycleStatus.Open, draft: ProjectPullRequestLifecycleStatus.Draft, closed: ProjectPullRequestLifecycleStatus.Closed,
};

/** Original allowedActorsForRoot: the review author or the repository owner. */
export function canChangeProjectPullRequestStatus(repository: Pick<Repository, "owner">, pullRequest: Pick<ProjectPullRequest, "author">, viewer: string | null | undefined) {
  const self = viewer?.toLowerCase();
  return Boolean(self) && (self === pullRequest.author.toLowerCase() || self === repository.owner.toLowerCase());
}

/** Same shape as `buzz pr status`: root e, repository a, owner then author p. */
export function buildProjectPullRequestStatus(repository: Pick<Repository, "owner" | "repoAddress">,
  pullRequest: Pick<ProjectPullRequest, "id" | "author">, status: ProjectPullRequestLifecycle) {
  const recipients = new Set([repository.owner.toLowerCase(), pullRequest.author.toLowerCase()]);
  return {
    kind: PULL_REQUEST_STATUS_KINDS[status],
    content: "",
    tags: [["e", pullRequest.id, "", "root"], ["a", repository.repoAddress], ...[...recipients].map(key => ["p", key])],
  };
}

type Intent = { key: string; digest: string; targetEventId: string; viewer: string; status: ProjectPullRequestLifecycle; eventId?: string; acceptedEventId?: string };
const eventId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const unknown = () => new TransportError(t("projects.review.status.unknown"));
function recover<T>(action: () => T): T { try { return action(); } catch { throw unknown(); } }
const intentSlot = (host: ProjectsHost, projectId: string, repository: Repository, pullRequest: ProjectPullRequest) =>
  JSON.stringify(["project-pull-request-status", host.scopeKey, projectId, repository.repoAddress, pullRequest.id]);
const intentDigest = (status: ProjectPullRequestLifecycle, repository: Repository, pullRequest: ProjectPullRequest, viewer: string) =>
  hashPayload([status, repository.repoAddress, pullRequest.id, viewer]);

/** A retained, unconfirmed lifecycle intent: the UI must resend this exact one. */
export function readProjectPullRequestStatusIntent(host: ProjectsHost, projectId: string, repository: Repository,
  pullRequest: ProjectPullRequest, viewer: string): Intent | null {
  const stored = recover(() => localStorage.getItem(intentSlot(host, projectId, repository, pullRequest)));
  if (stored === null) return null;
  const intent: Intent = recover(() => JSON.parse(stored));
  if (!intent || typeof intent.key !== "string" || !/^[0-9a-f-]{36}$/.test(intent.key)
    || intent.targetEventId !== pullRequest.id || intent.viewer !== viewer || !(intent.status in PULL_REQUEST_STATUS_KINDS)
    || intent.digest !== intentDigest(intent.status, repository, pullRequest, viewer)
    || intent.eventId !== undefined && !eventId(intent.eventId)
    || intent.acceptedEventId !== undefined && !eventId(intent.acceptedEventId)
    || intent.eventId && intent.acceptedEventId && intent.eventId !== intent.acceptedEventId) throw unknown();
  return intent;
}

export async function publishProjectPullRequestStatus(host: ProjectsHost, projectId: string, repository: Repository,
  pullRequest: ProjectPullRequest, viewer: string, status: ProjectPullRequestLifecycle, signal: AbortSignal, onReadUnavailable: () => void) {
  signal.throwIfAborted();
  if (!host.publish || !eventId(viewer) || !(status in PULL_REQUEST_STATUS_KINDS)) throw new Error(t("projects.review.status.failed"));
  const slot = intentSlot(host, projectId, repository, pullRequest);
  const digest = intentDigest(status, repository, pullRequest, viewer);
  const previous = readProjectPullRequestStatusIntent(host, projectId, repository, pullRequest, viewer);
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
      onReadUnavailable(); throw new Error(t("projects.review.status.failed"));
    }
    // A fresh read decides authority and the transition; the open control is no grant.
    if (!canChangeProjectPullRequestStatus(current.repository, current.pullRequest, viewer)
      || !previous && (current.pullRequest.status === "Merged" || current.pullRequest.status === STATUS_LABEL[status]))
      throw new Error(t("projects.review.status.failed"));
    intent ??= { key: newIdempotencyKey(), digest, targetEventId: pullRequest.id, viewer, status };
    const template = buildProjectPullRequestStatus(current.repository, current.pullRequest, status);
    // Only recovery references; never a signed event or an authority.
    recover(() => localStorage.setItem(slot, JSON.stringify(intent)));
    if (!intent.acceptedEventId) {
      const pending = intent;
      const receipt = await host.publish({ operation: ProjectPublicationOperation.SetPullRequestStatus,
        targetEventId: pullRequest.id, pullRequestStatus: WIRE[status] }, pending.key, previous !== null, {
        eventId: pending.eventId, onPrepared: id => {
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
      || !updated || updated.type !== "pull-request" || (updated.pullRequest.statusCreatedAt ?? 0) < published.created_at) throw unknown();
    const confirmed = intent;
    return { pullRequest: updated.pullRequest, snapshot, complete: () => {
      signal.throwIfAborted(); host.completePublication?.(confirmed.key, published.id);
      recover(() => localStorage.removeItem(slot));
    } };
  } catch (error) {
    if (previous === null && !intent?.acceptedEventId && writeFailure(error).kind !== "unknown") recover(() => localStorage.removeItem(slot));
    if (previous !== null || intent?.acceptedEventId) throw unknown();
    throw error;
  }
}
