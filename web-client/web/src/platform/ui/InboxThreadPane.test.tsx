// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkspaceMembershipState, ItemState } from "@client-kit/contracts";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { setLocale } from "@client-kit/platform/i18n";
import { BffError, TransportError } from "@client-kit/platform/transport";
import { ErrorClass, ReasonCode } from "@client-kit/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StreamFrame } from "../bff-client";
import { InboxThreadPane } from "./InboxThreadPane";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ query: vi.fn(), dmQuery:vi.fn(), dmPublish:vi.fn(), authorProfile:vi.fn(),dmAuthorProfile:vi.fn(),stream:vi.fn(), publish: vi.fn(), reaction:vi.fn(), openAuthor:vi.fn(), unavailable:vi.fn(), mentionPubkeys: [] as string[], receive: null as null | ((frame: StreamFrame) => void), outcome: "", error: null as unknown }));
vi.mock("@client-kit/platform/react/context", async (original) => ({ ...await original<typeof import("@client-kit/platform/react/context")>(), useBffClient: () => ({ workspaceMessages: state.query,conversationMessages:state.dmQuery }), useLocale: () => "en", useT: () => (key: string) => key }));
vi.mock("@client-kit/platform/react/inbox-surface", () => ({ InboxDetailHeader: ({ title }: {title: string}) => <header>{title}</header> }));
vi.mock("@/features/chat/ui/MessageContent", () => ({ MessageContent: ({content}: {content:string}) => <p>{content}</p> }));
vi.mock("@/platform/bff-client", () => ({ fetchUserState:vi.fn(), bff:{profile:async()=>({pubkey:"c".repeat(64)}),messageAuthorProfile:(...args:unknown[])=>state.authorProfile(...args),conversationMessageAuthorProfile:(...args:unknown[])=>state.dmAuthorProfile(...args),customEmoji:async()=>({events:[],mediaPaths:{}})},publishConversationMessage:(...args:unknown[])=>state.dmPublish(...args),uploadConversationMedia:vi.fn(),mediaUrl:vi.fn(),publishMessageReaction:(...args:unknown[])=>state.reaction(...args),publishMessage: (...args: unknown[]) => state.publish(...args), openStream: (scope: string, receive: (frame: StreamFrame) => void,conversationId?:string) => { state.stream(scope,conversationId);state.receive = receive; return () => {}; } }));
vi.mock("./ChannelPane", async (original) => ({ ...await original<typeof import("./ChannelPane")>(), Composer: ({ disabled, onPublish, replyTarget, onCancelReply, draftKey, mentionPeople }: {disabled: boolean; onPublish: (content: string, attachments: [], key: string, installations: [], people: string[]) => Promise<unknown>; replyTarget?: {id:string;body:string}; onCancelReply?:()=>void; draftKey?:string; mentionPeople?:{displayName:string;pubkey:string}[]}) => <div data-testid="inbox-composer" data-draft-key={draftKey} data-people={JSON.stringify(mentionPeople)}>
  {replyTarget ? <div data-testid="reply-preview">{replyTarget.body}{onCancelReply ? <button data-testid="cancel-reply" onClick={onCancelReply}>cancel reply</button> : null}</div> : null}
  <button data-testid="inbox-send" disabled={disabled} onClick={async () => { try { await onPublish("actual reply", [], "same-intent", [], state.mentionPubkeys); state.outcome = "confirmed"; } catch (error) { state.error = error; state.outcome = "unknown"; } }}>send</button>
</div> }));

