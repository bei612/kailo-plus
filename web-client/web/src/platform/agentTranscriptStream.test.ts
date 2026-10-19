// @vitest-environment jsdom
// DD-125(6), V-SCN-143: the Web transcript stream seam follows the BFF SSE frames and
// stops for good when Core reports that Installation audit (or the session) is gone.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { agentTranscriptStreamPath, openAgentTranscriptStream } from "./agentTranscriptStream";

const session = vi.hoisted(() => vi.fn());
vi.mock("./bff-client", () => ({ bff: { session } }));

class Source extends EventTarget {
  static instances: Source[] = [];
  close = vi.fn();
  constructor(readonly url: string) {
    super();
    Source.instances.push(this);
  }
  frame(type: string, data = "") {
    this.dispatchEvent(new MessageEvent(type, { data }));
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  Source.instances = [];
  vi.stubGlobal("EventSource", Source);
  session.mockReset().mockResolvedValue({ tenantPrincipalId: "principal" });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const frame = { installationId: "inst/1", rootEventId: "root", projectionGeneration: 2, threadId: "thread", turnId: "turn",
  phase: "ITEM_STARTED", item: { itemId: "a", turnId: "turn", kind: "AGENT_MESSAGE", nativeType: "agentMessage", text: "hi" } };

it("opens the Core route, forwards only this Installation's frames and reports live", () => {
  const events: unknown[] = [];
  const states: string[] = [];
  const close = openAgentTranscriptStream("inst/1", (event) => events.push(event), (state) => states.push(state));
  const source = Source.instances[0]!;
  expect(source.url).toBe(agentTranscriptStreamPath("inst/1"));
  expect(source.url).toBe("/api/v1/agent-installations/inst%2F1/transcript/stream");
  source.frame("live");
  source.frame("transcript", JSON.stringify(frame));
  source.frame("transcript", JSON.stringify({ ...frame, installationId: "other" }));
  source.frame("transcript", "not json");
  expect(events).toEqual([frame]);
  expect(states).toEqual(["connecting", "live"]);
  close();
  expect(source.close).toHaveBeenCalled();
});

it("reconnects after the server retry interval once the platform session is confirmed fresh", async () => {
  const states: string[] = [];
  openAgentTranscriptStream("inst/1", () => {}, (state) => states.push(state));
  const first = Source.instances[0]!;
  first.frame("retry", "1500");
  first.frame("live");
  first.frame("closed", "upstream-unavailable");
  first.frame("error");
  await vi.waitFor(() => expect(session).toHaveBeenCalledWith({ fresh: true }));
  expect(first.close).toHaveBeenCalled();
  expect(Source.instances).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1500);
  expect(Source.instances).toHaveLength(2);
  expect(states).toEqual(["connecting", "live", "reconnecting", "reconnecting", "reconnecting"]);
});

it.each(["scope-revoked", "session-revoked", "identity-revoked"])("stops for good on %s", async (reason) => {
  const states: [string, string | undefined][] = [];
  openAgentTranscriptStream("inst/1", () => {}, (state, why) => states.push([state, why]));
  const first = Source.instances[0]!;
  first.frame("retry", "10");
  first.frame("closed", reason);
  first.frame("error");
  await vi.advanceTimersByTimeAsync(100);
  expect(Source.instances).toHaveLength(1);
  expect(session).not.toHaveBeenCalled();
  expect(states.at(-1)).toEqual(["closed", reason]);
});
