// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectsCategoryCreateDialogs.tsx.
// The Projects overview rail's Add channel / Add repository: the same project select and dialogs
// over the shared governed creation (workspace.create, DD-80) and announcement publications
// (DD-118). Editable projects are the viewer's own explicit projects; no Agent signs for a Human.
import * as React from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useFailureText, useUiT } from "../context";
import { CreateChannelDialog } from "../create-channel-dialog";
import { AddProjectRepositoryDialog } from "./AddProjectRepositoryDialog";
import { useProjectChannelLinking } from "./ProjectChannelManagement";
import type { ProjectsHost } from "./projectEnumeration";
import type { Project } from "./projectModels";
import { invalidateProjectAnnouncements } from "./ProjectRepositoryManagement";
import { addProjectRepository, projectManagementErrorText } from "./projectRepositoryManagement";
import type { ProjectWorkItemTarget } from "./projectWorkItems";
import { useProjectAccessChannels } from "./useProjectAccessChannels";

function ProjectChannelCreateDialog({ host, onOpenChange, onOpenChannel, open, projects }: {
  host: ProjectsHost;
  onOpenChange: (open: boolean) => void;
  onOpenChannel?: (channelId: string) => void;
  open: boolean;
  projects: Project[];
}) {
  const t = useUiT();
  const [channelProjectId, setChannelProjectId] = React.useState("");
  const channelProject = projects.find((project) => project.id === channelProjectId) ?? projects[0];
  return channelProject ? <ProjectChannelCreateFor host={host} onOpenChange={onOpenChange} onOpenChannel={onOpenChannel}
    open={open} project={channelProject}>
    <label className="block space-y-1.5 text-sm font-medium">
      <span>{t("projects.repository.project")}</span>
      <select
        className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal outline-hidden focus:ring-1 focus:ring-ring"
        data-testid="create-project-channel-project"
        onChange={(event) => setChannelProjectId(event.target.value)}
        value={channelProject.id}
      >
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
    </label>
  </ProjectChannelCreateFor> : null;
}

function ProjectChannelCreateFor({ children, host, onOpenChange, onOpenChannel, open, project }: {
  children: React.ReactNode;
  host: ProjectsHost;
  onOpenChange: (open: boolean) => void;
  onOpenChannel?: (channelId: string) => void;
  open: boolean;
  project: Project;
}) {
  const t = useUiT();
  const linking = useProjectChannelLinking(host, project, onOpenChannel);
  return <CreateChannelDialog
    onOpenChange={onOpenChange}
    onRecorded={(submission, name) => {
      onOpenChange(false);
      linking.record(submission, name);
    }}
    open={open}
    testId="create-project-channel-dialog"
    title={t("projects.channel.createTitle")}
  >{children}</CreateChannelDialog>;
}

export function ProjectsCategoryCreateDialogs({
  channelOpen,
  editableProjects,
  host,
  onChannelOpenChange,
  onOpenChannel,
  onOpenProject,
  onRepositoryOpenChange,
  repositoryOpen,
}: {
  channelOpen: boolean;
  editableProjects: Project[];
  host: ProjectsHost;
  onChannelOpenChange: (open: boolean) => void;
  onOpenChannel?: (channelId: string) => void;
  onOpenProject: (projectId: string, target?: ProjectWorkItemTarget) => void | Promise<void>;
  onRepositoryOpenChange: (open: boolean) => void;
  repositoryOpen: boolean;
}) {
  const t = useUiT();
  const failureText = useFailureText();
  const cache = useQueryClient();
  const [creating, setCreating] = React.useState(false);
  const repositoryAccessChannels = useProjectAccessChannels(host.scopeKey, repositoryOpen);
  const lifetime = React.useMemo(() => ({ controller: new AbortController() }), [host.scopeKey]);
  React.useEffect(() => {
    if (lifetime.controller.signal.aborted) lifetime.controller = new AbortController();
    return () => lifetime.controller.abort();
  }, [lifetime]);

  return (
    <>
      <ProjectChannelCreateDialog host={host} onOpenChange={onChannelOpenChange} onOpenChannel={onOpenChannel}
        open={channelOpen} projects={editableProjects}/>
      <AddProjectRepositoryDialog
        channels={repositoryAccessChannels}
        errorText={(error) => projectManagementErrorText(t, failureText, error, "projects.repository.addFailed")}
        isCreating={creating}
        onAdd={async (input) => {
          setCreating(true);
          try {
            const result = await addProjectRepository(host, input, lifetime.controller.signal);
            if (lifetime.controller.signal.aborted) return;
            await invalidateProjectAnnouncements(cache, host.scopeKey);
            toast.success(t("projects.repository.created", { name: input.name.trim() }));
            // Original goProject(project.id, { repositoryId }): the repository surface opens on its default tab.
            await onOpenProject(input.project.id, { repositoryId: result.repositoryId });
          } finally {
            if (!lifetime.controller.signal.aborted) setCreating(false);
          }
        }}
        onOpenChange={onRepositoryOpenChange}
        open={repositoryOpen}
        projects={editableProjects}
      />
    </>
  );
}
