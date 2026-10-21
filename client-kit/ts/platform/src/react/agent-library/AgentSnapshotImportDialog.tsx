// Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/ui/AgentSnapshotImportDialog.tsx.
// DD-131(2)(5): the preview is Core's decode of this session's upload (AgentSnapshotUploadView),
// not a local parse. Kept: identity, the exact instructions review, the "new and independent"
// notice, preview-then-confirm. The respond-to allowlist Keep/Clear choice, memory restore and the
// locked-card notice are not rendered (allowlists and memories are always discarded, DD-131(2)(4)(5));
// the discarded original fields are listed instead, and the importer picks this Tenant's runtime
// profile and model route. Confirm is the governed `agent.definition.import`: a new Definition with
// a DRAFT version, never published or installed.
import * as React from "react";
import { Upload } from "lucide-react";

import type { AgentSnapshotUploadView } from "@client-kit/contracts";
import { Button } from "../profile/buzz/shared/ui/button";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "../composer/shared/ui/dialog";
import { useUiT } from "../context";
import { useGovernedChannelAction } from "../channel-management-actions";
import { agentActionOutcomeText } from "./agentActionOutcome";
import { DiscardedFields, importAllowed, SnapshotImportRuntimeFields, useImportRuntimeSources } from "./SnapshotImportFields";

type AgentSnapshotImportDialogProps = {
  open: boolean;
  preview: AgentSnapshotUploadView;
  onOpenChange: (open: boolean) => void;
  /** A recorded import: the host re-reads the Agents directory. */
  onImported: () => void;
};

