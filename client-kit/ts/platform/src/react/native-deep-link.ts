// DD-138(4)(5), 07 §4.8.3 / §4.8.4: a component notification or search result opens the
// binding's native page at a relative `path` inside the descriptor origin. The address is
// the descriptor origin plus that path, then the §4.7.2 launch parameters; a path that
// would leave the origin is ignored and the normal entry page opens instead.
import { nativeEmbedUrl, type EmbedPresentation } from "./native-embed-host";

export const COMPONENT_PATH_MAX_LENGTH = 1024;

// Backslash, whitespace and C0/C1 control characters, as in Core's delivery rule (07 §4.8.3).
function forbiddenPathCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f) || character === "\\" || /\s/u.test(character)) return true;
  }
  return false;
}

/** Shape rule only: one leading '/', at most 1024 characters, no backslash, whitespace or control characters. */
export function validComponentPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= COMPONENT_PATH_MAX_LENGTH
    && value.startsWith("/") && !value.startsWith("//") && !forbiddenPathCharacter(value);
}

/**
 * The frame address for `path` on an approved page, or the normal launch address when the
 * path is absent, malformed or resolves outside `page.origin`.
 */
export function nativeDeepLinkUrl(page: { url: string; origin: string }, path: string | undefined,
  presentation: EmbedPresentation): string {
  if (path !== undefined && validComponentPath(path)) {
    try {
      const target = new URL(path, page.origin);
      if (target.origin === page.origin) return nativeEmbedUrl(target.toString(), presentation);
    } catch { /* Unparseable: the normal page below. */ }
  }
  return nativeEmbedUrl(page.url, presentation);
}
