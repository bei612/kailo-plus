// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ChannelSidebar } from "./ChannelSidebar";
import type { Event as SidebarEvent } from "./inbox-events";

const snapshot = vi.hoisted(() => ({ failed: false, fetching: false, query: undefined as undefined | ((context: { signal: AbortSignal }) => Promise<Map<string, { channelId: string; events: SidebarEvent[] }>>),
  channel: vi.fn(async (workspace: string) => ({channelId:`native-${workspace}`, channelType:"stream"})), messages: vi.fn(),
  menus: new Map<string, { copyChannelId: string | null; mute?: (id: string) => void; unmute?: (id: string) => void }>() }));
vi.mock("@client-kit/platform/react/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryFn: typeof snapshot.query }) => { snapshot.query = options.queryFn; return ({ isSuccess: !snapshot.failed, isFetching:snapshot.fetching, isError: snapshot.failed, data: new Map([
    ["one", { channelId: "native-one", channelType: "stream", events: [{ id: "one-event", channelId: "native-one", createdAt: 30, tags: [] }] }],
    ["two", { channelId: "native-two", channelType: "forum", events: [{ id: "two-event", channelId: "native-two", createdAt: 10, tags: [] }] }],
  ]) }); },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@client-kit/platform/react/sidebar/channel-group", () => ({
  ChannelGroupSection: ({ title, items, renderRow, renderContextMenu, onCreateChannel }: {
    title: string; items: { id: string }[]; renderRow: (row: { id: string }) => ReactNode; renderContextMenu: (row: { id: string }) => ReactNode;
    onCreateChannel?: () => void;
  }) => <section data-group={title}><button data-create-group={title} onClick={onCreateChannel}/>{items.map((row) => <div key={row.id}>{renderRow(row)}{renderContextMenu(row)}</div>)}</section>,
}));
vi.mock("@client-kit/platform/react/sidebar/channel-row", () => ({
  ChannelRow: ({ channel, isActive, hasUnread }: { channel: { id: string }; isActive: boolean; hasUnread: boolean }) =>
    <button data-id={channel.id} data-active={isActive} data-unread={hasUnread} />,
}));
vi.mock("@client-kit/platform/react/sidebar/channel-context-menu", () => ({
  ChannelContextMenuItems: ({ channel, copyChannelId, onMarkChannelRead, onStarChannel, onMuteChannel, onUnmuteChannel }: {
    channel: { id: string }; copyChannelId: string | null; onMarkChannelRead?: unknown; onStarChannel?: unknown;
    onMuteChannel?: (id: string) => void; onUnmuteChannel?: (id: string) => void;
  }) => { snapshot.menus.set(channel.id, { copyChannelId, mute: onMuteChannel, unmute: onUnmuteChannel }); return <span data-menu={channel.id} data-read-enabled={Boolean(onMarkChannelRead)} data-star-enabled={Boolean(onStarChannel)} />; },
}));
vi.mock("@client-kit/platform/react/sidebar/useChannelSortPreference", () => ({ useChannelSortPreference: () => ({ sortModeFor: () => "alpha", setSortModeFor: vi.fn() }) }));
vi.mock("@client-kit/platform/react/sidebar/tooltip", () => ({ TooltipProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/platform/bff-client", () => ({ bff: { workspaceChannel:snapshot.channel, workspaceMessages: snapshot.messages }, fetchUserState: vi.fn() }));
beforeEach(() => localStorage.setItem("buzz-feature-overrides-v1", JSON.stringify({ forum: true })));

const reads: ComponentProps<typeof ChannelSidebar>["reads"] = {
  state: { version: 3, readContexts: {}, workspacePreferences: { one: { starred: true, muted: false } } },
  failed: false, unknown: false, pending: false, refresh: vi.fn(), write: vi.fn(), readAt: () => 20, visibleChannels: new Set(["one", "two"]),
  workspaceChannels: new Set(["one", "two"]), conversations: [], eventReadAt: () => 20,
};
function markup(overrides: Partial<typeof reads> = {}, isMember = true) {
  return renderToStaticMarkup(<ChannelSidebar principalId="me" workspaces={[{ id: "one", name: "One", slug: "one", isMember }, { id: "two", name: "Two", slug: "two", isMember }]}
    selectedId="two" active reads={{ ...reads, ...overrides }} preferencePending={false}
    onSelect={vi.fn()} onCreate={vi.fn()} onCreateForum={vi.fn()} onSetPreference={vi.fn()} />);
}
it("projects admitted workspaces into the original starred/channel groups with canonical read positions", () => {
  snapshot.failed = false;
  localStorage.setItem("buzz-feature-overrides-v1", JSON.stringify({ forum: true }));
  const html = markup();
  expect(html).toContain('data-group="sidebar.starred"');
  expect(html).toContain('data-id="one" data-active="false" data-unread="true"');
  expect(html).toContain('data-id="two" data-active="true" data-unread="false"');
  expect(html).toContain('data-read-enabled="true" data-star-enabled="true"');
});
it("does not expose read/preference writes while the authoritative CAS outcome is unknown", () => {
  snapshot.failed = false;
  const html = markup({ unknown: true });
  expect(html).not.toContain('data-read-enabled="true"');
  expect(html).not.toContain('data-star-enabled="true"');
});
it("renders a failed activity observation as an error, not a confirmed read state", () => {
  snapshot.failed = true;
  const html = markup();
  expect(html).toContain('role="alert"');
  expect(html).not.toContain('data-read-enabled="true"');
  snapshot.failed = false;
});
it("keeps management-visible rows without unread markers or read commands for nonmembers", () => {
  snapshot.failed = false;
  const html = markup({}, false);
  expect(html).toContain('data-id="one"');
  expect(html).not.toContain('data-unread="true"');
  expect(html).not.toContain('data-read-enabled="true"');
  expect(html).toContain('data-star-enabled="true"');
});
it("loads the real sidebar activity query when Core returns original window metadata", async () => {
  snapshot.messages.mockImplementation(async (workspace: string) => ({ events: [
    { id: "a".repeat(64), pubkey: "b".repeat(64), kind: 9, created_at: 30, content: "message", tags: [["h", `native-${workspace}`]] },
    { id: "c".repeat(64), pubkey: "d".repeat(64), kind: 39006, created_at: 31,
      content: JSON.stringify({ has_more: false, next_cursor: null }), tags: [["h", `native-${workspace}`], ["d", `native-${workspace}:head`]] },
  ] }));
  markup();
  const result = await snapshot.query!({ signal: new AbortController().signal });
  expect(result.get("one")?.events.map((event) => event.id)).toEqual(["a".repeat(64)]);
  expect(result.get("two")?.events.map((event) => event.id)).toEqual(["a".repeat(64)]);
  expect(result.get("one")).toMatchObject({channelId:"native-one", events:[{channelId:"native-one"}]});
  expect(snapshot.channel).toHaveBeenCalledWith("one");
});

it("passes the observed Relay ID to original Copy while retaining management IDs for other actions", () => {
  snapshot.failed = false;
  snapshot.fetching = false;
  markup();
  expect(snapshot.menus.get("one")?.copyChannelId).toBe("native-one");
  expect(snapshot.menus.get("two")?.copyChannelId).toBe("native-two");
  markup({}, false);
  expect(snapshot.menus.get("one")?.copyChannelId).toBeNull();
  snapshot.fetching = true;
  markup();
  expect(snapshot.menus.get("one")?.copyChannelId).toBeNull();
  snapshot.fetching = false;
  snapshot.failed = true;
  markup();
  expect(snapshot.menus.get("one")?.copyChannelId).toBeNull();
  snapshot.failed = false;
});
it("uses native channel/msg/thread markers and does not write from stale activity during refetch", () => {
  const observed = vi.fn((event: {channelId?:string|null}) => event.channelId === "native-one" ? 30 : 10);
  expect(markup({eventReadAt:observed})).not.toContain('data-unread="true"');
  expect(observed.mock.calls.map(([event])=>event.channelId)).toContain("native-one");
  snapshot.fetching = true;
  try { expect(markup()).not.toContain('data-read-enabled="true"'); }
  finally { snapshot.fetching = false; }
});
it("retains original channel mute and unmute consumers with the authoritative star and UNKNOWN guard", () => {
  snapshot.failed = false;
  const write = vi.fn();
  const page = (unknown: boolean) => <ChannelSidebar principalId="me" workspaces={[{ id: "one", name: "One", slug: "one", isMember: true }]}
    selectedId="one" active reads={{ ...reads, unknown }} preferencePending={false}
    onSelect={vi.fn()} onCreate={vi.fn()} onCreateForum={vi.fn()} onSetPreference={write} />;
  renderToStaticMarkup(page(false));
  snapshot.menus.get("one")!.mute!("one");
  expect(write).toHaveBeenLastCalledWith("one", { starred: true, muted: true });
  snapshot.menus.get("one")!.unmute!("one");
  expect(write).toHaveBeenLastCalledWith("one", { starred: true, muted: false });
  renderToStaticMarkup(page(true));
  expect(snapshot.menus.get("one")!.mute).toBeUndefined();
  expect(snapshot.menus.get("one")!.unmute).toBeUndefined();
  expect(write).toHaveBeenCalledTimes(2);
});

it("feeds actual admitted unread destinations to the sidebar observer and clears failed or revoked observations", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  const observed = vi.fn();
  const page = (member: boolean, state: typeof reads.state = reads.state) => <ChannelSidebar principalId="me"
    workspaces={[{id:"one", name:"One", slug:"one", isMember:member}, {id:"two", name:"Two", slug:"two", isMember:member}]}
    selectedId="one" active reads={{...reads,state}} preferencePending={false}
    onSelect={vi.fn()} onCreate={vi.fn()} onCreateForum={vi.fn()} onSetPreference={vi.fn()} onUnreadChange={observed} />;
  try {
    snapshot.failed = false;
    await act(async () => root.render(page(true)));
    expect(observed).toHaveBeenLastCalledWith(new Set(["one"]));
    snapshot.failed = true;
    await act(async () => root.render(page(true)));
    expect(observed).toHaveBeenLastCalledWith(new Set());
    snapshot.failed = false;
    await act(async () => root.render(page(false)));
    expect(observed).toHaveBeenLastCalledWith(new Set());
    await act(async () => root.render(page(true, null)));
    expect(observed).toHaveBeenLastCalledWith(new Set());
  } finally {
    snapshot.failed = false;
    await act(async () => root.unmount());
  }
});

it("restores the original authorized Forum group, toggle and real create callback without treating Workspace IDs as native IDs", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  const create = vi.fn();
  snapshot.failed = false;
  const page = () => <ChannelSidebar principalId="me"
    workspaces={[{id:"one",name:"One",slug:"one",isMember:true}, {id:"two",name:"Two",slug:"two",isMember:true}]}
    selectedId="two" active reads={reads} preferencePending={false}
    onSelect={vi.fn()} onCreate={vi.fn()} onCreateForum={create} onSetPreference={vi.fn()} />;
  try {
    await act(async () => root.render(page()));
    expect(host.querySelector('[data-group="sidebar.forums"] [data-id="two"]')).not.toBeNull();
    expect(host.querySelector('[data-group="sidebar.channels"] [data-id="two"]')).toBeNull();
    expect(snapshot.menus.get("two")?.copyChannelId).toBe("native-two");
    await act(async () => host.querySelector<HTMLButtonElement>('[data-create-group="sidebar.forums"]')!.click());
    expect(create).toHaveBeenCalledOnce();
    localStorage.setItem("buzz-feature-overrides-v1", JSON.stringify({ forum: false }));
    await act(async () => window.dispatchEvent(new StorageEvent("storage", {key:"buzz-feature-overrides-v1"})));
    expect(host.querySelector('[data-group="sidebar.forums"]')).toBeNull();
    expect(host.querySelector('[data-id="two"]')).toBeNull();
    expect(host.querySelector('[data-id="one"]')).not.toBeNull();
  } finally { await act(async () => root.unmount()); }
});

it("uses the actual forum-post window for Forum activity and canonical read contexts, rejecting wrong scopes", async () => {
  snapshot.channel.mockImplementation(async (workspace: string) => ({channelId:`native-${workspace}`,channelType:workspace === "two" ? "forum" : "stream"}));
  snapshot.messages.mockImplementation(async (workspace: string, query: {messageType: string}) => ({events:[
    {id:"a".repeat(64),pubkey:"b".repeat(64),kind:query.messageType === "FORUM_POST" ? 45001 : 9,
      created_at:30,content:"Original post",tags:[["h",`native-${workspace}`]]},
    {id:"c".repeat(64),pubkey:"b".repeat(64),kind:39006,created_at:31,
      content:JSON.stringify({has_more:false,next_cursor:null}),tags:[["h",`native-${workspace}`],["d",`native-${workspace}:head`]]},
  ]}));
  try {
    markup();
    const result = await snapshot.query!({signal:new AbortController().signal});
    expect(snapshot.messages).toHaveBeenCalledWith("two", {messageType:"FORUM_POST"});
    expect(result.get("two")?.events[0]).toMatchObject({kind:45001,channelId:"native-two",channelType:"forum",createdAt:30});
    const {inboxReadContexts} = await import("@client-kit/platform/react/use-inbox-state");
    expect(inboxReadContexts(result.get("two")!.events, true)).toEqual([{key:"native-two",seconds:30}]);
    snapshot.messages.mockResolvedValueOnce({events:[{id:"a".repeat(64),pubkey:"b".repeat(64),kind:9,created_at:30,content:"Wrong scope",tags:[["h","other"]]}]});
    await expect(snapshot.query!({signal:new AbortController().signal})).rejects.toThrow("Unverifiable message scope");
  } finally {
    snapshot.channel.mockImplementation(async (workspace: string) => ({channelId:`native-${workspace}`,channelType:"stream"}));
  }
});
