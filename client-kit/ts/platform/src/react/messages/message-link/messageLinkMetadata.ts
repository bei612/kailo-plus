// Shared from Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/lib/messageLinkMetadata.ts.
import { getLocale, translate, type PlatformLocale } from "../../../i18n";

const MESSAGE_LINK_SNIPPET_MAX_LENGTH = 160;

/** Build a compact, non-recursive plain-text preview for a linked message. */
export function summarizeMessageLinkContent(content: string, locale: PlatformLocale = getLocale()): string {
  const normalized = Array.from(content, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
      ? " "
      : character;
  })
    .join("")
    .replace(/\|\|[^|]*(?:\|(?!\|)[^|]*)*\|\|/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<?(?:https?|buzz):\/\/\S+>?/g, " ")
    .replace(/[`*_~>#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return translate(locale, "messageLink.noText");

  const characters = Array.from(normalized);
  if (characters.length <= MESSAGE_LINK_SNIPPET_MAX_LENGTH) return normalized;
  const clipped = characters
    .slice(0, MESSAGE_LINK_SNIPPET_MAX_LENGTH - 1)
    .join("");
  const lastSpace = clipped.lastIndexOf(" ");
  const snippet = lastSpace > 96 ? clipped.slice(0, lastSpace) : clipped;
  return `${snippet.trimEnd()}…`;
}
