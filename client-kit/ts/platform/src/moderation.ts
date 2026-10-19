// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/moderation/lib/timeout.ts::{TIMEOUT_PRESETS,isTimeoutActive,formatTimeoutRemaining}
// desktop/src/features/moderation/lib/restrictionState.ts::{parseRestrictionTimestampMs,isTimedOut}
// desktop/src/features/moderation/ui/ReportMessageDialog.tsx::REPORT_CATEGORIES
// desktop/src/features/settings/lib/moderationQueue.ts (triage maths, resolvableActions)
// DD-125(2): the original moderation decisions over the Core views. Every action is a Core
// Governed Action (moderation.*, Tenant CONTROL signs 9040–9044/9005; the caller signs 1984);
// this module only shapes the original UI choices and holds no second authority. The Relay
// timeout is learned from the structured PUBLISH_REJECTED restriction instead of the raw
// "restricted: you are timed out until <ts>" text the original parsed.
import {
  ActionDispatchState,
  ActionGateState,
  ModerationReportStatus,
  ModerationReportTargetKind,
  ModerationReportType,
  ModerationResolutionAction,
  ModerationResolutionStatus,
  ModerationTimeoutDuration,
  PublishRestrictionKind,
  type ActionCommand,
  type ActionSubmission,
  type ErrorBody,
  type ModerationAuditPage,
  type ModerationReportPage,
  type ModerationRestrictionPage,
  type ReasonCode,
} from "@client-kit/contracts";
import type { PlatformMessageKey } from "./i18n";

export type ModerationReport = ModerationReportPage["items"][number];
export type ModerationAuditAction = ModerationAuditPage["items"][number];
export type CommunityRestriction = ModerationRestrictionPage["items"][number];
export type PublishRestriction = NonNullable<ErrorBody["restriction"]>;

/** Moderation action keys (.design/05 §2.11); kick reuses workspace.member.revoke (DD-119). */
export const MODERATION_ACTIONS = {
  report: "moderation.report.submit",
  ban: "moderation.ban",
  unban: "moderation.unban",
  timeout: "moderation.timeout",
  untimeout: "moderation.untimeout",
  resolve: "moderation.report.resolve",
  deleteMessage: "moderation.message.delete",
  kick: "workspace.member.revoke",
} as const;

/** Original ReportMessageDialog REPORT_CATEGORIES, in the order shown to the reporter. */
export const REPORT_CATEGORIES: ReadonlyArray<{ value: ModerationReportType; label: PlatformMessageKey }> = [
  { value: ModerationReportType.Spam, label: "moderation.report.category.spam" },
  { value: ModerationReportType.Profanity, label: "moderation.report.category.profanity" },
  { value: ModerationReportType.Nudity, label: "moderation.report.category.nudity" },
  { value: ModerationReportType.Impersonation, label: "moderation.report.category.impersonation" },
  { value: ModerationReportType.Malware, label: "moderation.report.category.malware" },
  { value: ModerationReportType.Illegal, label: "moderation.report.category.illegal" },
  { value: ModerationReportType.Other, label: "moderation.report.category.other" },
];

/** Original report dialog note bound mirrored by Core (ModerationReportSubmit.note). */
export const REPORT_NOTE_MAX_CHARS = 1000;

/**
 * Original TIMEOUT_PRESETS (1 hour, 24 hours, 7 days). Core freezes the expiry from the
 * duration at admission; the seconds only keep the original test ids.
 */
export const TIMEOUT_PRESETS: ReadonlyArray<{ duration: ModerationTimeoutDuration; seconds: number; label: PlatformMessageKey }> = [
  { duration: ModerationTimeoutDuration.OneHour, seconds: 60 * 60, label: "moderation.timeout.oneHour" },
  { duration: ModerationTimeoutDuration.OneDay, seconds: 24 * 60 * 60, label: "moderation.timeout.oneDay" },
  { duration: ModerationTimeoutDuration.SevenDays, seconds: 7 * 24 * 60 * 60, label: "moderation.timeout.sevenDays" },
];

