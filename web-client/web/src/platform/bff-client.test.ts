import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bff, channelTopicPath, deleteMessage, openStream, publishChannelTopic, publishMessage, publishConversationMessage, publishMessageReaction, searchMessages, type StreamFrame } from "./bff-client";
import { AGENT_MENTION_OUTCOME_QUERY_LIMIT, agentMentionOutcomesPath, queryAgentMentionOutcomes } from "./bff-client";
import { PRESENCE_PATH, PRESENCE_QUERY_PATH, USER_STATUS_PATH, USER_STATUS_QUERY_PATH, queryPresence, queryUserStatus,
  releasePresence, setIdentityStreamSink, signOut, updatePresence, updateUserStatus, type BuzzEvent } from "./bff-client";
import { publishTyping, reconnectStreams, streamConnectionState, subscribeStreamConnection } from "./bff-client";
import { PlatformSessionAccessMode, WebMessageType, type PulsePublishRequest } from "@client-kit/contracts";
import { BffError, SessionEndedError, TransportError } from "@client-kit/platform/transport";

class Source extends EventTarget {
  static CLOSED = 2;
  static instances: Source[] = [];
  readyState = 1;
  close = vi.fn(() => {
    this.readyState = Source.CLOSED;
  });
  constructor(readonly url: string) {
    super();
    Source.instances.push(this);
  }
  frame(type: string, data = "") {
    this.dispatchEvent(new MessageEvent(type, { data }));
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  Source.instances = [];
  vi.stubGlobal("EventSource", Source);
  vi.spyOn(bff, "session").mockResolvedValue({
    accessMode: PlatformSessionAccessMode.Full, displayName: "Person",
    humanIdentityId: "human", platformSessionId: "session", tenantId: "tenant",
    tenantMembershipId: "membership", tenantPrincipalId: "principal",
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("sends only original semantic search operators to BFF and keeps original FTS order and thread context", async () => {
  const channelId="7a533c07-3817-4c91-81f7-25f31534359a", author="b".repeat(64), root="c".repeat(64);
  const event={id:"a".repeat(64),pubkey:author,kind:9,created_at:12,content:"original result",tags:[["h",channelId],["e",root,"","root"],["e",root,"","reply"]]};
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({events:[event,{...event,id:"d".repeat(64),kind:40002}]}),{status:200,headers:{"Content-Type":"application/json"}}));
  vi.stubGlobal("fetch",fetcher);
  const request={q:"original",channelId,authors:[author],since:0,until:15,limit:12};
  const page=await searchMessages(request);
  expect(String(fetcher.mock.lastCall![0])).toContain("/api/v1/search/messages");
  expect(JSON.parse(fetcher.mock.lastCall![1].body)).toEqual(request);
  expect(page.found).toBe(2);
  expect(page.hits.map(hit=>[hit.eventId,hit.score,hit.channelId,hit.threadRootId])).toEqual([[event.id,1,channelId,root],["d".repeat(64),0.5,channelId,root]]);
});

it.each([45001,45003])("preserves the original forum kind %i in admitted search results",async(kind)=>{
  const event={id:"a".repeat(64),pubkey:"b".repeat(64),kind,created_at:12,content:"forum result",tags:[["h","7a533c07-3817-4c91-81f7-25f31534359a"]]};
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({events:[event]}),{status:200,headers:{"Content-Type":"application/json"}})));
  expect((await searchMessages({q:"forum"})).hits[0]?.kind).toBe(kind);
});

it.each(["duplicate","missing-channel","ambiguous-channel","unknown-kind","malformed-time"])("rejects %s search results instead of rendering unverifiable success", async (invalid) => {
  const event={id:"a".repeat(64),pubkey:"b".repeat(64),kind:9,created_at:12,content:"result",tags:[["h","7a533c07-3817-4c91-81f7-25f31534359a"]]};
  const rows=invalid==="duplicate"?[event,event]:[{...event,
    tags:invalid==="missing-channel"?[]:invalid==="ambiguous-channel"?[...event.tags,...event.tags]:event.tags,
    kind:invalid==="unknown-kind"?0:event.kind,created_at:invalid==="malformed-time"?-1:event.created_at}];
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({events:rows}),{status:200,headers:{"Content-Type":"application/json"}})));
  await expect(searchMessages({q:"result"})).rejects.toBeInstanceOf(TransportError);
});

