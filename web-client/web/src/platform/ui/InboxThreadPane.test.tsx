// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkspaceMembershipState, ConversationViewState } from "@client-kit/contracts";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { setLocale, translate } from "@client-kit/platform/i18n";
import { ComposerReplyBanner, type TimelineMessage } from "@client-kit/platform/react/messages";
import { BffError, TransportError } from "@client-kit/platform/transport";
import { ErrorClass, ReasonCode } from "@client-kit/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { StreamFrame } from "../bff-client";
import { clearAllDrafts, initDraftStore, loadDraftEntry, saveDraftEntry, loadPendingSend, savePendingSend, type DraftState } from "@client-kit/platform/react/composer/features/messages/lib/useDrafts";
import { draftMessageTarget } from "./InboxDrafts";
import { InboxThreadPane } from "./InboxThreadPane";
import { CHANNEL_AUX_EVENT_KINDS, CHANNEL_TIMELINE_CONTENT_KINDS, KIND_TYPING_INDICATOR, KIND_CHANNEL_THREAD_SUMMARY } from "@client-kit/platform/react/thread/kinds";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ realComposer:false, query: vi.fn(), dmQuery:vi.fn(), dmPublish:vi.fn(), delete:vi.fn(), authorProfile:vi.fn(),dmAuthorProfile:vi.fn(),stream:vi.fn(), publish: vi.fn(), reaction:vi.fn(), videoPresentation:vi.fn(), openAuthor:vi.fn(), unavailable:vi.fn(), mentionPubkeys: [] as string[], receive: null as null | ((frame: StreamFrame) => void), outcome: "", error: null as unknown }));
vi.mock("@client-kit/platform/react/video-review", async original => {
  const actual=await original<typeof import("@client-kit/platform/react/video-review")>();
  return {...actual,buildVideoReviewPresentationByMessageId:(...args:Parameters<typeof actual.buildVideoReviewPresentationByMessageId>)=>{
    state.videoPresentation(...args);
    return actual.buildVideoReviewPresentationByMessageId(...args);
  }};
});
vi.mock("@client-kit/platform/react/context", async (original) => ({ ...await original<typeof import("@client-kit/platform/react/context")>(), useBffClient: () => ({ workspaceMessages: state.query,conversationMessages:state.dmQuery }), useLocale: () => "en", useT: () => (key: string,variables?:Record<string,string|number>) => translate("en",key as Parameters<typeof translate>[1],variables) }));
vi.mock("@client-kit/platform/react/inbox-surface", async original => {
  const actual = await original<typeof import("@client-kit/platform/react/inbox-surface")>();
  return {...actual, InboxDetailHeader: (props: React.ComponentProps<typeof actual.InboxDetailHeader>) =>
    <header title={props.openLabel}><actual.InboxDetailHeader {...props} /></header>};
});
vi.mock("@/features/chat/ui/MessageContent", () => ({ MessageContent: ({content}: {content:string}) => <p>{content}</p> }));
vi.mock("@/platform/bff-client", () => ({ fetchUserState:vi.fn(), bff:{profile:async()=>({pubkey:"c".repeat(64)}),messageAuthorProfile:(...args:unknown[])=>state.authorProfile(...args),conversationMessageAuthorProfile:(...args:unknown[])=>state.dmAuthorProfile(...args),customEmoji:async()=>({events:[],mediaPaths:{}}),
  messageAuthorProfiles:async(scope:string,{eventIds}:{eventIds:string[]})=>({profiles:Object.fromEntries(await Promise.all(eventIds.map(async id=>[id,await state.authorProfile(scope,id)])))}),
  conversationMessageAuthorProfiles:async(scope:string,{eventIds}:{eventIds:string[]})=>({profiles:Object.fromEntries(await Promise.all(eventIds.map(async id=>[id,await state.dmAuthorProfile(scope,id)])))}),
},deleteMessage:(...args:unknown[])=>state.delete(...args),publishConversationMessage:(...args:unknown[])=>state.dmPublish(...args),uploadConversationMedia:vi.fn(),mediaUrl:vi.fn(),publishMessageReaction:(...args:unknown[])=>state.reaction(...args),publishMessage: (...args: unknown[]) => state.publish(...args), openStream: (scope: string, receive: (frame: StreamFrame) => void,conversationId?:string) => { state.stream(scope,conversationId);state.receive = receive; return () => {}; } }));
vi.mock("./ChannelPane", async original => {
  const actual=await original<typeof import("./ChannelPane")>();
  const fixture=({ disabled, onPublish, replyTarget, onCancelReply, draftKey, mentionPeople,placeholder, editTarget,onConfirmed,onCancelEdit,onRequestEmptyEditDelete }: {disabled: boolean; onPublish: (content: string, attachments: [], key: string, installations: [], people: string[]) => Promise<unknown>; replyTarget?: {id:string;body:string;author:string}; onCancelReply?:()=>void; draftKey?:string; mentionPeople?:{displayName:string;pubkey:string}[];placeholder?:string;editTarget?:TimelineMessage;onConfirmed?:()=>void;onCancelEdit?:()=>void;onRequestEmptyEditDelete?:(message:TimelineMessage)=>void}) => <div data-testid="inbox-composer" data-edit-id={editTarget?.id} data-draft-key={draftKey} data-people={JSON.stringify(mentionPeople)} data-placeholder={placeholder}>
  <ComposerReplyBanner replyTarget={replyTarget}/>
  {replyTarget ? <div data-testid="reply-preview">{replyTarget.body}{onCancelReply ? <button data-testid="cancel-reply" onClick={onCancelReply}>cancel reply</button> : null}</div> : null}
  {editTarget&&onCancelEdit?<button data-testid="cancel-edit" onClick={onCancelEdit}>cancel edit</button>:null}
  {editTarget&&onRequestEmptyEditDelete?<button data-testid="empty-edit" disabled={disabled} onClick={()=>onRequestEmptyEditDelete(editTarget)}>empty edit</button>:null}
  <button data-testid="inbox-send" disabled={disabled} onClick={async () => { try { await onPublish(editTarget?"updated body":"actual reply", [], "same-intent", [], state.mentionPubkeys); state.outcome = "confirmed";onConfirmed?.(); } catch (error) { state.error = error; state.outcome = "unknown"; } }}>send</button>
</div>;
  return {...actual,Composer:(props:ComponentProps<typeof actual.Composer>)=>state.realComposer
    ? <actual.Composer {...props}/> : fixture(props as Parameters<typeof fixture>[0])};
});

