// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ItemState, WorkspaceMembershipState, type ConversationView } from "@client-kit/contracts";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { setLocale } from "@client-kit/platform/i18n";
import { ComposerReplyBanner } from "@client-kit/platform/react/messages";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { frameData, frameSteps, MotionGlobalConfig } from "motion/react";
import type { StreamFrame } from "../bff-client";
import { ChannelThreadPane } from "./ChannelThreadPane";
import { useWorkspaceThread } from "./useWorkspaceThread";
import { FocusThreadDrawer } from "@client-kit/platform/react/thread/FocusThreadDrawer";
import { getThreadViewMode, setThreadViewMode, useThreadViewMode } from "@client-kit/platform/react/thread/threadViewModePreference";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({typing:vi.fn(),composer:vi.fn(),richContent:false,query: vi.fn(), conversationQuery:vi.fn(), conversationPublish:vi.fn(), conversationProfile:vi.fn(), publish: vi.fn(), reaction:vi.fn(), profile: vi.fn(), openAuthor: vi.fn(), receive: null as null | ((frame: StreamFrame) => void), outcome: ""}));
vi.mock("@client-kit/platform/react/context", async (original) => ({
  ...await original<typeof import("@client-kit/platform/react/context")>(),
  useBffClient: () => ({workspaceMessages: state.query,conversationMessages:state.conversationQuery}), useLocale: () => "en", useT: () => (key: string) => key,
}));
vi.mock("@/features/chat/ui/MessageContent", async (original) => {
  const actual=await original<typeof import("@/features/chat/ui/MessageContent")>();
  return {MessageContent:(props:import("react").ComponentProps<typeof actual.MessageContent>)=>state.richContent?<actual.MessageContent {...props}/>:<p>{props.content}</p>};
});
vi.mock("@/platform/bff-client", async(original) => ({
  ...await original<typeof import("@/platform/bff-client")>(),
  bff: {profile:async()=>({pubkey:"c".repeat(64)}),customEmoji:async()=>({events:[],mediaPaths:{}}),messageAuthorProfile: (...args: unknown[]) => state.profile(...args),conversationMessageAuthorProfile:(...args:unknown[])=>state.conversationProfile(...args),
    messageAuthorProfiles:async(scope:string,{eventIds}:{eventIds:string[]})=>({profiles:Object.fromEntries(await Promise.all(eventIds.map(async id=>[id,await state.profile(scope,id)])))}),
    conversationMessageAuthorProfiles:async(scope:string,{eventIds}:{eventIds:string[]})=>({profiles:Object.fromEntries(await Promise.all(eventIds.map(async id=>[id,await state.conversationProfile(scope,id)])))}),
  },
  publishMessageReaction:(...args:unknown[])=>state.reaction(...args),
  publishMessage: (...args: unknown[]) => state.publish(...args),
  publishConversationMessage: (...args: unknown[]) => state.conversationPublish(...args),
  publishTyping: (...args: unknown[]) => state.typing(...args),
  openStream: (_scope: string, receive: (frame: StreamFrame) => void) => {state.receive = receive; return () => {};},
}));
vi.mock("./ChannelPane", async(original) => ({...await original<typeof import("./ChannelPane")>(),Composer: (props: import("react").ComponentProps<typeof import("./ChannelPane").Composer>) => {
  state.composer(props); const {disabled,onPublish,replyTarget}=props;
  return <><ComposerReplyBanner replyTarget={replyTarget}/><button data-testid="host-send" disabled={disabled} onClick={async () => {try {await onPublish!("reply", [], "original-intent", []); state.outcome = "confirmed";} catch {state.outcome = "unknown";}}}>send</button></>; }}));
