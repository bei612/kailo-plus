// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import type { BuzzEvent, StreamFrame } from "@/platform/bff-client";
import { buildMainTimelineEntries } from "@client-kit/platform/react/thread/threadPanel";
import { getThreadReference } from "@client-kit/platform/react/messages/threading";
import { BffError } from "@client-kit/platform/transport";
import { useChannelWindow } from "./useChannelWindow";

const state = vi.hoisted(() => ({ streams: [] as ((frame: StreamFrame) => void)[], query: vi.fn(), conversation: vi.fn(), reason: (value: string) => value }));
vi.mock("@client-kit/platform/react/context", () => ({ useReasonText: () => state.reason }));
vi.mock("@/shared/i18n", () => ({t: (value: string) => value}));
vi.mock("@/platform/bff-client", () => ({
  bff: {workspaceMessages: (...args: unknown[]) => state.query(...args), conversationMessages: (...args: unknown[]) => state.conversation(...args)},
  openStream: (_scope: string, callback: (frame: StreamFrame) => void) => { state.streams.push(callback); return vi.fn(); },
}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
const event = (id: string, seconds = 10, kind = 9, tags: string[][] = []): BuzzEvent => ({id, created_at:seconds, kind, tags, pubkey:"author", content:id});
const bounds = (start = "head", next: {created_at:number;id:string} | null = null) => ({...event("bounds",0,39006,[["d",`channel:${start}`]]), content:JSON.stringify({has_more:!!next,next_cursor:next})});
const summary = (count: number, seconds: number) => ({...event(`summary-${seconds}`,seconds,39005,[["e","root"]]),content:JSON.stringify({reply_count:count,descendant_count:count,last_reply_at:seconds,participants:["author"]})});
let root: Root, host: HTMLDivElement;
let current: ReturnType<typeof useChannelWindow>;
function Probe({scope="workspace",conversationId,archived}: {scope?:string;conversationId?:string;archived?:boolean}) {
  current = useChannelWindow({workspaceId:scope,principalId:"human",channelId:"channel",conversationId,archived});
  return <output>{current.events.map(event=>event.id).join(",")}</output>;
}
const send = async (frame: StreamFrame, index=state.streams.length-1) => { await act(async()=>state.streams[index]!(frame)); };
async function head(events: BuzzEvent[], next: {created_at:number;id:string} | null = null) {
  await send({type:"snapshot",events:[...events,bounds("head",next)]});
  await send({type:"live"});
}
beforeEach(async()=>{
  state.streams=[]; state.query.mockReset(); state.conversation.mockReset();
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
  await act(async()=>root.render(<Probe/>));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();});

it("keeps live typing out of history and expires the original indicator", async()=>{
  vi.useFakeTimers();vi.setSystemTime(100_000);
  await head([event("head",99)]);
  await send({type:"event",event:event("typing",100,20002,[["h","channel"]])});
  expect(current.typing).toEqual([{pubkey:"author",threadHeadId:null}]);
  expect(current.events.map(row=>row.id)).toEqual(["head"]);
  await act(async()=>vi.advanceTimersByTime(8_000));
  expect(current.typing).toEqual([]);
});

it.each(["scope-revoked","session-revoked","scope-changed","interrupted","ended"])("drops transient typers immediately after %s", async(reason)=>{
  await head([event("head")]);
  await send({type:"event",event:event("typing",Math.floor(Date.now()/1000),20002,[["h","channel"]])});
  expect(current.typing).toHaveLength(1);
  await send(reason==="interrupted" || reason==="ended" ? {type:reason} : {type:"closed",reason});
  expect(current.typing).toEqual([]);
  await send({type:"event",event:event("late",Math.floor(Date.now()/1000),20002,[["h","channel"]])});
  expect(current.typing).toEqual([]);
});

it("clears typing on a real message but does not resuppress a new burst on duplicate delivery", async()=>{
  vi.useFakeTimers();vi.setSystemTime(100_000);
  await head([event("head",99)]);
  const typing=event("typing",100,20002,[["h","channel"]]);
  await send({type:"event",event:typing});
  const completed=event("completed",101,9,[["h","channel"]]);
  await send({type:"event",event:completed});
  expect(current.typing).toEqual([]);
  await act(async()=>vi.advanceTimersByTime(3_000));
  await send({type:"event",event:{...typing,id:"new-typing",created_at:103}});
  expect(current.typing).toHaveLength(1);
  await send({type:"event",event:completed});
  expect(current.typing).toHaveLength(1);
});

it("continues the original dense-second cursor and only trusts signed exhaustion", async()=>{
  await head([event("a"),event("b")],{created_at:10,id:"b"});
  expect(current.historyExhausted).toBe(false);
  state.query.mockResolvedValue({events:[event("c"),event("z",9),bounds("10:b")]});
  await act(async()=>current.fetchOlder());
  expect(state.query).toHaveBeenCalledWith("workspace",{before:10,beforeId:"b"});
  expect(current.events.map(event=>event.id)).toEqual(["z","c","b","a"]);
  expect(current.historyExhausted).toBe(true); expect(current.hasOlderMessages).toBe(false);
  await act(async()=>current.fetchOlder()); expect(state.query).toHaveBeenCalledTimes(1);
});
it("uses the existing conversation query and suppresses overlapping older requests", async()=>{
  await act(async()=>root.render(<Probe conversationId="conversation"/>));
  await head([event("a")],{created_at:10,id:"a"});
  let resolve!: (value: unknown)=>void;
  state.conversation.mockImplementation(()=>new Promise(done=>{resolve=done;}));
  let pending!: Promise<void>;
  await act(async()=>{pending=current.fetchOlder();void current.fetchOlder();});
  expect(state.conversation).toHaveBeenCalledTimes(1);expect(state.query).not.toHaveBeenCalled();
  await act(async()=>{resolve({events:[bounds("10:a")]});await pending;});
  expect(current.historyExhausted).toBe(true);
});
it("keeps Relay-admitted orphan edges while ordinary live replies remain in the thread", async()=>{
  const orphan=event("orphan",10,40002,[["e","missing","","root"],["e","missing","","reply"]]);
  await head([orphan]);
  await send({type:"event",event:event("live-reply",11,9,[["e","missing","","root"],["e","missing","","reply"]])});
  const messages=current.events.map(item=>({id:item.id,body:item.content,author:"author",time:"",createdAt:item.created_at,depth:0,tags:item.tags,kind:item.kind,...getThreadReference(item.tags)}));
  const entries=buildMainTimelineEntries(messages,undefined,current.threadSummaries,undefined,current.authoritativeRowIds);
  expect(entries.map(entry=>entry.message.id)).toEqual(["orphan"]);
  expect(entries[0]!.message.parentId).toBe("missing");
  expect(current.events.some(event=>event.id==="live-reply")).toBe(false);
});
it("preserves summary metadata and accepts newer decreasing live recounts without adding rows", async()=>{
  await head([event("root"),summary(4,20)]);
  expect(current.threadSummaries.get("root")?.replyCount).toBe(4);
  await send({type:"event",event:summary(2,30)});
  await send({type:"event",event:summary(8,29)});
  expect(current.threadSummaries.get("root")?.replyCount).toBe(2);
  expect(current.events.map(event=>event.id)).toEqual(["root"]);
});
it.each(["reconnect","scope","revoked","binding-not-active","scope-changed","interrupted","ended"])("rejects an older-page response after %s changes its admission/window",async(change)=>{
  await head([event("a")],{created_at:10,id:"a"});
  let resolve!: (value:unknown)=>void;
  state.query.mockImplementation(()=>new Promise(done=>{resolve=done;}));
  let pending!:Promise<void>;
  await act(async()=>{pending=current.fetchOlder();});
  if(change==="scope") { await act(async()=>root.render(<Probe scope="other"/>));await head([event("new",20)]); }
  else if(change==="reconnect") await head([event("new",20),event("a")],{created_at:10,id:"a"});
  else if(change==="binding-not-active" || change==="scope-changed") await send({type:"closed",reason:change});
  else if(change==="interrupted" || change==="ended") await send({type:change});
  else await send({type:"closed",reason:"scope-revoked"});
  await act(async()=>{resolve({events:[event("old",9),bounds("10:a")]});await pending;});
  expect(current.events.map(event=>event.id)).toEqual(["revoked","binding-not-active","scope-changed"].includes(change)?[]:change==="reconnect"?["a","new"]:["interrupted","ended"].includes(change)?["a"]:["new"]);
  if(change==="binding-not-active" || change==="scope-changed") {
    expect(current.denied).toBe(true);
    await send({type:"event",event:event("unadmitted",30)});await send({type:"live"});
    expect(current.events).toEqual([]);expect(current.live).toBe(false);
    await head([event("readmitted",40)]);
    expect(current.events.map(event=>event.id)).toEqual(["readmitted"]);expect(current.denied).toBe(false);
  }
});
it("rejects missing or foreign bounds instead of inventing an exhausted window", async()=>{
  await send({type:"snapshot",events:[event("a")]});await send({type:"live"});
  expect(current.error).toBe(true);expect(current.live).toBe(false);expect(current.historyExhausted).toBe(false);
  await send({type:"snapshot",events:[event("a"),bounds("foreign")]});await send({type:"live"});
  expect(current.events).toEqual([]);expect(current.error).toBe(true);
});
it("cannot start another page in the same event turn after interruption before React commits",async()=>{
  await head([event("a")],{created_at:10,id:"a"});
  await act(async()=>{state.streams.at(-1)!({type:"interrupted"});await current.fetchOlder();});
  expect(state.query).not.toHaveBeenCalled();
});
it("keeps already admitted history when the channel becomes archived, without admitting new frames",async()=>{
  await head([event("a")]);
  state.query.mockResolvedValue({events:[event("a"),bounds()]});
  await act(async()=>root.render(<Probe archived/>));
  expect(current.events.map(event=>event.id)).toEqual(["a"]);
  await send({type:"event",event:event("after-archive",20)});
  expect(current.events.map(event=>event.id)).toEqual(["a"]);
  expect(current.live).toBe(false);
});

it("cold-opens archived history through the admitted query and pages without a live/write grant",async()=>{
  state.query.mockResolvedValueOnce({events:[event("root",10,40002),summary(2,20),bounds("head",{created_at:10,id:"root"})]});
  await act(async()=>root.render(<Probe archived/>));
  expect(state.query).toHaveBeenCalledWith("workspace");
  expect(state.streams).toHaveLength(1); // only the original non-archived mount
  expect(current.events.map(row=>row.id)).toEqual(["root"]);
  expect(current.threadSummaries.get("root")?.replyCount).toBe(2);
  expect(current.live).toBe(false); expect(current.isLoading).toBe(false);
  state.query.mockResolvedValueOnce({events:[event("older",9),bounds("10:root")]});
  await act(async()=>current.fetchOlder());
  expect(state.query).toHaveBeenLastCalledWith("workspace",{before:10,beforeId:"root"});
  expect(current.events.map(row=>row.id)).toEqual(["older","root"]);
  expect(current.historyExhausted).toBe(true); expect(current.status).toBe("channel.archived");
  expect(current.live).toBe(false);
});
it("finishes a signed empty archive and leaves malformed head bounds retryable",async()=>{
  state.query.mockResolvedValueOnce({events:[bounds("wrong-channel")]});
  await act(async()=>root.render(<Probe archived/>));
  expect(current.error).toBe(true); expect(current.historyExhausted).toBe(false);
  state.query.mockResolvedValueOnce({events:[bounds()]});
  await act(async()=>current.retry());
  expect(current.error).toBe(false); expect(current.isLoading).toBe(false);
  expect(current.historyExhausted).toBe(true); expect(current.events).toEqual([]);
  expect(current.live).toBe(false); expect(state.streams).toHaveLength(1);
});
it.each(["scope","unarchive","retry"])("fences late archived head reads after %s",async(change)=>{
  let resolve!: (value:unknown)=>void;
  state.query.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  await act(async()=>root.render(<Probe archived/>));
  if(change==="scope") {
    state.query.mockResolvedValueOnce({events:[event("new-scope"),bounds()]});
    await act(async()=>root.render(<Probe archived scope="other"/>));
  } else if(change==="unarchive") {
    await act(async()=>root.render(<Probe/>)); await head([event("new-live")]);
  } else {
    state.query.mockResolvedValueOnce({events:[event("refreshed"),bounds()]});
    await act(async()=>current.retry());
  }
  await act(async()=>resolve({events:[event("late-private"),bounds()]}));
  expect(current.events.map(row=>row.id)).toEqual([change==="scope"?"new-scope":change==="unarchive"?"new-live":"refreshed"]);
});
it("drops archived history on fresh pagination refusal and only readmits through retry",async()=>{
  state.query.mockResolvedValueOnce({events:[event("root"),bounds("head",{created_at:10,id:"root"})]});
  await act(async()=>root.render(<Probe archived/>));
  state.query.mockRejectedValueOnce(new BffError(403,"scope revoked"));
  await act(async()=>current.fetchOlder());
  expect(current.events).toEqual([]); expect(current.error).toBe(true);
  await act(async()=>current.fetchOlder()); expect(state.query).toHaveBeenCalledTimes(2);
  state.query.mockResolvedValueOnce({events:[event("readmitted"),bounds()]});
  await act(async()=>current.retry());
  expect(current.events.map(row=>row.id)).toEqual(["readmitted"]);expect(current.live).toBe(false);
});
