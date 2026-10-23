// Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/ui/TeamShareDialog.tsx.
// DD-131(6): "Share to catalog" is the governed `agent.team.share/unshare`, offered to the Team owner
// only (Core re-checks Team `share`); it writes the Team's discoverer/reader tenant#member grants and
// grants no Installation use. The original built-in team has no counterpart. Sending the team as a
// snapshot to people is the original "Export" entry here: DD-131(3)(7) `agent.team.export`, approved by
// the team owner and every member's owner; the original memory level choice is excluded (DD-131(4)).
import { BookUser, Download } from "lucide-react";

import type { AgentTeamView } from "@client-kit/contracts";
import { Button } from "../profile/buzz/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../composer/shared/ui/dialog";
import { Switch } from "../switch";
import { useUiT } from "../context";

type TeamShareDialogProps = {
  team: AgentTeamView;
  /** Only the Team owner may change the catalog grant. */
  canShare: boolean;
  isPending: boolean;
  /** The last catalog change's outcome is unknown: only that same request may be re-checked. */
  unknown: boolean;
  problem: string | null;
  onCatalogShareChange: (shared: boolean) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  /** DD-131(3): the original "Export" entry; opens the governed `agent.team.export` dialog. */
  onExport?: () => void;
};

export function TeamShareDialog({ team, canShare, isPending, unknown, problem, onCatalogShareChange, onOpenChange, open, onExport }: TeamShareDialogProps) {
  const t = useUiT();
  const locked = isPending || unknown;
  return (
    <Dialog onOpenChange={(next) => { if (!next && locked) return; onOpenChange(next); }} open={open}>
      <DialogContent className="max-w-md" data-testid="team-share-dialog" showCloseButton={!locked}
        onEscapeKeyDown={(event) => { if (locked) event.preventDefault(); }}
        onInteractOutside={(event) => { if (locked) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>{t("agentTeams.shareTitle", { name: team.name })}</DialogTitle>
          <DialogDescription>{t("agentTeams.shareDescription")}</DialogDescription>
        </DialogHeader>
        <section className="relative flex min-h-16 w-full flex-col gap-2 rounded-xl border border-border bg-card px-5 py-4" data-testid="team-share-catalog">
          <div className="flex items-center gap-3">
            <BookUser className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <h3 className="text-control font-medium">{t("agentCatalog.shareTitle")}</h3>
              <p className="text-xs text-muted-foreground">{t("agentCatalog.shareTeamDescription")}</p>
            </div>
            <Switch
              aria-label={t("agentCatalog.shareTitle")}
              checked={team.catalogShared}
              data-testid="team-share-catalog-access"
              disabled={!canShare || locked}
              onCheckedChange={(checked) => onCatalogShareChange(checked)}
            />
          </div>
          {!canShare ? <p className="text-xs text-muted-foreground">{t("agentCatalog.ownerOnly")}</p> : null}
          {problem ? <p className={`text-xs ${unknown ? "text-warning-text" : "text-danger-text"}`} data-testid="team-share-problem" role={unknown ? "status" : "alert"}>{problem}</p> : null}
          {unknown ? <Button className="w-fit" data-testid="team-share-recheck" disabled={isPending} onClick={() => onCatalogShareChange(!team.catalogShared)}
            size="sm" type="button" variant="outline">{t("agents.retry")}</Button> : null}
        </section>
        {onExport ? (
          <section className="relative flex min-h-16 w-full items-center gap-3 rounded-xl border border-border bg-card px-5 py-4" data-testid="team-share-export">
            <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <h3 className="text-control font-medium">{t("agentTeams.export")}</h3>
              <p className="text-xs text-muted-foreground">{t("agentTeams.exportDescription")}</p>
            </div>
            <Button data-testid="team-share-export-open" disabled={locked} onClick={onExport} size="sm" type="button" variant="outline">
              {t("agentTeams.export")}</Button>
          </section>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
