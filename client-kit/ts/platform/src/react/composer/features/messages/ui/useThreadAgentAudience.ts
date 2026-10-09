// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/messages/ui/useThreadAgentAudience.ts.
import * as React from "react";

import { useKeepMentionedAgentsPinned } from "../lib/autoPinMentionedAgentsPreference";
import {
  initializePersistentAgentAudience,
  usePersistentAgentAudience,
} from "../lib/persistentAgentAudience";

export function useThreadAgentAudience({
  isAgentPubkey,
  rootTags,
  scope,
}: {
  isAgentPubkey: (pubkey: string) => boolean;
  rootTags: readonly string[][];
  scope: string | null;
}) {
  const audience = usePersistentAgentAudience(scope);
  const keepMentionedAgentsPinned = useKeepMentionedAgentsPinned();

  const rootAgentPubkeys = React.useMemo(
    () =>
      rootTags.flatMap((tag) => {
        const pubkey = tag[0] === "p" ? tag[1] : null;
        return pubkey && isAgentPubkey(pubkey) ? [pubkey] : [];
      }),
    [isAgentPubkey, rootTags],
  );

  React.useEffect(() => {
    if (!scope || !keepMentionedAgentsPinned) return;
    initializePersistentAgentAudience(scope, rootAgentPubkeys);
  }, [keepMentionedAgentsPinned, rootAgentPubkeys, scope]);

  return { audience, keepMentionedAgentsPinned };
}
