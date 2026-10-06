// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/messages/lib/imetaMediaMarkdown.ts.
import type { ImetaMedia } from "../composer/features/messages/lib/imetaMediaMarkdown";
import { parseImetaTags } from "./parseImeta";
export function imetaMediaFromTags(
  tags: ReadonlyArray<ReadonlyArray<string>> | undefined,
): ImetaMedia[] {
  if (!tags || tags.length === 0) return [];
  const entries = parseImetaTags(tags as string[][]);
  const out: ImetaMedia[] = [];
  for (const entry of entries.values()) {
    if (!entry.url) continue;
    out.push({
      url: entry.url,
      type: entry.m ?? "image/jpeg",
      sha256: entry.x ?? "",
      size: entry.size ?? 0,
      uploaded: 0,
      ...(entry.dim ? { dim: entry.dim } : {}),
      ...(entry.blurhash ? { blurhash: entry.blurhash } : {}),
      ...(entry.thumb ? { thumb: entry.thumb } : {}),
      ...(entry.duration != null ? { duration: entry.duration } : {}),
      ...(entry.image ? { image: entry.image } : {}),
      ...(entry.filename ? { filename: entry.filename } : {}),
    });
  }
  return out;
}

const MEDIA_LINE_RE =
  /^(?:\|\|)?!\[(?:image|video)\]\(([^)\s]+)\)(?:\|\|)?\s*$/;
const SPOILERED_MEDIA_LINE_RE =
  /^\|\|!\[(?:image|video)\]\(([^)\s]+)\)\|\|\s*$/;
const BLOCK_SPOILER_DELIMITER_RE = /^\s*\|\|\s*$/;
/**
 * Matches a generic file-attachment line `[label](url)` (no leading `!`, so it's
 * a link not an image). The label can contain spaces and backslash-escaped
 * brackets (e.g. `a\]`); the URL must be paren- and space-free. Used to strip
 * file attachments from the body in edit mode.
 */
const FILE_LINE_RE = /^\[(?:\\.|[^\]\\])*\]\(([^)\s]+)\)\s*$/;
const LABELED_FILE_LINE_RE = /^\[((?:\\.|[^\]\\])*)\]\(([^)\s]+)\)\s*$/;

function unescapeMarkdownLinkLabel(label: string): string {
  return label.replace(/\\([\\[\]])/g, "$1");
}

/**
 * Restore composer-only attachment labels from the durable markdown link in
 * an existing message body. NIP-92 imeta tags preserve the attachment file
 * metadata but not the visible link label, so edit mode must join the two
 * representations before seeding pending attachments.
 */
export function restoreImetaMediaDisplayLabels(
  body: string,
  imetaMedia: ReadonlyArray<ImetaMedia>,
): ImetaMedia[] {
  if (imetaMedia.length === 0) return [];

  const urls = new Set(imetaMedia.map((media) => media.url));
  const labelsByUrl = new Map<string, string>();
  const lines = body.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!;
    const match = line.match(LABELED_FILE_LINE_RE);
    const url = match?.[2];
    if (!url || !urls.has(url) || labelsByUrl.has(url)) continue;

    const label = unescapeMarkdownLinkLabel(match[1]!).trim();
    if (label) labelsByUrl.set(url, label);
  }

  return imetaMedia.map((media) => {
    const displayLabel = labelsByUrl.get(media.url);
    return displayLabel ? { ...media, displayLabel } : media;
  });
}

function findTrailingBlockSpoilerMediaStart(
  lines: string[],
  closingDelimiterIndex: number,
  urls: ReadonlySet<string>,
): number | null {
  let index = closingDelimiterIndex - 1;
  let hasMatchingMedia = false;

  while (index >= 0) {
    const line = lines[index]!;
    if (line.trim() === "") {
      index -= 1;
      continue;
    }

    if (BLOCK_SPOILER_DELIMITER_RE.test(line)) {
      return hasMatchingMedia ? index : null;
    }

    const match = line.match(MEDIA_LINE_RE);
    if (!match || !urls.has(match[1]!)) return null;

    hasMatchingMedia = true;
    index -= 1;
  }

  return null;
}

/**
 * Remove trailing `![image|video](url)` lines whose URL matches an entry in
 * `imetaMedia`. Stops at the first non-matching/non-blank line so attachments
 * that have been moved or interleaved with text are left alone (the composer
 * only ever produces trailing lines, but defending against shape drift is
 * cheap).
 */
export function stripImetaMediaLines(
  body: string,
  imetaMedia: ReadonlyArray<ImetaMedia>,
): string {
  if (imetaMedia.length === 0) return body;
  const urls = new Set(imetaMedia.map((m) => m.url));
  const lines = body.split("\n");

  let end = lines.length;
  while (end > 0) {
    const line = lines[end - 1]!;
    if (line.trim() === "") {
      end -= 1;
      continue;
    }
    if (BLOCK_SPOILER_DELIMITER_RE.test(line)) {
      const start = findTrailingBlockSpoilerMediaStart(lines, end - 1, urls);
      if (start != null) {
        end = start;
        continue;
      }
    }
    const match = line.match(MEDIA_LINE_RE) ?? line.match(FILE_LINE_RE);
    if (match && urls.has(match[1]!)) {
      end -= 1;
      continue;
    }
    break;
  }

  return lines.slice(0, end).join("\n").replace(/\s+$/, "");
}

export function findSpoileredImetaMediaUrls(
  body: string,
  imetaMedia: ReadonlyArray<ImetaMedia>,
): Set<string> {
  if (imetaMedia.length === 0) return new Set();

  const urls = new Set(imetaMedia.map((m) => m.url));
  const spoileredUrls = new Set<string>();
  const lines = body.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = line.match(SPOILERED_MEDIA_LINE_RE);
    if (match && urls.has(match[1]!)) {
      spoileredUrls.add(match[1]!);
      continue;
    }

    if (!BLOCK_SPOILER_DELIMITER_RE.test(line)) continue;

    const blockSpoileredUrls = new Set<string>();
    let closingDelimiterIndex = -1;
    for (
      let blockIndex = index + 1;
      blockIndex < lines.length;
      blockIndex += 1
    ) {
      const blockLine = lines[blockIndex]!;
      if (BLOCK_SPOILER_DELIMITER_RE.test(blockLine)) {
        closingDelimiterIndex = blockIndex;
        break;
      }

      const blockMatch = blockLine.match(MEDIA_LINE_RE);
      if (blockMatch && urls.has(blockMatch[1]!)) {
        blockSpoileredUrls.add(blockMatch[1]!);
      }
    }

    if (closingDelimiterIndex !== -1) {
      for (const url of blockSpoileredUrls) spoileredUrls.add(url);
      index = closingDelimiterIndex;
    }
  }
  return spoileredUrls;
}