const rootId = "a".repeat(64); const replyId = "b".repeat(64); const pubkey = "c".repeat(64);
const event = (id: string, content: string, tags: string[][]) => ({ id, content, tags, pubkey, kind: 9, created_at: id === rootId ? 1 : 2 });
const rootEvent = event(rootId, "thread root", [["h", "workspace"]]);
const reply = event(replyId, "selected reply", [["h", "workspace"], ["e", rootId, "", "root"], ["e", rootId, "", "reply"]]);
const bounds = (next: { createdAt:number; eventId:string } | null = null, start = "head") => ({...rootEvent,id:"0".repeat(64),kind:39006,tags:[["h","workspace"],["d",`workspace:${start}`]],content:JSON.stringify({has_more:next!==null,next_cursor:next ? {created_at:next.createdAt,id:next.eventId} : null})});
async function openMessageMenu(id:string) {
  const trigger=host.querySelector<HTMLElement>(`[data-testid="more-actions-${id}"]`);
  expect(trigger).not.toBeNull();
  await act(async()=>{trigger!.focus();trigger!.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}));});
  await settle();
}
async function editMessage(id:string) {
  await openMessageMenu(id);
  const action=document.querySelector<HTMLElement>(`[data-testid="edit-message-${id}"]`);
  expect(action).not.toBeNull();
  await act(async()=>action!.click());await settle();
  expect(host.querySelector(`[data-edit-id="${id}"]`)).not.toBeNull();
}
const conversation={id:"private-binding",channelId:"workspace",participantPrincipalIds:["human","peer"],state:ConversationViewState.Active,version:1,operationId:"op"};
let host: HTMLDivElement; let root: Root; let query: QueryClient;
async function settle() { for (let index = 0; index < 8; index++) await act(async () => { await vi.advanceTimersByTimeAsync(10); }); }
async function mount(replyTargetEventId?: string, selected = replyId, selectedRoot = rootId, explicitSelection = false, forum = false) {
  await act(async () => root.render(<QueryClientProvider client={query}><TooltipProvider><InboxThreadPane principalId="human" workspaceId="workspace" rootId={selectedRoot} selectedEventId={selected}
    forum={forum} selectionItemId={explicitSelection ? selected : undefined} replyTargetEventId={replyTargetEventId} channelName="Admitted channel" members={[{ principalId: "human", displayName: "Member", pubkeys: [pubkey], state: WorkspaceMembershipState.Active }]} onOpen={vi.fn()} onOpenAuthor={state.openAuthor} onAuthorScopeUnavailable={state.unavailable} /></TooltipProvider></QueryClientProvider>));
  await settle();
}
async function mountDm(selected = replyId, rootEventId = rootId, members: {principalId:string;displayName:string;pubkeys:string[]}[] = [],draft?:{key:string;parent:string}) {
  await act(async()=>root.render(<QueryClientProvider client={query}><TooltipProvider><InboxThreadPane principalId="human" workspaceId="workspace" conversation={conversation} rootId={rootEventId} selectedEventId={selected} channelName="Peer" senderLabel="Original sender" members={members} restoreDraftKey={draft?.key} replyTargetEventId={draft?.parent} onOpen={vi.fn()}/></TooltipProvider></QueryClientProvider>));
  await settle();
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); state.outcome = ""; state.error = null;
  state.mentionPubkeys = []; state.realComposer=false; clearAllDrafts();
  localStorage.clear(); setLocale("en");
  vi.stubGlobal("ResizeObserver",class{observe(){} unobserve(){} disconnect(){}});
  Object.defineProperties(Range.prototype,{getClientRects:{configurable:true,value:()=>[]},getBoundingClientRect:{configurable:true,value:()=>new DOMRect()}});
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
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable:true, value:vi.fn(function(this:HTMLElement, options:ScrollToOptions) { this.scrollTop=options.top ?? this.scrollTop; }) });
  vi.stubGlobal("CSS", {escape:(value:string)=>value}); // fixture event IDs are hex
  query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); query.clear(); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function openHeaderDelete() {
  const trigger = host.querySelector<HTMLElement>('[data-testid="home-inbox-detail-more"]');
  expect(trigger).not.toBeNull();
  await act(async () => { trigger!.focus(); trigger!.dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowDown", bubbles:true})); });
  await settle();
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent?.includes(translate("en", "buzz.deleteMessage")))!;
}

it.each([9, 45001, 45003])("restores the original header delete for kind %s without retargeting its UNKNOWN intent", async kind => {
  const targetId = kind === 45001 ? rootId : replyId;
  state.query.mockResolvedValue({events:[{...rootEvent,kind:kind === 9 ? 9 : 45001},{...reply,kind:kind === 9 ? 9 : 45003}]});
  state.delete.mockRejectedValueOnce(new TransportError("lost delete receipt")).mockResolvedValueOnce({eventId:"d".repeat(64),operationId:"delete-op"});
  await mount(undefined,targetId,rootId,true,kind !== 9);
  const remove = await openHeaderDelete();
  await act(async () => remove.click()); await settle();
  const confirm = () => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button =>
    button.textContent === translate("en", "buzz.delete") || button.textContent === translate("en", "forum.deleteCheck"))!;
  expect(state.delete).not.toHaveBeenCalled();
  await act(async () => confirm().click()); await settle();
  const messageType = kind === 45001 ? "FORUM_POST" : kind === 45003 ? "FORUM_COMMENT" : "STREAM";
  expect(state.delete).toHaveBeenCalledExactlyOnceWith("workspace",targetId,messageType,undefined);
  await mount(undefined,targetId === rootId ? replyId : rootId,rootId,true,kind !== 9);
  await act(async () => confirm().click()); await settle();
  expect(state.delete.mock.calls).toEqual([["workspace",targetId,messageType,undefined],["workspace",targetId,messageType,undefined]]);
});

it("closes the captured header menu on another anchor and denies foreign or revoked delete targets", async () => {
  await mount();
  const previous = await openHeaderDelete();
  expect(previous).toBeDefined();
  await mount(undefined,rootId,rootId,true);
  expect(document.querySelector('[role="menu"]')).toBeNull();
  await act(async () => previous.click()); await settle();
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(state.delete).not.toHaveBeenCalled();
  state.query.mockResolvedValue({events:[rootEvent,{...reply,pubkey:"f".repeat(64)}]});
  await act(async () => query.invalidateQueries()); await settle();
  await mount(undefined,replyId,rootId,true);
  expect(host.querySelector('[data-testid="home-inbox-detail-more"]')).toBeNull();
  await act(async()=>state.receive?.({type:"closed",reason:"scope-revoked"})); await settle();
  expect(host.querySelector('[data-testid="home-inbox-detail-more"]')).toBeNull();
  expect(state.delete).not.toHaveBeenCalled();
});

