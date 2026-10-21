// DD-131(2)(3)(8) progress of one governed snapshot export inside the original export and share
// dialogs: approval (the owner decides explicitly in the existing approval panel), Temporal
// generation of the ExportPackage, then ready. Unknown keeps the same request; refusals show the
// reason code. Presentation only — Core decides admission, approval and the package.
import { Loader2 } from "lucide-react";
import { Button } from "../profile/buzz/shared/ui/button";
import { useReasonText, useUiT } from "../context";
import { ApprovalPanel } from "../governance";
import type { SnapshotExport } from "./useSnapshotExport";

export function SnapshotExportProgress({ exporter, role, testIdPrefix }: {
  exporter: SnapshotExport;
  role: "approver" | "initiator";
  testIdPrefix: string;
}) {
  const t = useUiT();
  const reasonText = useReasonText();
  const { state } = exporter;
  if (state.phase === "idle") return null;
  return (
    <div className="space-y-2 rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-sm" data-phase={state.phase}
      data-testid={`${testIdPrefix}-progress`} role="status">
      {state.phase === "submitting" ? <p className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{t("agentSnapshots.exportSubmitting")}</p> : null}
      {state.phase === "unknown" ? <>
        <p>{t("agents.unknown", { operation: state.operation ?? "—" })}</p>
        <Button data-testid={`${testIdPrefix}-retry`} onClick={exporter.retry} size="sm" type="button" variant="outline">{t("agents.retry")}</Button>
      </> : null}
      {state.phase === "approval" ? <>
        <p>{t(role === "approver" ? "agentSnapshots.exportApproveOwn" : "agentSnapshots.exportWaitingOwner", { operation: state.receipt.operationId })}</p>
        <div className="max-h-72 overflow-y-auto rounded-lg bg-background p-2" data-testid={`${testIdPrefix}-approval`}>
          <ApprovalPanel workflowId={state.workflowId} role={role} onChanged={exporter.checkAgain} />
        </div>
      </> : null}
      {state.phase === "generating" ? <p className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{t("agentSnapshots.exportGenerating")}</p> : null}
      {state.phase === "stalled" ? <>
        <p>{t("agentSnapshots.exportStalled", { operation: state.receipt.operationId })}</p>
        <Button data-testid={`${testIdPrefix}-check`} onClick={exporter.checkAgain} size="sm" type="button" variant="outline">{t("agentSnapshots.checkAgain")}</Button>
      </> : null}
      {state.phase === "ready" ? <p>{t("agentSnapshots.exportReady", { file: state.pkg.fileName })}</p> : null}
      {state.phase === "refused" ? <p className="text-destructive" role="alert">
        {t("agents.rejected", { reason: state.reason ? reasonText(state.reason) : state.detail })}
      </p> : null}
    </div>
  );
}
