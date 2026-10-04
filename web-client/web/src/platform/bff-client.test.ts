import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openStream, type StreamFrame } from "./bff-client";

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
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
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

it("reopens once after a terminal transport failure and rejects obsolete source callbacks", () => {
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
  vi.advanceTimersByTime(25);
  expect(Source.instances).toHaveLength(2);
  first.frame("closed", "scope-revoked");
  Source.instances[1].frame("live");
  expect(frames).toEqual([{ type: "interrupted" }, { type: "live" }]);
  stop();
});

it("keeps uncertain readmission distinct from revocation and uses the server retry interval", () => {
  const frames: StreamFrame[] = [];
  const stop = openStream("workspace-a", (frame) => frames.push(frame));
  const source = Source.instances[0];
  source.frame("retry", "25");
  source.frame("closed", "readmission-unavailable");
  source.readyState = Source.CLOSED;
  source.frame("error");
  vi.advanceTimersByTime(24);
  expect(Source.instances).toHaveLength(1);
  vi.advanceTimersByTime(1);
  expect(Source.instances).toHaveLength(2);
  expect(frames).toEqual([
    { type: "closed", reason: "readmission-unavailable" },
    { type: "interrupted" },
  ]);
  stop();
});

it("does not invent a retry interval and cleanup cancels a pending reopen", () => {
  const frames: StreamFrame[] = [];
  const stop = openStream("workspace-a", (frame) => frames.push(frame));
  Source.instances[0].readyState = Source.CLOSED;
  Source.instances[0].frame("error");
  expect(frames).toEqual([{ type: "ended" }]);
  vi.runAllTimers();
  expect(Source.instances).toHaveLength(1);
  stop();
  const stopNext = openStream("workspace-b", () => {});
  Source.instances[1].frame("retry", "25");
  Source.instances[1].readyState = Source.CLOSED;
  Source.instances[1].frame("error");
  stopNext();
  vi.runAllTimers();
  expect(Source.instances).toHaveLength(2);
});
