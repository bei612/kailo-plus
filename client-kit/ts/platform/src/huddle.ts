// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/huddle/lib/huddleCardState.ts::isHuddleStartStale
// desktop/src/features/huddle/lib/huddleError.ts::formatHuddleActionError
// desktop/src/features/huddle/lib/huddleChannelName.ts::buildHuddleChannelName
// desktop/src/features/huddle/components/HuddleIndicator.tsx::reconstruct
// desktop/src/features/huddle/components/HuddleAttachment.tsx::reconstructHuddleLifecycle
// desktop/src-tauri/src/huddle/wire.rs::{FrameHeader,parse_relay_frame,audio_level_dbov}
// desktop/src-tauri/src/huddle/relay_api.rs (20 ms Opus frames, DTX when <= 2 bytes)
// desktop/src-tauri/src/huddle/playout.rs::{normalized_speaker_level,is_remote_speech_frame}
// DD-125(3): the pure, host-independent half of the original Huddle. Lifecycle events come
// from the BFF already signature-checked (48100 creator, 48101/48102 Relay, 48103 creator or
// Relay); the wire helpers are the original protocol-v2 framing that Web and Desktop share in
// the same Relay room.

import type { HuddleLifecycleEvent } from "@client-kit/contracts";

export const KIND_HUDDLE_REACTION = 24810;
export const KIND_HUDDLE_STARTED = 48100;
export const KIND_HUDDLE_PARTICIPANT_JOINED = 48101;
export const KIND_HUDDLE_PARTICIPANT_LEFT = 48102;
export const KIND_HUDDLE_ENDED = 48103;

/** Original ephemeral channel TTL: an unconfirmed start older than this is shown as ended. */
export const HUDDLE_JOINABLE_WINDOW_SECONDS = 60 * 60;

export function isHuddleStartStale(createdAtSeconds: number, nowMs = Date.now()) {
  return nowMs / 1000 - createdAtSeconds > HUDDLE_JOINABLE_WINDOW_SECONDS;
}

/** The original 48100 card content: `{"ephemeral_channel_id": "<uuid>"}`. */
export function parseEphemeralChannelId(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { ephemeral_channel_id?: unknown };
    return typeof parsed.ephemeral_channel_id === "string" ? parsed.ephemeral_channel_id : null;
  } catch {
    return null;
  }
}

function causalOrder(left: HuddleLifecycleEvent, right: HuddleLifecycleEvent) {
  return left.createdAt - right.createdAt || left.kind - right.kind || left.eventId.localeCompare(right.eventId);
}

/** Original HuddleIndicator state: the newest live session of one parent channel. */
export type ActiveHuddle = {
  ephemeralChannelId: string;
  huddleThreadEventId: string | null;
  participants: Set<string>;
};

/**
 * Original `HuddleIndicator.reconstruct`: sort by created_at, then kind (start < join < left <
 * end), then event id; a join/left without a start still infers the session, and an ended
 * session is never resurrected by a late relay join/left.
 */
export function reconstructActiveHuddle(events: Iterable<HuddleLifecycleEvent>): ActiveHuddle | null {
  const sorted = [...events].sort(causalOrder);
  let huddle: ActiveHuddle | null = null;
  const endedChannels = new Set<string>();
  for (const event of sorted) {
    const ephemeralChannelId = event.ephemeralChannelId;
    switch (event.kind) {
      case KIND_HUDDLE_STARTED:
        endedChannels.delete(ephemeralChannelId);
        huddle = { ephemeralChannelId, huddleThreadEventId: event.eventId, participants: new Set([event.pubkey]) };
        break;
      case KIND_HUDDLE_PARTICIPANT_JOINED:
      case KIND_HUDDLE_PARTICIPANT_LEFT: {
        if (endedChannels.has(ephemeralChannelId)) break;
        const participant = event.participantPubkey ?? event.pubkey;
        if (!huddle || huddle.ephemeralChannelId !== ephemeralChannelId) {
          huddle = { ephemeralChannelId, huddleThreadEventId: null, participants: new Set() };
        }
        if (event.kind === KIND_HUDDLE_PARTICIPANT_JOINED) huddle.participants.add(participant);
        else huddle.participants.delete(participant);
        break;
      }
      case KIND_HUDDLE_ENDED:
        endedChannels.add(ephemeralChannelId);
        if (huddle?.ephemeralChannelId === ephemeralChannelId) huddle = null;
        break;
      default:
        break;
    }
  }
  return huddle;
}

/** Original HuddleAttachment card state of one session. */
export type HuddleLifecycleState = { ended: boolean; participants: Set<string> };

