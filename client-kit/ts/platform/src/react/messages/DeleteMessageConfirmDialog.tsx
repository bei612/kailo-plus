// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/messages/ui/DeleteMessageConfirmDialog.tsx and
// desktop/src/shared/ui/alert-dialog.tsx (the original default surface).
import * as React from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useUiT } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Button } from "../profile/buzz/shared/ui/button";
import { MODAL_BACKDROP_BLUR_CLASS } from "../composer/shared/ui/modalBackdrop";
import {
  MODAL_CONTENT_MOTION_CLASS,
  MODAL_OVERLAY_MOTION_CLASS,
} from "../composer/shared/ui/modalMotion";
import { isOutcomeUnknown } from "../../transport";
import type { TimelineMessage } from "./types";

/** One original confirmation for the action menu and clearing an edit. */
export function DeleteMessageConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  pending = false,
  problem = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  pending?: boolean;
  problem?: "unknown" | "rejected" | null;
}) {
  const t = useUiT();
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
          >
            <div className="flex flex-col space-y-2 text-left">
              <AlertDialog.Title className="text-xl font-semibold tracking-tight">
                {t("buzz.deleteMessageTitle")}
              </AlertDialog.Title>
              <AlertDialog.Description className="text-sm text-muted-foreground">
                {t("buzz.deleteMessageDescription")}
              </AlertDialog.Description>
            </div>
            {problem ? (
              <p
                role={problem === "unknown" ? "status" : "alert"}
                className={
                  problem === "unknown"
                    ? "text-sm text-muted-foreground"
                    : "text-sm text-destructive"
                }
              >
                {t(problem === "unknown" ? "forum.deleteUnknown" : "forum.deleteRejected")}
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AlertDialog.Cancel asChild>
                <Button disabled={pending} type="button" variant="outline">
                  {t("forum.cancel")}
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button
                  disabled={pending}
                  onClick={(event) => {
                    event.preventDefault();
                    onConfirm();
                  }}
                  type="button"
                  variant="destructive"
                >
                  {t(
                    pending
                      ? "forum.deleting"
                      : problem === "unknown"
                        ? "forum.deleteCheck"
                        : "buzz.delete",
                  )}
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </div>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/** UI selection only. The host's existing signed mutation owns idempotency and receipt. */
export function useMessageDeleteDialog(
  scopeKey: string,
  available: boolean,
  onDelete: (message: TimelineMessage) => Promise<void>,
  onDeleted: (message: TimelineMessage) => void,
) {
  const owner = React.useMemo(() => ({}), [scopeKey]);
  const ownerRef = React.useRef(owner);
  ownerRef.current = owner;
  const mounted = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [selection, setSelection] = React.useState<{
    owner: object;
    message: TimelineMessage;
    open: boolean;
    pending: boolean;
    problem: "unknown" | "rejected" | null;
  } | null>(null);
  const current = selection?.owner === owner ? selection : null;
  const currentRef = React.useRef(current);
  currentRef.current = current;
  const active = React.useRef<object | null>(null);
  const requestDelete = React.useCallback(
    (message: TimelineMessage) => {
      if (!available || active.current === owner || message.pending) return;
      setSelection((previous) =>
        previous?.owner === owner && previous.message.id === message.id
          ? { ...previous, open: true }
          : { owner, message, open: true, pending: false, problem: null },
      );
    },
    [available, owner],
  );
  const confirm = async () => {
    const selected = currentRef.current;
    if (!available || !selected || ownerRef.current !== owner || active.current === owner) return;
    active.current = owner;
    setSelection({ ...selected, pending: true });
    try {
      await onDelete(selected.message);
      if (mounted.current && ownerRef.current === owner) {
        onDeleted(selected.message);
        setSelection(null);
      }
    } catch (error) {
      if (mounted.current && ownerRef.current === owner)
        setSelection({
          ...selected,
          pending: false,
          problem: isOutcomeUnknown(error) ? "unknown" : "rejected",
        });
    } finally {
      if (active.current === owner) active.current = null;
    }
  };
  return {
    requestDelete,
    pending: current?.pending ?? false,
    dialog: (
      <DeleteMessageConfirmDialog
        open={Boolean(available && current?.open)}
        pending={current?.pending}
        problem={current?.problem}
        onConfirm={() => {
          void confirm();
        }}
        onOpenChange={(open) => {
          if (active.current !== owner)
            setSelection((previous) =>
              previous?.owner === owner ? { ...previous, open } : previous,
            );
        }}
      />
    ),
  };
}
