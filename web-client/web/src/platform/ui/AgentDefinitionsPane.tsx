// The original Agent editor is shared. Only the authenticated Web media
// transport and exact server-projected image paths differ from the native host.
// DD-131: the snapshot host saves an ExportPackage through the authorized BFF download, sends it as a
// direct-message attachment through the existing BFF media + publication routes, and copies the
// BFF package path (Asset `read`, Tenant-internal) as the link.
import { useMemo, useRef, type ComponentProps } from "react";
import { AgentDefinitionsPage } from "@client-kit/platform/react/pages";
import { useBffClient, useLocale, useT } from "@client-kit/platform/react/context";
import { useLoad } from "@client-kit/platform/react/use-load";
import { ReadFailure } from "@client-kit/platform/react/ui";
import type { AgentSnapshotHost } from "@client-kit/platform/react/agent-library/agentSnapshotHost";
import { publishConversationMessage, uploadConversationMedia, uploadProfileAvatar } from "../bff-client";

type AgentProps = NonNullable<ComponentProps<typeof AgentDefinitionsPage>>;
type Props = Pick<AgentProps, "workspaceId" | "onWorkspaceChange">;

/** The authorized package path; it is only readable through the BFF with Asset `read`. */
export function exportPackageContentPath(assetId: string): string {
  return `/api/v1/export-packages/${encodeURIComponent(assetId)}/content`;
}

export function useWebSnapshotHost(): AgentSnapshotHost {
  const client = useBffClient();
  return useMemo<AgentSnapshotHost>(() => ({
    saveExportPackage: async (pkg) => {
      const bytes = await client.exportPackageContent(pkg.assetId);
      if (bytes.byteLength !== pkg.byteSize) throw new Error("Export package size mismatch");
      const url = URL.createObjectURL(new Blob([bytes], { type: pkg.mediaType }));
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = pkg.fileName;
        anchor.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      return true;
    },
    sendAttachment: async (conversation, file, label, idempotencyKey) => {
      const descriptor = await uploadConversationMedia(conversation.id, new File([file.bytes], file.fileName, { type: file.mediaType }));
      await publishConversationMessage(conversation.id, "", [{ ...descriptor, filename: file.fileName, displayLabel: label }], idempotencyKey);
    },
    copyLink: async (_file, pkg) => {
      await navigator.clipboard.writeText(new URL(exportPackageContentPath(pkg.assetId), window.location.origin).toString());
    },
  }), [client]);
}

export function AgentDefinitionsPane(props: Props) {
  const client = useBffClient();
  const locale = useLocale();
  const t = useT();
  const [loaded, reload] = useLoad("agent-avatar-actor", client.profile);
  const uploadedPaths = useRef<Record<string, string>>({});
  const snapshotHost = useWebSnapshotHost();
  const actor = loaded.status === "ok" ? loaded.data : null;
  const avatarHost = useMemo<AgentProps["avatarHost"]>(() => actor ? (version) => ({
    locale,
    uploadMediaBytes: async (bytes) => {
      const descriptor = await uploadProfileAvatar(bytes, actor.pubkey);
      uploadedPaths.current[descriptor.url] = `/api/v1/profile/media/${descriptor.sha256}`;
      return descriptor;
    },
    rewriteMediaUrl: (url) => {
      const paths = version?.avatarMediaPaths;
      const clean = url.split("?")[0]!;
      return uploadedPaths.current[url] ?? paths?.[url] ?? actor.avatarMediaPaths[url]
        ?? uploadedPaths.current[clean] ?? paths?.[clean] ?? actor.avatarMediaPaths[clean] ?? url;
    },
    performDefaultHaptic: () => {},
  }) : undefined, [actor, locale]);
  if (loaded.status === "pending") return <p role="status">{t("platform.loading")}</p>;
  if (loaded.status === "error") return <ReadFailure error={loaded.error} onRetry={reload} />;
  return <AgentDefinitionsPage key={loaded.data.pubkey} {...props} avatarHost={avatarHost} snapshotHost={snapshotHost} />;
}
