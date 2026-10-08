import assert from "node:assert/strict";
// @vitest-environment jsdom
import { afterAll as after, test } from "vitest";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
Object.assign(globalThis, {
  window: dom.window, self: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  NodeFilter: dom.window.NodeFilter, SVGElement: dom.window.SVGElement,
  HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  HTMLIFrameElement: dom.window.HTMLIFrameElement, getComputedStyle: dom.window.getComputedStyle,
  Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, File: dom.window.File,
  MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  fetch: async () => ({ ok: false }),
});
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.requestAnimationFrame = globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
window.cancelAnimationFrame = globalThis.cancelAnimationFrame = clearTimeout;
let blobs = 0;
URL.createObjectURL = () => `blob:profile-${++blobs}`;
URL.revokeObjectURL = () => {};
globalThis.Image = class {
  set src(_url) { Promise.resolve().then(() => this.onload?.()); }
};
let readProfile, writeProfile, uploadAvatar;
window.__TAURI_INTERNALS__ = globalThis.__TAURI_INTERNALS__ = {
  transformCallback: () => 1,
  invoke: async (command, args) => {
    if (command === "get_profile") return readProfile();
    if (command === "update_profile") return writeProfile(args);
    if (command === "upload_profile_avatar") return uploadAvatar(args);
    if (command.startsWith("plugin:event|")) return 1;
    throw new Error(`Unexpected native command: ${command}`);
  },
};
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ActiveCommunityProvider, useNativeSession } = await import("@/features/platform/activeCommunity");
const { ThemeProvider } = await import("@/shared/theme/ThemeProvider");
const { ProfileSettingsCard } = await import("../../src/features/settings/ui/ProfileSettingsCard.tsx");
const { useProfileQuery, useUpdateProfileMutation, useSelfProfileCache } = await import("@/features/profile/hooks");
const { readSelfProfileCache, writeSelfProfileCache } = await import("@/features/profile/lib/selfProfileStorage");
const { PlatformProvider } = await import("@client-kit/platform/react/context");
const { setLocale } = await import("@client-kit/platform/i18n");
const { getAvatarPresentation, resetAvatarPresentations } = await import("../../node_modules/@client-kit/platform/src/react/profile/buzz/features/profile/avatarPresentationStore.ts");
const own = "a".repeat(64);
const client = {};
const session = (host = "one.test", pubkey = own) => ({
  facts: { communityHost: host, relayUrl: `wss://${host}` }, devicePubkey: pubkey, client, displayName: null,
});
const profile = (name = "Original", pubkey = own, avatar = null) => ({
  pubkey, display_name: name, avatar_url: avatar, about: "Biography", nip05_handle: null,
  owner_pubkey: null, has_profile_event: true,
});
after(() => dom.window.close());

