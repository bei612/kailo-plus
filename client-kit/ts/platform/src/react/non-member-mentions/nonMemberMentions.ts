// DD-125(8) / SF-BUZ-58(1): mention people outside a Workspace channel.
// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/ui/useMentionSendFlow.ts (non-member partition),
// desktop/src/features/messages/ui/useMentionSendFlow.helpers.ts::withoutInvitingRecipients,
// desktop/src/features/messages/lib/buildMentionCandidates.ts (search results as `isMember: false`).
// Kailo adaptation: a channel's members are its Workspace's ACTIVE members; the people outside are the
// same Tenant's ACTIVE HUMANs from the existing participant directory; "Invite" is the governed
// `workspace.member.add` action, observed until each WorkspaceMembership is ACTIVE.
import {
  ActionDispatchState,
  ActionGateState,
  WorkspaceMembershipState,
  type ActionCommand,
  type ActionSubmission,
  type ConversationParticipant,
  type ConversationParticipantPage,
  type ReasonCode,
  type WorkspaceMemberView,
} from "@client-kit/contracts";
import { newIdempotencyKey } from "../../governance";
import { BffError, TransportError, isOutcomeUnknown } from "../../transport";
import { normalizePubkey } from "../conversations/pubkey";
import { MENTION_REFERENCE_TAG } from "../messages/resolveMentionNames";

export { MENTION_REFERENCE_TAG };

/** The governed add used by the channel member list (DD-41/119). */
export const WORKSPACE_MEMBER_ADD_ACTION = "workspace.member.add";
/** Upper bound for every invited membership to become ACTIVE before the draft is kept unsent. */
export const NON_MEMBER_INVITE_TIMEOUT_MS = 60_000;
/** Interval between membership reads while an invitation converges. */
export const NON_MEMBER_INVITE_POLL_MS = 1_000;

/** Lowercase, trim and de-duplicate keys, keeping first-seen order. */
export function uniqueNormalizedPubkeys(pubkeys: Iterable<string>): string[] {
  return [...new Set([...pubkeys].map(normalizePubkey))].filter(Boolean);
}

/**
 * Original send-time partition: in a Workspace channel, mentioned people who are not
 * ACTIVE members of that Workspace. DMs and unresolved rosters are never judged, and
 * Agents (`excludedPubkeys`) follow their own admission chain.
 */
export function partitionNonMemberMentions({
  mentionPubkeys,
  memberPubkeys,
  isDm,
  excludedPubkeys = [],
}: {
  mentionPubkeys: Iterable<string>;
  /** `null`/`undefined` while the member roster is unresolved. */
  memberPubkeys: Iterable<string> | null | undefined;
  isDm: boolean;
  excludedPubkeys?: Iterable<string>;
}): { members: string[]; nonMembers: string[] } {
  const all = uniqueNormalizedPubkeys(mentionPubkeys);
  if (isDm || !memberPubkeys) return { members: all, nonMembers: [] };
  const members = new Set(uniqueNormalizedPubkeys(memberPubkeys));
  const excluded = new Set(uniqueNormalizedPubkeys(excludedPubkeys));
  const nonMembers = all.filter((pubkey) => !members.has(pubkey) && !excluded.has(pubkey));
  const outside = new Set(nonMembers);
  return { members: all.filter((pubkey) => !outside.has(pubkey)), nonMembers };
}

/**
 * Original "Do nothing"/"Send anyway": the people outside the channel leave the
 * notifying recipients and remain only as reference mentions. The two sets are
 * disjoint; references are sorted and de-duplicated as the BFF freezes them.
 */
export function withoutInvitingRecipients({
  mentionPubkeys,
  nonMemberPubkeys,
}: {
  mentionPubkeys: Iterable<string>;
  nonMemberPubkeys: Iterable<string>;
}): { mentionPubkeys: string[]; referenceMentionPubkeys: string[] } {
  const outside = new Set(uniqueNormalizedPubkeys(nonMemberPubkeys));
  return {
    mentionPubkeys: uniqueNormalizedPubkeys(mentionPubkeys).filter((pubkey) => !outside.has(pubkey)),
    referenceMentionPubkeys: [...outside].sort(),
  };
}

