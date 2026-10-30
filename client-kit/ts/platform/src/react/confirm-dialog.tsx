// DD-168 (.design/20 §16.6, §13.4(3)): one confirmation for destructive or irreversible
// actions. The title is a question naming the object ("Remove Ada from the organization?"),
// the description states the consequence, the confirm button is the action verb in the danger
// colour and Cancel is always available. Focus starts on Cancel; Enter does not confirm a
// destructive action by accident. While the request is in flight the dialog stays open and
// both buttons are disabled; an UNKNOWN outcome is the caller's to show, never a silent close.
import type { ReactNode } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Loader2 } from "lucide-react";
import { MODAL_BACKDROP_BLUR_CLASS } from "./composer/shared/ui/modalBackdrop";
import { MODAL_CONTENT_MOTION_CLASS, MODAL_OVERLAY_MOTION_CLASS } from "./composer/shared/ui/modalMotion";
import { useT } from "./context";

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm, tone = "danger", pending = false, children, testId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A question naming the object. */
  title: ReactNode;
  /** The consequence, in one or two sentences. */
  description: ReactNode;
  /** The action verb, e.g. "Remove", "Revoke", "Delete". */
  confirmLabel: ReactNode;
  onConfirm: () => void;
  tone?: "danger" | "default";
  pending?: boolean;
  /** Extra content such as an acknowledgement checkbox or an outcome notice. */
  children?: ReactNode;
  testId?: string;
}) {
  const t = useT();
  return <AlertDialog.Root open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
    <AlertDialog.Portal>
      <AlertDialog.Overlay className={`fixed inset-0 z-50 bg-black/40 dark:bg-black/60 ${MODAL_OVERLAY_MOTION_CLASS} ${MODAL_BACKDROP_BLUR_CLASS}`} />
      <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
        <AlertDialog.Content data-testid={testId ?? "confirm-dialog"}
          className={`pointer-events-auto grid w-[calc(100vw-2rem)] max-w-[30rem] gap-4 rounded-2xl border border-border bg-popover p-6 text-popover-foreground shadow-xl outline-hidden ${MODAL_CONTENT_MOTION_CLASS}`}>
          <div className="flex flex-col gap-2 text-left">
            <AlertDialog.Title className="text-[1.0625rem] font-semibold leading-6 tracking-[-0.012em]">{title}</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-muted-foreground">{description}</AlertDialog.Description>
            {children}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel disabled={pending}
              className="inline-flex h-8 items-center justify-center rounded-lg border border-input bg-background px-3.5 text-sm font-medium shadow-xs hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
              {t("platform.cancel")}
            </AlertDialog.Cancel>
            <button type="button" disabled={pending} onClick={onConfirm} data-testid="confirm-dialog-action"
              className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-medium text-white shadow-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60 ${tone === "danger" ? "bg-danger hover:bg-danger/90" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}>
              {pending ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null}{confirmLabel}
            </button>
          </div>
        </AlertDialog.Content>
      </div>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
}
