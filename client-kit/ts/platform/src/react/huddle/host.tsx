// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src-tauri/src/huddle/{mod.rs,commands.rs,audio_output.rs,reconnect.rs} Tauri commands
// desktop/src/features/huddle/lib/audioWorklet.ts::AudioWorkletHandle
// DD-125(3): the original HuddleContext drives the native huddle through Tauri commands and
// events. The shared bodies keep those verbs; each host provides them. Web: governed
// huddle.* actions plus the same-origin BFF audio bridge and an in-page media engine
// (getUserMedia, AudioWorklet, WebCodecs Opus). Desktop: the native pipeline over its own
// CLIENT key (DD-75), started through the same governed actions. Kailo differences: a
// Huddle parent is a Workspace or a conversation (not a raw Relay channel), Agents are
// Installation resources (not managed agent pubkeys), and the session is the
// HuddleBuzzBinding (`huddleId`) Core pre-allocated.
import * as React from "react";

export type VoiceInputMode = "push_to_talk" | "voice_activity";

export type HuddleParent =
  | { kind: "workspace"; workspaceId: string; channelId: string }
  | { kind: "conversation"; conversationId: string; channelId: string };

/** Original `HuddleJoinInfo` plus the binding Core pre-allocated. */
export type HuddleJoinInfo = { huddleId: string; ephemeralChannelId: string };

/** Original `HuddlePhase` (desktop/src-tauri/src/huddle/state.rs). */
export type HuddlePhase = "idle" | "creating" | "connecting" | "connected" | "active" | "leaving";

/** Original `get_huddle_state` subset the shared surfaces read. */
export type HuddleBackendState = {
  phase: HuddlePhase;
  huddleId: string | null;
  ephemeralChannelId: string | null;
  parent: HuddleParent | null;
  isCreator: boolean;
  /** Original `HuddleState.participants`: the live audio room roster (relay joined/roster/left). */
  participants: string[];
  /** This client's own key in the room (the first `joined` it receives). */
  selfPubkey: string | null;
  agentInstallationIds: string[];
  /** Original voice model status: false = original "voice-only mode" (DD-125(3), V-SCN-160). */
  transcriptionAvailable: boolean;
  speechAvailable: boolean;
};

export const IDLE_HUDDLE_STATE: HuddleBackendState = {
  phase: "idle",
  huddleId: null,
  ephemeralChannelId: null,
  parent: null,
  isCreator: false,
  participants: [],
  selfPubkey: null,
  agentInstallationIds: [],
  transcriptionAvailable: false,
  speechAvailable: false,
};

/** Original `setupAudioWorklet` handle. */
export type AudioWorkletHandle = {
  stop: () => void;
  setTransmitting: (active: boolean) => void;
  setMode: (mode: VoiceInputMode) => void;
  setGain: (value: number) => void;
};

export type AudioOutputDevice = { name: string; is_default: boolean };

/** The original Tauri events the shared bodies listen to. */
export type HuddleHostEvents = {
  "huddle-state-changed": HuddleBackendState;
  "huddle-active-speakers": string[];
  "huddle-speaker-levels": Record<string, number>;
  "huddle-audio-disconnected": null;
  "ptt-state": boolean;
};

/**
 * A host's Huddle backend. Every method maps onto one original Tauri command; failures reject
 * with the original error text where one exists so `formatHuddleActionError` keeps working.
 */
export interface HuddleHost {
  /** Why this host cannot run a Huddle at all (no secure context, no Opus codec); null = can. */
  readonly unavailableReason: "insecure-context" | "codec-unsupported" | null;
  startHuddle(parent: HuddleParent, agentInstallationIds: readonly string[], channelName: string): Promise<HuddleJoinInfo>;
  joinHuddle(parent: HuddleParent, ephemeralChannelId: string, huddleId: string): Promise<HuddleJoinInfo>;
  leaveHuddle(): Promise<void>;
  endHuddle(): Promise<void>;
  confirmHuddleActive(): Promise<void>;
  getHuddleState(): Promise<HuddleBackendState>;
  setupAudioWorklet(track: MediaStreamTrack, mode: VoiceInputMode, manuallyUnmuted: boolean): Promise<AudioWorkletHandle>;
  setManualMicUnmuted(enabled: boolean): Promise<void>;
  getVoiceInputMode(): Promise<VoiceInputMode>;
  setVoiceInputMode(mode: VoiceInputMode): Promise<void>;
  listAudioOutputDevices(): Promise<AudioOutputDevice[]>;
  getAudioOutputDevice(): Promise<string>;
  setAudioOutputDevice(name: string): Promise<void>;
  reconnectHuddleAudio(): Promise<void>;
  addAgentToHuddle(installationId: string): Promise<void>;
  removeAgentFromHuddle(installationId: string): Promise<void>;
  listen<K extends keyof HuddleHostEvents>(event: K, handler: (payload: HuddleHostEvents[K]) => void): () => void;
}

const HuddleHostContext = React.createContext<HuddleHost | null>(null);

export function HuddleHostProvider({ host, children }: { host: HuddleHost; children: React.ReactNode }) {
  return <HuddleHostContext.Provider value={host}>{children}</HuddleHostContext.Provider>;
}

export function useHuddleHost(): HuddleHost {
  const host = React.useContext(HuddleHostContext);
  if (!host) throw new Error("useHuddleHost must be used within a HuddleHostProvider");
  return host;
}

/** Hosts without a Huddle backend render no Huddle entry points (original surfaces stay hidden). */
export function useHasHuddleHost(): boolean {
  return React.useContext(HuddleHostContext) !== null;
}

/** The channel whose timeline is on screen, for its 48100 cards. */
const HuddleParentContext = React.createContext<HuddleParent | null>(null);

export function HuddleParentProvider({ parent, children }: { parent: HuddleParent | null; children: React.ReactNode }) {
  return <HuddleParentContext.Provider value={parent}>{children}</HuddleParentContext.Provider>;
}

export function useHuddleParent(): HuddleParent | null {
  return React.useContext(HuddleParentContext);
}

export function huddleParentKey(parent: HuddleParent): { workspaceId: string } | { conversationId: string } {
  return parent.kind === "workspace" ? { workspaceId: parent.workspaceId } : { conversationId: parent.conversationId };
}