/** Original mergeOutgoingTagsWithReferenceMentions: one `["mention", <pubkey>]` per person. */
export function mergeReferenceMentionTags(
  outgoingTags: readonly string[][] | undefined,
  pubkeys: Iterable<string>,
): string[][] {
  const tags = [...(outgoingTags ?? [])];
  const present = new Set(tags.filter((tag) => tag[0] === MENTION_REFERENCE_TAG && tag[1])
    .map((tag) => normalizePubkey(tag[1]!)));
  for (const pubkey of uniqueNormalizedPubkeys(pubkeys)) {
    if (present.has(pubkey)) continue;
    present.add(pubkey);
    tags.push([MENTION_REFERENCE_TAG, pubkey]);
  }
  return tags;
}

/** A same-Tenant person offered by the @ picker who is not in this channel. */
export type OutsideMentionPerson = {
  pubkey: string;
  displayName: string;
  principalId: string;
  notInChannel: true;
};

/**
 * Candidates outside the channel: Tenant ACTIVE HUMANs (participant directory) none of
 * whose keys, nor whose Principal, is an ACTIVE member of the Workspace.
 */
export function outsideMentionPeople({
  directory,
  memberPubkeys,
  memberPrincipalIds = [],
}: {
  directory: readonly ConversationParticipant[];
  /** Keys of the Workspace's ACTIVE members (the channel roster). */
  memberPubkeys: Iterable<string>;
  memberPrincipalIds?: Iterable<string>;
}): OutsideMentionPerson[] {
  const memberPrincipals = new Set(memberPrincipalIds);
  const members = new Set(uniqueNormalizedPubkeys(memberPubkeys));
  const people = new Map<string, OutsideMentionPerson>();
  for (const person of directory) {
    const pubkeys = uniqueNormalizedPubkeys(person.pubkeys);
    if (memberPrincipals.has(person.principalId) || pubkeys.some((pubkey) => members.has(pubkey))) continue;
    for (const pubkey of pubkeys) {
      if (!people.has(pubkey)) people.set(pubkey, { pubkey, displayName: person.displayName, principalId: person.principalId, notInChannel: true });
    }
  }
  return [...people.values()];
}

/** The directory Principal behind each key, for the people the prompt would invite. */
export function nonMemberInvitePrincipals(
  directory: readonly ConversationParticipant[],
  pubkeys: readonly string[],
): { principals: NonMemberInvitePrincipal[]; unresolved: string[] } {
  const byPubkey = new Map<string, ConversationParticipant>();
  for (const person of directory) for (const pubkey of uniqueNormalizedPubkeys(person.pubkeys)) if (!byPubkey.has(pubkey)) byPubkey.set(pubkey, person);
  const principals = new Map<string, NonMemberInvitePrincipal>();
  const unresolved: string[] = [];
  for (const pubkey of uniqueNormalizedPubkeys(pubkeys)) {
    const person = byPubkey.get(pubkey);
    if (!person) unresolved.push(pubkey);
    else if (!principals.has(person.principalId)) principals.set(person.principalId, { principalId: person.principalId, displayName: person.displayName });
  }
  return { principals: [...principals.values()], unresolved };
}

