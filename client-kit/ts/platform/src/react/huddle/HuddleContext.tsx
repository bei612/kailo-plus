// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/huddle/HuddleContext.tsx::{HuddleProvider,useHuddle,useHuddleLevels}
// desktop/src/features/huddle/HuddleContext.types.ts
// desktop/src/features/huddle/lib/useAudioDevices.ts::useAudioDevices
// desktop/src/features/huddle/lib/useMicLevelAnalyser.ts::useMicLevelAnalyser
// desktop/src/features/huddle/lib/useHuddlePttState.ts::useHuddlePttState
// desktop/src/features/huddle/lib/useHuddleSpeakerActivity.ts::useHuddleSpeakerActivity
// DD-125(3): the original Huddle lifecycle as a shared provider over the host seam
// (`./host`). start/join → getUserMedia (echo cancellation, noise suppression, 48 kHz) →
// setupAudioWorklet → confirm active; leave stops the worklet and the track first; an
// unexpected audio disconnect retries with the original backoff and leaves when it is
// exhausted. Push-to-talk starts muted. Kailo differences: one window owns the session (no
// companion mirroring), the parent is a Workspace or conversation, Agents are Installations,
// and there is no Agent speech pipeline while the voice service is unavailable (original
// voice-only mode, V-SCN-160). Errors use the shared catalog.
import * as React from "react";
import { useT } from "../context";
import { huddleActionErrorKey, type HuddleAction } from "../../huddle";
import {
  type AudioOutputDevice,
  type AudioWorkletHandle,
  type HuddleBackendState,
  type HuddleParent,
  IDLE_HUDDLE_STATE,
  type VoiceInputMode,
  useHuddleHost,
} from "./host";

export type AudioInputDevice = { deviceId: string; label: string };

export interface HuddleLevelsValue {
  micLevel: number;
  activeSpeakers: string[];
  speakerLevels: Record<string, number>;
}

export interface HuddleContextValue {
  localAudioTrack: MediaStreamTrack | null;
  isStarting: boolean;
  huddleError: string | null;
  clearHuddleError: () => void;
  micConnected: boolean;
  isMuted: boolean;
  toggleMute: () => void;
  pttActive: boolean;
  voiceInputMode: VoiceInputMode;
  setVoiceInputMode: (mode: VoiceInputMode) => Promise<void>;
  audioDevices: AudioInputDevice[];
  selectedDeviceId: string;
  setSelectedDeviceId: (id: string) => void;
  micGain: number;
  setMicGain: (value: number) => void;
  outputDevices: AudioOutputDevice[];
  selectedOutputDevice: string;
  setSelectedOutputDevice: (name: string) => void;
  activeEphemeralChannelId: string | null;
  activeHuddleId: string | null;
  backendState: HuddleBackendState;
  showHuddleInMainApp: (ephemeralChannelId: string) => void;
  viewHuddleChannel: (ephemeralChannelId: string) => void;
  /** Whether the host can open a Huddle's temporary channel (original "View huddle"). */
  canViewHuddleChannel: boolean;
  startHuddle: (parent: HuddleParent, agentInstallationIds: readonly string[], channelName: string) => Promise<void>;
  joinHuddle: (parent: HuddleParent, ephemeralChannelId: string, huddleId: string) => Promise<void>;
  leaveHuddle: () => Promise<boolean>;
  endHuddle: () => Promise<boolean>;
}

/** Original `formatHuddleActionError` rendered through the shared catalog. */
export function useFormatHuddleError() {
  const t = useT();
  return React.useCallback((error: unknown, action: HuddleAction) => {
    const formatted = huddleActionErrorKey(error, action);
    return "key" in formatted ? t(formatted.key) : formatted.message;
  }, [t]);
}

function isRedundantHuddlePhaseError(message: string): boolean {
  return /^cannot (?:start|join) huddle: already in phase /i.test(message);
}

