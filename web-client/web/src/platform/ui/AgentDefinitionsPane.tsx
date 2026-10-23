// The original Agent editor is shared. Only the authenticated Web media
// transport and exact server-projected image paths differ from the native host.
import { useMemo, useRef, type ComponentProps } from "react";
import { AgentDefinitionsPage } from "@client-kit/platform/react/pages";
import { TransportError } from "@client-kit/platform/transport";
import { useBffClient, useLocale, useT } from "@client-kit/platform/react/context";
import { useLoad } from "@client-kit/platform/react/use-load";
import { ReadFailure } from "@client-kit/platform/react/ui";
import { publishConversationMessage, uploadConversationMedia, uploadProfileAvatar } from "../bff-client";

type AgentProps = NonNullable<ComponentProps<typeof AgentDefinitionsPage>>;
type Props = Pick<AgentProps, "workspaceId" | "onWorkspaceChange">;

// DD-131(7) original "send to people": the READY package goes into the opened direct message as an
// ordinary attachment through that conversation's BFF media and publish routes. The publication
// carries the intent's Idempotency-Key, so an unknown outcome is retried as the same message (DD-81).
const snapshotExportHost: NonNullable<AgentProps["snapshotExportHost"]> = {
  // The BFF download route is same-origin and session-authorized (DD-131(2)).
  save: async (view) => {
    const anchor = document.createElement("a");
    anchor.href = view.downloadPath;
    anchor.download = view.fileName;
    anchor.rel = "noopener";
    anchor.click();
  },
  readBytes: async (view) => {
    const response = await fetch(view.downloadPath, { credentials: "same-origin" });
    if (!response.ok) throw new Error(String(response.status));
    return new Uint8Array(await response.arrayBuffer());
  },
  sendDedupesRetry: true,
  sendToConversation: async (intent) => {
    const file = new File([intent.bytes as BlobPart], intent.fileName, { type: intent.mediaType });
    const descriptor = await uploadConversationMedia(intent.conversation.id, file);
    // Snapshot sends never carry `thumb` (original useSnapshotSendController); the label is the persona name.
    const { thumb: _thumb, ...attachment } = descriptor;
    const receipt = await publishConversationMessage(intent.conversation.id, "",
      [{ ...attachment, filename: intent.fileName, displayLabel: intent.label }], intent.idempotencyKey);
    if (!receipt?.eventId || !receipt.operationId) throw new TransportError("Snapshot message has no confirmed receipt.");
  },
};

export function AgentDefinitionsPane(props: Props) {
  const client = useBffClient();
  const locale = useLocale();
  const t = useT();
  const [loaded, reload] = useLoad("agent-avatar-actor", client.profile);
  const uploadedPaths = useRef<Record<string, string>>({});
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
  return <AgentDefinitionsPage key={loaded.data.pubkey} {...props} avatarHost={avatarHost} snapshotExportHost={snapshotExportHost} />;
}
