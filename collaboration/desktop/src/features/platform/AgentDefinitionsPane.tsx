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
import { invokeTauri } from "@/shared/api/tauri";

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
  const avatarHost = useMemo<AgentProps["avatarHost"]>(() => actor ? () => ({
    locale,
    uploadMediaBytes: (bytes) => uploadProfileAvatar(bytes, community.relayUrl, actor.pubkey),
    rewriteMediaUrl: rewriteRelayUrl,
    performDefaultHaptic,
  }) : undefined, [actor, community.relayUrl, locale]);
  if (profile.isPending) return <p role="status">{t("platform.loading")}</p>;
  if (profile.isError) return <ReadFailure error={profile.error} onRetry={() => void profile.refetch()} />;
  return <AgentDefinitionsPage key={`${community.relayUrl}:${profile.data.pubkey}`} {...props} avatarHost={avatarHost} snapshotExportHost={snapshotExportHost} />;
}
