// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/sidebar/ui/CreateChannelDialog.tsx::CreateChannelDialog
// desktop/src/shared/ui/chooser-dialog-content.tsx::ChooserDialogContent
// The original chooser layout/focus semantics are shared by Web and Desktop.
// DD-80 changes the write transport to the existing BFF workspace.create action.
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "./composer/shared/ui/dialog";
import { ChannelType, CreateActionKey } from "@client-kit/contracts";
import { X } from "lucide-react";
import { useBffClient, useT } from "./context";
import { useWorkspaceCreate, WorkspaceCreateForm, WorkspaceCreateFormFooter } from "./roles";
import { ReadFailure } from "./ui";
import { useLoad } from "./use-load";

/** Keep mounted across closing so an unresolved command never loses its idempotency key. */
export function CreateChannelDialog({ open, onOpenChange, channelKind = ChannelType.Stream }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelKind?: ChannelType;
}) {
  const client = useBffClient();
  const t = useT();
  const [capability, reload] = useLoad(`channel-create:${open}`, () => client.roleWorkspaces());
  const page = capability.status === "ok" && capability.data
    && Array.isArray(capability.data.workspaces)
    && (capability.data.createActionKey === undefined
      || capability.data.createActionKey === CreateActionKey.WorkspaceCreate)
    ? capability.data : null;
  const actionKey = page?.createActionKey;
  const state = useWorkspaceCreate(actionKey, channelKind, {active: open});
  const pendingIntent = state.busy || state.command !== null;
  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (!next && pendingIntent) return;
      onOpenChange(next);
    }}>
          <DialogContent
            showCloseButton={false}
            aria-describedby={undefined}
            className="flex max-h-[85vh] max-w-lg flex-col gap-0 overflow-hidden p-0"
            data-testid="create-channel-dialog"
          >
            <DialogHeader className="shrink-0 px-6 py-5 pr-14 pb-2">
              <DialogTitle>{t(channelKind === ChannelType.Forum ? "channel.create.forumTitle" : "channel.create.title")}</DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-6">
              <div className="py-5 pt-3">
                {capability.status === "pending" ? <p role="status">{t("platform.loading")}</p>
                  : capability.status === "error" ? <ReadFailure error={capability.error} onRetry={reload} />
                  : !page ? <p role="alert">{t("platform.loadFailed")}</p>
                  : !actionKey ? <p role="status">{t("channel.create.unavailable")}</p> : null}
                <WorkspaceCreateForm state={state} channel />
              </div>
            </div>
            <div className="flex shrink-0 border-border/60 px-6 py-4 border-t-0 pt-0">
              <WorkspaceCreateFormFooter state={state} />
            </div>
            <DialogClose
              aria-label={t("channel.create.close")}
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
              disabled={pendingIntent}
            ><X className="h-4 w-4" aria-hidden="true" /></DialogClose>
          </DialogContent>
    </Dialog>
  );
}
