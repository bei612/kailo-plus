// @vitest-environment jsdom
// DD-125(3), V-SCN-131/158/160: the Web Huddle backend over the governed huddle.* actions and the
// BFF reads; Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src-tauri/src/huddle/mod.rs
// (start rollback, phase guard) and playout.rs (speaker ticks).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionDispatchState, ActionGateState, HuddleState, ReasonCode, type ActionCommand, type HuddleView,
} from "@client-kit/contracts";
import { createBffClient } from "@client-kit/platform/client";
import { TransportError, type BffReply, type BffRequest } from "@client-kit/platform/transport";
import { bridgeUrl, SpeakerActivity } from "./audioSession";
import { WebHuddleHost } from "./WebHuddleHost";

const view = (state: HuddleState): HuddleView => ({
  huddleId: "h1",
  parentWorkspaceId: "w",
  parentChannelId: "c",
  channelId: "11111111-1111-4111-8111-111111111111",
  channelName: "release huddle",
  initiatorPrincipalId: "me",
  creatorPubkey: "a".repeat(64),
  agentInstallationResourceIds: [],
  state,
  version: 1,
  operationId: "operation",
  createdAt: new Date("2026-10-19T00:00:00Z"),
});

const submission = (dispatchState: ActionDispatchState, reason?: ReasonCode): BffReply => ({
  status: dispatchState === ActionDispatchState.Dispatched ? 200 : 202,
  body: {
    actionExecutionId: "execution", actionKey: "huddle.start", operationId: "operation",
    gateState: ActionGateState.Allowed, dispatchState, huddleId: "h1", ...(reason ? { reason } : {}),
  },
});

function backend(options: { announce: () => BffReply; huddle?: HuddleView; start?: (attempt: number) => BffReply }) {
  let starts = 0;
  const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
    if (request.method === "POST" && request.path === "/api/v1/actions") {
      const command = request.body as ActionCommand;
      if (command.actionKey === "huddle.start" && options.start) return options.start(starts++);
      return { status: 200, body: {
        actionExecutionId: "execution", actionKey: command.actionKey, operationId: "operation",
        gateState: ActionGateState.Allowed, dispatchState: ActionDispatchState.Dispatched,
        ...(command.actionKey === "huddle.start" ? { huddleId: "h1" } : {}),
      } };
    }
    if (request.path === "/api/v1/huddles/h1") return { status: 200, body: options.huddle ?? view(HuddleState.Active) };
    if (request.method === "POST" && request.path === "/api/v1/huddles/h1/announcement") return options.announce();
    return { status: 404, body: {} };
  });
  const actions = () => send.mock.calls.map(([request]) => request)
    .filter((request) => request.method === "POST" && request.path === "/api/v1/actions")
    .map((request) => request.body as ActionCommand);
  return { send, actions };
}

class SupportedCodec {
  static isConfigSupported = async () => ({ supported: true });
}

