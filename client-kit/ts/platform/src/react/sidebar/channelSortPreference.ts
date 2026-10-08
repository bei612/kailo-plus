// Extracted unchanged from the pinned Buzz sidebar implementation; presentation preference only.
import { normalizeRelayUrl } from "./normalizeRelayUrl";

const STORAGE_KEY_PREFIX = "buzz-channel-sort.v1";

export type ChannelSortMode = "alpha" | "recent";

/** Sidebar groupings that carry their own sort preference. */
export type ChannelSortGroupKey = "starred" | "channels" | "forums" | "dms";

export type ChannelSortStore = {
  version: 1;
  groups: Record<string, ChannelSortMode>;
};

export const DEFAULT_SORT_MODE: ChannelSortMode = "alpha";

export const DEFAULT_STORE: ChannelSortStore = Object.freeze({
  version: 1,
  groups: {},
});

/**
 * Returns the localStorage key for the sidebar channel sort preferences.
 *
 * When `relayUrl` is provided the key is scoped to that relay (normalized via
 * the same `normalizeRelayUrl` used by all relay-scoped local stores) so
 * preferences don't bleed across communities/relays.
 */
export function storageKey(pubkey: string, relayUrl?: string): string {
  if (!relayUrl) return `${STORAGE_KEY_PREFIX}:${pubkey}`;
  const normalized = normalizeRelayUrl(relayUrl);
  // Encode the normalized relay so it can't contain the `:` delimiter.
  return `${STORAGE_KEY_PREFIX}:${pubkey}:${encodeURIComponent(normalized)}`;
}

export function parseChannelSortPayload(
  json: unknown,
): ChannelSortStore | null {
  if (typeof json !== "object" || json === null) return null;
  const obj = json as Record<string, unknown>;
  if (obj.version !== 1) return null;
  const groups: Record<string, ChannelSortMode> =
    typeof obj.groups === "object" &&
    obj.groups !== null &&
    !Array.isArray(obj.groups)
      ? Object.fromEntries(
          Object.entries(obj.groups as Record<string, unknown>).filter(
            (entry): entry is [string, ChannelSortMode] =>
              entry[1] === "alpha" || entry[1] === "recent",
          ),
        )
      : {};
  return { version: 1, groups };
}

export function readChannelSortStore(
  pubkey: string,
  relayUrl?: string,
): ChannelSortStore {
  try {
    const raw = window.localStorage.getItem(storageKey(pubkey, relayUrl));
    if (!raw) return DEFAULT_STORE;
    return parseChannelSortPayload(JSON.parse(raw)) ?? DEFAULT_STORE;
  } catch {
    return DEFAULT_STORE;
  }
}

export function writeChannelSortStore(
  pubkey: string,
  store: ChannelSortStore,
  relayUrl?: string,
): boolean {
  try {
    window.localStorage.setItem(
      storageKey(pubkey, relayUrl),
      JSON.stringify(store),
    );
    return true;
  } catch {
    return false;
  }
}

export function sortModeForGroup(
  store: ChannelSortStore,
  group: ChannelSortGroupKey,
): ChannelSortMode {
  return store.groups[group] ?? DEFAULT_SORT_MODE;
}


export { compareChannelsByName, sortChannelsForSidebar } from "./channel-sort";
