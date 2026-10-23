// Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/ui/TeamDeleteDialog.tsx;
// delete is the governed `agent.team.delete` (DD-131(1)): member Definitions and Installations stay.
// An unknown outcome keeps the dialog on the same request; only that request can be re-checked.
import type { AgentTeamView } from "@client-kit/contracts";
import { Button } from "../profile/buzz/shared/ui/button";
import { useUiT } from "../context";
import { AgentAlertDialog, AlertDialogCancel } from "./AgentAlertDialog";

type TeamDeleteDialogProps = {
  open: boolean;
  team: AgentTeamView | null;
  pending?: boolean;
  unknown?: boolean;
  problem?: string | null;
  onConfirm: (team: AgentTeamView) => void;
  onOpenChange: (open: boolean) => void;
};

export function TeamDeleteDialog({
  open,
  team,
  pending = false,
  unknown = false,
  problem = null,
  onConfirm,
  onOpenChange,
}: TeamDeleteDialogProps) {
  const t = useUiT();
  return (
    <AgentAlertDialog
      open={open}
      onOpenChange={(next) => { if (!pending && !unknown) onOpenChange(next); }}
      testId="team-delete-dialog"
      title={t("agentTeams.deleteTitle")}
      description={team ? t("agentTeams.deleteDescription", { name: team.name }) : t("agentTeams.deleteFallback")}
      footer={<>
        <AlertDialogCancel asChild>
          <Button disabled={pending || unknown} type="button" variant="outline">{t("buzz.cancel")}</Button>
        </AlertDialogCancel>
        <Button
          data-testid="team-delete-confirm"
          disabled={pending}
          onClick={() => { if (team) onConfirm(team); }}
          type="button"
          variant="destructive"
        >
          {pending ? t("agentTeams.deleting") : unknown ? t("agents.retry") : t("agentTeams.delete")}
        </Button>
      </>}
    >
      {problem ? <p role={unknown ? "status" : "alert"}
        className={unknown ? "rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-text" : "rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-text"}>{problem}</p> : null}
    </AgentAlertDialog>
  );
}
