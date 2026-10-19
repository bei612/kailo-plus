// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src-tauri/src/huddle/relay_api.rs (audio socket, Opus encode loop, v2 header)
// desktop/src-tauri/src/huddle/playout.rs (receive loop, roster, speaker activity ticks)
// desktop/src/features/huddle/lib/audioWorklet.ts::setupAudioWorklet (capture gating)
// DD-125(3), `09` §3, V-SCN-158/159: the Web half of the original native audio pipeline. The
// Browser holds no signer and never reaches the Relay: the socket is the same-origin BFF bridge
// (`/api/v1/huddles/{id}/audio`), which authenticates as the user's SERVER key and relays the
// original protocol-v2 frames and room control messages verbatim. Here: capture through the
// original worklet gating, WebCodecs Opus with the original parameters (48 kHz mono, VoIP,
// 32 kbps, DTX, 20 ms), the 8-byte header, per-peer WebCodecs decode into one playout mixer,
// and the original active-speaker (500 ms) and level (50 ms) ticks from sender-authored dBov.
import {
  HUDDLE_DTX_MAX_PAYLOAD,
  HUDDLE_FLAG_DTX,
  HUDDLE_FRAME_DURATION_US,
  HUDDLE_FRAME_SAMPLES,
  HUDDLE_MAX_FRAME_BYTES,
  HUDDLE_OPUS_BITRATE,
  HUDDLE_SAMPLE_RATE,
  audioLevelDbov,
  encodeUplinkFrame,
  isSpeechFrame,
  normalizedSpeakerLevel,
  parseRelayFrame,
  parseRoomControl,
  type RosterPeer,
} from "@client-kit/platform/huddle";

const SPEAKER_TICK_MS = 500;
const SPEAKER_LEVEL_TICK_MS = 50;
const SPEAKER_LEVEL_DECAY = 0.55;
const JOIN_TIMEOUT_MS = 10_000;
/** Original press/release tail of the push-to-talk shortcut (ptt_shortcut.rs). */
const PTT_RELEASE_TAIL_MS = 200;

export type AudioSessionEvents = {
  onRoster: (peers: RosterPeer[], selfPubkey: string | null) => void;
  onActiveSpeakers: (pubkeys: string[]) => void;
  onSpeakerLevels: (levels: Record<string, number>) => void;
  /** The bridge closed without an intentional leave (original `huddle-audio-disconnected`). */
  onDisconnected: () => void;
  onPtt: (active: boolean) => void;
};

/** The original Opus encoder settings; `opus` is the WebCodecs Opus extension. */
export const OPUS_ENCODER_CONFIG = {
  codec: "opus",
  sampleRate: HUDDLE_SAMPLE_RATE,
  numberOfChannels: 1,
  bitrate: HUDDLE_OPUS_BITRATE,
  opus: { format: "opus", frameDuration: HUDDLE_FRAME_DURATION_US, application: "voip", usedtx: true, useinbandfec: false },
} as const;

export const OPUS_DECODER_CONFIG = { codec: "opus", sampleRate: HUDDLE_SAMPLE_RATE, numberOfChannels: 1 } as const;

/** Whether this browser can run the original Opus path at all. */
export async function opusSupported(): Promise<boolean> {
  if (typeof AudioEncoder === "undefined" || typeof AudioDecoder === "undefined") return false;
  try {
    const [encoder, decoder] = await Promise.all([
      AudioEncoder.isConfigSupported(OPUS_ENCODER_CONFIG as unknown as AudioEncoderConfig),
      AudioDecoder.isConfigSupported(OPUS_DECODER_CONFIG),
    ]);
    return Boolean(encoder.supported && decoder.supported);
  } catch {
    return false;
  }
}

