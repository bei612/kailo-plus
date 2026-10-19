// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/channels/ui/AgentSessionThreadPanel.tsx (header, settings
// menu, stop current turn) and desktop/src/features/agents/ui/ManagedAgentSessionPanel.tsx
// (transcript body). DD-125(6), V-SCN-143/144: the transcript is the Installation's
// Codex thread, only for Installation `audit` holders; "Stop current turn" is the
// governed DD-84 cancel control. The original Raw JSON-RPC toggle has no Kailo
// source (no ACP observer frames) and is omitted.
import * as React from "react";
import { Clock3, Octagon, Settings, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { AgentActiveTurnView, AgentInstallationView } from "@client-kit/contracts";

import { useBffClient, useFailureText, useUiT } from "../context";
import { useLoad } from "../use-load";
import { useNow } from "../useNow";
import type { UserProfileLookup } from "../messages/system/identity";
import { UserAvatar } from "../messages/UserAvatar";
import { Button } from "../profile/buzz/shared/ui/button";
import {
  AuxiliaryPanel,
  AuxiliaryPanelBody,
  AuxiliaryPanelHeader,
  AuxiliaryPanelHeaderActions,
  AuxiliaryPanelHeaderGroup,
} from "../messages/thread/auxiliary";
import { useEscapeKey } from "../messages/thread/useEscapeKey";
import { useThreadPanelWidth } from "../messages/thread/useThreadPanelWidth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../sidebar/dropdown-menu";
import { Switch } from "../switch";
import { AgentSessionTranscriptList } from "./AgentSessionTranscriptList";
import { adaptTranscriptItems, agentSessionKey } from "./agentTranscriptAdapter";
import type { TranscriptItem } from "./agentSessionTypes";
import { formatElapsed } from "./agentSessionUtils";
import { TranscriptWorkspaceProvider } from "./host";
import {
  setTranscriptAnimationEnabled,
  setTranscriptTimestampsEnabled,
  useTranscriptAnimationEnabled,
  useTranscriptTimestampsEnabled,
} from "./transcriptPreferences";
import {
  type AgentSessionTranscriptState,
  useAgentSessionTranscript,
  useAgentTranscript,
} from "./useAgentTranscript";
import { useInterruptTurn } from "./useInterruptTurn";

export type AgentSessionPanelProps = {
  installation: AgentInstallationView;
  agentName: string;
  agentAvatarUrl?: string | null;
  /** A specific AgentSession; absent opens the Installation's latest Session. */
  rootEventId?: string;
  projectionGeneration?: number;
  /** Buzz Channel of the Installation's Workspace, for the scope label. */
  channelId?: string | null;
  channelName?: string | null;
  profiles?: UserProfileLookup;
  onBack?: () => void;
  onClose: () => void;
};

/** Original relative "Last updated" wording. */
function useRelativeActivityTime() {
  const t = useUiT();
  return React.useCallback((timestamp: number, now: number) => {
    const totalSeconds = Math.floor(Math.max(0, now - timestamp) / 1_000);
    if (totalSeconds < 60) return t("agentTranscript.recency.justNow");
    const totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes < 60) return t("agentTranscript.recency.minutes", { count: totalMinutes });
    const totalHours = Math.floor(totalMinutes / 60);
    if (totalHours < 24) return t("agentTranscript.recency.hours", { count: totalHours });
    const totalDays = Math.floor(totalHours / 24);
    if (totalDays < 7) return t("agentTranscript.recency.days", { count: totalDays });
    return t("agentTranscript.recency.weeks", { count: Math.floor(totalDays / 7) });
  }, [t]);
}

function latestActivity(items: readonly TranscriptItem[]): number | null {
  let latest: number | null = null;
  for (const item of items) {
    const values = item.type === "tool" ? [item.timestamp, item.completedAt ?? ""] : [item.timestamp];
    for (const value of values) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed) && (latest === null || parsed > latest)) latest = parsed;
    }
  }
  return latest;
}