function useAudioDevices(workletRef: React.RefObject<AudioWorkletHandle | null>) {
  const [audioDevices, setAudioDevices] = React.useState<AudioInputDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = React.useState("");
  const [micGain, setMicGainState] = React.useState(1);

  React.useEffect(() => {
    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (!media) return;
    function refreshDevices() {
      media?.enumerateDevices()
        .then((devices) => setAudioDevices(devices
          .filter((device) => device.kind === "audioinput")
          .map((device) => ({ deviceId: device.deviceId, label: device.label }))))
        .catch(() => { /* best-effort */ });
    }
    refreshDevices();
    media.addEventListener("devicechange", refreshDevices);
    return () => media.removeEventListener("devicechange", refreshDevices);
  }, []);

  const setMicGain = React.useCallback((value: number) => {
    const clamped = Math.max(0, Math.min(1, value));
    setMicGainState(clamped);
    workletRef.current?.setGain(clamped);
  }, [workletRef]);

  return { audioDevices, selectedDeviceId, setSelectedDeviceId, micGain, setMicGain };
}

const MIC_ANALYSER_UPDATE_INTERVAL_MS = 33;
const MIC_INITIAL_NOISE_FLOOR = 0.01;
const MIC_VOICE_GATE_ON_RMS = 0.018;
const MIC_VOICE_GATE_OFF_RMS = 0.012;
const MIC_VOICE_GATE_MARGIN_RMS = 0.012;
const MIC_LEVEL_ACTIVE_RANGE_RMS = 0.11;
const MIC_MIN_ACTIVE_LEVEL = 0.18;
const MIC_LEVEL_ATTACK = 0.58;
const MIC_ACTIVE_NOISE_FLOOR_RISE = 0.006;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function useMicLevelAnalyser(localAudioTrack: MediaStreamTrack | null, micConnected: boolean): number {
  const [micLevel, setMicLevel] = React.useState(0);
  React.useEffect(() => {
    if (!localAudioTrack || !micConnected || typeof AudioContext === "undefined") {
      setMicLevel(0);
      return;
    }
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    const source = ctx.createMediaStreamSource(new MediaStream([localAudioTrack]));
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let raf = 0;
    let lastUpdate = 0;
    let voiceActive = false;
    let noiseFloor = MIC_INITIAL_NOISE_FLOOR;
    let smoothedLevel = 0;
    function tick(now: number) {
      raf = requestAnimationFrame(tick);
      if (now - lastUpdate < MIC_ANALYSER_UPDATE_INTERVAL_MS) return;
      lastUpdate = now;
      analyser.getFloatTimeDomainData(buf);
      let sumSquares = 0;
      for (let i = 0; i < buf.length; i += 1) {
        const sample = buf[i] ?? 0;
        sumSquares += sample * sample;
      }
      const rms = Math.sqrt(sumSquares / buf.length);
      const activeThreshold = Math.max(MIC_VOICE_GATE_ON_RMS, noiseFloor + MIC_VOICE_GATE_MARGIN_RMS);
      const idleThreshold = Math.max(MIC_VOICE_GATE_OFF_RMS, noiseFloor + MIC_VOICE_GATE_MARGIN_RMS * 0.55);
      voiceActive = voiceActive ? rms > idleThreshold : rms > activeThreshold;
      const floorRate = rms < noiseFloor ? 0.18 : voiceActive ? MIC_ACTIVE_NOISE_FLOOR_RISE : 0.025;
      noiseFloor += (rms - noiseFloor) * floorRate;
      if (!voiceActive) {
        smoothedLevel = 0;
        setMicLevel(0);
        return;
      }
      const normalized = clamp01((rms - noiseFloor) / MIC_LEVEL_ACTIVE_RANGE_RMS);
      const targetLevel = Math.max(normalized, MIC_MIN_ACTIVE_LEVEL);
      smoothedLevel += (targetLevel - smoothedLevel) * MIC_LEVEL_ATTACK;
      setMicLevel(smoothedLevel);
    }
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      void ctx.close();
    };
  }, [localAudioTrack, micConnected]);
  return micLevel;
}

