import assert from "node:assert/strict";
import test from "node:test";

import { QueryClient } from "@tanstack/react-query";

import {
  applyLastMessages,
  canFetchChannelsForIdentity,
  channelsQueryKey,
  joinAdmittedNativeChannels,
  nativeApplicationWorkspace,
  refreshChannelsQuery,
  requireFullChannelList,
  useChannelsQuery,
  useWorkspaceChannelDirectory,
  workspaceVisibilityQueryKey,
} from "./hooks.ts";

function makeChannel(
  id,
  name,
  channelType = "stream",
  { participantPubkeys = [], participants = [], lastMessageAt = null } = {},
) {
  return {
    id,
    name,
    channelType,
    visibility: channelType === "dm" ? "private" : "open",
    description: "",
    topic: null,
    purpose: null,
    memberCount: participantPubkeys.length,
    memberPubkeys: [...participantPubkeys],
    lastMessageAt,
    archivedAt: null,
    participants,
    participantPubkeys,
    isMember: true,
    ttlSeconds: null,
    ttlDeadline: null,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function makeRefreshHarness({ cachedHash = "hash-1" } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const start = makeChannel("general", "General", "stream", {
    lastMessageAt: "2026-01-01T00:00:00.000Z",
  });
  queryClient.setQueryData(channelsQueryKey, [start]);
  const request = deferred();
  const calls = [];
  const fetchChannels = (knownHash) => {
    calls.push(knownHash);
    return request.promise;
  };
  const initialSnapshotPair = cachedHash
    ? { channels: [start], hash: cachedHash }
    : null;

  return {
    calls,
    fetchChannels,
    initialSnapshotPair,
    queryClient,
    request,
    start,
  };
}

function setDisplayedRecency(queryClient, lastMessageAt) {
  queryClient.setQueryData(channelsQueryKey, (channels) =>
    channels.map((channel) =>
      channel.id === "general" ? { ...channel, lastMessageAt } : channel,
    ),
  );
}

function refreshWithHarness(harness, fetchChannels = harness.fetchChannels) {
  return harness.queryClient.fetchQuery({
    queryKey: channelsQueryKey,
    queryFn: () =>
      refreshChannelsQuery({
        queryClient: harness.queryClient,
        initialSnapshotPair: harness.initialSnapshotPair,
        relayUrl: null,
        ownerPubkey: null,
        fetchChannels,
      }),
  });
}

const T1 = "2026-01-01T00:01:00.000Z";
const T2 = "2026-01-01T00:02:00.000Z";

test("refreshChannelsQuery preserves a live update through matching not-modified settlement", async () => {
  const harness = makeRefreshHarness();
  const refresh = refreshWithHarness(harness);

  assert.deepEqual(harness.calls, ["hash-1"]);
  setDisplayedRecency(harness.queryClient, T2);
  harness.request.resolve({
    hash: "hash-1",
    channels: null,
    lastMessages: { general: T1 },
  });

  const result = await refresh;
  assert.equal(result[0].lastMessageAt, T2);
  assert.equal(
    harness.queryClient.getQueryData(channelsQueryKey)[0].lastMessageAt,
    T2,
  );
});

test("refreshChannelsQuery preserves a live update through authoritative full-list settlement", async () => {
  const harness = makeRefreshHarness({ cachedHash: null });
  const refresh = refreshWithHarness(harness);

  assert.deepEqual(harness.calls, [null]);
  setDisplayedRecency(harness.queryClient, T2);
  harness.request.resolve({
    hash: "hash-2",
    channels: [makeChannel("general", "General")],
    lastMessages: { general: T1 },
  });

  const result = await refresh;
  assert.equal(result[0].lastMessageAt, T2);
  assert.equal(
    harness.queryClient.getQueryData(channelsQueryKey)[0].lastMessageAt,
    T2,
  );
});

test("refreshChannelsQuery preserves a live update through mismatched not-modified retry", async () => {
  const harness = makeRefreshHarness();
  const retry = deferred();
  const fetchChannels = (knownHash) => {
    harness.calls.push(knownHash);
    return harness.calls.length === 1
      ? Promise.resolve({
          hash: "mismatched-hash",
          channels: null,
          lastMessages: {},
        })
      : retry.promise;
  };
  const refresh = refreshWithHarness(harness, fetchChannels);

  await Promise.resolve();
  assert.deepEqual(harness.calls, ["hash-1", null]);
  setDisplayedRecency(harness.queryClient, T2);
  retry.resolve({
    hash: "hash-2",
    channels: [makeChannel("general", "General")],
    lastMessages: { general: T1 },
  });

  const result = await refresh;
  assert.equal(result[0].lastMessageAt, T2);
  assert.equal(
    harness.queryClient.getQueryData(channelsQueryKey)[0].lastMessageAt,
    T2,
  );
});

test("refreshChannelsQuery clears unchanged recency on authoritative absence", async () => {
  const harness = makeRefreshHarness();
  const refresh = refreshWithHarness(harness);

  harness.request.resolve({
    hash: "hash-1",
    channels: null,
    lastMessages: {},
  });

  const result = await refresh;
  assert.equal(result[0].lastMessageAt, null);
});

test("identity failure enables a hashless live channel fetch", () => {
  assert.equal(canFetchChannelsForIdentity(null, false), false);
  assert.equal(canFetchChannelsForIdentity("owner-pubkey", false), true);
  assert.equal(canFetchChannelsForIdentity(null, true), true);
});

test("hashless retry rejects null channels before persistence", () => {
  const channels = [makeChannel("general", "General")];
  assert.strictEqual(requireFullChannelList(channels), channels);
  assert.throws(
    () => requireFullChannelList(null),
    /no list for a hashless request/,
  );
});

// ── applyLastMessages ─────────────────────────────────────────────────────────

test("applyLastMessages_preservesReferenceWhenTimestampUnchanged", () => {
  const channel = makeChannel("general", "General");
  channel.lastMessageAt = "2026-01-01T00:00:00Z";

  const result = applyLastMessages([channel], {
    general: "2026-01-01T00:00:00Z",
  });

  // Must be the same object reference — structural sharing avoids re-renders.
  assert.strictEqual(
    result[0],
    channel,
    "reference must be preserved when lastMessageAt is unchanged",
  );
});

test("applyLastMessages_createsNewObjectWhenTimestampChanges", () => {
  const channel = makeChannel("general", "General");
  channel.lastMessageAt = "2026-01-01T00:00:00Z";

  const result = applyLastMessages([channel], {
    general: "2026-06-15T12:00:00Z",
  });

  assert.notStrictEqual(
    result[0],
    channel,
    "must create a new object when timestamp changes",
  );
  assert.equal(result[0].lastMessageAt, "2026-06-15T12:00:00Z");
});

test("applyLastMessages_setsNullWhenChannelAbsentFromMap", () => {
  const channel = makeChannel("general", "General");
  channel.lastMessageAt = "2026-01-01T00:00:00Z";

  const result = applyLastMessages([channel], {});

  assert.notStrictEqual(result[0], channel);
  assert.equal(result[0].lastMessageAt, null);
});

test("applyLastMessages_preservesReferenceWhenBothNull", () => {
  const channel = makeChannel("general", "General");
  // lastMessageAt defaults to null in makeChannel

  const result = applyLastMessages([channel], {});

  assert.strictEqual(result[0], channel, "null→null must preserve reference");
});

function makeWorkspace(id, channelId, overrides = {}) {
  return {
    id,
    channel: { channelId, channelType: "stream", name: channelId, archived: false },
    visibility: "open",
    isMember: true,
    membershipState: "ACTIVE",
    memberCount: 1,
    createdAt: new Date(),
    ...overrides,
  };
}

test("native channel visibility joins Relay IDs, without modifying signed metadata", () => {
  const channel = makeChannel("relay-channel", "Original channel");
  channel.visibility = "private";
  const dm = makeChannel("direct-message", "Direct message", "dm");
  const workspace = makeWorkspace("core-workspace", channel.id);
  const visible = joinAdmittedNativeChannels([channel, dm], [workspace]);
  assert.deepEqual(visible.map((item) => item.id), [channel.id, dm.id]);
  assert.equal(visible[0].visibility, "open");
  assert.equal(channel.visibility, "private", "the signed Relay snapshot remains unchanged");
  assert.strictEqual(visible[1], dm, "DMs keep their independent native read path");
  assert.deepEqual(joinAdmittedNativeChannels([channel, dm], undefined), [dm]);
  assert.deepEqual(joinAdmittedNativeChannels(undefined, [workspace]), undefined);
});

test("native channel visibility rejects missing membership, revocation and type mismatch", () => {
  const channel = makeChannel("relay-channel", "Channel");
  for (const override of [
    { isMember: false },
    { membershipState: undefined },
    { membershipState: "PROVISIONING" },
    { membershipState: "REVOKING" },
    { membershipState: "REVOKED" },
    { membershipState: "ERROR" },
    { membershipState: "unknown" },
    { channel: { channelId: channel.id, channelType: "forum", name: "Forum", archived: false } },
  ]) {
    assert.deepEqual(joinAdmittedNativeChannels([channel], [makeWorkspace("core-workspace", channel.id, override)]), [], JSON.stringify(override));
  }
});

test("native component discovery resolves channel and application routes in separate ID namespaces", () => {
  const directory = [makeWorkspace("core-a", "relay-a"), makeWorkspace("relay-a", "relay-b")];
  assert.deepEqual(nativeApplicationWorkspace(directory, { channelId: "relay-a" }), { id: "core-a", name: "relay-a" });
  assert.deepEqual(nativeApplicationWorkspace(directory, { workspaceId: "relay-a" }), { id: "relay-a", name: "relay-b" });
  assert.equal(nativeApplicationWorkspace(directory, { workspaceId: "missing", channelId: "relay-a" }), undefined,
    "a missing Core route never falls back to an unrelated Relay ID");
  assert.equal(nativeApplicationWorkspace(directory, {}), undefined);
  assert.equal(nativeApplicationWorkspace(undefined, { channelId: "relay-a" }), undefined);
  for (const override of [{ isMember: false }, { membershipState: "REVOKING" }, { membershipState: undefined }]) {
    assert.equal(nativeApplicationWorkspace([makeWorkspace("core-a", "relay-a", override)], { channelId: "relay-a" }), undefined);
  }
});

test("real native query and component consumers share paginated mapping and close stale admission", async () => {
  const { JSDOM } = await import("jsdom");
  const { createElement, act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { QueryClientProvider } = await import("@tanstack/react-query");
  const { PlatformProvider } = await import("@client-kit/platform/react/context");
  const { ActiveCommunityProvider } = await import("@/features/platform/activeCommunity");
  const { NativeApplicationEntries } = await import("@client-kit/platform/react/pages");
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://native.test", pretendToBeVisual: true });
  const oldGlobals = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    oldGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(["identity"], { pubkey: "device-owner", displayName: "Owner" });
  const nativeChannels = [makeChannel("relay-a", "Channel A"), makeChannel("relay-b", "Channel B"), makeChannel("dm", "DM", "dm")];
  client.setQueryData(channelsQueryKey, nativeChannels);
  const directoryCalls = [];
  const bindingCalls = [];
  let discovery = async (cursor) => {
    directoryCalls.push(cursor);
    return cursor === undefined ? { items: [makeWorkspace("core-a", "relay-a")], nextCursor: "next-page" }
      : { items: [makeWorkspace("relay-a", "relay-b")] };
  };
  const bff = {
    discoverableWorkspaces: (cursor) => discovery(cursor),
    applicationBindings: async (workspaceId) => { bindingCalls.push(workspaceId); return { bindings: [], canCreate: false }; },
  };
  let latest;
  let session = { facts: { communityHost: "community.test", relayUrl: "wss://community.test" },
    devicePubkey: "device-owner", client: bff, signOut() {} };
  let route = { channelId: "relay-a" };
  function Consumer() {
    const channels = useChannelsQuery();
    const directory = useWorkspaceChannelDirectory();
    const workspace = nativeApplicationWorkspace(directory.data, route);
    latest = { channels, directory, workspace };
    return createElement(NativeApplicationEntries, { scopeKey: session.devicePubkey, workspace, onSelect() {} });
  }
  const root = createRoot(dom.window.document.getElementById("root"));
  const render = () => root.render(createElement(QueryClientProvider, { client },
    createElement(PlatformProvider, { client: bff }, createElement(ActiveCommunityProvider, { session }, createElement(Consumer)))));
  const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
  try {
    await act(async () => render());
    await settle();
    assert.deepEqual(directoryCalls, [undefined, "next-page"], "both actual hooks share a single fully paginated query");
    assert.deepEqual(latest.channels.data.map((channel) => channel.id), ["relay-a", "relay-b", "dm"]);
    assert.equal(latest.workspace.id, "core-a");
    assert.ok(bindingCalls.includes("core-a"), "the actual component discovery consumer reads the Core workspace scope");
    assert.ok(!bindingCalls.includes("relay-a"), "a selected Relay channel ID never leaks into workspace binding reads");
    assert.strictEqual(client.getQueryData(channelsQueryKey)[0], nativeChannels[0]);

    route = { workspaceId: "relay-a" };
    await act(async () => render());
    await settle();
    assert.equal(latest.workspace.name, "relay-b");
    assert.ok(bindingCalls.includes("relay-a"), "application routes retain their Core ID even when it collides with another Relay ID");

    const pending = deferred();
    discovery = () => pending.promise;
    let refresh;
    await act(async () => { refresh = client.invalidateQueries({ queryKey: workspaceVisibilityQueryKey }); });
    await settle();
    assert.equal(latest.directory.data, undefined);
    assert.equal(latest.workspace, undefined);
    assert.deepEqual(latest.channels.data.map((channel) => channel.id), ["dm"], "pending authority cannot reuse admitted channel metadata");
    pending.resolve({ items: [makeWorkspace("core-a", "relay-a", { membershipState: "REVOKING" })] });
    await act(async () => { await refresh; });
    await settle();
    assert.deepEqual(latest.channels.data.map((channel) => channel.id), ["dm"]);
    assert.equal(latest.workspace, undefined);

    discovery = async () => { throw new Error("directory unavailable"); };
    await act(async () => { await client.invalidateQueries({ queryKey: workspaceVisibilityQueryKey }); });
    await settle();
    assert.equal(latest.directory.isError, true);
    assert.equal(latest.directory.data, undefined, "failed rereads never fall back to cached admission");
    assert.deepEqual(latest.channels.data.map((channel) => channel.id), ["dm"]);

    const oldScope = deferred();
    discovery = () => oldScope.promise;
    await act(async () => { refresh = client.invalidateQueries({ queryKey: workspaceVisibilityQueryKey }); });
    await settle();
    session = { ...session, devicePubkey: "another-device", facts: { communityHost: "another.test", relayUrl: "wss://another.test" } };
    await act(async () => render());
    await settle();
    assert.equal(latest.directory.data, undefined, "a device/identity mismatch cannot consume the old scope");
    assert.equal(latest.workspace, undefined);
    oldScope.resolve({ items: [makeWorkspace("core-a", "relay-a")] });
    await act(async () => { await refresh; });
    await settle();
    assert.equal(latest.directory.data, undefined, "late directory settlement cannot migrate across native scopes");
    assert.equal(latest.workspace, undefined);
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
