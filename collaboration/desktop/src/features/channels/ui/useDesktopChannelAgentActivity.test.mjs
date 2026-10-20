// DD-125(6): the Desktop channel feeds the shared Agent working signal from this device's own
// Relay typing frames and the BFF Installation directory, keyed by the admitted Workspace.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node, Element: dom.window.Element, IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { PlatformProvider } = await import("@client-kit/platform/react/context");
const { createBffClient } = await import("@client-kit/platform/client");
const { getWorkingChannels, resetAgentWorkingSignal } = await import("@client-kit/platform/react/agent-activity");
const { ActiveCommunityProvider } = await import("@/features/platform/activeCommunity");
const { useDesktopChannelAgentActivity } = await import("./useDesktopChannelAgentActivity.tsx");

after(() => dom.window.close());

const own = "a".repeat(64);
const agent = "b".repeat(64);
const human = "d".repeat(64);
const channel = {
  id: "native-a", name: "alpha", channelType: "stream", visibility: "open", isMember: true, description: "",
  archivedAt: null, lastMessageAt: null, memberCount: 2, memberPubkeys: [], participantPubkeys: [], participants: [],
  purpose: null, topic: null, ttlDeadline: null, ttlSeconds: null,
};
const installation = {
  resourceId: "installation-1", workspaceId: "ws-a", agentResourceId: "definition-1", pinnedVersionAssetId: "asset-1",
  agentPrincipalId: "agent-principal", ownerPrincipalId: "owner", resourceVersion: 1, resourceState: "ACTIVE",
  state: "PROVISIONING", agentPrincipalState: "ACTIVE", agentPubkey: agent, agentDisplayName: "Scribe", canAudit: false,
};

async function mount(typingEntries, { isMember = true } = {}) {
  const requests = [];
  const bff = createBffClient({ send: async (request) => {
    requests.push(request.path);
    if (request.path.startsWith("/api/v1/discoverable-workspaces")) return { status: 200, body: { items: [{
      id: "ws-a", visibility: "open", isMember: true, memberCount: 2, membershipState: "ACTIVE", createdAt: "2026-10-01T00:00:00Z",
      channel: { channelId: "native-a", channelType: "stream", name: "alpha", archived: false },
    }] } };
    if (request.path.startsWith("/api/v1/agent-installations")) return { status: 200, body: { installations: [installation] } };
    return { status: 403, body: { code: "PermissionDenied", message: "Not admitted in this fixture" } };
  } });
  const session = { facts: { communityHost: "native.test", relayUrl: "wss://native.test" }, devicePubkey: own, client: bff };
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  cache.setQueryData(["identity"], { pubkey: own, displayName: "Viewer" });
  let result;
  function Consumer() {
    result = useDesktopChannelAgentActivity({ activeChannel: { ...channel, isMember }, enabled: isMember, typingEntries });
    return null;
  }
  const host = dom.window.document.createElement("div");
  dom.window.document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(QueryClientProvider, { client: cache },
    React.createElement(PlatformProvider, { client: bff, locale: "en" },
      React.createElement(ActiveCommunityProvider, { session }, React.createElement(Consumer))))));
  const until = async (check, label) => {
    for (let index = 0; index < 80 && !check(); index++)
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    assert.ok(check(), `expected ${label}`);
  };
  return { requests, get result() { return result; }, until, async close() {
    await act(async () => root.unmount()); host.remove(); cache.clear(); resetAgentWorkingSignal();
  } };
}

test("an Agent's thread 20002 marks it working under the channel's admitted Workspace", async () => {
  const view = await mount([{ pubkey: agent, threadHeadId: "root" }, { pubkey: human, threadHeadId: null }]);
  try {
    // Directory → Workspace → Installation directory → signal: wait for the final state.
    await view.until(() => view.result.workingBotPubkeys.includes(agent), "the working Agent");
    assert.equal(view.result.scopeId, "ws-a");
    assert.equal(view.result.agentPubkeys.has(agent), true);
    assert.equal(view.result.agentPubkeys.has(human), false);
    assert.deepEqual(view.result.workingAgents, [{ pubkey: agent, name: "Scribe" }]);
    assert.deepEqual(getWorkingChannels().map(({ channelId, source, agentPubkeys }) => ({ channelId, source, agentPubkeys })),
      [{ channelId: "ws-a", source: "typing", agentPubkeys: [agent] }]);
    // A member without Installation audit never reads the audited turns.
    assert.equal(view.requests.some((path) => path.includes("/agent-turns")), false);
  } finally {
    await view.close();
  }
  assert.deepEqual(getWorkingChannels(), []);
});

test("a channel the person has not joined reports nothing", async () => {
  const view = await mount([{ pubkey: agent, threadHeadId: null }], { isMember: false });
  try {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
    assert.deepEqual(view.result.workingBotPubkeys, []);
    assert.deepEqual(getWorkingChannels(), []);
    assert.equal(view.requests.some((path) => path.startsWith("/api/v1/agent-installations")), false);
  } finally {
    await view.close();
  }
});
