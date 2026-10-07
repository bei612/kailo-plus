import * as React from "react";

import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { resolveMessageMentionClipboard } from "@client-kit/platform/react/messages/resolveMentionNames";

/**
 * The `label → pubkey` pairs a delivered message tagged.
 *
 * Same alias set the renderer chips against (`resolveMentionProps`), so any
 * `@name` the body shows resolves to the identity the author actually tagged
 * — which is exactly what a copy needs to carry.
 */
export function useMessageMentionClipboard(
  tags: string[][] | undefined,
  profiles: UserProfileLookup | undefined,
  content = "",
) {
  return React.useMemo(
    () => resolveMessageMentionClipboard(tags, profiles, content),
    [profiles, tags, content],
  );
}
