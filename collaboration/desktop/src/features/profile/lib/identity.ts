import type { Profile, UserProfileSummary } from "@/shared/api/types";
import { normalizePubkey, truncateNpub } from "@/shared/lib/pubkey";

export type UserProfileLookup = Record<string, UserProfileSummary>;

export { truncateNpub };

/**
 * Deep-equal two profile lookups by value. Used to stabilise the merged
 * `messageProfiles` reference at the ChannelScreen boundary: the underlying
 * `users-batch` query re-keys on the full sorted pubkey set, so typing churn
 * (a transient typing-only pubkey entering/leaving the set) produces a fresh
 * lookup object identity even when no profile value actually changed. That new
 * reference fails MessageRow's `prev.profiles === next.profiles` memo check and
 * re-renders the entire timeline on every keystroke-adjacent typing event.
 * Returning the previous reference when this reports equal keeps the memo
 * intact. Consumers read profiles by pubkey value only, never treating identity
 * as a change signal, so returning the stale-but-value-identical reference is
 * safe.
 */
export function profileLookupsEqual(
  a: UserProfileLookup,
  b: UserProfileLookup,
): boolean {
  if (a === b) {
    return true;
  }

  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) {
    return false;
  }

  for (const key of aKeys) {
    const prev = a[key];
    const next = b[key];
    if (
      next === undefined ||
      prev.displayName !== next.displayName ||
      prev.name !== next.name ||
      prev.avatarUrl !== next.avatarUrl ||
      prev.nip05Handle !== next.nip05Handle ||
      prev.ownerPubkey !== next.ownerPubkey ||
      prev.isAgent !== next.isAgent
    ) {
      return false;
    }
  }

  return true;
}

export function mergeCurrentProfileIntoLookup(
  profiles: UserProfileLookup | undefined,
  currentProfile:
    | Pick<Profile, "pubkey" | "displayName" | "avatarUrl" | "nip05Handle">
    | null
    | undefined,
) {
  if (!currentProfile) {
    return profiles;
  }

  return {
    ...(profiles ?? {}),
    [normalizePubkey(currentProfile.pubkey)]: {
      displayName: currentProfile.displayName,
      // `Profile` does not carry the kind-0 `name`; keep whatever the batch
      // lookup already resolved so mention aliases survive the merge.
      name: profiles?.[normalizePubkey(currentProfile.pubkey)]?.name ?? null,
      avatarUrl: currentProfile.avatarUrl,
      nip05Handle: currentProfile.nip05Handle,
      isAgent: profiles?.[normalizePubkey(currentProfile.pubkey)]?.isAgent,
      ownerPubkey:
        profiles?.[normalizePubkey(currentProfile.pubkey)]?.ownerPubkey ?? null,
    },
  };
}

export { resolveUserLabel, formatOwnerLabel } from "@client-kit/platform/react/messages/system/identity";
