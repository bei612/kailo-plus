// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConversationViewState, WebMessageType, type ConversationView } from "@client-kit/contracts";
import { PlatformProvider } from "@client-kit/platform/react/context";
import type { BffClient } from "@client-kit/platform/client";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { draftMessageTarget, useInboxDrafts, InboxDrafts } from "./InboxDrafts";
import { initDraftStore, saveDraftEntry, loadDraftEntry, type DraftState } from "@client-kit/platform/react/composer/features/messages/lib/useDrafts";

const views = vi.hoisted(()=>({items:[] as ConversationView[], error:false, loading:false, hidden:new Set<string>(), open:vi.fn(), toast:vi.fn()}));
vi.mock("@client-kit/platform/react/new-message", async importOriginal => ({...await importOriginal<typeof import("@client-kit/platform/react/new-message")>(),
  useConversations:()=>views, useConversationVisibilityHost:()=>({read:async()=>views.hidden})}));
vi.mock("sonner", () => ({toast:{error:(message:string)=>views.toast(message)}}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
const draft: DraftState = {content: "private draft", channelId: "scope", selectionStart: 0, selectionEnd: 0,
  createdAt: "2026-10-06T10:00:00Z", updatedAt: "2026-10-06T10:00:00Z", pendingImeta: [], spoileredAttachmentUrls: [], status: "active"};
function anchorEvents(channel: string, rootId: string, anchorId = rootId) {
  const root = {id:rootId,pubkey:"c".repeat(64),created_at:1,kind:9,content:"original root",tags:[["h",channel]]};
  return anchorId === rootId ? [root] : [{...root,id:anchorId,content:"original reply",tags:[["h",channel],["e",rootId,"","root"],["e",rootId,"","reply"]]},root];
}
let root: Root; let host: HTMLDivElement;
beforeEach(() => {localStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);});
afterEach(async () => {await act(async () => root.unmount()); host.remove(); localStorage.clear();});
function Store({identity}: {identity: string}) {const store = useInboxDrafts(identity); return <><output>{store.entries.map((item) => item.draft.content).join("|")}</output><button onClick={() => store.remove("scope")}>delete</button></>;}
it("resolves only existing draft namespaces belonging to the stored destination", () => {
  const parent = "a".repeat(64);
  expect(draftMessageTarget({key: "scope", draft})).toEqual({messageType: WebMessageType.Stream});
  expect(draftMessageTarget({key: `thread:scope:${parent}`, draft})).toEqual({messageType: WebMessageType.Stream, parentEventId: parent});
  const reply = "b".repeat(64);
  expect(draftMessageTarget({key: `thread:scope:${parent}:${reply}`, draft})).toEqual({messageType: WebMessageType.Stream, threadRootId: parent, parentEventId: reply});
  expect(draftMessageTarget({key: `thread:scope:${parent}:invalid`, draft})).toBeNull();
  expect(draftMessageTarget({key: "forum:scope:post", draft})).toEqual({messageType: WebMessageType.ForumPost});
  expect(draftMessageTarget({key: `forum:scope:${parent}`, draft})).toEqual({messageType: WebMessageType.ForumComment, parentEventId: parent});
  expect(draftMessageTarget({key: `thread:other:${parent}`, draft})).toBeNull();
  expect(draftMessageTarget({key: "forum:scope:unknown", draft})).toBeNull();
});
it("uses the existing identity-and-origin draft store and never deletes UNKNOWN intent", async () => {
  initDraftStore("alice", window.location.origin); saveDraftEntry("scope", {...draft, sendIntent: {key: "retained", signature: "original"}});
  await act(async () => root.render(<Store identity="alice" />));
  expect(host.textContent).toContain("private draft");
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(loadDraftEntry("scope")?.sendIntent?.key).toBe("retained");
  await act(async () => root.render(<Store identity="bob" />));
  expect(host.textContent).not.toContain("private draft");
  await act(async () => root.render(<Store identity="alice" />));
  expect(host.textContent).toContain("private draft");
});

it.each([[false, false], [true, false], [false, true], [true, true]])("restores the existing admitted DM reply draft (explicit=%s, binding scope=%s)", async (explicit, bindingScope) => {
  const nativeChannel="native-dm", binding="conversation-binding", parent="a".repeat(64), reply="b".repeat(64);
  const scope = bindingScope ? binding : nativeChannel;
  const entry={key:`thread:${scope}:${parent}${explicit ? `:${reply}` : ""}`,draft:{...draft,channelId:scope}};
  const conversation:ConversationView={id:binding,channelId:nativeChannel,participantPrincipalIds:["alice","peer"],state:ConversationViewState.Active,operationId:"operation",version:1};
  views.items=[conversation];views.error=false;views.loading=false;views.hidden=new Set();views.open.mockClear();
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const client={workspaceChannel:vi.fn(), conversationMessages:vi.fn().mockResolvedValue({events: anchorEvents(nativeChannel, parent, explicit ? reply : parent)})} as unknown as BffClient;
  const render=()=>act(async()=>root.render(<PlatformProvider client={client} locale="en"><QueryClientProvider client={cache}><TooltipProvider>
    <InboxDrafts onOpen={views.open} principalId="alice" workspaces={[]} participants={[{principalId:"alice",displayName:"Alice",pubkeys:["c".repeat(64)]},{principalId:"peer",displayName:"Actual peer",pubkeys:["d".repeat(64)]},{principalId:"foreign",displayName:"Unrelated",pubkeys:["e".repeat(64)]}]}
      entries={[entry]} selectedKey={entry.key} onSelect={vi.fn()} onDelete={vi.fn()} showList={false} showDetail renderList={list => list}/>
  </TooltipProvider></QueryClientProvider></PlatformProvider>));
  try {
    await render();
    expect(host.textContent).toContain("Actual peer");
    const edit=host.querySelector<HTMLButtonElement>('button[aria-label="Open draft"]');expect(edit).not.toBeNull();
    await act(async()=>edit!.click());
    await vi.waitFor(()=>expect(views.open).toHaveBeenCalled());
    expect(views.open.mock.lastCall).toEqual([nativeChannel, {channelId:nativeChannel,conversation,messageId:explicit?reply:parent,threadRootId:parent}, {key:entry.key,send:false,editEventId:undefined,conversation}]);
    expect(client.workspaceChannel).not.toHaveBeenCalled();
    expect(client.conversationMessages).toHaveBeenCalledWith(binding, {anchorEventId:explicit ? reply : parent});
    views.items=[];await render();
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Open draft"]')?.disabled).toBe(true);
    expect(views.open).toHaveBeenCalledTimes(1);
  } finally {cache.clear();views.items=[];views.open.mockClear();}
});

it("does not open a hidden DM draft or confuse a native channel draft with another binding ID", async()=>{
  const channel="native-dm", parent="a".repeat(64), entry={key:`thread:${channel}:${parent}`,draft:{...draft,channelId:channel}};
  views.items=[{id:channel,channelId:"other-native",participantPrincipalIds:["alice","peer"],state:ConversationViewState.Active,operationId:"op",version:1}];
  views.error=false;views.loading=false;views.hidden=new Set([channel]);views.open.mockClear();views.toast.mockClear();
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const read = vi.fn().mockResolvedValue({events: []});
  const client={conversationMessages:read} as unknown as BffClient;
  const render=()=>act(async()=>root.render(<PlatformProvider client={client} locale="en"><QueryClientProvider client={cache}><TooltipProvider>
    <InboxDrafts onOpen={views.open} principalId="alice" workspaces={[]} participants={[]} entries={[entry]} selectedKey={entry.key} onSelect={vi.fn()} onDelete={vi.fn()} showList={false} showDetail renderList={list => list}/>
  </TooltipProvider></QueryClientProvider></PlatformProvider>));
  try {
    await render();
    await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Open draft"]')!.click());
    expect(read).toHaveBeenCalledWith(channel, {anchorEventId:parent});
    expect(views.open).not.toHaveBeenCalled();
    expect(views.toast).toHaveBeenCalledWith("Destination unavailable");
    views.items=[{...views.items[0]!,id:"correct-binding",channelId:channel}];await render();
    await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Open draft"]')!.click());
    await vi.waitFor(()=>expect(views.toast).toHaveBeenCalledWith("Destination unavailable"));
    expect(views.open).not.toHaveBeenCalled();
  } finally {cache.clear();views.items=[];views.hidden=new Set();}
});

it("uses the original confirmation then opens the admitted DM composer with only its saved draft reference", async()=>{
  const entry={key:"conversation-binding",draft:{...draft,channelId:"conversation-binding"}};
  const conversation:ConversationView={id:entry.key,channelId:"native-dm",participantPrincipalIds:["alice","peer"],state:ConversationViewState.Active,operationId:"operation",version:1};
  views.items=[conversation]; views.error=false; views.loading=false; views.hidden=new Set(); views.open.mockClear();
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  try {
    await act(async()=>root.render(<PlatformProvider client={{} as BffClient} locale="en"><QueryClientProvider client={cache}><TooltipProvider>
      <InboxDrafts onOpen={views.open} principalId="alice" workspaces={[]} participants={[]} entries={[entry]} selectedKey={entry.key} onSelect={vi.fn()} onDelete={vi.fn()} showList={false} showDetail renderList={list => list}/>
    </TooltipProvider></QueryClientProvider></PlatformProvider>));
    await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!.click());
    expect(views.open).not.toHaveBeenCalled();
    const dialog=document.querySelector('[role="alertdialog"]')!;
    await act(async()=>[...dialog.querySelectorAll("button")].find(button=>button.textContent==="Send message")!.click());
    await vi.waitFor(()=>expect(views.open).toHaveBeenCalledTimes(1));
    expect(views.open.mock.lastCall).toEqual([conversation.channelId,undefined,{key:entry.key,send:true,editEventId:undefined,conversation}]);
    expect(JSON.stringify(views.open.mock.lastCall)).not.toContain(draft.content);
  } finally {cache.clear();views.items=[];}
});

