// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/huddle/components/HuddleBar.tsx::HuddleBar (mode "main")
// desktop/src/app/AppHuddleBar.tsx::AppHuddleBar
// DD-125(3): the original in-app Huddle drawer: error banner, voice model status, mic and
// speaker split controls, participant strip, transcript and Add agent controls, Leave, the
// first-run headphones hint and the screen-reader summary. The drawer stays rendered for the
// original 260 ms exit. Kailo differences: the state comes from the shared provider (host
// events) instead of polling Tauri; the companion window and pop-out are Desktop-host
// features and are not offered here; Agents are added and removed through the governed
// huddle.agent.add/remove and exist only in Workspace huddles; while the voice service is
// unavailable the transcript and agent-speech controls show the original voice-only state
// (V-SCN-160); emoji reactions (24810) are not part of this batch.
import * as React from "react";
import { Bot, Captions, PhoneOff } from "lucide-react";
import { useT } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Button } from "../profile/buzz/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../sidebar/tooltip";
import { liveParticipants } from "../../huddle";
import { useHuddle, useHuddleLevels } from "./HuddleContext";
import { type HuddleBackendState, useHuddleHost } from "./host";
import { MicControls, SpeakerControls } from "./MicControls";
import { HuddleParticipantsControl } from "./ParticipantList";
import { AddAgentDialog } from "./AddAgentDialog";
import { useHuddleDirectory, useHuddleLifecycle } from "./queries";

const HUDDLE_DRAWER_EXIT_MS = 260;
const HEADPHONES_HINT_SEEN_STORAGE_KEY = "buzz.huddle.headphones-hint-seen";

