// Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/openSnapshotImportFromUrlEvent.ts.
// A snapshot attachment card fetches and verifies the package bytes, then asks the Agents page to
// open its import preview: a module-level pending payload consumed exactly once when the page mounts
// (or immediately when it is mounted), plus a window event. Hosts may also listen (without
// consuming) to navigate to their Agents page. Presentation only: the preview is Core's decode of a
// session upload, and import is the governed `agent.definition.import` / `agent.team.import`.

export type PendingSnapshotImport = {
  fileBytes: Uint8Array<ArrayBuffer>;
  fileName: string;
  snapshotKind: "agent" | "team";
};

const OPEN_SNAPSHOT_IMPORT_EVENT = "buzz:open-snapshot-import";

let pendingImport: PendingSnapshotImport | null = null;

/** Enqueue a verified snapshot import; a later request replaces an unconsumed one. */
export function requestOpenSnapshotImport(payload: PendingSnapshotImport) {
  pendingImport = { fileBytes: payload.fileBytes, fileName: payload.fileName, snapshotKind: payload.snapshotKind };
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_SNAPSHOT_IMPORT_EVENT));
}

/** Consume and clear the pending import (Agents page mount). */
export function consumePendingSnapshotImport(): PendingSnapshotImport | null {
  const payload = pendingImport;
  pendingImport = null;
  return payload;
}

/** The mounted Agents page consumes each new request. */
export function subscribeSnapshotImport(handler: (payload: PendingSnapshotImport) => void): () => void {
  function handleEvent() {
    const payload = consumePendingSnapshotImport();
    if (payload) handler(payload);
  }
  window.addEventListener(OPEN_SNAPSHOT_IMPORT_EVENT, handleEvent);
  return () => window.removeEventListener(OPEN_SNAPSHOT_IMPORT_EVENT, handleEvent);
}

/** Host navigation to its Agents page; never consumes the payload. */
export function subscribeSnapshotImportNavigation(handler: () => void): () => void {
  window.addEventListener(OPEN_SNAPSHOT_IMPORT_EVENT, handler);
  return () => window.removeEventListener(OPEN_SNAPSHOT_IMPORT_EVENT, handler);
}
