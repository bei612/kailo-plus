// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ChannelSidebar } from "./ChannelSidebar";
import type { Event as SidebarEvent } from "./inbox-events";
import { ErrorClass, ReasonCode } from "@client-kit/contracts";
import { BffError } from "@client-kit/platform/transport";

const snapshot = vi.hoisted(() => ({ failed: false, fetching: false, error: undefined as unknown, query: undefined as undefined | ((context: { signal: AbortSignal }) => Promise<Map<string, { channelId: string; events: SidebarEvent[] }>>),
  channel: vi.fn(async (workspace: string) => ({channelId:`native-${workspace}`, channelType:"stream"})), messages: vi.fn(),
  types: { one: "stream", two: "stream" } as Record<string, string>,
  // Core's batched endpoint, modeled as the per-channel binding and window it replaces.
  activity: vi.fn(async ({ items }: { items: { workspaceId: string; messageType: string }[] }) => ({ items: await Promise.all(items.map(async ({ workspaceId, messageType }) => ({
    workspaceId, channelId: (await snapshot.channel(workspaceId)).channelId, events: (await snapshot.messages(workspaceId, { messageType })).events }))) })),
  menus: new Map<string, { copyChannelId: string | null; mute?: (id: string) => void; unmute?: (id: string) => void; markRead?: (id: string) => void; markUnread?: (id: string) => void;
    leave?: unknown; owner?: { workspaceId: string; channelId: string };
    section?: { currentSectionId?: string; disabled?: boolean; onAssign: (sectionId: string) => void; onUnassign: () => void } }>() }));
