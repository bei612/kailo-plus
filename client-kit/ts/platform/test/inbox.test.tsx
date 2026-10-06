import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import {
  aggregateInbox,
  checkedUserState,
  inboxReply,
  matchesInbox,
  type InboxEvent,
} from "../src/inbox";
import { InboxRow } from "../src/react/inbox-row";
import { inboxReadContexts, useInboxState } from "../src/react/use-inbox-state";
import { PlatformProvider, useBffClient } from "../src/react/context";
import {
  TransportError,
  type BffReply,
  type BffRequest,
} from "../src/transport";
import { button, click, render, settle } from "./render";

const event = (
  id: string,
  channelId = "scope-a",
  createdAt = 1,
  tags: string[][] = [],
): InboxEvent => ({ id, channelId, createdAt, tags, category: "mention" });
const state = (version = 0) => ({
  version,
  readContexts: {},
  workspacePreferences: {},
});
const workspace = { id: "scope-a", name: "A", slug: "a", isMember: true };

describe("shared upstream Inbox aggregation", () => {
  it("uses the oldest unread reply without changing the stable thread root", () => {
    const root = event("root");
    const one = event("one", "scope-a", 2, [["e", "root", "", "reply"]]);
    const two = event("two", "scope-a", 3, [
      ["e", "root", "", "root"],
      ["e", "one", "", "reply"],
    ]);
    const [row] = aggregateInbox(
      { mentions: [root], activity: [one, two] },
      () => null,
    );
    if (!row) throw new Error("Missing thread row");
    expect(row.conversationId).toBe("root");
    expect(row.item.id).toBe("one");
    expect(row.unreadCount).toBe(2);
    expect(
      aggregateInbox({ mentions: [root], activity: [one, two] }, () => 2)[0]
        ?.item.id,
    ).toBe("two");
  });
  it("never merges the same root across two Workspace scopes", () => {
    const rows = aggregateInbox({
      mentions: [event("root"), event("root", "scope-b")],
      activity: [],
    });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.scopeKey)).size).toBe(2);
  });
  it("deduplicates mention/activity overlap and preserves mention precedence", () => {
    const item = event("root");
    const [row] = aggregateInbox({ mentions: [item], activity: [item] });
    if (!row) throw new Error("Missing mention row");
    expect(row.items).toHaveLength(1);
    expect(row.item.category).toBe("mention");
  });
  it("uses only marked, non-broadcast replies and keeps generic traffic out", () => {
    expect(inboxReply([["e", "root"]])).toBe(false);
    expect(
      inboxReply([
        ["e", "root", "", "reply"],
        ["broadcast", "1"],
      ]),
    ).toBe(false);
    expect(
      matchesInbox(
        { categories: ["activity"], groupItems: [event("ordinary")] },
        "all",
      ),
    ).toBe(false);
  });
  it("projects read/unread commands onto existing Core contexts, not local overrides", () => {
    const reply = event("reply", "scope-a", 20, [["e", "root", "", "reply"]]);
    expect(
      inboxReadContexts([reply, reply, event("root", "scope-a", 10)], true),
    ).toEqual([
      { key: "msg:reply", seconds: 20 },
      { key: "scope-a", seconds: 10 },
    ]);
    expect(inboxReadContexts([reply], false)).toEqual([
      { key: "msg:reply", seconds: 19 },
    ]);
    expect(() =>
      checkedUserState({ ...state(), readContexts: { root: "invalid" } }),
    ).toThrow();
  });
});

function Reader() {
  const reads = useInboxState(useBffClient());
  return (
    <>
      <span>{reads.state ? `v${reads.state.version}` : "no-state"}</span>
      <span>{reads.unknown ? "UNKNOWN" : "known"}</span>
      <span>{reads.pending ? "pending" : "idle"}</span>
      <button
        type="button"
        onClick={() => reads.write([{ key: "scope-a", seconds: 20 }])}
      >
        Mark
      </button>
      <button type="button" onClick={() => void reads.refresh()}>
        Recheck
      </button>
    </>
  );
}

