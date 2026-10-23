// Native retains the original signer/Community-bound media transport; the
// Agent form itself is the same TypeScript module as Web.
import { useMemo, type ComponentProps } from "react";
import { AgentDefinitionsPage } from "@client-kit/platform/react/pages";
import { useLocale, useT } from "@client-kit/platform/react/context";
import { ReadFailure } from "@client-kit/platform/react/ui";
import { useProfileQuery } from "@/features/profile/hooks";
import { useActiveCommunity } from "@/features/platform/activeCommunity";
import { uploadProfileAvatar } from "@/shared/api/tauriProfiles";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";
import { performDefaultHaptic } from "@/shared/lib/haptics";
import { getChannels, invokeTauri, uploadMediaBytes } from "@/shared/api/tauri";
import { useQueryClient } from "@tanstack/react-query";
import { buildOutgoingMessage } from "@client-kit/platform/react/composer/features/messages/lib/imetaMediaMarkdown";
import { channelsQueryKey } from "@/features/channels/hooks";
import { useSendMessageMutation } from "@/features/messages/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";

type AgentProps = NonNullable<ComponentProps<typeof AgentDefinitionsPage>>;
type Props = Pick<AgentProps, "workspaceId" | "onWorkspaceChange">;

// DD-131(2): a READY ExportPackage is saved through the native dialog; the device session
// fetches only the package's own BFF download route.
const snapshotExportHost: NonNullable<AgentProps["snapshotExportHost"]> = {
  save: (view) => invokeTauri<boolean>("platform_export_package_save", { assetId: view.packageAssetId, fileName: view.fileName }),
  readBytes: async (view) =>
    new Uint8Array(await invokeTauri<ArrayBuffer>("platform_export_package_read", { assetId: view.packageAssetId })),
};

export function AgentDefinitionsPane(props: Props) {
  const community = useActiveCommunity();
  const profile = useProfileQuery();
  const locale = useLocale();
  const t = useT();
  const actor = profile.data;
  const identity = useIdentityQuery();
  const cache = useQueryClient();
  const send = useSendMessageMutation(null, identity.data);
  const sendMessage = send.mutateAsync;
  // DD-131(7) original "send to people" (useSnapshotSendController): the opened direct message's
  // native media upload and send, signed by this device's CLIENT key. The native publication is not
  // keyed by the intent, so an unknown outcome is not resent from here (sendDedupesRetry: false).
  const exportHost = useMemo<NonNullable<AgentProps["snapshotExportHost"]>>(() => ({
    ...snapshotExportHost,
    sendDedupesRetry: false,
    sendToConversation: async (intent) => {
      const snapshot = await getChannels(null);
      const channel = snapshot.channels?.find((item) => item.id === intent.conversation.channelId && item.channelType === "dm");
      if (!channel) throw new Error(t("dm.synchronizing"));
      cache.setQueryData(channelsQueryKey, snapshot.channels);
      const uploaded = await uploadMediaBytes(Array.from(intent.bytes), intent.fileName);
      const { thumb: _thumb, ...descriptor } = uploaded;
      const message = buildOutgoingMessage("", [{ ...descriptor, filename: intent.fileName, displayLabel: intent.label }]);
      await sendMessage({ targetChannel: channel, content: message.content, mediaTags: message.mediaTags ?? [], transport: "http" });
    },
  }), [cache, sendMessage, t]);
  const avatarHost = useMemo<AgentProps["avatarHost"]>(() => actor ? () => ({
    locale,
    uploadMediaBytes: (bytes) => uploadProfileAvatar(bytes, community.relayUrl, actor.pubkey),
    rewriteMediaUrl: rewriteRelayUrl,
    performDefaultHaptic,
  }) : undefined, [actor, community.relayUrl, locale]);
  if (profile.isPending) return <p role="status">{t("platform.loading")}</p>;
  if (profile.isError) return <ReadFailure error={profile.error} onRetry={() => void profile.refetch()} />;
  return <AgentDefinitionsPage key={`${community.relayUrl}:${profile.data.pubkey}`} {...props} avatarHost={avatarHost} snapshotExportHost={exportHost} />;
}
