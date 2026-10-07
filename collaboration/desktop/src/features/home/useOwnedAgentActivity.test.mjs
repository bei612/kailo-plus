import assert from "node:assert/strict";
import { after, test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { finalizeEvent, getPublicKey } = await import("nostr-tools/pure");
const { ActiveCommunityProvider } = await import("@/features/platform/activeCommunity");
const { relayClient } = await import("@/shared/api/relayClient");
const { useOwnedAgentActivity } = await import("./useOwnedAgentActivity.ts");
const originalFetch = relayClient.fetchEvents;
const secret = new Uint8Array(32).fill(1);
const agent = getPublicKey(secret);
const device = "a".repeat(64);
after(() => { relayClient.fetchEvents = originalFetch; dom.window.close(); });

function installation(workspace, owner = "owner") {
  return { resourceId: `${workspace}-installation`, workspaceId: workspace, ownerPrincipalId: owner,
    state: "ACTIVE", resourceState: "ACTIVE", agentPrincipalState: "ACTIVE", channelBinding: { status: "ACTIVE" },
    projection: { state: "ACTIVE", generation: 1 }, activeProjectionGeneration: 1, agentPubkey: agent };
}
function session(workspaces, host = "one.test", directory = async (workspace) => ({ installations: [installation(workspace)] })) {
  return { facts: { communityHost: host, relayUrl: `wss://${host}`, relayQueryLimit: 20 }, devicePubkey: device, displayName: null,
    client: { session: async () => ({ tenantPrincipalId: "owner" }), agentInstallations: directory,
      workspaces: async () => workspaces.map((id) => ({ id, isMember: true })) } };
}
const message = (workspace, content) => finalizeEvent({ kind: 9, created_at: 100, content, tags: [["h", workspace]] }, secret);
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function Results({ workspaces }) {
  const result = useOwnedAgentActivity(new Set(workspaces), true);
  return React.createElement("section", { "data-status": result.status },
    result.isError ? "Unavailable" : result.data?.activity.map((event) => React.createElement("article", { key: event.id }, event.content)));
}
async function mount(current, workspaces) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const render = async (next, scopes) => act(async () => root.render(React.createElement(QueryClientProvider, { client: cache },
    React.createElement(ActiveCommunityProvider, { session: next }, React.createElement(Results, { workspaces: scopes })))));
  await render(current, workspaces);
  return { host, render, async close() { await act(async () => root.unmount()); cache.clear(); host.remove(); } };
}
async function until(check) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (check()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  }
  assert.ok(check(), "expected actual mounted Agent activity state");
}

test("workspace switch rejects a late signed old-author Relay result", async () => {
  const old = deferred(); const queries = [];
  relayClient.fetchEvents = async (filter) => { queries.push(filter); return filter["#h"][0] === "old" ? old.promise : [message("new", "Current Agent reply")]; };
  const current = session(["old", "new"]); const view = await mount(current, ["old"]);
  try {
    await until(() => queries.length === 1);
    await view.render(current, ["new"]);
    await until(() => view.host.textContent.includes("Current Agent reply"));
    await act(async () => old.resolve([message("old", "Obsolete Agent reply")]));
    assert.equal(view.host.textContent.includes("Obsolete Agent reply"), false);
    assert.equal(view.host.querySelectorAll("article").length, 1);
    assert.deepEqual(queries.map((query) => query["#h"]), [["old"], ["new"]]);
    assert.ok(queries.every((query) => query.authors[0] === agent && query.kinds[0] === 9));
  } finally { await view.close(); }
});

test("session switch discards a late old directory before starting a Relay author query", async () => {
  const old = deferred(); let requested = false; const queries = [];
  const previous = session(["old"], "one.test", async () => { requested = true; return old.promise; });
  relayClient.fetchEvents = async (filter) => { queries.push(filter["#h"][0]); return [message(filter["#h"][0], filter["#h"][0] === "new" ? "Current session" : "Obsolete session")]; };
  const view = await mount(previous, ["old"]);
  try {
    await until(() => requested);
    await view.render(session(["new"], "two.test"), ["new"]);
    await until(() => view.host.textContent.includes("Current session"));
    await act(async () => old.resolve({ installations: [installation("old")] }));
    assert.deepEqual(queries, ["new"]);
    assert.equal(view.host.textContent.includes("Obsolete session"), false);
    assert.equal(view.host.querySelectorAll("article").length, 1);
  } finally { await view.close(); }
});

test("owner revocation during author read does not expose the already returned message", async () => {
  let reads = 0;
  const current = session(["scope"], "one.test", async () => ({ installations: [{ ...installation("scope"), ownerPrincipalId: ++reads === 1 ? "owner" : "other" }] }));
  relayClient.fetchEvents = async () => [message("scope", "Revoked result")];
  const view = await mount(current, ["scope"]);
  try {
    await until(() => view.host.textContent.includes("Unavailable"));
    assert.equal(reads, 2);
    assert.equal(view.host.querySelectorAll("article").length, 0);
  } finally { await view.close(); }
});