/** Right-side activity panel for one Agent (original AgentSessionThreadPanel). */
export function AgentSessionPanel(props: AgentSessionPanelProps) {
  const t = useUiT();
  useEscapeKey(props.onClose, true);
  const session = useSelectedSession(props.installation, props.rootEventId, props.projectionGeneration);
  const scopeLabel = props.channelName
    ? `#${props.channelName}`
    : props.channelId
      ? t("agentTranscript.scope.oneChannel")
      : t("agentTranscript.scope.allChannels");

  if (session.status === "ok" && session.target) {
    return <LoadedSessionPanel {...props} scopeLabel={scopeLabel} target={session.target} />;
  }
  return (
    <PanelFrame
      header={
        <AuxiliaryPanelHeaderGroup
          align="start"
          backButtonAriaLabel={t("agentTranscript.back")}
          backButtonTestId="agent-session-back"
          onBack={props.onBack}
        >
          <PanelIdentity
            agentAvatarUrl={props.agentAvatarUrl ?? null}
            agentName={props.agentName}
            recency={t("agentTranscript.recency.none")}
            scopeLine={`${t("agentTranscript.activity")} · ${scopeLabel}`}
          />
        </AuxiliaryPanelHeaderGroup>
      }
      onClose={props.onClose}
    >
      {session.status === "pending" ? (
        <p className="px-3 py-6 text-sm text-muted-foreground" role="status">{t("platform.loading")}</p>
      ) : session.status === "error" ? (
        <div className="px-3 py-6 text-sm" role="alert">
          {t("platform.loadFailed")}
          <Button className="ml-2" onClick={session.reload} size="sm" variant="ghost">{t("platform.retry")}</Button>
        </div>
      ) : (
        <LiveOnlyTranscript {...props} />
      )}
    </PanelFrame>
  );
}

/** No recorded Session yet: only live frames of a Session that starts now. */
function LiveOnlyTranscript(props: AgentSessionPanelProps) {
  const t = useUiT();
  const { installation } = props;
  const items = useAgentTranscript(installation.resourceId, installation.canAudit === true, {
    agentName: props.agentName, channelId: props.channelId ?? null,
  });
  return (
    <TranscriptWorkspaceProvider value={installation.workspaceId}>
      <AgentSessionTranscriptList
        agentAvatarUrl={props.agentAvatarUrl ?? null}
        agentName={props.agentName}
        agentPubkey={installation.agentPubkey ?? installation.agentPrincipalId}
        emptyDescription={t("agentTranscript.emptyChannel", { name: props.agentName })}
        items={installation.canAudit === true ? items : []}
      />
    </TranscriptWorkspaceProvider>
  );
}

function PanelFrame({
  children,
  header,
  onClose,
}: {
  children: React.ReactNode;
  header: React.ReactNode;
  onClose: () => void;
}) {
  const t = useUiT();
  const width = useThreadPanelWidth();
  return (
    <AuxiliaryPanel
      canResetWidth={width.canReset}
      onClose={onClose}
      onResetWidth={width.onResetWidth}
      onResizeStart={width.onResizeStart}
      resizeHandleAriaLabel={t("agentTranscript.resize")}
      testId="agent-session-thread-panel"
      widthPx={width.widthPx}
      header={
        <AuxiliaryPanelHeader backdrop backdropSurface="soft" inset="wide">
          {header}
        </AuxiliaryPanelHeader>
      }
    >
      <AuxiliaryPanelBody className="overflow-y-auto px-3 pb-4" panelPadding>
        {children}
      </AuxiliaryPanelBody>
    </AuxiliaryPanel>
  );
}

/** One page loader and live subscription shared by the header and the body. */
function LoadedSessionPanel(props: AgentSessionPanelProps & { scopeLabel: string; target: SessionTarget }) {
  const t = useUiT();
  const { installation } = props;
  const transcript = useAgentSessionTranscript({
    agentName: props.agentName, channelId: props.channelId ?? null,
    enabled: installation.canAudit === true, installationId: installation.resourceId, ...props.target,
  });
  return (
    <PanelFrame
      header={
        <SessionPanelHeader
          agentAvatarUrl={props.agentAvatarUrl ?? null}
          agentName={props.agentName}
          onBack={props.onBack}
          scopeLabel={props.scopeLabel}
          transcript={transcript}
        />
      }
      onClose={props.onClose}
    >
      <TranscriptBody
        agentAvatarUrl={props.agentAvatarUrl ?? null}
        agentName={props.agentName}
        agentPubkey={installation.agentPubkey ?? installation.agentPrincipalId}
        channelId={props.channelId ?? null}
        className="border-0 bg-transparent px-0 py-2 shadow-none"
        emptyDescription={t("agentTranscript.emptyChannel", { name: props.agentName })}
        installation={installation}
        profiles={props.profiles}
        target={props.target}
        transcript={transcript}
      />
    </PanelFrame>
  );
}

