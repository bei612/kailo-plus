// Reused from Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/agents/ui/CommunityCatalogDialog.tsx (DD-131(6) "从目录选择"): the same
// two-pane chooser — Create agent and Import entries, then the Agents and Teams of the catalog,
// and a detail pane with "Added by", the exact instructions and the add actions. Kailo's catalog is
// the caller's discoverable AgentDefinitions and agent teams in this organization; adding grants
// nothing. "Add" is either installing the current published Version in a channel the caller can
// install into (the existing agent.installation.create) or copying it as the caller's own
// Definition (agent.definition.create then agent.version.create with the portable fields); a team
// copies to the caller's own team that refers to the same Definitions (agent.team.create). The
// original runtime/model/provider metadata and the persona relay events are not used (DD-24, DD-26).
// Visual layer: DD-141 Kailo roles only (brand-soft selection, accent hover, soft status pairs).
// The original desktop/src/features/agents/ui/PersonaAddedBy.tsx line is the detail pane's
// "Added by …" / "Added by you" owner line here.
import * as React from "react";
import { BookUser, Plus, Upload, Users } from "lucide-react";

import { AgentVersionState, type ActionCommand, type ActionSubmission, type AgentDefinitionView, type AgentTeamView, type AgentVersionView, type WorkspaceView } from "@client-kit/contracts";
import { newIdempotencyKey } from "../../governance";
import { writeFailure, type WriteFailure } from "../../transport";
import { useGovernedChannelAction } from "../channel-management-actions";
import { useBffClient, useCurrentPrincipalId, useFailureText, useUiT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../composer/shared/ui/dialog";
import { useLoad } from "../use-load";
import { agentActionOutcomeText } from "./agentActionOutcome";
import {
  CatalogCopyPending,
  CatalogCopyRejected,
  catalogOwnerLabel,
  classifyReceipt,
  loadCatalogOwners,
  readPublishedSource,
  suggestedCopySlug,
  teamCopyCommand,
  validCopySlug,
  versionCopyCommand,
  waitForCreatedDefinition,
  type CatalogOwner,
} from "./agentCatalog";
import { IdentityInitialsAvatar } from "./IdentityInitialsAvatar";
import { AvatarHostProvider, type AvatarHost } from "../profile/avatar-host";
import { ProfileAvatar } from "../profile/buzz/features/profile/ui/ProfileAvatar";
import { deployTeamToChannel, type TeamDeployResult } from "./teamDeploy";
import { loadAgentDirectory, loadAgentTeams } from "./teamPersonas";

type Selection = { kind: "agent"; id: string } | { kind: "team"; id: string } | null;

export type AgentCatalogDialogProps = {
  open: boolean;
  /** The Teams section opens the catalog on its first team (original preferSection). */
  preferSection?: "agents" | "teams";
  onOpenChange: (open: boolean) => void;
  /** Original "Create agent" pane: the host's governed create dialog. */
  onCreateAgent?: () => void;
  /** Original "Import" pane: the host's snapshot import entry. */
  onImport?: () => void;
  /** A copy or team was recorded: the host re-reads its directories. */
  onRecorded?: () => void;
  /**
   * The host's media view for an exact published Version (the Agents page `avatarHost`). Without it
   * the original initials stay; with it each entry shows its published persona avatar.
   */
  avatarHost?: CatalogAvatarHost;
};

export type CatalogAvatarHost = (version?: AgentVersionView) => AvatarHost;

const NAV_ITEM = "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-control transition-colors duration-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";
const NAV_IDLE = "text-muted-foreground hover:bg-accent hover:text-accent-foreground";
const NAV_CURRENT = "bg-brand-soft font-medium text-brand-soft-foreground";
const OVERLINE = "px-3 pb-1 pt-3 text-2xs font-semibold uppercase tracking-[0.04em] text-muted-foreground";
const INPUT = "h-[34px] w-full rounded-md border border-input bg-background px-2.5 text-sm shadow-xs transition-colors duration-100 hover:border-ring/40 focus-visible:border-ring focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-50";
const PANEL = "flex flex-col gap-2 rounded-xl border border-border bg-card p-4";
const DANGER = "rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-text";
const WARNING = "rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-text";
const SUCCESS = "rounded-lg bg-success-soft px-3 py-2 text-sm text-success-text";

export function AgentCatalogDialog({ open, preferSection = "agents", onOpenChange, onCreateAgent, onImport, onRecorded, avatarHost }: AgentCatalogDialogProps) {
  const t = useUiT();
  const client = useBffClient();
  const principalId = useCurrentPrincipalId();
  // A recorded add re-reads the same keys and keeps the open detail mounted meanwhile.
  const key = String(open);
  const [definitionsState, reloadDefinitions] = useLoad(`agent-catalog-definitions:${key}`,
    () => open ? loadAgentDirectory(client) : Promise.resolve([] as AgentDefinitionView[]), { keepWhileRevalidating: true });
  const [teamsState, reloadTeams] = useLoad(`agent-catalog-teams:${key}`,
    () => open ? loadAgentTeams(client) : Promise.resolve([] as AgentTeamView[]), { keepWhileRevalidating: true });
  const definitions = definitionsState.status === "ok" ? definitionsState.data : [];
  const teams = teamsState.status === "ok" ? teamsState.data : [];
  const ownerIds = React.useMemo(() => [...definitions.map((d) => d.resourceId), ...teams.map((team) => team.resourceId)].sort(), [definitions, teams]);
  const [ownersState] = useLoad(`agent-catalog-owners:${key}:${ownerIds.join(",")}`,
    () => ownerIds.length > 0 ? loadCatalogOwners(client, ownerIds) : Promise.resolve(new Map<string, CatalogOwner>()), { keepWhileRevalidating: true });
  const owners = ownersState.status === "ok" ? ownersState.data : new Map<string, CatalogOwner>();

  const [selection, setSelection] = React.useState<Selection>(null);
  const [userSelected, setUserSelected] = React.useState(false);
  React.useEffect(() => { if (open) { setSelection(null); setUserSelected(false); } }, [open]);
  // Original teams-launch: once teams settle, open on the first team unless the user navigated.
  React.useEffect(() => {
    if (!open || userSelected || selection) return;
    if (preferSection === "teams" && teamsState.status === "ok" && teams[0]) setSelection({ kind: "team", id: teams[0].resourceId });
    else if (definitionsState.status === "ok" && definitions[0]) setSelection({ kind: "agent", id: definitions[0].resourceId });
  }, [open, userSelected, selection, preferSection, teamsState.status, teams, definitionsState.status, definitions]);
  // A live refresh that retracts the selected entry drops the selection (original behaviour).
  React.useEffect(() => {
    if (selection?.kind === "agent" && definitionsState.status === "ok" && !definitions.some((d) => d.resourceId === selection.id)) setSelection(null);
    if (selection?.kind === "team" && teamsState.status === "ok" && !teams.some((team) => team.resourceId === selection.id)) setSelection(null);
  }, [selection, definitions, teams, definitionsState.status, teamsState.status]);

  const select = (next: Selection) => { setUserSelected(true); setSelection(next); };
  const selectedAgent = selection?.kind === "agent" ? definitions.find((d) => d.resourceId === selection.id) ?? null : null;
  const selectedTeam = selection?.kind === "team" ? teams.find((team) => team.resourceId === selection.id) ?? null : null;
  const loading = definitionsState.status === "pending" || teamsState.status === "pending";
  const empty = !loading && definitionsState.status === "ok" && teamsState.status === "ok" && definitions.length === 0 && teams.length === 0;
  const recorded = () => { reloadDefinitions(); reloadTeams(); onRecorded?.(); };
  const ownerText = (entry: { resourceId: string; ownerPrincipalId: string }) => {
    const label = catalogOwnerLabel(entry, owners, principalId);
    return label.kind === "you" ? t("agentCatalog.addedByYou")
      : label.kind === "name" ? t("agentCatalog.addedBy", { name: label.name }) : t("agentCatalog.ownerUnavailable");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[42rem] max-h-[calc(100vh-2rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0" data-testid="agent-catalog-dialog">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4 pr-14">
          <DialogTitle className="text-[1.0625rem] font-semibold leading-6 tracking-[-0.012em]">{t("agentCatalog.title")}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">{t("agentCatalog.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav aria-label={t("agentCatalog.title")} className="flex max-h-56 min-h-0 shrink-0 flex-col overflow-y-auto border-border bg-sidebar px-2 py-3 sm:max-h-none sm:w-60 sm:border-r">
            <div className="space-y-0.5">
              {onCreateAgent ? <button className={cn(NAV_ITEM, NAV_IDLE)} data-testid="agent-catalog-create" type="button"
                onClick={() => { onOpenChange(false); onCreateAgent(); }}>
                <Plus aria-hidden className="h-4 w-4" />{t("agentCatalog.createAgent")}
              </button> : null}
              {onImport ? <button className={cn(NAV_ITEM, NAV_IDLE)} data-testid="agent-catalog-import" type="button"
                onClick={() => { onOpenChange(false); onImport(); }}>
                <Upload aria-hidden className="h-4 w-4" />{t("agentCatalog.import")}
              </button> : null}
            </div>
            {onCreateAgent || onImport ? <div className="my-3 border-t border-border" /> : null}
            {loading ? <CatalogListSkeleton /> : null}
            {definitions.length > 0 ? <div>
              <p className={OVERLINE}>{t("agentCatalog.agents")}</p>
              <div className="space-y-0.5">
                {definitions.map((definition, index) => {
                  const current = selection?.kind === "agent" && selection.id === definition.resourceId;
                  return <button aria-current={current ? "true" : undefined} className={cn(NAV_ITEM, current ? NAV_CURRENT : NAV_IDLE)}
                    data-testid={`agent-catalog-agent-${definition.resourceId}`} key={definition.resourceId} type="button"
                    onClick={() => select({ kind: "agent", id: definition.resourceId })}>
                    <CatalogAvatar avatarHost={avatarHost} definition={definition} colorIndex={index} size={24} />
                    <span className="min-w-0 flex-1 truncate">{definition.displayName}</span>
                  </button>;
                })}
              </div>
            </div> : null}
            {teams.length > 0 ? <div>
              <p className={OVERLINE}>{t("agentCatalog.teams")}</p>
              <div className="space-y-0.5">
                {teams.map((team) => {
                  const current = selection?.kind === "team" && selection.id === team.resourceId;
                  return <button aria-current={current ? "true" : undefined} className={cn(NAV_ITEM, current ? NAV_CURRENT : NAV_IDLE)}
                    data-testid={`agent-catalog-team-${team.resourceId}`} key={team.resourceId} type="button"
                    onClick={() => select({ kind: "team", id: team.resourceId })}>
                    <Users aria-hidden className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{team.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{team.memberAgentResourceIds.length + team.hiddenMemberCount}</span>
                  </button>;
                })}
              </div>
            </div> : null}
            {empty ? <div className="flex flex-col items-center px-2 py-8 text-center" data-testid="agent-catalog-empty">
              <span className="flex h-16 w-16 items-center justify-center rounded-squircle bg-brand-soft text-brand-soft-foreground"><BookUser aria-hidden className="h-7 w-7" /></span>
              <p className="mt-3 text-sm font-semibold">{t("agentCatalog.emptyTitle")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("agentCatalog.emptyHint")}</p>
            </div> : null}
            {definitionsState.status === "error" || teamsState.status === "error" ? <p className={cn(DANGER, "mx-1 mt-3")} role="alert">
              {t("platform.loadFailed")}{" "}
              <button className="font-medium underline underline-offset-2" type="button" onClick={() => { reloadDefinitions(); reloadTeams(); }}>{t("platform.retry")}</button>
            </p> : null}
          </nav>
          <section className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-background px-6 py-5" data-testid="agent-catalog-detail">
            {selectedAgent ? <AgentDetail key={selectedAgent.resourceId} definition={selectedAgent} owner={ownerText(selectedAgent)} avatarHost={avatarHost}
              own={principalId !== undefined && selectedAgent.ownerPrincipalId === principalId}
              takenSlugs={new Set(definitions.map((d) => d.stableSlug))} onRecorded={recorded} /> : null}
            {selectedTeam ? <TeamDetail key={selectedTeam.resourceId} team={selectedTeam} definitions={definitions} owner={ownerText(selectedTeam)} avatarHost={avatarHost}
              own={principalId !== undefined && selectedTeam.ownerPrincipalId === principalId} onRecorded={recorded} /> : null}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The entry's real persona avatar: the exact published Version's personaIdentity.avatarUrl, viewed
 * through the host's media path for that Version (Web: the server-projected path; Desktop: the
 * Community media rewrite). Anything not verifiably that Version keeps the original initials.
 */
function CatalogAvatar({ avatarHost, definition, version: known, colorIndex, size }: {
  avatarHost?: CatalogAvatarHost; definition: AgentDefinitionView; version?: AgentVersionView | null;
  colorIndex?: number; size: number;
}) {
  const client = useBffClient();
  const assetId = definition.currentPublishedVersionAssetId;
  const load = !!avatarHost && !!assetId && known === undefined;
  const [state] = useLoad(`agent-catalog-avatar:${definition.resourceId}:${load ? assetId : ""}`,
    () => load ? client.agentVersion(assetId!) : Promise.resolve(null));
  const loaded = known === undefined ? (state.status === "ok" ? state.data : null) : known;
  const version = loaded && loaded.assetId === assetId && loaded.agentResourceId === definition.resourceId
    && loaded.state === AgentVersionState.Published ? loaded : null;
  const avatarUrl = version?.content.personaIdentity.avatarUrl?.trim();
  const box = size >= 40 ? "h-12 w-12" : size >= 28 ? "h-7 w-7" : "h-6 w-6";
  if (!avatarHost || !version || !avatarUrl) {
    return <span className={cn("shrink-0", box)}><IdentityInitialsAvatar className={cn("shadow-none", size < 40 && "border-0 text-2xs")}
      colorIndex={colorIndex} label={definition.displayName} size={size} /></span>;
  }
  return <AvatarHostProvider value={avatarHost(version)}>
    <ProfileAvatar avatarUrl={avatarUrl} className={cn("shrink-0 bg-muted shadow-none", box)} iconClassName="h-3 w-3"
      label={version.content.personaIdentity.displayName} shape="squircle" testId={`agent-catalog-avatar-${definition.resourceId}`} />
  </AvatarHostProvider>;
}

function CatalogListSkeleton() {
  return <div className="space-y-2 px-3 py-2" aria-hidden data-testid="agent-catalog-loading">
    {["a", "b", "c", "d"].map((k) => <div className="flex items-center gap-2" key={k}>
      <span className="h-6 w-6 animate-pulse rounded-squircle bg-muted" /><span className="h-3.5 w-28 animate-pulse rounded-sm bg-muted" />
    </div>)}
  </div>;
}

/** Original AgentInstructionReview: the exact text, never rendered as Markdown. */
function InstructionReview({ instructions }: { instructions: string }) {
  const t = useUiT();
  return <pre className="mt-2 w-full min-w-0 max-w-full whitespace-pre-wrap break-words rounded-lg bg-muted p-3 font-sans text-sm leading-6 text-muted-foreground"
    data-testid="agent-catalog-instructions">{instructions || t("agentCatalog.noInstructions")}</pre>;
}

function AgentDetail({ definition, owner, own, takenSlugs, onRecorded, avatarHost }: {
  definition: AgentDefinitionView; owner: string; own: boolean; takenSlugs: ReadonlySet<string>; onRecorded: () => void;
  avatarHost?: CatalogAvatarHost;
}) {
  const t = useUiT();
  const client = useBffClient();
  const [source] = useLoad(`agent-catalog-source:${definition.resourceId}:${definition.currentPublishedVersionAssetId ?? ""}`,
    () => definition.currentPublishedVersionAssetId ? readPublishedSource(client, definition.resourceId).then((s) => s.version) : Promise.resolve(null));
  const version = source.status === "ok" ? source.data : null;
  const persona = version?.content.personaIdentity;
  return <div className="flex w-full min-w-0 flex-col gap-6">
    <div className="flex items-center gap-3">
      <CatalogAvatar avatarHost={avatarHost} definition={definition} version={version} size={48} />
      <div className="min-w-0">
        <h3 className="truncate text-headline font-semibold">{persona?.displayName ?? definition.displayName}</h3>
        <p className="text-xs text-muted-foreground" data-testid="agent-catalog-owner">{owner}</p>
      </div>
    </div>
    {persona?.description ? <p className="max-w-prose break-words text-sm leading-6 text-muted-foreground">{persona.description}</p> : null}
    {!definition.currentPublishedVersionAssetId ? <p className={WARNING} role="status">{t("agentCatalog.notPublished")}</p> : null}
    {source.status === "error" ? <p className={DANGER} role="alert">{t("platform.loadFailed")}</p> : null}
    {version ? <div className="min-w-0">
      <p className="text-sm font-semibold">{t("agentCatalog.instructions")}</p>
      <InstructionReview instructions={version.content.instructions} />
    </div> : null}
    {version ? <>
      <InstallPanel definition={definition} />
      <CopyPanel definition={definition} own={own} takenSlugs={takenSlugs} onRecorded={onRecorded} />
    </> : null}
  </div>;
}

function InstallPanel({ definition }: { definition: AgentDefinitionView }) {
  const t = useUiT();
  const client = useBffClient();
  const failureText = useFailureText();
  const [channels, reloadChannels] = useLoad("agent-catalog-channels", client.workspaces);
  const available = channels.status === "ok" && Array.isArray(channels.data) ? channels.data.filter((c: WorkspaceView) => c.isMember !== false) : [];
  const [channelId, setChannelId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<TeamDeployResult | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  React.useEffect(() => { if (!channelId && available[0]) setChannelId(available[0].id); }, [channelId, available]);
  const install = async () => {
    if (busy || !channelId) return;
    setBusy(true); setProblem(null); setResult(null);
    try {
      const [done] = await deployTeamToChannel(client, [{ resourceId: definition.resourceId, name: definition.displayName }], channelId, () => true);
      setResult(done ?? null);
    } catch (error) {
      const failed = writeFailure(error);
      setProblem(failed.kind === "rejected" ? failureText(failed) : t("agents.unknown", { operation: failed.operationId ?? "—" }));
    } finally { setBusy(false); }
  };
  const text = (r: TeamDeployResult) => r.outcome === "submitted" ? t(r.waiting ? "agentTeams.deployWaiting" : "agentTeams.deploySubmitted", { operation: r.operationId })
    : r.outcome === "already" ? t("agentTeams.deployAlready") : r.outcome === "unavailable" ? t("agentTeams.deployUnavailable")
    : r.failure.kind === "unknown" ? t("agents.unknown", { operation: r.failure.operationId ?? "—" }) : t("agents.rejected", { reason: failureText(r.failure) });
  const tone = (r: TeamDeployResult) => r.outcome === "submitted" && !r.waiting ? SUCCESS
    : r.outcome === "failed" ? (r.failure.kind === "unknown" ? WARNING : DANGER) : "rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground";
  return <section className={PANEL} data-testid="agent-catalog-install">
    <h4 className="text-control font-semibold">{t("agentCatalog.installTitle")}</h4>
    <label className="flex flex-col gap-1 text-control font-medium">{t("agentTeams.channel")}
      <select className={INPUT} data-testid="agent-catalog-install-channel" disabled={busy || available.length === 0}
        value={channelId} onChange={(event) => { setChannelId(event.target.value); setResult(null); }}>
        {available.length === 0 ? <option value="">{t("agentTeams.noChannels")}</option> : null}
        {available.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
      </select>
    </label>
    {channels.status === "error" ? <p className={DANGER} role="alert">{t("platform.loadFailed")}{" "}
      <button className="font-medium underline underline-offset-2" type="button" onClick={reloadChannels}>{t("platform.retry")}</button></p> : null}
    {result ? <p className={tone(result)} data-testid="agent-catalog-install-result" role="status">{text(result)}</p> : null}
    {problem ? <p className={DANGER} role="alert">{problem}</p> : null}
    <div className="flex justify-end">
      <Button data-testid="agent-catalog-install-submit" disabled={busy || !channelId} onClick={() => void install()} size="sm" type="button" variant="outline">
        {busy ? t("agentCatalog.installing") : t("agentCatalog.install")}
      </Button>
    </div>
  </section>;
}

type CopyStage =
  | { step: "idle" }
  | { step: "create"; command: ActionCommand; unknown?: string }
  | { step: "wait"; submission: ActionSubmission }
  | { step: "version"; createdId: string; command: ActionCommand | null; unknown?: string }
  | { step: "done" }
  | { step: "pending" }
  | { step: "sourceGone" }
  | { step: "rejected"; text: string };

function CopyPanel({ definition, own, takenSlugs, onRecorded }: {
  definition: AgentDefinitionView; own: boolean; takenSlugs: ReadonlySet<string>; onRecorded: () => void;
}) {
  const t = useUiT();
  const client = useBffClient();
  const failureText = useFailureText();
  const [slug, setSlug] = React.useState(() => suggestedCopySlug(definition.stableSlug, takenSlugs));
  const [stage, setStage] = React.useState<CopyStage>({ step: "idle" });
  const [busy, setBusy] = React.useState(false);
  const live = React.useRef(true);
  React.useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const rejectedText = (failure: WriteFailure & { kind: "rejected" }) => t("agents.rejected", { reason: failureText(failure) });

  const submitVersion = async (createdId: string, retained: ActionCommand | null) => {
    let command = retained;
    try {
      if (!command) command = { ...(await versionCopyCommand(client, definition.resourceId, createdId)), idempotencyKey: newIdempotencyKey() };
    } catch (error) {
      if (error instanceof CatalogCopyRejected) { setStage({ step: "sourceGone" }); onRecorded(); return; }
      setStage({ step: "version", createdId, command: null, unknown: "" }); return;
    }
    setStage({ step: "version", createdId, command });
    try {
      const result = classifyReceipt(command, await client.submitAction(command));
      if (result.kind === "unknown") setStage({ step: "version", createdId, command, unknown: result.operation ?? "—" });
      else if (result.kind === "rejected") setStage({ step: "rejected", text: rejectedText({ kind: "rejected", reason: result.submission.reason, detail: result.submission.gateState }) });
      else { setStage({ step: "done" }); onRecorded(); }
    } catch (error) {
      const failed = writeFailure(error);
      // A refusal of a re-check says nothing about the original uncertain write.
      if (failed.kind === "rejected" && !retained) setStage({ step: "rejected", text: rejectedText(failed) });
      else setStage({ step: "version", createdId, command, unknown: failed.kind === "unknown" ? failed.operationId ?? "—" : "—" });
    }
  };

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (stage.step === "version") { await submitVersion(stage.createdId, stage.command); return; }
      // A retained create (unknown outcome) is resent unchanged; otherwise a new frozen intent.
      const command = stage.step === "create" ? stage.command : {
        actionKey: "agent.definition.create", idempotencyKey: newIdempotencyKey(), name: definition.displayName, slug: slug.trim(),
      };
      setStage({ step: "create", command });
      let submission: ActionSubmission;
      try {
        const result = classifyReceipt(command, await client.submitAction(command));
        if (result.kind === "unknown") { setStage({ step: "create", command, unknown: result.operation ?? "—" }); return; }
        if (result.kind === "rejected") { setStage({ step: "rejected", text: rejectedText({ kind: "rejected", reason: result.submission.reason, detail: result.submission.gateState }) }); return; }
        submission = result.submission;
      } catch (error) {
        const failed = writeFailure(error);
        if (failed.kind === "rejected" && stage.step !== "create") setStage({ step: "rejected", text: rejectedText(failed) });
        else setStage({ step: "create", command, unknown: failed.kind === "unknown" ? failed.operationId ?? "—" : "—" });
        return;
      }
      setStage({ step: "wait", submission });
      let createdId: string;
      try {
        createdId = await waitForCreatedDefinition(client, submission, { isCurrent: () => live.current, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
      } catch (error) {
        if (error instanceof CatalogCopyRejected) setStage({ step: "rejected", text: t("agents.rejected", { reason: "—" }) });
        else if (error instanceof CatalogCopyPending || live.current) setStage({ step: "pending" });
        onRecorded();
        return;
      }
      await submitVersion(createdId, null);
    } finally { if (live.current) setBusy(false); }
  };

  const unknown = (stage.step === "create" || stage.step === "version") && stage.unknown !== undefined;
  const locked = stage.step !== "idle" && stage.step !== "rejected";
  const progress = stage.step === "create" && !unknown ? t("agentCatalog.copyCreating") : stage.step === "wait" ? t("agentCatalog.copyWaiting")
    : stage.step === "version" && !unknown ? t("agentCatalog.copyVersion") : null;
  return <section className={PANEL} data-testid="agent-catalog-copy">
    <h4 className="text-control font-semibold">{t("agentCatalog.copyTitle")}</h4>
    <p className="text-xs text-muted-foreground">{t("agentCatalog.copyHint")}</p>
    <label className="flex flex-col gap-1 text-control font-medium">{t("agents.snapshot.slug")}
      <input className={cn(INPUT, "font-mono")} data-testid="agent-catalog-copy-slug" disabled={own || locked} value={slug}
        onChange={(event) => setSlug(event.target.value)} />
      <span className="text-xs font-normal text-muted-foreground">{t("agents.snapshot.slugHint")}</span>
    </label>
    {progress ? <p className="text-sm text-muted-foreground" role="status">{progress}</p> : null}
    {unknown ? <p className={WARNING} role="status">{t("agents.unknown", { operation: (stage as { unknown?: string }).unknown || "—" })}</p> : null}
    {stage.step === "done" ? <p className={SUCCESS} data-testid="agent-catalog-copy-done" role="status">{t("agentCatalog.copyDone")}</p> : null}
    {stage.step === "pending" ? <p className={WARNING} role="status">{t("agentCatalog.copyPending")}</p> : null}
    {stage.step === "sourceGone" ? <p className={WARNING} role="status">{t("agentCatalog.copySourceGone")}</p> : null}
    {stage.step === "rejected" ? <p className={DANGER} role="alert">{stage.text}</p> : null}
    <div className="flex justify-end">
      <Button data-testid="agent-catalog-copy-submit" size="sm" type="button"
        disabled={own || busy || stage.step === "done" || stage.step === "pending" || stage.step === "sourceGone" || stage.step === "wait"
          || (stage.step === "idle" || stage.step === "rejected" ? !validCopySlug(slug.trim()) : false)}
        onClick={() => void run()}>
        {own ? t("agentCatalog.alreadyYours") : unknown ? t("agents.retry") : t("agentCatalog.addAgent")}
      </Button>
    </div>
  </section>;
}

function TeamDetail({ team, definitions, owner, own, onRecorded, avatarHost }: {
  team: AgentTeamView; definitions: AgentDefinitionView[]; owner: string; own: boolean; onRecorded: () => void;
  avatarHost?: CatalogAvatarHost;
}) {
  const t = useUiT();
  const [name, setName] = React.useState(team.name);
  const save = useGovernedChannelAction(() => onRecorded());
  const members = team.memberAgentResourceIds.map((id) => definitions.find((d) => d.resourceId === id) ?? null);
  const outcome = save.outcome;
  const tone = !outcome ? "" : outcome.kind === "unknown" ? WARNING : outcome.kind === "recorded" || outcome.kind === "waiting" ? SUCCESS : DANGER;
  return <div className="flex w-full min-w-0 flex-col gap-6">
    <div className="min-w-0">
      <h3 className="truncate text-headline font-semibold">{team.name}</h3>
      <p className="text-xs text-muted-foreground" data-testid="agent-catalog-owner">{owner}</p>
      {team.description ? <p className="mt-3 break-words text-sm text-muted-foreground">{team.description}</p> : null}
    </div>
    <div className="min-w-0">
      <p className="text-sm font-semibold">{t("agentCatalog.teamMembers")} · {t(team.memberAgentResourceIds.length === 1 ? "agentTeams.memberCount.one" : "agentTeams.memberCount.other", { count: team.memberAgentResourceIds.length })}</p>
      <ul className="mt-2 space-y-1.5">
        {members.map((member, index) => <li className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
          data-testid={`agent-catalog-team-member-${team.memberAgentResourceIds[index]}`} key={team.memberAgentResourceIds[index]}>
          {member ? <CatalogAvatar avatarHost={avatarHost} definition={member} colorIndex={index} size={28} />
            : <span className="h-7 w-7 shrink-0"><IdentityInitialsAvatar className="border-0 shadow-none" colorIndex={index} label="?" size={28} /></span>}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{member?.displayName ?? team.memberAgentResourceIds[index]}</span>
        </li>)}
      </ul>
      {team.hiddenMemberCount > 0 ? <p className="mt-2 text-xs text-muted-foreground">
        {t(team.hiddenMemberCount === 1 ? "agentTeams.hidden.one" : "agentTeams.hidden.other", { count: team.hiddenMemberCount })}</p> : null}
    </div>
    <section className={PANEL} data-testid="agent-catalog-team-copy">
      <p className="text-xs text-muted-foreground">{t("agentCatalog.teamCopyHint")}</p>
      <label className="flex flex-col gap-1 text-control font-medium">{t("agentCatalog.teamCopyName")}
        <input className={INPUT} data-testid="agent-catalog-team-copy-name" disabled={own || save.busy || save.unknown} value={name}
          onChange={(event) => setName(event.target.value)} />
      </label>
      {outcome ? <p className={tone} role={outcome.kind === "rejected" || outcome.kind === "aborted" ? "alert" : "status"}>
        {outcome.kind === "recorded" ? t("agentCatalog.teamAdded", { operation: outcome.operation }) : agentActionOutcomeText(t, outcome)}</p> : null}
      <div className="flex justify-end">
        <Button data-testid="agent-catalog-add-team" size="sm" type="button"
          disabled={own || save.busy || (!save.unknown && (!name.trim() || team.memberAgentResourceIds.length === 0 || outcome?.kind === "recorded" || outcome?.kind === "waiting"))}
          onClick={() => void (save.unknown ? save.submit() : save.submit(teamCopyCommand(team, name)))}>
          {own ? t("agentCatalog.alreadyYours") : save.unknown ? t("agents.retry") : t("agentCatalog.addTeam")}
        </Button>
      </div>
    </section>
  </div>;
}