it.each(["en", "zh-CN"] as const)("keeps the original three-participant DM source preview in the actual Web draft surfaces (%s)", async locale => {
  const entry = {key: "conversation-binding", draft: {...draft, channelId: "conversation-binding"}};
  const people = ["Alice", "First", "Second", "Third", "Fourth", "Fourth"].map((displayName, index) => ({principalId: `person-${index}`, displayName, pubkeys: [(index + 1).toString(16).repeat(64)]}));
  views.items = [{id: entry.draft.channelId, channelId: "native-dm", participantPrincipalIds: people.map(person => person.principalId), state: ConversationViewState.Active, operationId: "operation", version: 1}];
  views.error = false; views.loading = false;
  const cache = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
  try {
    await act(async () => root.render(<PlatformProvider client={{} as BffClient} locale={locale}><QueryClientProvider client={cache}><TooltipProvider>
      <InboxDrafts onOpen={views.open} principalId={people[0]!.principalId} workspaces={[]} participants={people}
        entries={[entry]} selectedKey={entry.key} onSelect={vi.fn()} onDelete={vi.fn()} showList showDetail renderList={list => list} />
    </TooltipProvider></QueryClientProvider></PlatformProvider>));
    const expected = locale === "en" ? "First, Second, Third, +1 more" : "First, Second, Third, +1 人";
    const list = host.querySelector('[data-testid="home-inbox-drafts-list"]')!;
    const detail = host.querySelector('[data-testid="home-inbox-draft-detail"]')!;
    expect(list.querySelector('button[aria-label^="View draft"],button[aria-label^="查看"]')?.getAttribute("aria-label")).toContain(expected);
    expect(detail.querySelector("h2")?.textContent).toBe(expected);
    expect(detail.textContent).not.toContain("Alice");
    expect(detail.textContent).not.toContain("Fourth");
  } finally {cache.clear(); views.items = [];}
});

