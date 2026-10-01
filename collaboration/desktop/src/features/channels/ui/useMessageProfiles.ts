import * as React from "react";

import {
  mergeCurrentProfileIntoLookup,
  profileLookupsEqual,
  type UserProfileLookup,
} from "@/features/profile/lib/identity";
import type { Profile } from "@/shared/api/types";

/**
 * The channel screen's message-row profile lookup: the `users-batch` query
 * profiles overlaid with the current profile.
 *
 * The returned reference is stabilised across renders when no profile value
 * changed: the raw merge gets a fresh identity whenever the `users-batch`
 * query re-keys, and that identity flows to MessageRow's
 * `prev.profiles === next.profiles` memo check, so an unstable reference
 * re-renders the whole timeline. Consumers read profiles by pubkey value only,
 * never treating identity as a change signal, so returning the
 * stale-but-value-identical reference is safe.
 */
export function useMessageProfiles({
  currentProfile,
  profiles,
}: {
  currentProfile: Profile | undefined;
  profiles: UserProfileLookup | undefined;
}): UserProfileLookup {
  const raw = React.useMemo(
    () => mergeCurrentProfileIntoLookup(profiles, currentProfile) ?? {},
    [currentProfile, profiles],
  );

  const ref = React.useRef(raw);
  if (!profileLookupsEqual(ref.current, raw)) {
    ref.current = raw;
  }
  return ref.current;
}