export function bridgeUrl(huddleId: string, location: Pick<Location, "protocol" | "host"> = window.location): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/api/v1/huddles/${encodeURIComponent(huddleId)}/audio`;
}

/** Per-peer speaker state of the original playout ticks. */
export class SpeakerActivity {
  private readonly lastSpeech = new Map<string, number>();
  private readonly levels = new Map<string, number>();

  frame(pubkey: string, isSpeech: boolean, level: number, now: number) {
    if (isSpeech) this.lastSpeech.set(pubkey, now);
    this.levels.set(pubkey, Math.max(this.levels.get(pubkey) ?? 0, level));
  }

  /** Original 500 ms tick: peers with a speech frame inside the window. */
  activeSpeakers(now: number): string[] {
    const active: string[] = [];
    for (const [pubkey, at] of this.lastSpeech) {
      if (now - at <= SPEAKER_TICK_MS) active.push(pubkey);
      else this.lastSpeech.delete(pubkey);
    }
    return active;
  }

  /** Original 50 ms tick: peak-held levels decayed by 0.55 each tick. */
  tickLevels(): Record<string, number> {
    const snapshot: Record<string, number> = {};
    for (const [pubkey, level] of this.levels) {
      snapshot[pubkey] = level;
      const next = level * SPEAKER_LEVEL_DECAY;
      if (next < 0.01) this.levels.delete(pubkey);
      else this.levels.set(pubkey, next);
    }
    return snapshot;
  }

  forget(pubkey: string) {
    this.lastSpeech.delete(pubkey);
    this.levels.delete(pubkey);
  }

  clear() {
    this.lastSpeech.clear();
    this.levels.clear();
  }
}

type PeerDecoder = { pubkey: string; epoch: number; decoder: AudioDecoder; timestamp: number };

/**
 * One connection to the BFF audio bridge plus the in-page media graph. `join` resolves once the
 * Relay admits this peer (`joined` with our own key); a relay `error` rejects with its code or
 * message so the original error formatting applies.
 */
export class HuddleAudioSession {
  private socket: WebSocket | null = null;
  private context: AudioContext | null = null;
  private playout: AudioWorkletNode | null = null;
  private capture: { source: MediaStreamAudioSourceNode; gain: GainNode; node: AudioWorkletNode } | null = null;
  private encoder: AudioEncoder | null = null;
  private readonly peers = new Map<number, PeerDecoder>();
  private readonly roster = new Map<number, RosterPeer>();
  private readonly speakers = new SpeakerActivity();
  private selfPubkey: string | null = null;
  private seq = 0;
  private ts48k = 0;
  private captureTimestamp = 0;
  private pendingLevels: number[] = [];
  private closing = false;
  private timers: number[] = [];
  private outputDeviceId = "";
  private mode: "push_to_talk" | "voice_activity" = "push_to_talk";
  private manuallyUnmuted = false;
  private pttActive = false;
  private pttReleaseTimer: number | null = null;
  private readonly keyHandlers: { down: (event: KeyboardEvent) => void; up: (event: KeyboardEvent) => void; blur: () => void };

  constructor(private readonly huddleId: string, private readonly events: AudioSessionEvents) {
    this.keyHandlers = {
      down: (event) => this.onPttKey(event, true),
      up: (event) => this.onPttKey(event, false),
      blur: () => this.resetPtt(),
    };
  }

  get self(): string | null {
    return this.selfPubkey;
  }

  rosterPubkeys(): string[] {
    return [...this.roster.values()].map((peer) => peer.pubkey);
  }

  private async ensureContext(): Promise<AudioContext> {
    if (this.context) return this.context;
    const context = new AudioContext({ sampleRate: HUDDLE_SAMPLE_RATE });
    if (context.state === "suspended") await context.resume();
    const base = import.meta.env.BASE_URL;
    await context.audioWorklet.addModule(`${base}huddle-capture-worklet.js`);
    await context.audioWorklet.addModule(`${base}huddle-playout-worklet.js`);
    const playout = new AudioWorkletNode(context, "huddle-playout-processor", { numberOfInputs: 0, outputChannelCount: [1] });
    playout.connect(context.destination);
    this.context = context;
    this.playout = playout;
    if (this.outputDeviceId) await this.applyOutputDevice();
    return context;
  }

  /** Open the bridge and wait for the Relay's `joined` for this peer. */
  async join(): Promise<void> {
    await this.ensureContext();
    this.closing = false;
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(bridgeUrl(this.huddleId));
      socket.binaryType = "arraybuffer";
      this.socket = socket;
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("huddle audio join timed out"));
        socket.close();
      }, JOIN_TIMEOUT_MS);
      socket.onmessage = (event) => {
        if (typeof event.data === "string") {
          const control = parseRoomControl(event.data);
          if (!control) return;
          if (control.type === "error") {
            if (!settled) {
              settled = true;
              window.clearTimeout(timeout);
              reject(new Error(control.code ?? control.message ?? "huddle audio error"));
            }
            return;
          }
          const joinedSelf = control.type === "joined" && this.selfPubkey === null;
          this.applyControl(control);
          if (joinedSelf && !settled) {
            settled = true;
            window.clearTimeout(timeout);
            resolve();
          }
          return;
        }
        if (event.data instanceof ArrayBuffer) this.receive(new Uint8Array(event.data));
      };
      socket.onerror = () => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          reject(new Error("huddle audio connection failed"));
        }
      };
      socket.onclose = () => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          reject(new Error("huddle audio connection closed"));
          return;
        }
        if (!this.closing && this.socket === socket) this.events.onDisconnected();
      };
    });
    this.startTicks();
    window.addEventListener("keydown", this.keyHandlers.down, true);
    window.addEventListener("keyup", this.keyHandlers.up, true);
    window.addEventListener("blur", this.keyHandlers.blur);
  }

  /** Original `reconnect_huddle_audio`: re-dial only the socket; seq/ts restart at 0. */
  async reconnect(): Promise<void> {
    this.socket?.close();
    this.socket = null;
    this.selfPubkey = null;
    this.resetPeers();
    this.seq = 0;
    this.ts48k = 0;
    this.stopTicks();
    window.removeEventListener("keydown", this.keyHandlers.down, true);
    window.removeEventListener("keyup", this.keyHandlers.up, true);
    window.removeEventListener("blur", this.keyHandlers.blur);
    await this.join();
  }

  private applyControl(control: Exclude<ReturnType<typeof parseRoomControl>, null>) {
    switch (control.type) {
      case "joined":
        if (this.selfPubkey === null) this.selfPubkey = control.pubkey;
        this.replaceRoster(control.peers.length > 0 ? control.peers : [{ pubkey: control.pubkey, peerIndex: control.peerIndex, epoch: 0 }]);
        break;
      case "roster":
        this.replaceRoster(control.peers);
        break;
      case "left": {
        const peer = this.roster.get(control.peerIndex);
        if (peer && peer.pubkey === control.pubkey) {
          this.roster.delete(control.peerIndex);
          this.dropPeer(control.peerIndex);
          this.speakers.forget(control.pubkey);
        }
        break;
      }
      default:
        break;
    }
    this.events.onRoster([...this.roster.values()], this.selfPubkey);
  }

  private replaceRoster(peers: RosterPeer[]) {
    const next = new Map(peers.map((peer) => [peer.peerIndex, peer] as const));
    for (const [index, existing] of this.roster) {
      const replacement = next.get(index);
      // An index reassigned to another occupant resets its decoder and playout state.
      if (!replacement || replacement.pubkey !== existing.pubkey || replacement.epoch !== existing.epoch) this.dropPeer(index);
    }
    this.roster.clear();
    for (const [index, peer] of next) this.roster.set(index, peer);
  }

  private dropPeer(index: number) {
    const peer = this.peers.get(index);
    if (peer) {
      try {
        peer.decoder.close();
      } catch {
        /* already closed */
      }
      this.peers.delete(index);
    }
    this.playout?.port.postMessage({ type: "remove", peer: index });
  }

  private resetPeers() {
    for (const index of [...this.peers.keys()]) this.dropPeer(index);
    this.roster.clear();
    this.speakers.clear();
    this.playout?.port.postMessage({ type: "clear" });
  }

  /** Original playout receive path: drop frames from indices not in the roster. */
  private receive(bytes: Uint8Array) {
    const frame = parseRelayFrame(bytes);
    if (!frame) return;
    const peer = this.roster.get(frame.peerIndex);
    if (!peer || peer.pubkey === this.selfPubkey) return;
    const now = performance.now();
    this.speakers.frame(peer.pubkey, isSpeechFrame(frame.header), normalizedSpeakerLevel(frame.header.levelDbov), now);
    let decoder = this.peers.get(frame.peerIndex);
    if (!decoder || decoder.pubkey !== peer.pubkey || decoder.epoch !== peer.epoch) {
      if (decoder) this.dropPeer(frame.peerIndex);
      decoder = this.createDecoder(frame.peerIndex, peer);
      if (!decoder) return;
    }
    try {
      decoder.decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: decoder.timestamp, data: frame.opus }));
      decoder.timestamp += HUDDLE_FRAME_DURATION_US;
    } catch {
      this.dropPeer(frame.peerIndex);
    }
  }

  private createDecoder(index: number, peer: RosterPeer): PeerDecoder | null {
    const playout = this.playout;
    if (!playout) return null;
    const decoder = new AudioDecoder({
      output: (data) => {
        try {
          const samples = new Float32Array(data.numberOfFrames);
          data.copyTo(samples, { planeIndex: 0, format: "f32-planar" });
          playout.port.postMessage({ type: "pcm", peer: index, samples }, [samples.buffer]);
        } finally {
          data.close();
        }
      },
      error: () => this.dropPeer(index),
    });
    decoder.configure(OPUS_DECODER_CONFIG);
    const entry = { pubkey: peer.pubkey, epoch: peer.epoch, decoder, timestamp: 0 };
    this.peers.set(index, entry);
    return entry;
  }

  /** Original `setupAudioWorklet`: mic → gain → capture worklet → Opus → bridge. */
  async attachMicrophone(track: MediaStreamTrack, mode: "push_to_talk" | "voice_activity", manuallyUnmuted: boolean) {
    const context = await this.ensureContext();
    this.detachMicrophone();
    this.mode = mode;
    this.manuallyUnmuted = manuallyUnmuted;
    const source = context.createMediaStreamSource(new MediaStream([track]));
    const gain = context.createGain();
    const node = new AudioWorkletNode(context, "huddle-capture-processor");
    source.connect(gain);
    gain.connect(node);
    const encoder = new AudioEncoder({
      output: (chunk) => this.sendChunk(chunk),
      error: (error) => console.error("[huddle] Opus encoder error:", error),
    });
    encoder.configure(OPUS_ENCODER_CONFIG as unknown as AudioEncoderConfig);
    node.port.onmessage = (event: MessageEvent<Float32Array>) => this.encode(event.data);
    this.capture = { source, gain, node };
    this.encoder = encoder;
    this.syncTransmission();
    return {
      stop: () => this.detachMicrophone(),
      setTransmitting: (active: boolean) => {
        this.manuallyUnmuted = active;
        this.syncTransmission();
      },
      setMode: (next: "push_to_talk" | "voice_activity") => {
        this.mode = next;
        this.pttActive = false;
        this.syncTransmission();
      },
      setGain: (value: number) => {
        gain.gain.value = value;
      },
    };
  }

  private detachMicrophone() {
    const capture = this.capture;
    this.capture = null;
    if (capture) {
      capture.node.port.onmessage = null;
      capture.source.disconnect();
      capture.gain.disconnect();
      capture.node.disconnect();
    }
    const encoder = this.encoder;
    this.encoder = null;
    if (encoder && encoder.state !== "closed") encoder.close();
    this.pendingLevels = [];
  }

  private syncTransmission() {
    this.capture?.node.port.postMessage({ type: "ptt", active: this.manuallyUnmuted || (this.mode === "push_to_talk" && this.pttActive) });
  }

  private encode(samples: Float32Array) {
    const encoder = this.encoder;
    if (!encoder || encoder.state !== "configured") return;
    // dBov is computed from the pre-encode PCM; a DTX packet's payload says nothing about level.
    this.pendingLevels.push(audioLevelDbov(samples));
    const frame = new AudioData({
      format: "f32-planar",
      sampleRate: HUDDLE_SAMPLE_RATE,
      numberOfFrames: HUDDLE_FRAME_SAMPLES,
      numberOfChannels: 1,
      timestamp: this.captureTimestamp,
      data: samples,
    });
    this.captureTimestamp += HUDDLE_FRAME_DURATION_US;
    try {
      encoder.encode(frame);
    } finally {
      frame.close();
    }
  }

  private sendChunk(chunk: EncodedAudioChunk) {
    const level = this.pendingLevels.shift() ?? -127;
    const opus = new Uint8Array(chunk.byteLength);
    chunk.copyTo(opus);
    const flags = opus.byteLength <= HUDDLE_DTX_MAX_PAYLOAD ? HUDDLE_FLAG_DTX : 0;
    const frame = encodeUplinkFrame({ seq: this.seq, ts48k: this.ts48k, levelDbov: level, flags }, opus);
    this.seq = (this.seq + 1) & 0xffff;
    this.ts48k = (this.ts48k + HUDDLE_FRAME_SAMPLES) >>> 0;
    if (frame.byteLength > HUDDLE_MAX_FRAME_BYTES) return;
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(frame.buffer);
  }

  /** In-page push-to-talk: Ctrl+Space held while the page has focus (Web has no global shortcut). */
  private onPttKey(event: KeyboardEvent, down: boolean) {
    if (!down) {
      // Releasing either key of the chord ends the hold (original press/release pair).
      const chordKey = event.code === "Space" || event.key === "Control";
      if (chordKey && this.pttActive) {
        event.preventDefault();
        this.setPtt(false);
      }
      return;
    }
    // Ctrl+Space only: Ctrl+Shift+Space is the original huddle toggle.
    if (event.code !== "Space" || !event.ctrlKey || event.shiftKey || event.metaKey || event.altKey) return;
    if (this.mode !== "push_to_talk") return;
    event.preventDefault();
    if (event.repeat) return;
    this.setPtt(true);
  }

  private resetPtt() {
    if (this.pttReleaseTimer !== null) window.clearTimeout(this.pttReleaseTimer);
    this.pttReleaseTimer = null;
    if (this.pttActive) {
      this.pttActive = false;
      this.events.onPtt(false);
    }
  }

  private setPtt(active: boolean) {
    if (this.pttReleaseTimer !== null) {
      window.clearTimeout(this.pttReleaseTimer);
      this.pttReleaseTimer = null;
    }
    if (active) {
      if (this.pttActive) return;
      this.pttActive = true;
      this.syncTransmission();
      this.events.onPtt(true);
      return;
    }
    if (!this.pttActive) return;
    this.pttReleaseTimer = window.setTimeout(() => {
      this.pttReleaseTimer = null;
      this.pttActive = false;
      this.syncTransmission();
      this.events.onPtt(false);
    }, PTT_RELEASE_TAIL_MS);
  }

  private startTicks() {
    this.stopTicks();
    this.timers.push(window.setInterval(() => this.events.onActiveSpeakers(this.speakers.activeSpeakers(performance.now())), SPEAKER_TICK_MS));
    this.timers.push(window.setInterval(() => this.events.onSpeakerLevels(this.speakers.tickLevels()), SPEAKER_LEVEL_TICK_MS));
  }

  private stopTicks() {
    for (const timer of this.timers) window.clearInterval(timer);
    this.timers = [];
  }

  async setOutputDevice(deviceId: string) {
    this.outputDeviceId = deviceId;
    await this.applyOutputDevice();
  }

  private async applyOutputDevice() {
    const context = this.context as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!context?.setSinkId) return;
    try {
      await context.setSinkId(this.outputDeviceId);
    } catch {
      /* best-effort, like the original device switch */
    }
  }

  /** Intentional leave: send the original `leave`, close the bridge and the media graph. */
  close(sendLeave: boolean) {
    this.closing = true;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState === WebSocket.OPEN && sendLeave) socket.send(JSON.stringify({ type: "leave" }));
    socket?.close();
    this.stopTicks();
    this.detachMicrophone();
    this.resetPeers();
    this.resetPtt();
    window.removeEventListener("keydown", this.keyHandlers.down, true);
    window.removeEventListener("keyup", this.keyHandlers.up, true);
    window.removeEventListener("blur", this.keyHandlers.blur);
    this.playout?.disconnect();
    this.playout = null;
    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed") void context.close();
  }
}
