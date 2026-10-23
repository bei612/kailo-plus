// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/shared/ui/alert-dialog.tsx default surface
// (AlertDialogContent/Header/Title/Description/Footer) for the restored Agents page dialogs.
import type { ReactNode } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { cn } from "../profile/buzz/shared/lib/cn";
import { MODAL_BACKDROP_BLUR_CLASS } from "../composer/shared/ui/modalBackdrop";
import { MODAL_CONTENT_MOTION_CLASS, MODAL_OVERLAY_MOTION_CLASS } from "../composer/shared/ui/modalMotion";

export const AlertDialogCancel = AlertDialog.Cancel;
export const AlertDialogAction = AlertDialog.Action;

export function AgentAlertDialog({ open, onOpenChange, title, description, footer, children, testId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  footer: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  return <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
    <AlertDialog.Portal>
      <AlertDialog.Overlay className={cn("fixed inset-0 z-50 bg-black/60", MODAL_OVERLAY_MOTION_CLASS, MODAL_BACKDROP_BLUR_CLASS)} />
      <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
        <AlertDialog.Content data-testid={testId}
          className={cn("pointer-events-auto grid w-[calc(100vw-2rem)] max-w-md gap-4 rounded-2xl border border-border bg-popover p-6 text-popover-foreground shadow-xl outline-hidden", MODAL_CONTENT_MOTION_CLASS)}>
          <div className="flex flex-col space-y-2 text-left">
            <AlertDialog.Title className="text-[1.0625rem] font-semibold leading-6 tracking-[-0.012em]">{title}</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-muted-foreground">{description}</AlertDialog.Description>
            {children}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>
        </AlertDialog.Content>
      </div>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
}
