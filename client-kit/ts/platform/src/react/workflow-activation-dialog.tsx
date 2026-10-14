// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/workflows/ui/WorkflowsView.tsx activation AlertDialog
// (data-testid="workflow-activation-confirmation") on the default alert-dialog surface.
// "Turn on" continues into the existing governed automation.enable review; it is
// not an enable receipt.
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Button } from "./profile/buzz/shared/ui/button";
import { cn } from "./profile/buzz/shared/lib/cn";
import { MODAL_BACKDROP_BLUR_CLASS } from "./composer/shared/ui/modalBackdrop";
import { MODAL_CONTENT_MOTION_CLASS, MODAL_OVERLAY_MOTION_CLASS } from "./composer/shared/ui/modalMotion";
import { useT } from "./context";
import type { WorkflowActivationWarning } from "./workflow-activation-warning";

export function WorkflowActivationDialog({ warning, disabled = false, open, onConfirm, onOpenChange }: {
  warning: WorkflowActivationWarning | null;
  disabled?: boolean;
  open: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
    <AlertDialog.Portal>
      <AlertDialog.Overlay className={cn("fixed inset-0 z-50 bg-black/60", MODAL_OVERLAY_MOTION_CLASS, MODAL_BACKDROP_BLUR_CLASS)} />
      <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
        <AlertDialog.Content data-testid="workflow-activation-confirmation"
          className={cn("pointer-events-auto grid w-[calc(100vw-2rem)] max-w-md gap-4 outline-hidden rounded-3xl bg-background p-6 shadow-2xl", MODAL_CONTENT_MOTION_CLASS)}>
          <div className="flex flex-col space-y-2 text-left">
            <AlertDialog.Title className="text-xl font-semibold tracking-tight">
              {warning?.title ?? t("workflows.activation.fallbackTitle")}
            </AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-muted-foreground">
              {warning?.description ?? t("workflows.activation.fallbackDescription")}
            </AlertDialog.Description>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild><Button type="button" variant="outline">{t("workflows.activation.keepOff")}</Button></AlertDialog.Cancel>
            <Button disabled={disabled} onClick={onConfirm} type="button">{t("workflows.activation.turnOn")}</Button>
          </div>
        </AlertDialog.Content>
      </div>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
}