const rootId = "a".repeat(64); const replyId = "b".repeat(64); const author = "c".repeat(64);
const event = (id: string, content: string, tags: string[][], created_at: number) => ({id, pubkey: author, content, tags: [["h", "workspace"], ...tags], created_at, kind: 9});
const rootEvent = event(rootId, "Root body", [], 1);
const reply = event(replyId, "Nested body", [["e", rootId, "", "root"], ["e", rootId, "", "reply"]], 2);
const selected = {id: replyId, createdAt: 2, pubkey: author, author: "Alice", body: "Nested body", tags: reply.tags, depth: 0, time: ""};
let host: HTMLDivElement; let root: Root; let query: QueryClient;
async function settle() {for (let i = 0; i < 30; i++) await act(async () => {
  await vi.advanceTimersByTimeAsync(10);
  frameData.delta=10; frameData.timestamp+=10; frameData.isProcessing=true;
  try { for(const step of Object.values(frameSteps)) step.process(frameData); }
  finally { frameData.isProcessing=false; }
});}
function LayoutThread({layoutEnabled, ...props}: import("react").ComponentProps<typeof ChannelThreadPane> & {layoutEnabled?:boolean}) {
  const mode = useThreadViewMode();
  const pane = <ChannelThreadPane {...props} useSplitAuxiliaryPane={layoutEnabled}
    isFocusMode={Boolean(layoutEnabled && mode === "focus")} />;
  return layoutEnabled ? <FocusThreadDrawer active={mode === "focus"} onClose={props.onClose}>{pane}</FocusThreadDrawer> : pane;
}
async function mount(routeTargetMessageId?:string, conversation?:ConversationView, search?:{searchMessageId:string;searchQuery:string}, typingEntries: import("react").ComponentProps<typeof ChannelThreadPane>["typingEntries"] = [], layoutEnabled = false, restoreDraftKey?:string) {
  await act(async () => root.render(<QueryClientProvider client={query}><TooltipProvider>
    <LayoutThread workspaceId="workspace" principalId="human" selected={selected} layoutEnabled={layoutEnabled}
      conversation={conversation} channelId={conversation?.channelId}
      routeTargetMessageId={routeTargetMessageId} restoreDraftKey={restoreDraftKey} autoSendDraftKey={restoreDraftKey}
      {...search}
      typingEntries={typingEntries}
      profiles={{["d".repeat(64)]:{displayName:"Peer",avatarUrl:null,nip05Handle:null,ownerPubkey:null}}}
      members={[{principalId: "human", displayName: "Alice", pubkeys: [author], state: WorkspaceMembershipState.Active}]}
      disabled={false} onClose={vi.fn()} onCopyMessage={vi.fn()} onOpenAuthor={state.openAuthor} />
  </TooltipProvider></QueryClientProvider>));
  await settle();
}
beforeEach(() => {
  MotionGlobalConfig.useManualTiming=true;
  vi.useFakeTimers(); vi.clearAllMocks(); localStorage.clear(); setLocale("en"); state.outcome = "";state.receive=null;
  setThreadViewMode("split");
  state.richContent=false;
  vi.stubGlobal("Image",function(){
    const image=document.createElement("img");let source="";
    Object.defineProperties(image,{complete:{value:true},naturalWidth:{value:1},src:{get:()=>source,set:(value:string)=>{
      source=value;queueMicrotask(()=>image.dispatchEvent(new Event("load")));
    }}});return image;
  });
  Object.defineProperty(window, "matchMedia", {configurable: true, value: () => ({matches: false, addEventListener() {}, removeEventListener() {}})});
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {configurable: true, value: vi.fn()});
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {configurable: true, value: vi.fn()});
  state.query.mockResolvedValue({events: [rootEvent, reply]});
  state.conversationQuery.mockResolvedValue({events:[rootEvent,reply]});
  state.conversationPublish.mockResolvedValue({eventId:"d".repeat(64),operationId:"operation"});
  state.publish.mockResolvedValue({eventId: "d".repeat(64), operationId: "operation"});
  state.reaction.mockResolvedValue({eventId:"d".repeat(64),operationId:"operation"});
  state.profile.mockResolvedValue({pubkey:author,eventId:"profile",displayName:"Verified author",about:null,avatarUrl:null,nip05Handle:null,avatarMediaPaths:{}});
  state.conversationProfile.mockImplementation((...args:unknown[])=>state.profile(...args));
  query = new QueryClient({defaultOptions: {queries: {retry: false}}});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {await act(async () => root.unmount()); query.clear(); host.remove(); MotionGlobalConfig.useManualTiming=false; vi.useRealTimers();vi.unstubAllGlobals();});