const rootId = "a".repeat(64); const replyId = "b".repeat(64); const pubkey = "c".repeat(64);
const event = (id: string, content: string, tags: string[][]) => ({ id, content, tags, pubkey, kind: 9, created_at: id === rootId ? 1 : 2 });
const rootEvent = event(rootId, "thread root", [["h", "workspace"]]);
const reply = event(replyId, "selected reply", [["h", "workspace"], ["e", rootId, "", "root"], ["e", rootId, "", "reply"]]);
const bounds = (next: { createdAt:number; eventId:string } | null = null, start = "head") => ({...rootEvent,id:"0".repeat(64),kind:39006,tags:[["h","workspace"],["d",`workspace:${start}`]],content:JSON.stringify({has_more:next!==null,next_cursor:next ? {created_at:next.createdAt,id:next.eventId} : null})});
const conversation={id:"private-binding",channelId:"workspace",participantPrincipalIds:["human","peer"],state:ItemState.Active,version:1,operationId:"op"};
let host: HTMLDivElement; let root: Root; let query: QueryClient;
async function settle() { for (let index = 0; index < 8; index++) await act(async () => { await vi.advanceTimersByTimeAsync(10); }); }
async function mount(replyTargetEventId?: string) {
  await act(async () => root.render(<QueryClientProvider client={query}><TooltipProvider><InboxThreadPane principalId="human" workspaceId="workspace" rootId={rootId} selectedEventId={replyId}
    replyTargetEventId={replyTargetEventId} channelName="Admitted channel" members={[{ principalId: "human", displayName: "Member", pubkeys: [pubkey], state: WorkspaceMembershipState.Active }]} onOpen={vi.fn()} onOpenAuthor={state.openAuthor} onAuthorScopeUnavailable={state.unavailable} /></TooltipProvider></QueryClientProvider>));
  await settle();
}
async function mountDm(selected = replyId, rootEventId = rootId, members: {principalId:string;displayName:string;pubkeys:string[]}[] = []) {
  await act(async()=>root.render(<QueryClientProvider client={query}><TooltipProvider><InboxThreadPane principalId="human" workspaceId="workspace" conversation={conversation} rootId={rootEventId} selectedEventId={selected} channelName="Peer" members={members} onOpen={vi.fn()}/></TooltipProvider></QueryClientProvider>));
  await settle();
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); state.outcome = ""; state.error = null;
  state.mentionPubkeys = [];
  localStorage.clear(); setLocale("en");
  vi.stubGlobal("Image",function(){
    const image=document.createElement("img");let source="";
    Object.defineProperties(image,{complete:{value:true},naturalWidth:{value:1},src:{get:()=>source,set:(value:string)=>{
      source=value;queueMicrotask(()=>image.dispatchEvent(new Event("load")));
    }}});return image;
  });
  Object.defineProperty(window, "matchMedia", {configurable:true,value:()=>({matches:false,addEventListener(){},removeEventListener(){}})});
  state.query.mockResolvedValue({ events: [rootEvent, reply] });
  const author={pubkey,eventId:"profile",displayName:"Member",about:null,avatarUrl:null,nip05Handle:null,avatarMediaPaths:{}};
  state.authorProfile.mockResolvedValue(author);state.dmAuthorProfile.mockResolvedValue(author);
  state.publish.mockResolvedValue({ eventId: "d".repeat(64), operationId: "operation" });
  state.reaction.mockResolvedValue({eventId:"d".repeat(64),operationId:"operation"});
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); query.clear(); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("reads the true thread and preserves the original selected-reply parent when publishing", async () => {
  await mount();
  expect(state.query).toHaveBeenCalledWith("workspace", { messageType: "STREAM", parentEventId: rootId });
  expect(host.textContent).toContain("selected reply");
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(state.publish).toHaveBeenCalledWith("workspace", "actual reply", [], "same-intent", [], { messageType: "STREAM", parentEventId: rootId, mentionPubkeys: [] });
  expect(state.outcome).toBe("confirmed");
});

it("keeps hidden DM thread read, live subscription and confirmed reply on the existing conversation routes",async()=>{
  const unrelated=event("e".repeat(64),"same DM unrelated message",[["h","workspace"]]);
  state.dmQuery.mockImplementation(async (_id, query) => ({events:query.parentEventId ? [rootEvent,reply] : [unrelated,rootEvent,bounds()]}));
  state.dmPublish.mockResolvedValue({eventId:"f".repeat(64),operationId:"dm-publication"});
  await mountDm();
  expect(state.dmQuery).toHaveBeenCalledWith("private-binding",{messageType:"STREAM"});
  expect(state.dmQuery).toHaveBeenCalledWith("private-binding",{messageType:"STREAM",parentEventId:rootId});
  expect(host.textContent).toContain("same DM unrelated message");
  expect(host.textContent).toContain("selected reply");
  expect(state.query).not.toHaveBeenCalled();
  expect(state.stream).toHaveBeenCalledWith("workspace","private-binding");
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(state.dmPublish).toHaveBeenCalledWith("private-binding","actual reply",[],"same-intent",undefined,rootId,[]);
  expect(state.publish).not.toHaveBeenCalled();expect(state.outcome).toBe("confirmed");
});

