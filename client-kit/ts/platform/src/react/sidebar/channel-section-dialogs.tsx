// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/sidebar/ui/ChannelSectionDialogs.tsx::{LeaveChannelAlertDialog,useLeaveChannelDialog}
// desktop/src/features/sidebar/ui/ChannelContextMenu.tsx (Archive channel entry)
// desktop/src/shared/ui/alert-dialog.tsx (the original default surface).
// The sidebar context menu reaches the same DD-119 governed actions as the channel management
// sheet: Leave is workspace.leave, Archive is workspace.suspend (DD-119(5), DD-46). Both are
// re-admitted by Core; an unknown outcome keeps the frozen intent so only that same request is
// re-checked. Archive keeps the sheet's confirmation because suspend changes channel access.
import * as React from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { toast } from "sonner";
import { LeaveActionKey, WorkspaceLifecycleActionKey } from "@client-kit/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useT } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Button } from "../profile/buzz/shared/ui/button";
import { MODAL_BACKDROP_BLUR_CLASS } from "../composer/shared/ui/modalBackdrop";
import { MODAL_CONTENT_MOTION_CLASS, MODAL_OVERLAY_MOTION_CLASS } from "../composer/shared/ui/modalMotion";
import {
  CHANNEL_CONVERGENCE_REREAD_MS, channelActionOutcomeText, channelManagementQueryKey, useGovernedChannelAction,
} from "../channel-management-actions";

/** A Workspace channel row targeted from the sidebar context menu. */
export type SidebarChannelActionTarget = { workspaceId: string; name: string };

type ChannelActionKind = "leave" | "archive";

export function ChannelActionAlertDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending = false,
  problem = null,
  testId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
  problem?: { text: string; unknown: boolean } | null;
  testId?: string;
}) {
  const t = useT();
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/60",
            MODAL_OVERLAY_MOTION_CLASS,
            MODAL_BACKDROP_BLUR_CLASS,
          )}
        />
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
          <AlertDialog.Content
            className={cn(
              "pointer-events-auto grid w-[calc(100vw-2rem)] max-w-md gap-4 outline-hidden rounded-3xl bg-background p-6 shadow-2xl",
              MODAL_CONTENT_MOTION_CLASS,
            )}
            data-testid={testId}
          >
            <div className="flex flex-col space-y-2 text-left">
              <AlertDialog.Title className="text-xl font-semibold tracking-tight">
                {title}
              </AlertDialog.Title>
              <AlertDialog.Description className="text-sm text-muted-foreground">
                {description}
              </AlertDialog.Description>
            </div>
            {problem ? (
              <p
                role={problem.unknown ? "status" : "alert"}
                className={problem.unknown ? "text-sm text-muted-foreground" : "text-sm text-destructive"}
              >
                {problem.text}
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AlertDialog.Cancel asChild>
                <Button disabled={pending} type="button" variant="outline">
                  {t("platform.cancel")}
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={pending}
                  onClick={(event) => {
                    event.preventDefault();
                    onConfirm();
                  }}
                  type="button"
                >
                  {confirmLabel}
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </div>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/**
 * One frozen governed intent per target. Kept mounted after the dialog closes so an unknown
 * outcome can only be re-checked with the same request; choosing another target replaces it.
 */
function ChannelActionRunner({
  kind,
  target,
  open,
  onOpenChange,
  onRecorded,
}: {
  kind: ChannelActionKind;
  target: SidebarChannelActionTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecorded: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const recordedRef = React.useRef(onRecorded);
  recordedRef.current = onRecorded;
  const timers = React.useRef<number[]>([]);
  React.useEffect(() => () => { for (const timer of timers.current) window.clearTimeout(timer); }, []);
  const readBack = React.useCallback(() => {
    const reread = () => {
      recordedRef.current();
      void queryClient.invalidateQueries({ queryKey: channelManagementQueryKey(target.workspaceId) });
    };
    for (const timer of timers.current) window.clearTimeout(timer);
    reread();
    let at = 0;
    timers.current = CHANNEL_CONVERGENCE_REREAD_MS.map((delay) => { at += delay; return window.setTimeout(reread, at); });
  }, [queryClient, target.workspaceId]);
  const action = useGovernedChannelAction(readBack);

  async function confirm() {
    const result = await action.submit(kind === "leave"
      ? { actionKey: LeaveActionKey.WorkspaceLeave, workspaceId: target.workspaceId }
      : { actionKey: WorkspaceLifecycleActionKey.WorkspaceSuspend, workspaceId: target.workspaceId });
    if (result?.kind === "recorded" || result?.kind === "waiting") {
      toast.success(channelActionOutcomeText(t, result));
      action.dismiss();
      onOpenChange(false);
    }
  }

  const outcome = action.outcome;
  const problem = outcome && outcome.kind !== "recorded" && outcome.kind !== "waiting"
    ? { text: channelActionOutcomeText(t, outcome), unknown: action.unknown }
    : null;
  const confirmLabel = action.busy
    ? t(kind === "leave" ? "channelManagement.leaving" : "channelManagement.archiving")
    : action.unknown
      ? t("workspace.lifecycle.retry")
      : t(kind === "leave" ? "sidebar.leaveConfirm" : "channelManagement.archive");
  return (
    <ChannelActionAlertDialog
      open={open}
      onOpenChange={(next) => {
        if (action.busy) return;
        if (!next) action.dismiss();
        onOpenChange(next);
      }}
      title={t(kind === "leave" ? "channelManagement.leave" : "channelManagement.archive")}
      description={kind === "leave"
        ? t("sidebar.leaveChannelDescription", { name: target.name })
        : t("channelManagement.confirmArchive", { name: target.name })}
      confirmLabel={confirmLabel}
      onConfirm={() => { void confirm(); }}
      pending={action.busy}
      problem={problem}
      testId={kind === "leave" ? "leave-channel-dialog" : "archive-channel-dialog"}
    />
  );
}

/**
 * Original useLeaveChannelDialog, extended with the Archive entry: returns the menu callbacks and
 * the dialog element the host renders once. `onRecorded` re-reads the host's channel views.
 */
export function useChannelSidebarActionDialogs(onRecorded: () => void) {
  const [state, setState] = React.useState<{ kind: ChannelActionKind; target: SidebarChannelActionTarget; open: boolean } | null>(null);
  const request = React.useCallback((kind: ChannelActionKind, target: SidebarChannelActionTarget) => {
    setState((previous) => previous && previous.kind === kind && previous.target.workspaceId === target.workspaceId
      ? { ...previous, open: true }
      : { kind, target, open: true });
  }, []);
  const requestLeaveChannel = React.useCallback((target: SidebarChannelActionTarget) => request("leave", target), [request]);
  const requestArchiveChannel = React.useCallback((target: SidebarChannelActionTarget) => request("archive", target), [request]);
  const dialog = state ? (
    <ChannelActionRunner
      key={`${state.kind}:${state.target.workspaceId}`}
      kind={state.kind}
      target={state.target}
      open={state.open}
      onOpenChange={(open) => setState((previous) => previous && { ...previous, open })}
      onRecorded={onRecorded}
    />
  ) : null;
  return { requestLeaveChannel, requestArchiveChannel, dialog };
}
