// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ItemState, WebMessageType, type ConversationView } from "@client-kit/contracts";
import { PlatformProvider } from "@client-kit/platform/react/context";
import type { BffClient } from "@client-kit/platform/client";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { draftMessageTarget, useInboxDrafts, InboxDrafts } from "./InboxDrafts";
import { initDraftStore, saveDraftEntry, loadDraftEntry, type DraftState } from "@client-kit/platform/react/composer/features/messages/lib/useDrafts";

vi.mock("./ChannelPane", () => ({ChannelPane: () => null}));
vi.mock("./ForumPane", () => ({ForumPane: () => null}));
const views = vi.hoisted(()=>({items:[] as ConversationView[], error:false, loading:false, hidden:new Set<string>(), thread:vi.fn()}));
vi.mock("@client-kit/platform/react/new-message", async importOriginal => ({...await importOriginal<typeof import("@client-kit/platform/react/new-message")>(),
  useConversations:()=>views, useConversationVisibilityHost:()=>({read:async()=>views.hidden})}));
vi.mock("./InboxThreadPane", () => ({InboxThreadPane: (props: unknown) => {views.thread(props);return <output data-testid="actual-draft-thread-target">thread restored</output>;}}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
const draft: DraftState = {content: "private draft", channelId: "scope", selectionStart: 0, selectionEnd: 0,
  createdAt: "2026-10-06T10:00:00Z", updatedAt: "2026-10-06T10:00:00Z", pendingImeta: [], spoileredAttachmentUrls: [], status: "active"};
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

it.each([false,true])("restores the existing admitted DM reply draft to its native channel (explicit reply=%s)", async explicit => {
  const nativeChannel="native-dm", binding="conversation-binding", parent="a".repeat(64), reply="b".repeat(64);
  const entry={key:`thread:${nativeChannel}:${parent}${explicit ? `:${reply}` : ""}`,draft:{...draft,channelId:nativeChannel}};
  const conversation:ConversationView={id:binding,channelId:nativeChannel,participantPrincipalIds:["alice","peer"],state:ItemState.Active,operationId:"operation",version:1};
  views.items=[conversation];views.error=false;views.loading=false;views.hidden=new Set();views.thread.mockClear();
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const client={workspaceChannel:vi.fn()} as unknown as BffClient;
  const render=()=>act(async()=>root.render(<PlatformProvider client={client} locale="en"><QueryClientProvider client={cache}><TooltipProvider>
    <InboxDrafts principalId="alice" workspaces={[]} members={new Map()} participants={[{principalId:"alice",displayName:"Alice",pubkeys:["c".repeat(64)]},{principalId:"peer",displayName:"Actual peer",pubkeys:["d".repeat(64)]},{principalId:"foreign",displayName:"Unrelated",pubkeys:["e".repeat(64)]}]}
      entries={[entry]} selectedKey={entry.key} onSelect={vi.fn()} onDelete={vi.fn()} showList={false} showDetail header={null}/>
  </TooltipProvider></QueryClientProvider></PlatformProvider>));
  try {
    await render();
    expect(host.textContent).toContain("Actual peer");
    const edit=host.querySelector<HTMLButtonElement>('button[aria-label="Open draft"]');expect(edit).not.toBeNull();
    await act(async()=>edit!.click());
    await vi.waitFor(()=>expect(views.thread).toHaveBeenCalled());
    expect(views.thread.mock.lastCall?.[0]).toMatchObject({workspaceId:nativeChannel,conversation,rootId:parent,selectedEventId:explicit?reply:parent,replyTargetEventId:explicit?reply:undefined,
      members:[{principalId:"alice"},{principalId:"peer"}]});
    expect(client.workspaceChannel).not.toHaveBeenCalled();
    views.items=[];await render();
    expect(host.querySelector('[data-testid="actual-draft-thread-target"]')).toBeNull();
    expect(host.textContent).toContain("Destination unavailable");
  } finally {cache.clear();views.items=[];views.thread.mockClear();}
});

it("does not open a hidden DM draft or confuse a native channel draft with another binding ID", async()=>{
  const channel="native-dm", parent="a".repeat(64), entry={key:`thread:${channel}:${parent}`,draft:{...draft,channelId:channel}};
  views.items=[{id:channel,channelId:"other-native",participantPrincipalIds:["alice","peer"],state:ItemState.Active,operationId:"op",version:1}];
  views.error=false;views.loading=false;views.hidden=new Set([channel]);views.thread.mockClear();
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const render=()=>act(async()=>root.render(<PlatformProvider client={{} as BffClient} locale="en"><QueryClientProvider client={cache}><TooltipProvider>
    <InboxDrafts principalId="alice" workspaces={[]} members={new Map()} participants={[]} entries={[entry]} selectedKey={entry.key} onSelect={vi.fn()} onDelete={vi.fn()} showList={false} showDetail header={null}/>
  </TooltipProvider></QueryClientProvider></PlatformProvider>));
  try {
    await render();expect(host.querySelector<HTMLButtonElement>('button[aria-label="Open draft"]')?.disabled).toBe(true);
    views.items=[{...views.items[0]!,id:"correct-binding",channelId:channel}];await render();
    await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Open draft"]')!.click());
    await vi.waitFor(()=>expect(host.textContent).toContain("Destination unavailable"));
    expect(views.thread).not.toHaveBeenCalled();
  } finally {cache.clear();views.items=[];views.hidden=new Set();}
});
