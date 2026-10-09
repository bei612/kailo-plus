// Shared original Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/shared/lib/linkPreviewSnapshot.ts.
import {
  extractSupportedLinkPreviews,
  parseSupportedLinkPreview,
  type SupportedLinkPreview,
} from "./linkPreview";
import type { ResolvedLinkPreview } from "./types";

// Original desktop/src/shared/ui/markdown/useMessageLinkPreviews.ts.
export function mergeMessageLinkPreviews(
  candidates: SupportedLinkPreview[],
  snapshots: ResolvedLinkPreview[],
): ResolvedLinkPreview[] {
  const snapshotsByHref = new Map(
    snapshots.map((preview) => [preview.href, preview]),
  );
  return candidates.flatMap((candidate) => {
    const preview = snapshotsByHref.get(candidate.href);
    return preview ? [preview] : [];
  });
}

export const LINK_PREVIEW_SNAPSHOT_VERSION = "1";
const MAX_SNAPSHOTS = 8;
const SHA256_RE = /^[0-9a-f]{64}$/;
const IMAGE_EXT_RE = /^(?:jpg|png|gif|webp)$/;

export function isValidLinkPreviewSnapshotCanonicalUrl(value: string): boolean {
  if (value.includes("#")) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && !url.username && !url.password && !url.hash
    );
  } catch {
    return false;
  }
}

export type LinkPreviewSnapshot = {
  canonicalUrl: string;
  title: string;
  siteName: string;
  description: string;
  imageUrl: string;
  imageSha256: string;
  faviconUrl: string;
  faviconSha256: string;
};

function isControlCharacter(char: string, allowNewlines = false): boolean {
  if (allowNewlines && char === "\n") return false;
  const code = char.charCodeAt(0);
  return code <= 0x1f || code === 0x7f;
}

function sanitizeSnapshotText(
  value: string,
  maxBytes: number,
  allowNewlines = false,
): string {
  let result = "";
  let byteLength = 0;
  for (const rawChar of value) {
    const char = isControlCharacter(rawChar, allowNewlines) ? " " : rawChar;
    const charBytes = new TextEncoder().encode(char).length;
    if (byteLength + charBytes > maxBytes) break;
    result += char;
    byteLength += charBytes;
  }
  return result;
}

function validText(value: string, max: number, allowNewlines = false): boolean {
  return (
    new TextEncoder().encode(value).length <= max &&
    !Array.from(value).some((char) => {
      return isControlCharacter(char, allowNewlines);
    })
  );
}

/** Native retains its trusted Relay-origin check. Web resolves only the hash
 * through its admitted BFF scope; an authored URL is never a proxy target. */
type SnapshotMediaHost = string | ((sha256: string) => string | null);

function resolveRelayMediaPair(
  url: string,
  sha256: string,
  host: SnapshotMediaHost,
): string | null {
  if (!url && !sha256) return "";
  if (!url || !SHA256_RE.test(sha256)) return null;
  try {
    const parsed = new URL(url);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      (typeof host === "string" && parsed.origin !== host) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      return null;
    const match = /^\/media\/([0-9a-f]{64})\.([a-z0-9]{1,8})$/.exec(
      parsed.pathname,
    );
    if (!match || match[1] !== sha256 || !IMAGE_EXT_RE.test(match[2] ?? ""))
      return null;
    return typeof host === "string" ? url : host(sha256);
  } catch {
    return null;
  }
}

export function parseLinkPreviewSnapshots(
  tags: readonly (readonly string[])[] | undefined,
  content: string,
  host: SnapshotMediaHost | null,
): ResolvedLinkPreview[] {
  if (!host || !tags) return [];
  const contentUrls = new Set(
    extractSupportedLinkPreviews(content).map((preview) => preview.href),
  );
  const seen = new Set<string>();
  const snapshots: ResolvedLinkPreview[] = [];
  for (const tag of tags) {
    if (tag[0] !== "link-preview" || tag[1] !== "snapshot") continue;
    if (
      snapshots.length >= MAX_SNAPSHOTS ||
      tag.length !== 11 ||
      !tag.every((field) => typeof field === "string") ||
      tag[2] !== LINK_PREVIEW_SNAPSHOT_VERSION
    )
      continue;
    const [
      ,
      ,
      ,
      canonicalUrl = "",
      title = "",
      siteName = "",
      description = "",
      imageUrl = "",
      imageSha256 = "",
      faviconUrl = "",
      faviconSha256 = "",
    ] = tag;
    const parsed = parseSupportedLinkPreview(canonicalUrl);
    if (
      !parsed ||
      parsed.href !== canonicalUrl ||
      !contentUrls.has(canonicalUrl) ||
      seen.has(canonicalUrl)
    )
      continue;
    if (
      !validText(title, 300) ||
      !validText(siteName, 100) ||
      !validText(description, 1000, true)
    )
      continue;
    const image = resolveRelayMediaPair(imageUrl, imageSha256, host);
    const favicon = resolveRelayMediaPair(faviconUrl, faviconSha256, host);
    if (image === null || favicon === null) continue;
    seen.add(canonicalUrl);
    snapshots.push({
      ...parsed,
      title: title || parsed.title,
      provider: siteName || parsed.provider,
      description: description || null,
      faviconDataUrl: favicon || null,
      imageDataUrl: image || null,
      imageDomain: imageUrl ? new URL(imageUrl).hostname : null,
      imageState: image ? "image" : "none",
    });
  }
  return snapshots;
}

export function buildLinkPreviewSnapshotTag(
  snapshot: LinkPreviewSnapshot,
): string[] | null {
  if (!isValidLinkPreviewSnapshotCanonicalUrl(snapshot.canonicalUrl))
    return null;
  return [
    "link-preview",
    "snapshot",
    LINK_PREVIEW_SNAPSHOT_VERSION,
    snapshot.canonicalUrl,
    sanitizeSnapshotText(snapshot.title, 300),
    sanitizeSnapshotText(snapshot.siteName, 100),
    sanitizeSnapshotText(snapshot.description, 1000, true),
    snapshot.imageUrl,
    snapshot.imageSha256,
    snapshot.faviconUrl,
    snapshot.faviconSha256,
  ];
}