it("propagates real search authorization failure rather than returning an empty successful result", async () => {
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({error:"scope-revoked"}),{status:403,headers:{"Content-Type":"application/json"}})));
  await expect(searchMessages({q:"result"})).rejects.toBeInstanceOf(BffError);
});

it("preserves exact human identities in channel, reply, edit and DM publication", async () => {
  const fetcher=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({eventId:"event",operationId:"operation"}),{status:200,headers:{"Content-Type":"application/json"}}));
  vi.stubGlobal("fetch",fetcher);
  const mentionPubkeys=["b".repeat(64)], parentEventId="a".repeat(64);
  for (const intent of [{mentionPubkeys},{mentionPubkeys,parentEventId},{mentionPubkeys,editEventId:parentEventId}]) {
    await publishMessage("workspace","@Sam",[],"intent",[],intent);
    expect(JSON.parse(fetcher.mock.lastCall![1].body)).toMatchObject(intent);
    expect(new Headers(fetcher.mock.lastCall![1].headers).get("Idempotency-Key")).toBe("intent");
  }
  await publishConversationMessage("conversation","@Sam",[],"intent",undefined,parentEventId,mentionPubkeys);
  expect(String(fetcher.mock.lastCall![0])).toContain("/conversations/conversation/messages");
  expect(JSON.parse(fetcher.mock.lastCall![1].body)).toMatchObject({mentionPubkeys,parentEventId,mentionInstallationIds:[]});
});

it("freezes the deletion intent across calls without storing body or inventing a new event", async () => {
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({eventId:"receipt",operationId:"operation"}), {status:200,headers:{"Content-Type":"application/json"}}));
  vi.stubGlobal("fetch",fetcher);
  const target="d".repeat(64);
  await deleteMessage("workspace",target,WebMessageType.ForumPost);
  await deleteMessage("workspace",target,WebMessageType.ForumPost);
  const first=fetcher.mock.calls[0]![1] as RequestInit, second=fetcher.mock.calls[1]![1] as RequestInit;
  expect(String(fetcher.mock.calls[0]![0])).toContain("/workspaces/workspace/messages/delete");
  expect(new Headers(first.headers).get("Idempotency-Key")).toBe(new Headers(second.headers).get("Idempotency-Key"));
  expect(JSON.parse(first.body as string)).toEqual({content:"",attachments:[],mentionInstallationIds:[],messageType:"FORUM_POST",deleteEventId:target});
});

it("uses the dedicated DM deletion route and the same immutable target on UNKNOWN retry", async () => {
  const fetcher=vi.fn().mockRejectedValueOnce(new TypeError("connection lost")).mockImplementation(async()=>new Response(JSON.stringify({eventId:"receipt",operationId:"operation"}),{status:200,headers:{"Content-Type":"application/json"}}));
  vi.stubGlobal("fetch",fetcher);
  const target="e".repeat(64);
  await expect(deleteMessage("unused-workspace",target,WebMessageType.Stream,"conversation")).rejects.toBeInstanceOf(TransportError);
  await deleteMessage("unused-workspace",target,WebMessageType.Stream,"conversation");
  expect(fetcher.mock.calls.map(([url])=>String(url))).toEqual(["/api/v1/conversations/conversation/messages/delete","/api/v1/conversations/conversation/messages/delete"]);
  const first=fetcher.mock.calls[0]![1] as RequestInit, second=fetcher.mock.calls[1]![1] as RequestInit;
  expect(first.body).toBe(second.body);
  expect(new Headers(first.headers).get("Idempotency-Key")).toBe(new Headers(second.headers).get("Idempotency-Key"));
  expect(JSON.parse(first.body as string)).toMatchObject({deleteEventId:target,messageType:WebMessageType.Stream});
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({operationId:"operation"}),{status:200,headers:{"Content-Type":"application/json"}}));
  await expect(deleteMessage("unused",target,WebMessageType.Stream,"conversation")).rejects.toBeInstanceOf(TransportError);
});