export function AgentSnapshotImportDialog({ open, preview, onOpenChange, onImported }: AgentSnapshotImportDialogProps) {
  const t = useUiT();
  const member = preview.members[0];
  const sources = useImportRuntimeSources(open);
  const [profileKey, setProfileKey] = React.useState("");
  const [routeId, setRouteId] = React.useState("");
  const action = useGovernedChannelAction(() => onImported());
  React.useEffect(() => { if (open) { setProfileKey(""); setRouteId(""); } }, [open, preview.uploadId]);

  const expired = Date.parse(preview.expiresAt) <= Date.now();
  const settled = action.outcome !== null && action.outcome.kind !== "unknown" && action.outcome.kind !== "rejected";
  const phase: "preview" | "confirming" | "result" = settled ? "result" : action.busy ? "confirming" : "preview";
  const locked = action.busy || action.unknown;
  const canConfirm = !!member && !expired && importAllowed(sources.state) && !!profileKey && !!routeId && !action.busy;

  const confirm = () => {
    if (action.unknown) { void action.submit(); return; }
    if (!canConfirm) return;
    void action.submit({ actionKey: "agent.definition.import", explicitConfirmation: true,
      snapshotImport: { uploadId: preview.uploadId, contentDigest: preview.contentDigest, runtimeProfileKey: profileKey, modelRouteResourceId: routeId } });
  };

  return (
    <Dialog onOpenChange={(next) => { if (!next && locked) return; onOpenChange(next); }} open={open}>
      <DialogContent aria-describedby={undefined} className="max-h-[85vh] max-w-2xl overflow-y-auto"
        data-testid="agent-snapshot-import-dialog" showCloseButton={false}>
        <DialogHeader className="space-y-0">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle>{phase === "result" ? t("agentSnapshots.agentImported") : t("agentSnapshots.importAgentTitle")}</DialogTitle>
            <div className="flex items-center gap-2">
              {phase !== "result" ? (
                <>
                  <Button data-testid="agent-snapshot-import-confirm" disabled={action.unknown ? action.busy : !canConfirm}
                    onClick={confirm} size="sm" type="button" variant="default">
                    <Upload className="h-4 w-4" />
                    {action.unknown ? t("agents.retry") : t("agentSnapshots.import")}
                  </Button>
                  <DialogClose asChild>
                    <Button disabled={locked} size="sm" type="button" variant="ghost">{t("buzz.cancel")}</Button>
                  </DialogClose>
                </>
              ) : (
                <DialogClose asChild>
                  <Button size="sm" type="button" variant="ghost">{t("buzz.close")}</Button>
                </DialogClose>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="h-px w-full bg-border" role="separator" />

        {phase === "result" && action.outcome ? (
          <div className="space-y-3 py-1">
            <p className="text-sm"><span className="font-medium">{member?.displayName}</span></p>
            <p className="text-sm" data-testid="agent-snapshot-import-result" role="status">{agentActionOutcomeText(t, action.outcome)}</p>
            <p className="text-xs text-muted-foreground">{t("agentSnapshots.importResultHint")}</p>
          </div>
        ) : member ? (
          <div className="space-y-4 py-1">
            <AgentPreviewIdentity displayName={member.displayName} description={member.description} avatarDataUrl={member.avatarDataUrl} />
            <section className="space-y-2 rounded-md border border-border p-3" data-testid="agent-snapshot-import-behavior">
              <div>
                <p className="text-sm font-medium">{t("agentSnapshots.instructions")}</p>
                <p className="text-xs text-muted-foreground">{t("agentSnapshots.instructionsHint")}</p>
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/60 p-3 text-xs" data-testid="agent-snapshot-import-system-prompt">
                {member.instructions || t("agentSnapshots.noInstructions")}
              </pre>
              <PortableSummary member={member} />
            </section>
            <p className="text-sm text-muted-foreground">{t("agentSnapshots.importAgentNotice")}</p>
            <DiscardedFields fields={member.discardedFields} testId="agent-snapshot-import-discarded" />
            <SnapshotImportRuntimeFields sources={sources.state} onReload={sources.reload} profileKey={profileKey} routeId={routeId}
              onProfileChange={setProfileKey} onRouteChange={setRouteId} disabled={locked} testIdPrefix="agent-snapshot-import" />
            {expired ? <p className="text-sm text-destructive" role="alert">{t("agentSnapshots.uploadExpired")}</p> : null}
            {action.outcome && (action.outcome.kind === "unknown" || action.outcome.kind === "rejected") ? (
              <p className={action.outcome.kind === "unknown" ? "text-sm" : "text-sm text-destructive"}
                data-testid="agent-snapshot-import-confirm-error" role={action.outcome.kind === "unknown" ? "status" : "alert"}>
                {agentActionOutcomeText(t, action.outcome)}
              </p>
            ) : null}
            {phase === "confirming" ? <p className="py-2 text-center text-sm text-muted-foreground" role="status">{t("agentSnapshots.creatingAgent")}</p> : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function AgentPreviewIdentity({ displayName, description, avatarDataUrl }: { displayName: string; description?: string; avatarDataUrl?: string }) {
  return (
    <div className="flex items-center gap-3">
      {avatarDataUrl ? <img alt="" className="h-10 w-10 shrink-0 rounded-squircle object-cover" data-testid="snapshot-preview-avatar" src={avatarDataUrl} /> : null}
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">{displayName}</p>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  );
}

function PortableSummary({ member }: { member: AgentSnapshotUploadView["members"][number] }) {
  const t = useUiT();
  const rows: string[] = [];
  if (member.replyPolicy) rows.push(`${t("agents.version.replyPolicy")}: ${member.replyPolicy}`);
  if (member.parallelism !== undefined) rows.push(`${t("agents.version.parallelism")}: ${member.parallelism}`);
  if (member.idleTimeoutSeconds !== undefined) rows.push(`${t("agents.version.idleTimeout")}: ${member.idleTimeoutSeconds}`);
  if (member.maxTurnDurationSeconds !== undefined) rows.push(`${t("agents.version.maxDuration")}: ${member.maxTurnDurationSeconds}`);
  if (member.triggerDefaults && member.triggerDefaults.length > 0) rows.push(`${t("agents.version.triggers")}: ${member.triggerDefaults.join(", ")}`);
  if (rows.length === 0) return null;
  return <ul className="space-y-0.5 text-xs text-muted-foreground" data-testid="agent-snapshot-import-portable">{rows.map((row) => <li key={row}>{row}</li>)}</ul>;
}