/** Original restrictionState.ts: RFC3339 strings parse, legacy numbers are unix seconds. */
export function parseRestrictionTimestampMs(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return value * 1000;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** An absent or unparseable value is not an active timeout (original fail-closed reading). */
export function isTimedOut(mutedUntil: string | number | null | undefined, nowMs: number = Date.now()): boolean {
  const ms = parseRestrictionTimestampMs(mutedUntil);
  return ms != null && ms > nowMs;
}

/** Whether a member (one person, every bound key) is currently banned and/or timed out. */
export type MemberRestrictionState = { banned: boolean; timedOut: boolean };

/** One person's state over all of their keys (DD-77): any restricted key restricts the person. */
export function memberRestrictionState(
  restrictions: readonly CommunityRestriction[] | undefined,
  pubkeys: readonly string[],
  nowMs: number = Date.now(),
): MemberRestrictionState {
  const keys = new Set(pubkeys.map((key) => key.toLowerCase()));
  const rows = (restrictions ?? []).filter((row) => keys.has(row.pubkey.toLowerCase()));
  return {
    banned: rows.some((row) => row.banned),
    timedOut: rows.some((row) => isTimedOut(row.mutedUntil ?? null, nowMs)),
  };
}

/** The member's own timeout as learned from a send rejection (original TimeoutRejection). */
export type TimeoutRejection = { expiresAtMs: number | null };

/**
 * The composer timeout from a structured publish restriction. A TIMED_OUT without a
 * parseable expiry is still a timeout (shown without a countdown); a ban is not a timeout.
 */
export function timeoutFromRestriction(restriction: PublishRestriction | undefined): TimeoutRejection | null {
  if (restriction?.kind !== PublishRestrictionKind.TimedOut) return null;
  return { expiresAtMs: parseRestrictionTimestampMs(restriction.until ?? null) };
}

/** Original isTimeoutActive: an unknown expiry stays active (fail closed). */
export function isTimeoutActive(expiresAtMs: number | null, nowMs: number = Date.now()): boolean {
  if (expiresAtMs === null) return true;
  return expiresAtMs > nowMs;
}

/** Original formatTimeoutRemaining as a localisable message ("2h 5m", "3m 20s", "12s"). */
export function timeoutRemaining(
  expiresAtMs: number | null,
  nowMs: number = Date.now(),
): { key: PlatformMessageKey; variables: Record<string, number> } | null {
  if (expiresAtMs === null) return null;
  const totalSeconds = Math.ceil((expiresAtMs - nowMs) / 1000);
  if (totalSeconds <= 0) return null;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return { key: "moderation.remaining.hours", variables: { hours, minutes } };
  if (minutes > 0) return { key: "moderation.remaining.minutes", variables: { minutes, seconds } };
  return { key: "moderation.remaining.seconds", variables: { seconds } };
}

// --- Original moderation queue triage (settings/lib/moderationQueue.ts) ---

const SEVERITY_RANK: Record<ModerationReportType, number> = {
  [ModerationReportType.Illegal]: 6,
  [ModerationReportType.Malware]: 5,
  [ModerationReportType.Impersonation]: 4,
  [ModerationReportType.Nudity]: 3,
  [ModerationReportType.Spam]: 2,
  [ModerationReportType.Profanity]: 1,
  [ModerationReportType.Other]: 0,
};

export function reportSeverity(reportType: ModerationReportType): number {
  return SEVERITY_RANK[reportType] ?? SEVERITY_RANK[ModerationReportType.Other];
}

/** Kind-qualified identity of the reported thing, so reports about it collapse into one group. */
export function targetKey(report: ModerationReport): string {
  return `${report.targetKind}:${report.target}`;
}

export type ModerationQueueGroup = {
  targetKey: string;
  targetKind: ModerationReportTargetKind;
  target: string;
  /** The Workspace whose channel holds an event target; drives delete/kick (original channelId). */
  workspaceId: string | null;
  /** The reported author (event signer or the reported pubkey) as read by Core. */
  authorPubkey: string | null;
  /** The author's HUMAN Principal in this Tenant; Agents and unknown keys carry none. */
  authorPrincipalId: string | null;
  reports: ModerationReport[];
  maxSeverity: number;
  latestCreatedAt: string;
  priorActions: ModerationAuditAction[];
};

function byCreatedAtDesc(a: { createdAt: string }, b: { createdAt: string }): number {
  return b.createdAt.localeCompare(a.createdAt);
}

function actionMatchesTarget(action: ModerationAuditAction, kind: ModerationReportTargetKind, target: string): boolean {
  if (kind === ModerationReportTargetKind.Event) return action.targetEventId === target;
  if (kind === ModerationReportTargetKind.Pubkey) return action.targetPubkey === target;
  return false;
}

/** Original buildModerationQueue: grouped by target, severity desc, then newest report. */
export function buildModerationQueue(
  reports: readonly ModerationReport[],
  actions: readonly ModerationAuditAction[] = [],
): ModerationQueueGroup[] {
  const groups = new Map<string, ModerationQueueGroup>();
  for (const report of reports) {
    const key = targetKey(report);
    const existing = groups.get(key);
    if (existing) {
      existing.reports.push(report);
      existing.maxSeverity = Math.max(existing.maxSeverity, reportSeverity(report.reportType));
      existing.workspaceId ??= report.workspaceId ?? null;
      existing.authorPubkey ??= report.targetAuthorPubkey ?? null;
      existing.authorPrincipalId ??= report.targetPrincipalId ?? null;
    } else {
      groups.set(key, {
        targetKey: key,
        targetKind: report.targetKind,
        target: report.target,
        workspaceId: report.workspaceId ?? null,
        authorPubkey: report.targetAuthorPubkey ?? null,
        authorPrincipalId: report.targetPrincipalId ?? null,
        reports: [report],
        maxSeverity: reportSeverity(report.reportType),
        latestCreatedAt: report.createdAt,
        priorActions: [],
      });
    }
  }
  for (const group of groups.values()) {
    group.reports.sort(byCreatedAtDesc);
    group.latestCreatedAt = group.reports[0]?.createdAt ?? group.latestCreatedAt;
    group.priorActions = actions
      .filter((action) => actionMatchesTarget(action, group.targetKind, group.target))
      .sort(byCreatedAtDesc);
  }
  return [...groups.values()].sort((a, b) => {
    if (b.maxSeverity !== a.maxSeverity) return b.maxSeverity - a.maxSeverity;
    return b.latestCreatedAt.localeCompare(a.latestCreatedAt);
  });
}

export function isOpenReport(report: ModerationReport): boolean {
  return report.status === ModerationReportStatus.Open;
}

/** Original reportTypeLabel. */
export function reportTypeLabel(reportType: ModerationReportType): PlatformMessageKey {
  switch (reportType) {
    case ModerationReportType.Illegal: return "moderation.type.illegal";
    case ModerationReportType.Nudity: return "moderation.type.nudity";
    case ModerationReportType.Malware: return "moderation.type.malware";
    case ModerationReportType.Spam: return "moderation.type.spam";
    case ModerationReportType.Impersonation: return "moderation.type.impersonation";
    case ModerationReportType.Profanity: return "moderation.type.profanity";
    default: return "moderation.type.other";
  }
}

export type SeverityTier = "critical" | "high" | "normal";

export function severityTier(reportType: ModerationReportType): SeverityTier {
  if (reportType === ModerationReportType.Illegal) return "critical";
  if (reportType === ModerationReportType.Malware || reportType === ModerationReportType.Impersonation) return "high";
  return "normal";
}

export function groupTopReportType(group: ModerationQueueGroup): ModerationReportType {
  let top = group.reports[0]?.reportType ?? ModerationReportType.Other;
  for (const report of group.reports) {
    if (reportSeverity(report.reportType) > reportSeverity(top)) top = report.reportType;
  }
  return top;
}

/**
 * Original resolvableActions: never offer an enforcement that cannot complete. Kailo
 * differences: delete and kick need the Workspace of the reported channel; ban and kick
 * need a HUMAN author (an Agent is disabled through its Installation, not banned); the
 * original queue offers no timeout.
 */
export function resolvableActions(group: Pick<ModerationQueueGroup, "targetKind" | "workspaceId" | "authorPrincipalId">): ModerationResolutionAction[] {
  const actions: ModerationResolutionAction[] = [];
  const event = group.targetKind === ModerationReportTargetKind.Event;
  const human = group.authorPrincipalId !== null;
  if (event && group.workspaceId !== null) actions.push(ModerationResolutionAction.Delete);
  if ((event || group.targetKind === ModerationReportTargetKind.Pubkey) && human) actions.push(ModerationResolutionAction.Ban);
  if (event && group.workspaceId !== null && human) actions.push(ModerationResolutionAction.Kick);
  actions.push(ModerationResolutionAction.Escalate, ModerationResolutionAction.Dismiss);
  return actions;
}

/** The Relay pairs dismiss with dismissed and every other action with resolved. */
export function statusForAction(action: ModerationResolutionAction): ModerationResolutionStatus {
  return action === ModerationResolutionAction.Dismiss ? ModerationResolutionStatus.Dismissed : ModerationResolutionStatus.Resolved;
}

// --- Governed command shapes (the only inputs the BFF accepts) ---

export type ReportScope = { workspaceId: string } | { conversationId: string };

export function reportCommand(
  input: { eventId: string; reportType: ModerationReportType; note?: string; scope: ReportScope },
  idempotencyKey: string,
): ActionCommand {
  const note = input.note?.trim();
  return {
    actionKey: MODERATION_ACTIONS.report, idempotencyKey, explicitConfirmation: true,
    moderationReport: { reportType: input.reportType, eventId: input.eventId, ...input.scope, ...(note ? { note } : {}) },
  };
}

export type MemberModeration = "ban" | "unban" | "timeout" | "untimeout";

export function memberCommand(
  action: MemberModeration,
  targetPubkey: string,
  idempotencyKey: string,
  timeoutDuration?: ModerationTimeoutDuration,
): ActionCommand {
  return {
    actionKey: MODERATION_ACTIONS[action], idempotencyKey, explicitConfirmation: true,
    moderationMember: { targetPubkey: targetPubkey.toLowerCase(), ...(action === "timeout" && timeoutDuration ? { timeoutDuration } : {}) },
  };
}

export function resolveCommand(reportEventIds: string[], action: ModerationResolutionAction, idempotencyKey: string): ActionCommand {
  return {
    actionKey: MODERATION_ACTIONS.resolve, idempotencyKey, explicitConfirmation: true,
    moderationResolution: { reportEventIds, status: statusForAction(action), resolutionAction: action },
  };
}

export function deleteMessageCommand(workspaceId: string, eventId: string, idempotencyKey: string): ActionCommand {
  return { actionKey: MODERATION_ACTIONS.deleteMessage, idempotencyKey, explicitConfirmation: true, workspaceId, moderationEventId: eventId };
}

/** Original "Kick from channel": the existing governed Workspace member revocation (DD-119). */
export function kickCommand(workspaceId: string, principalId: string, idempotencyKey: string): ActionCommand {
  return { actionKey: MODERATION_ACTIONS.kick, idempotencyKey, workspaceId, principalId };
}

/** A synchronous moderation answer: done, refused with its reason, or not yet known. */
export type ModerationOutcome =
  | { kind: "done" }
  | { kind: "failed"; reason?: ReasonCode }
  | { kind: "unknown"; operationId: string };

export function moderationOutcome(result: ActionSubmission): ModerationOutcome {
  if (result.gateState === ActionGateState.Allowed && result.dispatchState === ActionDispatchState.Dispatched) {
    return { kind: "done" };
  }
  const refused = result.dispatchState === ActionDispatchState.Aborted
    || result.gateState === ActionGateState.Denied || result.gateState === ActionGateState.Expired;
  return refused ? { kind: "failed", reason: result.reason } : { kind: "unknown", operationId: result.operationId };
}