type SessionTarget = { rootEventId: string; projectionGeneration: number };

/** The requested Session, or the Installation's most recent one (Core order). */
function useSelectedSession(
  installation: AgentInstallationView,
  rootEventId: string | undefined,
  projectionGeneration: number | undefined,
): { status: "pending" | "ok" | "error"; target: SessionTarget | null; reload: () => void } {
  const client = useBffClient();
  const given = rootEventId !== undefined && projectionGeneration !== undefined;
  const [state, reload] = useLoad(
    `agent-transcript-session:${installation.resourceId}:${given ? "given" : "latest"}`,
    async () => (given ? null : client.agentSessions(installation.resourceId)),
  );
  if (given) {
    return { status: "ok", target: { rootEventId, projectionGeneration }, reload };
  }
  if (state.status !== "ok") return { status: state.status, target: null, reload };
  const latest = state.data?.sessions.find((row) => row.installationResourceId === installation.resourceId);
  return {
    status: "ok",
    target: latest ? { rootEventId: latest.rootEventId, projectionGeneration: latest.projectionGeneration } : null,
    reload,
  };
}

function PanelIdentity({
  agentAvatarUrl,
  agentName,
  recency,
  recencyTitle,
  scopeLine,
}: {
  agentAvatarUrl: string | null;
  agentName: string;
  recency: string;
  recencyTitle?: string;
  scopeLine: string;
}) {
  return (
    <>
      <UserAvatar
        avatarUrl={agentAvatarUrl}
        className="size-9"
        displayName={agentName}
        shape="squircle"
        size="md"
        testId="agent-session-agent-avatar"
      />
      <div className="min-w-0 flex-1">
        <h2
          className="truncate text-sm font-semibold leading-5"
          data-testid="agent-session-agent-name"
          title={agentName}
        >
          {agentName}
        </h2>
        <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <p className="min-w-0 flex-1 truncate" data-testid="agent-session-scope-label">
            {scopeLine}
          </p>
          <span aria-hidden="true" className="shrink-0">
            ·
          </span>
          <span className="shrink-0" data-testid="agent-session-recency-label" title={recencyTitle}>
            {recency}
          </span>
        </div>
      </div>
    </>
  );
}

function SessionPanelHeader({
  agentAvatarUrl,
  agentName,
  onBack,
  scopeLabel,
  transcript,
}: {
  agentAvatarUrl: string | null;
  agentName: string;
  onBack?: () => void;
  scopeLabel: string;
  transcript: AgentSessionTranscriptState;
}) {
  const t = useUiT();
  const now = useNow(1000);
  const relative = useRelativeActivityTime();
  const started = transcript.activeTurn?.startedAt ? Date.parse(transcript.activeTurn.startedAt) : Number.NaN;
  const working = transcript.activeTurn !== undefined || transcript.liveTurnRunning;
  const latest = latestActivity(transcript.items);
  const recency = working && Number.isFinite(started)
    ? t("agentTranscript.workingFor", { elapsed: formatElapsed(now - started) })
    : latest === null
      ? t("agentTranscript.recency.none")
      : t("agentTranscript.recency.updated", { time: relative(latest, now) });
  const recencyTitle = working && Number.isFinite(started)
    ? t("agentTranscript.turnStarted", { time: new Date(started).toLocaleString() })
    : latest === null ? undefined : t("agentTranscript.recency.updated", { time: new Date(latest).toLocaleString() });

  return (
    <>
      <AuxiliaryPanelHeaderGroup
        align="start"
        backButtonAriaLabel={t("agentTranscript.back")}
        backButtonTestId="agent-session-back"
        onBack={onBack}
      >
        <PanelIdentity
          agentAvatarUrl={agentAvatarUrl}
          agentName={agentName}
          recency={recency}
          recencyTitle={recencyTitle}
          scopeLine={`${t("agentTranscript.activity")} · ${scopeLabel}`}
        />
      </AuxiliaryPanelHeaderGroup>
      <SessionSettingsMenu activeTurn={transcript.activeTurn} agentName={agentName} working={working} />
    </>
  );
}

