// Native retains the original signer/Community-bound media transport; the
// Agent form itself is the same TypeScript module as Web.
// DD-131: the native snapshot host (nativeAgentSnapshotHost.ts) saves ExportPackages through Rust,
// sends them through the original native DM publish path and copies Relay media links.
import { useMemo, type ComponentProps } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AgentDefinitionsPage } from "@client-kit/platform/react/pages";
import { useBffClient, useLocale, useT } from "@client-kit/platform/react/context";
import { ReadFailure } from "@client-kit/platform/react/ui";
import { useProfileQuery } from "@/features/profile/hooks";
import { useActiveCommunity } from "@/features/platform/activeCommunity";
import { uploadProfileAvatar } from "@/shared/api/tauriProfiles";
import { getChannels, invokeTauri, TauriInvokeError, uploadMediaBytes } from "@/shared/api/tauri";
import { copyTextToSystemClipboard } from "@/shared/api/tauriMedia";
import { useIdentityQuery } from "@/shared/api/hooks";
import { channelsQueryKey } from "@/features/channels/hooks";
import { useSendMessageMutation } from "@/features/messages/hooks";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";
import { performDefaultHaptic } from "@/shared/lib/haptics";
import { createNativeAgentSnapshotHost } from "./nativeAgentSnapshotHost";

type AgentProps = NonNullable<ComponentProps<typeof AgentDefinitionsPage>>;
type Props = Pick<AgentProps, "workspaceId" | "onWorkspaceChange">;

export function AgentDefinitionsPane(props: Props) {
  const community = useActiveCommunity();
  const profile = useProfileQuery();
  const locale = useLocale();
  const t = useT();
  const client = useBffClient();
  const cache = useQueryClient();
  const identity = useIdentityQuery();
  const send = useSendMessageMutation(null, identity.data);
  const sendMessage = send.mutateAsync;
  const actor = profile.data;
  const avatarHost = useMemo<AgentProps["avatarHost"]>(() => actor ? () => ({
    locale,
    uploadMediaBytes: (bytes) => uploadProfileAvatar(bytes, community.relayUrl, actor.pubkey),
    rewriteMediaUrl: rewriteRelayUrl,
    performDefaultHaptic,
  }) : undefined, [actor, community.relayUrl, locale]);
  const snapshotHost = useMemo(() => createNativeAgentSnapshotHost({
    // The shared native host reads the raw Rust error (e.g. PLATFORM_NOT_SIGNED_IN).
    invoke: async (command, args) => {
      try { return await invokeTauri<unknown>(command, args); }
      catch (error) { throw error instanceof TauriInvokeError ? error.payload : error; }
    },
    onSessionEnded: () => { void client.session({ fresh: true }).catch(() => undefined); },
    getChannels: async () => {
      const snapshot = await getChannels(null);
      if (snapshot.channels) cache.setQueryData(channelsQueryKey, snapshot.channels);
      return { channels: snapshot.channels };
    },
    uploadMediaBytes: (data, filename) => uploadMediaBytes(data, filename),
    sendToChannel: (channel, content, mediaTags) => sendMessage({ targetChannel: channel, content, mediaTags, transport: "http" }),
    copyText: (text) => copyTextToSystemClipboard(text),
  }), [client, cache, sendMessage]);
  if (profile.isPending) return <p role="status">{t("platform.loading")}</p>;
  if (profile.isError) return <ReadFailure error={profile.error} onRetry={() => void profile.refetch()} />;
  return <AgentDefinitionsPage key={`${community.relayUrl}:${profile.data.pubkey}`} {...props} avatarHost={avatarHost} snapshotHost={snapshotHost} />;
}