it("passes admitted channel people through the real helper and preserves human recipients on an Inbox reply",async()=>{
  state.mentionPubkeys=[pubkey];
  await mount();
  expect(JSON.parse(host.querySelector('[data-testid="inbox-composer"]')!.getAttribute("data-people")!)).toEqual([{displayName:"Member",pubkey}]);
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(state.publish).toHaveBeenCalledWith("workspace","actual reply",[],"same-intent",[],{messageType:"STREAM",parentEventId:rootId,mentionPubkeys:[pubkey]});
});

it("passes admitted DM people and exact human recipients into the existing conversation reply route",async()=>{
  state.mentionPubkeys=[pubkey];
  state.dmQuery.mockImplementation(async (_id,options)=>({events:options.parentEventId?[rootEvent,reply]:[rootEvent,bounds()]}));
  state.dmPublish.mockResolvedValue({eventId:"f".repeat(64),operationId:"dm-publication"});
  await mountDm(replyId,rootId,[{principalId:"peer",displayName:"Peer",pubkeys:[pubkey]}]);
  expect(JSON.parse(host.querySelector('[data-testid="inbox-composer"]')!.getAttribute("data-people")!)).toEqual([{displayName:"Peer",pubkey}]);
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(state.dmPublish).toHaveBeenCalledWith("private-binding","actual reply",[],"same-intent",undefined,rootId,[pubkey]);
});

it("reads older DM windows with the signed descending cursor without moving the selected reply or draft",async()=>{
  const cursor={createdAt:1,eventId:rootId};
  const older={...event("1".repeat(64),"older conversation message",[["h","workspace"]]),created_at:0};
  state.dmQuery.mockImplementation(async (_id,query) => query.parentEventId ? {events:[rootEvent,reply]} : query.beforeId
    ? {events:[older,bounds(null,`1:${rootId}`)]} : {events:[rootEvent,bounds(cursor)],nextCursor:cursor});
  await mountDm();
  await act(async()=>[...host.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent==="forum.more")!.click());
  await settle();
  expect(state.dmQuery).toHaveBeenCalledWith("private-binding",{messageType:"STREAM",before:1,beforeId:rootId});
  expect(host.textContent).toContain("older conversation message");
  await mountDm("9".repeat(64),"9".repeat(64));
  expect(host.querySelector('[data-testid="inbox-composer"]')?.getAttribute("data-draft-key")).toBe(`thread:workspace:${rootId}`);
  expect(state.dmQuery.mock.calls.every(call=>call[1].parentEventId!=="9".repeat(64))).toBe(true);
});

it("restores an off-window DM selection with its edits but not unrelated thread replies",async()=>{
  const intermediate=event("2".repeat(64),"unselected nested reply",reply.tags);
  const cursor={createdAt:2,eventId:intermediate.id};
  const edited={...reply,id:"3".repeat(64),kind:40003,content:"edited selected reply",created_at:4,tags:[["h","workspace"],["e",replyId]]};
  state.dmQuery.mockImplementation(async (_id,query) => !query.parentEventId ? {events:[rootEvent,bounds()]} : query.beforeId
    ? {events:[rootEvent,reply,edited]} : {events:[rootEvent,intermediate],nextCursor:cursor});
  await mountDm();
  expect(state.dmQuery).toHaveBeenCalledWith("private-binding",{messageType:"STREAM",parentEventId:rootId,before:2,beforeId:intermediate.id});
  expect(host.textContent).toContain("edited selected reply");
  expect(host.textContent).not.toContain("unselected nested reply");
});