function useHuddlePttState(micConnected: boolean) {
  const host = useHuddleHost();
  const [pttActive, setPttActive] = React.useState(false);
  const [voiceInputMode, setVoiceInputModeState] = React.useState<VoiceInputMode>("push_to_talk");
  const voiceInputModeRef = React.useRef<VoiceInputMode>("push_to_talk");
  voiceInputModeRef.current = voiceInputMode;
  const getVoiceInputMode = React.useCallback(() => voiceInputModeRef.current, []);
  const pttAudioCtxRef = React.useRef<AudioContext | null>(null);

  React.useEffect(() => {
    host.getVoiceInputMode().then(setVoiceInputModeState).catch(() => { /* default is push_to_talk */ });
  }, [host]);

  React.useEffect(() => {
    const unlisten = host.listen("ptt-state", (active) => {
      const acceptsPtt = micConnected && voiceInputModeRef.current === "push_to_talk";
      setPttActive(acceptsPtt ? active : false);
      if (!acceptsPtt || typeof AudioContext === "undefined") return;
      try {
        if (!pttAudioCtxRef.current || pttAudioCtxRef.current.state === "closed") {
          pttAudioCtxRef.current = new AudioContext();
        }
        const context = pttAudioCtxRef.current;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.frequency.value = active ? 880 : 440;
        gain.gain.value = 0.05;
        oscillator.start();
        oscillator.stop(context.currentTime + 0.05);
      } catch {
        /* best-effort press/release cue */
      }
    });
    return () => {
      unlisten();
      if (pttAudioCtxRef.current && pttAudioCtxRef.current.state !== "closed") {
        void pttAudioCtxRef.current.close();
      }
      pttAudioCtxRef.current = null;
    };
  }, [host, micConnected]);

  React.useEffect(() => {
    if (!micConnected || voiceInputMode !== "push_to_talk") setPttActive(false);
  }, [micConnected, voiceInputMode]);

  return { getVoiceInputMode, pttActive, setVoiceInputModeState, voiceInputMode };
}

function useHuddleSpeakerActivity() {
  const host = useHuddleHost();
  const [activeSpeakers, setActiveSpeakers] = React.useState<string[]>([]);
  const [speakerLevels, setSpeakerLevels] = React.useState<Record<string, number>>({});
  React.useEffect(() => host.listen("huddle-speaker-levels", setSpeakerLevels), [host]);
  React.useEffect(() => host.listen("huddle-active-speakers", setActiveSpeakers), [host]);
  const resetSpeakerActivity = React.useCallback(() => {
    setActiveSpeakers([]);
    setSpeakerLevels({});
  }, []);
  return { activeSpeakers, resetSpeakerActivity, speakerLevels };
}

const HuddleContext = React.createContext<HuddleContextValue | null>(null);
const HuddleLevelsContext = React.createContext<HuddleLevelsValue | null>(null);

/** Original reconnect backoff for a recoverable audio socket loss. */
const RECONNECT_DELAYS_MS = [0, 100, 250, 500, 1_000, 2_000, 2_000];

