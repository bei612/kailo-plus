// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/agents/ui/AgentDefinitionDialogShell.tsx::AgentDefinitionDialogShell
// desktop/src/shared/ui/chooser-dialog-content.tsx::ChooserDialogContent.
// Existing governed consumers own form state and the frozen request, not this shell.
import type { ReactNode } from "react";
import { Dialog } from "../composer/shared/ui/dialog";
import { ChooserDialogContent } from "../composer/shared/ui/chooser-dialog-content";

export function AgentManagementDialog({ open, title, locked = false, onClose, children, footer, dataTestId }: {
  open: boolean; title: string; locked?: boolean; onClose: () => void; children: ReactNode;
  footer?: ReactNode; dataTestId?: string;
}) {
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !locked) onClose(); }}>
    <ChooserDialogContent aria-describedby={undefined} showCloseButton={!locked}
      title={title} footer={footer} data-testid={dataTestId}
      className="max-w-3xl border-0" contentClassName="pt-3" headerClassName="pb-2" footerClassName="border-t-0 pt-0"
      onEscapeKeyDown={(event) => { if (locked) event.preventDefault(); }}
      onInteractOutside={(event) => { if (locked) event.preventDefault(); }}>
      {children}
    </ChooserDialogContent>
  </Dialog>;
}