function hasSeenHeadphonesHint() {
  try {
    return window.localStorage.getItem(HEADPHONES_HINT_SEEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function isVisibleHuddleState(state: HuddleBackendState | null) {
  return state?.phase === "active" || state?.phase === "connected";
}

export function HuddleBar({ className, currentPubkey, onVisibilityChange }: {
  className?: string;
  /** The caller's own key in the room (Web: the SERVER key), for the local level ring. */
  currentPubkey?: string | null;
  onVisibilityChange?: (visible: boolean) => void;
}) {
  const t = useT();
  const host = useHuddleHost();
  const {
    backendState, leaveHuddle, micConnected, isMuted, toggleMute, voiceInputMode, setVoiceInputMode, huddleError,
    clearHuddleError, audioDevices, selectedDeviceId, setSelectedDeviceId, micGain, setMicGain, outputDevices,
    selectedOutputDevice, setSelectedOutputDevice,
  } = useHuddle();
  const { activeSpeakers, micLevel, speakerLevels } = useHuddleLevels();
  const isPttMode = voiceInputMode === "push_to_talk";
  const [renderedState, setRenderedState] = React.useState<HuddleBackendState | null>(null);
  const [headphonesHintDismissed, setHeadphonesHintDismissed] = React.useState(hasSeenHeadphonesHint);
  const [isLeaving, setIsLeaving] = React.useState(false);
  const [showAddAgent, setShowAddAgent] = React.useState(false);
  const [agentAddError, setAgentAddError] = React.useState<string | null>(null);
  const isHuddleVisible = isVisibleHuddleState(backendState);
  const hadActiveHuddleRef = React.useRef(false);

  const dismissHeadphonesHint = React.useCallback(() => {
    try {
      window.localStorage.setItem(HEADPHONES_HINT_SEEN_STORAGE_KEY, "1");
    } catch {
      /* best-effort */
    }
    setHeadphonesHintDismissed(true);
  }, []);

  React.useEffect(() => { onVisibilityChange?.(isHuddleVisible); }, [isHuddleVisible, onVisibilityChange]);

  React.useEffect(() => {
    if (isHuddleVisible) {
      hadActiveHuddleRef.current = true;
      return;
    }
    if (hadActiveHuddleRef.current) {
      hadActiveHuddleRef.current = false;
      dismissHeadphonesHint();
    }
  }, [dismissHeadphonesHint, isHuddleVisible]);

  React.useEffect(() => {
    if (isHuddleVisible) {
      setRenderedState(backendState);
      return;
    }
    const id = window.setTimeout(() => setRenderedState(null), HUDDLE_DRAWER_EXIT_MS);
    return () => window.clearTimeout(id);
  }, [backendState, isHuddleVisible]);

  const barState = isHuddleVisible ? backendState : renderedState;
  const parent = barState?.parent ?? null;
  const directoryQuery = useHuddleDirectory(parent);
  const directory = directoryQuery.data instanceof Map ? directoryQuery.data : undefined;
  const lifecycle = useHuddleLifecycle(barState?.huddleId ?? null);
  const agentPubkeys = React.useMemo(() => {
    const ids = new Set(barState?.agentInstallationIds ?? []);
    return [...(directory?.values() ?? [])]
      .filter((entry) => entry.kind === "agent" && ids.has(entry.installationId))
      .map((entry) => entry.pubkey);
  }, [barState?.agentInstallationIds, directory]);
  const participants = React.useMemo(() => {
    const roster = new Map<string, string>();
    const add = (pubkey: string) => { if (!roster.has(pubkey.toLowerCase())) roster.set(pubkey.toLowerCase(), pubkey); };
    // Original useHuddleParticipantRoster: the live room first, the lifecycle as fallback,
    // and the Huddle's Agents preserved even though they hold no audio connection here.
    for (const pubkey of barState?.participants ?? []) add(pubkey);
    if (barState?.ephemeralChannelId && roster.size === 0) {
      const events = Array.isArray(lifecycle.data?.events) ? lifecycle.data.events : [];
      for (const pubkey of liveParticipants(events, barState.ephemeralChannelId)) add(pubkey);
    }
    for (const pubkey of agentPubkeys) add(pubkey);
    return [...roster.values()];
  }, [agentPubkeys, barState?.ephemeralChannelId, barState?.participants, lifecycle.data?.events]);
  const participantSpeakerLevels = React.useMemo(() => {
    const levels = { ...speakerLevels };
    if (currentPubkey) levels[currentPubkey.toLowerCase()] = micConnected && !isMuted ? micLevel : 0;
    return levels;
  }, [currentPubkey, isMuted, micConnected, micLevel, speakerLevels]);

  if (!barState || !parent) return null;

  const isDrawerClosing = !isHuddleVisible;
  const transcriptionAvailable = barState.transcriptionAvailable;
  const speechAvailable = barState.speechAvailable;
  const workspaceId = parent.kind === "workspace" ? parent.workspaceId : null;

  async function handleLeave() {
    if (isLeaving) return;
    setIsLeaving(true);
    try {
      await leaveHuddle();
    } catch (error) {
      console.error("Failed to leave huddle:", error);
    } finally {
      setIsLeaving(false);
    }
  }

  async function handleRemoveAgent(pubkey: string) {
    const entry = directory?.get(pubkey.toLowerCase());
    if (!entry || entry.kind !== "agent") return;
    if (!window.confirm(t("huddle.removeAgentConfirm"))) return;
    try {
      await host.removeAgentFromHuddle(entry.installationId);
    } catch (error) {
      console.error("Failed to remove agent from huddle:", error);
    }
  }

  return (
    <div aria-hidden={isDrawerClosing} data-state={isDrawerClosing ? "closing" : "open"}
      className={cn("buzz-huddle-drawer grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-5 py-3 text-foreground",
        isDrawerClosing && "pointer-events-none", className)}>
      <div className="flex min-w-0 items-center gap-3 overflow-hidden">
        {huddleError && (
          <div role="alert" className="flex min-w-0 items-center gap-1.5 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
            <span className="max-w-[220px] truncate">{huddleError}</span>
            <button aria-label={t("huddle.dismissError")} className="ml-1 opacity-60 hover:opacity-100" onClick={clearHuddleError} type="button">✕</button>
          </div>
        )}
        {!transcriptionAvailable || !speechAvailable ? (
          <output className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <span className="truncate">{t("huddle.voiceOnly")}</span>
          </output>
        ) : null}
        {agentAddError && (
          <span className="max-w-[180px] truncate rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">{agentAddError}</span>
        )}
        {workspaceId ? (
          <AddAgentDialog currentInstallationIds={barState.agentInstallationIds} open={showAddAgent} workspaceId={workspaceId}
            onClose={() => setShowAddAgent(false)}
            onAdd={async (installationId) => {
              setAgentAddError(null);
              try {
                await host.addAgentToHuddle(installationId);
              } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                setAgentAddError(t("huddle.addAgent.failed", { message }));
                throw e;
              }
            }} />
        ) : null}
        <div className="flex shrink-0 items-center gap-2">
          <MicControls isMuted={isMuted} onToggleMute={toggleMute} isPttMode={isPttMode} micConnected={micConnected}
            micLevel={micLevel} onSelectVoiceInputMode={setVoiceInputMode} audioDevices={audioDevices}
            selectedDeviceId={selectedDeviceId} onSelectDevice={setSelectedDeviceId} micGain={micGain} onGainChange={setMicGain} />
          <SpeakerControls ttsEnabled={speechAvailable} speechAvailable={speechAvailable}
            showHeadphonesHint={!headphonesHintDismissed && !isDrawerClosing} onHeadphonesHintDismiss={dismissHeadphonesHint}
            onToggleTts={() => { /* agent speech is unavailable while the voice service is absent */ }}
            outputDevices={outputDevices} selectedOutputDevice={selectedOutputDevice} onSelectOutputDevice={setSelectedOutputDevice} />
          <HuddleParticipantsControl parent={parent} participants={participants} directory={directory}
            activeSpeakers={activeSpeakers} speakerLevels={participantSpeakerLevels} agentPubkeys={agentPubkeys}
            onRemoveAgent={workspaceId ? (pubkey) => void handleRemoveAgent(pubkey) : undefined} />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 justify-self-center">
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button aria-label={transcriptionAvailable ? t("huddle.transcript.start") : t("huddle.transcript.unavailable")}
                  aria-pressed={false} disabled={!transcriptionAvailable}
                  className="buzz-huddle-control-button h-12 w-12 shrink-0 rounded-md" size="icon" type="button" variant="ghost">
                  <Captions className="h-4 w-4" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent className="buzz-huddle-tooltip" side="top">
              {transcriptionAvailable ? t("huddle.transcript.start") : t("huddle.transcript.unavailable")}
            </TooltipContent>
          </Tooltip>
          {workspaceId ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button aria-label={t("huddle.addAgent.button")} className="buzz-huddle-control-button h-12 w-12 shrink-0 rounded-md"
                  onClick={() => setShowAddAgent(true)} size="icon" type="button" variant="secondary">
                  <Bot className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="buzz-huddle-tooltip" side="top">{t("huddle.addAgent.short")}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 justify-self-end">
        <Button aria-label={t("huddle.leave")} className="h-12 gap-2 px-4" disabled={isLeaving} aria-busy={isLeaving}
          onClick={() => void handleLeave()} size="sm" variant="destructive">
          <PhoneOff className="h-4 w-4" />
          {t("huddle.leaveShort")}
        </Button>
      </div>

      <output aria-live="polite" className="sr-only">
        {micConnected ? t("huddle.sr.micConnected") : t("huddle.sr.noMic")}
        {isPttMode ? t("huddle.sr.ptt") : t("huddle.sr.vad")}
        {!transcriptionAvailable || !speechAvailable ? t("huddle.sr.voiceOnly") : ""}
      </output>
    </div>
  );
}
