// Extracted from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/sidebar/lib/channelSortPreference.ts.
import type { SidebarChannel, ChannelSortMode } from "./channel-group";
function channelRecencyMs(channel: SidebarChannel): number | null {
  if (!channel.lastMessageAt) return null;
  const ms = Date.parse(channel.lastMessageAt);
  return Number.isFinite(ms) ? ms : null;
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function compareChannelsByName(left: SidebarChannel, right: SidebarChannel): number {
  return (
    compareCodeUnits(left.name.toLowerCase(), right.name.toLowerCase()) ||
    compareCodeUnits(left.id, right.id)
  );
}

/**
 * Sorts a single sidebar grouping's channels by the selected mode.
 *
 * `alpha` orders by name (id tie-breaker). `recent` orders by last message
 * time, newest first; channels without any message activity sink to the
 * bottom in alphabetical order so quiet channels stay stable and findable.
 */
export function sortChannelsForSidebar<T extends SidebarChannel>(
  channels: T[],
  mode: ChannelSortMode,
): T[] {
  if (mode === "alpha") {
    return [...channels].sort(compareChannelsByName);
  }
  return [...channels].sort((left, right) => {
    const leftMs = channelRecencyMs(left);
    const rightMs = channelRecencyMs(right);
    if (leftMs !== null && rightMs !== null && leftMs !== rightMs) {
      return rightMs - leftMs;
    }
    if (leftMs !== null && rightMs === null) return -1;
    if (leftMs === null && rightMs !== null) return 1;
    return compareChannelsByName(left, right);
  });
}
