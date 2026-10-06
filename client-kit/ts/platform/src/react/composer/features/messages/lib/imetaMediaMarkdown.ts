/**
 * Helpers that turn composer attachments into NIP-92 imeta tags and markdown
 * media lines for outbound messages. `ImetaMedia` is exactly the
 * `BlobDescriptor` shape so it plugs into the composer's pending attachments.
 */

import type { WebMessageAttachment } from "@client-kit/contracts";
/** Native Buzz upload metadata; base fields use the generated four-language attachment contract. */
export type BlobDescriptor = WebMessageAttachment & {
  uploaded: number; dim?: string; blurhash?: string; thumb?: string; duration?: number; image?: string; filename?: string;
};

export type ImetaMedia = BlobDescriptor & {
  /** Composer-only label used for attachment links; not emitted in imeta. */
  displayLabel?: string;
};

/**
 * Build the imeta tag set for an outbound event from a list of attachments.
 *
 * `url`, `m`, and `x` are emitted for verified relay-hosted media. Entries
 * without a hash represent external content (for example KLIPY GIFs); their
 * markdown URL remains in the message body, but they are omitted from imeta
 * because Buzz's relay validator requires a hash-backed local `/media/` path.
 * Other fields remain conditional so legacy entries do not emit invalid
 * literal `"size 0"` values.
 */
export function buildImetaTags(
  imetaMedia: ReadonlyArray<ImetaMedia>,
): string[][] {
  return imetaMedia
    .filter((d) => d.sha256.length > 0)
    .map((d) => [
      "imeta",
      `url ${d.url}`,
      `m ${d.type}`,
      `x ${d.sha256}`,
      ...(typeof d.size === "number" && d.size > 0 ? [`size ${d.size}`] : []),
      ...(d.dim ? [`dim ${d.dim}`] : []),
      ...(d.blurhash ? [`blurhash ${d.blurhash}`] : []),
      ...(d.thumb ? [`thumb ${d.thumb}`] : []),
      ...(d.duration != null ? [`duration ${d.duration}`] : []),
      ...(d.image ? [`image ${d.image}`] : []),
      ...(d.filename ? [`filename ${d.filename}`] : []),
    ]);
}

/**
 * Format a single imeta entry as a leading-newline markdown line.
 *
 * Images and video use `![image|video](url)` so the renderer draws them inline.
 * Generic files use a plain `[filename](url)` link — the renderer recognises the
 * href as a local media blob with a non-media MIME and upgrades it to a file
 * card. Agent snapshot PNGs deliberately use the file-link form despite their
 * image MIME so the renderer can upgrade them to the import/download card.
 */
export function formatImetaMediaLine(
  { url, type, filename }: ImetaMedia,
  options: { label?: string; spoiler?: boolean } = {},
): string {
  // A PNG snapshot is image/png on the wire, but it is an importable file, not
  // inline media. Keep it on the anchor renderer's snapshot-card path.
  const lower = filename?.toLowerCase();
  const isSnapshotPng =
    lower?.endsWith(".agent.png") || lower?.endsWith(".team.png");
  const isPackagedVoiceNote =
    type.toLowerCase() === "video/mp4" &&
    lower?.startsWith("voice-note-") &&
    lower.endsWith(".mp4");
  if (type.startsWith("video/") && !isPackagedVoiceNote) {
    const line = `![video](${url})`;
    return options.spoiler ? `\n||${line}||` : `\n${line}`;
  }
  if (type.startsWith("image/") && !isSnapshotPng) {
    const line = `![image](${url})`;
    return options.spoiler ? `\n||${line}||` : `\n${line}`;
  }
  // Generic file: plain link, label is the caller-provided display label when
  // available, otherwise the original filename (falling back to the URL tail).
  // The filename remains in imeta for download/import integrity.
  const label =
    options.label?.trim() || filename || url.split("/").pop() || "file";
  // Escape markdown link-label metacharacters so filenames containing `[`, `]`,
  // or `\` (e.g. `a].pdf`) still render as a FileCard with the correct label
  // rather than breaking the link or mangling the visible text.
  const escaped = label.replace(/[\\[\]]/g, "\\$&");
  return `\n[${escaped}](${url})`;
}

/**
 * Build the body + tags pair for an outgoing message. Appends
 * `![image|video](url)` markdown lines for each attachment to the body so the
 * renderer (which keys on URLs literally present in the content) draws them,
 * and returns the matching imeta tag set.
 *
 * Returns `mediaTags: undefined` when there are no attachments.
 */
export function buildOutgoingMessage(
  body: string,
  pendingImeta: ReadonlyArray<ImetaMedia>,
  spoileredMediaUrls: ReadonlySet<string> = new Set(),
): { content: string; mediaTags: string[][] | undefined } {
  let content = body;
  for (const d of pendingImeta) {
    content += formatImetaMediaLine(d, {
      label: d.displayLabel,
      spoiler: spoileredMediaUrls.has(d.url),
    });
  }
  const mediaTags = buildImetaTags(pendingImeta);
  return {
    content,
    mediaTags: mediaTags.length > 0 ? mediaTags : undefined,
  };
}

/**
 * Merge optional imeta media tags with NIP-30 custom-emoji tags into the final
 * outgoing tag set. Returns `undefined` when there are no tags of either kind
 * (the publish path treats `undefined` as "no extra tags").
 */
export function mergeOutgoingTags(
  mediaTags: string[][] | undefined,
  emojiTags: string[][],
): string[][] | undefined {
  if (!mediaTags && emojiTags.length === 0) return undefined;
  return [...(mediaTags ?? []), ...emojiTags];
}

/**
 * Inverse of `mergeOutgoingTags`: split a merged outgoing tag set back into
 * imeta media tags, NIP-30 `["emoji", ...]` tags, and reference-only mention
 * tags, so the send path can route each to its own validated Tauri arg. Emoji
 * and mention tags must never ride the imeta-only `media` channel (its guard
 * rejects any non-imeta prefix). Any other prefix stays with `mediaTags` — the
 * imeta guard will reject it, which is the intended injection defense.
 */
export function splitOutgoingTags(tags: string[][] | undefined): {
  mediaTags: string[][];
  emojiTags: string[][];
  mentionTags: string[][];
  linkPreviewTags: string[][];
} {
  const mediaTags: string[][] = [];
  const emojiTags: string[][] = [];
  const mentionTags: string[][] = [];
  const linkPreviewTags: string[][] = [];
  for (const tag of tags ?? []) {
    if (tag[0] === "emoji") {
      emojiTags.push(tag);
    } else if (tag[0] === "mention") {
      mentionTags.push(tag);
    } else if (tag[0] === "link-preview") {
      linkPreviewTags.push(tag);
    } else {
      mediaTags.push(tag);
    }
  }
  return { mediaTags, emojiTags, mentionTags, linkPreviewTags };
}
