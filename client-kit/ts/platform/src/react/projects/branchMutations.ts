// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/branchMutations.ts (useCreate/DeleteProjectRemoteBranchMutation,
// useProjectBranchActions). DD-118: the push is a governed collaboration write through the
// Projects host. One ref intent per repository is retained before sending: a definite answer
// settles it, an UNKNOWN outcome keeps it and only that exact request is resent with the same
// Idempotency-Key (the BFF reconciles it from info/refs). No other branch change is sent meanwhile.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { hashPayload } from "nostr-tools/nip98";
import { ProjectGitRefOperation, type ProjectsGitRefRequest } from "@client-kit/contracts";
import { newIdempotencyKey } from "../../governance";
import { translateCurrent as t } from "../../i18n";
import { BffError, TransportError } from "../../transport";
import type { ProjectsHost } from "./projectEnumeration";
import { projectGitRefRequest, type ProjectRepoBranchResult } from "./projectGit";
import type { Repository } from "./projectModels";
import { isProjectBranchOutcomeUnknown } from "./lib/projectBranchErrors";

export type ProjectGitRefIntent = { key: string; digest: string; request: ProjectsGitRefRequest };

const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const unknown = () => new TransportError(t("projects.branch.unknown"));
function recover<T>(action: () => T): T { try { return action(); } catch { throw unknown(); } }
const intentSlot = (host: ProjectsHost, repository: Pick<Repository, "repoAddress">) =>
  JSON.stringify(["project-git-ref", host.scopeKey, repository.repoAddress]);
const intentDigest = (request: ProjectsGitRefRequest) =>
  hashPayload([request.operation, request.repository, request.branch, request.sourceBranch ?? null, request.expectedCommit]);

function validRequest(value: unknown, repository: Pick<Repository, "repoAddress">): value is ProjectsGitRefRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<ProjectsGitRefRequest>;
  const create = request.operation === ProjectGitRefOperation.CreateBranch;
  return (create || request.operation === ProjectGitRefOperation.DeleteBranch) && request.repository === repository.repoAddress
    && typeof request.branch === "string" && request.branch.length > 0
    && typeof request.expectedCommit === "string" && COMMIT.test(request.expectedCommit)
    && (create ? typeof request.sourceBranch === "string" && request.sourceBranch.length > 0 : request.sourceBranch === undefined);
}

/** A retained, unconfirmed branch change for this repository: the UI may only resend this one. */
export function readProjectGitRefIntent(host: ProjectsHost, repository: Pick<Repository, "repoAddress">): ProjectGitRefIntent | null {
  const stored = recover(() => localStorage.getItem(intentSlot(host, repository)));
  if (stored === null) return null;
  const intent: ProjectGitRefIntent = recover(() => JSON.parse(stored));
  if (!intent || typeof intent.key !== "string" || !/^[0-9a-f-]{36}$/.test(intent.key)
    || !validRequest(intent.request, repository) || intent.digest !== intentDigest(intent.request)) throw unknown();
  return intent;
}

/** Send one branch change, or resend the retained one; `request` must equal a retained intent. */
export async function changeProjectRemoteBranch(host: ProjectsHost, repository: Repository,
  request: ProjectsGitRefRequest, signal: AbortSignal): Promise<ProjectRepoBranchResult> {
  signal.throwIfAborted();
  const create = request.operation === ProjectGitRefOperation.CreateBranch;
  const createBranch = host.git?.createProjectRemoteBranch, deleteBranch = host.git?.deleteProjectRemoteBranch;
  if (!(create ? createBranch : deleteBranch) || !validRequest(request, repository))
    throw new Error(t(create ? "projects.branch.createFailed" : "projects.branch.deleteFailed"));
  const slot = intentSlot(host, repository);
  const previous = readProjectGitRefIntent(host, repository);
  const digest = intentDigest(request);
  // Another unconfirmed change on this repository blocks a new one; it is never replaced.
  if (previous && previous.digest !== digest) throw unknown();
  const intent: ProjectGitRefIntent = previous ?? { key: newIdempotencyKey(), digest, request };
  // Persist only the typed request and its key before the push; never a credential.
  recover(() => localStorage.setItem(slot, JSON.stringify(intent)));
  try {
    // The digest covers the operation, so the retained request is this exact request.
    const retained = intent.request;
    const result = create
      ? await createBranch!({ repository: retained.repository, sourceBranch: retained.sourceBranch!, expectedCommit: retained.expectedCommit,
        newBranch: retained.branch }, intent.key)
      : await deleteBranch!({ repository: retained.repository, branch: retained.branch, expectedCommit: retained.expectedCommit }, intent.key);
    recover(() => localStorage.removeItem(slot));
    return result;
  } catch (error) {
    if (isProjectBranchOutcomeUnknown(error)) throw unknown();
    // The BFF answered definitively for this key (including after reconciliation).
    if (error instanceof BffError) { recover(() => localStorage.removeItem(slot)); throw error; }
    if (previous === null) recover(() => localStorage.removeItem(slot));
    throw previous === null ? error : unknown();
  }
}

function useRetainedProjectGitRefIntent(host: ProjectsHost, project: Repository | null | undefined) {
  const read = React.useCallback(() => {
    if (!project) return null;
    try { return readProjectGitRefIntent(host, project); } catch { return null; }
  }, [host, project]);
  const [state, setState] = React.useState(() => ({ project, intent: read() }));
  const refresh = React.useCallback(() => setState({ project, intent: read() }), [project, read]);
  React.useEffect(() => { if (state.project !== project) refresh(); }, [project, refresh, state.project]);
  return { intent: state.project === project ? state.intent : read(), refresh };
}

