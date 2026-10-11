// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/workflows/ui/WorkflowDeleteDialog.tsx::WorkflowDeleteDialog;
// desktop/src/shared/ui/alert-dialog.tsx default surface.
import type { ReactNode } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Button } from "./profile/buzz/shared/ui/button";
import { cn } from "./profile/buzz/shared/lib/cn";
import { MODAL_BACKDROP_BLUR_CLASS } from "./composer/shared/ui/modalBackdrop";
import { MODAL_CONTENT_MOTION_CLASS, MODAL_OVERLAY_MOTION_CLASS } from "./composer/shared/ui/modalMotion";
import { useT } from "./context";

export function WorkflowDeleteDialog({ name, error, isPending = false, locked = false,
  disabled = false, unknown = false, open, onConfirm, onOpenChange, children }: {
  name: string;
  error?: string | null;
  isPending?: boolean;
  locked?: boolean;
  disabled?: boolean;
  unknown?: boolean;
  open: boolean;
  onConfirm: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
  children?: ReactNode;
}) {
  const t = useT();
  return <AlertDialog.Root open={open} onOpenChange={(nextOpen) => {
    if (!isPending && !locked) onOpenChange(nextOpen);
  }}>
    <AlertDialog.Portal>
      <AlertDialog.Overlay className={cn("fixed inset-0 z-50 bg-black/60", MODAL_OVERLAY_MOTION_CLASS, MODAL_BACKDROP_BLUR_CLASS)} />
      <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
        <AlertDialog.Content className={cn("pointer-events-auto grid w-[calc(100vw-2rem)] max-w-md gap-4 outline-hidden rounded-3xl bg-background p-6 shadow-2xl", MODAL_CONTENT_MOTION_CLASS)}>
          <div className="flex flex-col space-y-2 text-left">
            <AlertDialog.Title className="text-xl font-semibold tracking-tight">{t("workflows.deleteTitle")}</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-muted-foreground">{t("workflows.deleteDescription", {name})}</AlertDialog.Description>
            <p className="text-sm text-muted-foreground">{t("agents.automation.deleteConfirm")}</p>
            {error ? <p aria-live="polite" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {t("workflows.deleteError", {error})}
            </p> : null}
            {children}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild><Button disabled={isPending || locked} type="button" variant="outline">{t("buzz.cancel")}</Button></AlertDialog.Cancel>
            <Button disabled={disabled || isPending} onClick={() => void onConfirm()} type="button" variant="destructive">
              {isPending ? t("workflows.deleting") : unknown ? t("agents.retry") : t("agents.automation.delete")}
            </Button>
          </div>
        </AlertDialog.Content>
      </div>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
}
