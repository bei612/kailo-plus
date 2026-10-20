// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/huddle/components/AddAgentDialog.tsx::AddAgentDialog
// DD-125(3): the original "Add agents" chooser. Kailo Agents are the parent Workspace's
// Installations (not managed local agents): the list is the ACTIVE Installations with an
// ACTIVE ChannelAgentBinding that the caller may execute, minus those already in the
// Huddle; adding is the governed huddle.agent.add. Starting a stopped agent is the separate
// governed agent.installation.enable, so a stopped Installation is not offered here.
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { AgentInstallationState, AgentInstallationViewChannelBindingStatus, type AgentInstallationView } from "@client-kit/contracts";
import { useBffClient, useLocale, useT } from "../context";
import { loadWorkspaceAgents } from "../agent-installation-view";
import { Dialog } from "../composer/shared/ui/dialog";
import { ChooserDialogContent } from "../composer/shared/ui/chooser-dialog-content";
import { ProfileAvatar } from "../profile/buzz/features/profile/ui/ProfileAvatar";
import { AvatarHostProvider } from "../profile/avatar-host";

export function AddAgentDialog({ open, onClose, onAdd, workspaceId, currentInstallationIds }: {
  open: boolean;
  onClose: () => void;
  onAdd: (installationId: string) => Promise<void>;
  workspaceId: string;
  currentInstallationIds: readonly string[];
}) {
  const t = useT();
  const locale = useLocale();
  const client = useBffClient();
  const agents = useQuery({
    queryKey: ["platform", "huddle-agents", workspaceId],
    queryFn: () => loadWorkspaceAgents(client, workspaceId),
    enabled: open,
  });
  const [adding, setAdding] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setAdding(null);
    setError(null);
  }, [open]);

  const available = (agents.data ?? []).filter((agent: AgentInstallationView) =>
    agent.state === AgentInstallationState.Active
    && agent.channelBinding?.status === AgentInstallationViewChannelBindingStatus.Active
    && agent.executionPermission?.effective === true
    && Boolean(agent.agentPubkey)
    && !currentInstallationIds.includes(agent.resourceId));

  async function handleAdd(agent: AgentInstallationView) {
    if (adding) return;
    setAdding(agent.resourceId);
    setError(null);
    try {
      await onAdd(agent.resourceId);
      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(t("huddle.addAgent.failed", { message }));
    } finally {
      setAdding(null);
    }
  }

  return (
    <Dialog onOpenChange={(next) => { if (!next) onClose(); }} open={open}>
      <ChooserDialogContent className="max-w-xl" data-testid="add-huddle-agent-dialog"
        headerSubtitle={t("huddle.addAgent.subtitle")} scrollAreaClassName="space-y-5" title={t("huddle.addAgent.title")}>
        {error || agents.isError ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error ?? t("huddle.addAgent.loadFailed")}
          </p>
        ) : null}
        {agents.isPending ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("huddle.addAgent.loading")}</p>
        ) : available.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("huddle.addAgent.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {available.map((agent) => {
              const name = agent.agentDisplayName ?? agent.resourceId;
              return (
                <li key={agent.resourceId}>
                  <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                    disabled={adding !== null} onClick={() => void handleAdd(agent)} type="button">
                    <AvatarHostProvider value={{ locale, rewriteMediaUrl: (url) => url }}>
                      <ProfileAvatar avatarUrl={null} className="h-9 w-9 shrink-0 text-xs" label={name} shape="squircle" />
                    </AvatarHostProvider>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                    {adding === agent.resourceId ? (
                      <LoaderCircle aria-label={t("huddle.addAgent.adding", { name })} className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </ChooserDialogContent>
    </Dialog>
  );
}
