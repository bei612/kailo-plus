// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/workflows/ui/WorkflowDialog.tsx::WorkflowDialog discard confirmation;
// desktop/src/shared/ui/alert-dialog.tsx::AlertDialogContent/Header/Footer/Title/Description.
// This consumer uses the original default surface, not the unused textured variant.
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Button } from "./profile/buzz/shared/ui/button";
import { cn } from "./profile/buzz/shared/lib/cn";
import { MODAL_BACKDROP_BLUR_CLASS } from "./composer/shared/ui/modalBackdrop";
import { MODAL_CONTENT_MOTION_CLASS, MODAL_OVERLAY_MOTION_CLASS } from "./composer/shared/ui/modalMotion";
import { useT } from "./context";

// The router belongs to each host. Only its original resolver crosses this seam;
// drafts and frozen action intent remain in the shared workflow editor.
export type WorkflowNavigationState = { dirty: boolean; locked: boolean };
export type WorkflowNavigation = {
  blocker: { status: "blocked" | "idle"; proceed?: () => void; reset?: () => void };
  onStateChange: (state: WorkflowNavigationState) => void;
};

export function workflowBlocksNavigation(state: WorkflowNavigationState,
  current: { pathname: string; search: Record<string, unknown> },
  next: { pathname: string; search: Record<string, unknown> }): boolean {
  // Original WorkflowDialog permits only a pane-only transition. Scope and
  // protocol host changes must never be mistaken for that in the Kailo routes.
  const paneOnly = current.pathname === next.pathname
    && current.search.pane !== next.search.pane
    && Object.keys({ ...current.search, ...next.search }).every((key) => key === "pane"
      || current.search[key] === next.search[key]);
  return (state.dirty || state.locked) && !paneOnly;
}

export function WorkflowDiscardDialog({ open, onOpenChange, onDiscard }: {
  open: boolean; onOpenChange: (open: boolean) => void; onDiscard: () => void;
}) {
  const t = useT();
  return <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
    <AlertDialog.Portal>
      <AlertDialog.Overlay className={cn("fixed inset-0 z-50 bg-black/60", MODAL_OVERLAY_MOTION_CLASS, MODAL_BACKDROP_BLUR_CLASS)} />
      <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
        <AlertDialog.Content className={cn("pointer-events-auto grid w-[calc(100vw-2rem)] max-w-md gap-4 outline-hidden rounded-3xl bg-background p-6 shadow-2xl", MODAL_CONTENT_MOTION_CLASS)}>
          <div className="flex flex-col space-y-2 text-left">
            <AlertDialog.Title className="text-xl font-semibold tracking-tight">{t("workflows.discardTitle")}</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-muted-foreground">{t("workflows.discardDescription")}</AlertDialog.Description>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild><Button type="button" variant="outline">{t("workflows.keepEditing")}</Button></AlertDialog.Cancel>
            <AlertDialog.Action asChild><Button onClick={onDiscard} type="button" variant="destructive">{t("workflows.discard")}</Button></AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </div>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
}
