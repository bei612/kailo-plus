// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/channels/ui/ChannelManagementModerationActions.tsx::ChannelDeleteConfirmationDialog
// ("Delete channel?" / "Delete {name} from the community list. This action cannot be undone.",
// destructive "Delete channel" / "Deleting..."). DD-150: the confirmation submits the governed
// `workspace.delete` (EXPLICIT confirmation); a recorded request is not done — the channel stays
// listed as deleting until Core confirms every step. An unknown outcome keeps the dialog on the
// same request; only that request can be re-checked. Kailo DD-141 tokens only.
import { Button } from "./profile/buzz/shared/ui/button";
import { AgentAlertDialog, AlertDialogCancel } from "./agent-library/AgentAlertDialog";
import { useT } from "./context";

export function ChannelDeleteDialog({ open, channelName, pending = false, unknown = false, problem = null, onConfirm, onOpenChange }: {
  open: boolean;
  channelName: string;
  pending?: boolean;
  unknown?: boolean;
  problem?: string | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <AgentAlertDialog
      open={open}
      onOpenChange={(next) => { if (!pending && !unknown) onOpenChange(next); }}
      testId="channel-delete-confirmation-dialog"
      title={t("channelManagement.deleteTitle")}
      description={t("channelManagement.deleteDescription", { name: channelName })}
      footer={<>
        <AlertDialogCancel asChild>
          <Button data-testid="channel-delete-cancel" disabled={pending || unknown} type="button" variant="outline">{t("platform.cancel")}</Button>
        </AlertDialogCancel>
        <Button
          data-testid="channel-delete-confirm"
          disabled={pending}
          onClick={(event) => { event.preventDefault(); onConfirm(); }}
          type="button"
          variant="destructive"
        >
          {pending ? t("channelManagement.deleting") : unknown ? t("workspace.lifecycle.retry") : t("channelManagement.delete")}
        </Button>
      </>}
    >
      <p className="text-sm text-muted-foreground" data-testid="channel-delete-detail">{t("channelManagement.deleteDetail")}</p>
      {problem ? <p role={unknown ? "status" : "alert"} data-testid="channel-delete-problem"
        className={unknown ? "rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-text" : "rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-text"}>{problem}</p> : null}
    </AgentAlertDialog>
  );
}