it("restores the exact admitted native DM root/reply key without changing the transport scope", async () => {
  const nativeChannel="native-dm";
  const conversation:ConversationView={id:"conversation-binding",channelId:nativeChannel,state:ItemState.Active,participantPrincipalIds:["human","peer"],operationId:"operation",version:1};
  state.conversationQuery.mockResolvedValue({events:[rootEvent,reply].map(event=>({...event,tags:event.tags.map(tag=>tag[0]==="h"?["h",nativeChannel]:tag)}))});
  const key=`thread:${nativeChannel}:${rootId}:${replyId}`;
  await mount(replyId,conversation,undefined,[],false,key);
  expect(state.composer.mock.lastCall?.[0]).toMatchObject({draftKey:key,draftChannelId:nativeChannel,autoSendDraftKey:key,disabled:false,replyTarget:{id:replyId}});
  expect(state.composer.mock.lastCall?.[0].workspaceId).toBeUndefined();
  expect(state.conversationQuery).toHaveBeenCalledWith(conversation.id,{messageType:"STREAM",parentEventId:rootId});
  expect(state.query).not.toHaveBeenCalled();
  await mount(replyId,conversation,undefined,[],false,`thread:foreign:${rootId}:${replyId}`);
  expect(state.composer.mock.lastCall?.[0].draftKey).not.toContain("foreign");
  expect(state.publish).not.toHaveBeenCalled(); expect(state.conversationPublish).not.toHaveBeenCalled();
  // A different admitted native channel must not reuse this binding's warm rows.
  await mount(replyId,{...conversation,channelId:"different-native-dm"},undefined,[],false,key);
  expect(host.querySelector('[data-testid="host-send"]')).toBeNull();
  expect(host.textContent).not.toContain("Nested body");
});

it.each(["channel", "conversation"] as const)("switches the real %s thread between the original split pane and focus drawer without publishing", async(scope) => {
  const conversation:ConversationView|undefined=scope==="conversation"?{id:"conversation",channelId:"workspace",state:ItemState.Active,participantPrincipalIds:["human","peer"],operationId:"operation",version:1}:undefined;
  await mount(undefined, conversation, undefined, [], true);
  expect(host.querySelector('[data-testid="right-auxiliary-pane-resize-handle"]')).not.toBeNull();
  let toggle = host.querySelector<HTMLButtonElement>('[data-testid="thread-view-mode-toggle"]')!;
  expect(toggle.getAttribute("aria-label")).toBe("Expand thread");
  await act(async () => toggle.click()); await settle();
  expect(getThreadViewMode()).toBe("focus");
  expect(host.querySelector('[data-testid="focus-thread-drawer"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="right-auxiliary-pane-resize-handle"]')).toBeNull();
  toggle = host.querySelector<HTMLButtonElement>('[data-testid="thread-view-mode-toggle"]')!;
  expect(toggle.getAttribute("aria-label")).toBe("Show thread beside channel");
  expect(document.activeElement).toBe(toggle);
  expect(host.textContent).toContain("Root body");
  expect(host.textContent).toContain("Nested body");
  await act(async () => toggle.dispatchEvent(new MouseEvent("click", {bubbles:true,detail:1}))); await settle();
  expect(getThreadViewMode()).toBe("split");
  expect(host.querySelector('[data-testid="focus-thread-drawer"]')).toBeNull();
  expect(host.querySelector('[data-testid="right-auxiliary-pane-resize-handle"]')).not.toBeNull();
  expect(document.activeElement).toBe(host.querySelector('[data-testid="message-thread-body"]'));
  expect(state.publish).not.toHaveBeenCalled();
  expect(state.conversationPublish).not.toHaveBeenCalled();
});
it("does not offer the original two-column switch in the single-panel host", async () => {
  await mount();
  expect(host.querySelector('[data-testid="thread-view-mode-toggle"]')).toBeNull();
});
it.each(["channel","conversation"] as const)("resolves the %s message author before the original thread reply banner and clears it on interruption",async(scope)=>{
  const conversation:ConversationView|undefined=scope==="conversation"?{id:"conversation",channelId:"workspace",state:ItemState.Active,participantPrincipalIds:["human","peer"],operationId:"operation",version:1}:undefined;
  await mount(undefined,conversation);
  expect(host.querySelector('[data-testid="message-author"]')?.textContent).toBe("Verified author");
  expect(host.querySelector('[data-testid="reply-target"]')?.textContent).toContain("Replying to Verified author");
  expect(host.querySelector('[data-testid="reply-target"]')?.textContent).toContain("Nested body");
  await act(async()=>state.receive!({type:"interrupted"}));await settle();
  expect(host.textContent).not.toContain("Verified author");
});