function useProjectRemoteBranchMutation(host: ProjectsHost, project: Repository | null | undefined, refresh: () => void) {
  const queryClient = useQueryClient();
  const lifetime = React.useMemo(() => ({ controller: new AbortController() }), [host, project]);
  React.useEffect(() => {
    if (lifetime.controller.signal.aborted) lifetime.controller = new AbortController();
    return () => lifetime.controller.abort();
  }, [lifetime]);
  return useMutation({
    mutationFn: (request: ProjectsGitRefRequest) => {
      if (!project) throw new Error("No project selected.");
      return changeProjectRemoteBranch(host, project, request, lifetime.controller.signal);
    },
    onSettled: refresh,
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["project", host.scopeKey, project?.id ?? "none"],
      }),
  });
}

/** Creates a remote branch from an observed branch commit. */
export function useCreateProjectRemoteBranchMutation(host: ProjectsHost, project: Repository | null | undefined, refresh: () => void = () => {}) {
  return useProjectRemoteBranchMutation(host, project, refresh);
}

/** Deletes a remote branch only if it still points at the observed commit. */
export function useDeleteProjectRemoteBranchMutation(host: ProjectsHost, project: Repository | null | undefined, refresh: () => void = () => {}) {
  return useProjectRemoteBranchMutation(host, project, refresh);
}

/** Coordinates branch dialogs and refreshes around the remote mutations. */
export function useProjectBranchActions(input: {
  host: ProjectsHost;
  project: Repository | null | undefined;
  activeBranch: string | null;
  activeBranchCommit: string | null;
  activeRemoteBranch: { name: string; commit: string } | null;
  defaultBranch: string | null;
  deleteBranchReason: string | null;
  refetchRepoState: () => Promise<unknown>;
  rememberBranch: (branch: { name: string; commit: string }) => void;
  forgetBranch: (branch: string) => void;
  selectBranch: (branch: string | null) => void;
}) {
  const [createOpen, setCreateOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const retained = useRetainedProjectGitRefIntent(input.host, input.project);
  const createMutation = useCreateProjectRemoteBranchMutation(input.host, input.project, retained.refresh);
  const deleteMutation = useDeleteProjectRemoteBranchMutation(input.host, input.project, retained.refresh);
  const createBranch = createMutation.mutateAsync;
  const deleteBranch = deleteMutation.mutateAsync;
  const retainedCreate = retained.intent?.request.operation === ProjectGitRefOperation.CreateBranch ? retained.intent.request : null;
  const retainedDelete = retained.intent?.request.operation === ProjectGitRefOperation.DeleteBranch ? retained.intent.request : null;

  const handleCreate = React.useCallback(
    async (newBranch: string) => {
      const project = input.project, sourceBranch = input.activeBranch, expectedCommit = input.activeBranchCommit;
      if (!project) throw new Error(t("projects.branch.createFailed"));
      // An unconfirmed creation is re-checked exactly as it was sent.
      if (!retainedCreate && (!sourceBranch || !expectedCommit)) {
        throw new Error(t("projects.branch.refreshSource"));
      }
      const request = retainedCreate ?? projectGitRefRequest({ repository: project.repoAddress,
        sourceBranch: sourceBranch!, expectedCommit: expectedCommit!, newBranch });
      const result = await createBranch(request);
      await input.refetchRepoState();
      input.rememberBranch({ name: result.branch, commit: result.commit });
      input.selectBranch(result.branch);
      toast.success(t("projects.branch.created", { branch: result.branch }));
    },
    [
      createBranch,
      input.activeBranch,
      input.activeBranchCommit,
      input.project,
      input.refetchRepoState,
      input.rememberBranch,
      input.selectBranch,
      retainedCreate,
    ],
  );
  const handleDelete = React.useCallback(async () => {
    const project = input.project, branch = input.activeBranch, remote = input.activeRemoteBranch;
    if (!project) throw new Error(t("projects.branch.deleteFailed"));
    if (!retainedDelete && (!branch || !remote || input.deleteBranchReason)) {
      throw new Error(input.deleteBranchReason ?? t("projects.branch.remoteOnly"));
    }
    const request = retainedDelete ?? projectGitRefRequest({ repository: project.repoAddress, branch: branch!,
      expectedCommit: remote!.commit });
    const result = await deleteBranch(request);
    input.forgetBranch(result.branch);
    input.selectBranch(input.defaultBranch);
    await input.refetchRepoState();
    toast.success(t("projects.branch.deleted", { branch: result.branch }));
  }, [
    deleteBranch,
    input.activeBranch,
    input.activeRemoteBranch,
    input.defaultBranch,
    input.deleteBranchReason,
    input.forgetBranch,
    input.project,
    input.refetchRepoState,
    input.selectBranch,
    retainedDelete,
  ]);

  return {
    available: Boolean(input.host.git?.createProjectRemoteBranch && input.host.git.deleteProjectRemoteBranch),
    createOpen,
    createPending: createMutation.isPending,
    deleteOpen,
    deletePending: deleteMutation.isPending,
    handleCreate,
    handleDelete,
    /** The unconfirmed change, if any; the other operation stays blocked until it settles. */
    retainedCreate,
    retainedDelete,
    setCreateOpen,
    setDeleteOpen,
  };
}
