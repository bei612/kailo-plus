import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import {
  aggregateInbox,
  checkedUserState,
  inboxReply,
  matchesInbox,
  loadOwnedAgentIdentities,
  feedHeadline,
  feedPreview,
  categoryLabelFor,
  getInboxTypeLabel,
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
  it("preserves every original empty preview and category branch in both supported locales without translating message content", () => {
    expect(feedPreview({ kind: 9, content: "  User-authored content  " }, "zh-CN")).toBe("User-authored content");
    for (const [kind, en, zh] of [
      [46010, "A workflow is waiting for approval.", "有一个工作流正在等待审批。"],
      [40007, "A reminder is waiting for you.", "有一条提醒等待你查看。"],
      [9, "No additional details were attached to this event.", "此事件没有附加详情。"],
    ] as const) {
      expect(feedPreview({ kind, content: " \n " })).toBe(en);
      expect(feedPreview({ kind, content: " \n " }, "zh-CN")).toBe(zh);
    }
    for (const [category, en, zh] of [
      ["needs_action", "Needs Action", "需要处理"],
      ["mention", "Mention", "提及"],
      ["agent_activity", "Agent update", "Agent 更新"],
      ["activity", "Activity", "动态"],
    ] as const) {
      expect(categoryLabelFor(category)).toBe(en);
      expect(categoryLabelFor(category, "zh-CN")).toBe(zh);
    }
  });
  it("keeps the original Inbox type-label branches without admitting additional feed kinds", () => {
    const base = { id: "event", kind: 9, content: "message", category: "activity", tags: [] as string[][] };
    const item = (overrides: Partial<typeof base> & { channelType?: string } = {}, channelLabel: string | null = "Channel", senderLabel = "Peer") => {
      const representative = { ...base, ...overrides };
      return { item: representative, groupItems: [representative], channelLabel, senderLabel };
    };
    expect(getInboxTypeLabel(item())).toEqual({ text: "Channel update in", channelLabel: "Channel" });
    expect(getInboxTypeLabel(item(), "zh-CN")).toEqual({ text: "频道更新于", channelLabel: "Channel" });
    expect(getInboxTypeLabel(item({}, null))).toEqual({ text: "Channel update", channelLabel: null });
    expect(getInboxTypeLabel(item({ category: "mention" }))).toEqual({ text: "Mentioned in", channelLabel: "Channel" });
    expect(getInboxTypeLabel(item({ category: "mention" }, null)).text).toBe("Mentioned");
    expect(getInboxTypeLabel(item({ category: "needs_action" })).text).toBe("Needs action in");
    expect(getInboxTypeLabel(item({ category: "needs_action" }, null)).text).toBe("Needs action");
    const reply = [["e", "root", "", "reply"]];
    expect(getInboxTypeLabel(item({ tags: reply })).text).toBe("Thread in");
    expect(getInboxTypeLabel(item({ tags: reply }, null)).text).toBe("Thread");
    expect(getInboxTypeLabel(item({ tags: [...reply, ["broadcast", "1"]] })).text).toBe("Channel update in");
    expect(getInboxTypeLabel(item({ tags: [["e", "root"]] })).text).toBe("Channel update in");
    expect(getInboxTypeLabel(item({ channelType: "dm", tags: reply }))).toEqual({ text: "DM from Peer", channelLabel: null });
    expect(getInboxTypeLabel(item({ channelType: "dm" }, "Channel", "")).text).toBe("DM");
    const repo = `30617:${"a".repeat(64)}:repository`;
    const root = { ...base, id: "review", kind: 1618, tags: [["a", repo]], content: "Review body" };
    expect(getInboxTypeLabel({ ...item(), groupItems: [base, root] })).toEqual({ text: "Review", channelLabel: null });
    expect(getInboxTypeLabel(item({ kind: 1621, tags: [["a", repo]] })).text).toBe("Task");
    expect(getInboxTypeLabel(item({ kind: 1619, tags: [["a", repo], ["e", "review"]] })).text).toBe("Project update");
    expect(getInboxTypeLabel(item({ kind: 1618, tags: [["a", "invalid-repository"]] })).text).toBe("Channel update in");
    expect(feedHeadline({ ...root, tags: [...root.tags, ["subject", "  Review title  "]] })).toBe("Review title");
    expect(feedHeadline({ ...root, content: "" })).toBe("Review");
    for (const [kind, headline] of [[40007, "Reminder"], [43001, "Job requested"], [43002, "Job accepted"], [43003, "Progress update"], [43004, "Job result"], [43005, "Job cancelled"], [43006, "Job failed"], [45001, "Forum post"], [45003, "Forum reply"], [46010, "Approval requested"]] as const) {
      expect(getInboxTypeLabel(item({ kind })).text).toBe(`${headline} in`);
      expect(feedHeadline({ ...base, kind })).toBe(headline);
    }
    expect(feedHeadline({ ...base, category: "agent_activity" })).toBe("Agent update");
    expect(feedHeadline({ ...base, category: "mention" })).toBe("Mention");
  });
  it("groups a DM by its admitted channel across roots and reads every item through that channel", () => {
    const first = { ...event("first", "private", 10), channelType: "dm", category: "activity" as const };
    const second = { ...first, id: "second", createdAt: 20 };
    const reply = { ...first, id: "reply", createdAt: 30, tags: [["e", "first", "", "reply"]] };
    const other = { ...first, id: "other", channelId: "other-private" };
    const rows = aggregateInbox({ mentions: [], activity: [first, second, reply, other] }, () => 100, () => 100, () => 10);
    const row = rows.find(item => item.conversationId === "dm:private")!;
    expect(rows).toHaveLength(2);
    expect(row.items.map(item => item.id)).toEqual(["first", "second", "reply"]);
    expect(row.item.id).toBe("second");
    expect(row.unreadCount).toBe(2);
    expect(matchesInbox({ ...row, groupItems: row.items }, "all")).toBe(true);
    expect(inboxReadContexts(row.items, true)).toEqual([{ key: "private", seconds: 30 }]);
    expect(inboxReadContexts(row.items, false)).toEqual([
      { key: "private", seconds: 9 }, {key: "msg:first", seconds: 9},
      {key: "msg:second", seconds: 19}, {key: "msg:reply", seconds: 29}, {key: "thread:first", seconds: 29},
    ]);
  });
  it("uses the representative's actual owned Agent identity, not labels or arbitrary traffic", () => {
    const pubkey = "a".repeat(64);
    const row = { categories: ["activity"], groupItems: [{ ...event("old"), pubkey }], item: { pubkey: "b".repeat(64) } };
    expect(matchesInbox(row, "agent_activity", new Set([pubkey]))).toBe(false);
    expect(matchesInbox({ ...row, item: { pubkey } }, "agent_activity", new Set([pubkey]))).toBe(true);
    expect(matchesInbox({ ...row, item: { pubkey } }, "all", new Set([pubkey]))).toBe(true);
    expect(matchesInbox(row, "agent_activity")).toBe(false);
  });
  it("follows the real Installation directory cursor and excludes foreign owners and inactive identities", async () => {
    const active = { resourceId: "install", workspaceId: "workspace", ownerPrincipalId: "owner", state: "ACTIVE", resourceState: "ACTIVE", agentPrincipalState: "ACTIVE", channelBinding: { status: "ACTIVE" }, projection: { state: "ACTIVE", generation: 1 }, activeProjectionGeneration: 1, agentPubkey: "a".repeat(64) };
    const send = vi.fn(async (request: BffRequest): Promise<BffReply> => ({ status: 200, body: request.path.includes("offset=1")
      ? { installations: [{ ...active, resourceId: "other", ownerPrincipalId: "other" }, { ...active, resourceId: "disabled", state: "DISABLED" }] }
      : { installations: [active], nextOffset: 1 } }));
    const result = await loadOwnedAgentIdentities(createBffClient({ send }), "workspace", "owner");
    expect([...result]).toEqual([["install", active.agentPubkey]]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0].path).toContain("offset=1");
  });
  it("does not invent an Agent author when the old service omits its binding or pagination is invalid", async () => {
    const active = { resourceId: "install", workspaceId: "workspace", ownerPrincipalId: "owner", state: "ACTIVE", resourceState: "ACTIVE", agentPrincipalState: "ACTIVE", channelBinding: { status: "ACTIVE" }, projection: { state: "ACTIVE", generation: 1 }, activeProjectionGeneration: 1 };
    const client = (body: unknown) => createBffClient({ send: async () => ({status: 200, body}) });
    await expect(loadOwnedAgentIdentities(client({installations:[active]}), "workspace", "owner")).rejects.toThrow("Unverifiable Agent identity");
    await expect(loadOwnedAgentIdentities(client({installations:[],nextOffset:0}), "workspace", "owner")).rejects.toThrow("cursor");
    await expect(loadOwnedAgentIdentities(client({installations:[{...active,workspaceId:"foreign"}]}), "workspace", "owner")).rejects.toThrow("scope");
  });
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
  const [confirmed, setConfirmed] = useState<boolean>();
  return (
    <>
      <span>{reads.state ? `v${reads.state.version}` : "no-state"}</span>
      <span>{reads.unknown ? "UNKNOWN" : "known"}</span>
      <span>{reads.pending ? "pending" : "idle"}</span>
      <span>{confirmed === undefined ? "not-written" : confirmed ? "write-confirmed" : "write-unconfirmed"}</span>
      <output>{JSON.stringify({visible:[...reads.visibleChannels],workspaces:[...reads.workspaceChannels]})}</output>
      <button
        type="button"
        onClick={async () => setConfirmed(await reads.write([{ key: "scope-a", seconds: 20 }]))}
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
  it("admits hidden DM channels by the participant directory without treating them as Workspaces and clears revoked entries",async()=>{
    let active=true;
    const client=createBffClient({send:async request=>({status:200,body:request.path==="/api/v1/workspaces"?[workspace]:request.path==="/api/v1/conversations"?{items:active?[{id:"dm",channelId:"native-dm",participantPrincipalIds:["self","peer"],state:"ACTIVE"}]:[]}:state()})});
    const host=await render(<PlatformProvider client={client}><Reader/></PlatformProvider>);
    expect(JSON.parse(host.querySelector("output")!.textContent!)).toEqual({visible:["scope-a","native-dm"],workspaces:["scope-a"]});
    active=false;await click(button(host,"Recheck"));
    expect(JSON.parse(host.querySelector("output")!.textContent!)).toEqual({visible:["scope-a"],workspaces:["scope-a"]});
  });
  it("sends exact Core version and only renders confirmed state", async () => {
    const send = vi.fn(
      async (request: BffRequest): Promise<BffReply> => ({
        status: 200,
        body:
          request.path === "/api/v1/conversations" ? {items:[]} : request.path === "/api/v1/workspaces"
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
    expect(host.textContent).toContain("write-confirmed");
  });
  it("keeps a lost write result unresolved and never issues a new-version write on recheck", async () => {
    const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
      if (request.method === "PUT") throw new TransportError("lost ACK");
      return {
        status: 200,
        body: request.path === "/api/v1/conversations" ? {items:[]} : request.path === "/api/v1/workspaces" ? [workspace] : state(),
      };
    });
    const host = await render(
      <PlatformProvider client={createBffClient({ send })}>
        <Reader />
      </PlatformProvider>,
    );
    await click(button(host, "Mark"));
    expect(host.textContent).toContain("write-unconfirmed");
    await click(button(host, "Recheck"));
    await click(button(host, "Mark"));
    expect(host.textContent).toContain("UNKNOWN");
    expect(host.textContent).toContain("write-unconfirmed");
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
        body: request.path === "/api/v1/conversations" ? {items:[]} : request.path === "/api/v1/workspaces" ? [workspace] : state(version),
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
        request.path === "/api/v1/conversations" ? {status:200,body:{items:[]}} : request.path === "/api/v1/workspaces"
          ? { status: 200, body: [workspace] }
          : new Promise((resolve) => {
              finish = resolve;
            }),
    });
    const second = createBffClient({
      send: async (request) => ({
        status: 200,
        body: request.path === "/api/v1/conversations" ? {items:[]} : request.path === "/api/v1/workspaces" ? [] : state(7),
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
                request.path === "/api/v1/conversations" ? {items:[]} : request.path === "/api/v1/workspaces" ? [workspace] : state(3),
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
    const label = host.querySelector<HTMLElement>("[data-inbox-type-label]")!;
    expect(label.classList.contains("message-markdown")).toBe(true);
    expect(label.classList.contains("text-2xs")).toBe(true);
    expect(label.classList.contains("min-h-[var(--inline-chip-min-height)]")).toBe(true);
    expect(label.classList.contains("group-hover/inbox-item:pr-[6.75rem]")).toBe(true);
    const chip = label.querySelector<HTMLElement>("[data-channel-link]")!;
    expect(chip.classList.contains("mention-chip")).toBe(true);
    expect(chip.classList.contains("overflow-hidden")).toBe(true);
    expect(chip.querySelector(".truncate")?.textContent).toBe("#A");
    expect(host.querySelector("button > span")?.classList.contains("group-active/inbox-item:bg-muted/40")).toBe(true);
    expect(host.querySelector('[data-testid="home-inbox-unread-count"]')).toBeNull();
  });
  it.each([
    ["2 unread", "4 days ago"],
    ["2 条未读", "4 天前"],
  ])("keeps the original separate unread child and timestamp flex gap for %s", async (unread, timestamp) => {
    const host = await render(
      <InboxRow
        id="unread"
        selected={false}
        read={false}
        sender="Sender"
        timestamp={timestamp}
        unread={unread}
        label="Thread in"
        channel="A"
        preview="Preview"
        actions={null}
        openLabel="Open item"
        onSelect={vi.fn()}
      />,
    );
    const count = host.querySelector<HTMLElement>('[data-testid="home-inbox-unread-count"]')!;
    expect(count.textContent).toBe(unread);
    const metadata = count.parentElement!;
    expect(metadata.classList.contains("flex")).toBe(true);
    expect(metadata.classList.contains("gap-1.5")).toBe(true);
    expect(count.nextSibling?.nodeType).toBe(Node.TEXT_NODE);
    expect(count.nextSibling?.textContent).toBe(timestamp);
  });
});