it.each(["channel", "conversation"] as const)("renders only the admitted %s thread typing and clears expired or revoked state", async (scope) => {
  const peer = "d".repeat(64);
  const conversation:ConversationView|undefined=scope==="conversation"?{id:"conversation",channelId:"workspace",state:ItemState.Active,participantPrincipalIds:["human","peer"],operationId:"operation",version:1}:undefined;
  const typing = [{pubkey:peer,threadHeadId:rootId},{pubkey:"e".repeat(64),threadHeadId:null},{pubkey:"f".repeat(64),threadHeadId:replyId}];
  await mount(undefined,conversation,undefined,typing);
  const indicator = () => host.querySelector('[data-testid="message-typing-indicator"]');
  expect(indicator()?.textContent).toContain("Peer is typing");
  expect(indicator()?.querySelectorAll('[data-testid="message-typing-avatar"]')).toHaveLength(1);
  const composer = host.querySelector('[data-testid="host-send"]');
  await mount(undefined,conversation);
  await vi.waitFor(() => expect(indicator()).toBeNull());
  expect(host.querySelector('[data-testid="host-send"]')).toBe(composer);
  await mount(undefined,conversation,undefined,typing);
  expect(indicator()?.textContent).toContain("Peer is typing");
  await act(async()=>state.receive!({type:"closed",reason:"scope-revoked"}));await settle();
  expect(indicator()).toBeNull();
  expect(host.querySelector('[data-testid="host-send"]')).toBeNull();
});
it.each(["channel", "conversation"] as const)("publishes the original thread-head typing from the %s thread composer, throttled", async (scope) => {
  const conversation:ConversationView|undefined=scope==="conversation"?{id:"conversation",channelId:"workspace",state:ItemState.Active,participantPrincipalIds:["human","peer"],operationId:"operation",version:1}:undefined;
  state.typing.mockResolvedValue(undefined);
  await mount(undefined,conversation);
  // The nested reply is selected, but the original reply tag is the thread head (the root).
  const onTyping = state.composer.mock.lastCall?.[0].onTyping as (() => void) | undefined;
  expect(onTyping).toBeTypeOf("function");
  await act(async () => { onTyping!(); await Promise.resolve(); });
  expect(state.typing).toHaveBeenCalledTimes(1);
  expect(state.typing).toHaveBeenLastCalledWith(scope === "conversation" ? {conversationId:"conversation"} : {workspaceId:"workspace"},
    {parentEventId:rootId,rootEventId:null});
  await act(async () => { onTyping!(); await Promise.resolve(); });
  expect(state.typing).toHaveBeenCalledTimes(1);
  expect(state.publish).not.toHaveBeenCalled(); expect(state.conversationPublish).not.toHaveBeenCalled();
});
it.each([{scope:"channel",kind:9},{scope:"conversation",kind:40002}])("highlights only the searchable $kind body in the admitted $scope thread", async ({scope,kind}) => {
  state.richContent=true;
  const events=[rootEvent,reply].map(row=>({...row,kind,content:"needle **needle** `needle`"}));
  state.query.mockResolvedValue({events});state.conversationQuery.mockResolvedValue({events});
  const conversation:ConversationView|undefined=scope==="conversation"?{id:"conversation",channelId:"workspace",state:ItemState.Active,participantPrincipalIds:["human","peer"],operationId:"operation",version:1}:undefined;
  await mount(replyId,conversation,{searchMessageId:replyId,searchQuery:"needle"});
  await vi.waitFor(()=>expect(host.querySelectorAll(`[data-message-id="${replyId}"] [data-search-match="true"]`)).toHaveLength(2));
  expect(host.querySelector(`[data-message-id="${rootId}"] [data-search-match="true"]`)).toBeNull();
  expect(host.querySelector('code [data-search-match="true"]')).toBeNull();
  await mount(replyId,conversation);
  expect(host.querySelector('[data-search-match="true"]')).toBeNull();
});

