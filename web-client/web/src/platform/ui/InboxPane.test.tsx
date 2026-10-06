import { describe, expect, it } from "vitest";
import { inboxEvents } from "./InboxPane";
import { inboxWindowEvents } from "./inbox-events";

const event = {
  id: "a".repeat(64),
  pubkey: "b".repeat(64),
  kind: 9,
  created_at: 1,
  content: "message",
  tags: [["h", "workspace-a"]],
};

describe("Web Inbox's actual BFF page scope consumer", () => {
  it("retains only the exact admitted Workspace identity", () => {
    expect(inboxEvents([event], "workspace-a")[0]?.channelId).toBe("workspace-a");
    expect(() => inboxEvents([event], "workspace-b")).toThrow();
  });
  it("rejects missing or conflicting scopes", () => {
    expect(() => inboxEvents([{ ...event, tags: [] }], "workspace-a")).toThrow();
    expect(() =>
      inboxEvents([{ ...event, tags: [...event.tags, ["h", "workspace-b"]] }], "workspace-a"),
    ).toThrow();
  });
  it("does not render malformed/native unknown event shapes as messages", () => {
    expect(() => inboxEvents([{ ...event, kind: 1 }], "workspace-a")).toThrow();
    expect(() => inboxEvents([{ ...event, pubkey: undefined }], "workspace-a")).toThrow();
    expect(() =>
      inboxEvents(
        [
          {
            ...event,
            tags: [
              ["h", "workspace-a"],
              ["p", null],
            ],
          },
        ],
        "workspace-a",
      ),
    ).toThrow();
    expect(() => inboxEvents({ events: [event] }, "workspace-a")).toThrow();
  });
  it("rejects unrepresentable timestamps instead of crashing a row", () => {
    expect(() => inboxEvents([{ ...event, created_at: -1 }], "workspace-a")).toThrow();
    expect(() =>
      inboxEvents([{ ...event, created_at: Number.MAX_SAFE_INTEGER }], "workspace-a"),
    ).toThrow();
  });
});

describe("Inbox and sidebar consume the original governed Relay window", () => {
  const bounds = {
    ...event, id: "c".repeat(64), kind: 39006,
    tags: [...event.tags, ["d", "workspace-a:head"]],
    content: JSON.stringify({ has_more: false, next_cursor: null }),
  };
  const summary = {
    ...event, id: "d".repeat(64), kind: 39005,
    tags: [...event.tags, ["e", event.id]],
    content: JSON.stringify({ reply_count: 0, descendant_count: 0, last_reply_at: null, participants: [] }),
  };
  it("partitions signed bounds and summaries before unread/activity row validation", () => {
    expect(inboxWindowEvents([event, summary, bounds], "workspace-a").map((row) => row.id)).toEqual([event.id]);
    expect(inboxWindowEvents([bounds], "workspace-a")).toEqual([]);
  });
  it("never turns native action overlays into phantom unread messages", () => {
    const edit = { ...event, id: "e".repeat(64), kind: 40003, tags: [...event.tags, ["e", event.id]] };
    const reaction = { ...event, id: "f".repeat(64), kind: 7, tags: [["e", event.id]] };
    expect(inboxWindowEvents([event, edit, reaction, bounds], "workspace-a").map((row) => row.id)).toEqual([event.id]);
  });
  it("still rejects unknown kinds and foreign scope even when they would not render", () => {
    expect(() => inboxWindowEvents([event, { ...summary, kind: 1 }, bounds], "workspace-a")).toThrow();
    expect(() => inboxWindowEvents([event, { ...summary, tags: [["h", "workspace-b"]] }, bounds], "workspace-a")).toThrow();
    expect(() => inboxWindowEvents([event, { ...summary, tags: [["h", "workspace-a"], ["h", "workspace-b"]] }, bounds], "workspace-a")).toThrow();
    expect(() => inboxWindowEvents([event, { ...summary, created_at: -1 }, bounds], "workspace-a")).toThrow();
  });
  it("retains the original bounds proof rather than interpreting incomplete evidence as empty", () => {
    expect(() => inboxWindowEvents([event], "workspace-a")).toThrow();
    expect(() => inboxWindowEvents([event, { ...bounds, tags: [...event.tags, ["d", "workspace-b:head"]] }], "workspace-a")).toThrow();
    expect(() => inboxWindowEvents([event, bounds, bounds], "workspace-a")).toThrow();
  });
});
