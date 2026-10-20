// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/AddProjectRepositoryDialog.tsx.
// Same fields, focus and submit rules; copy comes from the shared catalog. Access channels are the
// caller's admitted member streams (DD-80: a Workspace id is its Channel id).
import * as React from "react";
import { useUiT } from "../context";
import { ChooserDialogContent } from "../composer/shared/ui/chooser-dialog-content";
import { Dialog } from "../composer/shared/ui/dialog";
import { Input } from "../composer/shared/ui/input";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Button } from "../profile/buzz/shared/ui/button";
import type { Project } from "./projectModels";
import type { AddProjectRepositoryInput } from "./projectRepositoryManagement";

const FIELD_SHELL_CLASS =
  "flex min-h-11 items-center rounded-xl border border-input bg-muted/40 px-3 transition-colors hover:border-muted-foreground/40 focus-within:border-muted-foreground/50";
const FIELD_CONTROL_CLASS =
  "h-8 border-0 bg-transparent px-0 py-0 text-muted-foreground/55 shadow-none outline-none ring-0 placeholder:text-muted-foreground/55 focus:bg-transparent focus:text-foreground focus-visible:ring-0";

export type ProjectAccessChannel = { workspaceId: string; channelId: string; name: string };

export function AddProjectRepositoryDialog({
  accessWorkspaceId,
  channels,
  errorText,
  isCreating,
  onAdd,
  onOpenChange,
  open,
  project,
  projects,
}: {
  /** The inherited access stream, preselected when the dialog opens. */
  accessWorkspaceId?: string;
  channels: ProjectAccessChannel[];
  /** Catalog text for a failed add (definite refusal or unconfirmed result). */
  errorText: (error: unknown) => string;
  isCreating: boolean;
  onAdd: (input: AddProjectRepositoryInput) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  project?: Project;
  projects?: Project[];
}) {
  const t = useUiT();
  const projectOptions = React.useMemo(
    () => projects ?? (project ? [project] : []),
    [project, projects],
  );
  const [selectedProjectId, setSelectedProjectId] = React.useState(
    project?.id ?? projectOptions[0]?.id ?? "",
  );
  const selectedProject =
    projectOptions.find((candidate) => candidate.id === selectedProjectId) ??
    projectOptions[0];
  const [name, setName] = React.useState("");
  const [cloneUrl, setCloneUrl] = React.useState("");
  const [selectedChannelId, setSelectedChannelId] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const nameInputRef = React.useRef<HTMLInputElement>(null);
  const projectSelectRef = React.useRef<HTMLSelectElement>(null);

  React.useEffect(() => {
    if (!open) return;
    setName("");
    setCloneUrl("");
    setSelectedProjectId(project?.id ?? projectOptions[0]?.id ?? "");
    setSelectedChannelId(accessWorkspaceId ?? "");
    setErrorMessage(null);
    const timerId = globalThis.setTimeout(
      () =>
        (projects ? projectSelectRef.current : nameInputRef.current)?.focus(),
      50,
    );
    return () => globalThis.clearTimeout(timerId);
  }, [accessWorkspaceId, open, project?.id, projectOptions, projects]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const access = channels.find((channel) => channel.workspaceId === selectedChannelId);
    if (!name.trim() || !access || !selectedProject) return;
    setErrorMessage(null);
    try {
      await onAdd({
        access: { workspaceId: access.workspaceId, channelId: access.channelId },
        cloneUrl: cloneUrl.trim() || undefined,
        name: name.trim(),
        project: selectedProject,
      });
      onOpenChange(false);
    } catch (error) {
      setErrorMessage(errorText(error));
    }
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isCreating) return;
        onOpenChange(nextOpen);
      }}
      open={open}
    >
      <ChooserDialogContent
        className="max-w-lg"
        contentClassName="pt-3"
        data-testid="add-project-repository-dialog"
        description={
          selectedProject
            ? t("projects.repository.addDescription", { name: selectedProject.name })
            : t("projects.repository.chooseProject")
        }
        footer={
          <Button
            data-testid="add-project-repository-submit"
            disabled={
              isCreating ||
              !name.trim() ||
              !selectedChannelId ||
              !selectedProject
            }
            form="add-project-repository-form"
            type="submit"
          >
            {isCreating ? t("projects.repository.adding") : t("projects.repository.add")}
          </Button>
        }
        footerClassName="border-t-0 pt-0"
        headerClassName="pb-2"
        title={t("projects.repository.add")}
      >
        <form
          className="space-y-5"
          id="add-project-repository-form"
          onSubmit={(event) => void handleSubmit(event)}
        >
          {projects ? (
            <div className="space-y-1.5">
              <label
                className="text-sm font-medium text-foreground"
                htmlFor="add-project-repository-project"
              >
                {t("projects.repository.project")}
              </label>
              <div className={FIELD_SHELL_CLASS}>
                <select
                  className={cn(FIELD_CONTROL_CLASS, "w-full")}
                  data-testid="add-project-repository-project"
                  disabled={isCreating}
                  id="add-project-repository-project"
                  onChange={(event) => {
                    setSelectedProjectId(event.target.value);
                    setErrorMessage(null);
                  }}
                  ref={projectSelectRef}
                  required
                  value={selectedProject?.id ?? ""}
                >
                  {projectOptions.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <label
              className="text-sm font-medium text-foreground"
              htmlFor="add-project-repository-name"
            >
              {t("projects.repository.name")}
            </label>
            <div className={FIELD_SHELL_CLASS}>
              <Input
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                className={cn(FIELD_CONTROL_CLASS)}
                data-testid="add-project-repository-name"
                disabled={isCreating}
                id="add-project-repository-name"
                onChange={(event) => {
                  setName(event.target.value);
                  setErrorMessage(null);
                }}
                placeholder="mobile-app"
                ref={nameInputRef}
                spellCheck={false}
                value={name}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label
              className="text-sm font-medium text-foreground"
              htmlFor="add-project-repository-channel"
            >
              {t("projects.repository.accessChannel")}
            </label>
            <div className={FIELD_SHELL_CLASS}>
              <select
                className={cn(FIELD_CONTROL_CLASS, "w-full")}
                data-testid="add-project-repository-channel"
                disabled={isCreating}
                id="add-project-repository-channel"
                onChange={(event) => {
                  setSelectedChannelId(event.target.value);
                  setErrorMessage(null);
                }}
                required
                value={selectedChannelId}
              >
                <option value="">{t("projects.repository.selectChannel")}</option>
                {channels.map((channel) => (
                  <option key={channel.workspaceId} value={channel.workspaceId}>
                    {channel.name}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("projects.repository.accessChannelHint")}
            </p>
          </div>
          <div className="space-y-1.5">
            <label
              className="text-sm font-medium text-foreground"
              htmlFor="add-project-repository-clone-url"
            >
              {t("projects.repository.cloneUrl")}
              <span className="ml-1 text-xs font-normal text-muted-foreground/50">
                {t("channel.create.optional")}
              </span>
            </label>
            <div className={FIELD_SHELL_CLASS}>
              <Input
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                className={cn(FIELD_CONTROL_CLASS)}
                data-testid="add-project-repository-clone-url"
                disabled={isCreating}
                id="add-project-repository-clone-url"
                onChange={(event) => {
                  setCloneUrl(event.target.value);
                  setErrorMessage(null);
                }}
                placeholder="https://relay.example.com/git/mobile-app.git"
                spellCheck={false}
                value={cloneUrl}
              />
            </div>
          </div>
          {errorMessage ? (
            <p className="text-sm text-destructive" role="alert">{errorMessage}</p>
          ) : null}
        </form>
      </ChooserDialogContent>
    </Dialog>
  );
}