/** The whole Tenant participant directory (existing Tenant `discover` projection). */
export async function loadTenantMentionDirectory(
  client: { conversationParticipants: (cursor?: string) => Promise<ConversationParticipantPage> },
): Promise<ConversationParticipant[]> {
  const items: ConversationParticipant[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await client.conversationParticipants(cursor);
    if (!page || !Array.isArray(page.items)) throw new TransportError("Invalid participant directory page.");
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
    if (cursor && seen.has(cursor)) throw new TransportError("Participant cursor did not advance.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return items;
}

export type NonMemberInvitePrincipal = { principalId: string; displayName: string };

export type NonMemberInviteResult =
  | { status: "active" }
  | { status: "cancelled" }
  /** The add was refused (admission, approval refusal or a definite BFF rejection). */
  | { status: "rejected"; principals: NonMemberInvitePrincipal[]; reason?: ReasonCode }
  /** A membership converged to ERROR, or its roster could not be read. */
  | { status: "error"; principals: NonMemberInvitePrincipal[] }
  /** Not every membership became ACTIVE within the bound. */
  | { status: "timeout"; principals: NonMemberInvitePrincipal[] };

export type NonMemberInviteFailure = Exclude<NonMemberInviteResult, { status: "active" } | { status: "cancelled" }>;

type InviteClient = {
  submitAction: (command: ActionCommand) => Promise<ActionSubmission>;
  members: (workspaceId: string) => Promise<WorkspaceMemberView[]>;
};

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

function refused(submission: ActionSubmission | undefined): boolean {
  return !submission
    || submission.gateState === ActionGateState.Denied
    || submission.gateState === ActionGateState.Expired
    || submission.gateState === ActionGateState.Revoked
    || submission.dispatchState === ActionDispatchState.Aborted;
}

/**
 * Original Invite, on Kailo's governed membership: submit `workspace.member.add` for each
 * person in turn (anyone already PROVISIONING is only awaited, never re-submitted), then read
 * the Workspace roster until every target is ACTIVE. A refusal, an ERROR membership or the
 * bound elapsing returns a structured failure; accepted adds are never rolled back. Once the
 * signal aborts nothing further is submitted and the caller must not publish.
 */
export async function inviteAndAwaitActive({
  client,
  workspaceId,
  principals,
  signal,
  timeoutMs = NON_MEMBER_INVITE_TIMEOUT_MS,
  pollMs = NON_MEMBER_INVITE_POLL_MS,
  now = Date.now,
  sleep = abortableSleep,
  idempotencyKey = newIdempotencyKey,
}: {
  client: InviteClient;
  workspaceId: string;
  principals: readonly NonMemberInvitePrincipal[];
  signal?: AbortSignal;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  idempotencyKey?: () => string;
}): Promise<NonMemberInviteResult> {
  const targets = [...new Map(principals.map((principal) => [principal.principalId, principal])).values()];
  if (targets.length === 0) return { status: "rejected", principals: [] };
  const deadline = now() + timeoutMs;
  const cancelled = () => signal?.aborted === true;
  const stateOf = (roster: readonly WorkspaceMemberView[], principalId: string) =>
    roster.find((member) => member.principalId === principalId)?.state;

  let roster: WorkspaceMemberView[];
  try {
    roster = await client.members(workspaceId);
  } catch (error) {
    if (cancelled()) return { status: "cancelled" };
    if (!isOutcomeUnknown(error)) return { status: "error", principals: targets };
    roster = [];
  }
  if (cancelled()) return { status: "cancelled" };
  // A membership already in ERROR is retried by the add; only a later ERROR is a failure.
  const initiallyErrored = new Set(targets.filter((target) => stateOf(roster, target.principalId) === WorkspaceMembershipState.Error)
    .map((target) => target.principalId));

  for (const target of targets) {
    const state = stateOf(roster, target.principalId);
    if (state === WorkspaceMembershipState.Active || state === WorkspaceMembershipState.Provisioning) continue;
    let submission: ActionSubmission | undefined;
    try {
      submission = await client.submitAction({
        actionKey: WORKSPACE_MEMBER_ADD_ACTION,
        idempotencyKey: idempotencyKey(),
        workspaceId,
        principalId: target.principalId,
      });
    } catch (error) {
      if (cancelled()) return { status: "cancelled" };
      // An unanswered add may have landed: the roster, not a resubmission, decides.
      if (isOutcomeUnknown(error)) continue;
      return { status: "rejected", principals: [target], reason: error instanceof BffError ? error.reason : undefined };
    }
    if (cancelled()) return { status: "cancelled" };
    if (refused(submission)) return { status: "rejected", principals: [target], reason: submission?.reason };
  }

  for (;;) {
    if (cancelled()) return { status: "cancelled" };
    let current: WorkspaceMemberView[] | undefined;
    try {
      current = await client.members(workspaceId);
    } catch (error) {
      if (cancelled()) return { status: "cancelled" };
      if (!isOutcomeUnknown(error)) return { status: "error", principals: targets };
    }
    if (cancelled()) return { status: "cancelled" };
    if (current) {
      const failed = targets.filter((target) => {
        const state = stateOf(current!, target.principalId);
        if (state !== WorkspaceMembershipState.Error) {
          initiallyErrored.delete(target.principalId);
          return false;
        }
        return !initiallyErrored.has(target.principalId);
      });
      if (failed.length > 0) return { status: "error", principals: failed };
      const pending = targets.filter((target) => stateOf(current!, target.principalId) !== WorkspaceMembershipState.Active);
      if (pending.length === 0) return { status: "active" };
      if (now() >= deadline) return { status: "timeout", principals: pending };
    } else if (now() >= deadline) {
      return { status: "timeout", principals: targets };
    }
    await sleep(Math.max(0, Math.min(pollMs, deadline - now())), signal);
  }
}
