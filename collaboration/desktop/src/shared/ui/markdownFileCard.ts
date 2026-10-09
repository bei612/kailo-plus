import {
  resolveFileCard as resolveSharedFileCard,
  type FileCardImetaEntry,
  type ResolvedFileCard,
} from "@client-kit/platform/react/messages/resolveFileCard";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";
export type { FileCardImetaEntry, ResolvedFileCard };

/**
 * Decide whether a markdown link should render as a generic-file download
 * card. A link qualifies when its href matches an imeta entry whose MIME is
 * neither image nor video (media goes through the `img` renderer instead).
 *
 * Pure — extracted from `markdown.tsx` so the FileCard decision (the riskiest
 * part of the generic-file rendering path) is unit-testable without mounting
 * React. Returns the resolved card props, or `null` to fall through to normal
 * link handling.
 */
export function resolveFileCard(
  entry: FileCardImetaEntry | undefined,
  href: string | undefined,
  childText: string,
): ResolvedFileCard | null {
  const card = resolveSharedFileCard(entry, href, childText);
  return card ? { ...card, href: rewriteRelayUrl(card.href) } : null;
}