/** Original `reconstructHuddleLifecycle` for the 48100 card of `ephemeralChannelId`. */
export function reconstructHuddleLifecycle(
  events: Iterable<HuddleLifecycleEvent>,
  fallbackCreatorPubkey: string | undefined,
  ephemeralChannelId: string,
): HuddleLifecycleState {
  const sorted = [...events].filter((event) => event.ephemeralChannelId === ephemeralChannelId).sort(causalOrder);
  const participants = new Set<string>();
  let ended = false;
  if (fallbackCreatorPubkey) participants.add(fallbackCreatorPubkey);
  for (const event of sorted) {
    switch (event.kind) {
      case KIND_HUDDLE_STARTED:
        ended = false;
        participants.add(event.pubkey);
        break;
      case KIND_HUDDLE_PARTICIPANT_JOINED:
        if (!ended) participants.add(event.participantPubkey ?? event.pubkey);
        break;
      case KIND_HUDDLE_PARTICIPANT_LEFT:
        if (!ended) participants.delete(event.participantPubkey ?? event.pubkey);
        break;
      case KIND_HUDDLE_ENDED:
        ended = true;
        break;
      default:
        break;
    }
  }
  return { ended, participants };
}

/**
 * Original roster of the live room from the parent channel lifecycle: who joined and has not
 * left since the newest start of `ephemeralChannelId`. Relay-signed 48101/48102 carry the
 * participant in `p`.
 */
export function liveParticipants(events: Iterable<HuddleLifecycleEvent>, ephemeralChannelId: string): string[] {
  const state = reconstructHuddleLifecycle(events, undefined, ephemeralChannelId);
  return state.ended ? [] : [...state.participants];
}

export type HuddleAction = "join" | "start";

/** Original `formatHuddleActionError`, returning a catalog key for the two fixed texts. */
export function huddleActionErrorKey(
  error: unknown,
  action: HuddleAction,
): { key: "huddle.error.audioUnavailable" | "huddle.error.join" | "huddle.error.start" } | { message: string } {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : null;
  const message = raw?.trim();
  const normalized = message?.toLowerCase();
  if (normalized?.includes("huddle_audio_unavailable") || normalized?.includes("huddle audio unavailable in this deployment")) {
    return { key: "huddle.error.audioUnavailable" };
  }
  if (message) return { message };
  return { key: action === "join" ? "huddle.error.join" : "huddle.error.start" };
}

function firstName(label: string): string {
  return label.trim().split(/\s+/)[0] ?? "";
}

/**
 * Original `buildHuddleChannelName`: "<channel> huddle" for a channel, and the participants'
 * first names joined by " <> " (self first) for a direct message.
 */
export function buildHuddleChannelName(input:
  | { kind: "channel"; channelName: string }
  | { kind: "dm"; selfLabel?: string; participantLabels: readonly string[] }): string {
  if (input.kind === "channel") {
    const channelName = input.channelName.trim();
    return channelName ? `${channelName} huddle` : "huddle";
  }
  const names = [...(input.selfLabel ? [input.selfLabel] : []), ...input.participantLabels]
    .map(firstName)
    .filter(Boolean);
  return names.length === 0 ? "huddle" : `${names.join(" <> ")} huddle`;
}

// ---------------------------------------------------------------------------
// Protocol v2 framing (original desktop/src-tauri/src/huddle/wire.rs)
// ---------------------------------------------------------------------------

export const HUDDLE_PROTOCOL_VERSION = 2;
export const HUDDLE_SAMPLE_RATE = 48_000;
/** 20 ms at 48 kHz: one Opus frame and one original worklet batch. */
export const HUDDLE_FRAME_SAMPLES = 960;
export const HUDDLE_FRAME_DURATION_US = 20_000;
export const HUDDLE_HEADER_BYTES = 8;
/** Original relay `MAX_AUDIO_FRAME_BYTES`: larger client frames are dropped. */
export const HUDDLE_MAX_FRAME_BYTES = 4096;
export const HUDDLE_FLAG_DTX = 0x01;
/** Original `relay_api.rs`: an encoded packet of at most 2 bytes is a DTX/comfort packet. */
export const HUDDLE_DTX_MAX_PAYLOAD = 2;
/** Original playout `REMOTE_SPEECH_LEVEL_DBOV`. */
export const HUDDLE_SPEECH_LEVEL_DBOV = -55;
/** Original Opus encoder settings (VoIP, 32 kbps, DTX on, no in-band FEC). */
export const HUDDLE_OPUS_BITRATE = 32_000;

export type FrameHeader = { seq: number; ts48k: number; levelDbov: number; flags: number };

