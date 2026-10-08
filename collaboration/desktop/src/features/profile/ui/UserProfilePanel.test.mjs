import assert from "node:assert/strict";
import { after, test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
Object.assign(globalThis, {
  window: dom.window, self: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
  Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, SVGElement: dom.window.SVGElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  HTMLIFrameElement: dom.window.HTMLIFrameElement, getComputedStyle: dom.window.getComputedStyle,
  Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
  MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
});
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.requestAnimationFrame = globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
window.cancelAnimationFrame = globalThis.cancelAnimationFrame = clearTimeout;
let readProfile;
window.__TAURI_INTERNALS__ = globalThis.__TAURI_INTERNALS__ = {
  invoke: (command, args) => {
    assert.equal(command, "get_user_profile");
    return readProfile(args.pubkey);
  },
};
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } = await import("@tanstack/react-router");
const { ActiveCommunityProvider } = await import("@/features/platform/activeCommunity");
const { UserProfilePanel } = await import("./UserProfilePanel.tsx");
const { UserProfilePopover } = await import("./UserProfilePopover.tsx");
const { ProfilePanelProvider } = await import("@/shared/context/ProfilePanelContext");
const { setLocale } = await import("@client-kit/platform/i18n");
const own = "a".repeat(64), peer = "b".repeat(64);
const session = (host = "one.test") => ({ facts: { communityHost: host, relayUrl: `wss://${host}` }, devicePubkey: own, displayName: null });
const profile = (pubkey, name = "Actual peer") => ({ pubkey, display_name: name, avatar_url: null, about: "Public biography", nip05_handle: null, owner_pubkey: null });
after(() => dom.window.close());

async function mount(pubkey = peer) {
  setLocale("en");
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); let closed = 0;
  const base = createRootRoute();
  const panel = createRoute({ getParentRoute: () => base, path: "/", component: () =>
    React.createElement(UserProfilePanel, { pubkey, widthPx: 360, onClose: () => { closed++; } }) });
  const message = createRoute({ getParentRoute: () => base, path: "/messages/new", validateSearch: (search) => search,
    component: () => React.createElement("p", null, "Governed new message") });
  const router = createRouter({ routeTree: base.addChildren([panel, message]), history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  async function render(current) {
    await act(async () => root.render(React.createElement(QueryClientProvider, { client: cache },
      React.createElement(ActiveCommunityProvider, { session: current }, React.createElement(RouterProvider, { router })))));
  }
  await render(session());
  return { host, router, render, closed: () => closed, async close() { await act(async () => root.unmount()); cache.clear(); host.remove(); } };
}
async function until(check) {
  for (let index = 0; index < 40; index++) {
    if (check()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  }
  assert.ok(check(), "expected mounted profile state");
}

test("original Message tile navigates using the verified native profile and existing route", async () => {
  readProfile = async (pubkey) => profile(pubkey);
  const view = await mount();
  try {
    await until(() => view.host.querySelector('[data-testid="user-profile-message"]'));
    await act(async () => view.host.querySelector('[data-testid="user-profile-message"]').click());
    await until(() => view.router.state.location.pathname === "/messages/new");
    assert.equal(view.router.state.location.search.pubkey, peer);
  } finally { await view.close(); }
});

test("a failed native profile read or own identity offers no Message action", async () => {
  readProfile = async () => { throw new Error("Profile not admitted"); };
  const failed = await mount();
  try {
    await until(() => failed.host.querySelector('[role="alert"]'));
    assert.equal(failed.host.querySelector('[data-testid="user-profile-message"]'), null);
  } finally { await failed.close(); }
  readProfile = async (pubkey) => profile(pubkey);
  const self = await mount(own);
  try {
    await until(() => self.host.textContent.includes("Public biography"));
    assert.equal(self.host.querySelector('[data-testid="user-profile-message"]'), null);
  } finally { await self.close(); }
});

test("scope switch hides cached data and rejects a late old-community result", async () => {
  let finishOld;
  readProfile = () => new Promise((resolve) => { finishOld = resolve; });
  const view = await mount();
  try {
    await until(() => finishOld);
    let finishNew;
    readProfile = () => new Promise((resolve) => { finishNew = resolve; });
    await view.render(session("two.test"));
    assert.equal(view.host.querySelector('[data-testid="user-profile-message"]'), null);
    await until(() => finishNew);
    await act(async () => finishNew(profile(peer, "New community peer")));
    await until(() => view.host.textContent.includes("New community peer"));
    await act(async () => finishOld(profile(peer, "Old community peer")));
    assert.equal(view.host.textContent.includes("Old community peer"), false);
    assert.ok(view.host.textContent.includes("New community peer"));
  } finally { await view.close(); }
});

async function mountPopover(role) {
  setLocale("en");
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); const opened = [];
  async function render(current) {
    await act(async () => root.render(React.createElement(QueryClientProvider, { client: cache },
      React.createElement(ActiveCommunityProvider, { session: current },
        React.createElement(ProfilePanelProvider, { onOpenProfilePanel: (key) => opened.push(key) },
          React.createElement(UserProfilePopover, { pubkey: peer, role, triggerElement: "span", triggerTestId: "original-profile-trigger" },
            React.createElement("span", null, "Agent-looking label")))))));
  }
  await render(session());
  async function hover() {
    await act(async () => host.querySelector('[data-testid="original-profile-trigger"]')
      .dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true })));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 550)));
  }
  return { host, opened, render, hover, async close() { await act(async () => root.unmount()); cache.clear(); host.remove(); } };
}

test("native hover uses the same original lazy surface and supplied Agent role, never its display name", async () => {
  for (const role of ["bot", undefined]) {
    let reads = 0;
    readProfile = async (pubkey) => { reads++; return profile(pubkey); };
    const view = await mountPopover(role);
    try {
      assert.equal(reads, 0);
      await view.hover();
      await until(() => document.querySelector('[data-testid="user-profile-description"]'));
      const avatar = document.querySelector('[data-testid="user-profile-popover-avatar"]');
      assert.equal(avatar.classList.contains("rounded-squircle"), role === "bot");
      assert.equal(reads, 1);
      await act(async () => view.host.querySelector('[data-testid="original-profile-trigger"]').click());
      assert.deepEqual(view.opened, [peer]);
      assert.equal(document.querySelector('[data-testid="user-profile-popover"]'), null);
    } finally { await view.close(); }
  }
});

test("native hover clears a cached or late old-scope profile and rejects mismatched identity", async () => {
  let finishOld;
  readProfile = () => new Promise((resolve) => { finishOld = resolve; });
  const view = await mountPopover("bot");
  try {
    await view.hover();
    await until(() => finishOld);
    let finishNew;
    readProfile = () => new Promise((resolve) => { finishNew = resolve; });
    await view.render(session("two.test"));
    await until(() => finishNew);
    await act(async () => finishNew(profile(peer, "New community author")));
    await until(() => document.body.textContent.includes("New community author"));
    await act(async () => finishOld(profile(peer, "Old community author")));
    assert.equal(document.body.textContent.includes("Old community author"), false);
    readProfile = async () => profile(own, "Wrong identity");
    await view.render(session("three.test"));
    await until(() => document.querySelector('[data-testid="user-profile-popover"] [role="alert"]'));
    assert.equal(document.body.textContent.includes("New community author"), false);
    assert.equal(document.body.textContent.includes("Wrong identity"), false);
  } finally { await view.close(); }
});