it.each([45001,45003])("reads original Forum kind %s context without pretending inline replies are supported",async kind=>{
  const post={...rootEvent,kind:45001};
  const comment={...reply,kind:45003};
  state.query.mockResolvedValue({events:[post,comment]});
  const selected=kind===45001?rootId:replyId;
  await act(async()=>root.render(<QueryClientProvider client={query}><TooltipProvider><InboxThreadPane
    principalId="human" workspaceId="workspace" rootId={rootId} selectedEventId={selected} forum
    channelName="Original Forum" members={[{principalId:"human",displayName:"Member",pubkeys:[pubkey],state:WorkspaceMembershipState.Active}]}
    onOpen={vi.fn()}/></TooltipProvider></QueryClientProvider>));
  await settle();
  expect(state.query).toHaveBeenCalledWith("workspace",{messageType:"FORUM_COMMENT",parentEventId:rootId});
  expect(host.querySelector(`[data-message-id="${selected}"]`)).not.toBeNull();
  expect(host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')?.disabled).toBe(true);
  expect(host.querySelector('[data-testid="inbox-composer"]')?.getAttribute("data-placeholder")).toBe("This item does not support inline replies yet.");
  expect(state.publish).not.toHaveBeenCalled();
  const video=state.videoPresentation.mock.lastCall?.[0];
  expect(video?.onSendVideoReviewComment).toBeUndefined();
  expect(video?.onToggleReaction).toBeTypeOf("function");
  await act(async()=>state.receive?.({type:"closed",reason:"scope-revoked"}));
  await settle();
  expect(host.querySelector(`[data-message-id="${selected}"]`)).toBeNull();
  expect(state.videoPresentation.mock.lastCall?.[0].onToggleReaction).toBeUndefined();
});

it.each([9,45001,45003])("keeps original Forum kind %s management independent of the unsupported inline reply",async kind=>{
  const post={...rootEvent,kind:45001};
  const target=kind===45001?post:{...reply,kind};
  const targetId=target.id;
  const messageType=kind===45001?"FORUM_POST":kind===45003?"FORUM_COMMENT":"STREAM";
  const events=kind===45001?[post,reply]:[post,target];
  state.query.mockResolvedValue({events});
  state.publish.mockImplementation(async()=>{
    state.query.mockResolvedValue({events:[...events,{...target,id:"d".repeat(64),kind:40003,created_at:10,content:"updated body",tags:[["h","workspace"],["e",targetId]]}]});
    return {eventId:"d".repeat(64),operationId:"edit-op"};
  });
  await act(async()=>root.render(<QueryClientProvider client={query}><TooltipProvider><InboxThreadPane
    principalId="human" workspaceId="workspace" rootId={rootId} selectedEventId={rootId} forum
    channelName="Original Forum" members={[{principalId:"human",displayName:"Member",pubkeys:[pubkey],state:WorkspaceMembershipState.Active}]}
    onOpen={vi.fn()}/></TooltipProvider></QueryClientProvider>));
  await settle();
  expect(host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')?.disabled).toBe(true);
  await editMessage(targetId);
  expect(host.querySelector<HTMLButtonElement>('[data-edit-id] [data-testid="inbox-send"]')?.disabled).toBe(false);
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-edit-id] [data-testid="inbox-send"]')!.click());
  await settle();
  expect(state.publish).toHaveBeenCalledExactlyOnceWith("workspace","updated body",[],"same-intent",[],{editEventId:targetId,mentionPubkeys:[],...(kind===9?{}:{messageType})});
  expect(host.querySelector(`[data-message-id="${targetId}"]`)?.textContent).toContain("updated body");
  expect(host.querySelector('[data-message-id="'+"d".repeat(64)+'"]')).toBeNull();
  await openMessageMenu(targetId);
  const remove=document.querySelector<HTMLButtonElement>(`[data-testid="delete-message-${targetId}"]`);
  expect(remove).not.toBeNull();
  await act(async()=>remove!.click());await settle();
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  expect(state.delete).not.toHaveBeenCalled();
  state.delete.mockRejectedValueOnce(new TransportError("lost delete receipt")).mockResolvedValueOnce({eventId:"d".repeat(64),operationId:"delete-op"});
  const confirm=()=>[...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button=>button.textContent===translate("en","buzz.delete")||button.textContent===translate("en","forum.deleteCheck"))!;
  await act(async()=>confirm().click());await settle();
  expect(state.delete).toHaveBeenCalledExactlyOnceWith("workspace",targetId,messageType,undefined);
  expect(document.querySelector('[role="status"]')?.textContent).toContain(translate("en","forum.deleteUnknown"));
  await act(async()=>confirm().click());await settle();
  expect(state.delete.mock.calls).toEqual([["workspace",targetId,messageType,undefined],["workspace",targetId,messageType,undefined]]);
  await act(async()=>state.receive?.({type:"closed",reason:"scope-revoked"}));await settle();
  expect(host.querySelector(`[data-message-id="${targetId}"]`)).toBeNull();
});

it.each(["channel","conversation"] as const)("restores Inbox %s edit through the original action, captured target and actual edit projection",async scope=>{
  state.dmQuery.mockImplementation(async(_id,options)=>({events:options.parentEventId?[rootEvent,reply]:[rootEvent,reply,bounds()]}));
  if(scope==="channel")await mount();else await mountDm(replyId,rootId,[{principalId:"human",displayName:"Member",pubkeys:[pubkey]}]);
  await editMessage(replyId);
  const edited={...reply,id:"d".repeat(64),kind:40003,created_at:10,content:"updated body",tags:[["h","workspace"],["e",replyId]]};
  const publish=scope==="channel"?state.publish:state.dmPublish;
  publish.mockImplementation(async()=>{
    if(scope==="channel")state.query.mockResolvedValue({events:[rootEvent,reply,edited]});
    else state.dmQuery.mockImplementation(async(_id,options)=>({events:options.parentEventId?[rootEvent,reply,edited]:[rootEvent,reply,edited,bounds()]}));
    return {eventId:edited.id,operationId:"edit-op"};
  });
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-edit-id] [data-testid="inbox-send"]')!.click());await settle();
  expect(publish).toHaveBeenCalledTimes(1);
  if(scope==="channel")expect(publish.mock.calls[0]).toEqual(["workspace","updated body",[],"same-intent",[],{editEventId:replyId,mentionPubkeys:[]}]);
  else expect(publish.mock.calls[0]).toEqual([conversation.id,"updated body",[],"same-intent",replyId,undefined,[]]);
  expect(host.querySelector('[data-edit-id]')).toBeNull();
  expect(host.querySelector(`[data-message-id="${replyId}"]`)?.textContent).toContain("updated body");
  expect(host.querySelector(`[data-message-id="${edited.id}"]`)).toBeNull();
});

