// Top 30 #3: the Desktop AppSidebar mounts the shared custom sections (DD-125(5)) and the
// shared Agent working badge (DD-125(6)) over its own native channel list.
import assert from "node:assert/strict";
import test from "node:test";

import { bucketChannelsBySection, sectionActionsFor } from "../lib/desktopChannelSections.ts";

const channel = (id, name, extra = {}) => ({
  id, name, channelType: "stream", visibility: "open", isMember: true, description: "", archivedAt: null,
  lastMessageAt: null, memberCount: 2, memberPubkeys: [], participantPubkeys: [], participants: [],
  purpose: null, topic: null, ttlDeadline: null, ttlSeconds: null, ...extra,
});

test("original sectionBuckets: only live sections take channels, the rest stay in Channels", () => {
  const alpha = channel("native-a", "alpha");
  const beta = channel("native-b", "beta");
  const gamma = channel("native-c", "gamma");
  const { bySection, unassigned } = bucketChannelsBySection(
    [alpha, beta, gamma],
    [{ id: "focus" }],
    { "native-a": "focus", "native-c": "deleted-section" },
  );
  assert.deepEqual(bySection.get("focus"), [alpha]);
  // An assignment to a section that no longer exists is kept in Core but not rendered.
  assert.deepEqual(unassigned, [beta, gamma]);
});

test("Move to section writes the native channel ID and stays inert while Core is not writable", () => {
  const writes = [];
  const run = (write) => { writes.push(write); };
  const preferences = {
    sections: [{ id: "focus", name: "Focus", order: 0 }],
    assignments: { "native-a": "focus" },
    writable: false,
    assignChannel: (channelId, sectionId) => Promise.resolve(`${channelId}->${sectionId}`),
  };
  const created = [];
  const actions = sectionActionsFor(preferences, "native-a", run, (id) => created.push(id));
  assert.equal(actions.currentSectionId, "focus");
  assert.equal(actions.disabled, true);
  actions.onAssign("focus");
  actions.onUnassign();
  actions.onCreateSection();
  assert.deepEqual(created, ["native-a"]);
  assert.equal(writes.length, 2);
  assert.equal(sectionActionsFor(null, "native-a", run, () => {}), undefined);
});

