type EmojiAvatarDescriptor = {
  color: string;
  emoji: string;
};

const EMOJI_AVATAR_DATA_URL_PREFIX = "data:image/svg+xml,";
const EMOJI_AVATAR_FONT_SIZE = 258;

function escapeSvgText(text: string) {
  return text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

function unescapeSvgText(text: string) {
  return text
    .replace(/&gt;/gu, ">")
    .replace(/&lt;/gu, "<")
    .replace(/&amp;/gu, "&");
}

export function emojiAvatarDataUrl(emoji: string, color: string) {
  // Persist uncropped artwork. The consuming surface owns the silhouette:
  // human profiles clip this square to a circle, while agents clip it to the
  // shared squircle. Source-level rounding cannot be recovered by an outer
  // clip and made legacy emoji agents look circular inside their squircles.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="${color}"/><text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle" font-size="${EMOJI_AVATAR_FONT_SIZE}">${escapeSvgText(emoji)}</text></svg>`;
  return `${EMOJI_AVATAR_DATA_URL_PREFIX}${encodeURIComponent(svg)}`;
}

export function squareEmojiAvatarDataUrl(avatarUrl: string) {
  const descriptor = parseEmojiAvatarDataUrl(avatarUrl);
  return descriptor
    ? emojiAvatarDataUrl(descriptor.emoji, descriptor.color)
    : avatarUrl;
}

export function avatarSourceUrlForShape(
  avatarUrl: string | null,
  shape: "circle" | "squircle",
) {
  return shape === "squircle" && avatarUrl
    ? squareEmojiAvatarDataUrl(avatarUrl)
    : avatarUrl;
}

export function parseEmojiAvatarDataUrl(
  avatarUrl: string,
): EmojiAvatarDescriptor | null {
  if (!avatarUrl.startsWith(EMOJI_AVATAR_DATA_URL_PREFIX)) {
    return null;
  }

  try {
    const svg = decodeURIComponent(
      avatarUrl.slice(EMOJI_AVATAR_DATA_URL_PREFIX.length),
    );
    const match = svg.match(
      /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512"(?: rx="(?:112|256)")? fill="([^"]+)"\/><text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle" font-size="258">([^<>]*)<\/text><\/svg>$/u,
    );

    if (!match) {
      return null;
    }

    return { color: match[1], emoji: unescapeSvgText(match[2]) };
  } catch {
    return null;
  }
}
