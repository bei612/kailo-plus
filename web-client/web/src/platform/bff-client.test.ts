import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bff, deleteMessage, openStream, publishMessage, publishConversationMessage, publishMessageReaction, searchMessages, type StreamFrame } from "./bff-client";
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

it("uses one top-level login navigation for concurrent expired-session responses", async () => {
  vi.mocked(bff.session).mockRestore();
  const assign = vi.fn();
  vi.stubGlobal("window", { location: { href: "/app/", assign } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
  const results = await Promise.allSettled([bff.session(), bff.session()]);
  expect(results.every(result => result.status === "rejected" && result.reason instanceof SessionEndedError)).toBe(true);
  expect(assign).toHaveBeenCalledExactlyOnceWith("/app/");
});