// DD-125(5): the Core-backed section preferences; null is a host without them.
const sectionPrefs = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
vi.mock("@client-kit/platform/react/collaboration-preferences", () => ({ useCollaborationPreferences: () => sectionPrefs.value }));
vi.mock("@client-kit/platform/react/sidebar/custom-channel-section", () => ({
  SidebarDndContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  DroppableUngroupedBody: ({ children }: { children: ReactNode }) => <>{children}</>,
  DraggableChannelRow: ({ channelId, children }: { channelId: string; children: ReactNode }) => <div data-drag={channelId}>{children}</div>,
  CustomChannelSection: ({ section, items, renderRow, renderContextMenu, disabled }: { section: { name: string }; items: { id: string }[];
    renderRow: (row: { id: string }) => ReactNode; renderContextMenu: (row: { id: string }) => ReactNode; disabled: boolean }) =>
    <section data-custom-section={section.name} data-disabled={disabled}>{items.map((row) => <div key={row.id}>{renderRow(row)}{renderContextMenu(row)}</div>)}</section>,
  CreateSectionDialog: () => null, RenameSectionDialog: () => null, DeleteSectionAlertDialog: () => null,
}));
vi.mock("@client-kit/platform/react/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryFn: typeof snapshot.query }) => { snapshot.query = options.queryFn; return ({ isSuccess: !snapshot.failed, isFetching:snapshot.fetching, isError: snapshot.failed, error: snapshot.error, failureReason: snapshot.error, refetch: vi.fn(), data: new Map([
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
  ChannelRow: ({ channel, isActive, hasUnread, workingBadge }: { channel: { id: string }; isActive: boolean; hasUnread: boolean; workingBadge?: ReactNode }) =>
    <button data-id={channel.id} data-active={isActive} data-unread={hasUnread}>{workingBadge}</button>,
}));
// DD-125(6): the shared working signal, keyed by the Workspace ID the Web reports channel activity under.
const working = vi.hoisted(() => ({ value: [] as { channelId: string; anchorAt: number; agentCount: number; agentPubkeys: string[]; source: string }[] }));
vi.mock("@client-kit/platform/react/agent-activity", () => ({
  useWorkingChannels: () => working.value,
  ChannelWorkingBadge: ({ summary, isActive }: { summary: { channelId: string; agentCount: number }; isActive: boolean }) =>
    <span data-working={summary.channelId} data-working-count={summary.agentCount} data-working-active={isActive} />,
}));
vi.mock("@client-kit/platform/react/sidebar/channel-activity-popover", () => ({
  ChannelActivityPopover: ({ activeWorking, children }: { activeWorking?: { channelId: string }; children: ReactNode }) =>
    <div data-activity-popover={activeWorking?.channelId ?? "none"}>{children}</div>,
}));
vi.mock("@client-kit/platform/react/sidebar/channel-context-menu", () => ({
  ChannelContextMenuItems: ({ channel, copyChannelId, onMarkChannelRead, onMarkChannelUnread, onStarChannel, onMuteChannel, onUnmuteChannel, onLeaveChannel, ownerActions, sectionActions }: {
    channel: { id: string }; copyChannelId: string | null; onMarkChannelRead?: (id: string) => void; onMarkChannelUnread?: (id: string) => void; onStarChannel?: unknown;
    onMuteChannel?: (id: string) => void; onUnmuteChannel?: (id: string) => void; onLeaveChannel?: unknown; ownerActions?: { workspaceId: string; channelId: string };
    sectionActions?: { currentSectionId?: string; disabled?: boolean; onAssign: (sectionId: string) => void; onUnassign: () => void };
  }) => { snapshot.menus.set(channel.id, { copyChannelId, mute: onMuteChannel, unmute: onUnmuteChannel, markRead: onMarkChannelRead, markUnread: onMarkChannelUnread,
    leave: onLeaveChannel, owner: ownerActions, section: sectionActions }); return <span data-menu={channel.id} data-read-enabled={Boolean(onMarkChannelRead)} data-star-enabled={Boolean(onStarChannel)} />; },
}));
vi.mock("@client-kit/platform/react/sidebar/useChannelSortPreference", () => ({ useChannelSortPreference: () => ({ sortModeFor: () => "alpha", setSortModeFor: vi.fn() }) }));
vi.mock("@client-kit/platform/react/sidebar/tooltip", () => ({ TooltipProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/platform/bff-client", () => ({ bff: { workspaceActivity: snapshot.activity }, fetchUserState: vi.fn() }));
beforeEach(() => localStorage.setItem("buzz-feature-overrides-v1", JSON.stringify({ forum: true })));

const reads: ComponentProps<typeof ChannelSidebar>["reads"] = {
  state: { version: 3, readContexts: {}, workspacePreferences: { one: { starred: true, muted: false } } },
  failed: false, rateLimited: false, unknown: false, pending: false, refresh: vi.fn(), write: vi.fn(), update: vi.fn(), readAt: () => 20, visibleChannels: new Set(["one", "two"]),
  workspaceChannels: new Set(["one", "two"]), conversations: [], eventReadAt: () => 20,
};
const directory = () => ["one", "two"].map((id) => ({ id, visibility: "open", isMember: true, memberCount: 1,
  channel: { channelId: `native-${id}`, channelType: snapshot.types[id], name: id, archived: false } })) as unknown as ComponentProps<typeof ChannelSidebar>["directory"];
function markup(overrides: Partial<typeof reads> = {}, isMember = true) {
  return renderToStaticMarkup(<ChannelSidebar principalId="me" workspaces={[{ id: "one", name: "One", slug: "one", isMember }, { id: "two", name: "Two", slug: "two", isMember }]} directory={directory()}
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
it("shows a rate-limited read as automatically retried, never as a failed or unknown result (DD-156, V-SCN-255)", () => {
  snapshot.failed = false;
  const limitedInbox = markup({ rateLimited: true });
  expect(limitedInbox).toContain("platform.rateLimitedRetrying");
  expect(limitedInbox).not.toContain("platform.loadFailed");
  expect(limitedInbox).not.toContain('role="alert"');

  snapshot.failed = true;
  snapshot.error = new BffError(429, "POST /api/v1/workspace-activity → 429",
    { class: ErrorClass.Limit, reason: ReasonCode.RateLimited }, 5);
  try {
    const limitedActivity = markup();
    expect(limitedActivity).toContain("platform.rateLimitedRetrying");
    expect(limitedActivity).not.toContain("platform.loadFailed");

    // A real failure still shows the failure notice, even while another read is rate limited.
    snapshot.error = new BffError(503, "POST /api/v1/workspace-activity → 503",
      { class: ErrorClass.Precondition, reason: ReasonCode.DependencyUnavailable });
    const failed = markup({ rateLimited: true });
    expect(failed).toContain("platform.loadFailed");
    expect(failed).not.toContain("platform.rateLimitedRetrying");
  } finally { snapshot.failed = false; snapshot.error = undefined; }
  expect(markup({ failed: true })).toContain("platform.loadFailed");
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
  expect(snapshot.activity).toHaveBeenLastCalledWith({ items: [{ workspaceId: "one", messageType: "STREAM" }, { workspaceId: "two", messageType: "STREAM" }] });
});

it("reads every joined channel's window in one batched request instead of two reads per row", async () => {
  snapshot.activity.mockClear();
  snapshot.messages.mockImplementation(async (workspace: string) => ({ events: [{ id: "c".repeat(64), pubkey: "d".repeat(64), kind: 39006, created_at: 31,
    content: JSON.stringify({ has_more: false, next_cursor: null }), tags: [["h", `native-${workspace}`], ["d", `native-${workspace}:head`]] }] }));
  markup();
  await snapshot.query!({ signal: new AbortController().signal });
  expect(snapshot.activity).toHaveBeenCalledOnce();
});

it("does not start a per-row fallback when the admitted directory is unavailable", async () => {
  snapshot.activity.mockClear(); snapshot.channel.mockClear(); snapshot.messages.mockClear();
  renderToStaticMarkup(<ChannelSidebar principalId="me" workspaces={[{ id: "one", name: "One", slug: "one", isMember: true }]}
    selectedId="one" active reads={reads} preferencePending={false} onSelect={vi.fn()} onCreate={vi.fn()} onCreateForum={vi.fn()} onSetPreference={vi.fn()} />);
  await expect(snapshot.query!({ signal: new AbortController().signal })).rejects.toThrow("Channel directory changed");
  expect(snapshot.activity).not.toHaveBeenCalled();
  expect(snapshot.messages).not.toHaveBeenCalled();
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

it("the original local manual source uses native channel IDs and yields to a newer synced marker or revoked admission", () => {
  const page = (marker: number, member = true) => renderToStaticMarkup(<ChannelSidebar principalId="me"
    workspaces={[{id: "two", name: "Two", slug: "two", isMember: member}]}
    selectedId="two" active reads={{...reads, readAt: () => marker}} preferencePending={false}
    forcedUnread={{"native-two": {markerAtWhenForced: 20, sources: ["manual"]}}}
    onSelect={vi.fn()} onCreate={vi.fn()} onCreateForum={vi.fn()} onSetPreference={vi.fn()} />);
  snapshot.failed = false; snapshot.fetching = false;
  expect(page(20)).toContain('data-unread="true"');
  expect(page(21)).not.toContain('data-unread="true"');
  expect(page(20, false)).not.toContain('data-unread="true"');
  snapshot.fetching = true;
  try { expect(page(20)).not.toContain('data-unread="true"'); }
  finally { snapshot.fetching = false; }
});

it("ordinary sidebar mark-unread calls the original manual-source consumer, not a channel CAS rollback", async () => {
  snapshot.failed = false; snapshot.fetching = false;
  const write = vi.fn(async () => true);
  const markManual = vi.fn(); const clearManual = vi.fn();
  const page = (unknown: boolean) => <ChannelSidebar principalId="me"
    workspaces={[{id: "one", name: "One", slug: "one", isMember: true}]}
    selectedId="one" active reads={{...reads, unknown, write}} preferencePending={false}
    onMarkChannelUnread={markManual} onClearChannelManualUnread={clearManual}
    onSelect={vi.fn()} onCreate={vi.fn()} onCreateForum={vi.fn()} onSetPreference={vi.fn()} />;
  renderToStaticMarkup(page(false));
  snapshot.menus.get("one")!.markUnread!("one");
  expect(markManual).toHaveBeenCalledExactlyOnceWith("native-one");
  expect(write).not.toHaveBeenCalled();
  snapshot.menus.get("one")!.markRead!("one");
  await Promise.resolve(); await Promise.resolve();
  expect(write).toHaveBeenCalledTimes(1);
  expect(clearManual).toHaveBeenCalledExactlyOnceWith("native-one");
  renderToStaticMarkup(page(true));
  expect(snapshot.menus.get("one")!.markUnread).toBeUndefined();
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
  snapshot.types.two = "forum";
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
    snapshot.types.two = "stream";
    snapshot.channel.mockImplementation(async (workspace: string) => ({channelId:`native-${workspace}`,channelType:"stream"}));
  }
});

it("offers the original Leave on joined stream rows with a BFF leave hint and Archive hint reads on observed native IDs (DD-119)", () => {
  snapshot.failed = false; snapshot.fetching = false;
  const withLeave = ["one", "two"].map((id) => ({ id, visibility: "open", isMember: true, memberCount: 1, leaveActionKey: "workspace.leave",
    channel: { channelId: `native-${id}`, channelType: snapshot.types[id], name: id, archived: false } })) as unknown as ComponentProps<typeof ChannelSidebar>["directory"];
  const page = (rows: ComponentProps<typeof ChannelSidebar>["directory"], isMember = true) => renderToStaticMarkup(<ChannelSidebar principalId="me"
    workspaces={[{ id: "one", name: "One", slug: "one", isMember }, { id: "two", name: "Two", slug: "two", isMember }]} directory={rows}
    selectedId="one" active reads={reads} preferencePending={false}
    onSelect={vi.fn()} onCreate={vi.fn()} onCreateForum={vi.fn()} onSetPreference={vi.fn()} />);
  page(withLeave);
  expect(snapshot.menus.get("one")?.leave).toBeTypeOf("function");
  // Original Forums group has no Leave entry, but keeps the owner Archive entry.
  expect(snapshot.menus.get("two")?.leave).toBeUndefined();
  expect(snapshot.menus.get("one")?.owner).toMatchObject({ workspaceId: "one", channelId: "native-one" });
  expect(snapshot.menus.get("two")?.owner).toMatchObject({ workspaceId: "two", channelId: "native-two" });
  page(directory());
  expect(snapshot.menus.get("one")?.leave).toBeUndefined();
  page(withLeave, false);
  expect(snapshot.menus.get("one")?.owner).toBeUndefined();
  snapshot.failed = true;
  try { page(withLeave); expect(snapshot.menus.get("one")?.owner).toBeUndefined(); }
  finally { snapshot.failed = false; }
});

it("places an assigned joined stream channel in its original custom section, keyed by the native channel ID", async () => {
  snapshot.failed = false;
  snapshot.menus.clear();
  const assignChannel = vi.fn(async () => true);
  sectionPrefs.value = { writable: true, sections: [{ id: "s1", name: "Launch", order: 0 }], assignments: { "native-one": "s1" },
    sortModeFor: () => "alpha", setSortModeFor: vi.fn(async () => true), assignChannel, moveSection: vi.fn(async () => true),
    reorderSections: vi.fn(async () => true) };
  try {
    const html = markup({ state: { version: 3, readContexts: {}, workspacePreferences: {} } });
    const section = html.slice(html.indexOf('data-custom-section="Launch"'));
    expect(html).toContain('data-custom-section="Launch" data-disabled="false"');
    expect(section.slice(0, section.indexOf("</section>"))).toContain('data-drag="native-one"');
    const channels = html.slice(html.indexOf('data-group="sidebar.channels"'));
    expect(channels.slice(0, channels.indexOf("</section>"))).not.toContain('data-id="one"');
    // "Move to section" is offered for the stream row, not for the forum row.
    expect(snapshot.menus.get("one")?.section?.currentSectionId).toBe("s1");
    expect(snapshot.menus.get("two")?.section).toBeUndefined();
    snapshot.menus.get("one")?.section?.onUnassign();
    await vi.waitFor(() => expect(assignChannel).toHaveBeenCalledWith("native-one", null));
  } finally {
    sectionPrefs.value = null;
  }
});

it("keeps section controls inert while the Core preferences are unconfirmed and hides them without a provider", () => {
  snapshot.failed = false;
  snapshot.menus.clear();
  sectionPrefs.value = { writable: false, sections: [{ id: "s1", name: "Launch", order: 0 }], assignments: {},
    sortModeFor: () => "alpha", setSortModeFor: vi.fn(), assignChannel: vi.fn(), moveSection: vi.fn(), reorderSections: vi.fn() };
  try {
    const html = markup({ state: { version: 3, readContexts: {}, workspacePreferences: {} } });
    expect(html).toContain('data-custom-section="Launch" data-disabled="true"');
    expect(snapshot.menus.get("one")?.section?.disabled).toBe(true);
  } finally {
    sectionPrefs.value = null;
  }
  snapshot.menus.clear();
  const html = markup();
  expect(html).not.toContain("data-custom-section");
  expect(html).not.toContain("data-drag");
  expect(snapshot.menus.get("one")?.section).toBeUndefined();
});
it("shows the original working badge and activity popover only on channels where an Agent works (DD-125(6))", () => {
  snapshot.failed = false;
  working.value = [{ channelId: "one", anchorAt: 1, agentCount: 2, agentPubkeys: ["a".repeat(64), "b".repeat(64)], source: "turn" }];
  const html = markup();
  expect(html).toContain('data-working="one" data-working-count="2" data-working-active="false"');
  expect(html).toContain('data-activity-popover="one"');
  expect(html).not.toContain('data-working="two"');
  expect(html).toContain('data-activity-popover="none"');
  working.value = [];
  expect(markup()).not.toContain("data-working=");
});
