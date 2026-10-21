// DD-131(5)(7) host seam of the restored Agents page: the only parts that differ between Web and
// Desktop. Everything else (governed export/import, approvals, upload preview, catalog, teams) is
// this shared package over the BFF client.
import type { ConversationView, ExportPackageView } from "@client-kit/contracts";
import type { SnapshotFile } from "./snapshotFlow";

export type AgentSnapshotHost = {
  /**
   * Save a READY ExportPackage to a local file (Web: authorized BFF download; Desktop: native save
   * dialog in Rust). Resolves false when the person cancels.
   */
  saveExportPackage: (pkg: ExportPackageView) => Promise<boolean>;
  /**
   * Send the package as an ordinary attachment in a prepared same-Tenant direct message through the
   * host's existing publication path. `idempotencyKey` identifies this one send intent: an unknown
   * outcome is re-checked with the same key, never replaced.
   */
  sendAttachment: (conversation: ConversationView, file: SnapshotFile, label: string, idempotencyKey: string) => Promise<void>;
  /**
   * Copy a link readable only inside this Tenant (Web: the BFF package path under Asset `read`;
   * Desktop: the Relay media URL under the person's CLIENT identity). Never a public link.
   * Omitted: no copy-link control.
   */
  copyLink?: (file: SnapshotFile, pkg: ExportPackageView) => Promise<void>;
};
