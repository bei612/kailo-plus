// @vitest-environment jsdom
// DD-125(3) (V-SCN-131..134, V-SCN-158..161): Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/huddle/{components/HuddleIndicator.tsx,components/HuddleAttachment.tsx,
// lib/huddleCardState.ts,lib/huddleError.ts,lib/huddleChannelName.ts} and
// desktop/src-tauri/src/huddle/{wire.rs,playout.rs}, over the BFF Huddle reads.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HuddleState, type HuddleLifecycleEvent, type HuddleView } from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { setLocale } from "../src/i18n";
import {
  audioLevelDbov, buildHuddleChannelName, encodeUplinkFrame, huddleActionErrorKey, isHuddleStartStale, isSpeechFrame,
  liveParticipants, normalizedSpeakerLevel, parseEphemeralChannelId, parseFrameHeader, parseRelayFrame, parseRoomControl,
  reconstructActiveHuddle, reconstructHuddleLifecycle, HUDDLE_FLAG_DTX, HUDDLE_HEADER_BYTES,
} from "../src/huddle";
import { PlatformProvider } from "../src/react/context";
import { HuddleAttachment } from "../src/react/huddle/HuddleAttachment";
import {
  HuddleHostProvider, HuddleParentProvider, IDLE_HUDDLE_STATE, type HuddleHost, type HuddleParent,
} from "../src/react/huddle/host";
import type { BffReply, BffRequest } from "../src/transport";
import { render, settle } from "./render";

const EPHEMERAL = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const alice = "a".repeat(64);
const bob = "b".repeat(64);
const relay = "f".repeat(64);

const event = (kind: number, createdAt: number, extra: Partial<HuddleLifecycleEvent> = {}): HuddleLifecycleEvent => ({
  eventId: `${kind}-${createdAt}-${extra.participantPubkey ?? extra.pubkey ?? ""}`,
  kind,
  pubkey: kind === 48100 ? alice : relay,
  createdAt,
  ephemeralChannelId: EPHEMERAL,
  ...extra,
});

describe("original Huddle lifecycle reconstruction", () => {
  it("tracks the newest live session and its roster", () => {
    const active = reconstructActiveHuddle([
      event(48101, 2, { participantPubkey: bob }),
      event(48100, 1),
      event(48101, 3, { participantPubkey: alice }),
    ]);
    expect(active?.ephemeralChannelId).toBe(EPHEMERAL);
    expect(active?.huddleThreadEventId).toBe("48100-1-");
    expect([...(active?.participants ?? [])].sort()).toEqual([alice, bob]);
  });

  it("never resurrects an ended session from a late relay join", () => {
    expect(reconstructActiveHuddle([
      event(48100, 1),
      event(48103, 2),
      event(48101, 3, { participantPubkey: bob }),
    ])).toBeNull();
  });

  it("orders same-second events start < join < left < end", () => {
    expect(reconstructActiveHuddle([
      event(48103, 5),
      event(48101, 5, { participantPubkey: bob }),
      event(48100, 5),
    ])).toBeNull();
    const left = reconstructActiveHuddle([
      event(48102, 5, { participantPubkey: bob }),
      event(48101, 5, { participantPubkey: bob }),
      event(48100, 5),
    ]);
    expect([...(left?.participants ?? [])]).toEqual([alice]);
  });

  it("infers a session from a join without its start", () => {
    const inferred = reconstructActiveHuddle([event(48101, 1, { participantPubkey: bob })]);
    expect(inferred?.huddleThreadEventId).toBeNull();
    expect([...(inferred?.participants ?? [])]).toEqual([bob]);
  });

  it("reconstructs one card's lifecycle and ignores other sessions", () => {
    const events = [
      event(48100, 1),
      event(48101, 2, { participantPubkey: bob }),
      event(48101, 2, { participantPubkey: alice, ephemeralChannelId: OTHER }),
      event(48102, 3, { participantPubkey: bob }),
    ];
    const card = reconstructHuddleLifecycle(events, alice, EPHEMERAL);
    expect(card.ended).toBe(false);
    expect([...card.participants]).toEqual([alice]);
    expect(liveParticipants(events, EPHEMERAL)).toEqual([alice]);
    const ended = reconstructHuddleLifecycle([...events, event(48103, 4)], alice, EPHEMERAL);
    expect(ended.ended).toBe(true);
    expect(liveParticipants([...events, event(48103, 4)], EPHEMERAL)).toEqual([]);
  });

  it("reads the card content and the one-hour joinable window", () => {
    expect(parseEphemeralChannelId(JSON.stringify({ ephemeral_channel_id: EPHEMERAL }))).toBe(EPHEMERAL);
    expect(parseEphemeralChannelId("{}")).toBeNull();
    expect(parseEphemeralChannelId("not json")).toBeNull();
    const now = 10_000_000;
    expect(isHuddleStartStale(now / 1000 - 3600, now)).toBe(false);
    expect(isHuddleStartStale(now / 1000 - 3601, now)).toBe(true);
  });
});