beforeEach(() => {
  vi.stubGlobal("AudioEncoder", SupportedCodec);
  vi.stubGlobal("AudioDecoder", SupportedCodec);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const parent = { kind: "workspace", workspaceId: "w", channelId: "c" } as const;

describe("Web Huddle host", () => {
  it("reports why a browser cannot run a Huddle", () => {
    const client = createBffClient({ send: backend({ announce: () => ({ status: 500, body: {} }) }).send });
    expect(new WebHuddleHost(client, { secure: false, webCodecs: true }).unavailableReason).toBe("insecure-context");
    expect(new WebHuddleHost(client, { secure: true, webCodecs: false }).unavailableReason).toBe("codec-unsupported");
    expect(new WebHuddleHost(client, { secure: true, webCodecs: true }).unavailableReason).toBeNull();
  });

  it("creates nothing when the browser cannot encode Opus", async () => {
    vi.stubGlobal("AudioEncoder", class { static isConfigSupported = async () => ({ supported: false }); });
    const api = backend({ announce: () => ({ status: 200, body: { startedEventId: "e", startedDelivered: true } }) });
    const host = new WebHuddleHost(createBffClient({ send: api.send }), { secure: true, webCodecs: true });
    await expect(host.startHuddle(parent, [], "release huddle")).rejects.toThrow("huddle audio codec unsupported");
    expect(api.actions()).toEqual([]);
    expect((await host.getHuddleState()).phase).toBe("idle");
  });

  it("starts through huddle.start and ends the Huddle when the announcement fails", async () => {
    const api = backend({ announce: () => ({ status: 500, body: {} }) });
    const host = new WebHuddleHost(createBffClient({ send: api.send }), { secure: true, webCodecs: true });
    const phases: string[] = [];
    host.listen("huddle-state-changed", (state) => phases.push(state.phase));
    await expect(host.startHuddle(parent, ["agent-1"], "release huddle")).rejects.toBeTruthy();
    const [start, end] = api.actions();
    expect(start?.actionKey).toBe("huddle.start");
    expect(start?.workspaceId).toBe("w");
    expect(start?.huddleStart).toEqual({
      parentWorkspaceId: "w", agentInstallationResourceIds: ["agent-1"], channelName: "release huddle",
    });
    expect(end?.actionKey).toBe("huddle.end");
    expect(end?.huddleId).toBe("h1");
    expect(end?.idempotencyKey).not.toBe(start?.idempotencyKey);
    expect(phases).toEqual(["creating", "idle"]);
    expect((await host.getHuddleState()).phase).toBe("idle");
  });

  it("ends a created Huddle whose projection is not active", async () => {
    const api = backend({
      announce: () => ({ status: 200, body: { startedEventId: "e", startedDelivered: true } }),
      huddle: view(HuddleState.Error),
    });
    const host = new WebHuddleHost(createBffClient({ send: api.send }), { secure: true, webCodecs: true });
    await expect(host.startHuddle(parent, [], "release huddle")).rejects.toThrow("huddle projection is not active");
    expect(api.actions().map((command) => command.actionKey)).toEqual(["huddle.start", "huddle.end"]);
  });

  it("ends a Huddle whose huddle.start outcome stays UNKNOWN", async () => {
    vi.useFakeTimers();
    const api = backend({
      announce: () => ({ status: 200, body: { startedEventId: "e", startedDelivered: true } }),
      start: () => submission(ActionDispatchState.Unknown),
    });
    const host = new WebHuddleHost(createBffClient({ send: api.send }), { secure: true, webCodecs: true });
    const started = expect(host.startHuddle(parent, [], "release huddle")).rejects.toThrow("huddle action did not settle");
    await vi.runAllTimersAsync();
    await started;
    const commands = api.actions();
    const starts = commands.filter((command) => command.actionKey === "huddle.start");
    // The UNKNOWN start is settled only by replaying its own key, then rolled back by huddle.end.
    expect(starts).toHaveLength(9);
    expect(new Set(starts.map((command) => command.idempotencyKey)).size).toBe(1);
    expect(commands.at(-1)?.actionKey).toBe("huddle.end");
    expect(commands.at(-1)?.huddleId).toBe("h1");
    expect(commands.at(-1)?.workspaceId).toBe("w");
    expect((await host.getHuddleState()).phase).toBe("idle");
  });

  it("recovers a lost huddle.start answer by its key and ends what it created", async () => {
    const api = backend({
      announce: () => ({ status: 500, body: {} }),
      start: (attempt) => {
        if (attempt === 0) throw new TransportError("connection reset");
        return submission(ActionDispatchState.Dispatched);
      },
    });
    const host = new WebHuddleHost(createBffClient({ send: api.send }), { secure: true, webCodecs: true });
    await expect(host.startHuddle(parent, [], "release huddle")).rejects.toBeTruthy();
    const [first, lookup, end] = api.actions();
    expect(first?.actionKey).toBe("huddle.start");
    expect(lookup?.actionKey).toBe("huddle.start");
    expect(lookup?.idempotencyKey).toBe(first?.idempotencyKey);
    expect(end?.actionKey).toBe("huddle.end");
    expect(end?.huddleId).toBe("h1");
    expect(api.actions()).toHaveLength(3);
  });

  it("has nothing to end when the start answer and its lookup are both lost", async () => {
    const api = backend({
      announce: () => ({ status: 500, body: {} }),
      start: () => { throw new TransportError("connection reset"); },
    });
    const host = new WebHuddleHost(createBffClient({ send: api.send }), { secure: true, webCodecs: true });
    await expect(host.startHuddle(parent, [], "release huddle")).rejects.toThrow("connection reset");
    expect(api.actions().map((command) => command.actionKey)).toEqual(["huddle.start", "huddle.start"]);
    expect((await host.getHuddleState()).phase).toBe("idle");
  });

  it("does not end a start that Core aborted", async () => {
    const api = backend({
      announce: () => ({ status: 500, body: {} }),
      start: () => submission(ActionDispatchState.Aborted, ReasonCode.PublishRejected),
    });
    const host = new WebHuddleHost(createBffClient({ send: api.send }), { secure: true, webCodecs: true });
    await expect(host.startHuddle(parent, [], "release huddle")).rejects.toThrow(ReasonCode.PublishRejected);
    expect(api.actions().map((command) => command.actionKey)).toEqual(["huddle.start"]);
    expect((await host.getHuddleState()).phase).toBe("idle");
  });

  it("does not look a refused start up again", async () => {
    const api = backend({
      announce: () => ({ status: 500, body: {} }),
      start: () => ({ status: 403, body: { class: "DENIED", reason: ReasonCode.PermissionDenied } }),
    });
    const host = new WebHuddleHost(createBffClient({ send: api.send }), { secure: true, webCodecs: true });
    await expect(host.startHuddle(parent, [], "release huddle")).rejects.toBeTruthy();
    expect(api.actions().map((command) => command.actionKey)).toEqual(["huddle.start"]);
  });

  it("refuses to join a Huddle that has ended", async () => {
    const api = backend({ announce: () => ({ status: 500, body: {} }), huddle: view(HuddleState.Ended) });
    const host = new WebHuddleHost(createBffClient({ send: api.send }), { secure: true, webCodecs: true });
    await expect(host.joinHuddle(parent, "11111111-1111-4111-8111-111111111111", "h1")).rejects.toThrow("huddle has ended");
    expect(api.actions()).toEqual([]);
  });

  it("guards a second start like the original phase check", async () => {
    let release: (reply: BffReply) => void = () => {};
    const api = backend({ announce: () => ({ status: 500, body: {} }) });
    const send = vi.fn((request: BffRequest) => request.path === "/api/v1/actions"
      ? new Promise<BffReply>((resolve) => { release = resolve; })
      : api.send(request));
    const host = new WebHuddleHost(createBffClient({ send }), { secure: true, webCodecs: true });
    const first = host.startHuddle(parent, [], "release huddle");
    await expect(host.startHuddle(parent, [], "release huddle")).rejects.toThrow("cannot start huddle: already in phase creating");
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    // A definite refusal: nothing was created and there is nothing to look up again.
    release({ status: 422, body: {} });
    await expect(first).rejects.toBeTruthy();
  });
});

describe("Web Huddle audio helpers", () => {
  it("bridges through the same origin", () => {
    expect(bridgeUrl("h 1", { protocol: "https:", host: "kailo.example" })).toBe("wss://kailo.example/api/v1/huddles/h%201/audio");
    expect(bridgeUrl("h1", { protocol: "http:", host: "localhost:5173" })).toBe("ws://localhost:5173/api/v1/huddles/h1/audio");
  });

  it("keeps active speakers for 500 ms and decays held levels", () => {
    const activity = new SpeakerActivity();
    activity.frame("alice", true, 0.8, 1000);
    activity.frame("bob", false, 0.3, 1000);
    expect(activity.activeSpeakers(1400)).toEqual(["alice"]);
    expect(activity.activeSpeakers(1600)).toEqual([]);
    expect(activity.tickLevels()).toEqual({ alice: 0.8, bob: 0.3 });
    const next = activity.tickLevels();
    expect(next.alice).toBeCloseTo(0.44);
    expect(next.bob).toBeCloseTo(0.165);
    activity.forget("alice");
    expect(Object.keys(activity.tickLevels())).toEqual(["bob"]);
  });
});
