// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectRepositoryManagement.tsx.
// Same Add menu (Create new / Select existing), access-channel menu, dialogs and toasts. Writes go
// through the Projects publication host as the viewer's own announcements (REQ-24, DD-118). The
// original owner-agent branches (useIsManagedAgent / ownsAuthorAgent) are absent: a Kailo Agent never
// signs for its Human, so only the signing owner of the coordinate may edit it.
import * as React from "react";
import { Check, FolderPlus, Link, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useFailureText, useUiT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../sidebar/dropdown-menu";
import { AddProjectRepositoryDialog } from "./AddProjectRepositoryDialog";
import { AttachProjectRepositoryDialog } from "./AttachProjectRepositoryDialog";
import type { ProjectsHost } from "./projectEnumeration";
import type { Project, Repository } from "./projectModels";
import {
  addProjectRepository,
  attachProjectRepository,
  bindProjectRepositoryChannel,
  projectManagementErrorText,
} from "./projectRepositoryManagement";
import { useProjectAccessChannels } from "./useProjectAccessChannels";

/** Every Projects read that shows announcements of this scope. */
export function invalidateProjectAnnouncements(cache: ReturnType<typeof useQueryClient>, scopeKey: string) {
  return Promise.all(["projects", "sidebar-projects", "projects-work-items", "project-work-item-target", "project-home-work-items"]
    .map(prefix => cache.invalidateQueries({ queryKey: [prefix, scopeKey] })));
}

export function ProjectRepositoryManagement({
  compact = false,
  createOpen: createOpenProp,
  hideTriggers = false,
  host,
  identityPubkey,
  onChange,
  onCreateOpenChange,
  project,
  projects,
  repository,
}: {
  compact?: boolean;
  createOpen?: boolean;
  hideTriggers?: boolean;
  host: ProjectsHost;
  identityPubkey?: string;
  onChange: (repositoryId: string) => void;
  onCreateOpenChange?: (open: boolean) => void;
  project: Project;
  projects: Project[];
  repository?: Repository | null;
}) {
  const t = useUiT();
  const failureText = useFailureText();
  const cache = useQueryClient();
  const [uncontrolledCreateOpen, setUncontrolledCreateOpen] =
    React.useState(false);
  const createOpen = createOpenProp ?? uncontrolledCreateOpen;
  const setCreateOpen = onCreateOpenChange ?? setUncontrolledCreateOpen;
  const [attachOpen, setAttachOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [attaching, setAttaching] = React.useState(false);
  const [repairing, setRepairing] = React.useState(false);
  const lifetime = React.useMemo(() => ({ controller: new AbortController() }), [host.scopeKey, project.projectAddress]);
  React.useEffect(() => {
    if (lifetime.controller.signal.aborted) lifetime.controller = new AbortController();
    return () => lifetime.controller.abort();
  }, [lifetime]);
  const viewer = identityPubkey?.toLowerCase();
  const viewerIsProjectOwner = viewer === project.owner.toLowerCase();
  const viewerIsRepositoryOwner = Boolean(repository && viewer === repository.owner.toLowerCase());
  const canEdit = Boolean(host.publish) && viewerIsProjectOwner;
  const accessChannels = useProjectAccessChannels(host.scopeKey,
    Boolean(host.publish) && (viewerIsProjectOwner || viewerIsRepositoryOwner));
  const inheritedChannel = [
    repository?.channelId,
    project.projectChannelId,
    project.repositories.find(
      (candidate) => candidate.id !== repository?.id && candidate.channelId,
    )?.channelId,
  ].map((candidate) => accessChannels.find((channel) => candidate && channel.channelId === candidate))
    .find(Boolean);
  const canManageAccess =
    Boolean(host.publish && repository) &&
    accessChannels.length > 0 &&
    viewerIsRepositoryOwner;
  const attachCandidates = React.useMemo(() => {
    const currentAddresses = new Set(project.repositoryAddresses);
    const candidates = new Map<string, Repository>();
    for (const candidateProject of projects) {
      for (const candidate of candidateProject.repositories) {
        if (!currentAddresses.has(candidate.repoAddress)) {
          candidates.set(candidate.repoAddress, candidate);
        }
      }
    }
    return [...candidates.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }, [project.repositoryAddresses, projects]);
  const errorText = (fallback: Parameters<typeof projectManagementErrorText>[3]) =>
    (error: unknown) => projectManagementErrorText(t, failureText, error, fallback);

  return (
    <>
      {canEdit ? <AddProjectRepositoryDialog
        accessWorkspaceId={inheritedChannel?.workspaceId}
        channels={accessChannels}
        errorText={errorText("projects.repository.addFailed")}
        isCreating={creating}
        onAdd={async (input) => {
          setCreating(true);
          try {
            const result = await addProjectRepository(host, input, lifetime.controller.signal);
            if (lifetime.controller.signal.aborted) return;
            await invalidateProjectAnnouncements(cache, host.scopeKey);
            onChange(result.repositoryId);
            toast.success(t("projects.repository.created", { name: input.name.trim() }));
          } finally {
            if (!lifetime.controller.signal.aborted) setCreating(false);
          }
        }}
        onOpenChange={setCreateOpen}
        open={createOpen}
        project={project}
      /> : null}
      {canEdit ? <AttachProjectRepositoryDialog
        isAttaching={attaching}
        onAttach={async (candidate) => {
          setAttaching(true);
          try {
            await attachProjectRepository(host, project, candidate, lifetime.controller.signal);
            if (lifetime.controller.signal.aborted) return;
            await invalidateProjectAnnouncements(cache, host.scopeKey);
            onChange(candidate.id);
            toast.success(t("projects.repository.attached", { name: candidate.name }));
          } catch (error) {
            throw new Error(errorText("projects.repository.attachFailed")(error));
          } finally {
            if (!lifetime.controller.signal.aborted) setAttaching(false);
          }
        }}
        onOpenChange={setAttachOpen}
        open={attachOpen}
        project={project}
        repositories={attachCandidates}
      /> : null}
      {!hideTriggers ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={t("projects.repository.add")}
              className={
                compact
                  ? "h-6 w-6 shrink-0 rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  : "h-7 shrink-0 gap-1.5 rounded-md"
              }
              data-testid="add-project-repository"
              disabled={!canEdit}
              size={compact ? "icon" : "sm"}
              title={
                canEdit
                  ? t("projects.repository.add")
                  : t("projects.repository.ownerOnly")
              }
              type="button"
              variant={compact ? "ghost" : "outline"}
            >
              <Plus className={compact ? "h-4 w-4" : "h-3.5 w-3.5"} />
              {compact ? null : t("projects.repository.addShort")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              data-testid="create-project-repository"
              onSelect={() => setCreateOpen(true)}
            >
              <FolderPlus className="h-4 w-4" />
              {t("projects.repository.createNew")}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="attach-project-repository"
              onSelect={() => setAttachOpen(true)}
            >
              <Link className="h-4 w-4" />
              {t("projects.repository.selectExisting")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {canManageAccess ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={t("projects.repository.manageAccess")}
              className={
                compact
                  ? "h-6 w-6 shrink-0 rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  : "h-7 shrink-0 gap-1.5 rounded-md"
              }
              data-testid="manage-project-repository-access"
              disabled={repairing}
              size={compact ? "icon" : "sm"}
              type="button"
              variant={compact ? "ghost" : "outline"}
            >
              <ShieldCheck className={compact ? "h-4 w-4" : "h-3.5 w-3.5"} />
              {compact
                ? null
                : repairing
                  ? t("projects.repository.updating")
                  : t("projects.repository.access")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuLabel>{t("projects.repository.accessChannelTitle")}</DropdownMenuLabel>
            {accessChannels.map((channel) => (
              <DropdownMenuItem
                className="justify-between gap-4"
                data-testid={`project-repository-access-${channel.channelId}`}
                key={channel.workspaceId}
                onSelect={() => {
                  if (channel.channelId === repository?.channelId) return;
                  if (!repository || repairing) return;
                  setRepairing(true);
                  void bindProjectRepositoryChannel(host, repository, channel, lifetime.controller.signal)
                    .then(async () => {
                      if (lifetime.controller.signal.aborted) return;
                      await invalidateProjectAnnouncements(cache, host.scopeKey);
                      toast.success(t("projects.repository.accessUpdated", { name: channel.name }));
                    })
                    .catch((error: unknown) => {
                      if (lifetime.controller.signal.aborted) return;
                      toast.error(errorText("projects.repository.accessFailed")(error));
                    })
                    .finally(() => {
                      if (!lifetime.controller.signal.aborted) setRepairing(false);
                    });
                }}
              >
                <span className="min-w-0 truncate">#{channel.name}</span>
                {channel.channelId === repository?.channelId ? (
                  <Check className="h-4 w-4 shrink-0" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );
}
