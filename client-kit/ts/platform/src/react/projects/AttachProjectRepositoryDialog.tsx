// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/AttachProjectRepositoryDialog.tsx.
// Same chooser and rows; copy comes from the shared catalog.
import { FolderGit2 } from "lucide-react";
import * as React from "react";
import { useUiT } from "../context";
import { ChooserDialogContent } from "../composer/shared/ui/chooser-dialog-content";
import { Dialog } from "../composer/shared/ui/dialog";
import { Button } from "../profile/buzz/shared/ui/button";
import type { Project, Repository } from "./projectModels";

export function AttachProjectRepositoryDialog({
  isAttaching,
  onAttach,
  onOpenChange,
  open,
  project,
  repositories,
}: {
  isAttaching: boolean;
  onAttach: (repository: Repository) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  project: Project;
  repositories: Repository[];
}) {
  const t = useUiT();
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) setErrorMessage(null);
  }, [open]);

  async function handleAttach(repository: Repository) {
    setErrorMessage(null);
    try {
      await onAttach(repository);
      onOpenChange(false);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("projects.repository.attachFailed"),
      );
    }
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isAttaching) return;
        onOpenChange(nextOpen);
      }}
      open={open}
    >
      <ChooserDialogContent
        className="max-w-lg"
        contentClassName="max-h-96 overflow-y-auto pt-3"
        data-testid="attach-project-repository-dialog"
        description={t("projects.repository.attachDescription", { name: project.name })}
        title={t("projects.repository.attachTitle")}
      >
        <div className="space-y-2">
          {repositories.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("projects.repository.attachEmpty")}
            </p>
          ) : (
            repositories.map((repository) => (
              <Button
                className="h-auto w-full justify-start gap-3 px-3 py-2.5 text-left"
                data-testid={`attach-existing-repository-${repository.dtag}`}
                disabled={isAttaching}
                key={repository.repoAddress}
                onClick={() => void handleAttach(repository)}
                type="button"
                variant="outline"
              >
                <FolderGit2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {repository.name}
                  </span>
                  <span className="block truncate text-xs font-normal text-muted-foreground">
                    {repository.dtag}
                  </span>
                </span>
              </Button>
            ))
          )}
          {errorMessage ? (
            <p className="text-sm text-destructive" role="alert">{errorMessage}</p>
          ) : null}
        </div>
      </ChooserDialogContent>
    </Dialog>
  );
}
