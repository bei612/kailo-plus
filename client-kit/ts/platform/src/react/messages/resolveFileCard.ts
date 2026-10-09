/** Minimal shape of an imeta entry as consumed by the markdown renderer. */
export type FileCardImetaEntry = {
  m?: string;
  size?: number;
  filename?: string;
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
