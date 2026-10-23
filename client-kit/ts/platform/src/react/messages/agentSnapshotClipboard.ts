// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/messages/lib/agentSnapshotClipboard.ts
// DD-131(7)、DD-143: the original "copy snapshot" clipboard format. The attribute name and payload
// shape are kept; Kailo omits the Blossom `url` because media is Tenant/scope-bound — the clipboard
// carries the PNG package itself and the HTML only names it. Pasting into any composer uploads the
// bytes through that conversation's own media chain as an ordinary `.agent.png`/`.team.png`
// attachment, so the recipient's snapshot card opens the import preview.
import { sha256Hex } from "../agent-library/AgentSnapshotImportDialog";

export const SNAPSHOT_CLIPBOARD_ATTRIBUTE = "data-buzz-agent-snapshot";
const MAX_AGENT_SNAPSHOT_BYTES = 10 * 1024 * 1024;
const MAX_TEAM_SNAPSHOT_BYTES = 50 * 1024 * 1024;
const MAX_DISPLAY_NAME_LENGTH = 200;
const MAX_FILENAME_LENGTH = 255;

export type SnapshotClipboardPayload = {
  version: 1; displayName: string; filename: string; sha256: string; size: number; type: "image/png";
};

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function buildSnapshotClipboardHtml(payload: SnapshotClipboardPayload): string {
  const encoded = encodeURIComponent(JSON.stringify(payload));
  return `<a ${SNAPSHOT_CLIPBOARD_ATTRIBUTE}="${encoded}">${escapeHtml(payload.displayName)}</a>`;
}

/** Clipboard HTML is untrusted: every field is checked before it can name an outbound attachment. */
export function parseSnapshotClipboardHtml(html: string): SnapshotClipboardPayload | null {
  const match = html.match(new RegExp(`\\b${SNAPSHOT_CLIPBOARD_ATTRIBUTE}=(?:"([^"]+)"|'([^']+)')`, "i"));
  const encoded = match?.[1] ?? match?.[2];
  if (!encoded) return null;
  let value: unknown;
  try { value = JSON.parse(decodeURIComponent(encoded)); } catch { return null; }
  if (!value || typeof value !== "object") return null;
  const c = value as Partial<SnapshotClipboardPayload>;
  const displayName = typeof c.displayName === "string" ? c.displayName.trim() : "";
  const filename = typeof c.filename === "string" ? c.filename.trim() : "";
  const sha256 = typeof c.sha256 === "string" ? c.sha256.trim().toLowerCase() : "";
  const max = filename.toLowerCase().endsWith(".team.png") ? MAX_TEAM_SNAPSHOT_BYTES : MAX_AGENT_SNAPSHOT_BYTES;
  if (c.version !== 1 || !displayName || displayName.length > MAX_DISPLAY_NAME_LENGTH
    || !filename || filename.length > MAX_FILENAME_LENGTH || filename.includes("/") || filename.includes("\\")
    || !/\.(?:agent|team)\.png$/i.test(filename) || !/^[0-9a-f]{64}$/.test(sha256)
    || typeof c.size !== "number" || !Number.isInteger(c.size) || c.size <= 0 || c.size > max
    || c.type !== "image/png") return null;
  return { version: 1, displayName, filename, sha256, size: c.size, type: "image/png" };
}

/** Copy a PNG snapshot package: the bytes as image/png plus the naming HTML. */
export async function writeSnapshotToClipboard(bytes: Uint8Array, displayName: string, filename: string): Promise<void> {
  const payload: SnapshotClipboardPayload = {
    version: 1, displayName, filename, sha256: await sha256Hex(bytes), size: bytes.length, type: "image/png",
  };
  const html = buildSnapshotClipboardHtml(payload);
  await navigator.clipboard.write([new ClipboardItem({
    "image/png": new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    "text/html": new Blob([html], { type: "text/html" }),
  })]);
}

/** FileReader works for every Blob the composer can receive (including non-native test DOMs). */
function readBlob(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Restore a pasted snapshot as a named file. Only bytes that match the payload's size and SHA-256
 * become `<filename>`; anything else is left to the composer's normal paste behavior.
 */
export async function restoreSnapshotPaste(html: string, file: File): Promise<File | null> {
  const payload = parseSnapshotClipboardHtml(html);
  if (!payload || file.type !== "image/png" || file.size !== payload.size) return null;
  const bytes = await readBlob(file);
  if (await sha256Hex(bytes) !== payload.sha256) return null;
  return new File([new Uint8Array(bytes)], payload.filename, { type: "image/png" });
}