it("uses the admitted thread query, original panel and exact selected parent when publishing", async () => {
  await mount();
  expect(state.query).toHaveBeenCalledWith("workspace", {messageType: "STREAM", parentEventId: rootId});
  expect(host.querySelector('[data-testid="message-thread-panel"]')).not.toBeNull();
  expect(host.textContent).toContain("Root body"); expect(host.textContent).toContain("Nested body");
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="host-send"]')!.click());
  expect(state.publish).toHaveBeenCalledWith("workspace", "reply", [], "original-intent", [], {messageType: "STREAM", parentEventId: replyId});
  expect(state.outcome).toBe("confirmed");
});
it("opens the original deep-linked reply for reading but leaves the root as the route reply destination",async()=>{
  await mount(replyId);
  expect(host.textContent).toContain("Nested body");
  expect(host.querySelector('[data-testid="message-thread-panel"]')).not.toBeNull();
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="host-send"]')!.click());
  expect(state.publish).toHaveBeenCalledWith("workspace","reply",[],"original-intent",[],{messageType:"STREAM",parentEventId:rootId});
});
it("opens DM deep links in the original reply panel using only the admitted conversation consumers",async()=>{
  const conversation:ConversationView={id:"conversation",channelId:"workspace",state:ItemState.Active,participantPrincipalIds:["human","peer"],operationId:"operation",version:1};
  await mount(replyId,conversation);
  expect(state.conversationQuery).toHaveBeenCalledWith("conversation",{messageType:"STREAM",parentEventId:rootId});
  expect(state.query).not.toHaveBeenCalled();
  expect(host.querySelector('[data-testid="message-thread-panel"]')).not.toBeNull();
  expect(state.conversationProfile).toHaveBeenCalledWith("conversation",rootId);
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="host-send"]')!.click());
  expect(state.conversationPublish).toHaveBeenCalledWith("conversation","reply",[],"original-intent",undefined,rootId,undefined);
  expect(state.publish).not.toHaveBeenCalled();expect(state.outcome).toBe("confirmed");
  await act(async()=>state.receive!({type:"closed",reason:"scope-revoked"}));await settle();
  expect(host.textContent).not.toContain("Root body");
  expect(host.querySelector('[data-testid="host-send"]')).toBeNull();
});
it("refuses DM reply publication after participant removal or disablement and requires a terminal receipt",async()=>{
  const conversation:ConversationView={id:"conversation",channelId:"workspace",state:ItemState.Active,participantPrincipalIds:["human","peer"],operationId:"operation",version:1};
  state.conversationPublish.mockResolvedValue({operationId:"operation"});
  await mount(replyId,conversation);
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="host-send"]')!.click());
  expect(state.outcome).toBe("unknown");
  state.conversationPublish.mockClear();
  await mount(replyId,{...conversation,participantPrincipalIds:["peer"]});
  expect(host.querySelector<HTMLButtonElement>('[data-testid="host-send"]')?.disabled).toBe(true);
  await mount(replyId,{...conversation,state:ItemState.Disabled});
  expect(host.querySelector<HTMLButtonElement>('[data-testid="host-send"]')?.disabled).toBe(true);
  expect(state.conversationPublish).not.toHaveBeenCalled();
});
it("does not request a disabled URL context and starts the existing admitted read only after enablement",async()=>{
  function Context({enabled}:{enabled:boolean}) {
    const result=useWorkspaceThread("human","workspace",rootId,undefined,undefined,enabled);
    return <output>{result.messages.map(message=>message.content).join(" ")}</output>;
  }
  const render=(enabled:boolean)=>act(async()=>root.render(<QueryClientProvider client={query}><Context enabled={enabled}/></QueryClientProvider>));
  await render(false);await settle();expect(state.query).not.toHaveBeenCalled();expect(state.receive).toBeNull();
  await render(true);await settle();expect(state.query).toHaveBeenCalledExactlyOnceWith("workspace",{messageType:"STREAM",parentEventId:rootId});
  expect(host.textContent).toContain("Root body");expect(state.receive).not.toBeNull();
});
it("retains V2 roots and replies in the same admitted original thread projection", async () => {
  state.query.mockResolvedValue({events:[{...rootEvent,kind:40002},{...reply,kind:40002}]});
  await mount();
  expect(host.querySelector('[data-testid="message-thread-panel"]')).not.toBeNull();
  expect(host.textContent).toContain("Root body");expect(host.textContent).toContain("Nested body");
  expect(host.querySelector<HTMLButtonElement>('[data-testid="host-send"]')?.disabled).toBe(false);
});
it("renders thread auxiliary reactions and removes the actual own reaction through the admitted route",async()=>{
  const reactionId="e".repeat(64);
  state.query.mockResolvedValue({events:[rootEvent,reply,{...reply,id:reactionId,kind:7,content:"👍",tags:[["e",replyId]]}]});
  await mount();
  const pill=[...host.querySelectorAll<HTMLButtonElement>('button[aria-label]')].find(button=>button.getAttribute("aria-label")==="Toggle 👍 reaction");
  expect(pill).toBeDefined();
  await act(async()=>pill!.click());await settle();
  expect(state.reaction).toHaveBeenCalledWith("workspace",undefined,{operation:"UNLIKE",content:"",targetEventId:reactionId},expect.any(String));
});
it("requires confirmed receipt and removes thread content on revoked admission", async () => {
  state.publish.mockResolvedValue({operationId: "operation"});
  await mount();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="host-send"]')!.click());
  expect(state.outcome).toBe("unknown");
  await act(async () => state.receive!({type: "closed", reason: "scope-revoked"}));
  await settle();
  expect(host.textContent).not.toContain("Root body");
  expect(host.querySelector('[data-testid="host-send"]')).toBeNull();
});
it("traverses forward cursors and refuses a repeated cursor without offering an empty-success or enabled send", async () => {
  const cursor = {createdAt: 2, eventId: replyId};
  state.query.mockResolvedValue({events: [rootEvent, reply], nextCursor: cursor});
  await mount(); await settle();
  expect(state.query).toHaveBeenCalledTimes(2);
  expect(state.query.mock.calls[1]?.[1]).toMatchObject({before: 2, beforeId: replyId});
  expect(host.querySelector<HTMLButtonElement>('[data-testid="host-send"]')?.disabled).toBe(true);
});
it("keeps opening the actual admitted thread author separate from its restored avatar reads", async () => {
  await mount();
  expect(state.profile).toHaveBeenCalledWith("workspace",rootId);
  // A collapsed avatar does not remove the reply's independent author proof.
  expect(state.profile).toHaveBeenCalledWith("workspace",replyId);
  expect(state.profile).toHaveBeenCalledTimes(2);
  expect(host.querySelectorAll('[data-testid="message-avatar"]')).toHaveLength(1);
  expect(state.openAuthor).not.toHaveBeenCalled();
  const trigger = [...host.querySelectorAll<HTMLElement>('[role="button"][aria-label="Profile"]')].find((node) => node.textContent === "Verified author")!;
  expect(trigger).toBeDefined();
  await act(async () => {trigger.dispatchEvent(new MouseEvent("mouseover", {bubbles:true})); await vi.advanceTimersByTimeAsync(600);});
  await settle();
  expect(state.profile).toHaveBeenCalledWith("workspace", rootId);
  await act(async () => trigger.click());
  expect(state.openAuthor).toHaveBeenCalledWith(expect.objectContaining({id:rootId,pubkey:author}));
  await act(async () => state.receive!({type:"closed",reason:"scope-revoked"}));
  await settle();
  expect(host.querySelector('[aria-label="Profile"]')).toBeNull();
});