it("keeps an UNKNOWN edit on the same target/key during another Inbox selection and revokes its controls",async()=>{
  await mount();await editMessage(replyId);
  state.publish.mockRejectedValue(new TransportError("unknown"));
  const send=()=>host.querySelector<HTMLButtonElement>('[data-edit-id] [data-testid="inbox-send"]')!.click();
  await act(async()=>send());await settle();
  await mount(undefined,rootId,rootId,true);
  expect(host.querySelector('[data-edit-id]')?.getAttribute("data-edit-id")).toBe(replyId);
  expect(host.querySelector('[data-testid="cancel-edit"]')).toBeNull();
  await act(async()=>send());await settle();
  expect(state.publish.mock.calls).toHaveLength(2);
  expect(state.publish.mock.calls[1]).toEqual(state.publish.mock.calls[0]);
  await act(async()=>state.receive!({type:"closed",reason:"scope-revoked"}));await settle();
  expect(host.querySelector('[data-edit-id]')).toBeNull();
  expect(state.outcome).toBe("unknown");
});

it("does not offer Inbox editing for another signed author",async()=>{
  state.query.mockResolvedValue({events:[rootEvent,{...reply,pubkey:"e".repeat(64)}]});
  await mount();await openMessageMenu(replyId);
  expect(document.querySelector(`[data-testid="edit-message-${replyId}"]`)).toBeNull();
  expect(document.querySelector(`[data-testid="delete-message-${replyId}"]`)).toBeNull();
  expect(state.publish).not.toHaveBeenCalled();
});

it("uses the original empty-edit delete confirmation and keeps the editor on cancel",async()=>{
  await mount();await editMessage(replyId);
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="empty-edit"]')!.click());await settle();
  const dialog=document.querySelector('[role="alertdialog"]');expect(dialog).not.toBeNull();
  expect(state.delete).not.toHaveBeenCalled();
  await act(async()=>[...dialog!.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent===translate("en","forum.cancel"))!.click());await settle();
  expect(host.querySelector('[data-edit-id]')?.getAttribute("data-edit-id")).toBe(replyId);
  expect(state.publish).not.toHaveBeenCalled();expect(state.delete).not.toHaveBeenCalled();
});

it("keeps UNKNOWN deletion on its original Inbox target, refuses new edit/reply, and reconciles the same deletion",async()=>{
  await mount();await editMessage(replyId);
  state.delete.mockRejectedValueOnce(new TransportError("lost delete receipt")).mockResolvedValueOnce({eventId:"d".repeat(64),operationId:"delete-op"});
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="empty-edit"]')!.click());await settle();
  const confirm=()=>[...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button=>button.textContent===translate("en","buzz.delete")||button.textContent===translate("en","forum.deleteCheck"))!;
  await act(async()=>confirm().click());await settle();
  expect(state.delete).toHaveBeenCalledExactlyOnceWith("workspace",replyId,"STREAM",undefined);
  expect(host.querySelector<HTMLButtonElement>('[data-edit-id] [data-testid="inbox-send"]')?.disabled).toBe(true);
  expect(host.querySelector<HTMLButtonElement>('[data-testid="inbox-composer"]:not([data-edit-id]) [data-testid="inbox-send"]')?.disabled).toBe(true);
  expect(document.querySelector('[role="status"]')?.textContent).toContain(translate("en","forum.deleteUnknown"));
  await act(async()=>confirm().click());await settle();
  expect(state.delete.mock.calls).toEqual([["workspace",replyId,"STREAM",undefined],["workspace",replyId,"STREAM",undefined]]);
  expect(host.querySelector('[data-edit-id]')).toBeNull();
  expect(state.publish).not.toHaveBeenCalled();
});

it.each(["channel", "conversation"] as const)("refreshes the actual %s thread once at the live boundary, not for stored or typing frames", async (scope) => {
  state.dmQuery.mockImplementation(async (_id, options) => ({events: options.parentEventId ? [rootEvent, reply] : [rootEvent, reply, bounds()]}));
  if (scope === "channel") await mount();
  else await mountDm();
  const read = scope === "channel" ? state.query : state.dmQuery;
  // A DM read also resolves the selected reply through its admitted context.
  const readsPerRefresh = read.mock.calls.length;
  expect(readsPerRefresh).toBe(scope === "channel" ? 1 : 2);
  const send = async (frame: StreamFrame) => {
    await act(async () => state.receive!(frame));
    await settle();
  };
  const stored = [rootEvent, reply];
  await send({type: "snapshot", events: stored});
  for (const event of stored) await send({type: "event", event});
  await send({type: "event", event: {...reply, kind: KIND_TYPING_INDICATOR}});
  expect(read).toHaveBeenCalledTimes(readsPerRefresh);

  await send({type: "live"});
  let expected = readsPerRefresh * 2;
  expect(read).toHaveBeenCalledTimes(expected);
  await send({type: "live"});
  for (const kind of [KIND_TYPING_INDICATOR, KIND_CHANNEL_THREAD_SUMMARY]) {
    await send({type: "event", event: {...reply, kind}});
  }
  expect(read).toHaveBeenCalledTimes(expected);

  for (const kind of [...CHANNEL_TIMELINE_CONTENT_KINDS, ...CHANNEL_AUX_EVENT_KINDS]) {
    await send({type: "event", event: {...reply, kind}});
    expected += readsPerRefresh;
    expect(read).toHaveBeenCalledTimes(expected);
  }
  for (const frame of [{type: "interrupted"}, {type: "ended"}, {type: "closed", reason: "readmission-unavailable"}] satisfies StreamFrame[]) {
    await send(frame);
    await send({type: "event", event: reply});
    await send({type: "snapshot", events: []});
    expect(read).toHaveBeenCalledTimes(expected);
    await send({type: "live"});
    expected += readsPerRefresh;
    expect(read).toHaveBeenCalledTimes(expected);
  }
  await send({type: "closed", reason: "scope-revoked"});
  await send({type: "event", event: reply});
  expect(read).toHaveBeenCalledTimes(expected);
  expect(host.textContent).not.toContain("selected reply");
});

it("uses the resolved Inbox row author in the actual selected reply banner and removes it when scope closes",async()=>{
  state.authorProfile.mockResolvedValue({pubkey,eventId:"profile",displayName:"Actual inbox author",about:null,avatarUrl:null,nip05Handle:null,avatarMediaPaths:{}});
  await mount();
  expect(host.querySelector('[data-testid="message-author"]')?.textContent).toBe("Actual inbox author");
  await act(async()=>host.querySelector<HTMLButtonElement>(`[data-testid="reply-message-${replyId}"]`)!.click());
  expect(host.querySelector('[data-testid="reply-target"]')?.textContent).toContain("Replying to Actual inbox author");
  expect(host.querySelector('[data-testid="reply-target"]')?.textContent).toContain("selected reply");
  await act(async()=>state.receive!({type:"closed",reason:"scope-revoked"}));await settle();
  expect(host.textContent).not.toContain("Actual inbox author");
  expect(host.querySelector('[data-testid="reply-target"]')).toBeNull();
});