it("publishes the DD-119 member topic with only the topic and the intent's Idempotency-Key", async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("connection lost"))
    .mockImplementation(async () => new Response(JSON.stringify({eventId:"e".repeat(64),operationId:"operation"}),{status:200,headers:{"Content-Type":"application/json"}}));
  vi.stubGlobal("fetch", fetcher);
  expect(channelTopicPath("work space")).toBe("/api/v1/workspaces/work%20space/channel/topic");
  await expect(publishChannelTopic("workspace", {topic:"Launch"}, "topic-intent")).rejects.toBeInstanceOf(TransportError);
  await expect(publishChannelTopic("workspace", {topic:"Launch"}, "topic-intent")).resolves.toEqual({eventId:"e".repeat(64),operationId:"operation"});
  const [first, second] = fetcher.mock.calls.map(([url, init]) => [String(url), init as RequestInit] as const);
  expect(first?.[0]).toBe("/api/v1/workspaces/workspace/channel/topic");
  expect(first?.[1].method).toBe("POST");
  expect(JSON.parse(first?.[1].body as string)).toEqual({topic:"Launch"});
  expect(new Headers(first?.[1].headers).get("Idempotency-Key")).toBe("topic-intent");
  expect(new Headers(second?.[1].headers).get("Idempotency-Key")).toBe("topic-intent");
  expect(second?.[1].body).toBe(first?.[1].body);
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({operationId:"operation"}),{status:200,headers:{"Content-Type":"application/json"}}));
  await expect(publishChannelTopic("workspace", {topic:""}, "clear-intent")).rejects.toBeInstanceOf(TransportError);
});

it("routes scoped reactions with the frozen key and requires a confirmed publication receipt",async()=>{
  const fetcher=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({eventId:"e".repeat(64),operationId:"operation"}),{status:200,headers:{"Content-Type":"application/json"}}));
  vi.stubGlobal("fetch",fetcher);
  const request={operation:"LIKE",content:"👍",targetEventId:"a".repeat(64)} as PulsePublishRequest;
  await publishMessageReaction("workspace",undefined,request,"same-key");
  expect(String(fetcher.mock.calls[0]![0])).toContain("/workspaces/workspace/reactions");
  expect(new Headers((fetcher.mock.calls[0]![1] as RequestInit).headers).get("Idempotency-Key")).toBe("same-key");
  await publishMessageReaction("unused","conversation",request,"same-key");
  expect(String(fetcher.mock.calls[1]![0])).toContain("/conversations/conversation/reactions");
  expect(JSON.parse((fetcher.mock.calls[1]![1] as RequestInit).body as string)).toEqual(request);
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({operationId:"operation"}),{status:200,headers:{"Content-Type":"application/json"}}));
  await expect(publishMessageReaction("workspace",undefined,request,"same-key")).rejects.toBeInstanceOf(TransportError);
});

it.each(["session-revoked", "scope-revoked", "identity-revoked"])(
  "stops %s before notifying the consumer and ignores every late frame",
  (reason) => {
    const frames: StreamFrame[] = [];
    const stop = openStream("workspace-a", (frame) => {
      expect(Source.instances[0].close).toHaveBeenCalledOnce();
      frames.push(frame);
    });
    const source = Source.instances[0];
    source.frame("retry", "25");
    source.frame("closed", reason);
    for (const type of ["live", "snapshot", "event", "error", "closed"]) source.frame(type, "[]");
    vi.runAllTimers();
    expect(frames).toEqual([{ type: "closed", reason }]);
    expect(Source.instances).toHaveLength(1);
    stop();
  },
);

