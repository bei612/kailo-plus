import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bff, deleteMessage, openStream, type StreamFrame } from "./bff-client";
import { PlatformSessionAccessMode, WebMessageType } from "@client-kit/contracts";
import { BffError, SessionEndedError } from "@client-kit/platform/transport";

class Source extends EventTarget {
  static CLOSED = 2;
  static instances: Source[] = [];
  readyState = 1;
  close = vi.fn(() => {
    this.readyState = Source.CLOSED;
  });
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
  vi.spyOn(bff, "session").mockResolvedValue({
    accessMode: PlatformSessionAccessMode.Full, displayName: "Person",
    humanIdentityId: "human", platformSessionId: "session", tenantId: "tenant",
    tenantMembershipId: "membership", tenantPrincipalId: "principal",
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("freezes the deletion intent across calls without storing body or inventing a new event", async () => {
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({eventId:"receipt",operationId:"operation"}), {status:200,headers:{"Content-Type":"application/json"}}));
  vi.stubGlobal("fetch",fetcher);
  const target="d".repeat(64);
  await deleteMessage("workspace",target,WebMessageType.ForumPost);
  await deleteMessage("workspace",target,WebMessageType.ForumPost);
  const first=fetcher.mock.calls[0]![1] as RequestInit, second=fetcher.mock.calls[1]![1] as RequestInit;
  expect(String(fetcher.mock.calls[0]![0])).toContain("/workspaces/workspace/messages/delete");
  expect(new Headers(first.headers).get("Idempotency-Key")).toBe(new Headers(second.headers).get("Idempotency-Key"));
  expect(JSON.parse(first.body as string)).toEqual({content:"",attachments:[],mentionInstallationIds:[],messageType:"FORUM_POST",deleteEventId:target});
});

it.each(["session-revoked", "scope-revoked", "identity-revoked"])(
  "stops %s before notifying the consumer and ignores every late frame",
  (reason) => {
    const frames: StreamFrame[] = [];
    const stop = openStream("workspace-a", (frame) => {
      expect(Source.instances[0].close).toHaveBeenCalledOnce();
      frames.push(frame);
    });
    const source = Source.instances[0];
    source.frame("retry", "25");
    source.frame("closed", reason);
    for (const type of ["live", "snapshot", "event", "error", "closed"]) source.frame(type, "[]");
    vi.runAllTimers();
    expect(frames).toEqual([{ type: "closed", reason }]);
    expect(Source.instances).toHaveLength(1);
    stop();
  },
);

it("reopens once after a terminal transport failure and rejects obsolete source callbacks", async () => {
  const frames: StreamFrame[] = [];
  const stop = openStream("workspace-a", (frame) => frames.push(frame));
  const first = Source.instances[0];
  first.frame("retry", "25");
  first.readyState = Source.CLOSED;
  first.frame("error");
  first.frame("live");
  first.frame("snapshot", "[]");
  first.frame("error");
  expect(frames).toEqual([{ type: "interrupted" }]);
  await vi.advanceTimersByTimeAsync(25);
  expect(Source.instances).toHaveLength(2);
  first.frame("closed", "scope-revoked");
  Source.instances[1].frame("live");
  expect(frames).toEqual([{ type: "interrupted" }, { type: "live" }]);
  stop();
});

it("keeps uncertain readmission distinct from revocation and uses the server retry interval", async () => {
  const frames: StreamFrame[] = [];
  const stop = openStream("workspace-a", (frame) => frames.push(frame));
  const source = Source.instances[0];
  source.frame("retry", "25");
  source.frame("closed", "readmission-unavailable");
  source.readyState = Source.CLOSED;
  source.frame("error");
  await vi.advanceTimersByTimeAsync(24);
  expect(Source.instances).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(Source.instances).toHaveLength(2);
  expect(frames).toEqual([
    { type: "closed", reason: "readmission-unavailable" },
    { type: "interrupted" },
  ]);
  stop();
});

it("does not invent a retry interval and cleanup cancels a pending reopen", async () => {
  const frames: StreamFrame[] = [];
  const stop = openStream("workspace-a", (frame) => frames.push(frame));
  Source.instances[0].readyState = Source.CLOSED;
  Source.instances[0].frame("error");
  await vi.runAllTimersAsync();
  expect(frames).toEqual([{ type: "interrupted" }, { type: "ended" }]);
  expect(Source.instances).toHaveLength(1);
  stop();
  const stopNext = openStream("workspace-b", () => {});
  Source.instances[1].frame("retry", "25");
  Source.instances[1].readyState = Source.CLOSED;
  Source.instances[1].frame("error");
  stopNext();
  await vi.runAllTimersAsync();
  expect(Source.instances).toHaveLength(2);
});

it.each([new SessionEndedError(), new BffError(403, "revoked")])(
  "stops an automatically reconnecting source when the current session is rejected: %s",
  async (error) => {
    vi.mocked(bff.session).mockRejectedValue(error);
    const frames: StreamFrame[] = [];
    const stop = openStream("workspace-a", frame => frames.push(frame));
    const source = Source.instances[0];
    source.frame("retry", "25");
    source.readyState = 0;
    source.frame("error");
    expect(source.close).toHaveBeenCalledOnce();
    await vi.runAllTimersAsync();
    expect(bff.session).toHaveBeenCalledOnce();
    expect(Source.instances).toHaveLength(1);
    expect(frames).toEqual([{ type: "interrupted" }, { type: "ended" }]);
    stop();
  },
);

it("retries only the session probe while unavailable and never reopens after cleanup", async () => {
  vi.mocked(bff.session).mockRejectedValueOnce(new BffError(503, "unavailable"));
  const stop = openStream("workspace-a", () => {});
  const source = Source.instances[0];
  source.frame("retry", "25");
  source.frame("error");
  await vi.advanceTimersByTimeAsync(24);
  expect(Source.instances).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(bff.session).toHaveBeenCalledTimes(2);
  expect(Source.instances).toHaveLength(1);
  stop();
  await vi.runAllTimersAsync();
  expect(Source.instances).toHaveLength(1);
});

it("uses one top-level login navigation for concurrent expired-session responses", async () => {
  vi.mocked(bff.session).mockRestore();
  const assign = vi.fn();
  vi.stubGlobal("window", { location: { href: "/app/", assign } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
  const results = await Promise.allSettled([bff.session(), bff.session()]);
  expect(results.every(result => result.status === "rejected" && result.reason instanceof SessionEndedError)).toBe(true);
  expect(assign).toHaveBeenCalledExactlyOnceWith("/app/");
});
