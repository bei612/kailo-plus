// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/sidebar/ui/CreateChannelDialog.tsx::CreateChannelDialog
// desktop/src/shared/ui/chooser-dialog-content.tsx::ChooserDialogContent
// The original chooser layout/focus semantics are shared by Web and Desktop.
// DD-80 changes the write transport to the existing BFF workspace.create action.
// DD-125(4): the original Template row; applying is separate governed submissions.
// Original optional title/testId/children (Projects "Create a project channel" with its project
// select); `onRecorded` hands the recorded workspace.create submission to that caller's next step.
import * as React from "react";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "./composer/shared/ui/dialog";
import { WorkspaceChannelCreateChannelType, RoleWorkspacePageCreateActionKey, type ActionSubmission } from "@client-kit/contracts";
import { X } from "lucide-react";
import { useBffClient, useT } from "./context";
import { useWorkspaceCreate, WorkspaceCreateForm, WorkspaceCreateFormFooter } from "./roles";
import { ReadFailure } from "./ui";
import { useLoad } from "./use-load";
import { CreateChannelTemplateField, useChannelTemplateSelection } from "./channel-templates/CreateChannelTemplateField";

/** Keep mounted across closing so an unresolved command never loses its idempotency key. */
export function CreateChannelDialog({ open, onOpenChange, channelKind = WorkspaceChannelCreateChannelType.Stream, children, onRecorded, testId = "create-channel-dialog", title }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelKind?: WorkspaceChannelCreateChannelType;
  children?: React.ReactNode;
  onRecorded?: (submission: ActionSubmission, name: string) => void;
  testId?: string;
  title?: string;
}) {
  const client = useBffClient();
  const t = useT();
  const [capability, reload] = useLoad(`channel-create:${open}`, () => client.roleWorkspaces());
  const page = capability.status === "ok" && capability.data
    && Array.isArray(capability.data.workspaces)
    && (capability.data.createActionKey === undefined
      || capability.data.createActionKey === RoleWorkspacePageCreateActionKey.WorkspaceCreate)
    ? capability.data : null;
  const actionKey = page?.createActionKey;
  const state = useWorkspaceCreate(actionKey, channelKind, {active: open});
  const templates = useChannelTemplateSelection(state, open);
  const pendingIntent = state.busy || state.command !== null;
  // The frozen name of the command whose submission is reported once to `onRecorded`.
  const recordedName = React.useRef<string | null>(null);
  const recorded = React.useRef<ActionSubmission | null>(null);
  React.useEffect(() => {
    if (state.command && typeof state.command.name === "string") recordedName.current = state.command.name;
  }, [state.command]);
  React.useEffect(() => {
    const submission = state.submission;
    if (!submission || recorded.current === submission || recordedName.current === null) return;
    recorded.current = submission;
    onRecorded?.(submission, recordedName.current);
  }, [onRecorded, state.submission]);
  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (!next && pendingIntent) return;
      onOpenChange(next);
    }}>
          <DialogContent
            showCloseButton={false}
            aria-describedby={undefined}
            className="flex max-h-[85vh] max-w-lg flex-col gap-0 overflow-hidden p-0"
            data-testid={testId}
          >
            <DialogHeader className="shrink-0 px-6 py-5 pr-14 pb-2">
              <DialogTitle>{title ?? t(channelKind === WorkspaceChannelCreateChannelType.Forum ? "channel.create.forumTitle" : "channel.create.title")}</DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-6">
              <div className="py-5 pt-3">
                {capability.status === "pending" ? <p role="status">{t("platform.loading")}</p>
                  : capability.status === "error" ? <ReadFailure error={capability.error} onRetry={reload} />
                  : !page ? <p role="alert">{t("platform.loadFailed")}</p>
                  : !actionKey ? <p role="status">{t("channel.create.unavailable")}</p> : null}
                {children ? <div className="mb-5">{children}</div> : null}
                <WorkspaceCreateForm state={state} channel />
                <div className="mt-5 space-y-5"><CreateChannelTemplateField selection={templates} visibility={state.visibility} /></div>
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