async function mountSidebar({ preferences, working } = {}) {
  const { JSDOM } = await import("jsdom");
  const React = await import("react");
  const { act } = React;
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://native.test", pretendToBeVisual: true });
  const oldGlobals = new Map();
  const globals = {
    window: dom.window, self: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    HTMLIFrameElement: dom.window.HTMLIFrameElement, SVGElement: dom.window.SVGElement,
    Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, Element: dom.window.Element,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
    MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
  };
  for (const [key, value] of Object.entries(globals)) {
    oldGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } = await import("@tanstack/react-router");
  const { PlatformProvider } = await import("@client-kit/platform/react/context");
  const { createBffClient } = await import("@client-kit/platform/client");
  const { ConversationVisibilityProvider } = await import("@client-kit/platform/react/new-message");
  const { CollaborationPreferencesProvider } = await import("@client-kit/platform/react/collaboration-preferences");
  const { reportChannelBotTyping, resetAgentWorkingSignal } = await import("@client-kit/platform/react/agent-activity");
  const { ActiveCommunityProvider } = await import("@/features/platform/activeCommunity");
  const { SidebarProvider } = await import("@/shared/ui/sidebar");
  const { AppSidebar } = await import("@/features/sidebar/ui/AppSidebar");
  const { setLocale } = await import("@client-kit/platform/i18n");
  setLocale("en");
  const own = "a".repeat(64);
  const directoryRow = (id, channelId, name) => ({
    id, visibility: "open", isMember: true, memberCount: 2, membershipState: "ACTIVE", createdAt: "2026-10-01T00:00:00Z",
    channel: { channelId, channelType: "stream", name, archived: false },
  });
  const bff = createBffClient({ send: async (request) => {
    if (request.path === "/api/v1/session") return { status: 200, body: { accessMode: "FULL", tenantPrincipalId: "viewer" } };
    if (request.path.startsWith("/api/v1/discoverable-workspaces")) return { status: 200, body: { items: [
      directoryRow("ws-a", "native-a", "alpha"), directoryRow("ws-b", "native-b", "beta"),
    ] } };
    if (request.path.startsWith("/api/v1/conversations")) return { status: 200, body: { items: [] } };
    return { status: 403, body: { code: "PermissionDenied", message: "Not admitted in this fixture" } };
  } });
  const session = { facts: { communityHost: "native.test", relayUrl: "wss://native.test" }, devicePubkey: own, client: bff };
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  cache.setQueryData(["identity"], { pubkey: own, displayName: "Viewer" });
  cache.setQueryData(["home-feed", session.facts.relayUrl, own], { feed: { activity: [], mentions: [] }, meta: {} });
  if (working) reportChannelBotTyping(working.scopeId, [working.agent]);
  const visibility = { read: async () => new Set(), prepare: async () => async () => {} };
  const noop = () => {};
  const base = createRootRoute();
  const page = createRoute({ getParentRoute: () => base, path: "/", component: () => React.createElement(AppSidebar, {
    activeCommunity: { id: "community", name: "Test community", relayUrl: session.facts.relayUrl },
    channels: [channel("native-a", "alpha"), channel("native-b", "beta")],
    searchChannels: [], currentPubkey: own, currentPrincipalId: "viewer",
    homeBadgeCount: 0, isLoading: false, relayConnectionCard: { showSidebarRelayConnectionCard: false },
    selectedChannelId: null, selectedView: "home", selectedPlatformSection: null,
    unreadChannelIds: new Set(), highPriorityUnreadChannelIds: new Set(), previewActivityChannelIds: new Set(),
    searchFocusRequests: [0, 0], onSelectChannel: noop, onOpenSearchResult: noop, onNewMessage: noop,
    onSelectHome: noop, onSelectSettings: noop, onSelectPlatformSection: noop, onSelectApplication: noop,
    onSignOut: noop, onMarkChannelUnread: noop, onMarkChannelRead: noop, onMarkAllChannelsRead: noop,
  }) });
  const router = createRouter({ routeTree: base.addChildren([page]), history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  const root = createRoot(dom.window.document.getElementById("root"));
  const sidebar = React.createElement(SidebarProvider, null, React.createElement(RouterProvider, { router }));
  await act(async () => root.render(React.createElement(QueryClientProvider, { client: cache },
    React.createElement(PlatformProvider, { client: bff, locale: "en" },
      React.createElement(ActiveCommunityProvider, { session },
        React.createElement(ConversationVisibilityProvider, { value: visibility },
          preferences ? React.createElement(CollaborationPreferencesProvider, { value: preferences }, sidebar) : sidebar))))));
  const until = async (check, label) => {
    for (let index = 0; index < 80 && !check(); index++)
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    assert.ok(check(), `expected ${label}`);
  };
  const dispatch = async (element, type) => {
    await act(async () => { element.dispatchEvent(new dom.window.Event(type, { bubbles: true, cancelable: true })); });
  };
  return { document: dom.window.document, until, dispatch, async close() {
    await act(async () => root.unmount()); cache.clear(); resetAgentWorkingSignal(); dom.window.close();
    for (const [key, descriptor] of oldGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  } };
}

function preferenceActions(writes) {
  const write = (entry) => { writes.push(entry); return Promise.resolve(true); };
  return {
    state: null,
    writable: true,
    isFollowingThread: () => false,
    isThreadMuted: () => false,
    isNotifiedForThread: () => false,
    followThread: () => write("follow"),
    unfollowThread: () => write("unfollow"),
    sections: [{ id: "focus", name: "Focus", order: 0 }],
    assignments: { "native-a": "focus" },
    createSection: async () => null,
    renameSection: () => write("rename"),
    deleteSection: () => write("delete"),
    moveSection: () => write("move"),
    reorderSections: () => write("reorder"),
    assignChannel: (channelId, sectionId) => write(`assign:${channelId}:${sectionId}`),
    sortModeFor: () => "alpha",
    setSortModeFor: () => write("sort"),
    templates: [],
    saveTemplate: async () => null,
    deleteTemplate: () => write("delete-template"),
    isFollowing: () => false,
    setFollowing: () => write("follow-principal"),
  };
}

test("Desktop sidebar renders the shared custom section from Core preferences, keyed by native ID", async () => {
  const writes = [];
  const view = await mountSidebar({ preferences: preferenceActions(writes) });
  try {
    await view.until(() => view.document.querySelector('[data-testid="custom-section-focus"]'), "the custom section");
    const section = view.document.querySelector('[data-testid="custom-section-focus"]');
    assert.match(section.textContent, /Focus/);
    assert.ok(section.querySelector('[data-testid="channel-alpha"]'), "assigned channel renders in its section");
    assert.equal(section.querySelector('[data-testid="channel-beta"]'), null);
    const channels = view.document.querySelector('[data-testid="stream-list"]');
    assert.ok(channels.querySelector('[data-testid="channel-beta"]'), "unassigned channel stays in Channels");
    assert.equal(channels.querySelector('[data-testid="channel-alpha"]'), null);
    assert.deepEqual(writes, []);

    // Original SidebarDnd: dropping a Channels row on the section assigns its native ID.
    const beta = channels.querySelector('[data-testid="channel-beta"]').closest('[draggable="true"]');
    assert.ok(beta, "Channels rows are draggable onto sections");
    await view.dispatch(beta, "dragstart");
    await view.dispatch(view.document.querySelector('[data-sidebar-drop-target="section:focus"]'), "drop");
    await view.until(() => writes.includes("assign:native-b:focus"), "the assign write");

    // Dropping a section row back on Channels leaves its section.
    const alpha = section.querySelector('[data-testid="channel-alpha"]').closest('[draggable="true"]');
    await view.dispatch(alpha, "dragstart");
    await view.dispatch(view.document.querySelector('[data-sidebar-drop-target="ungrouped"]'), "drop");
    await view.until(() => writes.includes("assign:native-a:null"), "the unassign write");
  } finally {
    await view.close();
  }
});

test("without the Core preference provider the original Channels group renders alone", async () => {
  const view = await mountSidebar();
  try {
    await view.until(() => view.document.querySelector('[data-testid="stream-list"] [data-testid="channel-alpha"]'), "Channels");
    assert.equal(view.document.querySelector('[data-testid^="custom-section-"]'), null);
    assert.equal(view.document.querySelector('[data-testid="stream-list"] [draggable="true"]'), null);
  } finally {
    await view.close();
  }
});

test("the shared working signal marks the admitted native channel row once the directory resolves", async () => {
  const agent = "c".repeat(64);
  const view = await mountSidebar({ working: { scopeId: "ws-a", agent } });
  try {
    // Signal key (Workspace) → native row through the BFF directory: wait for the final state.
    await view.until(() => view.document.querySelector('[data-testid="channel-working-alpha"]'), "the working badge");
    assert.match(view.document.querySelector('[data-testid="channel-working-alpha"]').textContent, /Working/);
    assert.equal(view.document.querySelector('[data-testid="channel-working-beta"]'), null);
  } finally {
    await view.close();
  }
});
