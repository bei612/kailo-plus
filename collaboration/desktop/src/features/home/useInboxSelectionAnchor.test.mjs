import assert from "node:assert/strict";
import { after, test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document,
  localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { useInboxSelectionAnchor } = await import("./useInboxSelectionAnchor.ts");
after(() => dom.window.close());

const id = "a".repeat(64);
const event = { id, kind: 9, pubkey: "b".repeat(64), content: "original anchor",
  created_at: 100, tags: [["h", "channel"]], sig: "c".repeat(128) };
let result;
function Probe(props) { result = useInboxSelectionAnchor(props); return null; }
async function mount(read) {
  const calls = [];
  window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
    calls.push([command, args]);
    assert.equal(command, "get_event");
    assert.deepEqual(args, { eventId: id });
    return JSON.stringify(await read());
  } };
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  let props = { feed: { mentions: [], activity: [] }, selectedEventId: id,
    availableChannelIds: new Set(["channel"]), scopeKey: {}, ready: true };
  const render = async updates => {
    props = { ...props, ...updates };
    await React.act(async () => root.render(React.createElement(Probe, props)));
  };
  await render({});
  return { calls, render, close: async () => { await React.act(async () => root.unmount()); host.remove(); } };
}

test("Native original get_event adapter retains only admitted channel and current session", async () => {
  const view = await mount(async () => event);
  try {
    assert.equal(result.activeLatchedItem?.id, id);
    assert.equal(result.activeLatchedItem?.channelId, "channel");
    assert.deepEqual(result.feedItems, [], "cold anchor is not a fabricated feed row");
    await view.render({ availableChannelIds: new Set() });
    assert.equal(result.activeLatchedItem, null);
    await view.render({ availableChannelIds: new Set(["channel"]) });
    assert.equal(result.activeLatchedItem?.id, id);
    assert.equal(view.calls.length, 1, "membership return reuses the same admitted candidate");
    await view.render({ scopeKey: {}, ready: false });
    assert.equal(result.activeLatchedItem, null);
    assert.equal(view.calls.length, 1);
  } finally { await view.close(); }
});

test("Native original get_event adapter discards late session result and malformed target", async () => {
  let finish;
  const view = await mount(() => new Promise(resolve => { finish = resolve; }));
  try {
    assert.equal(result.coldResolutionPending, true);
    await view.render({ availableChannelIds: new Set(["channel", "another-channel"]) });
    assert.equal(view.calls.length, 1, "membership refresh must not duplicate an in-flight native read");
    await view.render({ scopeKey: {}, ready: false });
    await React.act(async () => finish(event));
    assert.equal(result.activeLatchedItem, null);
    assert.equal(result.coldResolutionPending, false);
  } finally { await view.close(); }
  const malformed = await mount(async () => ({ ...event, id: "d".repeat(64) }));
  try {
    assert.equal(result.activeLatchedItem, null);
    assert.equal(result.coldResolutionFailed, true);
  } finally { await malformed.close(); }
});
