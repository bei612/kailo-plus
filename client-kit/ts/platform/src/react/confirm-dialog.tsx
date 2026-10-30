// DD-170 (.design/20 §16.6, §13.4(3)): one confirmation for destructive or irreversible
// actions. The title is a question naming the object ("Remove Ada from the organization?"),
// the description states the consequence, the confirm button is the action verb in the danger
// colour and Cancel is always available. Focus starts on Cancel; Enter does not confirm a
// destructive action by accident. While the request is in flight the dialog stays open and
// both buttons are disabled; an UNKNOWN outcome is the caller's to show, never a silent close.
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { AgentAlertDialog, AlertDialogCancel } from "./agent-library/AgentAlertDialog";
import { useT } from "./context";

/** The shared alert surface (DD-141 §9 dialog) with the DD-170 destructive-action grammar. */
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
  return <AgentAlertDialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }} testId={testId ?? "confirm-dialog"}
    title={title} description={description}
    footer={<>
      <AlertDialogCancel disabled={pending}
        className="inline-flex h-8 items-center justify-center rounded-lg border border-input bg-background px-3.5 text-sm font-medium shadow-xs hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
        {t("platform.cancel")}
      </AlertDialogCancel>
      <button type="button" disabled={pending} onClick={onConfirm} data-testid="confirm-dialog-action"
        className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-medium shadow-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${tone === "danger" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}>
        {pending ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null}{confirmLabel}
      </button>
    </>}>
    {children}
  </AgentAlertDialog>;
}