async function mount(Component = ProfileSettingsCard) {
  localStorage.clear(); setLocale("en");
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  async function render(current) {
    await act(async () => root.render(React.createElement(QueryClientProvider, { client: cache },
      React.createElement(PlatformProvider, { client: current.client, locale: "en" },
        React.createElement(ActiveCommunityProvider, { session: current },
          React.createElement(ThemeProvider, null, React.createElement(Component)))))));
  }
  await render(session());
  return { host, cache, render, async close() {
    await act(async () => root.unmount()); cache.clear(); host.remove(); resetAvatarPresentations();
  } };
}
async function until(check) {
  for (let index = 0; index < 60; index++) {
    if (check()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  }
  assert.ok(check(), "expected actual native profile state");
}
async function click(view, testId) {
  const button = view.host.querySelector(`[data-testid="${testId}"]`);
  assert.ok(button); await act(async () => button.click());
}
async function chooseAvatar(view) {
  await click(view, "profile-avatar-edit");
  await until(() => view.host.querySelector('input[type="file"]'));
  const input = view.host.querySelector('input[type="file"]');
  const file = new File([new Uint8Array([137, 80, 78, 71])], "avatar.png", { type: "image/png" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([137, 80, 78, 71]).buffer });
  Object.defineProperty(input, "files", { value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}

test("the actual native original avatar controls upload bytes then save only the canonical avatar", async () => {
  const url = "https://one.test/media/avatar.png";
  const uploads = [], writes = [];
  readProfile = async () => profile();
  uploadAvatar = async (args) => { uploads.push(args); return { url, type: "image/png" }; };
  writeProfile = async (args) => { writes.push(args); return profile("Canonical name", own, url); };
  const view = await mount();
  try {
    await until(() => view.host.querySelector('[data-testid="profile-avatar-edit"]'));
    await chooseAvatar(view);
    await until(() => uploads.length === 1 && !view.host.querySelector('input[type="file"]').disabled);
    assert.deepEqual(uploads, [{ data: [137, 80, 78, 71], expectedRelayUrl: "wss://one.test", expectedSignerPubkey: own }]);
    await click(view, "profile-avatar-done");
    await until(() => view.host.textContent.includes("Saved and read back"));
    assert.equal(writes.length, 1);
    assert.equal(writes[0].avatarUrl, url);
    assert.equal(writes[0].expectedPubkey, own);
    assert.equal(writes[0].expectedSignerPubkey, own);
    assert.equal(writes[0].expectedRelayUrl, "wss://one.test");
    assert.equal("displayName" in writes[0], false);
    assert.equal("about" in writes[0], false);
    assert.equal(view.host.querySelector('[data-testid="profile-display-name-value"]').textContent, "Canonical name");
    assert.equal(view.cache.getQueryData(["profile", "one.test", "wss://one.test", own]).avatarUrl, url);
  } finally { await view.close(); }
});

test("Community and signing identity partition the real native profile query, including late reads", async () => {
  readProfile = async () => profile("First community");
  const view = await mount();
  try {
    await until(() => view.host.textContent.includes("First community"));
    let finishOld;
    readProfile = () => new Promise((resolve) => { finishOld = resolve; });
    await view.render(session("two.test"));
    assert.equal(view.host.textContent.includes("First community"), false);
    await until(() => finishOld);
    const other = "b".repeat(64);
    readProfile = async () => profile("Current identity", other);
    await view.render(session("three.test", other));
    await until(() => view.host.textContent.includes("Current identity"));
    await act(async () => finishOld(profile("Late old identity")));
    assert.equal(view.host.textContent.includes("Late old identity"), false);
    assert.equal(view.cache.getQueryData(["profile", "two.test", "wss://two.test", own]), undefined);
    assert.equal(readSelfProfileCache("wss://two.test", own).updatedAt, 0);
  } finally { await view.close(); }
});

test("a native profile signed by another identity never becomes the current profile or offline cache", async () => {
  readProfile = async () => profile("Another signer", "b".repeat(64));
  const view = await mount();
  try {
    await until(() => view.host.querySelector('[role="alert"]'));
    assert.equal(view.host.textContent.includes("Another signer"), false);
    assert.equal(view.host.querySelector('[data-testid="profile-avatar-edit"]'), null);
    assert.equal(readSelfProfileCache("wss://one.test", own).updatedAt, 0);
  } finally { await view.close(); }
});

test("late native upload cannot enter the original global avatar presentation after Community changes", async () => {
  let finish;
  readProfile = async () => profile();
  uploadAvatar = () => new Promise((resolve) => { finish = resolve; });
  const view = await mount();
  try {
    await until(() => view.host.querySelector('[data-testid="profile-avatar-edit"]'));
    await chooseAvatar(view);
    await until(() => finish);
    readProfile = async () => profile("New community");
    await view.render(session("two.test"));
    await until(() => view.host.textContent.includes("New community"));
    const before = blobs;
    const url = "https://one.test/media/stale.png";
    await act(async () => finish({ url, type: "image/png" }));
    assert.equal(blobs, before);
    assert.equal(getAvatarPresentation(url), null);
    assert.equal(view.host.textContent.includes("New community"), true);
  } finally { await view.close(); }
});

test("a late canonical native save cannot populate the new Community or the old offline cache", async () => {
  let save, finish;
  let caught;
  function Consumer() {
    const query = useProfileQuery();
    const mutation = useUpdateProfileMutation();
    save = () => mutation.mutateAsync({ expectedPubkey: own, idempotencyKey: "00000000-0000-4000-8000-000000000001", displayName: "Edit" }).catch((error) => { caught = error; });
    return React.createElement("p", null, query.data?.displayName ?? "Loading");
  }
  readProfile = async () => profile();
  writeProfile = () => new Promise((resolve) => { finish = resolve; });
  const view = await mount(Consumer);
  try {
    await until(() => view.host.textContent === "Original");
    await act(async () => { void save(); });
    await until(() => finish);
    readProfile = async () => profile("New community");
    await view.render(session("two.test"));
    await until(() => view.host.textContent === "New community");
    await act(async () => finish(profile("Late canonical edit")));
    await until(() => caught);
    assert.equal(caught.name, "TransportError");
    assert.equal(view.host.textContent, "New community");
    assert.equal(readSelfProfileCache("wss://one.test", own).displayName, "Original");
    assert.equal(view.cache.getQueryData(["profile", "two.test", "wss://two.test", own]).displayName, "New community");
  } finally { await view.close(); }
});

test("the actual sidebar profile cache never renders another identity's offline avatar during a scope change", async () => {
  const renders = [];
  function Consumer() {
    const current = useNativeSession();
    const cache = useSelfProfileCache();
    renders.push({ pubkey: current.devicePubkey, relayUrl: current.facts.relayUrl, cache });
    return React.createElement("p", null, cache?.displayName ?? "No cached profile");
  }
  const view = await mount(Consumer);
  const other = "b".repeat(64);
  const first = { version: 1, displayName: "First offline identity", avatarUrl: null, about: null,
    avatarDataUrl: "data:image/png;base64,first", updatedAt: 1 };
  const second = { ...first, displayName: "Current offline identity", avatarDataUrl: "data:image/png;base64,current" };
  try {
    await act(async () => {
      writeSelfProfileCache("wss://one.test", own, first);
      writeSelfProfileCache("wss://two.test", other, second);
    });
    assert.equal(view.host.textContent, first.displayName);
    renders.length = 0;
    await view.render(session("two.test", other));
    assert.ok(renders.length > 0);
    for (const render of renders) {
      assert.equal(render.pubkey, other);
      assert.equal(render.relayUrl, "wss://two.test");
      assert.equal(render.cache.displayName, second.displayName);
      assert.equal(render.cache.avatarDataUrl, second.avatarDataUrl);
    }
    assert.equal(view.host.textContent, second.displayName);
    await act(async () => writeSelfProfileCache("wss://one.test", own, { ...first, displayName: "Late old cache write" }));
    assert.equal(view.host.textContent, second.displayName);
  } finally { await view.close(); }
});
