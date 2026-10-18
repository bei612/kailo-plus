// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/profile/ui/UserProfilePrimaryActions.tsx::handleFollowClick and
// desktop/src/features/profile/hooks.ts::{useFollowMutation,useUnfollowMutation}.
// DD-125(5): the follow list is per Principal in Core CollaborationUserState (Core resolves
// the key to its Principal); no kind 3 is published. Shown only with the original "pulse" gate.
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useUiT } from "../context";
import { useCollaborationPreferences } from "../collaboration-preferences";
import { useFeatureEnabled } from "../features";
import type { ProfileFollowAction } from "./UserProfilePrimaryActions";

export function useProfileFollow(pubkey: string, offered: boolean): ProfileFollowAction | undefined {
  const t = useUiT();
  const preferences = useCollaborationPreferences();
  const showFollowAction = useFeatureEnabled("pulse");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const isFollowing = preferences?.isFollowing(pubkey) ?? false;
  const onToggle = useCallback(() => {
    if (!preferences || busy.current) return;
    busy.current = true;
    setPending(true);
    const following = isFollowing;
    void preferences.setFollowing(pubkey, !following).then((done) => {
      if (!done) toast.error(t(following ? "platform.profile.unfollowFailed" : "platform.profile.followFailed"));
    }).finally(() => { busy.current = false; setPending(false); });
  }, [preferences, pubkey, isFollowing, t]);
  if (!offered || !showFollowAction || !preferences || preferences.state === null) return undefined;
  return { isFollowing, pending: pending || !preferences.writable, onToggle };
}
