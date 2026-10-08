import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { AppShellProvider, useAppShell } from "@/app/AppShellContext";
import { MessageActionBarSurface, MessageRowSurface, threadReactionRoot } from "@client-kit/platform/react/messages";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";

// Execute the actual mutation hook with controlled hook state and transport;
// this isolates publish lifecycle from unrelated channel hydration/Tauri APIs.
const source = ts.createSourceFile("hooks.ts", readFileSync(new URL("./hooks.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "useToggleReactionMutation");
assert.ok(declaration);
const javascript = ts.transpile(declaration.getText(source).replace(/^export /, ""), { target: ts.ScriptTarget.ES2022 });

function harness() {
  let ref;
  let cleanup;
  let options;
  let publish = async () => ({ id: "signed", pubkey: "actor", kind: 7 });
  let calls = 0;
  const invalidations = [];
  class TransportError extends Error {}
  const hook = new Function("useRef", "useEffect", "useMutation", "useQueryClient", "useActiveCommunity", "addReaction", "removeReaction", "TransportError", "classifyRelayPublishFailure", "channelMessagesKey", `${javascript}; return useToggleReactionMutation;`)(
    value => ref ??= { current: value },
    effect => { cleanup ??= effect(); },
    value => { options = value; return value; },
    () => ({ invalidateQueries: value => { invalidations.push(value.queryKey); return Promise.resolve(); } }),
    () => ({ relayUrl: "relay" }),
    async (...args) => { calls++; return publish(...args); },
    async (...args) => { calls++; return publish(...args); },
    TransportError,
    error => error instanceof TransportError ? { kind: "outcomeUnknown" } : null,
    id => ["channel-messages", id],
  );
  const channel = { id: "channel", isMember: true, archivedAt: null };
  return {
    render: value => hook(value ?? channel, "actor"),
    setPublish: value => { publish = value; },
    unmount: () => cleanup(),
    get options() { return options; },
    get calls() { return calls; },
    invalidations,
  };
}
const input = { eventId: "event", emoji: "😀", remove: false };

test("confirmed reaction refreshes channel, thread and Inbox without mutation retry", async () => {
  const h = harness(); h.render();
  assert.equal(h.options.retry, false);
  await h.options.mutationFn(input);
  assert.equal(h.calls, 1);
  assert.deepEqual(h.invalidations, [["channel-messages", "channel"], ["thread-replies", "channel"], ["inbox-reactions", "channel"]]);
});

test("missing signed receipt stays UNKNOWN without refresh or replay", async () => {
  const h = harness(); h.render(); h.setPublish(async () => ({}));
  await assert.rejects(h.options.mutationFn(input), /outcome unknown/);
  assert.equal(h.calls, 1);
  assert.deepEqual(h.invalidations, []);
});

for (const boundary of ["scope", "unmount"]) {
  test(`late receipt after ${boundary} does not report success or refresh a new view`, async () => {
    const h = harness(); h.render();
    let resolve;
    h.setPublish(() => new Promise(done => { resolve = done; }));
    const pending = h.options.mutationFn(input);
    if (boundary === "scope") h.render({ id: "other", isMember: true, archivedAt: null });
    else h.unmount();
    resolve({ id: "signed", pubkey: "actor", kind: 7 });
    await assert.rejects(pending, /outcome unknown/);
    assert.deepEqual(h.invalidations, []);
    assert.equal(h.calls, 1);
  });
}

test("archived channel never dispatches a reaction", async () => {
  const h = harness(); h.render({ id: "channel", isMember: true, archivedAt: "archived" });
  await assert.rejects(h.options.mutationFn(input), /scope is not available/);
  assert.equal(h.calls, 0);
});

// Execute the actual ChannelPane callback, not a duplicate of its post-ACK
// branch. Both original timeline and thread rows must still call this callback.
const paneSource = ts.createSourceFile("ChannelPane.tsx", readFileSync(new URL("../channels/ui/ChannelPane.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let reactionCallback;
let shellBinding;
let rowConsumers = 0;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(paneSource) === "handleToggleReaction") reactionCallback = node.initializer.arguments[0];
  if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.name.elements.some(element => element.name.getText(paneSource) === "recordThreadInteraction")) shellBinding = node;
  if (ts.isJsxAttribute(node) && node.name.text === "onToggleReaction" && node.initializer?.getText(paneSource).includes("handleToggleReaction")) rowConsumers++;
  ts.forEachChild(node, visit);
}
visit(paneSource);
assert.ok(reactionCallback);
assert.ok(shellBinding);
assert.equal(rowConsumers, 2, "original main/thread row consumers share the real callback");
const callbackJs = ts.transpile(`const callback = ${reactionCallback.getText(paneSource)};`, { target: ts.ScriptTarget.ES2022 });

function paneHandler(h) {
  const owner = {}, ownerRef = { current: owner }, mounted = { current: true }, recorded = [];
  const handler = new Function("toggleReaction", "editOwner", "editOwnerRef", "channelPaneMountedRef", "recordThreadInteraction", "threadReactionRoot", `${callbackJs}; return callback;`)(
    { mutateAsync: value => h.options.mutationFn(value) }, owner, ownerRef, mounted, value => recorded.push(value), threadReactionRoot,
  );
  return { handler, recorded, ownerRef, mounted, owner };
}

test("real Native main/thread reaction callback records only a confirmed addition at its original root", async () => {
  const h = harness(); h.render();
  const p = paneHandler(h);
  await p.handler({ id: "reply", rootId: "root" }, "👍", false);
  assert.deepEqual(p.recorded, ["root"]);
  await p.handler({ id: "top" }, "👍", false);
  assert.deepEqual(p.recorded, ["root", "top"]);
  h.setPublish(async () => ({ id: "removed", pubkey: "actor", kind: 5 }));
  await p.handler({ id: "reply", rootId: "root" }, "👍", true);
  assert.deepEqual(p.recorded, ["root", "top"]);
});

test("real Native reaction callback cannot record UNKNOWN or a late response in another identity/scope", async () => {
  const h = harness(); h.render(); const p = paneHandler(h);
  h.setPublish(async () => ({}));
  await assert.rejects(p.handler({ id: "reply", rootId: "root" }, "👍", false), /outcome unknown/);
  assert.deepEqual(p.recorded, []);
  for (const boundary of ["owner", "unmount"]) {
    let finish;
    p.ownerRef.current = p.owner; p.mounted.current = true;
    h.setPublish(() => new Promise(resolve => { finish = resolve; }));
    const pending = p.handler({ id: "reply", rootId: "root" }, "👍", false);
    if (boundary === "owner") p.ownerRef.current = {};
    else p.mounted.current = false;
    finish({ id: "signed", pubkey: "actor", kind: 7 });
    await pending;
    assert.deepEqual(p.recorded, []);
  }
});

test("Native's actual AppShell binding renders the original quick-reaction row and consumes its confirmed interaction", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true });
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  const globals = {
    window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element, Node: dom.window.Node, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const h = harness(); h.render(); const recorded = [];
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const owner = {}, ownerRef = { current: owner }, mounted = { current: true };
  const bindingJs = ts.transpile(`const ${shellBinding.getText(paneSource)};`, { target: ts.ScriptTarget.ES2022 });
  const actualConsumer = new Function("useAppShell", "toggleReaction", "editOwner", "editOwnerRef", "channelPaneMountedRef", "threadReactionRoot", `${bindingJs}; ${callbackJs}; return callback;`);
  const message = { id: "reaction-message", rootId: "reaction-root", author: "Alice", body: "Original message", createdAt: 1, depth: 0, time: "" };
  function Row() {
    const onToggleReaction = actualConsumer(useAppShell, { mutateAsync: value => h.options.mutationFn(value) }, owner, ownerRef, mounted, threadReactionRoot);
    return React.createElement(TooltipProvider, null, React.createElement(MessageRowSurface, {
      message, onToggleReaction, reactionScope: "actor/channel", renderBody: () => React.createElement("p", null, message.body),
      renderActions: (ref, reactions) => React.createElement(MessageActionBarSurface, { ref, message, ...reactions, onCopyMessage: () => {} }),
    }));
  }
  function Host() {
    const defaults = useAppShell();
    return React.createElement(QueryClientProvider, { client: cache },
      React.createElement(AppShellProvider, { value: { ...defaults, recordThreadInteraction: id => recorded.push(id) } }, React.createElement(Row)));
  }
  const host = dom.window.document.createElement("div"); dom.window.document.body.append(host); const root = createRoot(host);
  try {
    await React.act(async () => root.render(React.createElement(Host)));
    const quick = [...host.querySelectorAll("button[title]")].find(button => button.textContent === "👍");
    assert.ok(quick, "real original quick reaction, not a fake test action");
    await React.act(async () => quick.click());
    assert.equal(h.calls, 1);
    assert.deepEqual(recorded, ["reaction-root"]);
  } finally {
    await React.act(async () => root.unmount()); cache.clear(); dom.window.close();
    for (const name of Object.keys(globals)) {
      if (previous[name]) Object.defineProperty(globalThis, name, previous[name]);
      else delete globalThis[name];
    }
  }
});