it.each(["send", "collision", "nonparticipant", "wrong-channel", "wrong-root", "missing", "revoked", "identity", "generation", "unmount"] as const)("keeps DM thread draft restoration inside the admitted original target (%s)", async scenario => {
  const scope="binding", native="native", rootId="a".repeat(64), replyId="b".repeat(64);
  const entry={key:`thread:${scope}:${rootId}:${replyId}`,draft:{...draft,channelId:scope}};
  const conversation:ConversationView={id:scope,channelId:native,participantPrincipalIds:["alice","peer"],state:ConversationViewState.Active,operationId:"op",version:1};
  views.items=[conversation]; views.error=false; views.loading=false; views.hidden=new Set(); views.open.mockClear(); views.toast.mockClear();
  if(scenario==="collision") views.items.push({...conversation,id:"other-binding",channelId:scope});
  if(scenario==="nonparticipant") views.items=[{...conversation,participantPrincipalIds:["bob","peer"]}];
  let release!: (page:{events:ReturnType<typeof anchorEvents>})=>void;
  const read=vi.fn().mockImplementation(async()=>{
    if(scenario==="revoked") throw new Error("Forbidden");
    if(["identity","generation","unmount"].includes(scenario)) return new Promise(resolve=>{release=resolve;});
    return {events:scenario==="missing" ? [] : anchorEvents(scenario==="wrong-channel" ? "foreign" : native,scenario==="wrong-root" ? "d".repeat(64) : rootId,replyId)};
  });
  const client={conversationMessages:read,workspaceChannel:vi.fn()} as unknown as BffClient;
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const render=(principal="alice")=>act(async()=>root.render(<PlatformProvider client={client} locale="en"><QueryClientProvider client={cache}><TooltipProvider>
    <InboxDrafts principalId={principal} workspaces={[]} participants={[]} entries={[entry]} selectedKey={entry.key} onSelect={vi.fn()} onDelete={vi.fn()} showList={false} showDetail renderList={list=>list} onOpen={views.open}/>
  </TooltipProvider></QueryClientProvider></PlatformProvider>));
  try {
    await render();
    const button=host.querySelector<HTMLButtonElement>(`button[aria-label="${scenario==="send" ? "Send message" : "Open draft"}"]`)!;
    if(scenario==="collision" || scenario==="nonparticipant") {
      expect(button.disabled).toBe(true); await act(async()=>button.click()); expect(read).not.toHaveBeenCalled(); return;
    }
    await act(async()=>button.click());
    if(scenario==="send") {
      expect(read).not.toHaveBeenCalled(); expect(views.open).not.toHaveBeenCalled();
      const dialog=document.querySelector('[role="alertdialog"]')!;
      await act(async()=>[...dialog.querySelectorAll("button")].find(item=>item.textContent==="Send message")!.click());
      expect(read).toHaveBeenCalledWith(scope,{anchorEventId:replyId});
      expect(views.open.mock.lastCall).toEqual([native,{channelId:native,messageId:replyId,threadRootId:rootId,conversation},{key:entry.key,send:true,editEventId:undefined,conversation}]);
      expect(JSON.stringify(views.open.mock.lastCall)).not.toContain(draft.content);
    } else {
      if(scenario==="identity") {await render("bob"); await render("alice");}
      if(scenario==="generation") {views.items=[{...conversation,version:2}]; await render();}
      if(scenario==="unmount") await act(async()=>root.render(null));
      if(release) await act(async()=>release({events:anchorEvents(native,rootId,replyId)}));
      expect(views.open).not.toHaveBeenCalled();
      if(!["identity","generation","unmount"].includes(scenario)) expect(views.toast).toHaveBeenCalledWith("Destination unavailable");
      else expect(views.toast).not.toHaveBeenCalled();
    }
    expect(client.workspaceChannel).not.toHaveBeenCalled();
  } finally {cache.clear();views.items=[];}
});