it("withdraws DM history when its bounds are missing, cursor repeats, or binding is revoked",async()=>{
  state.dmQuery.mockResolvedValue({events:[rootEvent,reply]});
  await mountDm();
  expect(host.textContent).toContain("platform.loadFailed");
  expect(host.textContent).not.toContain("selected reply");
  const cursor={createdAt:1,eventId:rootId};
  state.dmQuery.mockImplementation(async (_id,query) => query.parentEventId ? {events:[rootEvent,reply]} : {events:[rootEvent,bounds(cursor,query.beforeId ? `1:${rootId}` : "head")]});
  await act(async()=>[...host.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent==="platform.refresh")!.click());
  await settle();
  await act(async()=>[...host.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent==="forum.more")!.click());
  await settle();
  expect(host.textContent).toContain("platform.loadFailed");
  await act(async()=>state.receive!({type:"closed",reason:"binding-not-active"}));
  expect(host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')?.disabled).toBe(true);
  expect(host.textContent).not.toContain("selected reply");
});

it("renders the original Inbox reaction pill and removes only the own signed reaction",async()=>{
  const reactionId="e".repeat(64);
  state.query.mockResolvedValue({events:[rootEvent,reply,{...reply,id:reactionId,kind:7,content:"👍",tags:[["e",replyId]]}]});
  await mount();
  const pill=[...host.querySelectorAll<HTMLButtonElement>('button[aria-label]')].find(button=>button.getAttribute("aria-label")==="Toggle 👍 reaction");
  expect(pill).toBeDefined();
  await act(async()=>pill!.click());await settle();
  expect(state.reaction).toHaveBeenCalledWith("workspace",undefined,{operation:"UNLIKE",content:"",targetEventId:reactionId},expect.any(String));
});

it("restores an explicit nested reply draft without retargeting it to its parent", async () => {
  await mount(replyId);
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(state.query).toHaveBeenCalledWith("workspace", { messageType: "STREAM", parentEventId: rootId });
  expect(state.publish).toHaveBeenCalledWith("workspace", "actual reply", [], "same-intent", [], { messageType: "STREAM", parentEventId: replyId, mentionPubkeys: [] });
});

it("does not report an unconfirmed receipt as success and removes detail on revoked admission", async () => {
  state.publish.mockResolvedValue({ operationId: "operation" });
  await mount();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(state.outcome).toBe("unknown");
  await act(async () => state.receive!({ type: "closed", reason: "scope-revoked" }));
  await settle();
  expect(host.textContent).not.toContain("selected reply");
  expect(host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')?.disabled).toBe(true);
});

it("restores the original row reply toggle and banner while cancelling returns to the captured parent", async () => {
  await mount();
  const select = () => host.querySelector<HTMLButtonElement>(`[data-testid="reply-message-${replyId}"]`)!;
  expect(select().getAttribute("aria-label")).toBe("Reply");
  await act(async () => select().click());
  expect(host.querySelector('[data-testid="reply-preview"]')?.textContent).toContain("selected reply");
  expect(host.querySelector('[data-testid="inbox-composer"]')?.getAttribute("data-draft-key")).toBe(`thread:workspace:${rootId}:${replyId}`);
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(state.publish.mock.lastCall?.[5]).toEqual({messageType:"STREAM",parentEventId:replyId,mentionPubkeys:[]});
  await settle();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="cancel-reply"]')!.click());
  expect(host.querySelector('[data-testid="reply-preview"]')).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(state.publish.mock.lastCall?.[5]).toEqual({messageType:"STREAM",parentEventId:rootId,mentionPubkeys:[]});
  await settle();
  await act(async () => select().click());
  await act(async () => select().click());
  expect(host.querySelector('[data-testid="reply-preview"]')).toBeNull();
});

it("keeps the same target and draft after UNKNOWN and a later forbidden observation", async () => {
  state.publish.mockRejectedValueOnce(new TransportError("receipt missing"));
  await mount();
  await act(async () => host.querySelector<HTMLButtonElement>(`[data-testid="reply-message-${replyId}"]`)!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(host.querySelector(`[data-testid="reply-message-${rootId}"]`)).toBeNull();
  expect(host.querySelector('[data-testid="cancel-reply"]')).toBeNull();
  expect(host.querySelector('[data-testid="reply-preview"]')?.textContent).toContain("selected reply");
  state.publish.mockRejectedValueOnce(new BffError(403,"forbidden",{class:ErrorClass.Denied,reason:ReasonCode.PermissionDenied}));
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(host.querySelector('[data-testid="cancel-reply"]')).toBeNull();
  expect(state.error).toBeInstanceOf(TransportError);
  expect(state.publish.mock.calls.every((call) => call[3] === "same-intent" && call[5].parentEventId === replyId)).toBe(true);
  state.publish.mockResolvedValueOnce({eventId:"d".repeat(64),operationId:"operation"});
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(host.querySelector('[data-testid="cancel-reply"]')).not.toBeNull();
});
it("opens the selected Inbox message author and withdraws that scope on revoked admission", async () => {
  await mount();
  const row=host.querySelector(`[data-message-id="${replyId}"]`)!;
  const trigger=row.querySelector<HTMLElement>('[role="button"][aria-label="Profile"]')!;
  await act(async () => trigger.click());
  expect(state.openAuthor).toHaveBeenCalledWith({principalId:"human",workspaceId:"workspace",eventId:replyId,pubkey});
  await act(async () => state.receive!({type:"closed",reason:"scope-revoked"}));
  await settle();
  expect(state.unavailable).toHaveBeenCalledWith("workspace");
  expect(host.querySelector('[aria-label="Profile"]')).toBeNull();
});

it("restores the original Inbox detail author avatar through each admitted message and withdraws it on interruption",async()=>{
  const avatarUrl="https://community.example/media/author.png",mediaPath="/api/v1/workspaces/workspace/media/author";
  state.authorProfile.mockResolvedValue({pubkey,eventId:"profile",displayName:"Member",about:null,avatarUrl,nip05Handle:null,avatarMediaPaths:{[avatarUrl]:mediaPath}});
  await mount();
  expect(state.authorProfile).toHaveBeenCalledWith("workspace",rootId);
  expect(state.authorProfile).toHaveBeenCalledWith("workspace",replyId);
  const avatars=[...host.querySelectorAll('[data-testid="message-avatar"]')];
  expect(avatars).toHaveLength(2);
  for(const avatar of avatars){
    expect(avatar.classList.contains("h-9")).toBe(true);expect(avatar.classList.contains("w-9")).toBe(true);
    expect(avatar.querySelector("img")?.getAttribute("src")).toBe(mediaPath);
  }
  expect(state.dmAuthorProfile).not.toHaveBeenCalled();expect(state.openAuthor).not.toHaveBeenCalled();expect(state.publish).not.toHaveBeenCalled();
  await act(async()=>state.receive!({type:"interrupted"}));await settle();
  expect(host.querySelector("img")).toBeNull();expect(host.querySelector('[aria-label="Profile"]')).toBeNull();
});

it("reads Inbox DM avatars only through the admitted conversation and keeps a rejected identity as the original fallback",async()=>{
  const avatarUrl="https://community.example/media/dm-author.png",mediaPath="/api/v1/conversations/private-binding/media/author";
  state.dmQuery.mockImplementation(async(_id,options)=>({events:options.parentEventId?[rootEvent,reply]:[rootEvent,bounds()]}));
  state.dmAuthorProfile.mockImplementation(async(_id,eventId)=>({pubkey:eventId===replyId?"f".repeat(64):pubkey,eventId:"profile",displayName:"Peer",about:null,avatarUrl,nip05Handle:null,avatarMediaPaths:{[avatarUrl]:mediaPath}}));
  await mountDm();
  expect(state.dmAuthorProfile).toHaveBeenCalledWith("private-binding",rootId);
  expect(state.dmAuthorProfile).toHaveBeenCalledWith("private-binding",replyId);
  expect(state.authorProfile).not.toHaveBeenCalled();
  const row=(id:string)=>host.querySelector(`[data-message-id="${id}"]`)!;
  expect(row(rootId).querySelector("img")?.getAttribute("src")).toBe(mediaPath);
  expect(row(replyId).querySelector("img")).toBeNull();
  expect(host.querySelector('[aria-label="Profile"]')).toBeNull();
  expect(state.dmPublish).not.toHaveBeenCalled();expect(state.publish).not.toHaveBeenCalled();
  await act(async()=>state.receive!({type:"closed",reason:"binding-not-active"}));await settle();
  expect(host.querySelector("img")).toBeNull();expect(host.textContent).not.toContain("selected reply");
});