function SessionSettingsMenu({
  activeTurn,
  agentName,
  working,
}: {
  activeTurn: AgentActiveTurnView | undefined;
  agentName: string;
  working: boolean;
}) {
  const t = useUiT();
  const failureText = useFailureText();
  const animateActivity = useTranscriptAnimationEnabled();
  const showTimestamps = useTranscriptTimestampsEnabled();
  const stop = useInterruptTurn(activeTurn);
  const canStopCurrentTurn = working && stop.available && !stop.busy;

  const handleInterruptTurn = async () => {
    const outcome = await stop.interrupt();
    if (!outcome) return;
    if (outcome.kind === "requested") {
      toast.success(t("agentTranscript.stop.sent", { name: agentName }));
    } else if (outcome.kind === "unknown") {
      toast.info(t("agentTranscript.stop.unknown", { operation: outcome.operationId ?? "—" }));
    } else if (outcome.failure.kind === "rejected") {
      toast.error(failureText(outcome.failure));
    } else {
      toast.error(t("agentTranscript.stop.failed", { name: agentName }));
    }
  };

  return (
    <AuxiliaryPanelHeaderActions>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t("agentTranscript.settings.open")}
            className="relative"
            data-testid="agent-session-settings-menu-trigger"
            size="icon"
            title={t("agentTranscript.settings.title")}
            type="button"
            variant="ghost"
          >
            <Settings />
            {canStopCurrentTurn ? (
              <span
                aria-hidden="true"
                className="absolute right-1 bottom-1 h-2 w-2 rounded-full bg-primary ring-2 ring-background"
                data-testid="agent-session-settings-live-badge"
              />
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-56"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <DropdownMenuItem
            className="items-start gap-3"
            data-testid="agent-session-toggle-animate-activity"
            onSelect={(event) => {
              event.preventDefault();
              setTranscriptAnimationEnabled(!animateActivity);
            }}
            title={t(animateActivity ? "agentTranscript.settings.animationsOffHint" : "agentTranscript.settings.animationsOnHint")}
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-muted-foreground" />
                {t("agentTranscript.settings.animations")}
              </span>
            </span>
            <Switch
              aria-hidden="true"
              checked={animateActivity}
              className="pointer-events-none mt-0.5"
              tabIndex={-1}
            />
          </DropdownMenuItem>
          <DropdownMenuItem
            className="items-start gap-3"
            data-testid="agent-session-toggle-show-timestamps"
            onSelect={(event) => {
              event.preventDefault();
              setTranscriptTimestampsEnabled(!showTimestamps);
            }}
            title={t(showTimestamps ? "agentTranscript.settings.timestampsOffHint" : "agentTranscript.settings.timestampsOnHint")}
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Clock3 className="h-4 w-4 text-muted-foreground" />
                {t("agentTranscript.settings.timestamps")}
              </span>
            </span>
            <Switch
              aria-hidden="true"
              checked={showTimestamps}
              className="pointer-events-none mt-0.5"
              tabIndex={-1}
            />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="items-start gap-3"
            data-testid="agent-session-stop-turn"
            disabled={!canStopCurrentTurn}
            onSelect={() => {
              void handleInterruptTurn();
            }}
            title={t(canStopCurrentTurn ? "agentTranscript.stop.hint"
              : working ? "agentTranscript.stop.notAllowed" : "agentTranscript.stop.idle")}
          >
            <Octagon className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">
                {t(stop.pending ? "agentTranscript.stop.retry" : "agentTranscript.stop.label")}
              </span>
              {!canStopCurrentTurn ? (
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t(working ? "agentTranscript.stop.notAllowed" : "agentTranscript.stop.idle")}
                </span>
              ) : null}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </AuxiliaryPanelHeaderActions>
  );
}

/**
 * Transcript body for one AgentSession (original ManagedAgentSessionPanel without
 * its ACP header). Also used inline by the Installation Sessions table.
 */
