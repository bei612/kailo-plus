// Shared original Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/shared/ui/link-preview-list.tsx: "Remove preview" asks once, hides the cards at
// once and shows them again when the removal fails (desktop/src/features/messages/ui/
// MessageRow.tsx toasts "Failed to remove previews: ..."). The host owns the signed edit.
import * as React from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { toast } from "sonner";

import { useUiT } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Button } from "../profile/buzz/shared/ui/button";
import { MODAL_BACKDROP_BLUR_CLASS } from "../composer/shared/ui/modalBackdrop";
import { MODAL_CONTENT_MOTION_CLASS, MODAL_OVERLAY_MOTION_CLASS } from "../composer/shared/ui/modalMotion";

export type LinkPreviewRemoval = {
  /** The list stays hidden while the removal runs and after it succeeded. */
  hidden: boolean;
  /** The first card's "Remove preview" item; absent when the host offers no removal. */
  requestRemove?: () => void;
  dialog: React.ReactNode;
};

export function useLinkPreviewRemoval(
  count: number,
  onRemoveForEveryone?: () => Promise<void>,
): LinkPreviewRemoval {
  const t = useUiT();
  const [open, setOpen] = React.useState(false);
  const [removed, setRemoved] = React.useState(false);
  const many = count !== 1;
  const confirm = () => {
    if (!onRemoveForEveryone) return;
    setOpen(false);
    setRemoved(true);
    void onRemoveForEveryone().catch((error: unknown) => {
      setRemoved(false);
      toast.error(t("linkPreview.removeFailed", {
        reason: error instanceof Error ? error.message : String(error),
      }));
    });
  };
  const dialog = onRemoveForEveryone ? (
    <AlertDialog.Root open={open} onOpenChange={setOpen}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={cn("fixed inset-0 z-50 bg-black/60", MODAL_OVERLAY_MOTION_CLASS, MODAL_BACKDROP_BLUR_CLASS)} />
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
          <AlertDialog.Content className={cn(
            "pointer-events-auto grid w-[calc(100vw-2rem)] max-w-md gap-4 outline-hidden rounded-3xl bg-background p-6 shadow-2xl",
            MODAL_CONTENT_MOTION_CLASS,
          )} data-testid="link-preview-remove-dialog">
            <div className="flex flex-col space-y-2 text-left">
              <AlertDialog.Title className="text-xl font-semibold tracking-tight">
                {t(many ? "linkPreview.removeTitleMany" : "linkPreview.removeTitleOne")}
              </AlertDialog.Title>
              <AlertDialog.Description className="text-sm text-muted-foreground">
                {t(many ? "linkPreview.removeBodyMany" : "linkPreview.removeBodyOne")}
              </AlertDialog.Description>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AlertDialog.Cancel asChild>
                <Button type="button" variant="outline">{t("linkPreview.removeCancel")}</Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button data-testid="link-preview-remove-confirm" onClick={(event) => { event.preventDefault(); confirm(); }}
                  type="button" variant="destructive">
                  {t(many ? "linkPreview.removeConfirmMany" : "linkPreview.remove")}
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </div>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  ) : null;
  return {
    hidden: removed,
    ...(onRemoveForEveryone ? { requestRemove: () => setOpen(true) } : {}),
    dialog,
  };
}
