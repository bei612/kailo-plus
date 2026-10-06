import type { MarkdownProps } from "./markdown/types";
export { classifyChildren, isImageOnlyParagraph, hasBlockMedia } from "@client-kit/platform/react/composer/shared/ui/markdownMedia";
export function shallowArrayEqual(a?: string[], b?: string[]): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Value-equality for the small name→pubkey mention maps. Several call sites
 * (forum cards, feed rows) rebuild the map inline on every render — comparing
 * by value in the `Markdown` memo keeps those fresh-but-identical objects from
 * re-rendering (and DOM-swapping) the whole markdown tree.
 */
export function shallowRecordEqual(
  a?: Record<string, string>,
  b?: Record<string, string>,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

export function markdownPropsAreEqual(
  prev: MarkdownProps,
  next: MarkdownProps,
): boolean {
  return (
    prev.content === next.content &&
    prev.className === next.className &&
    prev.hardLineBreaks === next.hardLineBreaks &&
    prev.interactive === next.interactive &&
    prev.blockCode === next.blockCode &&
    prev.mediaInset === next.mediaInset &&
    shallowRecordEqual(prev.mentionPubkeysByName, next.mentionPubkeysByName) &&
    shallowArrayEqual(prev.mentionNames, next.mentionNames) &&
    shallowArrayEqual(prev.channelNames, next.channelNames) &&
    prev.imetaByUrl === next.imetaByUrl &&
    prev.searchQuery === next.searchQuery &&
    prev.videoReviewContext === next.videoReviewContext
  );
}
