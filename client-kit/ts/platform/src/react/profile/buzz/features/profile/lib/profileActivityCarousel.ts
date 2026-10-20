// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/profile/lib/profileActivityCarousel.ts (unchanged).
export function resolveActivityChannelId(
  slides: string[],
  selectedChannelId: string | null,
  preferredChannelId: string | null,
): string | null {
  if (selectedChannelId && slides.includes(selectedChannelId)) {
    return selectedChannelId;
  }
  if (preferredChannelId && slides.includes(preferredChannelId)) {
    return preferredChannelId;
  }
  return slides[0] ?? null;
}
