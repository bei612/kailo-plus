// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/messages/lib/waveMessage.ts (original marker, builder and parser).
// DD-125(3): a Wave is a marked private-conversation kind:9 published through the existing
// DM publication; the wire content stays the original string so every client parses it.
export const WAVE_MESSAGE_MARKER = "<!-- buzz:wave:v1 -->";

export type WaveMessageContent = {
  fallbackText: string;
};

export function buildWaveMessageContent(senderName: string): string {
  const trimmedName = senderName.trim() || "Someone";
  return `${WAVE_MESSAGE_MARKER}\n${trimmedName} waved at you.`;
}

export function parseWaveMessageContent(
  content: string,
): WaveMessageContent | null {
  const trimmedContent = content.trimStart();

  if (!trimmedContent.startsWith(WAVE_MESSAGE_MARKER)) {
    return null;
  }

  const fallbackText = trimmedContent.slice(WAVE_MESSAGE_MARKER.length).trim();

  return {
    fallbackText: fallbackText || "Someone waved at you.",
  };
}

const WAVE_FALLBACK_PATTERN = /^(.+) waved at you\.$/s;

/**
 * Presentation only (Kailo zh-CN default): the builder's exact English line is shown in the
 * reader's locale; any other fallback text is shown as written. The wire content is unchanged.
 */
export function waveFallbackName(fallbackText: string): string | null {
  const match = WAVE_FALLBACK_PATTERN.exec(fallbackText);
  const name = match?.[1]?.trim();
  return name ? name : null;
}
