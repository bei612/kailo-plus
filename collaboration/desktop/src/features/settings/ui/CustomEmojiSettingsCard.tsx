import { CustomEmojiSettingsCard as SharedCard } from "@client-kit/platform/react/custom-emoji";
import { pickEmojiImage } from "@client-kit/platform/react/custom-emoji";
import type { WebCustomEmojiView, WebCustomEmojiMutation } from "@client-kit/contracts";
import { TransportError } from "@client-kit/platform/transport";
import { useIdentityQuery } from "@/shared/api/hooks";
import { useActiveCommunity } from "@/features/platform/activeCommunity";
import { invokeTauri, TauriInvokeError } from "@/shared/api/tauri";
import { uploadProfileAvatar } from "@/shared/api/tauriProfiles";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";
import { ReadFailure } from "@client-kit/platform/react/ui";
import { useUiT } from "@client-kit/platform/react/context";

export function CustomEmojiSettingsCard() {
  const identity = useIdentityQuery();
  const community = useActiveCommunity();
  const t = useUiT();
  if (identity.isPending) return <p role="status">{t("platform.loading")}</p>;
  if (identity.isError) return <ReadFailure error={identity.error} onRetry={() => void identity.refetch()} />;
  const pubkey = identity.data.pubkey;
  const binding = { expectedRelayUrl: community.relayUrl, expectedSignerPubkey: pubkey };
  const scope = `${community.relayUrl}:${pubkey}`;
  const publish = async (request: WebCustomEmojiMutation) => {
    if (request.expectedPubkey !== pubkey) throw new TransportError("Emoji identity changed");
    try {
      return await invokeTauri<{ eventId: string }>("update_custom_emoji", { ...binding,
        idempotencyKey: request.idempotencyKey, shortcode: request.shortcode, imageUrl: request.imageUrl });
    } catch (error) {
      if (error instanceof TauriInvokeError && typeof error.payload === "object" && error.payload !== null
        && "code" in error.payload && error.payload.code === "PROFILE_UPDATE_REJECTED") throw error;
      throw new TransportError("Emoji publication result unknown");
    }
  };
  return <SharedCard key={scope} host={{ scope,
    read: () => invokeTauri<WebCustomEmojiView>("get_custom_emoji", binding), publish,
    pickAndUploadMedia: () => pickEmojiImage((bytes) => uploadProfileAvatar(bytes, community.relayUrl, pubkey)),
    rewriteRelayUrl }} />;
}