it("reopens once after a terminal transport failure and rejects obsolete source callbacks", async () => {
  const frames: StreamFrame[] = [];
  const stop = openStream("workspace-a", (frame) => frames.push(frame));
  const first = Source.instances[0];
  first.frame("retry", "25");
  first.readyState = Source.CLOSED;
  first.frame("error");
  first.frame("live");
  first.frame("snapshot", "[]");
  first.frame("error");
  expect(frames).toEqual([{ type: "interrupted" }]);
  await vi.advanceTimersByTimeAsync(25);
  expect(Source.instances).toHaveLength(2);
  first.frame("closed", "scope-revoked");
  Source.instances[1].frame("live");
  expect(frames).toEqual([{ type: "interrupted" }, { type: "live" }]);
  stop();
});

it("keeps uncertain readmission distinct from revocation and uses the server retry interval", async () => {
  const frames: StreamFrame[] = [];
  const stop = openStream("workspace-a", (frame) => frames.push(frame));
  const source = Source.instances[0];
  source.frame("retry", "25");
  source.frame("closed", "readmission-unavailable");
  source.readyState = Source.CLOSED;
  source.frame("error");
  await vi.advanceTimersByTimeAsync(24);
  expect(Source.instances).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(Source.instances).toHaveLength(2);
  expect(frames).toEqual([
    { type: "closed", reason: "readmission-unavailable" },
    { type: "interrupted" },
  ]);
  stop();
});

it("does not invent a retry interval and cleanup cancels a pending reopen", async () => {
  const frames: StreamFrame[] = [];
  const stop = openStream("workspace-a", (frame) => frames.push(frame));
  Source.instances[0].readyState = Source.CLOSED;
  Source.instances[0].frame("error");
  await vi.runAllTimersAsync();
  expect(frames).toEqual([{ type: "interrupted" }, { type: "ended" }]);
  expect(Source.instances).toHaveLength(1);
  stop();
  const stopNext = openStream("workspace-b", () => {});
  Source.instances[1].frame("retry", "25");
  Source.instances[1].readyState = Source.CLOSED;
  Source.instances[1].frame("error");
  stopNext();
  await vi.runAllTimersAsync();
  expect(Source.instances).toHaveLength(2);
});

it.each([new SessionEndedError(), new BffError(403, "revoked")])(
  "stops an automatically reconnecting source when the current session is rejected: %s",
  async (error) => {
    vi.mocked(bff.session).mockRejectedValue(error);
    const frames: StreamFrame[] = [];
    const stop = openStream("workspace-a", frame => frames.push(frame));
    const source = Source.instances[0];
    source.frame("retry", "25");
    source.readyState = 0;
    source.frame("error");
    expect(source.close).toHaveBeenCalledOnce();
    await vi.runAllTimersAsync();
    expect(bff.session).toHaveBeenCalledOnce();
    expect(Source.instances).toHaveLength(1);
    expect(frames).toEqual([{ type: "interrupted" }, { type: "ended" }]);
    stop();
  },
);

it("retries only the session probe while unavailable and never reopens after cleanup", async () => {
  vi.mocked(bff.session).mockRejectedValueOnce(new BffError(503, "unavailable"));
  const stop = openStream("workspace-a", () => {});
  const source = Source.instances[0];
  source.frame("retry", "25");
  source.frame("error");
  await vi.advanceTimersByTimeAsync(24);
  expect(Source.instances).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(bff.session).toHaveBeenCalledTimes(2);
  expect(Source.instances).toHaveLength(1);
  stop();
  await vi.runAllTimersAsync();
  expect(Source.instances).toHaveLength(1);
});

