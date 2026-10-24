// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/shared/api/tauriArchive.ts.
// DD-159: the Desktop local archive commands. Reads go through this device's own Relay session
// only; the archive is sealed at rest and never leaves the device.
import { invokeTauri } from "@/shared/api/tauri";

export type LocalArchiveSubscription = {
  channelId: string;
  kinds: number[];
  createdAt: number;
  lastSyncAt: number | null;
  /** `never` | `ok` | `retry` (transient failure, kept); access loss removes the row. */
  lastResult: string;
  cursor: number;
  eventCount: number;
};

export type LocalArchiveStatus = {
  subscriptions: LocalArchiveSubscription[];
  bytes: number;
  archivableKinds: number[];
};

export type LocalArchiveSyncOutcome = "ok" | "retry" | "access_lost" | "identity_rejected";

export type LocalArchiveSyncResult = {
  channelId: string;
  result: LocalArchiveSyncOutcome;
  stored: number;
};

export function getLocalArchiveStatus(): Promise<LocalArchiveStatus> {
  return invokeTauri<LocalArchiveStatus>("local_archive_status");
}

export function subscribeLocalArchive(channelId: string, kinds: number[]): Promise<LocalArchiveStatus> {
  return invokeTauri<LocalArchiveStatus>("local_archive_subscribe", { channelId, kinds });
}

export function unsubscribeLocalArchive(channelId: string): Promise<LocalArchiveStatus> {
  return invokeTauri<LocalArchiveStatus>("local_archive_unsubscribe", { channelId });
}

export function syncLocalArchive(): Promise<LocalArchiveSyncResult[]> {
  return invokeTauri<LocalArchiveSyncResult[]>("local_archive_sync");
}

export function clearLocalArchive(): Promise<void> {
  return invokeTauri<void>("local_archive_clear");
}
