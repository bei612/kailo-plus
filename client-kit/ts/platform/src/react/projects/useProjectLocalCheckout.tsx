// Fixed Buzz 779af8886caae1317b4de962082429867ab61503: repoSyncHooks.ts,
// ProjectRepositorySource.tsx and ProjectRepositoryContextPanel's local controls.
// DD-160 keeps the same operations behind the Desktop host; Web has no checkout.
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, DownloadCloud, FolderOpen, HardDrive, Loader2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { useUiT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuTrigger } from "../sidebar/dropdown-menu";
import type { ProjectsHost } from "./projectEnumeration";
import type { Repository } from "./projectModels";
import { PROJECT_CONTEXT_ACTION_BUTTON_CLASS } from "./projectContextActionStyles";
import { PROJECT_PICKER_TRIGGER_CLASS } from "./projectPanelStyles";
import { isOutcomeUnknown } from "../../transport";

export function useProjectLocalCheckout(host: ProjectsHost, repository: Repository, branch: string) {
  const t = useUiT();
  const checkout = host.git?.checkout;
  const queryClient = useQueryClient();
  const owner = JSON.stringify([host.scopeKey, repository.repoAddress]);
  const [selected, setSelected] = React.useState({ owner, source: "remote" as "remote" | "local" });
  const source = checkout && selected.owner === owner ? selected.source : "remote";
  const selectSource = (source: "remote" | "local") => setSelected({ owner, source });
  const ref = { repository: repository.repoAddress, defaultBranch: branch, baseBranch: repository.defaultBranch };
  const branchRef = { repository: repository.repoAddress, branchName: branch, baseBranch: repository.defaultBranch };
  const status = useQuery({
    queryKey: ["project", host.scopeKey, repository.id, "local-status", branch], enabled: Boolean(checkout), retry: 1,
    queryFn: () => { if (!checkout) throw new Error("Local checkout unavailable"); return checkout.getProjectRepoSyncStatus(branchRef); },
  });
  const snapshot = useQuery({
    queryKey: ["project", host.scopeKey, repository.id, "local-snapshot", branch], enabled: Boolean(checkout && source === "local"), retry: 1,
    queryFn: async () => { if (!checkout) throw new Error("Local checkout unavailable"); return (await checkout.getProjectLocalRepoSnapshot(ref))?.snapshot ?? null; },
  });
  const mutation = useMutation({
    retry: false,
    mutationFn: async (action: "clone" | "push" | "pull" | "open") => {
      if (!checkout) throw new Error("Local checkout unavailable");
      if (action === "clone") { await checkout.cloneProjectRepository(ref); selectSource("local"); }
      if (action === "push") await checkout.pushProjectLocalRepository({ ...branchRef,
        branchName: status.data?.pendingPush?.branch ?? branchRef.branchName });
      if (action === "pull") await checkout.pullProjectLocalRepository(branchRef);
      if (action === "open") await checkout.openProjectRepositoryFolder({ repository: repository.repoAddress });
    },
    onError: (error, action) => {
      const reason = typeof error === "string" ? error : error instanceof Error ? error.message : "";
      if (reason === "project_repo_outcome_unknown" || action === "push" && isOutcomeUnknown(error)) toast.info(t("projects.checkout.unknown"));
      else toast.error(t(reason === "project_repo_conflict" ? "projects.checkout.conflict" : "projects.checkout.failed"));
    },
    onSuccess: (_data, action) => { if (action !== "open") toast.success(t("projects.checkout.completed")); },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["project", host.scopeKey, repository.id] }),
  });
  return { available: Boolean(checkout), source, selectSource, status, snapshot, mutation };
}

export type ProjectLocalCheckoutState = ReturnType<typeof useProjectLocalCheckout>;

/** Original remote/local dropdown, Clone, Pull/Push and Open folder operations. */
export function ProjectLocalCheckoutControls({ state }: { state: ProjectLocalCheckoutState }) {
  const t = useUiT();
  if (!state.available) return null;
  const status = state.status.data;
  const pending = status?.pendingPush;
  const busy = state.mutation.isPending || state.status.isFetching;
  const local = Boolean(status?.localPath);
  const cloneAvailable = state.status.isSuccess && status === null;
  const Icon = state.source === "local" ? HardDrive : Cloud;
  const actionClass = PROJECT_CONTEXT_ACTION_BUTTON_CLASS;
  const run = (action: "clone" | "push" | "pull" | "open") => state.mutation.mutate(action);
  return <div className="grid gap-0.5" data-testid="project-local-checkout-controls">
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className={PROJECT_PICKER_TRIGGER_CLASS} size="sm" type="button" variant="outline">
          <Icon className="h-4 w-4"/>{t(state.source === "local" ? "projects.checkout.local" : "projects.checkout.remote")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={state.source} onValueChange={value => state.selectSource(value === "local" ? "local" : "remote")}>
          <DropdownMenuRadioItem value="remote"><Cloud className="h-4 w-4"/>{t("projects.checkout.remote")}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="local" disabled={!local}><HardDrive className="h-4 w-4"/>{t("projects.checkout.local")}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {cloneAvailable ? <DropdownMenuItem disabled={busy} onSelect={() => run("clone")}><DownloadCloud className="h-4 w-4"/>{t("projects.checkout.clone")}</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
    {state.status.error ? <p className="text-xs text-destructive" role="alert">{t("projects.checkout.failed")}</p> : null}
    {pending ? <p className="break-all text-xs text-muted-foreground" role="status">{t(pending.outcome === "conflict" ? "projects.checkout.conflict" : "projects.checkout.unknown")} {pending.branch} · {pending.newCommit.slice(0, 7)}</p> : null}
    {local ? <>
      {status?.canPull && !pending ? <Button className={actionClass} disabled={busy} onClick={() => run("pull")} size="sm" type="button" variant="ghost">
        <DownloadCloud className="h-3.5 w-3.5"/>{t("projects.checkout.pull")} {status?.behindCount ? status.behindCount : ""}
      </Button> : status?.canPush ? <Button className={actionClass} disabled={busy} onClick={() => run("push")} size="sm" type="button" variant="ghost">
        {state.mutation.isPending && state.mutation.variables === "push" ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : <UploadCloud className="h-3.5 w-3.5"/>}
        {t(pending ? "projects.checkout.retry" : "projects.checkout.push")} {status?.aheadCount ? status.aheadCount : ""}
      </Button> : null}
      <Button className={actionClass} disabled={busy} onClick={() => run("open")} size="sm" type="button" variant="ghost"><FolderOpen className="h-3.5 w-3.5"/>{t("projects.checkout.open")}</Button>
      {status?.localPath ? <p className="truncate text-xs text-muted-foreground" title={status.localPath}>{status.localPath}</p> : null}
    </> : null}
  </div>;
}