it("uses the admitted private profile for the DM reply banner without a workspace profile request",async()=>{
  state.dmQuery.mockResolvedValue({events:[rootEvent,reply,bounds()]});
  state.dmAuthorProfile.mockResolvedValue({pubkey,eventId:"profile",displayName:"Private author",about:null,avatarUrl:null,nip05Handle:null,avatarMediaPaths:{}});
  await mountDm(replyId,rootId,[{principalId:"human",displayName:"Member",pubkeys:[pubkey]}],{key:"draft",parent:replyId});
  expect(host.querySelector('[data-testid="reply-target"]')?.textContent).toContain("Replying to Private author");
  expect(state.authorProfile).not.toHaveBeenCalled();
  expect(state.dmAuthorProfile).toHaveBeenCalledWith("private-binding",replyId);
});

it("reads the true thread and preserves the original selected-reply parent when publishing", async () => {
  await mount();
  expect(state.query).toHaveBeenCalledWith("workspace", { messageType: "STREAM", parentEventId: rootId });
  expect(host.textContent).toContain("selected reply");
  expect(host.querySelector("header")?.textContent).toBe("Thread in #Admitted channel");
  expect(host.querySelector("header")?.title).toBe("Open full thread");
  expect(host.querySelector('[data-testid="inbox-composer"]')?.getAttribute("data-placeholder")).toBe("Send reply to #Admitted channel thread");
  expect(host.querySelector('[data-testid="inbox-composer"]')?.getAttribute("data-draft-key")).toBe(`thread:workspace:${rootId}`);
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(state.publish).toHaveBeenCalledWith("workspace", "actual reply", [], "same-intent", [], { messageType: "STREAM", parentEventId: rootId, mentionPubkeys: [] });
  expect(state.outcome).toBe("confirmed");
});

it("uses the original selected-message fade rather than leaving Web Inbox permanently highlighted", async () => {
  await mount();
  const highlight=()=>host.querySelector('[data-testid="home-inbox-selected-message"]')?.parentElement?.querySelector('[aria-hidden="true"]');
  expect(highlight()?.classList.contains("opacity-100")).toBe(true);
  await act(async()=>vi.advanceTimersByTimeAsync(1_119));
  expect(highlight()?.classList.contains("opacity-100")).toBe(true);
  await act(async()=>vi.advanceTimersByTimeAsync(1));
  expect(highlight()?.classList.contains("opacity-0")).toBe(true);
  await mount();
  expect(highlight()?.classList.contains("opacity-0")).toBe(true);
});

it("passes actual message emoji tags through the shared original Inbox sizing consumer", async () => {
  state.query.mockResolvedValue({events:[rootEvent,{...reply,content:"😀 :BUZZ:",tags:[...reply.tags,["emoji","buzz",new URL("emoji.png",window.location.href).href]]}]});
  await mount();
  const body=host.querySelector('[data-testid="home-inbox-selected-message"] [data-testid="message-body"] > div');
  expect(body?.classList.contains("text-4xl")).toBe(true);
  expect(body?.classList.contains("[&_img[data-custom-emoji]]:h-[1.45em]")).toBe(true);
});

it("uses the original Inbox row layout, dated timestamp and actual same-author continuation boundaries", async () => {
  const follow = {...reply, id:"d".repeat(64), content:"same-author continuation", created_at:3};
  const later = {...reply, id:"e".repeat(64), content:"later thought", created_at:3600};
  state.query.mockResolvedValue({events:[rootEvent,reply,follow,later]});
  await mount();
  const row = (id:string) => host.querySelector<HTMLElement>(`article[data-message-id="${id}"]`)!;
  expect(row(replyId).dataset.testid).toBe("home-inbox-selected-message");
  expect(row(replyId).classList.contains("mx-1")).toBe(true);
  expect(row(replyId).classList.contains("rounded-2xl")).toBe(true);
  expect(row(replyId).parentElement?.className).toBe("relative px-2");
  expect(row(replyId).parentElement?.querySelector('[aria-hidden="true"]')?.classList.contains("inset-x-3")).toBe(true);
  expect(row(rootId).querySelector('[data-testid="message-header"]')).not.toBeNull();
  // The original first context boundary is not collapsed even for one author.
  expect(row(replyId).querySelector('[data-testid="message-header"]')).not.toBeNull();
  expect(row(follow.id).classList.contains("items-center")).toBe(true);
  expect(row(follow.id).querySelector('[data-testid="message-header"]')).toBeNull();
  expect(row(follow.id).querySelector('[data-testid="message-avatar"]')).toBeNull();
  expect(row(later.id).querySelector('[data-testid="message-header"]')).not.toBeNull();
  expect(row(replyId).querySelector('[data-testid="inbox-message-timestamp"]')?.textContent).toContain("1970");
  expect(row(rootId).querySelector('[class*="absolute right-2"]')?.classList.contains("sm:-translate-y-1/2")).toBe(false);
  expect(row(replyId).querySelector('[class*="absolute right-2"]')?.classList.contains("sm:-translate-y-1/2")).toBe(true);
  expect(state.authorProfile).toHaveBeenCalledWith("workspace",replyId);
  // Continuation rows still resolve their own author for reply/video consumers.
  expect(state.authorProfile).toHaveBeenCalledWith("workspace",follow.id);
  expect(state.authorProfile).toHaveBeenCalledTimes(4);
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
  expect(host.querySelector("header")?.textContent).toBe("DM with Original sender");
  expect(host.querySelector("header")?.title).toBe("Open conversation");
  expect(host.querySelector('[data-testid="inbox-composer"]')?.getAttribute("data-placeholder")).toBe("Message Original sender");
  expect(host.querySelector('[data-testid="inbox-composer"]')?.getAttribute("data-draft-key")).toBe("private-binding");
  expect(state.query).not.toHaveBeenCalled();
  expect(state.stream).toHaveBeenCalledWith("workspace","private-binding");
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(state.dmPublish).toHaveBeenCalledWith("private-binding","actual reply",[],"same-intent",undefined,undefined,[]);
  expect(state.publish).not.toHaveBeenCalled();expect(state.outcome).toBe("confirmed");
});

it("passes admitted channel people through the real helper and preserves human recipients on an Inbox reply",async()=>{
  state.mentionPubkeys=[pubkey];
  await mount();
  expect(JSON.parse(host.querySelector('[data-testid="inbox-composer"]')!.getAttribute("data-people")!)).toEqual([{displayName:"Member",pubkey}]);
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(state.publish).toHaveBeenCalledWith("workspace","actual reply",[],"same-intent",[],{messageType:"STREAM",parentEventId:rootId,mentionPubkeys:[pubkey]});
});

