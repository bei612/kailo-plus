import { describe, expect, it } from "vitest";
import { inboxEvents } from "./InboxPane";

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
