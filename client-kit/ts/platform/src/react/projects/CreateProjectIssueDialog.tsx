import * as React from "react";
import { toast } from "sonner";

import type { Project, Repository } from "./projectModels";
import type { ProjectsHost } from "./projectEnumeration";
import { useUiT } from "../context";
import { useQueryClient } from "@tanstack/react-query";
import { isOutcomeUnknown } from "../../transport";
import { publishProjectIssue } from "./issueMutations";
import { selectProjectRepository } from "./projectModels";
import {
  CreateProjectWorkItemDialog,
  type CreateProjectWorkItemDialogInput,
} from "./CreateProjectWorkItemDialog";

export function CreateProjectIssueDialog({
  host,
  initialProjectId,
  onCreated,
  onOpenChange,
  open,
  projects,
}: {
  host: ProjectsHost;
  initialProjectId?: string;
  onCreated: (
    project: Project,
    repository: Repository,
    issueId: string,
  ) => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  projects: Project[];
}) {
  const t = useUiT();
  const cache = useQueryClient();
  const [isCreating,setIsCreating] = React.useState(false);
  const lifetime = React.useMemo(()=>({controller:new AbortController()}),[host,open]);
  React.useEffect(()=>{if(lifetime.controller.signal.aborted)lifetime.controller=new AbortController();return()=>lifetime.controller.abort();},[lifetime]);
  const repositoryOptions = React.useMemo(
    () =>
      projects.flatMap((project) =>
        project.repositories.map((repository) => ({ project, repository })),
      ),
    [projects],
  );
  const initialProject =
    projects.find((project) => project.id === initialProjectId) ?? projects[0];
  const [repositoryId, setRepositoryId] = React.useState(
    selectProjectRepository(initialProject, null)?.id ?? "",
  );
  const selection =
    repositoryOptions.find(
      (candidate) => candidate.repository.id === repositoryId,
    ) ?? repositoryOptions[0];
  const project = selection?.project;
  const repository = selection?.repository;

  React.useEffect(() => {
    if (!open) return;
    const nextProject =
      projects.find((candidate) => candidate.id === initialProjectId) ??
      projects[0];
    setRepositoryId(selectProjectRepository(nextProject, null)?.id ?? "");
  }, [initialProjectId, open, projects]);

  async function handleCreate(input: CreateProjectWorkItemDialogInput) {
    if (!project || !repository) throw new Error(t("projects.issue.chooseRepository"));
    setIsCreating(true);
    try {
      const result = await publishProjectIssue(host, project.id, repository, input, lifetime.controller.signal);
      lifetime.controller.signal.throwIfAborted();
      cache.setQueryData(["project-home-work-items",host.scopeKey,project.id],result.snapshot);
      await onCreated(project, repository, result.eventId);
      lifetime.controller.signal.throwIfAborted();
      result.complete();
      toast.success(t("projects.issue.created"));
    } catch(error) {
      if (isOutcomeUnknown(error)) throw new Error(t("projects.issue.unknown"));
      throw new Error(t("projects.issue.createFailed"));
    } finally { if (!lifetime.controller.signal.aborted) setIsCreating(false); }
  }

  return (
    <CreateProjectWorkItemDialog
      bodyPlaceholder={t("projects.issue.bodyPlaceholder")}
      description={
        repository
          ? t("projects.issue.inRepository",{name:repository.name})
          : t("projects.issue.chooseRepository")
      }
      isCreating={isCreating}
      itemName="issue"
      onCreate={handleCreate}
      onOpenChange={onOpenChange}
      open={open}
      submitDisabled={!repository}
      title={t("projects.issue.dialogTitle")}
      titlePlaceholder={t("projects.issue.titlePlaceholder")}
    >
      <label className="block space-y-1.5 text-sm font-medium">
        <span>{t("projects.issue.repository")}</span>
        <select
          className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal outline-hidden focus:ring-1 focus:ring-ring"
          data-testid="create-issue-repository"
          disabled={isCreating}
          onChange={(event) => setRepositoryId(event.target.value)}
          value={repository?.id ?? ""}
        >
          {repositoryOptions.map((candidate) => (
            <option
              key={candidate.repository.id}
              value={candidate.repository.id}
            >
              {candidate.project.repositories.length > 1
                ? `${candidate.project.name} / ${candidate.repository.name}`
                : candidate.project.name}
            </option>
          ))}
        </select>
      </label>
    </CreateProjectWorkItemDialog>
  );
}
