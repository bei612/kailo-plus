// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src-tauri/src/huddle/mod.rs::{start_huddle,join_huddle,leave_huddle,end_huddle,
// confirm_huddle_active,get_huddle_state,set_voice_input_mode}
// desktop/src-tauri/src/huddle/commands.rs::{add_agent_to_huddle,remove_agent_from_huddle}
// desktop/src-tauri/src/huddle/relay_api.rs::count_human_members
// DD-125(3), V-SCN-131/158/159/160: the Web Huddle backend behind the shared HuddleProvider.
// Writes go through Core: huddle.start (Core projects the temp channel for the caller's SERVER
// key), the BFF signs the creator's 48106/48100 once (announcement), Agents use
// huddle.agent.add/remove and End uses huddle.end. Join/leave are not governed actions: the
// audio is the same-origin BFF bridge; leaving while other humans remain is the caller's own
// 9022, the last leave only disconnects (the Relay archives and signs 48103). An announcement
// that cannot be delivered rolls back to huddle.end, like the original start rollback.
import type { ActionSubmission, HuddleView } from "@client-kit/contracts";
import { ActionDispatchState, HuddleState, HuddleVoiceAvailability } from "@client-kit/contracts";
import { newIdempotencyKey } from "@client-kit/platform/governance";
import {
  type AudioOutputDevice,
  type AudioWorkletHandle,
  type HuddleBackendState,
  type HuddleHost,
  type HuddleHostEvents,
  type HuddleJoinInfo,
  type HuddleParent,
  IDLE_HUDDLE_STATE,
  type VoiceInputMode,
} from "@client-kit/platform/react/huddle";
import type { BffClient } from "@client-kit/platform/client";
import { HuddleAudioSession, opusSupported } from "./audioSession";

/** Bounded wait for an UNKNOWN huddle.* outcome to settle by replaying the same key. */
const SETTLE_ATTEMPTS = 8;
const SETTLE_DELAY_MS = 750;

