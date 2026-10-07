import assert from "node:assert/strict";
import { after, test } from "node:test";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { relayClient } = await import("@/shared/api/relayClient");
const { useInboxThreadContext } = await import("./useInboxThreadContext.ts");
const { KIND_STREAM_MESSAGE_EDIT } = await import("@/shared/constants/kinds");
const original = relayClient.fetchEvents;
after(() => { relayClient.fetchEvents = original; dom.window.close(); });
const event = (id, kind = 9, tags = []) => ({ id: id.repeat(64), pubkey: "a".repeat(64), kind, created_at: 100,
  content: id, tags: [["h", "direct"], ...tags], sig: "a".repeat(128) });
const selected = event("a");
const item = { ...selected, createdAt: selected.created_at, channelId: "direct", channelType: "dm", channelName: "", category: "activity" };
let result;
function Probe({ fullChannel, messages, failed = false, active = true }) {
  result = useInboxThreadContext(active ? item : null, messages, { fullChannel, hasChannelLoadError: failed });
  return React.createElement("div", null, result.events.map(event => event.id).join(","));
}
async function mount(messages, failed = false) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await React.act(async () => root.render(React.createElement(QueryClientProvider, { client: cache }, React.createElement(Probe, { fullChannel: true, messages, failed }))));
  const close = async () => { await React.act(async () => root.unmount()); cache.clear(); host.remove(); };
  close.clearSelection = () => React.act(async () => root.render(React.createElement(QueryClientProvider, { client: cache }, React.createElement(Probe, { fullChannel: true, messages, failed, active: false }))));
  return close;
}
async function until(check) { for (let i = 0; i < 60; i++) { if (check()) return; await React.act(async () => new Promise(resolve => setTimeout(resolve, 5))); } assert.ok(check()); }

test("fullChannel keeps selected old DM plus unrelated head messages and hydrates edits plus deletion-of-edit", async () => {
  const current = event("b"); const edit = event("c", KIND_STREAM_MESSAGE_EDIT, [["e", selected.id]]);
  const deletion = event("d", 5, [["e", edit.id]]); const calls = [];
  relayClient.fetchEvents = async filter => { calls.push(filter); return filter.kinds.includes(KIND_STREAM_MESSAGE_EDIT) ? [edit] : filter["#e"].includes(edit.id) ? [deletion] : []; };
  const close = await mount([current]);
  try {
    await until(() => !result.isLoading && result.events.some(event => event.id === deletion.id));
    assert.deepEqual(new Set(result.events.map(event => event.id)), new Set([selected.id, current.id, edit.id, deletion.id]));
    assert.equal(result.hasLoadError, false);
    assert.ok(calls.every(filter => filter["#h"][0] === "direct"));
    assert.ok(calls.every(filter => !filter.kinds.includes(9)), "fullChannel must not issue a thread-only read");
    const count = calls.length;
    await close.clearSelection();
    assert.deepEqual(result.events, [], "unavailable feed clears the active context even if the channel window is cached");
    assert.equal(calls.length, count, "cleared selection does not issue auxiliary reads");
  } finally { await close(); }
});

test("fullChannel preserves channel failure and aux read failure instead of calling it empty success", async () => {
  relayClient.fetchEvents = async () => { throw new Error("not admitted"); };
  const close = await mount([event("b")], true);
  try { await until(() => !result.isLoading); assert.equal(result.hasLoadError, true); }
  finally { await close(); }
});
