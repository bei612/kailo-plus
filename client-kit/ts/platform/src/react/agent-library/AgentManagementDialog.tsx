// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/agents/ui/AgentDefinitionDialogShell.tsx::AgentDefinitionDialogShell
// desktop/src/shared/ui/chooser-dialog-content.tsx::ChooserDialogContent.
// Existing governed consumers own form state and the frozen request, not this shell.
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../composer/shared/ui/dialog";

export function AgentManagementDialog({ open, title, locked = false, onClose, children }: {
  open: boolean; title: string; locked?: boolean; onClose: () => void; children: ReactNode;
}) {
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !locked) onClose(); }}>
    <DialogContent aria-describedby={undefined} showCloseButton={!locked}
      className="flex max-h-[85vh] max-w-3xl flex-col gap-0 overflow-hidden border-0 p-0"
      onEscapeKeyDown={(event) => { if (locked) event.preventDefault(); }}
      onInteractOutside={(event) => { if (locked) event.preventDefault(); }}>
      <DialogHeader className="shrink-0 px-6 py-5 pb-2 pr-14"><DialogTitle>{title}</DialogTitle></DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-6"><div className="py-5 pt-3">{children}</div></div>
    </DialogContent>
  </Dialog>;
}
