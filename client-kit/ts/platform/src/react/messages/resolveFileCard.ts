/** Minimal shape of an imeta entry as consumed by the markdown renderer. */
export type FileCardImetaEntry = {
  m?: string;
  size?: number;
  filename?: string;
  /** SHA-256 of the attachment bytes (imeta `x`); required for snapshot cards. */
  x?: string;
};

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

/**
 * Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/shared/ui/markdownFileCard.ts
 * ::resolveSnapshotCard (DD-143): an Agent/team snapshot attachment classified by its
 * `.agent.json|.agent.png|.team.json|.team.png` filename, PNG only as `image/png`, and only
 * with a 64-hex `x` so its bytes can be verified. Hosts rewrite `href`/`thumb` to their own
 * authorized media route.
 */
export type ResolvedSnapshotCard = {
  displayName: string;
  href: string;
  filename: string;
  size?: number;
  sha256: string;
  snapshotKind: "agent" | "team";
  /** Agent PNG snapshots carry the avatar card image; team PNGs use the team icon. */
  thumb?: string;
};

function snapshotDisplayName(filename: string, childText: string): string | null {
  const label = childText.trim();
  if (label && !/\.(?:agent|team)\.(?:json|png)$/i.test(label)) return label;
  const stem = filename.replace(/\.(?:agent|team)\.(?:json|png)$/i, "").replace(/[-_]+/g, " ").trim();
  if (!stem) return null;
  return stem.split(/\s+/).map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(" ");
}

export function resolveSnapshotCard(
  entry: FileCardImetaEntry | undefined,
  href: string | undefined,
  childText: string,
): ResolvedSnapshotCard | null {
  if (!href || !entry) return null;
  const filename = entry.filename || childText.trim() || (href.split("/").pop() ?? "");
  if (!filename) return null;
  const lower = filename.toLowerCase();
  const isPng = lower.endsWith(".agent.png");
  const isTeamPng = lower.endsWith(".team.png");
  const isAgent = isPng || lower.endsWith(".agent.json");
  const isTeam = isTeamPng || lower.endsWith(".team.json");
  if (!isAgent && !isTeam) return null;
  if ((isPng || isTeamPng) && entry.m && entry.m !== "image/png") return null;
  const sha256 = entry.x?.trim().toLowerCase();
  if (!sha256 || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  return {
    displayName: snapshotDisplayName(filename, childText) ?? "",
    href,
    filename,
    size: entry.size,
    sha256,
    snapshotKind: isAgent ? "agent" : "team",
    thumb: isPng ? href : undefined,
  };
}
