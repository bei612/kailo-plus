import { useMemo } from "react";
import { useCustomEmojiPalette as useSharedPalette } from "@client-kit/platform/react/custom-emoji";
import type { WebCustomEmojiView } from "@client-kit/contracts";
import { useIdentityQuery } from "@/shared/api/hooks";
import { useActiveCommunity } from "@/features/platform/activeCommunity";
import { invokeTauri } from "@/shared/api/tauri";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";

export function useCustomEmojiPalette() {
  const identity = useIdentityQuery();
  const community = useActiveCommunity();
  const pubkey = !identity.isError ? identity.data?.pubkey : undefined;
  const host = useMemo(() => pubkey ? {
    scope: `${community.relayUrl}:${pubkey}`,
    read: () => invokeTauri<WebCustomEmojiView>("get_custom_emoji", {
      expectedRelayUrl: community.relayUrl, expectedSignerPubkey: pubkey,
    }),
    rewriteRelayUrl,
  } : undefined, [community.relayUrl, pubkey]);
  return useSharedPalette(host);
}
