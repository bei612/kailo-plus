/** Minimal shape of an imeta entry as consumed by the markdown renderer. */
export type FileCardImetaEntry = {
  m?: string;
  size?: number;
  filename?: string;
  /** SHA-256 of the attachment bytes (imeta `x`). */
  x?: string;
};

/**
 * Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/shared/ui/markdownFileCard.ts::resolveSnapshotCard.
 * A snapshot attachment (DD-131(5)(7)) renders as the importable card with Import and Download.
 * The host resolves the authorized href; `thumb` is left to the host (agent PNG cards only).
 */
export type ResolvedSnapshotCard = {
  displayName: string;
  href: string;
  filename: string;
  size?: number;
  sha256: string;
  snapshotKind: "agent" | "team";
  /** Whether the attachment is the agent PNG card (its body is the card image). */
  isAgentPng: boolean;
};

function snapshotDisplayName(filename: string, childText: string): string {
  const label = childText.trim();
  const labelIsSnapshotFilename = /\.(?:agent|team)\.(?:json|png)$/i.test(label);
  if (label && !labelIsSnapshotFilename) return label;
  const filenameStem = filename
    .replace(/\.(?:agent|team)\.(?:json|png)$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  if (!filenameStem) return /\.team\./i.test(filename) ? "Team" : "Agent";
  return filenameStem
    .split(/\s+/)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

/**
 * Original classification: exact `.agent.json/.agent.png/.team.json/.team.png` suffix; for PNG the
 * MIME must be image/png when present; a 64-hex `x` digest is required for the verified fetch.
 * Returns `null` to fall through to the generic FileCard.
 */
export function resolveSnapshotCard(
  entry: FileCardImetaEntry | undefined,
  href: string | undefined,
  childText: string,
): ResolvedSnapshotCard | null {
  if (!href || !entry) return null;
  const filename = entry.filename || childText.trim() || (href.split("/").pop() ?? "");
  if (!filename) return null;
  const lower = filename.toLowerCase();
  const isJson = lower.endsWith(".agent.json");
  const isPng = lower.endsWith(".agent.png");
  const isTeamJson = lower.endsWith(".team.json");
  const isTeamPng = lower.endsWith(".team.png");
  if (!isJson && !isPng && !isTeamJson && !isTeamPng) return null;
  if ((isPng || isTeamPng) && entry.m && entry.m !== "image/png") return null;
  const sha256 = entry.x?.trim().toLowerCase();
  if (!sha256 || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  return {
    displayName: snapshotDisplayName(filename, childText),
    href,
    filename,
    size: entry.size,
    sha256,
    snapshotKind: isJson || isPng ? "agent" : "team",
    isAgentPng: isPng,
  };
}

export type ResolvedFileCard = {
  href: string;
  filename: string;
  size?: number;
};

/** Original generic-file classification and filename precedence. */
export function resolveFileCard(
  entry: FileCardImetaEntry | undefined,
  href: string | undefined,
  childText: string,
): ResolvedFileCard | null {
  if (
    !href ||
    !entry?.m ||
    entry.m.startsWith("image/") ||
    entry.m.startsWith("video/")
  ) {
    return null;
  }
  const filename =
    entry.filename || childText.trim() || href.split("/").pop() || "file";
  return { href, filename, size: entry.size };
}