it("keeps explicit DM row replies separate from the original default conversation send and locks the target after UNKNOWN",async()=>{
  state.dmQuery.mockImplementation(async(_id,options)=>({events:options.parentEventId?[rootEvent,reply]:[rootEvent,bounds()]}));
  state.dmPublish.mockRejectedValueOnce(new TransportError("receipt missing"));
  await mountDm();
  await act(async()=>host.querySelector<HTMLButtonElement>(`[data-testid="reply-message-${replyId}"]`)!.click());
  expect(host.querySelector('[data-testid="reply-preview"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="inbox-composer"]')?.getAttribute("data-draft-key")).toBe("private-binding");
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(state.dmPublish.mock.lastCall?.[5]).toBe(replyId);
  expect(host.querySelector('[data-testid="cancel-reply"]')).toBeNull();
  expect(host.querySelector(`[data-testid="reply-message-${rootId}"]`)).toBeNull();
  state.dmPublish.mockResolvedValue({eventId:"f".repeat(64),operationId:"actual-publication"});
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(state.dmPublish.mock.calls.every(call=>call[3]==="same-intent"&&call[5]===replyId)).toBe(true);
  expect(state.outcome).toBe("confirmed");
  await settle();
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="cancel-reply"]')!.click());
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(state.dmPublish.mock.lastCall?.[5]).toBeUndefined();
});

it("restores an existing scoped DM reply draft with its exact saved key and target, rather than retargeting it to a new default DM",async()=>{
  state.dmQuery.mockImplementation(async(_id,options)=>({events:options.parentEventId?[rootEvent,reply]:[rootEvent,bounds()]}));
  state.dmPublish.mockResolvedValue({eventId:"f".repeat(64),operationId:"actual-publication"});
  const key=`thread:workspace:${rootId}:${replyId}`;
  await mountDm(replyId,rootId,[],{key,parent:replyId});
  expect(host.querySelector('[data-testid="inbox-composer"]')?.getAttribute("data-draft-key")).toBe(key);
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(state.dmPublish.mock.lastCall?.[5]).toBe(replyId);
});

it("passes admitted DM people and exact human recipients into the existing conversation reply route",async()=>{
  state.mentionPubkeys=[pubkey];
  state.dmQuery.mockImplementation(async (_id,options)=>({events:options.parentEventId?[rootEvent,reply]:[rootEvent,bounds()]}));
  state.dmPublish.mockResolvedValue({eventId:"f".repeat(64),operationId:"dm-publication"});
  await mountDm(replyId,rootId,[{principalId:"peer",displayName:"Peer",pubkeys:[pubkey]}]);
  expect(JSON.parse(host.querySelector('[data-testid="inbox-composer"]')!.getAttribute("data-people")!)).toEqual([{displayName:"Peer",pubkey}]);
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(state.dmPublish).toHaveBeenCalledWith("private-binding","actual reply",[],"same-intent",undefined,undefined,[pubkey]);
});

