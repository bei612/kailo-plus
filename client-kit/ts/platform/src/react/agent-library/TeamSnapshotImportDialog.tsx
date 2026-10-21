// Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/ui/TeamSnapshotImportDialog.tsx.
// DD-131(3): preview of this session's uploaded team package as decoded by Core; confirm is the
// governed `agent.team.import`, which creates one Definition + DRAFT version per member and a new
// team referencing them, all or nothing. Team instructions are never imported; the allowlist
// Keep/Clear choice and memory/profile-sync results are not rendered (always discarded); the
// discarded fields and this Tenant's runtime profile and model route choice are shown instead.
import * as React from "react";
import { Upload } from "lucide-react";

import type { AgentSnapshotUploadView } from "@client-kit/contracts";
import { Button } from "../profile/buzz/shared/ui/button";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "../composer/shared/ui/dialog";
import { useUiT } from "../context";
import { useGovernedChannelAction } from "../channel-management-actions";
import { agentActionOutcomeText } from "./agentActionOutcome";
import { DiscardedFields, importAllowed, SnapshotImportRuntimeFields, useImportRuntimeSources } from "./SnapshotImportFields";

type TeamSnapshotImportDialogProps = {
  open: boolean;
  preview: AgentSnapshotUploadView;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
};

export function TeamSnapshotImportDialog({ open, preview, onOpenChange, onImported }: TeamSnapshotImportDialogProps) {
  const t = useUiT();
  const sources = useImportRuntimeSources(open);
  const [profileKey, setProfileKey] = React.useState("");
  const [routeId, setRouteId] = React.useState("");
  const action = useGovernedChannelAction(() => onImported());
  React.useEffect(() => { if (open) { setProfileKey(""); setRouteId(""); } }, [open, preview.uploadId]);

  const team = preview.team;
  const expired = Date.parse(preview.expiresAt) <= Date.now();
  const settled = action.outcome !== null && action.outcome.kind !== "unknown" && action.outcome.kind !== "rejected";
  const phase: "preview" | "confirming" | "result" = settled ? "result" : action.busy ? "confirming" : "preview";
  const locked = action.busy || action.unknown;
  const canConfirm = !!team && preview.members.length > 0 && !expired && importAllowed(sources.state) && !!profileKey && !!routeId && !action.busy;
  const discarded = [...(team?.discardedFields ?? []), ...preview.members.flatMap((member) => member.discardedFields)];

  const confirm = () => {
    if (action.unknown) { void action.submit(); return; }
    if (!canConfirm) return;
    void action.submit({ actionKey: "agent.team.import", explicitConfirmation: true,
      snapshotImport: { uploadId: preview.uploadId, contentDigest: preview.contentDigest, runtimeProfileKey: profileKey, modelRouteResourceId: routeId } });
  };

  return (
    <Dialog onOpenChange={(next) => { if (!next && locked) return; onOpenChange(next); }} open={open}>
      <DialogContent aria-describedby={undefined} className="max-h-[85vh] max-w-md overflow-y-auto"
        data-testid="team-snapshot-import-dialog" showCloseButton={false}>
        <DialogHeader className="space-y-0">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle>{phase === "result" ? t("agentSnapshots.teamImported") : t("agentSnapshots.importTeamTitle")}</DialogTitle>
            <div className="flex items-center gap-2">
              {phase !== "result" ? (
                <>
                  <Button data-testid="team-snapshot-import-confirm" disabled={action.unknown ? action.busy : !canConfirm}
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
            <p className="text-sm"><span className="font-medium">{team?.name}</span></p>
            <p className="text-sm" data-testid="team-snapshot-import-result" role="status">{agentActionOutcomeText(t, action.outcome)}</p>
            <p className="text-xs text-muted-foreground">{t("agentSnapshots.teamImportResultHint", { count: preview.members.length })}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-4 py-1">
              <div className="space-y-1">
                <p className="text-sm font-medium">{team?.name}</p>
                {team?.description ? <p className="text-xs text-muted-foreground">{team.description}</p> : null}
              </div>
              <p className="text-sm text-muted-foreground">{t("agentSnapshots.importTeamNotice")}</p>
              {preview.members.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-sm font-medium">{t("agentSnapshots.members", { count: preview.members.length })}</p>
                  <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-border p-2" data-testid="team-snapshot-import-members">
                    {preview.members.map((member, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: member names may duplicate
                      <div className="flex flex-col gap-0.5 px-1 py-0.5" key={index}>
                        <p className="text-sm font-medium">{member.displayName}</p>
                        {member.instructions ? <p className="line-clamp-1 text-xs text-muted-foreground">{member.instructions}</p> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <DiscardedFields fields={discarded} testId="team-snapshot-import-discarded" />
              <SnapshotImportRuntimeFields sources={sources.state} onReload={sources.reload} profileKey={profileKey} routeId={routeId}
                onProfileChange={setProfileKey} onRouteChange={setRouteId} disabled={locked} testIdPrefix="team-snapshot-import" />
              {expired ? <p className="text-sm text-destructive" role="alert">{t("agentSnapshots.uploadExpired")}</p> : null}
            </div>
            {action.outcome && (action.outcome.kind === "unknown" || action.outcome.kind === "rejected") ? (
              <div className={action.outcome.kind === "unknown"
                ? "rounded-md border border-border px-3 py-2 text-sm"
                : "flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"}
                data-testid="team-snapshot-import-confirm-error" role={action.outcome.kind === "unknown" ? "status" : "alert"}>
                <p>{agentActionOutcomeText(t, action.outcome)}</p>
              </div>
            ) : null}
            {phase === "confirming" ? <div className="py-4 text-center text-sm text-muted-foreground" role="status">{t("agentSnapshots.creatingTeam")}</div> : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
