// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/workflows/ui/WorkflowUnavailableDialog.tsx::WorkflowUnavailableDialog.
// Shown when an authorized definition read cannot prove the workflow; it never
// substitutes another definition or reveals why access failed.
import { X } from "lucide-react";
import { Button } from "./profile/buzz/shared/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./composer/shared/ui/dialog";
import { Skeleton } from "./sidebar/skeleton";
import { useT } from "./context";

export function WorkflowUnavailableDialog({ loading, onOpenChange, onRetry, open }: {
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
  open: boolean;
}) {
  const t = useT();
  return <Dialog onOpenChange={onOpenChange} open={open}>
    <DialogContent className="sm:max-w-lg" showCloseButton={false} data-testid="workflow-unavailable-dialog">
      <DialogHeader>
        <DialogTitle>{t(loading ? "workflows.unavailable.loadingTitle" : "workflows.unavailable.title")}</DialogTitle>
        <DialogDescription>{t(loading ? "workflows.unavailable.loadingDescription" : "workflows.unavailable.description")}</DialogDescription>
      </DialogHeader>
      {loading ? <div aria-label={t("workflows.unavailable.loading")} className="space-y-3" role="status">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div> : <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline"><X className="h-4 w-4" />{t("buzz.close")}</Button>
        </DialogClose>
        <Button onClick={onRetry} type="button">{t("workflows.unavailable.retry")}</Button>
      </DialogFooter>}
    </DialogContent>
  </Dialog>;
}
