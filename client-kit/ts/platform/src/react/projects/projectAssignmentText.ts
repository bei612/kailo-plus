// DD-157(8), .design/20 §1 and §13.6: an issue assignment comment is shown as Kailo copy naming the
// assignee, never as the label text its signer stored in `content` (the fixed Buzz
// issueAssignments.ts writes "Assigned this task to <label>", and an unnamed signer's label was a
// truncated npub). The reducer in projectIssues.mjs alone decides who is assigned; this module
// only words an already-parsed comment for reading.
import { decode } from "nostr-tools/nip19";
import type { Translate } from "../context";
import { normalizePubkey, truncateNpub } from "../conversations/pubkey";
import { unknownMemberLabel } from "../messages/system/identity";
import { truncateNpub as pulseShortNpub } from "../pulse/host";
import { platformMessages } from "../../i18n";
import type { ProjectIssue, ProjectIssueComment, ProjectIssueCommentAssignment } from "./projectIssues.mjs";

const ASSIGNED = /^Assigned this task to (.+)$/;
const UNASSIGNED = /^Unassigned (.+) from this task$/;
const HEX_KEY = /^[0-9a-fA-F]{64}$/;
const FULL_NPUB = /^npub1[02-9ac-hj-np-z]{58}$/;
/** Anything key-shaped: a whole or shortened npub, or hex. Never displayed. */
const KEY_SHAPED = /npub1|[0-9a-fA-F]{32,}/;

/**
 * The label written into an assignment's `content` when the assignee has no readable name. The
 * content is the fixed English protocol sentence, so the label is the catalog's English text; the
 * tags, not this text, identify the assignee.
 */
export const ASSIGNMENT_UNKNOWN_LABEL = platformMessages["messages.system.unknownMember"].en;

/** The two shortened npub forms Kailo has shown (identity surfaces 8…4, Pulse 12…6). */
function shortenedForms(pubkey: string): string[] {
  return [truncateNpub(pubkey), pulseShortNpub(pubkey)];
}

/** A label that could not be tied to one identity; rendered as "Unknown member". */
const UNRESOLVED = null;

export type ReadableAssignment = {
  operation: ProjectIssueCommentAssignment["operation"];
  /** Assignee pubkeys, or the readable legacy label when the comment names no key. */
  assignees: Array<{ pubkey: string } | { label: string } | typeof UNRESOLVED>;
};

/**
 * Legacy reading for an assignment comment without `t`/`p` tags. Only a content that is exactly
 * one of the two fixed sentences counts. Its label resolves to an identity when it is a full npub
 * or hex key, or a shortened npub that exactly one of `candidates` (the people on the same task)
 * shortens to; another key-shaped label is unresolved. A plain label is the readable name the
 * signer chose at the time and is kept as written.
 */
function legacyAssignment(content: string, candidates: readonly string[]): ReadableAssignment | null {
  const text = content.trim();
  if (text.includes("\n")) return null;
  const assigned = ASSIGNED.exec(text);
  const unassigned = assigned ? null : UNASSIGNED.exec(text);
  const label = (assigned ?? unassigned)?.[1]?.trim();
  if (!label) return null;
  const operation = assigned ? "assign" : "unassign";
  if (HEX_KEY.test(label)) return { operation, assignees: [{ pubkey: normalizePubkey(label) }] };
  if (FULL_NPUB.test(label)) {
    try {
      const decoded = decode(label);
      if (decoded.type === "npub") return { operation, assignees: [{ pubkey: decoded.data }] };
    } catch { /* not a valid npub: unresolved below */ }
    return { operation, assignees: [UNRESOLVED] };
  }
  if (KEY_SHAPED.test(label)) {
    const matches = [...new Set(candidates.map(normalizePubkey))]
      .filter((pubkey) => HEX_KEY.test(pubkey) && shortenedForms(pubkey).includes(label));
    return { operation, assignees: [matches.length === 1 ? { pubkey: matches[0]! } : UNRESOLVED] };
  }
  // The writer's own fallback when it knew no name (IssueAssigneesRow): shown in the reader's language.
  if (label === ASSIGNMENT_UNKNOWN_LABEL) return { operation, assignees: [UNRESOLVED] };
  return { operation, assignees: [{ label }] };
}

/** The assignment a comment states, from its tags first, else the exact legacy sentence. */
export function readableAssignment(
  comment: Pick<ProjectIssueComment, "content" | "assignment">,
  candidates: readonly string[] = [],
): ReadableAssignment | null {
  if (comment.assignment) {
    return {
      operation: comment.assignment.operation,
      assignees: comment.assignment.assignees.map((pubkey) => ({ pubkey })),
    };
  }
  return legacyAssignment(comment.content, candidates);
}

/**
 * The shown sentence ("Assigned this task to <name>"), or null when the comment is not an
 * assignment and its own content is shown. `labelFor` resolves a pubkey to a Kailo member or
 * Agent display name (its own fallback is "Unknown member").
 */
export function projectAssignmentText(
  comment: Pick<ProjectIssueComment, "content" | "assignment">,
  t: Translate,
  labelFor: (pubkey: string) => string,
  candidates: readonly string[] = [],
): string | null {
  const assignment = readableAssignment(comment, candidates);
  return assignment ? assignmentSentence(assignment, t, labelFor) : null;
}

/** "Assigned this task to <names>" / "Unassigned <names> from this task" in the reader's language. */
export function assignmentSentence(
  assignment: ReadableAssignment,
  t: Translate,
  labelFor: (pubkey: string) => string,
): string {
  const names = assignment.assignees.map((assignee) =>
    assignee === UNRESOLVED ? unknownMemberLabel(t)
      : "pubkey" in assignee ? labelFor(assignee.pubkey) : assignee.label);
  return t(assignment.operation === "assign" ? "projects.assignment.assignedTo" : "projects.assignment.unassignedFrom",
    { name: names.join(t("projects.assignment.nameSeparator")) });
}

/** Pubkeys an assignment comment names, so their profiles are read with the comment's author. */
export function projectAssignmentPubkeys(
  comment: Pick<ProjectIssueComment, "content" | "assignment">,
  candidates: readonly string[] = [],
): string[] {
  return (readableAssignment(comment, candidates)?.assignees ?? [])
    .flatMap((assignee) => assignee && "pubkey" in assignee ? [assignee.pubkey] : []);
}

/** The people on one task: the only identities a shortened legacy label may resolve to. */
export function projectIssueCandidates(
  issue: Pick<ProjectIssue, "author" | "assignees" | "recipients" | "comments">,
): string[] {
  return [issue.author, ...issue.assignees, ...issue.recipients, ...issue.comments.map((comment) => comment.author),
    ...issue.comments.flatMap((comment) => comment.assignment?.assignees ?? [])];
}

/** The people a task's own assignment comments name, so their profiles are read with the task. */
export function projectIssueAssignmentPubkeys(
  issue: Pick<ProjectIssue, "author" | "assignees" | "recipients" | "comments">,
): string[] {
  const candidates = projectIssueCandidates(issue);
  return [...new Set(issue.comments.flatMap((comment) => projectAssignmentPubkeys(comment, candidates)))];
}
