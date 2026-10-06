// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/channels/lib/canonicalChannelName.ts; original implementation.
/**
 * Returns the stored form of a channel name after removing the display prefix.
 * Keep this aligned with `buzz_core::channel::canonical_channel_name`.
 */
export function canonicalChannelName(name: string): string {
  return name.replace(/^[#\s]+/u, "").trimEnd();
}

export function channelNamesMatch(left: string, right: string): boolean {
  return (
    canonicalChannelName(left).toLowerCase() ===
    canonicalChannelName(right).toLowerCase()
  );
}