it("reads older DM windows with the signed descending cursor without moving the selected reply or draft",async()=>{
  const cursor={createdAt:1,eventId:rootId};
  const older={...event("1".repeat(64),"older conversation message",[["h","workspace"]]),created_at:0};
  state.dmQuery.mockImplementation(async (_id,query) => query.parentEventId ? {events:[rootEvent,reply]} : query.beforeId
    ? {events:[older,bounds(null,`1:${rootId}`)]} : {events:[rootEvent,bounds(cursor)],nextCursor:cursor});
  await mountDm();
  await act(async()=>[...host.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent===translate("en","forum.more"))!.click());
  await settle();
  expect(state.dmQuery).toHaveBeenCalledWith("private-binding",{messageType:"STREAM",before:1,beforeId:rootId});
  expect(host.textContent).toContain("older conversation message");
  await mountDm("9".repeat(64),"9".repeat(64));
  expect(host.querySelector('[data-testid="inbox-composer"]')?.getAttribute("data-draft-key")).toBe("private-binding");
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
  expect(host.textContent).toContain(translate("en","platform.loadFailed"));
  expect(host.textContent).not.toContain("selected reply");
  const cursor={createdAt:1,eventId:rootId};
  state.dmQuery.mockImplementation(async (_id,query) => query.parentEventId ? {events:[rootEvent,reply]} : {events:[rootEvent,bounds(cursor,query.beforeId ? `1:${rootId}` : "head")]});
  await act(async()=>[...host.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent===translate("en","platform.refresh"))!.click());
  await settle();
  await act(async()=>[...host.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent===translate("en","forum.more"))!.click());
  await settle();
  expect(host.textContent).toContain(translate("en","platform.loadFailed"));
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

it("applies explicit item selection without remounting, but preserves an UNKNOWN key and parent until confirmation", async () => {
  const nextRoot = event("e".repeat(64), "another thread", [["h", "workspace"]]);
  state.query.mockImplementation(async (_scope, options) => ({events: options.parentEventId === nextRoot.id ? [nextRoot] : [rootEvent, reply]}));
  await mount();
  await act(async () => host.querySelector<HTMLButtonElement>(`[data-testid="reply-message-${replyId}"]`)!.click());
  state.publish.mockRejectedValueOnce(new TransportError("receipt missing"));
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  const draft = host.querySelector('[data-testid="inbox-composer"]')!.getAttribute("data-draft-key");
  await mount(undefined, nextRoot.id, nextRoot.id, true);
  expect(host.querySelector('[data-testid="inbox-composer"]')!.getAttribute("data-draft-key")).toBe(draft);
  expect(host.querySelector('[data-testid="cancel-reply"]')).toBeNull();
  expect(state.query.mock.calls.some(call => call[1].parentEventId === nextRoot.id)).toBe(false);
  state.publish.mockRejectedValueOnce(new BffError(403,"forbidden",{class:ErrorClass.Denied,reason:ReasonCode.PermissionDenied}));
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(state.error).toBeInstanceOf(TransportError);
  expect(host.querySelector('[data-testid="inbox-composer"]')!.getAttribute("data-draft-key")).toBe(draft);
  state.publish.mockResolvedValueOnce({eventId:"d".repeat(64),operationId:"operation"});
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  await settle();
  expect(state.publish.mock.calls.every(call => call[3] === "same-intent" && call[5].parentEventId === replyId)).toBe(true);
  expect(host.textContent).toContain("another thread");
  expect(host.textContent).not.toContain("selected reply");
  expect(host.querySelector('[data-testid="inbox-composer"]')!.getAttribute("data-draft-key")).toBe(`thread:workspace:${nextRoot.id}`);
  await mount(undefined, replyId, rootId, true);
  expect(host.textContent).toContain("selected reply");
  expect(host.textContent).not.toContain("another thread");
});

it.each([
  ["channel", "confirmed"], ["channel", "unknown"],
  ["conversation", "confirmed"], ["conversation", "unknown"],
] as const)("does not let a retired %s reply's late %s result clear or replace the current publication owner", async (scope, outcome) => {
  const pending = vi.fn();
  let finishOld!: (receipt: {eventId: string; operationId: string}) => void;
  let rejectOld!: (error: Error) => void;
  let finishCurrent!: (receipt: {eventId: string; operationId: string}) => void;
  const publisher = scope === "channel" ? state.publish : state.dmPublish;
  state.dmQuery.mockImplementation(async (_id, options) => ({events:options.parentEventId ? [rootEvent,reply] : [rootEvent,bounds()]}));
  publisher.mockReset().mockImplementationOnce(() => new Promise((resolve, reject) => { finishOld = resolve; rejectOld = reject; }))
    .mockImplementationOnce(() => new Promise(resolve => { finishCurrent = resolve; }));
  const render = async (owner: string) => {
    await act(async () => root.render(<QueryClientProvider client={query}><TooltipProvider>
      <InboxThreadPane key={owner} principalId="human" workspaceId="workspace" rootId={rootId} selectedEventId={replyId}
        conversation={scope === "conversation" ? conversation : undefined} channelName="Admitted channel"
        members={[{principalId:"human",displayName:"Member",pubkeys:[pubkey],state:WorkspaceMembershipState.Active}]}
        onPublicationPendingChange={pending} />
    </TooltipProvider></QueryClientProvider>));
    await settle();
  };
  const send = () => host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click();
  await render("retired");
  await act(async () => send());
  await render("current");
  await act(async () => send());
  expect(pending.mock.calls).toEqual([[true], [true]]);
  const reads = (scope === "channel" ? state.query : state.dmQuery).mock.calls.length;
  await act(async () => {
    if (outcome === "confirmed") finishOld({eventId:"d".repeat(64),operationId:"old-operation"});
    else rejectOld(new TransportError("old receipt missing"));
  });
  await settle();
  expect(pending.mock.calls).toEqual([[true], [true]]);
  expect((scope === "channel" ? state.query : state.dmQuery).mock.calls.length).toBe(reads);
  await act(async () => finishCurrent({eventId:"e".repeat(64),operationId:"current-operation"}));
  await settle();
  expect(pending.mock.calls).toEqual([[true], [true], [false]]);
  expect(publisher).toHaveBeenCalledTimes(2);
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

it("reads Inbox DM avatars only through the admitted conversation and rejects the entire batch on a mismatched identity",async()=>{
  const avatarUrl="https://community.example/media/dm-author.png",mediaPath="/api/v1/conversations/private-binding/media/author";
  state.dmQuery.mockImplementation(async(_id,options)=>({events:options.parentEventId?[rootEvent,reply]:[rootEvent,bounds()]}));
  state.dmAuthorProfile.mockImplementation(async(_id,eventId)=>({pubkey:eventId===replyId?"f".repeat(64):pubkey,eventId:"profile",displayName:"Peer",about:null,avatarUrl,nip05Handle:null,avatarMediaPaths:{[avatarUrl]:mediaPath}}));
  await mountDm();
  expect(state.dmAuthorProfile).toHaveBeenCalledWith("private-binding",rootId);
  expect(state.dmAuthorProfile).toHaveBeenCalledWith("private-binding",replyId);
  expect(state.authorProfile).not.toHaveBeenCalled();
  const row=(id:string)=>host.querySelector(`[data-message-id="${id}"]`)!;
  expect(row(rootId).querySelector("img")).toBeNull();
  expect(row(replyId).querySelector("img")).toBeNull();
  expect(host.querySelector('[aria-label="Profile"]')).toBeNull();
  expect(state.dmPublish).not.toHaveBeenCalled();expect(state.publish).not.toHaveBeenCalled();
  await act(async()=>state.receive!({type:"closed",reason:"binding-not-active"}));await settle();
  expect(host.querySelector("img")).toBeNull();expect(host.textContent).not.toContain("selected reply");
});

it.each(["channel", "conversation"] as const)("copies original Inbox %s root/reply links without publishing or refreshing", async scope => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", Object.create(navigator, {clipboard:{value:{writeText}}}));
  const success = vi.spyOn(toast, "success");
  state.dmQuery.mockImplementation(async (_id, options) => ({events:options.parentEventId ? [rootEvent, reply] : [rootEvent, reply, bounds()]}));
  await act(async () => root.render(<QueryClientProvider client={query}><TooltipProvider><InboxThreadPane
    principalId="human" workspaceId="workspace" channelId={scope === "channel" ? "workspace" : "not-the-dm-channel"}
    conversation={scope === "conversation" ? conversation : undefined}
    rootId={rootId} selectedEventId={replyId} channelName="Admitted channel" members={[]} />
  </TooltipProvider></QueryClientProvider>));
  await settle();
  const reads = state.query.mock.calls.length + state.dmQuery.mock.calls.length;
  for (const id of [rootId, replyId]) {
    const button = host.querySelector<HTMLButtonElement>(`[data-testid="copy-link-message-${id}"]`);
    expect(button?.getAttribute("aria-label")).toBe(translate("en", "buzz.copyLink"));
    await act(async () => button!.click());
  }
  expect(writeText.mock.calls).toEqual([
    [`buzz://message?channel=workspace&id=${rootId}`],
    [`buzz://message?channel=workspace&id=${replyId}&thread=${rootId}`],
  ]);
  await act(async () => setLocale("zh-CN"));
  expect(host.querySelector(`[data-testid="copy-link-message-${replyId}"]`)?.getAttribute("aria-label"))
    .toBe(translate("zh-CN", "buzz.copyLink"));
  expect(success).toHaveBeenCalledTimes(2);
  expect(state.query.mock.calls.length + state.dmQuery.mock.calls.length).toBe(reads);
  expect(state.publish).not.toHaveBeenCalled(); expect(state.dmPublish).not.toHaveBeenCalled();
  expect(state.delete).not.toHaveBeenCalled(); expect(state.reaction).not.toHaveBeenCalled();
  await act(async () => state.receive!({type:"interrupted"})); await settle();
  expect(host.querySelector(`[data-testid="copy-link-message-${replyId}"]`)).toBeNull();
  expect(writeText).toHaveBeenCalledTimes(2);
  success.mockRestore();
});

it("does not substitute the Inbox Workspace ID for a missing native channel", async () => {
  await mount(); await openMessageMenu(replyId);
  expect(host.querySelector(`[data-testid="copy-link-message-${replyId}"]`)).toBeNull();
  expect(document.querySelector(`[data-testid="copy-message-link-${replyId}"]`)).toBeNull();
});

it("uses the original HTTP clipboard fallback and keeps a refused copy separate from UNKNOWN publication", async () => {
  const success = vi.spyOn(toast, "success"), error = vi.spyOn(toast, "error");
  const descriptor = Object.getOwnPropertyDescriptor(document, "execCommand");
  const copied: string[] = [];
  const exec = vi.fn(() => {copied.push((document.activeElement as HTMLTextAreaElement).value); return true;});
  Object.defineProperty(document, "execCommand", {configurable:true, value:exec});
  vi.stubGlobal("navigator", Object.create(navigator, {clipboard:{value:undefined}}));
  const pending = vi.fn();
  try {
    await act(async () => root.render(<QueryClientProvider client={query}><TooltipProvider><InboxThreadPane
      principalId="human" workspaceId="workspace" channelId="workspace" rootId={rootId} selectedEventId={replyId}
      channelName="Admitted channel" members={[{principalId:"human", displayName:"Member", pubkeys:[pubkey], state:WorkspaceMembershipState.Active}]}
      onPublicationPendingChange={pending} /> </TooltipProvider></QueryClientProvider>));
    await settle();
    state.publish.mockRejectedValue(new TransportError("unknown"));
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
    await settle();
    expect(pending.mock.calls).toEqual([[true], [true]]);
    await openMessageMenu(replyId);
    await act(async () => document.querySelector<HTMLElement>(`[data-testid="copy-message-link-${replyId}"]`)!.click());
    expect(copied).toEqual([`buzz://message?channel=workspace&id=${replyId}&thread=${rootId}`]);
    expect(success).toHaveBeenCalledWith(translate("en", "buzz.copiedLink"));
    success.mockClear();
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", Object.create(navigator, {clipboard:{value:{writeText}}}));
    await act(async () => host.querySelector<HTMLButtonElement>(`[data-testid="copy-link-message-${replyId}"]`)!.click());
    expect(writeText).toHaveBeenCalledTimes(1); expect(exec).toHaveBeenCalledTimes(1);
    expect(success).not.toHaveBeenCalled(); expect(error).toHaveBeenCalledWith(translate("en", "buzz.copyFailed"));
    expect(pending.mock.calls).toEqual([[true], [true]]); expect(state.publish).toHaveBeenCalledTimes(1);
    await act(async () => state.receive!({type:"closed", reason:"scope-revoked"})); await settle();
    expect(host.querySelector(`[data-testid="copy-link-message-${replyId}"]`)).toBeNull();
    expect(pending.mock.calls).toEqual([[true], [true]]);
  } finally {
    if (descriptor) Object.defineProperty(document, "execCommand", descriptor); else Reflect.deleteProperty(document, "execCommand");
    success.mockRestore(); error.mockRestore();
  }
});

it("restores the original Inbox detail ChannelMembersBar for a DM context, with dialogs mounted only on open",async()=>{
  await mountDm();
  // Buzz InboxDetailPane L668-681: the members bar sits in the detail header.
  expect(host.querySelector('[data-testid="channel-members-trigger"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="channel-management-trigger"]')).not.toBeNull();
  // Neither the members dialog nor the management sheet is mounted (no reads) until opened.
  expect(document.querySelector('[data-testid="channel-management-actions"]')).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

function storedDmDraft(scope:string, text=scope):DraftState {
  return {channelId:scope,content:text,createdAt:"2026-10-27T00:00:00Z",updatedAt:"2026-10-27T00:00:00Z",selectionStart:text.length,selectionEnd:text.length,pendingImeta:[],spoileredAttachmentUrls:[],status:"active"};
}
it("persists a new Inbox DM draft through the real shared editor under the full-conversation key",async()=>{
  state.realComposer=true;
  state.dmQuery.mockImplementation(async(_id,options)=>({events:options.parentEventId?[rootEvent,reply]:[rootEvent,bounds()]}));
  state.dmPublish.mockResolvedValue({eventId:"f".repeat(64),operationId:"actual-publication"});
  await mountDm();
  const input=host.querySelector<HTMLElement>('[data-testid="message-input"]')! as HTMLElement & {editor:import("@tiptap/core").Editor};
  expect(input).not.toBeNull();
  await act(async()=>{input.editor.commands.setContent("<p>saved from the Inbox DM</p>",{emitUpdate:true});});await settle();
  const saved=loadDraftEntry(conversation.id)!;
  expect(saved?.content).toBe("saved from the Inbox DM");
  expect(saved.channelId).toBe(conversation.id);
  expect(draftMessageTarget({key:conversation.id,draft:saved})).toEqual({messageType:"STREAM"});
  expect(loadDraftEntry(conversation.channelId)).toBeUndefined();
  await act(async()=>root.render(null));await settle();await mountDm();
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toContain(saved.content);
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="send-message"]')!.click());await settle();
  expect(state.dmPublish).toHaveBeenCalledTimes(1);
  expect(state.dmPublish.mock.lastCall?.slice(0,2)).toEqual([conversation.id,saved.content]);
  expect(state.publish).not.toHaveBeenCalled();
});

it.each(["draft", "pending", "both", "late"] as const)("preserves the original native DM owner without migrating conflicting recovery (%s)",async scenario=>{
  initDraftStore("human",window.location.origin);
  const native=storedDmDraft(conversation.channelId,"legacy untouched");
  const canonical={...storedDmDraft(conversation.id,"binding untouched"),sendIntent:{key:"binding-unknown",signature:"binding-body"}};
  saveDraftEntry(conversation.id,canonical);
  savePendingSend(conversation.id,{draft:canonical,stage:"unknown",missingFileNames:[]});
  if(scenario==="draft" || scenario==="both")saveDraftEntry(conversation.channelId,native);
  if(scenario==="pending" || scenario==="both")savePendingSend(conversation.channelId,{draft:{...native,sendIntent:{key:"native-unknown",signature:"native-body"}},stage:"unknown",missingFileNames:["local.png"]});
  const bindingBefore=loadPendingSend(conversation.id);
  const nativeBefore=loadPendingSend(conversation.channelId);
  state.dmQuery.mockImplementation(async(_id,options)=>({events:options.parentEventId?[rootEvent,reply]:[rootEvent,bounds()]}));
  await mountDm();
  expect(host.querySelector('[data-testid="inbox-composer"]')?.getAttribute("data-draft-key")).toBe(scenario==="late"?conversation.id:conversation.channelId);
  if(scenario==="late") {
    await act(async()=>savePendingSend(conversation.channelId,{draft:native,stage:"publishing",missingFileNames:[]}));await settle();
    expect(host.querySelector('[data-testid="inbox-composer"]')?.getAttribute("data-draft-key")).toBe(conversation.id);
    expect(host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')?.disabled).toBe(true);
    await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  } else expect(loadPendingSend(conversation.channelId)).toEqual(nativeBefore);
  expect(loadPendingSend(conversation.id)).toEqual(bindingBefore);
  expect(loadDraftEntry(conversation.id)).toEqual(canonical);
  expect(state.dmPublish).not.toHaveBeenCalled();expect(state.publish).not.toHaveBeenCalled();
});
