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
        onOpenChannel: (id) => opened.push(id),
        onOpenResult: () => assert.fail("channel suggestions must retain channel navigation"),
      })))));
    await open();
    for (const [id, iconClass] of [["stream", "lucide-hash"], ["forum", "lucide-file-text"], ["dm", "lucide-message-circle"]]) {
      const row = dom.window.document.querySelector(`[data-testid="search-result-channel-${id}"]`);
      assert.ok(row, `actual search renders the ${id} suggestion`);
      assert.ok(row.querySelector(`svg.${iconClass}`), `actual ${id} row retains the original icon`);
    }
    await act(async () => dom.window.document.querySelector('[data-testid="search-result-channel-forum"]').click());
    assert.deepEqual(opened, ["forum"]);
    await open();
    await act(async () => dom.window.document.querySelector('[data-testid="search-result-channel-dm"]').click());
    assert.deepEqual(opened, ["forum", "dm"]);
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
