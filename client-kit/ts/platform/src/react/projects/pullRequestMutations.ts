// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/pullRequestMutations.ts::publishProjectPullRequest (create review
// only; update and merge are not part of this batch). DD-118: the original kind-1618 review is
// published as CREATE_PULL_REQUEST through the governed Projects publication host, with the same
// retained-intent rule as the other publications: an UNKNOWN outcome keeps the exact intent and a
// retry only re-sends (observes) that intent under its original Idempotency-Key.
import { hashPayload } from "nostr-tools/nip98";
import { ProjectPublicationOperation, type ProjectsPublishRequest } from "@client-kit/contracts";
import { newIdempotencyKey } from "../../governance";
import { translateCurrent as t } from "../../i18n";
import { TransportError, writeFailure } from "../../transport";
import { loadProjectDirectory, type ProjectsHost } from "./projectEnumeration";
import type { Repository } from "./projectModels";
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
