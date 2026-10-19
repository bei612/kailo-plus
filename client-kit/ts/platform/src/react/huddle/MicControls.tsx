// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/huddle/components/MicControls.tsx::{MicControls,SpeakerControls,DeviceList}
// DD-125(3): the original microphone split button (mute, Push to Talk with the original
// Ctrl+Space hint, input device, input volume, live meter) and the speaker split button
// (agent speech, headphones hint, output device). Kailo differences: strings come from the
// shared catalog; the macOS "Open Settings" link is a native-host action and is not offered;
// the agent speech toggle is disabled with the original voice-only state while speech is
// unavailable (V-SCN-160).
import * as React from "react";
import type { CSSProperties } from "react";
import { Check, ChevronUp, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { useT } from "../context";
import { isMacPlatform } from "../../keyboard-platform";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Button } from "../profile/buzz/shared/ui/button";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "../conversations/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../sidebar/tooltip";
import type { AudioInputDevice } from "./HuddleContext";
import type { AudioOutputDevice, VoiceInputMode } from "./host";

type MicControlsProps = {
  compact?: boolean;
  isMuted: boolean;
  onToggleMute: () => void;
  isPttMode: boolean;
  micConnected: boolean;
  micLevel: number;
  onSelectVoiceInputMode: (mode: VoiceInputMode) => void | Promise<void>;
  audioDevices: AudioInputDevice[];
  selectedDeviceId: string;
  onSelectDevice: (id: string) => void;
  micGain: number;
  onGainChange: (value: number) => void;
};

const splitIconButtonClass = "h-12 w-auto shrink-0 rounded-r-none px-4 py-4";
const splitChevronButtonClass = "buzz-huddle-split-chevron group h-12 w-auto shrink-0 rounded-l-none px-2 py-4";
const mutedHuddleControlClass = "bg-destructive/35 text-destructive shadow-none hover:bg-destructive/45 hover:text-destructive";
const compactMutedHuddleControlClass = "bg-destructive/15 text-destructive shadow-none hover:bg-destructive/20 hover:text-destructive";

type MicMeterBarStyle = CSSProperties & { "--buzz-huddle-meter-height": string };

const MIC_METER_IDLE_HEIGHT_REM = 0.25;
const MIC_METER_IDLE_HEIGHTS: [number, number, number] = [MIC_METER_IDLE_HEIGHT_REM, MIC_METER_IDLE_HEIGHT_REM, MIC_METER_IDLE_HEIGHT_REM];

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function micMeterBarStyle(heightRem: number): MicMeterBarStyle {
  return { "--buzz-huddle-meter-height": `${heightRem}rem` };
}

function micMeterHeights(level: number): [number, number, number] {
  const normalized = clamp01(level);
  if (normalized <= 0.01) return MIC_METER_IDLE_HEIGHTS;
  return [
    MIC_METER_IDLE_HEIGHT_REM + normalized * 0.5,
    MIC_METER_IDLE_HEIGHT_REM + normalized * 0.875,
    MIC_METER_IDLE_HEIGHT_REM + normalized * 0.625,
  ];
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false);
  React.useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setPrefersReducedMotion(mediaQuery.matches);
    sync();
    mediaQuery.addEventListener("change", sync);
    return () => mediaQuery.removeEventListener("change", sync);
  }, []);
  return prefersReducedMotion;
}

