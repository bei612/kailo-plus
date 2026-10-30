// DD-131(2): a READY ExportPackage is saved through the native dialog; the device session
// fetches only the package's own BFF download route. Shared by the Agents page and the Agent
// profile's owner "Export" entry (original desktop/src/features/profile/ui/UserProfileSnapshotExportDialog.tsx).
import type { ComponentProps } from "react";
import type { AgentDefinitionsPage } from "@client-kit/platform/react/pages";
import { invokeTauri } from "@/shared/api/tauri";

export type DesktopSnapshotExportHost = NonNullable<ComponentProps<typeof AgentDefinitionsPage>["snapshotExportHost"]>;

export const snapshotExportHost: DesktopSnapshotExportHost = {
  save: (view) => invokeTauri<boolean>("platform_export_package_save", { assetId: view.packageAssetId, fileName: view.fileName }),
  readBytes: async (view) =>
    new Uint8Array(await invokeTauri<ArrayBuffer>("platform_export_package_read", { assetId: view.packageAssetId })),
};