/** Original `FrameHeader::encode` followed by the Opus payload. */
export function encodeUplinkFrame(header: FrameHeader, opus: Uint8Array): Uint8Array {
  const frame = new Uint8Array(HUDDLE_HEADER_BYTES + opus.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint16(0, header.seq & 0xffff);
  view.setUint32(2, header.ts48k >>> 0);
  view.setInt8(6, Math.max(-127, Math.min(0, Math.round(header.levelDbov))));
  view.setUint8(7, header.flags & 0xff);
  frame.set(opus, HUDDLE_HEADER_BYTES);
  return frame;
}

/** Original `FrameHeader::parse`: out-of-range levels are coerced to -127, never dropped. */
export function parseFrameHeader(bytes: Uint8Array): FrameHeader | null {
  if (bytes.byteLength < HUDDLE_HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const raw = view.getInt8(6);
  return {
    seq: view.getUint16(0),
    ts48k: view.getUint32(2),
    levelDbov: raw >= -127 && raw <= 0 ? raw : -127,
    flags: view.getUint8(7),
  };
}

/** Original `parse_relay_frame` for v2: `[peer_index][header][opus]`, non-empty Opus. */
export function parseRelayFrame(bytes: Uint8Array): { peerIndex: number; header: FrameHeader; opus: Uint8Array } | null {
  if (bytes.byteLength < 1) return null;
  const peerIndex = bytes[0] ?? 0;
  const framed = bytes.subarray(1);
  const header = parseFrameHeader(framed);
  if (!header) return null;
  const opus = framed.subarray(HUDDLE_HEADER_BYTES);
  return opus.byteLength === 0 ? null : { peerIndex, header, opus };
}

export function isDtx(header: FrameHeader) {
  return (header.flags & HUDDLE_FLAG_DTX) !== 0;
}

/** Original `audio_level_dbov`: RMS in dB relative to full scale, clamped into [-127, 0]. */
export function audioLevelDbov(samples: Float32Array): number {
  if (samples.length === 0) return -127;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index] ?? 0;
    sum += value * value;
  }
  const meanSquare = sum / samples.length;
  if (meanSquare <= 0) return -127;
  const db = 20 * Math.log10(Math.sqrt(meanSquare));
  if (!Number.isFinite(db) || db <= -127) return -127;
  if (db >= 0) return 0;
  return Math.round(db);
}

/** Original `is_remote_speech_frame`: room tone may be non-DTX, so the level gates speech. */
export function isSpeechFrame(header: FrameHeader) {
  return !isDtx(header) && header.levelDbov >= HUDDLE_SPEECH_LEVEL_DBOV;
}

/** Original `normalized_speaker_level`: conversational speech between ~-60 and ~-12 dBov. */
export function normalizedSpeakerLevel(levelDbov: number) {
  return Math.min(1, Math.max(0, (levelDbov + 60) / 48));
}

// ---------------------------------------------------------------------------
// Relay room control messages (original audio/handler.rs JSON frames)
// ---------------------------------------------------------------------------

export type RosterPeer = { pubkey: string; peerIndex: number; epoch: number };

export type RoomControl =
  | { type: "joined"; pubkey: string; peerIndex: number; peers: RosterPeer[] }
  | { type: "roster"; peers: RosterPeer[] }
  | { type: "left"; pubkey: string; peerIndex: number }
  | { type: "error"; code: string | null; message: string | null };

function rosterPeers(value: unknown): RosterPeer[] {
  if (!Array.isArray(value)) return [];
  const peers: RosterPeer[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const peer = entry as { pubkey?: unknown; peer_index?: unknown; epoch?: unknown };
    if (typeof peer.pubkey === "string" && typeof peer.peer_index === "number") {
      peers.push({ pubkey: peer.pubkey, peerIndex: peer.peer_index, epoch: typeof peer.epoch === "number" ? peer.epoch : 0 });
    }
  }
  return peers;
}

/** Parse one relay text frame; unknown shapes are ignored like the original playout loop. */
export function parseRoomControl(text: string): RoomControl | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case "joined":
      return typeof message.pubkey === "string" && typeof message.peer_index === "number"
        ? { type: "joined", pubkey: message.pubkey, peerIndex: message.peer_index, peers: rosterPeers(message.peers) }
        : null;
    case "roster":
      return { type: "roster", peers: rosterPeers(message.peers) };
    case "left":
      return typeof message.pubkey === "string" && typeof message.peer_index === "number"
        ? { type: "left", pubkey: message.pubkey, peerIndex: message.peer_index }
        : null;
    case "error":
      return {
        type: "error",
        code: typeof message.code === "string" ? message.code : null,
        message: typeof message.message === "string" ? message.message : null,
      };
    default:
      return null;
  }
}
