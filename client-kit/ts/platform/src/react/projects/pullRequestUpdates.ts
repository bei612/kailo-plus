// Fixed Buzz 779af8886caae1317b4de962082429867ab61503:
// pullRequestMutations.ts::projectPullRequestUpdateTags/publishProjectPullRequestUpdate.
import type { Repository } from "./projectModels";
import type { ProjectPullRequest } from "./projectPullRequests.mjs";

export function canPublishProjectPullRequestUpdate(viewer: string, repository: Pick<Repository,"owner">,
  review: Pick<ProjectPullRequest,"author">) {
  const key=viewer.toLowerCase();return key===repository.owner.toLowerCase()||key===review.author.toLowerCase();
}
export function buildProjectPullRequestUpdate(repository: Pick<Repository,"owner"|"repoAddress"|"cloneUrls">,
  review: Pick<ProjectPullRequest,"id"|"author"|"cloneUrls">,commit: string,mergeBase: string|null) {
  const tags=[["a",repository.repoAddress],...Array.from(new Set([repository.owner,review.author].map(value=>value.toLowerCase())))
    .map(key=>["p",key]),["E",review.id],["P",review.author.toLowerCase()],["c",commit],
    ["clone",...(review.cloneUrls.length?review.cloneUrls:repository.cloneUrls)]];
  if(mergeBase)tags.push(["merge-base",mergeBase]);
  return {kind:1619,content:"",tags};
}
export function nextProjectPullRequestUpdateCreatedAt(review: Pick<ProjectPullRequest,"updates">,now:number) {
  const next=Math.max(now,...review.updates.map(update=>update.createdAt+1));
  if(!Number.isSafeInteger(next)||next<0)throw new Error("Invalid review update time");
  return next;
}

import { hashPayload } from "nostr-tools/nip98";
import { ProjectPublicationOperation } from "@client-kit/contracts";
import { newIdempotencyKey } from "../../governance";
import { translateCurrent as t } from "../../i18n";
import { TransportError, writeFailure } from "../../transport";
import type { ProjectsHost } from "./projectEnumeration";
import { loadProjectWorkItems } from "./projectWorkItems";

const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const eventId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const unknown = () => new TransportError(t("projects.review.unknown"));
function recover<T>(read: () => T): T { try { return read(); } catch { throw unknown(); } }
type UpdateIntent = { key: string; digest: string; viewer: string; targetEventId: string; commit: string; mergeBase: string | null; eventId?: string; acceptedEventId?: string };
const slotFor = (host: ProjectsHost, projectId: string, repository: Repository, review: ProjectPullRequest) =>
  JSON.stringify(["project-pull-request-update", host.scopeKey, projectId, repository.repoAddress, review.id]);
const digestFor = (repository: Repository, review: ProjectPullRequest, viewer: string, commit: string, mergeBase: string | null) =>
  hashPayload([repository.repoAddress, review.id, viewer, commit, mergeBase]);

/** Persisted recovery references freeze the pushed commit, even if the branch moves afterwards. */
export function readProjectPullRequestUpdateIntent(host: ProjectsHost, projectId: string, repository: Repository,
  review: ProjectPullRequest, viewer: string): UpdateIntent | null {
  const stored = recover(() => localStorage.getItem(slotFor(host, projectId, repository, review)));
  if (stored === null) return null;
  const intent: UpdateIntent = recover(() => JSON.parse(stored));
  if (!intent || typeof intent.key !== "string" || !/^[0-9a-f-]{36}$/.test(intent.key)
    || intent.viewer !== viewer || intent.targetEventId !== review.id || !COMMIT.test(intent.commit)
    || intent.mergeBase !== null && !COMMIT.test(intent.mergeBase)
    || intent.digest !== digestFor(repository, review, viewer, intent.commit, intent.mergeBase)
    || intent.eventId !== undefined && !eventId(intent.eventId)
    || intent.acceptedEventId !== undefined && !eventId(intent.acceptedEventId)
    || intent.eventId && intent.acceptedEventId && intent.eventId !== intent.acceptedEventId) throw unknown();
  return intent;
}

/** Current clone metadata may change after dispatch; the original receipt freezes its clone tag. */
export function projectPullRequestUpdateMatches(repository: Repository, review: ProjectPullRequest, commit: string, mergeBase: string | null,
  event: { kind: number; content: string; tags: string[][] }) {
  const epochs = event.tags.filter(tag => tag[0] === "kailo:publication");
  if (epochs.length > 1 || epochs.some(tag => tag.length !== 2 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(tag[1]!))) return false;
  const tags = event.tags.filter(tag => tag[0] !== "kailo:publication");
  const clone = tags.find(tag => tag[0] === "clone");
  if (!clone) return false;
  const expected = buildProjectPullRequestUpdate(repository, { ...review, cloneUrls: clone.slice(1) }, commit, mergeBase);
  // Empty clone is an original legal tag; do not fill it from changed repository metadata.
  expected.tags.find(tag => tag[0] === "clone")!.splice(1, Infinity, ...clone.slice(1));
  return event.kind === 1619 && event.content === "" && JSON.stringify(tags) === JSON.stringify(expected.tags);
}

