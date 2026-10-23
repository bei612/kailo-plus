// Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/ui/RemoveMembersConfirmDialog.tsx.
// DD-131(1): removing members from a team never deletes their Definitions or Installations and no
// governed definition delete exists, so the original "Remove agents" choice is not rendered; the
// confirmation keeps the agents and saves the team.
import { Button } from "../profile/buzz/shared/ui/button";
import { useUiT } from "../context";
import { AgentAlertDialog } from "./AgentAlertDialog";

type RemoveMembersConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  memberNames: string[];
  onKeepAgents: () => void;
};

export function RemoveMembersConfirmDialog({
  open,
  onOpenChange,
  isPending,
  memberNames,
  onKeepAgents,
}: RemoveMembersConfirmDialogProps) {
  const t = useUiT();
  const count = memberNames.length;
  const plural = count !== 1;

  return (
    <AgentAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      testId="team-remove-members-dialog"
      title={t(plural ? "agentTeams.removeMembersTitle.other" : "agentTeams.removeMembersTitle.one", { count })}
      description={t(plural ? "agentTeams.removeMembersDescription.other" : "agentTeams.removeMembersDescription.one", { names: memberNames.join(", ") })}
      footer={<>
        <Button onClick={() => onOpenChange(false)} size="sm" type="button" variant="outline">
          {t("buzz.cancel")}
        </Button>
        <Button data-testid="team-remove-members-keep" disabled={isPending} onClick={onKeepAgents} size="sm" type="button">
          {t(plural ? "agentTeams.keepAgents.other" : "agentTeams.keepAgents.one")}
        </Button>
      </>}
    />
  );
}
