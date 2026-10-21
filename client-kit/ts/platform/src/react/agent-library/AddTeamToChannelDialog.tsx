// Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/ui/AddTeamToChannelDialog.tsx.
// DD-131(1): deploying is one existing `agent.installation.create` per member (teamDeploy.ts), each
// admitted and audited on its own; results are listed per member and nothing is rolled back. The
// original Role select, ACP runtime warnings and `forceNewInstance` have no Kailo counterpart (an
// Installation is the grant; runtime is the published Version's, DD-26) and are not rendered.
import * as React from "react";

import type { AgentDefinitionView, AgentTeamView, WorkspaceView } from "@client-kit/contracts";
import { Button } from "../profile/buzz/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../composer/shared/ui/dialog";
import { useBffClient, useFailureText, useUiT } from "../context";
import { useLoad } from "../use-load";
import { IdentityInitialsAvatar } from "./IdentityInitialsAvatar";
import { emptyResolvedTeamMembers, resolveTeamMembers } from "./teamPersonas";
import { deployTeamToChannel, type TeamDeployResult } from "./teamDeploy";

type AddTeamToChannelDialogProps = {
  team: AgentTeamView | null;
  definitions: AgentDefinitionView[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeployed: (channel: WorkspaceView, results: TeamDeployResult[]) => void;
};

export function AddTeamToChannelDialog({ team, definitions, open, onOpenChange, onDeployed }: AddTeamToChannelDialogProps) {
  const t = useUiT();
  const client = useBffClient();
  const failureText = useFailureText();
  const [channels, reloadChannels] = useLoad("team-deploy-channels", client.workspaces);
  const [channelId, setChannelId] = React.useState("");
  const [deploying, setDeploying] = React.useState(false);
  const [results, setResults] = React.useState<TeamDeployResult[] | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const scope = React.useRef({ active: true });
  React.useEffect(() => {
    const current = { active: true };
    scope.current = current;
    return () => { current.active = false; };
  }, [team?.resourceId]);

  const available = React.useMemo(() => channels.status === "ok" && Array.isArray(channels.data)
    ? channels.data.filter((channel) => channel.isMember !== false) : [], [channels]);
  const resolution = React.useMemo(() => team ? resolveTeamMembers(team, definitions) : emptyResolvedTeamMembers(), [team, definitions]);
  const resolved = resolution.resolvedMembers;
  const missingCount = resolution.missingMemberCount;

  React.useEffect(() => {
    if (!open) return;
    const first = available[0];
    if (!channelId && first) setChannelId(first.id);
  }, [channelId, available, open]);

  function handleOpenChange(next: boolean) {
    if (!next && deploying) return;
    if (!next) { setChannelId(""); setResults(null); setProblem(null); }
    onOpenChange(next);
  }

  const selectedChannel = available.find((channel) => channel.id === channelId) ?? null;

  async function handleDeploy() {
    if (!team || !selectedChannel || deploying) return;
    const current = scope.current;
    setDeploying(true); setProblem(null); setResults([]);
    try {
      const done = await deployTeamToChannel(client, resolved.map((member) => ({ resourceId: member.resourceId, name: member.displayName })),
        selectedChannel.id, () => current.active, (result) => { if (current.active) setResults((old) => [...(old ?? []), result]); });
      if (current.active) onDeployed(selectedChannel, done);
    } catch (error) {
      if (current.active) setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      if (current.active) setDeploying(false);
    }
  }

  const resultText = (result: TeamDeployResult) => {
    switch (result.outcome) {
      case "submitted": return t(result.waiting ? "agentTeams.deployWaiting" : "agentTeams.deploySubmitted", { operation: result.operationId });
      case "already": return t("agentTeams.deployAlready");
      case "unavailable": return t("agentTeams.deployUnavailable");
      case "failed": return result.failure.kind === "unknown"
        ? t("agents.unknown", { operation: result.failure.operationId ?? "—" })
        : t("agents.rejected", { reason: failureText(result.failure) });
    }
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="max-w-xl overflow-hidden p-0" data-testid="team-deploy-dialog" showCloseButton={!deploying}>
        <div className="flex max-h-[85vh] flex-col">
          <DialogHeader className="shrink-0 border-b border-border/60 px-6 py-5 pr-14">
            <DialogTitle>{t("agentTeams.deployTitle")}</DialogTitle>
            <DialogDescription>{t("agentTeams.deployDescription", { name: team?.name ?? t("agentTeams.thisTeam") })}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
            {resolved.length > 0 ? (
              <div className="space-y-1.5">
                <span className="text-sm font-medium">{t("agentTeams.agentsCount", { count: resolved.length })}</span>
                <div className="flex flex-wrap gap-2">
                  {resolved.map((member, index) => (
                    <div className="flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/30 px-2 py-1" key={member.resourceId}>
                      <span className="h-5 w-5 shrink-0"><IdentityInitialsAvatar className="border-0 text-2xs shadow-none" colorIndex={index} label={member.displayName} size={20} /></span>
                      <span className="text-xs font-medium">{member.displayName}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="team-channel-id">{t("agentTeams.channel")}</label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs"
                disabled={available.length === 0 || deploying || results !== null}
                id="team-channel-id"
                onChange={(event) => setChannelId(event.target.value)}
                value={channelId}
              >
                {available.length === 0 ? <option value="">{t("agentTeams.noChannels")}</option> : null}
                {available.map((channel) => (
                  <option key={channel.id} value={channel.id}>{channel.name}</option>
                ))}
              </select>
            </div>

            {missingCount > 0 ? (
              <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {t(missingCount === 1 ? "agentTeams.deployMissing.one" : "agentTeams.deployMissing.other", { count: missingCount })}
              </p>
            ) : null}
            {resolution.hiddenMemberCount > 0 ? (
              <p className="text-xs text-muted-foreground">
                {t(resolution.hiddenMemberCount === 1 ? "agentTeams.hidden.one" : "agentTeams.hidden.other", { count: resolution.hiddenMemberCount })}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">{t("agentTeams.deployBoundary")}</p>

            {channels.status === "error" ? (
              <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
                {t("platform.loadFailed")} <button className="underline" onClick={reloadChannels} type="button">{t("platform.retry")}</button>
              </p>
            ) : null}

            {results && results.length > 0 ? (
              <ul className="space-y-1.5 text-sm" data-testid="team-deploy-results" role="status">
                {results.map((result) => (
                  <li className="flex flex-col gap-0.5" data-outcome={result.outcome} key={result.member.resourceId}>
                    <span className="font-medium">{result.member.name}</span>
                    <span className="break-words text-xs text-muted-foreground">{resultText(result)}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {problem ? (
              <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{problem}</p>
            ) : null}
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-border/60 px-6 py-4">
            <Button disabled={deploying} onClick={() => handleOpenChange(false)} size="sm" type="button" variant="outline">
              {results !== null && !deploying ? t("buzz.close") : t("buzz.cancel")}
            </Button>
            {results === null || deploying ? (
              <Button
                data-testid="team-deploy-confirm"
                disabled={!team || !selectedChannel || resolved.length === 0 || missingCount > 0 || channels.status === "pending" || deploying}
                onClick={() => void handleDeploy()}
                size="sm"
                type="button"
              >
                {deploying ? t("agentTeams.deploying") : t(resolved.length === 1 ? "agentTeams.deployCount.one" : "agentTeams.deployCount.other", { count: resolved.length })}
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