it("aggregates the open BFF streams into the original connection states and leaves on cleanup", async () => {
  const seen: string[] = [];
  const unsubscribe = subscribeStreamConnection(() => seen.push(streamConnectionState()));
  expect(streamConnectionState()).toBe("idle");
  const stopA = openStream("workspace-a", () => {});
  const stopB = openStream("workspace-b", () => {});
  expect(streamConnectionState()).toBe("connecting");
  const [a, b] = Source.instances;
  a.frame("retry", "25"); b.frame("retry", "25");
  a.frame("live");
  expect(streamConnectionState()).toBe("connecting");
  b.frame("live");
  expect(streamConnectionState()).toBe("connected");
  // One interrupted scope is an interrupted connection, until its server-timed reopen is live.
  b.frame("error");
  expect(streamConnectionState()).toBe("reconnecting");
  await vi.advanceTimersByTimeAsync(25);
  Source.instances[2].frame("live");
  expect(streamConnectionState()).toBe("connected");
  // A revoked scope is not a connectivity problem and leaves the aggregate.
  Source.instances[2].frame("error");
  expect(streamConnectionState()).toBe("reconnecting");
  a.frame("closed", "scope-revoked");
  expect(streamConnectionState()).toBe("reconnecting");
  stopB();
  expect(streamConnectionState()).toBe("idle");
  stopA();
  unsubscribe();
  expect(seen).toEqual(["connecting", "connected", "reconnecting", "connected", "reconnecting", "idle"]);
});

it("reconnects a disconnected stream at once after the session probe, never a revoked one", async () => {
  const frames: StreamFrame[] = [];
  const stop = openStream("workspace-a", (frame) => frames.push(frame));
  // No server retry interval yet: the first failure is reported as disconnected.
  Source.instances[0].frame("error");
  await vi.runAllTimersAsync();
  expect(streamConnectionState()).toBe("disconnected");
  expect(frames).toEqual([{ type: "interrupted" }, { type: "ended" }]);
  const reconnected = reconnectStreams();
  await vi.waitFor(() => expect(Source.instances).toHaveLength(2));
  expect(bff.session).toHaveBeenCalledTimes(2);
  expect(streamConnectionState()).toBe("connecting");
  Source.instances[1].frame("live");
  await expect(reconnected).resolves.toBe(true);
  expect(streamConnectionState()).toBe("connected");
  Source.instances[1].frame("closed", "session-revoked");
  expect(streamConnectionState()).toBe("idle");
  await expect(reconnectStreams()).resolves.toBe(false);
  expect(Source.instances).toHaveLength(2);
  stop();
});

