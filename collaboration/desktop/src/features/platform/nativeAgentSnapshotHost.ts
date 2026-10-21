// DD-131(5)(7) native snapshot host. The shared Agents page does the governed export/import; this
// host only (1) saves a READY ExportPackage through Rust (`platform_api_save`: the bytes never cross
// into the webview, Core re-authorizes the Asset read), (2) sends the package as an ordinary
// direct-message attachment through the original native media upload and publish path (the person's
// CLIENT identity, exactly like the New Message screen), and (3) copies the Relay media URL of that
// upload, readable only through the Tenant Relay's authorization — never a public link.
import type { ExportPackageView } from "@client-kit/contracts";
import type { AgentSnapshotHost } from "@client-kit/platform/react/agent-library/agentSnapshotHost";
import type { SnapshotFile } from "@client-kit/platform/react/agent-library/snapshotFlow";
import { saveNativeExportPackage, type Invoke } from "@client-kit/platform/native";
import { buildOutgoingMessage } from "@client-kit/platform/react/composer/features/messages/lib/imetaMediaMarkdown";
import type { BlobDescriptor } from "@client-kit/platform/react/composer/features/messages/lib/imetaMediaMarkdown";
import type { Channel } from "@/shared/api/types";

export type NativeSnapshotHostDeps = {
  invoke: Invoke;
  /** A fresh session read through the real transport hands an ended session to the bootstrap. */
  onSessionEnded: () => void;
  getChannels: () => Promise<{ channels: Channel[] | null }>;
  uploadMediaBytes: (data: number[], filename?: string) => Promise<BlobDescriptor>;
  sendToChannel: (channel: Channel, content: string, mediaTags: string[][]) => Promise<unknown>;
  copyText: (text: string) => Promise<void>;
};

export function exportPackageContentPath(assetId: string): string {
  return `/api/v1/export-packages/${encodeURIComponent(assetId)}/content`;
}

async function uploadPackage(deps: NativeSnapshotHostDeps, file: SnapshotFile): Promise<BlobDescriptor> {
  const uploaded = await deps.uploadMediaBytes(Array.from(file.bytes), file.fileName);
  // Snapshot sends never carry a thumbnail sidecar (original runSendPipeline).
  const { thumb: _thumb, ...descriptor } = uploaded;
  return { ...descriptor, filename: file.fileName };
}

export function createNativeAgentSnapshotHost(deps: NativeSnapshotHostDeps): AgentSnapshotHost {
  return {
    saveExportPackage: async (pkg: ExportPackageView) => {
      const report = await saveNativeExportPackage(deps.invoke, { onSessionEnded: deps.onSessionEnded },
        exportPackageContentPath(pkg.assetId), pkg.fileName);
      if (report.status < 200 || report.status >= 300) throw new Error(`HTTP ${report.status}`);
      return report.saved;
    },
    sendAttachment: async (conversation, file, label) => {
      const snapshot = await deps.getChannels();
      const channel = snapshot.channels?.find((item) => item.id === conversation.channelId && item.channelType === "dm");
      if (!channel) throw new Error("DM not synchronized yet");
      const descriptor = await uploadPackage(deps, file);
      const message = buildOutgoingMessage("", [{ ...descriptor, displayLabel: label }]);
      await deps.sendToChannel(channel, message.content, message.mediaTags ?? []);
    },
    copyLink: async (file) => {
      const descriptor = await uploadPackage(deps, file);
      await deps.copyText(descriptor.url);
    },
  };
}
