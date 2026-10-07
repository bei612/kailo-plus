import * as React from "react";
import { SystemMessageRowSurface } from "@client-kit/platform/react/messages/system";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";
import { useActiveCommunity } from "@/features/platform/activeCommunity";
import { useCustomEmojiPalette } from "../lib/useCustomEmojiPalette";

export const SystemMessageRow = React.memo(function SystemMessageRow(
  props: Omit<React.ComponentProps<typeof SystemMessageRowSurface>, "ProfilePopover" | "resolveMediaUrl" | "customEmoji" | "reactionScope">
) {
  const community = useActiveCommunity();
  const customEmoji = useCustomEmojiPalette();
  return <SystemMessageRowSurface {...props} ProfilePopover={UserProfilePopover}
    resolveMediaUrl={rewriteRelayUrl} customEmoji={customEmoji}
    reactionScope={props.currentPubkey ? JSON.stringify([community.id, props.currentPubkey]) : null} />;
});
