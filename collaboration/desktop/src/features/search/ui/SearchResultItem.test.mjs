import assert from "node:assert/strict";
import test from "node:test";
import { Bot, FileText, Hash, MessageCircle, User } from "lucide-react";
import { resultIcon, resultKey, resultTestId } from "./SearchResultItem.tsx";

test("original result icons consume actual channel type and agent facts", () => {
  const channels = new Map([
    ["stream", { id: "stream", channelType: "stream" }],
    ["forum", { id: "forum", channelType: "forum" }],
    ["dm", { id: "dm", channelType: "dm" }],
  ]);
  for (const [id, Icon] of [["stream", Hash], ["forum", FileText], ["dm", MessageCircle]]) {
    assert.strictEqual(resultIcon({ kind: "channel", channel: channels.get(id) }, channels), Icon);
    assert.strictEqual(resultIcon({ kind: "message", hit: { channelId: id } }, channels), Icon);
  }
  assert.strictEqual(resultIcon({ kind: "user", user: { isAgent: true } }, channels), Bot);
  assert.strictEqual(resultIcon({ kind: "user", user: { isAgent: false } }, channels), User);
  assert.strictEqual(resultIcon({ kind: "message", hit: { channelId: null } }, channels), Hash);
  assert.strictEqual(resultIcon({ kind: "message", hit: { channelId: "unavailable" } }, channels), Hash);
});

test("restored icons preserve the existing actual result identity and selectors", () => {
  for (const [result, key, testId] of [
    [{ kind: "channel", channel: { id: "channel" } }, "channel-channel", "search-result-channel-channel"],
    [{ kind: "user", user: { pubkey: "pubkey" } }, "user-pubkey", "search-result-user-pubkey"],
    [{ kind: "message", hit: { eventId: "event" } }, "message-event", "search-result-event"],
    [{ kind: "action", action: { id: "browse-channels" } }, "action-browse-channels", "search-result-action-browse-channels"],
  ]) {
    assert.equal(resultKey(result), key);
    assert.equal(resultTestId(result), testId);
  }
});