type Listener<K extends keyof HuddleHostEvents> = (payload: HuddleHostEvents[K]) => void;

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export class WebHuddleHost implements HuddleHost {
  readonly unavailableReason: HuddleHost["unavailableReason"];
  private state: HuddleBackendState = IDLE_HUDDLE_STATE;
  private session: HuddleAudioSession | null = null;
  private mode: VoiceInputMode = "push_to_talk";
  /** Selected output: its visible name (the original device key) and the sink id it maps to. */
  private outputDevice = "";
  private outputDeviceName = "";
  private readonly listeners = new Map<keyof HuddleHostEvents, Set<Listener<keyof HuddleHostEvents>>>();

  constructor(private readonly client: BffClient, environment: { secure: boolean; webCodecs: boolean } = {
    secure: typeof window !== "undefined" && window.isSecureContext,
    webCodecs: typeof AudioEncoder !== "undefined" && typeof AudioDecoder !== "undefined",
  }) {
    this.unavailableReason = !environment.secure ? "insecure-context" : !environment.webCodecs ? "codec-unsupported" : null;
  }

  listen<K extends keyof HuddleHostEvents>(event: K, handler: (payload: HuddleHostEvents[K]) => void): () => void {
    const set = this.listeners.get(event) ?? new Set<Listener<keyof HuddleHostEvents>>();
    set.add(handler as Listener<keyof HuddleHostEvents>);
    this.listeners.set(event, set);
    return () => { set.delete(handler as Listener<keyof HuddleHostEvents>); };
  }

  private emit<K extends keyof HuddleHostEvents>(event: K, payload: HuddleHostEvents[K]) {
    for (const handler of this.listeners.get(event) ?? []) (handler as Listener<K>)(payload);
  }

  private setState(next: Partial<HuddleBackendState>) {
    this.state = { ...this.state, ...next };
    this.emit("huddle-state-changed", this.state);
  }

  async getHuddleState(): Promise<HuddleBackendState> {
    return this.state;
  }

  private assertAvailable() {
    if (this.unavailableReason === "insecure-context") throw new Error("huddle requires a secure context");
    if (this.unavailableReason === "codec-unsupported") throw new Error("huddle audio codec unsupported");
  }

  private assertIdle(action: "start" | "join") {
    if (this.state.phase !== "idle") throw new Error(`cannot ${action} huddle: already in phase ${this.state.phase}`);
  }

  /** Submit one governed huddle.* command; an UNKNOWN outcome is settled by replaying its key. */
  private async submit(command: Parameters<BffClient["submitAction"]>[0]): Promise<ActionSubmission> {
    let submission = await this.client.submitAction(command);
    for (let attempt = 0; submission.dispatchState === ActionDispatchState.Unknown && attempt < SETTLE_ATTEMPTS; attempt += 1) {
      await delay(SETTLE_DELAY_MS);
      submission = await this.client.submitAction(command);
    }
    if (submission.dispatchState !== ActionDispatchState.Dispatched) {
      throw new Error(submission.reason ?? "huddle action did not settle");
    }
    return submission;
  }

  private async voiceAvailability() {
    try {
      const voice = await this.client.huddleVoice();
      return {
        transcriptionAvailable: voice.transcription === HuddleVoiceAvailability.Available,
        speechAvailable: voice.speech === HuddleVoiceAvailability.Available,
      };
    } catch {
      return { transcriptionAvailable: false, speechAvailable: false };
    }
  }

  private openSession(huddleId: string): HuddleAudioSession {
    const session = new HuddleAudioSession(huddleId, {
      onRoster: (peers, self) => this.setState({ participants: peers.map((peer) => peer.pubkey), selfPubkey: self }),
      onActiveSpeakers: (pubkeys) => this.emit("huddle-active-speakers", pubkeys),
      onSpeakerLevels: (levels) => this.emit("huddle-speaker-levels", levels),
      onDisconnected: () => this.emit("huddle-audio-disconnected", null),
      onPtt: (active) => this.emit("ptt-state", active),
    });
    if (this.outputDevice) void session.setOutputDevice(this.outputDevice);
    this.session = session;
    return session;
  }

  private async connect(view: HuddleView, parent: HuddleParent, isCreator: boolean): Promise<HuddleJoinInfo> {
    if (!(await opusSupported())) throw new Error("huddle audio codec unsupported");
    const voice = await this.voiceAvailability();
    this.setState({
      phase: "connecting", huddleId: view.huddleId, ephemeralChannelId: view.channelId, parent, isCreator,
      agentInstallationIds: view.agentInstallationResourceIds, participants: [], ...voice,
    });
    const session = this.openSession(view.huddleId);
    try {
      await session.join();
    } catch (error) {
      session.close(false);
      this.session = null;
      this.setState({ ...IDLE_HUDDLE_STATE });
      throw error;
    }
    this.setState({ phase: "connected" });
    return { huddleId: view.huddleId, ephemeralChannelId: view.channelId };
  }

  async startHuddle(parent: HuddleParent, agentInstallationIds: readonly string[], channelName: string): Promise<HuddleJoinInfo> {
    this.assertAvailable();
    this.assertIdle("start");
    this.setState({ ...IDLE_HUDDLE_STATE, phase: "creating", parent });
    let created: string | null = null;
    try {
      // Nothing is created for a browser that cannot carry the audio.
      if (!(await opusSupported())) throw new Error("huddle audio codec unsupported");
      const submission = await this.submit({
        actionKey: "huddle.start",
        idempotencyKey: newIdempotencyKey(),
        ...(parent.kind === "workspace" ? { workspaceId: parent.workspaceId } : {}),
        huddleStart: {
          ...(parent.kind === "workspace" ? { parentWorkspaceId: parent.workspaceId } : { parentConversationId: parent.conversationId }),
          agentInstallationResourceIds: [...agentInstallationIds],
          channelName,
        },
      });
      const huddleId = submission.huddleId;
      if (!huddleId) throw new Error("huddle.start answered without a huddle");
      created = huddleId;
      const view = await this.client.huddle(huddleId);
      if (view.state !== HuddleState.Active) throw new Error("huddle projection is not active");
      await this.announce(view);
      return await this.connect(view, parent, true);
    } catch (error) {
      // Original start rollback: a created Huddle this client could not announce or join is
      // ended, never left behind without its creator.
      if (created) await this.endBinding(created, parent).catch(() => undefined);
      if (this.state.phase === "creating" || this.state.phase === "connecting") this.setState({ ...IDLE_HUDDLE_STATE });
      throw error;
    }
  }

  /** The creator's 48106/48100, signed once by the BFF and re-sent until delivered. */
  private async announce(view: HuddleView) {
    for (let attempt = 0; attempt <= SETTLE_ATTEMPTS; attempt += 1) {
      const announcement = await this.client.huddleAnnounce(view.huddleId);
      if (announcement.startedDelivered) return;
      await delay(SETTLE_DELAY_MS);
    }
    throw new Error("huddle start announcement did not settle");
  }

  async joinHuddle(parent: HuddleParent, ephemeralChannelId: string, huddleId: string): Promise<HuddleJoinInfo> {
    this.assertAvailable();
    this.assertIdle("join");
    const view = await this.client.huddle(huddleId);
    if (view.channelId !== ephemeralChannelId || view.state !== HuddleState.Active) throw new Error("huddle has ended");
    return this.connect(view, parent, false);
  }

  async confirmHuddleActive(): Promise<void> {
    if (this.state.phase === "connected") this.setState({ phase: "active" });
  }

  async setupAudioWorklet(track: MediaStreamTrack, mode: VoiceInputMode, manuallyUnmuted: boolean): Promise<AudioWorkletHandle> {
    const session = this.session;
    if (!session) throw new Error("huddle audio is not connected");
    return session.attachMicrophone(track, mode, manuallyUnmuted);
  }

  async setManualMicUnmuted(_enabled: boolean): Promise<void> {
    // The capture worklet handle owns transmission (setTransmitting); there is no native
    // transcription gate in voice-only mode.
  }

  async getVoiceInputMode(): Promise<VoiceInputMode> {
    return this.mode;
  }

  async setVoiceInputMode(mode: VoiceInputMode): Promise<void> {
    this.mode = mode;
  }

  /** Original leave: 9022 while other humans remain, then close; the last human only closes. */
  async leaveHuddle(): Promise<void> {
    const { huddleId, phase } = this.state;
    if (phase === "idle" || !huddleId) return;
    this.setState({ phase: "leaving" });
    const session = this.session;
    const self = session?.self ?? null;
    // Agents hold no audio connection on this host, so every other room peer is a human.
    const otherHumans = this.state.participants.filter((pubkey) => pubkey !== self).length;
    if (otherHumans > 0) {
      // Original: a failed leave keeps the huddle alive; the next real leave cleans up.
      await this.client.huddleLeave(huddleId).catch(() => undefined);
    }
    this.teardown(true);
  }

  async endHuddle(): Promise<void> {
    const { huddleId, parent, phase } = this.state;
    if (phase === "idle" || !huddleId || !parent) return;
    this.setState({ phase: "leaving" });
    try {
      await this.endBinding(huddleId, parent);
    } finally {
      this.teardown(true);
    }
  }

  private async endBinding(huddleId: string, parent: HuddleParent) {
    await this.submit({
      actionKey: "huddle.end",
      idempotencyKey: newIdempotencyKey(),
      huddleId,
      ...(parent.kind === "workspace" ? { workspaceId: parent.workspaceId } : {}),
    });
  }

  private teardown(sendLeave: boolean) {
    this.session?.close(sendLeave);
    this.session = null;
    this.mode = "push_to_talk";
    this.setState({ ...IDLE_HUDDLE_STATE });
  }

  async reconnectHuddleAudio(): Promise<void> {
    const session = this.session;
    if (!session) throw new Error("huddle audio is not connected");
    await session.reconnect();
  }

  private async agentAction(actionKey: "huddle.agent.add" | "huddle.agent.remove", installationId: string) {
    const { huddleId, parent } = this.state;
    if (!huddleId || !parent || parent.kind !== "workspace") throw new Error("only Workspace huddles have agents");
    await this.submit({
      actionKey,
      idempotencyKey: newIdempotencyKey(),
      workspaceId: parent.workspaceId,
      huddleId,
      huddleAgent: { agentInstallationResourceId: installationId },
    });
    const view = await this.client.huddle(huddleId);
    if (this.state.huddleId === huddleId) this.setState({ agentInstallationIds: view.agentInstallationResourceIds });
  }

  addAgentToHuddle(installationId: string): Promise<void> {
    return this.agentAction("huddle.agent.add", installationId);
  }

  removeAgentFromHuddle(installationId: string): Promise<void> {
    return this.agentAction("huddle.agent.remove", installationId);
  }

  async listAudioOutputDevices(): Promise<AudioOutputDevice[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "audiooutput" && device.deviceId && device.deviceId !== "default")
      .map((device) => ({ name: device.label || device.deviceId, is_default: false }));
  }

  async getAudioOutputDevice(): Promise<string> {
    return this.outputDeviceName;
  }

  async setAudioOutputDevice(name: string): Promise<void> {
    this.outputDeviceName = name;
    this.outputDevice = "";
    if (name && navigator.mediaDevices?.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const match = devices.find((device) => device.kind === "audiooutput" && (device.label || device.deviceId) === name);
      this.outputDevice = match?.deviceId ?? "";
    }
    await this.session?.setOutputDevice(this.outputDevice);
  }
}
