// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectBranchDialogs.tsx. Same dialogs, validation and pending
// behaviour; copy comes from the shared catalog and the alert surface is the shared Radix one.
// DD-118: an unconfirmed (UNKNOWN) change is retained; the dialog then only re-checks that exact
// change (`retainedBranch` / `retained`), it never edits or replaces it.
import * as Alert from "@radix-ui/react-alert-dialog";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { useUiT } from "../context";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../composer/shared/ui/dialog";
import { Input } from "../composer/shared/ui/input";
import { MODAL_BACKDROP_BLUR_CLASS } from "../composer/shared/ui/modalBackdrop";
import { MODAL_CONTENT_MOTION_CLASS, MODAL_OVERLAY_MOTION_CLASS } from "../composer/shared/ui/modalMotion";
import { Button } from "../profile/buzz/shared/ui/button";
import { normalizeProjectBranchName, projectBranchNameError } from "./lib/projectBranches";
import { projectBranchErrorMessage } from "./lib/projectBranchErrors";

export function CreateProjectBranchDialog({
  existingBranches,
  onCreate,
  onOpenChange,
  open,
  pending,
  retainedBranch = null,
  sourceBranch,
  sourceCommit,
}: {
  existingBranches: string[];
  onCreate: (branch: string) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pending: boolean;
  /** The branch of an unconfirmed creation; only that creation can be re-checked. */
  retainedBranch?: string | null;
  sourceBranch: string;
  sourceCommit: string | null;
}) {
  const t = useUiT();
  const [branchName, setBranchName] = React.useState("");
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const validationError = retainedBranch ? null : projectBranchNameError(branchName, existingBranches);
  const ready = Boolean(retainedBranch) || Boolean(sourceCommit);

  React.useEffect(() => {
    if (!open) return;
    setBranchName(retainedBranch ?? "");
    setSubmitError(retainedBranch ? t("projects.branch.unknown") : null);
  }, [open, retainedBranch, t]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const branch = retainedBranch ?? normalizeProjectBranchName(branchName);
    if (!branch || validationError || !ready) return;
    setSubmitError(null);
    try {
      await onCreate(branch);
      onOpenChange(false);
    } catch (error) {
      setSubmitError(projectBranchErrorMessage(error, t("projects.branch.createFailed")));
    }
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen);
      }}
      open={open}
    >
      <DialogContent data-testid="project-create-branch-dialog">
        <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
          <DialogHeader>
            <DialogTitle>{t("projects.branch.createDialogTitle")}</DialogTitle>
            <DialogDescription>
              {sourceCommit
                ? t("projects.branch.createFromAt", { branch: sourceBranch, commit: sourceCommit.slice(0, 7) })
                : t("projects.branch.createFrom", { branch: sourceBranch })}
            </DialogDescription>
          </DialogHeader>
          <label className="block space-y-2 text-sm font-medium" htmlFor="project-create-branch-name">
            <span>{t("projects.branch.name")}</span>
            <Input
              autoFocus
              data-testid="project-create-branch-name"
              disabled={pending || Boolean(retainedBranch)}
              id="project-create-branch-name"
              onChange={(event) => setBranchName(event.target.value)}
              placeholder={t("projects.branch.namePlaceholder")}
              value={branchName}
            />
          </label>
          {branchName && validationError ? <p className="text-sm text-destructive">{validationError}</p> : null}
          {!ready ? <p className="text-sm text-destructive">{t("projects.branch.refreshBeforeCreate")}</p> : null}
          {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
          <DialogFooter>
            <Button disabled={pending} onClick={() => onOpenChange(false)} type="button" variant="outline">
              {t("platform.cancel")}
            </Button>
            <Button
              data-testid="project-create-branch-submit"
              disabled={pending || Boolean(validationError) || !ready}
              type="submit"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t(pending ? "projects.branch.creating" : retainedBranch ? "projects.branch.recheck" : "projects.branch.createSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteProjectBranchDialog({
  branch,
  onDelete,
  onOpenChange,
  open,
  pending,
  retained = false,
}: {
  branch: string;
  onDelete: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pending: boolean;
  /** An unconfirmed deletion of `branch` is retained; only it can be re-checked. */
  retained?: boolean;
}) {
  const t = useUiT();
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) setSubmitError(retained ? t("projects.branch.unknown") : null);
  }, [open, retained, t]);

  async function handleDelete() {
    setSubmitError(null);
    try {
      await onDelete();
      onOpenChange(false);
    } catch (error) {
      setSubmitError(projectBranchErrorMessage(error, t("projects.branch.deleteFailed")));
    }
  }

  return (
    <Alert.Root
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen);
      }}
      open={open}
    >
      <Alert.Portal>
        <Alert.Overlay className={`fixed inset-0 z-50 bg-black/60 ${MODAL_OVERLAY_MOTION_CLASS} ${MODAL_BACKDROP_BLUR_CLASS}`} />
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
          <Alert.Content
            className={`pointer-events-auto grid w-[calc(100vw-2rem)] max-w-md gap-4 outline-hidden rounded-3xl bg-background p-6 shadow-2xl ${MODAL_CONTENT_MOTION_CLASS}`}
            data-testid="project-delete-branch-dialog"
          >
            <div className="flex flex-col space-y-2 text-left">
              <Alert.Title className="text-xl font-semibold tracking-tight">{t("projects.branch.deleteDialogTitle")}</Alert.Title>
              <Alert.Description className="text-sm text-muted-foreground">
                {t("projects.branch.deleteDescription", { branch })}
              </Alert.Description>
            </div>
            {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Alert.Cancel asChild>
                <Button disabled={pending} type="button" variant="outline">
                  {t("platform.cancel")}
                </Button>
              </Alert.Cancel>
              <Button
                data-testid="project-delete-branch-submit"
                disabled={pending}
                onClick={() => void handleDelete()}
                type="button"
                variant="destructive"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t(pending ? "projects.branch.deleting" : retained ? "projects.branch.recheck" : "projects.branch.deleteSubmit")}
              </Button>
            </div>
          </Alert.Content>
        </div>
      </Alert.Portal>
    </Alert.Root>
  );
}
