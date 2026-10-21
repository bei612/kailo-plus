// Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/ui/AgentSnapshotExportDialog.tsx.
// DD-131(2)(4): Export is the governed `agent.definition.export` of the Definition's current
// published Version; the File format choice (JSON/PNG) is kept, the Memories row and the plaintext
// memory warning are not rendered (no memory level exists). After owner approval the generated
// ExportPackage is saved through the host (Web download, Desktop native save dialog).
import * as React from "react";
import { Download, FileType2 } from "lucide-react";

import type { AgentDefinitionView, ExportPackageView } from "@client-kit/contracts";
import { Button } from "../profile/buzz/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../composer/shared/ui/dialog";
import { useUiT } from "../context";
import { SnapshotOptionMenu } from "./SnapshotOptionMenu";
import { SnapshotExportProgress } from "./SnapshotExportProgress";
import { useExportApprovalRole, useSnapshotExport, type SnapshotExportTarget } from "./useSnapshotExport";
import type { SnapshotFormat } from "./snapshotFlow";

export const SNAPSHOT_FORMAT_OPTIONS: { value: SnapshotFormat; label: string }[] = [
  { value: "json", label: "JSON" },
  { value: "png", label: "PNG" },
];

type AgentSnapshotExportDialogProps = {
  definition: AgentDefinitionView;
  agentName: string;
  open: boolean;
  /** Host save of the READY package; resolves false when the person cancels the save. */
  onSaveFile: (pkg: ExportPackageView) => Promise<boolean>;
  onOpenChange: (open: boolean) => void;
};

export function AgentSnapshotExportDialog({ definition, agentName, open, onSaveFile, onOpenChange }: AgentSnapshotExportDialogProps) {
  const target = React.useMemo<SnapshotExportTarget>(() => ({ kind: "agent", definition }), [definition]);
  return <SnapshotExportDialog target={target} name={agentName} open={open} onSaveFile={onSaveFile} onOpenChange={onOpenChange}
    testIdPrefix="agent-snapshot" unavailable={definition.currentPublishedVersionAssetId ? null : "agentSnapshots.exportNeedsPublished"} />;
}

/** The shared body of the original Agent and Team export dialogs. */
export function SnapshotExportDialog({ target, name, open, onSaveFile, onOpenChange, testIdPrefix, unavailable }: {
  target: SnapshotExportTarget;
  name: string;
  open: boolean;
  onSaveFile: (pkg: ExportPackageView) => Promise<boolean>;
  onOpenChange: (open: boolean) => void;
  testIdPrefix: "agent-snapshot" | "team-snapshot";
  unavailable: "agentSnapshots.exportNeedsPublished" | null;
}) {
  const t = useUiT();
  const [format, setFormat] = React.useState<SnapshotFormat>("png");
  const exporter = useSnapshotExport(target);
  const role = useExportApprovalRole(target);
  const [save, setSave] = React.useState<{ phase: "idle" | "saving" | "saved" | "cancelled" } | { phase: "failed"; message: string }>({ phase: "idle" });
  const savedFor = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (open) { setFormat("png"); setSave({ phase: "idle" }); savedFor.current = null; exporter.reset(); }
    // biome-ignore lint/correctness/useExhaustiveDependencies: reset once per open
  }, [open]);

  const ready = exporter.state.phase === "ready" ? exporter.state.pkg : null;
  const saveReady = React.useCallback(async (pkg: ExportPackageView) => {
    setSave({ phase: "saving" });
    try {
      setSave({ phase: (await onSaveFile(pkg)) ? "saved" : "cancelled" });
    } catch (error) {
      setSave({ phase: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  }, [onSaveFile]);
  React.useEffect(() => {
    if (!ready || savedFor.current === ready.assetId) return;
    savedFor.current = ready.assetId;
    void saveReady(ready);
  }, [ready, saveReady]);

  const started = exporter.state.phase !== "idle";
  const locked = exporter.busy || exporter.holdsIntent || save.phase === "saving";

  return (
    <Dialog onOpenChange={(next) => { if (!next && locked && exporter.state.phase !== "approval") return; onOpenChange(next); }} open={open}>
      <DialogContent aria-describedby={undefined} className="max-w-md" data-testid={`${testIdPrefix}-export-dialog`} showCloseButton={false}>
        <DialogHeader className="space-y-0">
          <DialogTitle className="truncate">{t("agentSnapshots.exportTitle", { name })}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-1">
            <div className="flex min-h-8 items-center justify-between gap-4">
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                <FileType2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                {t("agentSnapshots.fileFormat")}
              </span>
              <SnapshotOptionMenu
                ariaLabel={t("agentSnapshots.fileFormat")}
                className="font-medium text-foreground"
                disabled={started}
                onValueChange={(value) => setFormat(value === "json" ? "json" : "png")}
                options={SNAPSHOT_FORMAT_OPTIONS}
                testId={`${testIdPrefix}-format-trigger`}
                value={format}
              />
            </div>
          </div>

          {unavailable ? <p className="text-sm text-muted-foreground" role="status">{t(unavailable)}</p> : null}
          <p className="text-xs text-muted-foreground">{t("agentSnapshots.exportBoundary")}</p>
          <SnapshotExportProgress exporter={exporter} role={role} testIdPrefix={testIdPrefix} />
          {save.phase === "saved" ? <p className="text-sm" role="status">{t("agentSnapshots.saved")}</p> : null}
          {save.phase === "cancelled" ? <p className="text-sm text-muted-foreground" role="status">{t("agentSnapshots.saveCancelled")}</p> : null}
          {save.phase === "failed" ? <p className="text-sm text-destructive" role="alert">{save.message}</p> : null}

          <div className="flex items-center justify-end gap-2 pt-2" data-testid={`${testIdPrefix}-export-footer`}>
            <Button disabled={locked && exporter.state.phase !== "approval"} onClick={() => onOpenChange(false)} size="sm" type="button" variant="ghost">
              {ready ? t("buzz.close") : t("buzz.cancel")}
            </Button>
            {ready ? (
              <Button data-testid={`${testIdPrefix}-save-again`} disabled={save.phase === "saving"} onClick={() => void saveReady(ready)} size="sm" type="button">
                <Download className="h-4 w-4" />
                {t("agentSnapshots.saveAgain")}
              </Button>
            ) : (
              <Button
                data-testid={`${testIdPrefix}-export-confirm`}
                disabled={unavailable !== null || started}
                onClick={() => exporter.start(format)}
                size="sm"
                type="button"
              >
                <Download className="h-4 w-4" />
                {t("agentSnapshots.export")}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