it("renders the original thread author avatars through admitted media and removes them on interruption",async()=>{
  const avatarUrl="https://community.example/media/thread-author.png",mediaPath="/api/v1/workspaces/workspace/media/thread-author";
  const peer="e".repeat(64);
  state.query.mockResolvedValue({events:[rootEvent,{...reply,pubkey:peer}]});
  state.profile.mockImplementation(async(_scope,eventId)=>({pubkey:eventId===replyId?peer:author,eventId:"profile",displayName:"Alice",about:null,avatarUrl,nip05Handle:null,avatarMediaPaths:{[avatarUrl]:mediaPath}}));
  await mount();
  const avatars=[...host.querySelectorAll('[data-testid="message-avatar"]')];
  expect(avatars).toHaveLength(2);
  for(const avatar of avatars){
    expect(avatar.classList.contains("h-9")).toBe(true);expect(avatar.classList.contains("w-9")).toBe(true);
    expect(avatar.getAttribute("data-avatar-shape")).toBe("circle");expect(avatar.querySelector("img")?.getAttribute("src")).toBe(mediaPath);
  }
  expect(state.openAuthor).not.toHaveBeenCalled();expect(state.publish).not.toHaveBeenCalled();
  await act(async()=>state.receive!({type:"interrupted"}));await settle();
  expect(host.querySelector("img")).toBeNull();expect(host.querySelector('[aria-label="Profile"]')).toBeNull();
});