export function AgentSessionTranscriptView({
  agentAvatarUrl,
  agentName,
  agentPubkey,
  channelId = null,
  className,
  emptyDescription,
  installation,
  profiles,
  projectionGeneration,
  rootEventId,
}: {
  agentAvatarUrl: string | null;
  agentName: string;
  agentPubkey: string;
  channelId?: string | null;
  className?: string;
  emptyDescription: string;
  installation: AgentInstallationView;
  profiles?: UserProfileLookup;
  projectionGeneration: number;
  rootEventId: string;
}) {
  const transcript = useAgentSessionTranscript({
    agentName, channelId, enabled: installation.canAudit === true,
    installationId: installation.resourceId, projectionGeneration, rootEventId,
  });
  return (
    <TranscriptBody
      agentAvatarUrl={agentAvatarUrl}
      agentName={agentName}
      agentPubkey={agentPubkey}
      channelId={channelId}
      className={className}
      emptyDescription={emptyDescription}
      installation={installation}
      profiles={profiles}
      target={{ rootEventId, projectionGeneration }}
      transcript={transcript}
    />
  );
}

function TranscriptBody({
  agentAvatarUrl,
  agentName,
  agentPubkey,
  channelId,
  className,
  emptyDescription,
  installation,
  profiles,
  target,
  transcript,
}: {
  agentAvatarUrl: string | null;
  agentName: string;
  agentPubkey: string;
  channelId: string | null;
  className?: string;
  emptyDescription: string;
  installation: AgentInstallationView;
  profiles?: UserProfileLookup;
  target: SessionTarget;
  transcript: AgentSessionTranscriptState;
}) {
  const t = useUiT();
  const selected = agentSessionKey(target.rootEventId, target.projectionGeneration);
  // Live frames of the Installation's other Sessions follow, separated by the
  // original session boundaries (original archived + live merge).
  const others = React.useMemo(() => adaptTranscriptItems(
    transcript.live.entries.filter((entry) => agentSessionKey(entry.rootEventId, entry.projectionGeneration) !== selected),
    { agentName, channelId },
  ), [agentName, channelId, selected, transcript.live.entries]);
  const items = React.useMemo(() => [...transcript.items, ...others], [others, transcript.items]);
  const liveTurn = transcript.live.turns.find((turn) => !turn.completed);
  const latestLiveSessionId = liveTurn ? agentSessionKey(liveTurn.rootEventId, liveTurn.projectionGeneration) : null;

  if (installation.canAudit !== true) {
    return null;
  }

  return (
    <TranscriptWorkspaceProvider value={installation.workspaceId}>
      <section
        className={className ?? "rounded-lg border border-border/70 bg-background/80 p-4 shadow-xs"}
        data-testid="agent-session-transcript"
      >
        {transcript.status === "error" && transcript.items.length === 0 ? (
          <div className="py-6 text-sm" role="alert">
            {t("platform.loadFailed")}
            <Button className="ml-2" onClick={transcript.reload} size="sm" variant="ghost">{t("platform.retry")}</Button>
          </div>
        ) : (
          <AgentSessionTranscriptList
            agentAvatarUrl={agentAvatarUrl}
            agentName={agentName}
            agentPubkey={agentPubkey}
            emptyDescription={emptyDescription}
            emptyState={transcript.status === "pending" ? "loading" : "idle"}
            isTurnLive={transcript.activeTurn !== undefined || transcript.liveTurnRunning}
            items={items}
            latestLiveSessionId={latestLiveSessionId}
            profiles={profiles}
          />
        )}
        {transcript.hasMore ? (
          <div className="mt-3 flex justify-center">
            <Button disabled={transcript.loadingMore} onClick={transcript.loadMore} size="sm" variant="ghost">
              {t("agentTranscript.loadMore")}
            </Button>
          </div>
        ) : null}
        {transcript.live.state === "reconnecting" ? (
          <p className="mt-3 text-xs text-muted-foreground" role="status">{t("agentTranscript.reconnecting")}</p>
        ) : transcript.live.state === "closed" && transcript.live.reason === "scope-revoked" ? (
          <p className="mt-3 text-xs text-muted-foreground" role="status">{t("agentTranscript.revoked")}</p>
        ) : null}
      </section>
    </TranscriptWorkspaceProvider>
  );
}
