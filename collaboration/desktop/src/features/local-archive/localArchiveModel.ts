// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/local-archive/ui/localArchiveKinds.ts.
// DD-159(1): the archivable kind groups (observer 24200, metrics 44200 and huddle kinds are not
// offered), the subscribable conversations and the sync summary shown by the settings card.
import type { PlatformMessageKey } from "@client-kit/platform/i18n";
import type { Channel } from "@/shared/api/types";
import type { LocalArchiveSyncResult } from "@/shared/api/tauriLocalArchive";

export type ArchiveKindGroup = { id: string; label: PlatformMessageKey; kinds: readonly number[] };

/** Original group order; every kind is inside the Rust archivable set. */
export const ARCHIVE_KIND_GROUPS: readonly ArchiveKindGroup[] = [
  { id: "messages", label: "localArchive.kinds.messages", kinds: [9, 40002, 45001, 45003] },
  { id: "aux", label: "localArchive.kinds.aux", kinds: [7, 40003, 5, 9005] },
  { id: "system", label: "localArchive.kinds.system", kinds: [40099] },
];

/** Default selection for a new subscription: messages plus edits, reactions and deletions. */
export const DEFAULT_ARCHIVE_GROUPS = ["messages", "aux"] as const;

export function kindsForGroups(groupIds: readonly string[]): number[] {
  const kinds = ARCHIVE_KIND_GROUPS.filter((group) => groupIds.includes(group.id)).flatMap((group) => group.kinds);
  return [...new Set(kinds)].sort((a, b) => a - b);
}

export function groupsForKinds(kinds: readonly number[]): string[] {
  return ARCHIVE_KIND_GROUPS.filter((group) => group.kinds.some((kind) => kinds.includes(kind))).map((group) => group.id);
}

/** Conversations the user currently belongs to and has not subscribed yet, by name. */
export function subscribableChannels(channels: readonly Channel[], subscribed: readonly string[]): Channel[] {
  return channels
    .filter((channel) => channel.isMember && !channel.archivedAt && !subscribed.includes(channel.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type SyncSummary = { key: PlatformMessageKey; variables: Record<string, string>; tone: "positive" | "neutral" | "negative" };

/** One line for the toast after "Sync now"; access loss is reported, never hidden. */
export function summarizeSync(results: readonly LocalArchiveSyncResult[]): SyncSummary {
  if (results.some((result) => result.result === "identity_rejected")) {
    return { key: "localArchive.sync.identityRejected", variables: {}, tone: "negative" };
  }
  const lost = results.filter((result) => result.result === "access_lost").length;
  const retry = results.filter((result) => result.result === "retry").length;
  const stored = results.reduce((sum, result) => sum + result.stored, 0);
  if (lost > 0) return { key: "localArchive.sync.accessLost", variables: { count: String(lost) }, tone: "negative" };
  if (retry > 0) return { key: "localArchive.sync.retry", variables: { count: String(retry) }, tone: "neutral" };
  return { key: "localArchive.sync.done", variables: { count: String(stored) }, tone: "positive" };
}

export function formatArchiveBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
