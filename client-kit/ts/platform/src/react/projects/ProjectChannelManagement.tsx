// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectChannelManagement.tsx
// and useAddProjectChannel.ts::addProjectChannel. The stream is created by the existing governed
// workspace.create (with the original Template row, DD-80/DD-125(4)); once its task completes the
// project head gains it as `buzz-related-channel` through the Projects publication host, and the
// new channel opens. Channel deletion is not a Kailo product action (DD-119), so where the original
// removed an unlinkable channel, the recorded creation stays retained and linking resumes instead.
import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { WorkspaceMembershipState, type ActionSubmission } from "@client-kit/contracts";
import { useBffClient, useFailureText, useUiT } from "../context";
import { CreateChannelDialog } from "../create-channel-dialog";
import { loadChannelDirectory } from "../channel-browser/loadChannelDirectory";
import { TemplateChannelPending, TemplateChannelRejected, waitForCreatedWorkspace } from "../channel-templates/applyChannelTemplate";
import { Button } from "../profile/buzz/shared/ui/button";
import type { ProjectsHost } from "./projectEnumeration";
import type { Project } from "./projectModels";
import { invalidateProjectAnnouncements } from "./ProjectRepositoryManagement";
import {
  linkProjectChannel,
  pendingProjectChannelLink,
  projectManagementErrorText,
  ProjectManagementPending,
  type ProjectChannelRef,
} from "./projectRepositoryManagement";

const sleep = (ms: number) => new Promise<void>((resolve) => { globalThis.setTimeout(resolve, ms); });
type RecordedCreation = { submission: ActionSubmission; name: string };

function creationSlot(scopeKey: string, project: Pick<Project, "projectAddress">) {
  return JSON.stringify(["project-channel-create", scopeKey, project.projectAddress]);
}

function readCreation(slot: string): RecordedCreation | null {
  try {
    const text = sessionStorage.getItem(slot);
    if (text === null) return null;
    const value = JSON.parse(text) as RecordedCreation;
    return value && typeof value.name === "string" && value.submission
      && typeof value.submission.actionExecutionId === "string" && typeof value.submission.operationId === "string" ? value : null;
  } catch { return null; }
}

/** The created stream's link to the project, resumed from its recorded creation or link intent. */
export function useProjectChannelLinking(host: ProjectsHost, project: Project, onOpenChannel?: (channelId: string) => void) {
  const t = useUiT();
  const client = useBffClient();
  const failureText = useFailureText();
  const cache = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const running = React.useRef(false);
  const lifetime = React.useMemo(() => ({ controller: new AbortController() }), [client, host.scopeKey, project.projectAddress]);
  React.useEffect(() => {
    if (lifetime.controller.signal.aborted) lifetime.controller = new AbortController();
    return () => lifetime.controller.abort();
  }, [lifetime]);
  const slot = creationSlot(host.scopeKey, project);
  const run = React.useCallback(async () => {
    if (running.current) return;
    const creation = readCreation(slot);
    const pendingLink = pendingProjectChannelLink(host, project);
    if (!creation && !pendingLink) return;
    const signal = lifetime.controller.signal;
    const isCurrent = () => !signal.aborted;
    running.current = true;
    setBusy(true);
    try {
      let linked: (ProjectChannelRef & { name: string }) | null = null;
      // An earlier unconfirmed link is re-checked first, exactly as it was sent.
      if (pendingLink) {
        await linkProjectChannel(host, project, pendingLink, signal);
        linked = { ...pendingLink, name: creation?.name ?? "" };
      }
      if (creation) {
        const workspaceId = await waitForCreatedWorkspace(client, creation.submission, { isCurrent, sleep });
        const row = (await loadChannelDirectory(client, isCurrent)).find(candidate => candidate.id === workspaceId
          && candidate.isMember && candidate.membershipState === WorkspaceMembershipState.Active && !candidate.channel.archived);
        if (!row) throw new TemplateChannelPending("Project channel is not currently accessible");
        const channel = { workspaceId, channelId: row.channel.channelId, name: row.channel.name };
        // Already linked (the pending link above) reads back as bound and publishes nothing.
        await linkProjectChannel(host, project, channel, signal);
        sessionStorage.removeItem(slot);
        linked = channel;
      }
      if (!isCurrent() || !linked) return;
      await invalidateProjectAnnouncements(cache, host.scopeKey);
      void cache.invalidateQueries({ queryKey: ["project-home-channels", host.scopeKey] });
      toast.success(t("projects.channel.created", { name: linked.name || linked.channelId }));
      onOpenChannel?.(linked.channelId);
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof TemplateChannelRejected) {
        // The refused creation is shown by the create form; nothing else is sent.
        sessionStorage.removeItem(slot);
        return;
      }
      if (error instanceof TemplateChannelPending || error instanceof ProjectManagementPending) {
        toast.error(t("projects.channel.pending"));
        return;
      }
      sessionStorage.removeItem(slot);
      toast.error(t("projects.channel.linkFailed", { reason: projectManagementErrorText(t, failureText, error, "projects.channel.linkFailedReason") }));
    } finally {
      running.current = false;
      if (isCurrent()) setBusy(false);
    }
  }, [cache, client, failureText, host, lifetime, onOpenChannel, project, slot, t]);
  // Resume a retained creation or link once per mounted scope (after a remount or reload).
  const resumedFor = React.useRef<object | null>(null);
  React.useEffect(() => {
    if (resumedFor.current === lifetime) return;
    resumedFor.current = lifetime;
    void run();
  }, [lifetime, run]);
  const record = React.useCallback((submission: ActionSubmission, name: string) => {
    try { sessionStorage.setItem(slot, JSON.stringify({ submission, name } satisfies RecordedCreation)); }
    catch { toast.error(t("projects.channel.pending")); return; }
    void run();
  }, [run, slot, t]);
  return { busy, record };
}

export function ProjectChannelManagement({
  host,
  identityPubkey,
  onOpenChannel,
  project,
}: {
  host: ProjectsHost;
  identityPubkey?: string;
  onOpenChannel?: (channelId: string) => void;
  project: Project;
}) {
  const t = useUiT();
  const [createOpen, setCreateOpen] = React.useState(false);
  const linking = useProjectChannelLinking(host, project, onOpenChannel);
  const canEdit = !project.legacy && Boolean(host.publish)
    && identityPubkey?.toLowerCase() === project.owner.toLowerCase();

  return (
    <>
      {canEdit ? (
        <CreateChannelDialog
          onOpenChange={setCreateOpen}
          onRecorded={(submission, name) => {
            setCreateOpen(false);
            linking.record(submission, name);
          }}
          open={createOpen}
          testId="create-project-channel-dialog"
          title={t("projects.channel.createTitle")}
        />
      ) : null}
      <Button
        aria-label={t("projects.channel.add")}
        className="h-6 w-6 shrink-0 rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        data-testid="add-project-channel"
        disabled={!canEdit || linking.busy}
        onClick={() => setCreateOpen(true)}
        size="icon"
        title={
          canEdit ? t("projects.channel.add") : t("projects.channel.ownerOnly")
        }
        type="button"
        variant="ghost"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </>
  );
}
