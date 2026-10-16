// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/CreatePullRequestDialog.tsx. Same repository/base/compare
// selection, open-review guard, description and validation copy (shared catalog). DD-118: branches
// and the compare head come from the trusted repository state (REPOSITORY_STATES); the local
// sync-status fallback and merge-base need a local checkout this host does not have, so a branch
// must be pushed and mergeBase is not sent. Open reviews come from the caller's fresh work-item
// read. Creation publishes CREATE_PULL_REQUEST through the governed publication host.
import * as React from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useUiT } from "../context";
import { isOutcomeUnknown } from "../../transport";
import type { Project, Repository } from "./projectModels";
import { selectProjectRepository } from "./projectModels";
import type { ProjectsHost } from "./projectEnumeration";
import type { ProjectInboxWorkItem } from "./projectWorkItems";
import { useRepoStateQuery } from "./projectRepoState";
import { publishProjectPullRequest } from "./pullRequestMutations";
import { CreateProjectWorkItemDialog, type CreateProjectWorkItemDialogInput } from "./CreateProjectWorkItemDialog";

export type CreatePullRequestDialogInput = CreateProjectWorkItemDialogInput;

export function CreatePullRequestDialog({
  host,
  initialProjectId,
  initialRepositoryId,
  onCreated,
  onOpenChange,
  open,
  projects,
  workItems,
}: {
  host: ProjectsHost;
  initialProjectId?: string;
  initialRepositoryId?: string;
  onCreated: (project: Project, repository: Repository, pullRequestId: string) => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  projects: Project[];
  /** The caller's fresh work-item read; its reviews decide the open-review guard. */
  workItems: ProjectInboxWorkItem[];
}) {
  const t = useUiT();
  const cache = useQueryClient();
  const [isCreating, setIsCreating] = React.useState(false);
  const lifetime = React.useMemo(() => ({ controller: new AbortController() }), [host, open]);
  React.useEffect(() => {
    if (lifetime.controller.signal.aborted) lifetime.controller = new AbortController();
    return () => lifetime.controller.abort();
  }, [lifetime]);
  const repositoryOptions = React.useMemo(
    () => projects.flatMap((project) => project.repositories.map((repository) => ({ project, repository }))),
    [projects],
  );
  const initialProject = projects.find((project) => project.id === initialProjectId) ?? projects[0];
  const initialRepository = selectProjectRepository(initialProject, initialRepositoryId ?? null);
  const [repositoryId, setRepositoryId] = React.useState(initialRepository?.id ?? "");
  const selection = repositoryOptions.find((candidate) => candidate.repository.id === repositoryId) ?? repositoryOptions[0];
  const project = selection?.project;
  const repository = selection?.repository;
  const repoStateQuery = useRepoStateQuery(host, repository);
  const branchOptions = React.useMemo(() => {
    const names = [
      repository?.defaultBranch,
      ...(repoStateQuery.data?.branches.map((branch) => branch.name) ?? []),
    ].filter((name): name is string => Boolean(name));
    return [...new Set(names)];
  }, [repository?.defaultBranch, repoStateQuery.data?.branches]);
  const [targetBranch, setTargetBranch] = React.useState(repository?.defaultBranch ?? "");
  const [sourceBranch, setSourceBranch] = React.useState("");

  // Keyed by project identity: a caller's re-filtered list must not reset the user's choice.
  const projectKey = projects.map((project) => project.id).join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: projectKey stands for projects.
  React.useEffect(() => {
    if (!open) return;
    const nextProject = projects.find((candidate) => candidate.id === initialProjectId) ?? projects[0];
    setRepositoryId(selectProjectRepository(nextProject, initialRepositoryId ?? null)?.id ?? "");
  }, [initialProjectId, initialRepositoryId, open, projectKey]);

  React.useEffect(() => {
    if (!repository) return;
    setTargetBranch(repository.defaultBranch);
    setSourceBranch("");
  }, [repository]);

  React.useEffect(() => {
    if (sourceBranch && branchOptions.includes(sourceBranch) && sourceBranch !== targetBranch) {
      return;
    }
    setSourceBranch(branchOptions.find((branch) => branch !== targetBranch) ?? "");
  }, [branchOptions, sourceBranch, targetBranch]);

  const sourceCommit = repoStateQuery.data?.branches.find((branch) => branch.name === sourceBranch)?.commit ?? null;
  const hasOpenPullRequest = workItems.some(
    (item) =>
      item.type === "pull-request" &&
      item.repository.repoAddress === repository?.repoAddress &&
      (item.pullRequest.status === "Open" || item.pullRequest.status === "Draft") &&
      item.pullRequest.branchName === sourceBranch &&
      (item.pullRequest.targetBranch ?? repository?.defaultBranch) === targetBranch,
  );
  const selectionError = !repository
    ? t("projects.review.chooseRepository")
    : !targetBranch
      ? t("projects.review.chooseBase")
      : !sourceBranch
        ? t("projects.review.chooseCompare")
        : sourceBranch === targetBranch
          ? t("projects.review.sameBranches")
          : hasOpenPullRequest
            ? t("projects.review.openExists")
            : !sourceCommit
              ? t("projects.review.pushFirst")
              : null;
  const description =
    repository && sourceBranch && targetBranch
      ? sourceCommit
        ? t("projects.review.compareSummaryAt", { repository: repository.name, source: sourceBranch, target: targetBranch, commit: sourceCommit.slice(0, 7) })
        : t("projects.review.compareSummary", { repository: repository.name, source: sourceBranch, target: targetBranch })
      : t("projects.review.chooseBranches");

  async function handleCreate(input: CreatePullRequestDialogInput) {
    if (!project || !repository || !sourceCommit || selectionError) {
      throw new Error(selectionError ?? t("projects.review.createFailed"));
    }
    setIsCreating(true);
    let eventId: string;
    try {
      const result = await publishProjectPullRequest(host, project.id, repository, {
        title: input.title,
        body: input.body,
        branch: sourceBranch,
        targetBranch,
        commit: sourceCommit,
        mergeBase: null,
        reviewers: [],
      }, lifetime.controller.signal);
      lifetime.controller.signal.throwIfAborted();
      cache.setQueryData(["project-home-work-items", host.scopeKey, project.id], result.snapshot);
      // A confirmed review is settled before navigation; a failed navigation is not a failed write.
      result.complete();
      toast.success(t("projects.review.created"));
      eventId = result.eventId;
    } catch (error) {
      if (isOutcomeUnknown(error)) throw new Error(t("projects.review.unknown"));
      throw new Error(t("projects.review.createFailed"));
    } finally {
      if (!lifetime.controller.signal.aborted) setIsCreating(false);
    }
    await Promise.resolve(onCreated(project, repository, eventId)).catch(() => {});
  }

  const selectClass = "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal outline-hidden focus:ring-1 focus:ring-ring";
  return (
    <CreateProjectWorkItemDialog
      bodyPlaceholder={t("projects.review.bodyPlaceholder")}
      description={description}
      isCreating={isCreating}
      itemName="pull-request"
      onCreate={handleCreate}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isCreating) return;
        onOpenChange(nextOpen);
      }}
      open={open}
      submitDisabled={Boolean(selectionError)}
      title={t("projects.review.dialogTitle")}
      titlePlaceholder={t("projects.review.titlePlaceholder")}
    >
      <div className="grid gap-3 rounded-xl border border-border/60 bg-muted/25 p-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm font-medium sm:col-span-2">
          <span>{t("projects.issue.repository")}</span>
          <select
            className={selectClass}
            data-testid="create-pull-request-repository"
            disabled={isCreating}
            onChange={(event) => setRepositoryId(event.target.value)}
            value={repository?.id ?? ""}
          >
            {repositoryOptions.map((candidate) => (
              <option key={candidate.repository.id} value={candidate.repository.id}>
                {candidate.project.repositories.length > 1
                  ? `${candidate.project.name} / ${candidate.repository.name}`
                  : candidate.project.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          <span>{t("projects.review.base")}</span>
          <select
            className={selectClass}
            data-testid="create-pull-request-base-branch"
            disabled={isCreating}
            onChange={(event) => setTargetBranch(event.target.value)}
            value={targetBranch}
          >
            {branchOptions.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          <span>{t("projects.review.compare")}</span>
          <select
            className={selectClass}
            data-testid="create-pull-request-compare-branch"
            disabled={isCreating}
            onChange={(event) => setSourceBranch(event.target.value)}
            value={sourceBranch}
          >
            <option disabled value="">
              {t("projects.review.selectBranch")}
            </option>
            {branchOptions.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
        </label>
        {selectionError ? <p className="text-xs text-muted-foreground sm:col-span-2">{selectionError}</p> : null}
      </div>
    </CreateProjectWorkItemDialog>
  );
}