test("actual native search suggestions render original channel icons and retain navigation", async () => {
  const { JSDOM } = await import("jsdom");
  const { createElement, act } = await import("react");
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://native.test",
    pretendToBeVisual: true,
  });
  const oldGlobals = new Map();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    Node: dom.window.Node,
    Element: dom.window.Element,
    NodeFilter: dom.window.NodeFilter,
    CustomEvent: dom.window.CustomEvent,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    oldGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { ActiveCommunityProvider } = await import("@/features/platform/activeCommunity");
  const { TopbarSearch } = await import("./TopbarSearch.tsx");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const channels = ["stream", "forum", "dm"].map((channelType) => ({
    id: channelType,
    name: channelType,
    channelType,
    description: "",
    isMember: true,
    archivedAt: null,
    lastMessageAt: null,
    participants: [],
    participantPubkeys: [],
  }));
  const opened = [];
  const browse = [];
  const create = [];
  const session = { facts: { communityHost: "native.test", relayUrl: "wss://native.test" } };
  const root = createRoot(dom.window.document.getElementById("root"));
  const settle = async () => {
    for (let index = 0; index < 4; index++) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    }
  };
  const open = async () => {
    await act(async () => dom.window.document.querySelector('[data-testid="open-search"]').click());
    await settle();
  };
  try {
    await act(async () => root.render(createElement(QueryClientProvider, { client },
      createElement(ActiveCommunityProvider, { session }, createElement(TopbarSearch, {
        channels,
        channelLabels: { dm: "Actual DM recipient" },
        onBrowseChannels: () => browse.push("browse"),
        onCreateChannel: () => create.push("create"),
        onOpenChannel: (id) => opened.push(id),
        onOpenResult: () => assert.fail("channel suggestions must retain channel navigation"),
      })))));
    await open();
    for (const [id, iconClass] of [["stream", "lucide-hash"], ["forum", "lucide-file-text"], ["dm", "lucide-message-circle"]]) {
      const row = dom.window.document.querySelector(`[data-testid="search-result-channel-${id}"]`);
      assert.ok(row, `actual search renders the ${id} suggestion`);
      assert.ok(row.querySelector(`svg.${iconClass}`), `actual ${id} row retains the original icon`);
    }
    assert.equal(dom.window.document.querySelector('[data-testid="search-result-channel-dm"]').textContent, "Actual DM recipient");
    assert.equal(dom.window.document.querySelector('[data-testid="search-result-action-create-agent"]'), null,
      "unavailable Agent creation must not acquire a pretend action");
    await act(async () => dom.window.document.querySelector('[data-testid="search-result-channel-forum"]').click());
    assert.deepEqual(opened, ["forum"]);
    await open();
    await act(async () => dom.window.document.querySelector('[data-testid="search-result-channel-dm"]').click());
    assert.deepEqual(opened, ["forum", "dm"]);
    await open();
    await act(async () => dom.window.document.querySelector('[data-testid="search-result-action-browse-channels"]').click());
    assert.deepEqual(browse, []);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 190)); });
    assert.deepEqual(browse, ["browse"]);
    await open();
    await act(async () => dom.window.document.querySelector('[data-testid="search-result-action-create-channel"]').click());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 190)); });
    assert.deepEqual(create, ["create"]);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    dom.window.close();
    for (const [key, descriptor] of oldGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

async function mountOriginalPeopleSidebar({ unknown = false } = {}) {
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
  const { TransportError } = await import("@client-kit/platform/transport");
  const { ConversationVisibilityProvider } = await import("@client-kit/platform/react/new-message");
  const { ActiveCommunityProvider } = await import("@/features/platform/activeCommunity");
  const { SidebarProvider } = await import("@/shared/ui/sidebar");
  const { AppSidebar } = await import("@/features/sidebar/ui/AppSidebar");
  const { toast } = await import("sonner");
  const { setLocale } = await import("@client-kit/platform/i18n");
  setLocale("en");
  const own = "a".repeat(64), peer = "b".repeat(64);
  const selected = [], requests = [], notices = [];
  let active = false;
  const bff = createBffClient({ send: async (request) => {
    requests.push(request);
    if (request.path === "/api/v1/session") return { status: 200, body: { accessMode: "FULL", tenantPrincipalId: "viewer" } };
    if (request.path.startsWith("/api/v1/conversation-participants")) return { status: 200, body: { maxParticipants: 9,
      items: [{ principalId: "viewer", displayName: "Viewer", pubkeys: [own] },
        { principalId: "peer", displayName: "Directory peer", pubkeys: [peer] }] } };
    if (request.path === "/api/v1/actions") {
      if (unknown) throw new TransportError("lost action receipt");
      active = true;
      return { status: 202, body: { actionKey: "conversation.open", actionExecutionId: "execution", operationId: "operation", gateState: "ALLOWED", dispatchState: "DISPATCHED" } };
    }
    if (request.path.startsWith("/api/v1/conversations")) return { status: 200, body: { items: active
      ? [{ id: "dm", channelId: "actual-native-channel", state: "ACTIVE", participantPrincipalIds: ["peer", "viewer"], operationId: "operation", version: 1 }] : [] } };
    if (request.path === "/api/v1/roles/workspaces") return { status: 200, body: { workspaces: [] } };
    return { status: 403, body: { code: "PermissionDenied", message: "Not admitted in this fixture" } };
  } });
  const session = { facts: { communityHost: "native.test", relayUrl: "wss://native.test" }, devicePubkey: own, client: bff };
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  cache.setQueryData(["identity"], { pubkey: own, displayName: "Viewer" });
  cache.setQueryData(["home-feed", session.facts.relayUrl, own], { feed: { activity: [], mentions: [] }, meta: {} });
  cache.setQueryData(["user-search", "target", 40], [{ pubkey: peer, displayName: "Target peer", avatarUrl: null, nip05Handle: null, isAgent: false }]);
  cache.setQueryData(["user-search", "", 100], []);
  cache.setQueryData(["search-messages", "target", 40, null, null, null, null, false], { hits: [], found: 0 });
  const visibility = { read: async () => new Set(), prepare: async () => async () => {} };
  const noop = () => {};
  const base = createRootRoute();
  const page = createRoute({ getParentRoute: () => base, path: "/", component: () => React.createElement(AppSidebar, {
    activeCommunity: { id: "community", name: "Test community", relayUrl: session.facts.relayUrl },
    channels: [], searchChannels: [], currentPubkey: own, currentPrincipalId: "viewer",
    homeBadgeCount: 0, isLoading: false, relayConnectionCard: { showSidebarRelayConnectionCard: false },
    selectedChannelId: null, selectedView: "home", selectedPlatformSection: null,
    unreadChannelIds: new Set(), highPriorityUnreadChannelIds: new Set(), previewActivityChannelIds: new Set(),
    searchFocusRequests: [0, 0], onSelectChannel: (id) => selected.push(id),
    onOpenSearchResult: () => assert.fail("People must consume the original direct-DM action"),
    onNewMessage: () => assert.fail("People must not open an empty compose surface"),
    onSelectHome: noop, onSelectSettings: noop, onSelectPlatformSection: noop, onSelectApplication: noop,
    onSignOut: noop, onMarkChannelUnread: noop, onMarkChannelRead: noop, onMarkAllChannelsRead: noop,
  }) });
  const router = createRouter({ routeTree: base.addChildren([page]), history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  const root = createRoot(dom.window.document.getElementById("root"));
  const originalToastError = toast.error;
  toast.error = (message) => { notices.push(message); return "notice"; };
  await act(async () => root.render(React.createElement(QueryClientProvider, { client: cache },
    React.createElement(PlatformProvider, { client: bff, locale: "en" },
      React.createElement(ActiveCommunityProvider, { session },
        React.createElement(ConversationVisibilityProvider, { value: visibility },
          React.createElement(SidebarProvider, null, React.createElement(RouterProvider, { router }))))))));
  const until = async (check) => {
    for (let index = 0; index < 60 && !check(); index++)
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    assert.ok(check(), `expected original native People consumer state: ${dom.window.document.querySelector('[data-testid="search-results"]')?.textContent}`);
  };
  return { selected, requests, notices, until, async choosePeer() {
    await act(async () => dom.window.document.querySelector('[data-testid="open-search"]').click());
    await until(() => dom.window.document.querySelector('[data-testid="search-results"] input'));
    const input = dom.window.document.querySelector('[data-testid="search-results"] input');
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, "target");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await until(() => dom.window.document.querySelector(`[data-testid="search-result-user-${peer}"]`));
    await act(async () => dom.window.document.querySelector(`[data-testid="search-result-user-${peer}"]`).click());
  }, async close() {
    await act(async () => root.unmount()); cache.clear(); toast.error = originalToastError; dom.window.close();
    for (const [key, descriptor] of oldGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  } };
}

test("actual original People row opens its governed ACTIVE DM through the mounted Sidebar", async () => {
  const view = await mountOriginalPeopleSidebar();
  try {
    await view.choosePeer();
    await view.until(() => view.selected.length === 1);
    assert.deepEqual(view.selected, ["actual-native-channel"]);
    const writes = view.requests.filter((request) => request.method === "POST");
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].body.conversationOpen.participantPrincipalIds, ["peer", "viewer"]);
    assert.equal(view.notices.length, 0);
  } finally { await view.close(); }
});

test("actual original People row never navigates on UNKNOWN and keeps its original command", async () => {
  const view = await mountOriginalPeopleSidebar({ unknown: true });
  try {
    await view.choosePeer(); await view.until(() => view.notices.length === 1);
    assert.deepEqual(view.selected, []);
    assert.equal(view.notices[0], "The direct message outcome is not yet known.");
    await view.choosePeer(); await view.until(() => view.notices.length === 2);
    const writes = view.requests.filter((request) => request.method === "POST");
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1].body, writes[0].body);
    assert.deepEqual(view.selected, []);
  } finally { await view.close(); }
});