// Prevent overlapping manual/push continuations in this host from replacing one retained intent.
const publishing = new Set<string>();
export async function publishProjectPullRequestUpdate(host: ProjectsHost, projectId: string, repository: Repository,
  review: ProjectPullRequest, viewer: string, input: { commit: string; mergeBase: string | null }, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!host.publish || !eventId(viewer) || !COMMIT.test(input.commit) || input.mergeBase !== null && !COMMIT.test(input.mergeBase))
    throw new Error(t("projects.review.updateFailed"));
  const slot = slotFor(host, projectId, repository, review);
  if (publishing.has(slot)) throw unknown();
  publishing.add(slot);
  let previous: UpdateIntent | null = null, intent: UpdateIntent | null = null;
  try {
    previous = readProjectPullRequestUpdateIntent(host, projectId, repository, review, viewer);
    intent = previous;
    const before = await loadProjectWorkItems(host, signal, projectId);
    signal.throwIfAborted();
    const current = before.items.find(item => item.type === "pull-request" && item.pullRequest.id === review.id && item.repository.repoAddress === repository.repoAddress);
    if (before.viewerPubkey !== viewer || current?.type !== "pull-request"
      || !canPublishProjectPullRequestUpdate(viewer, current.repository, current.pullRequest)) throw new Error(t("projects.review.updateFailed"));
    if (!intent && current.pullRequest.commit === input.commit) return null;
    intent ??= { key: newIdempotencyKey(), viewer, targetEventId: review.id, ...input,
      digest: digestFor(repository, review, viewer, input.commit, input.mergeBase) };
    // A second page cannot replace a request that appeared while the fresh read was in flight.
    const latest = readProjectPullRequestUpdateIntent(host, projectId, repository, review, viewer);
    if (JSON.stringify(latest) !== JSON.stringify(previous)) throw unknown();
    recover(() => localStorage.setItem(slot, JSON.stringify(intent)));
    if (!intent.acceptedEventId) {
      const pending = intent;
      const receipt = await host.publish({ operation: ProjectPublicationOperation.UpdatePullRequest,
        targetEventId: review.id, commit: pending.commit, ...(pending.mergeBase ? { mergeBase: pending.mergeBase } : {}) },
      pending.key, previous !== null, { eventId: pending.eventId, onPrepared: id => {
        signal.throwIfAborted();
        if (!eventId(id)) throw unknown();
        pending.eventId = id; recover(() => localStorage.setItem(slot, JSON.stringify(pending)));
      } });
      if (!eventId(receipt?.eventId) || pending.eventId && pending.eventId !== receipt.eventId) throw unknown();
      pending.acceptedEventId = receipt.eventId; recover(() => localStorage.setItem(slot, JSON.stringify(pending)));
    }
    signal.throwIfAborted();
    const snapshot = await loadProjectWorkItems(host, signal, projectId);
    signal.throwIfAborted();
    const published = snapshot.events.find(event => event.id === intent?.acceptedEventId);
    const updated = snapshot.items.find(item => item.type === "pull-request" && item.pullRequest.id === review.id && item.repository.repoAddress === repository.repoAddress);
    if (snapshot.viewerPubkey !== viewer || !published || published.pubkey !== viewer || updated?.type !== "pull-request"
      || !updated.pullRequest.updates.some(update => update.id === published.id)
      || !projectPullRequestUpdateMatches(current.repository, current.pullRequest, intent.commit, intent.mergeBase, published)) throw unknown();
    const confirmed = intent;
    return { snapshot, pullRequest: updated.pullRequest, complete: () => {
      signal.throwIfAborted();
      const stored = readProjectPullRequestUpdateIntent(host, projectId, repository, review, viewer);
      if (stored?.key !== confirmed.key || stored.acceptedEventId !== published.id) throw unknown();
      host.completePublication?.(confirmed.key, published.id); recover(() => localStorage.removeItem(slot));
    } };
  } catch (error) {
    if (previous === null && intent && !intent.acceptedEventId && writeFailure(error).kind !== "unknown") recover(() => localStorage.removeItem(slot));
    if (previous !== null || intent?.acceptedEventId) throw unknown();
    throw error;
  } finally { publishing.delete(slot); }
}