describe("original Huddle naming and errors", () => {
  it("builds the channel and DM huddle names", () => {
    expect(buildHuddleChannelName({ kind: "channel", channelName: " release " })).toBe("release huddle");
    expect(buildHuddleChannelName({ kind: "channel", channelName: "" })).toBe("huddle");
    expect(buildHuddleChannelName({ kind: "dm", selfLabel: "Ada Lovelace", participantLabels: ["Grace Hopper"] }))
      .toBe("Ada <> Grace huddle");
    expect(buildHuddleChannelName({ kind: "dm", participantLabels: [] })).toBe("huddle");
  });

  it("formats action errors like formatHuddleActionError", () => {
    expect(huddleActionErrorKey(new Error("HUDDLE_AUDIO_UNAVAILABLE"), "join")).toEqual({ key: "huddle.error.audioUnavailable" });
    expect(huddleActionErrorKey(new Error("  relay refused  "), "start")).toEqual({ message: "relay refused" });
    expect(huddleActionErrorKey(undefined, "join")).toEqual({ key: "huddle.error.join" });
    expect(huddleActionErrorKey("", "start")).toEqual({ key: "huddle.error.start" });
  });
});

describe("original protocol v2 framing", () => {
  it("round-trips the 8-byte header ahead of the Opus payload", () => {
    const opus = new Uint8Array([1, 2, 3, 4]);
    const frame = encodeUplinkFrame({ seq: 0x1_0005, ts48k: 960 * 3, levelDbov: -20.4, flags: 0 }, opus);
    expect(frame.byteLength).toBe(HUDDLE_HEADER_BYTES + 4);
    expect(parseFrameHeader(frame)).toEqual({ seq: 5, ts48k: 2880, levelDbov: -20, flags: 0 });
    const relayed = new Uint8Array(1 + frame.byteLength);
    relayed[0] = 7;
    relayed.set(frame, 1);
    const parsed = parseRelayFrame(relayed);
    expect(parsed?.peerIndex).toBe(7);
    expect([...(parsed?.opus ?? [])]).toEqual([1, 2, 3, 4]);
  });

  it("drops empty or truncated relay frames and coerces bad levels", () => {
    const header = encodeUplinkFrame({ seq: 1, ts48k: 0, levelDbov: 0, flags: 0 }, new Uint8Array());
    expect(parseRelayFrame(new Uint8Array([3, ...header]))).toBeNull();
    expect(parseRelayFrame(new Uint8Array([3, 1, 2]))).toBeNull();
    const positive = encodeUplinkFrame({ seq: 1, ts48k: 0, levelDbov: 0, flags: 0 }, new Uint8Array([9]));
    positive[6] = 5;
    expect(parseFrameHeader(positive)?.levelDbov).toBe(-127);
  });

  it("gates remote speech on DTX and level", () => {
    expect(isSpeechFrame({ seq: 0, ts48k: 0, levelDbov: -30, flags: 0 })).toBe(true);
    expect(isSpeechFrame({ seq: 0, ts48k: 0, levelDbov: -30, flags: HUDDLE_FLAG_DTX })).toBe(false);
    expect(isSpeechFrame({ seq: 0, ts48k: 0, levelDbov: -70, flags: 0 })).toBe(false);
    expect(normalizedSpeakerLevel(-60)).toBe(0);
    expect(normalizedSpeakerLevel(-12)).toBe(1);
    expect(normalizedSpeakerLevel(-36)).toBeCloseTo(0.5);
  });

  it("measures dBov like audio_level_dbov", () => {
    expect(audioLevelDbov(new Float32Array())).toBe(-127);
    expect(audioLevelDbov(new Float32Array(960))).toBe(-127);
    expect(audioLevelDbov(new Float32Array(960).fill(1))).toBe(0);
    expect(audioLevelDbov(new Float32Array(960).fill(0.1))).toBe(-20);
  });

  it("parses the relay room control messages", () => {
    expect(parseRoomControl(JSON.stringify({ type: "joined", pubkey: alice, peer_index: 0, peers: [{ pubkey: bob, peer_index: 1, epoch: 2 }] })))
      .toEqual({ type: "joined", pubkey: alice, peerIndex: 0, peers: [{ pubkey: bob, peerIndex: 1, epoch: 2 }] });
    expect(parseRoomControl(JSON.stringify({ type: "left", pubkey: bob, peer_index: 1 })))
      .toEqual({ type: "left", pubkey: bob, peerIndex: 1 });
    expect(parseRoomControl(JSON.stringify({ type: "error", code: "room_full" })))
      .toEqual({ type: "error", code: "room_full", message: null });
    expect(parseRoomControl(JSON.stringify({ type: "joined" }))).toBeNull();
    expect(parseRoomControl("binary?")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The 48100 timeline card over the BFF reads
// ---------------------------------------------------------------------------

const parent: HuddleParent = { kind: "workspace", workspaceId: "w", channelId: "c" };

function fakeHost(): HuddleHost {
  const rejected = () => Promise.reject(new Error("not used"));
  return {
    unavailableReason: null,
    startHuddle: rejected,
    joinHuddle: rejected,
    leaveHuddle: () => Promise.resolve(),
    endHuddle: () => Promise.resolve(),
    confirmHuddleActive: () => Promise.resolve(),
    getHuddleState: () => Promise.resolve(IDLE_HUDDLE_STATE),
    setupAudioWorklet: rejected,
    setManualMicUnmuted: () => Promise.resolve(),
    getVoiceInputMode: () => Promise.resolve("voice_activity"),
    setVoiceInputMode: () => Promise.resolve(),
    listAudioOutputDevices: () => Promise.resolve([]),
    getAudioOutputDevice: () => Promise.resolve(""),
    setAudioOutputDevice: () => Promise.resolve(),
    reconnectHuddleAudio: () => Promise.resolve(),
    addAgentToHuddle: () => Promise.resolve(),
    removeAgentFromHuddle: () => Promise.resolve(),
    listen: () => () => {},
  };
}

const binding = (state: HuddleState): HuddleView => ({
  huddleId: "h1",
  parentWorkspaceId: "w",
  parentChannelId: "c",
  channelId: EPHEMERAL,
  channelName: "release huddle",
  initiatorPrincipalId: "me",
  creatorPubkey: alice,
  agentInstallationResourceIds: [],
  state,
  version: 1,
  operationId: "operation",
  createdAt: "2026-10-19T00:00:00Z",
});

function backend(items: HuddleView[], events: HuddleLifecycleEvent[]) {
  return vi.fn(async (request: BffRequest): Promise<BffReply> => {
    if (request.path === "/api/v1/huddles?parentWorkspaceId=w") return { status: 200, body: { items } };
    if (request.path === "/api/v1/huddles/h1/lifecycle") return { status: 200, body: { events, live: true } };
    return { status: 404, body: {} };
  });
}

async function mountCard(send: ReturnType<typeof backend>, createdAt: number, body = JSON.stringify({ ephemeral_channel_id: EPHEMERAL })) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await render(<QueryClientProvider client={cache}><PlatformProvider client={createBffClient({ send })} locale="en">
    <HuddleHostProvider host={fakeHost()}><HuddleParentProvider parent={parent}>
      <HuddleAttachment message={{ id: "card", body, createdAt, pubkey: alice }} />
    </HuddleParentProvider></HuddleHostProvider>
  </PlatformProvider></QueryClientProvider>);
  await settle();
}

const card = () => document.querySelector<HTMLElement>("[data-testid=huddle-attachment]");

describe("original 48100 Huddle card", () => {
  beforeEach(() => {
    localStorage.clear();
    setLocale("en");
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("shows an in-progress session with its verified roster", async () => {
    const now = Math.floor(Date.now() / 1000);
    await mountCard(backend([binding(HuddleState.Active)], [
      event(48100, now - 10),
      event(48101, now - 9, { participantPubkey: alice }),
      event(48101, now - 8, { participantPubkey: bob }),
    ]), now - 10);
    await vi.waitFor(() => expect(card()?.dataset.huddleState).toBe("active"));
    expect(card()?.textContent).toContain("In progress");
    expect(card()?.textContent).toContain("2 participants");
  });

  it("shows ended once the binding is no longer listed", async () => {
    const now = Math.floor(Date.now() / 1000);
    await mountCard(backend([], []), now - 10);
    await vi.waitFor(() => expect(card()?.dataset.huddleState).toBe("ended"));
    expect(card()?.textContent).toContain("Ended");
    expect(card()?.textContent).toContain("1 participant");
  });

  it("shows an unconfirmed start older than an hour as ended", async () => {
    const now = Math.floor(Date.now() / 1000);
    await mountCard(backend([binding(HuddleState.Active)], [event(48100, now - 7200)]), now - 7200);
    await vi.waitFor(() => expect(card()?.dataset.huddleState).toBe("ended"));
  });

  it("shows the original unavailable card without session details", async () => {
    await mountCard(backend([], []), Math.floor(Date.now() / 1000), "{}");
    expect(card()?.textContent).toContain("Huddle unavailable");
    expect(card()?.textContent).toContain("This huddle card is missing session details.");
  });
});