describe("actual shared Core state consumer", () => {
  it("sends exact Core version and only renders confirmed state", async () => {
    const send = vi.fn(
      async (request: BffRequest): Promise<BffReply> => ({
        status: 200,
        body:
          request.path === "/api/v1/workspaces"
            ? [workspace]
            : request.method === "PUT"
              ? { version: 1 }
              : state(),
      }),
    );
    const host = await render(
      <PlatformProvider client={createBffClient({ send })}>
        <Reader />
      </PlatformProvider>,
    );
    await click(button(host, "Mark"));
    expect(send).toHaveBeenCalledWith({
      method: "PUT",
      path: "/api/v1/user-state/read",
      body: {
        contextKey: "scope-a",
        lastReadAt: "1970-01-01T00:00:20.000Z",
        version: 0,
      },
    });
    expect(host.textContent).toContain("v1");
  });
  it("keeps a lost write result unresolved and never issues a new-version write on recheck", async () => {
    const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
      if (request.method === "PUT") throw new TransportError("lost ACK");
      return {
        status: 200,
        body: request.path === "/api/v1/workspaces" ? [workspace] : state(),
      };
    });
    const host = await render(
      <PlatformProvider client={createBffClient({ send })}>
        <Reader />
      </PlatformProvider>,
    );
    await click(button(host, "Mark"));
    await click(button(host, "Recheck"));
    await click(button(host, "Mark"));
    expect(host.textContent).toContain("UNKNOWN");
    expect(
      send.mock.calls.filter(([request]) => request.method === "PUT"),
    ).toHaveLength(1);
  });
  it("releases pending after refresh fences a write ACK without claiming its outcome", async () => {
    let finish!: (reply: BffReply) => void;
    let version = 0;
    const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
      if (request.method === "PUT") {
        if (version > 0) return { status: 200, body: { version: version + 1 } };
        return new Promise((resolve) => {
          finish = resolve;
        });
      }
      return {
        status: 200,
        body: request.path === "/api/v1/workspaces" ? [workspace] : state(version),
      };
    });
    const host = await render(
      <PlatformProvider client={createBffClient({ send })}>
        <Reader />
      </PlatformProvider>,
    );
    await click(button(host, "Mark"));
    expect(host.textContent).toContain("pending");
    await click(button(host, "Recheck"));
    expect(host.textContent).toContain("UNKNOWN");
    await click(button(host, "Mark"));
    finish({ status: 200, body: { version: 1 } });
    await settle();
    expect(host.textContent).toContain("idle");
    expect(host.textContent).toContain("UNKNOWN");
    expect(host.textContent).toContain("v0");
    expect(host.textContent).not.toContain("v1");
    expect(
      send.mock.calls.filter(([request]) => request.method === "PUT"),
    ).toHaveLength(1);

    version = 1;
    await click(button(host, "Recheck"));
    expect(host.textContent).not.toContain("UNKNOWN");
    await click(button(host, "Mark"));
    expect(host.textContent).toContain("v2");
    expect(host.textContent).toContain("idle");
    expect(
      send.mock.calls.filter(([request]) => request.method === "PUT"),
    ).toHaveLength(2);
  });
  it("drops an old identity's late state read after provider client replacement", async () => {
    let finish!: (reply: BffReply) => void;
    const first = createBffClient({
      send: async (request) =>
        request.path === "/api/v1/workspaces"
          ? { status: 200, body: [workspace] }
          : new Promise((resolve) => {
              finish = resolve;
            }),
    });
    const second = createBffClient({
      send: async (request) => ({
        status: 200,
        body: request.path === "/api/v1/workspaces" ? [] : state(7),
      }),
    });
    function Host() {
      const [client, setClient] = useState(first);
      return (
        <>
          <button type="button" onClick={() => setClient(second)}>
            Switch
          </button>
          <PlatformProvider client={client}>
            <Reader />
          </PlatformProvider>
        </>
      );
    }
    const host = await render(<Host />);
    await click(button(host, "Switch"));
    finish({ status: 200, body: state(99) });
    await settle();
    expect(host.textContent).toContain("v7");
    expect(host.textContent).not.toContain("v99");
  });
  it("clears state after a newly denied scope read", async () => {
    let denied = false;
    const client = createBffClient({
      send: async (request) =>
        denied
          ? { status: 403, body: undefined }
          : {
              status: 200,
              body:
                request.path === "/api/v1/workspaces" ? [workspace] : state(3),
            },
    });
    const host = await render(
      <PlatformProvider client={client}>
        <Reader />
      </PlatformProvider>,
    );
    expect(host.textContent).toContain("v3");
    denied = true;
    await click(button(host, "Recheck"));
    expect(host.textContent).toContain("no-state");
    expect(host.textContent).not.toContain("v3");
  });
  it("renders the extracted row and calls the supplied host action", async () => {
    const select = vi.fn();
    const host = await render(
      <InboxRow
        id="one"
        selected={false}
        read={false}
        sender="Sender"
        timestamp="now"
        label="Mentioned in"
        channel="A"
        preview="Preview"
        actions={null}
        openLabel="Open item"
        onSelect={select}
      />,
    );
    await click(host.querySelector("button")!);
    expect(select).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("#A");
  });
});