export function HuddleProvider({
  children,
  onHuddleStarted,
  onShowHuddleInMainApp,
  onViewHuddleChannel,
}: {
  children: React.ReactNode;
  /** Called after a huddle has connected its local audio. */
  onHuddleStarted?: (ephemeralChannelId: string) => void | Promise<void>;
  /** Reveals a huddle's temporary channel in the main app. */
  onShowHuddleInMainApp?: (ephemeralChannelId: string) => void;
  /** Reveals an active or archived Huddle channel in the main app. */
  onViewHuddleChannel?: (ephemeralChannelId: string) => void;
}) {
  const host = useHuddleHost();
  const formatHuddleError = useFormatHuddleError();
  const workletRef = React.useRef<AudioWorkletHandle | null>(null);
  const tokenRef = React.useRef(0);
  const busyRef = React.useRef(false);
  /** True once the host start/join has been invoked (even before media refs are populated). */
  const backendActiveRef = React.useRef(false);
  const [localAudioTrack, setLocalAudioTrack] = React.useState<MediaStreamTrack | null>(null);
  const [isStarting, setIsStarting] = React.useState(false);
  const [huddleError, setHuddleError] = React.useState<string | null>(null);
  const clearHuddleError = React.useCallback(() => setHuddleError(null), []);
  const [micConnected, setMicConnected] = React.useState(false);
  const [isMuted, setIsMuted] = React.useState(false);
  const isMutedRef = React.useRef(isMuted);
  isMutedRef.current = isMuted;
  const { getVoiceInputMode, pttActive, setVoiceInputModeState, voiceInputMode } = useHuddlePttState(micConnected);
  // Manual mute stays independently controllable in every input mode. The PTT shortcut
  // temporarily opens a manually muted microphone while held.
  const locallyMuted = isMuted && !(voiceInputMode === "push_to_talk" && pttActive);
  const locallyMutedRef = React.useRef(locallyMuted);
  locallyMutedRef.current = locallyMuted;
  const [ephemeralChannelId, setEphemeralChannelId] = React.useState<string | null>(null);
  const [backendState, setBackendState] = React.useState<HuddleBackendState>(IDLE_HUDDLE_STATE);
  const { activeSpeakers, resetSpeakerActivity, speakerLevels } = useHuddleSpeakerActivity();
  const { audioDevices, selectedDeviceId, setSelectedDeviceId, micGain, setMicGain } = useAudioDevices(workletRef);
  const [outputDevices, setOutputDevices] = React.useState<AudioOutputDevice[]>([]);
  const [selectedOutputDevice, setSelectedOutputDeviceState] = React.useState("");
  const setSelectedOutputDevice = React.useCallback((name: string) => {
    setSelectedOutputDeviceState(name);
    host.setAudioOutputDevice(name).catch(() => { /* best-effort */ });
  }, [host]);

  React.useEffect(() => {
    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    function refreshOutputDevices() {
      host.listAudioOutputDevices().then(setOutputDevices).catch(() => { /* best-effort */ });
    }
    refreshOutputDevices();
    host.getAudioOutputDevice().then(setSelectedOutputDeviceState).catch(() => { /* best-effort */ });
    media?.addEventListener("devicechange", refreshOutputDevices);
    return () => media?.removeEventListener("devicechange", refreshOutputDevices);
  }, [host]);

  const micGainRef = React.useRef(1);
  micGainRef.current = micGain;

  const setVoiceInputMode = React.useCallback(async (mode: VoiceInputMode) => {
    await host.setVoiceInputMode(mode);
    setVoiceInputModeState(mode);
    void host.setManualMicUnmuted(!isMutedRef.current).catch(() => {});
    workletRef.current?.setMode(mode);
  }, [host, setVoiceInputModeState]);

  const audioTrackRef = React.useRef<MediaStreamTrack | null>(null);
  audioTrackRef.current = localAudioTrack;

  React.useEffect(() => {
    if (!audioTrackRef.current) return;
    audioTrackRef.current.enabled = !locallyMuted;
    workletRef.current?.setTransmitting(!isMuted);
  }, [isMuted, locallyMuted]);

  const toggleMute = React.useCallback(() => {
    // Set the effective state promised by the button instead of inverting the hidden manual
    // preference, which can differ while PTT is held.
    const requestedMuted = !locallyMuted;
    setIsMuted(requestedMuted);
    void host.setManualMicUnmuted(!requestedMuted).catch(() => {});
  }, [host, locallyMuted]);

  /** Stop the worklet and the mic track. Best-effort on all steps. */
  const disconnectMedia = React.useCallback(async () => {
    tokenRef.current += 1;
    try {
      workletRef.current?.stop();
    } catch {
      /* best-effort */
    }
    workletRef.current = null;
    audioTrackRef.current?.stop();
    setLocalAudioTrack(null);
    setMicConnected(false);
    setEphemeralChannelId(null);
    resetSpeakerActivity();
  }, [resetSpeakerActivity]);

  React.useEffect(() => {
    const apply = (state: HuddleBackendState) => {
      setBackendState(state);
      if (state.phase === "idle") {
        void disconnectMedia();
        return;
      }
      if (state.ephemeralChannelId) setEphemeralChannelId(state.ephemeralChannelId);
    };
    let cancelled = false;
    host.getHuddleState().then((state) => { if (!cancelled) apply(state); }).catch(() => { /* events stay authoritative */ });
    const unlisten = host.listen("huddle-state-changed", apply);
    return () => {
      cancelled = true;
      unlisten();
    };
  }, [disconnectMedia, host]);

  const leaveHuddle = React.useCallback(async (): Promise<boolean> => {
    await disconnectMedia();
    try {
      await host.leaveHuddle();
      backendActiveRef.current = false;
    } catch {
      return false;
    }
    return true;
  }, [disconnectMedia, host]);

  const endHuddle = React.useCallback(async (): Promise<boolean> => {
    await disconnectMedia();
    try {
      await host.endHuddle();
      backendActiveRef.current = false;
    } catch {
      return false;
    }
    return true;
  }, [disconnectMedia, host]);

  const cleanupFailedStart = React.useCallback(async (worklet: AudioWorkletHandle | null, isCreator: boolean) => {
    try {
      worklet?.stop();
    } catch {
      /* best-effort */
    }
    setLocalAudioTrack(null);
    setMicConnected(false);
    setEphemeralChannelId(null);
    resetSpeakerActivity();
    if (!backendActiveRef.current) return;
    try {
      if (isCreator) await host.endHuddle();
      else await host.leaveHuddle();
      backendActiveRef.current = false;
    } catch {
      try {
        await host.leaveHuddle();
        backendActiveRef.current = false;
      } catch { /* best-effort */ }
    }
  }, [host, resetSpeakerActivity]);

  const cleanupSupersededStart = React.useCallback((worklet: AudioWorkletHandle | null) => {
    try {
      worklet?.stop();
    } catch {
      /* best-effort */
    }
    workletRef.current = null;
    backendActiveRef.current = false;
    setLocalAudioTrack(null);
    setMicConnected(false);
    setEphemeralChannelId(null);
    resetSpeakerActivity();
  }, [resetSpeakerActivity]);

  /** Shared media setup: get the mic, set up the worklet, confirm active. */
  const connectAndSetupMedia = React.useCallback(async (joinInfo: { ephemeralChannelId: string }, myToken: number) => {
    if (tokenRef.current !== myToken) throw new Error("superseded");
    // Request 48 kHz to match the Opus encoder and the 960-sample (20 ms) worklet frames.
    const audioConstraints: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, sampleRate: 48000 };
    if (selectedDeviceId) audioConstraints.deviceId = { exact: selectedDeviceId };
    const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    const audioTrack = stream.getAudioTracks()[0];
    // The stream is always released on failure, so the microphone indicator never stays on.
    try {
      if (!audioTrack) throw new Error("no microphone track");
      if (tokenRef.current !== myToken) throw new Error("superseded");
      setLocalAudioTrack(audioTrack);
      setMicConnected(true);
      audioTrack.enabled = !locallyMutedRef.current;
      const worklet = await host.setupAudioWorklet(audioTrack, getVoiceInputMode(), !isMutedRef.current);
      worklet.setGain(micGainRef.current);
      if (tokenRef.current !== myToken) {
        worklet.stop();
        throw new Error("superseded");
      }
      workletRef.current = worklet;
      setEphemeralChannelId(joinInfo.ephemeralChannelId);
      await host.confirmHuddleActive();
      return { worklet, stream };
    } catch (err) {
      stream.getTracks().forEach((track) => track.stop());
      setLocalAudioTrack(null);
      setMicConnected(false);
      throw err;
    }
  }, [getVoiceInputMode, host, selectedDeviceId]);

  const runSession = React.useCallback(async (action: HuddleAction, begin: () => Promise<{ ephemeralChannelId: string }>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    tokenRef.current += 1;
    const myToken = tokenRef.current;
    // PTT starts muted (matches the original manual_mic_unmuted default).
    const startMuted = getVoiceInputMode() === "push_to_talk";
    isMutedRef.current = startMuted;
    setIsMuted(startMuted);
    setHuddleError(null);
    setIsStarting(true);
    try {
      const joinInfo = await begin();
      backendActiveRef.current = true;
      try {
        await connectAndSetupMedia(joinInfo, myToken);
      } catch (e) {
        if (e instanceof Error && e.message === "superseded") {
          cleanupSupersededStart(workletRef.current);
          return;
        }
        throw e;
      }
      try {
        await onHuddleStarted?.(joinInfo.ephemeralChannelId);
      } catch (error) {
        // Presentation-only: keep the connected huddle alive.
        console.error("Failed to present huddle:", error);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (isRedundantHuddlePhaseError(message)) {
        setHuddleError(null);
        return;
      }
      const worklet = workletRef.current;
      workletRef.current = null;
      await cleanupFailedStart(worklet, action === "start");
      setHuddleError(formatHuddleError(e, action));
      throw e;
    } finally {
      setIsStarting(false);
      busyRef.current = false;
    }
  }, [cleanupFailedStart, cleanupSupersededStart, connectAndSetupMedia, formatHuddleError, getVoiceInputMode, onHuddleStarted]);

  const startHuddle = React.useCallback(
    (parent: HuddleParent, agentInstallationIds: readonly string[], channelName: string) =>
      runSession("start", () => host.startHuddle(parent, agentInstallationIds, channelName)),
    [host, runSession],
  );

  const joinHuddle = React.useCallback(
    (parent: HuddleParent, ephemeral: string, huddleId: string) =>
      runSession("join", () => host.joinHuddle(parent, ephemeral, huddleId)),
    [host, runSession],
  );

  const showHuddleInMainApp = React.useCallback((channelId: string) => onShowHuddleInMainApp?.(channelId), [onShowHuddleInMainApp]);
  const viewHuddleChannel = React.useCallback((channelId: string) => onViewHuddleChannel?.(channelId), [onViewHuddleChannel]);

  const micLevel = useMicLevelAnalyser(localAudioTrack, micConnected);

  // Leave on unmount only: the stable ref prevents re-firing mid-startup.
  const leaveHuddleRef = React.useRef(leaveHuddle);
  leaveHuddleRef.current = leaveHuddle;
  React.useEffect(() => () => { void leaveHuddleRef.current(); }, []);

  // A lost audio socket is recoverable: keep the huddle and mic while only the audio
  // connection is re-dialled; an intentional leave/start supersedes the loop.
  const reconnectInFlightRef = React.useRef(false);
  React.useEffect(() => {
    let cancelled = false;
    const unlisten = host.listen("huddle-audio-disconnected", () => {
      if (cancelled || reconnectInFlightRef.current) return;
      reconnectInFlightRef.current = true;
      const reconnectToken = tokenRef.current;
      void (async () => {
        for (const delayMs of RECONNECT_DELAYS_MS) {
          if (cancelled || tokenRef.current !== reconnectToken) return;
          if (delayMs > 0) await new Promise((resolve) => window.setTimeout(resolve, delayMs));
          if (cancelled || tokenRef.current !== reconnectToken) return;
          try {
            await host.reconnectHuddleAudio();
            return;
          } catch {
            // Keep the bounded backoff client-local.
          }
        }
        if (!cancelled && tokenRef.current === reconnectToken) await leaveHuddleRef.current();
      })().finally(() => {
        reconnectInFlightRef.current = false;
      });
    });
    return () => {
      cancelled = true;
      unlisten();
    };
  }, [host]);

  const levelsValue = React.useMemo<HuddleLevelsValue>(
    () => ({ micLevel, activeSpeakers, speakerLevels }),
    [activeSpeakers, micLevel, speakerLevels],
  );

  const contextValue = React.useMemo<HuddleContextValue>(() => ({
    localAudioTrack,
    isStarting,
    huddleError,
    clearHuddleError,
    micConnected,
    isMuted: locallyMuted,
    toggleMute,
    pttActive,
    voiceInputMode,
    setVoiceInputMode,
    audioDevices,
    selectedDeviceId,
    setSelectedDeviceId,
    micGain,
    setMicGain,
    outputDevices,
    selectedOutputDevice,
    setSelectedOutputDevice,
    activeEphemeralChannelId: ephemeralChannelId,
    activeHuddleId: backendState.phase === "idle" ? null : backendState.huddleId,
    backendState,
    showHuddleInMainApp,
    viewHuddleChannel,
    canViewHuddleChannel: onViewHuddleChannel !== undefined,
    startHuddle,
    joinHuddle,
    leaveHuddle,
    endHuddle,
  }), [onViewHuddleChannel, 
    audioDevices, backendState, clearHuddleError, endHuddle, ephemeralChannelId, huddleError, isStarting, joinHuddle,
    leaveHuddle, localAudioTrack, locallyMuted, micConnected, micGain, outputDevices, pttActive, selectedDeviceId,
    selectedOutputDevice, setMicGain, setSelectedDeviceId, setSelectedOutputDevice, setVoiceInputMode, showHuddleInMainApp,
    startHuddle, toggleMute, viewHuddleChannel, voiceInputMode,
  ]);

  return (
    <HuddleContext.Provider value={contextValue}>
      <HuddleLevelsContext.Provider value={levelsValue}>{children}</HuddleLevelsContext.Provider>
    </HuddleContext.Provider>
  );
}

export function useHuddle(): HuddleContextValue {
  const ctx = React.useContext(HuddleContext);
  if (!ctx) throw new Error("useHuddle must be used within a HuddleProvider");
  return ctx;
}

/** The huddle session when a HuddleProvider is mounted (hosts without one render nothing). */
export function useOptionalHuddle(): HuddleContextValue | null {
  return React.useContext(HuddleContext);
}

/** High-frequency mic/speaker levels; consume only from meter components. */
export function useHuddleLevels(): HuddleLevelsValue {
  const ctx = React.useContext(HuddleLevelsContext);
  if (!ctx) throw new Error("useHuddleLevels must be used within a HuddleProvider");
  return ctx;
}