it("uses one top-level login navigation for concurrent expired-session responses", async () => {
  vi.mocked(bff.session).mockRestore();
  const assign = vi.fn();
  vi.stubGlobal("window", { location: { href: "/app/", assign } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
  const results = await Promise.allSettled([bff.session(), bff.session()]);
  expect(results.every(result => result.status === "rejected" && result.reason instanceof SessionEndedError)).toBe(true);
  expect(assign).toHaveBeenCalledExactlyOnceWith("/app/");
});

it("names each DD-120 route once and sends only the typed presence/status intents", async () => {
  expect([PRESENCE_PATH, PRESENCE_QUERY_PATH, USER_STATUS_PATH, USER_STATUS_QUERY_PATH]).toEqual([
    "/api/v1/presence", "/api/v1/presence/query", "/api/v1/user-status", "/api/v1/user-status/query"]);
  const key = "b".repeat(64);
  const fetcher = vi.fn(async (path: string, init: RequestInit) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    if (path === PRESENCE_QUERY_PATH) return json({ presences: [{ pubkey: key, status: "online", observedAt: 5 }] });
    if (path === USER_STATUS_QUERY_PATH) return json({ statuses: [{ pubkey: key, text: "Busy", createdAt: 5, eventId: "e".repeat(64) }] });
    if (path === USER_STATUS_PATH) return json(JSON.parse(String(init.body)).text === "unknown" ? {} : { eventId: "e".repeat(64), operationId: "op" });
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal("fetch", fetcher);
  const sent = () => fetcher.mock.lastCall!;

  expect((await queryPresence([key])).presences).toHaveLength(1);
  expect(sent()[0]).toBe("/api/v1/presence/query");
  expect([sent()[1].method, JSON.parse(String(sent()[1].body))]).toEqual(["POST", { pubkeys: [key] }]);

  await updatePresence("away");
  expect([sent()[0], sent()[1].method, JSON.parse(String(sent()[1].body))]).toEqual(["/api/v1/presence", "PUT", { status: "away" }]);

  expect((await queryUserStatus([key])).statuses[0]?.text).toBe("Busy");
  expect([sent()[0], sent()[1].method, JSON.parse(String(sent()[1].body))]).toEqual(["/api/v1/user-status/query", "POST", { pubkeys: [key] }]);

  expect(await updateUserStatus({ text: "Busy", emoji: "🔴", expiresAt: 10 }, "intent")).toEqual({ eventId: "e".repeat(64) });
  expect([sent()[0], sent()[1].method]).toEqual(["/api/v1/user-status", "PUT"]);
  expect(new Headers(sent()[1].headers).get("Idempotency-Key")).toBe("intent");
  expect(JSON.parse(String(sent()[1].body))).toEqual({ text: "Busy", emoji: "🔴", expiresAt: 10 });
  // A 2xx without an event receipt is an unknown outcome, never success.
  await expect(updateUserStatus({ text: "unknown" }, "intent")).rejects.toBeInstanceOf(TransportError);

  releasePresence();
  await vi.waitFor(() => expect(sent()[1].keepalive).toBe(true));
  expect([sent()[0], sent()[1].method, JSON.parse(String(sent()[1].body))]).toEqual(["/api/v1/presence", "PUT", { status: "offline" }]);
});

it("sends main-channel typing without a body and thread typing as the typed thread-head reference", async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  const sent = () => fetcher.mock.lastCall as unknown as [string, RequestInit];
  const head = "a".repeat(64), root = "b".repeat(64);

  await publishTyping({ workspaceId: "w1" });
  expect([sent()[0], sent()[1].method, sent()[1].body]).toEqual(["/api/v1/workspaces/w1/typing", "POST", undefined]);

  // Original buildThreadReferenceTags: root only when it differs from the thread head.
  await publishTyping({ conversationId: "c1" }, { parentEventId: head, rootEventId: root });
  expect([sent()[0], JSON.parse(String(sent()[1].body))]).toEqual(["/api/v1/conversations/c1/typing", { parentEventId: head, rootEventId: root }]);
  for (const rootEventId of [null, undefined, head]) {
    await publishTyping({ workspaceId: "w1" }, { parentEventId: head, rootEventId });
    expect(JSON.parse(String(sent()[1].body))).toEqual({ parentEventId: head });
  }
});

it("names the DD-121 outcome route once and asks only about the caller's own event IDs", async () => {
  expect(agentMentionOutcomesPath("workspace/a")).toBe("/api/v1/workspaces/workspace%2Fa/agent-mentions/query");
  expect(AGENT_MENTION_OUTCOME_QUERY_LIMIT).toBe(50);
  const mine = "1".repeat(64);
  const row = { eventId: mine, installationId: "installation", state: "DENIED", reasonCode: "PERMISSION_DENIED" };
  const fetcher = vi.fn(async (_path: string, _init: RequestInit) =>
    new Response(JSON.stringify({ outcomes: [row] }), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetcher);
  expect((await queryAgentMentionOutcomes("workspace", [mine, mine])).outcomes).toEqual([row]);
  const [path, init] = fetcher.mock.lastCall!;
  expect([path, init.method, JSON.parse(String(init.body))]).toEqual(["/api/v1/workspaces/workspace/agent-mentions/query", "POST", { eventIds: [mine] }]);
  // Out-of-contract requests never leave the browser.
  await expect(queryAgentMentionOutcomes("workspace", [])).rejects.toBeInstanceOf(TransportError);
  await expect(queryAgentMentionOutcomes("workspace", ["not-an-event"])).rejects.toBeInstanceOf(TransportError);
  await expect(queryAgentMentionOutcomes("workspace", Array.from({ length: 51 }, (_, index) => index.toString(16).padStart(64, "0"))))
    .rejects.toBeInstanceOf(TransportError);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("reads the DD-122 installation tool view through the shared client's single GET route", async () => {
  const page = { installationResourceId: "installation/1", generation: 3,
    tools: [{ source: "PLATFORM_NATIVE", name: "memory.entry.list", toolResourceId: "tool", bindingStatus: "NO_PERMISSION" }] };
  const fetcher = vi.fn(async (_path: string, _init: RequestInit) =>
    new Response(JSON.stringify(page), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetcher);
  expect(await bff.agentInstallationTools("installation/1")).toEqual(page);
  const [path, init] = fetcher.mock.lastCall!;
  expect([path, init.method ?? "GET", init.body]).toEqual(["/api/v1/agent-installations/installation%2F1/tools", "GET", undefined]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("reads the DD-123 tenant quota view through the shared client's single GET route", async () => {
  const page = { quotas: [{ feature: "agent_tokens", limitPerPeriod: 10000000, usage: 12, hasAccess: true, hardLimit: true }] };
  const fetcher = vi.fn(async (_path: string, _init: RequestInit) =>
    new Response(JSON.stringify(page), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetcher);
  expect(await bff.tenantQuotas()).toEqual(page);
  const [path, init] = fetcher.mock.lastCall!;
  expect([path, init.method ?? "GET", init.body]).toEqual(["/api/v1/tenant/quotas", "GET", undefined]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("rejects an outcome page that is malformed or speaks about events that were not asked", async () => {
  const mine = "1".repeat(64);
  const reply = (body: unknown) => vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })));
  reply({});
  await expect(queryAgentMentionOutcomes("workspace", [mine])).rejects.toBeInstanceOf(TransportError);
  reply({ outcomes: [{ eventId: "2".repeat(64), installationId: "installation", state: "RUNNING" }] });
  await expect(queryAgentMentionOutcomes("workspace", [mine])).rejects.toBeInstanceOf(TransportError);
  reply({ outcomes: [{ eventId: mine, installationId: "installation", state: "PENDING" }] });
  await expect(queryAgentMentionOutcomes("workspace", [mine])).rejects.toBeInstanceOf(TransportError);
  reply({ outcomes: [{ eventId: mine, installationId: "installation", state: "DENIED", reasonCode: "NOT_A_REASON" }] });
  await expect(queryAgentMentionOutcomes("workspace", [mine])).rejects.toBeInstanceOf(TransportError);
});

it("rejects a malformed presence or status page instead of rendering it", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } })));
  await expect(queryPresence(["b".repeat(64)])).rejects.toBeInstanceOf(TransportError);
  await expect(queryUserStatus(["b".repeat(64)])).rejects.toBeInstanceOf(TransportError);
});

it("routes h-less 20001/30315 stream frames to the presence sink, never to timeline consumers", () => {
  const identity: BuzzEvent[] = [];
  const release = setIdentityStreamSink((event) => identity.push(event));
  const frames: StreamFrame[] = [];
  const stop = openStream("workspace-a", (frame) => frames.push(frame));
  const source = Source.instances[0]!;
  const message = { id: "a".repeat(64), pubkey: "b".repeat(64), kind: 9, created_at: 1, content: "hi", tags: [["h", "native-a"]] };
  const status = { id: "c".repeat(64), pubkey: "b".repeat(64), kind: 30315, created_at: 2, content: "Busy", tags: [["d", "general"]] };
  const presence = { id: "d".repeat(64), pubkey: "b".repeat(64), kind: 20001, created_at: 3, content: "online", tags: [] };
  source.frame("snapshot", JSON.stringify([message, status]));
  source.frame("event", JSON.stringify(presence));
  source.frame("event", JSON.stringify(message));
  expect(frames).toEqual([{ type: "snapshot", events: [message] }, { type: "event", event: message }]);
  expect(identity).toEqual([status, presence]);
  release();
  source.frame("event", JSON.stringify(presence));
  expect(identity).toHaveLength(2);
  stop();
});

it("releases presence before revoking the session on sign-out", async () => {
  const order: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init: RequestInit) => {
    order.push(`${init.method ?? "GET"} ${path}`);
    return new Response(null, { status: 204 });
  }));
  vi.spyOn(bff, "logout").mockImplementation(async () => { order.push("logout"); return { revoked: true }; });
  const assign = vi.fn();
  vi.stubGlobal("window", { location: { href: "/app/", assign } });
  await signOut();
  expect(order).toEqual(["PUT /api/v1/presence", "logout", "POST /logout"]);
  expect(assign).toHaveBeenCalledOnce();
});