export function MicControls({
  compact = false,
  isMuted,
  onToggleMute,
  isPttMode,
  micConnected,
  micLevel,
  onSelectVoiceInputMode,
  audioDevices,
  selectedDeviceId,
  onSelectDevice,
  micGain,
  onGainChange,
}: MicControlsProps) {
  const t = useT();
  const micUnavailable = !micConnected;
  const prefersReducedMotion = usePrefersReducedMotion();
  const pushToTalkShortcut = isMacPlatform() ? "⌃Space" : "Ctrl+Space";
  const showMicMeter = micConnected && !isMuted;
  const [leftBarHeight, centerBarHeight, rightBarHeight] = prefersReducedMotion
    ? MIC_METER_IDLE_HEIGHTS
    : micMeterHeights(showMicMeter ? micLevel : 0);
  const micButtonLabel = micUnavailable ? t("huddle.mic.unavailable") : isMuted ? t("huddle.mic.unmute") : t("huddle.mic.mute");
  const micTooltip = micUnavailable ? t("huddle.mic.unavailableHint") : micButtonLabel;
  const iconButtonClass = compact
    ? "h-8 w-8 shrink-0 rounded-l-md rounded-r-none px-0 py-0 text-sidebar-foreground/70 !shadow-none hover:bg-sidebar-foreground/5 hover:text-sidebar-foreground/70"
    : splitIconButtonClass;
  const chevronButtonClass = compact
    ? "buzz-huddle-split-chevron group h-8 w-5 shrink-0 rounded-l-none rounded-r-md border-l border-sidebar-border/80 px-0.5 py-0 text-sidebar-foreground/70 !shadow-none hover:bg-sidebar-foreground/5 hover:text-sidebar-foreground/70"
    : splitChevronButtonClass;
  const mutedMicClass = isMuted || micUnavailable ? (compact ? compactMutedHuddleControlClass : mutedHuddleControlClass) : null;

  return (
    <Popover>
      <div className={cn("flex items-center rounded-md",
        compact && "overflow-hidden border border-sidebar-border/80 bg-transparent text-sidebar-foreground/70 shadow-none")}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button aria-disabled={micUnavailable} aria-label={micButtonLabel} aria-pressed={micConnected ? isMuted : true}
              className={cn(iconButtonClass, mutedMicClass, !isMuted && !micUnavailable && "buzz-huddle-split-main")}
              onClick={() => { if (micConnected) onToggleMute(); }} size="icon"
              variant={compact || isMuted || micUnavailable ? "ghost" : "secondary"}>
              {isMuted || micUnavailable ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="buzz-huddle-tooltip" side="top">
            {isPttMode && !micUnavailable && isMuted ? (
              <span className="flex items-center gap-1.5">
                <span>{t("huddle.mic.pttHint")}</span>
                <kbd className="rounded border border-border/70 bg-muted/70 px-1.5 py-0.5 text-2xs text-muted-foreground">{pushToTalkShortcut}</kbd>
              </span>
            ) : micTooltip}
          </TooltipContent>
        </Tooltip>
        <PopoverTrigger asChild>
          <Button aria-label={t("huddle.audioSettings")} className={chevronButtonClass} size="icon" variant={compact ? "ghost" : "secondary"}>
            {showMicMeter && !compact ? (
              <span aria-hidden="true" className="relative flex h-5 w-5 items-center justify-center">
                <span className="flex h-5 w-5 items-center justify-between text-current group-data-[state=open]:hidden group-focus-visible:hidden group-hover:hidden">
                  <span className="buzz-huddle-mic-meter-bar bg-current" style={micMeterBarStyle(leftBarHeight)} />
                  <span className="buzz-huddle-mic-meter-bar bg-current" style={micMeterBarStyle(centerBarHeight)} />
                  <span className="buzz-huddle-mic-meter-bar bg-current" style={micMeterBarStyle(rightBarHeight)} />
                </span>
                <ChevronUp className="hidden h-4 w-4 group-data-[state=open]:block group-focus-visible:block group-hover:block" />
              </span>
            ) : <ChevronUp className="h-4 w-4" />}
          </Button>
        </PopoverTrigger>
      </div>
      <PopoverContent side="top" className="buzz-huddle-drawer buzz-huddle-popover w-64 text-foreground">
        <div className="flex flex-col gap-3">
          <div>
            <span className="mb-1 block text-xs font-medium">{t("huddle.inputMode")}</span>
            <button aria-label={isPttMode ? t("huddle.ptt.turnOff") : t("huddle.ptt.turnOn")} aria-pressed={isPttMode}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
              onClick={() => void onSelectVoiceInputMode(isPttMode ? "voice_activity" : "push_to_talk")} type="button">
              <Check className={cn("h-3 w-3 shrink-0", !isPttMode && "invisible")} />
              <span className="font-medium">{t("huddle.ptt.label")}</span>
              <kbd className="ml-auto rounded border border-border/70 bg-muted/70 px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">{pushToTalkShortcut}</kbd>
            </button>
            <span className="sr-only" aria-live="polite">{isPttMode ? t("huddle.ptt.enabled") : t("huddle.ptt.continuous")}</span>
          </div>
          <DeviceList label={t("huddle.microphone")}
            devices={audioDevices.map((device) => ({ id: device.deviceId, label: device.label || t("huddle.micFallback", { id: device.deviceId.slice(0, 8) }) }))}
            selectedId={selectedDeviceId} onSelect={onSelectDevice} showChangeHint={!!selectedDeviceId && micConnected} />
          <div>
            <label htmlFor="mic-volume" className="mb-1 block text-xs font-medium">{t("huddle.inputVolume")}</label>
            <div className="flex items-center gap-2">
              <input id="mic-volume" type="range" min={0} max={1} step={0.01} value={micGain}
                onChange={(event) => onGainChange(Number(event.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-foreground" />
              <span className="w-8 text-right text-xs text-muted-foreground">{Math.round(micGain * 100)}%</span>
            </div>
            {micUnavailable && (
              <div className="mt-3 rounded-md border border-foreground/10 bg-foreground/8 px-2 py-2 text-xs text-foreground">
                <p className="font-medium">{t("huddle.mic.unavailable")}</p>
                <p className="mt-1 leading-snug text-foreground/70">{t("huddle.mic.permissionHint")}</p>
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type SpeakerControlsProps = {
  ttsEnabled: boolean;
  /** False in the original voice-only mode: agent speech cannot play on this host now. */
  speechAvailable: boolean;
  showHeadphonesHint?: boolean;
  onHeadphonesHintDismiss?: () => void;
  onToggleTts: () => void;
  outputDevices: AudioOutputDevice[];
  selectedOutputDevice: string;
  onSelectOutputDevice: (name: string) => void;
};

export function SpeakerControls({
  ttsEnabled,
  speechAvailable,
  showHeadphonesHint = false,
  onHeadphonesHintDismiss,
  onToggleTts,
  outputDevices,
  selectedOutputDevice,
  onSelectOutputDevice,
}: SpeakerControlsProps) {
  const t = useT();
  const speaking = speechAvailable && ttsEnabled;
  return (
    <Popover>
      <div className="relative flex items-center">
        <Popover open={showHeadphonesHint} onOpenChange={(open) => { if (!open) onHeadphonesHintDismiss?.(); }}>
          <PopoverAnchor asChild>
            <span aria-hidden="true" className="pointer-events-none absolute inset-0" />
          </PopoverAnchor>
          <PopoverContent align="center" aria-label={t("huddle.headphones.title")}
            className="buzz-huddle-drawer buzz-huddle-popover buzz-huddle-headphones-hint w-64 p-3 text-foreground"
            onCloseAutoFocus={(event) => event.preventDefault()} onOpenAutoFocus={(event) => event.preventDefault()}
            side="top" sideOffset={10}>
            <div className="flex flex-col gap-2">
              <div>
                <p className="text-xs font-medium">{t("huddle.headphones.heading")}</p>
                <p className="mt-1 text-xs leading-snug text-foreground/75">{t("huddle.headphones.body")}</p>
              </div>
              <div className="flex justify-end">
                <Button className="h-7 bg-foreground/10 px-2 text-xs hover:bg-foreground/15" onClick={onHeadphonesHintDismiss}
                  size="sm" type="button" variant="ghost">{t("huddle.headphones.ok")}</Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button aria-label={!speechAvailable ? t("huddle.speech.unavailable") : ttsEnabled ? t("huddle.speech.mute") : t("huddle.speech.unmute")}
                aria-pressed={!speaking} disabled={!speechAvailable}
                className={cn(splitIconButtonClass, speaking ? "buzz-huddle-split-main" : mutedHuddleControlClass)}
                onClick={onToggleTts} size="icon" variant={speaking ? "secondary" : "ghost"}>
                {speaking ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent className="buzz-huddle-tooltip" side="top">
            {!speechAvailable ? t("huddle.speech.unavailable") : ttsEnabled ? t("huddle.speech.mute") : t("huddle.speech.unmute")}
          </TooltipContent>
        </Tooltip>
        <PopoverTrigger asChild>
          <Button aria-label={t("huddle.speakerSettings")} className={splitChevronButtonClass} size="icon" variant="secondary">
            <ChevronUp className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
      </div>
      <PopoverContent side="top" className="buzz-huddle-drawer buzz-huddle-popover w-64 text-foreground">
        <DeviceList label={t("huddle.speaker")} devices={outputDevices.map((device) => ({ id: device.name, label: device.name }))}
          selectedId={selectedOutputDevice} onSelect={onSelectOutputDevice} showChangeHint={!!selectedOutputDevice} />
      </PopoverContent>
    </Popover>
  );
}

export function DeviceList({ label, devices, selectedId, onSelect, showChangeHint }: {
  label: string;
  devices: { id: string; label: string }[];
  selectedId: string;
  onSelect: (id: string) => void;
  showChangeHint: boolean;
}) {
  const t = useT();
  const seenDeviceIds = new Map<string, number>();
  const keyedDevices = devices.map((device) => {
    const occurrence = (seenDeviceIds.get(device.id) ?? 0) + 1;
    seenDeviceIds.set(device.id, occurrence);
    return { ...device, key: occurrence === 1 ? device.id : `${device.id}-${occurrence}` };
  });
  return (
    <div>
      <span className="mb-1 block text-xs font-medium">{label}</span>
      <ul className="flex flex-col">
        <li>
          <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
            onClick={() => onSelect("")} type="button">
            <Check className={cn("h-4 w-4 shrink-0", selectedId && "invisible")} />
            {t("huddle.systemDefault")}
          </button>
        </li>
        {keyedDevices.map((device) => (
          <li key={device.key}>
            <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
              onClick={() => onSelect(device.id)} type="button">
              <Check className={cn("h-4 w-4 shrink-0", selectedId !== device.id && "invisible")} />
              <span className="truncate">{device.label}</span>
            </button>
          </li>
        ))}
      </ul>
      {showChangeHint && <p className="mt-1 text-2xs text-muted-foreground">{t("huddle.changeNextHuddle")}</p>}
    </div>
  );
}
