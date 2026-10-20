import { act, useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PresenceHostProvider } from "../src/react/presence/host";
import type { PresenceHost } from "../src/react/presence/context";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { ConversationList, ConversationVisibilityProvider } from "../src/react/new-message";
import { useInboxState } from "../src/react/use-inbox-state";
import { setLocale } from "../src/i18n";
import { ConversationViewState, WebPresenceStatus, type ConversationView, type ReadMarkRequest } from "@client-kit/contracts";
import { TransportError, type BffRequest } from "../src/transport";
import type { InboxEvent } from "../src/inbox";
import { sortDmChannelsForSidebar } from "../src/react/sidebar/dmSidebarSort";
import type { ConversationUnreadEntry } from "../src/react/sidebar/useSidebarUnreadOverflow";
import { click, render, settle } from "./render";

const items: ConversationView[] = [
  {id:"bob",channelId:"dm-bob",state:ConversationViewState.Active,participantPrincipalIds:["self","bob"],version:1,operationId:"open-bob"},
  {id:"zara",channelId:"dm-zara",state:ConversationViewState.Active,participantPrincipalIds:["self","zara"],version:1,operationId:"open-zara"},
];
const incoming: InboxEvent[] = [
  {id:"one",tags:[],createdAt:10,channelId:"dm-bob",channelType:"dm",category:"activity"},
  {id:"two",tags:[["e","one","","reply"]],createdAt:20,channelId:"dm-bob",channelType:"dm",category:"activity"},
  {id:"three",tags:[],createdAt:30,channelId:"dm-zara",channelType:"dm",category:"activity"},
];
beforeEach(() => {setLocale("en");localStorage.clear();});
async function mount(unknown = false, initial: Record<string,string> = {}, initialEvents: (InboxEvent & {pubkey?: string})[] = incoming) {
  let version = 0; const contexts: Record<string,string> = {...initial};
  const writes: BffRequest[] = []; let opened = 0;
  const hidden = new Set<string>();
  let unread: readonly ConversationUnreadEntry[] = [];
  let replaceConversations!: (next: ConversationView[]) => void;
  let replaceEvents!: (next: (InboxEvent & {pubkey?: string})[]) => void;
  const observeUnread = (entries: readonly ConversationUnreadEntry[]) => { unread = entries; };
  const client = createBffClient({send:async request => {
    if(request.path === "/api/v1/workspaces") return {status:200,body:[]};
    if(request.path === "/api/v1/conversations") return {status:200,body:{items}};
    if(request.path.startsWith("/api/v1/conversation-participants")) return {status:200,body:{maxParticipants:9,items:[
      {principalId:"self",displayName:"Me",pubkeys:["a".repeat(64)]},
      {principalId:"bob",displayName:"Bob",pubkeys:["b".repeat(64)]},
      {principalId:"zara",displayName:"Zara",pubkeys:["c".repeat(64)]},
    ]}};
    if(request.method === "PUT") {
      writes.push(request);
      if(unknown) throw new TransportError("Lost acknowledgement");
      const body=request.body as ReadMarkRequest;
      expect(body.version).toBe(version); contexts[body.contextKey]=body.lastReadAt; version++;
      return {status:200,body:{version}};
    }
    return {status:200,body:{version,workspacePreferences:{},conversationPreferences:{},readContexts:{...contexts}}};
  }});
  const latest=new Map([["dm-bob",new Date(20_000).toISOString()],["dm-zara",new Date(30_000).toISOString()]]);
  function Sidebar(){
    const reads=useInboxState(client);
    const [listed,setListed]=useState(items);
    const [activity,setActivity]=useState(initialEvents);
    replaceEvents=setActivity;
    replaceConversations=setListed;
    const [selected,setSelected]=useState<string|null>(null);
    return <ConversationList currentPrincipalId="self" items={listed} loading={false} error={null}
      selectedId={selected} onSelect={item=>setSelected(item.id)} onNewMessage={()=>{opened++;}} onReload={()=>{}}
      onUnreadChange={observeUnread}
      reads={reads} events={[...activity,...(activity[0]?[activity[0]]:[]),{...incoming[0]!,id:"foreign",channelId:"unadmitted"}]}
      lastMessageAtByChannelId={latest}/>;
  }
  const host=await render(<PlatformProvider client={client} locale="en"><ConversationVisibilityProvider value={{read:async()=>new Set(hidden),prepare:async(conversation,hide)=>async()=>{
    if(hide) hidden.add(conversation.channelId); else hidden.delete(conversation.channelId);
  }}}><Sidebar/></ConversationVisibilityProvider></PlatformProvider>);
  await settle();
  return {host,writes,opened:()=>opened,unread:()=>unread,replaceConversations:(next:ConversationView[])=>replaceConversations(next),
    replaceEvents:(next:(InboxEvent & {pubkey?:string})[])=>replaceEvents(next)};
}
async function openContext(host:HTMLElement){
  const row=host.querySelector('[data-channel-id="dm-bob"]')!.closest("li")!;
  await act(async()=>row.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:1,clientY:1})));
}
function menu(text:string){return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item=>item.textContent===text)!;}

describe("original governed DM sidebar consumers",()=>{
  it("only hands a current other-participant message proof to the avatar host and drops removed evidence",async()=>{
    const bobKey="b".repeat(64), selfKey="a".repeat(64);
    const events=[{...incoming[0]!,pubkey:bobKey},{...incoming[1]!,pubkey:selfKey},incoming[2]!];
    const {unread,replaceEvents,replaceConversations}=await mount(false,{},events);
    expect(unread()[0]?.preview?.author).toEqual({conversationId:"bob",eventId:"one",pubkey:bobKey});
    expect(unread()[1]?.preview?.author).toBeUndefined();
    await act(async()=>replaceEvents(events.slice(1)));
    expect(unread()[0]?.preview?.author).toBeUndefined();
    await act(async()=>replaceEvents([{...incoming[0]!,pubkey:"f".repeat(64)},incoming[2]!]));
    expect(unread()[0]?.preview?.author).toBeUndefined();
    await act(async()=>replaceEvents(events));
    await act(async()=>replaceConversations(items.map(item=>item.id==="bob"?{...item,participantPrincipalIds:["self","bob","zara"]}:item)));
    expect(unread()[0]?.preview).toBeUndefined();
  });
  it("hands the actual admitted row counts and directory names to the original overflow host without an avatar request",async()=>{
    const {host,writes,unread}=await mount();
    expect(unread()).toEqual([
      {channelId:"dm-bob",preview:{channelId:"dm-bob",accessibleLabel:"Bob",label:"Bob",avatarUrl:null}},
      {channelId:"dm-zara",preview:{channelId:"dm-zara",accessibleLabel:"Zara",label:"Zara",avatarUrl:null}},
    ]);
    await openContext(host);await click(menu("Mark as read"));await settle();
    expect(unread().map(entry=>entry.channelId)).toEqual(["dm-zara"]);
    expect(writes).toHaveLength(1);
  });
  it("removes the actual overflow projection when the existing read writer reports UNKNOWN",async()=>{
    const {host,writes,unread}=await mount(true);
    expect(unread()).toHaveLength(2);
    await openContext(host);await click(menu("Mark as read"));await settle();
    expect(unread()).toEqual([]);
    expect(writes).toHaveLength(1);
  });
  it("drops disabled, removed-member and hidden DM rows from overflow without changing Core read state",async()=>{
    const {host,writes,unread,replaceConversations}=await mount();
    await act(async()=>replaceConversations(items.map(item=>item.id==="bob"?{...item,state:ConversationViewState.Disabled}:item)));
    expect(unread().map(entry=>entry.channelId)).toEqual(["dm-zara"]);
    await act(async()=>replaceConversations(items.map(item=>item.id==="bob"?{...item,participantPrincipalIds:["other","bob"]}:item)));
    expect(unread().map(entry=>entry.channelId)).toEqual(["dm-zara"]);
    await click(host.querySelector<HTMLElement>('[data-testid="hide-dm-Zara"]')!);
    await settle();
    expect(unread()).toEqual([]);
    expect(writes).toHaveLength(0);
  });
  it("folds confirmed message markers and explicit unread resets those same Core keys",async()=>{
    const {host,writes}=await mount(false,{"msg:one":new Date(10_000).toISOString(),"msg:two":new Date(20_000).toISOString()});
    expect(host.querySelector('[data-testid="channel-unread-Bob"]')).toBeNull();
    await openContext(host);await click(menu("Mark unread"));await settle();
    expect(writes.some(write=>(write.body as ReadMarkRequest).contextKey==="msg:two")).toBe(true);
    expect(host.querySelector('[data-testid="channel-unread-Bob"]')?.textContent).toMatch(/^2/);
  });
  it("folds the real thread marker without treating an unrelated channel as read",async()=>{
    const {host}=await mount(false,{"thread:one":new Date(20_000).toISOString()});
    expect(host.querySelector('[data-testid="channel-unread-Bob"]')?.textContent).toMatch(/^1/);
    expect(host.querySelector('[data-testid="channel-unread-Zara"]')?.textContent).toMatch(/^1/);
  });
  it("renders real deduplicated incoming unread counts and suppresses the active row badge without marking it read",async()=>{
    const {host,writes}=await mount();
    expect(host.querySelector('[data-testid="channel-unread-Bob"]')?.textContent).toMatch(/^2/);
    expect(host.querySelector('[data-channel-id="dm-bob"]')?.className).toContain("font-bold");
    expect(host.querySelector('[data-testid="channel-unread-dot-Bob"]')).toBeNull();
    await click(host.querySelector<HTMLElement>('[data-channel-id="dm-bob"]')!);
    expect(host.querySelector('[data-testid="channel-unread-Bob"]')).toBeNull();
    expect(writes).toHaveLength(0);
  });
  it("marks the real private channel read/unread through Core CAS, including DM replies",async()=>{
    const {host,writes}=await mount();
    await openContext(host);await click(menu("Mark as read"));await settle();
    expect(writes[0]).toMatchObject({method:"PUT",path:"/api/v1/user-state/read",body:{contextKey:"dm-bob",lastReadAt:new Date(20_000).toISOString(),version:0}});
    expect(host.querySelector('[data-testid="channel-unread-Bob"]')).toBeNull();
    await openContext(host);await click(menu("Mark unread"));await settle();
    expect(writes[1]).toMatchObject({body:{contextKey:"dm-bob",lastReadAt:new Date(9_000).toISOString(),version:1}});
    expect(host.querySelector('[data-testid="channel-unread-Bob"]')?.textContent).toMatch(/^2/);
  });
  it("keeps lost read ACK unknown and refresh never silently resubmits",async()=>{
    const {host,writes}=await mount(true);
    await openContext(host);await click(menu("Mark as read"));await settle();
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="channel-unread-Bob"]')).toBeNull();
    const retry=[...host.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent==="Try again")!;
    await click(retry);await settle();expect(writes).toHaveLength(1);
    await openContext(host);expect(menu("Mark as read")).toBeUndefined();expect(menu("Mark unread")).toBeUndefined();
  });
  it("restores the original persisted DM sort menu and real recent ordering",async()=>{
    const {host}=await mount();
    const ids=()=>[...host.querySelectorAll('[data-channel-id]')].map(row=>row.getAttribute("data-channel-id"));
    expect(ids()).toEqual(["dm-bob","dm-zara"]);
    await act(async()=>host.querySelector('[data-testid="conversation-actions"]')!.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})));
    await act(async()=>menu("Sort").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true})));
    await settle();
    const recent=[...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(item=>item.textContent==="Recent")!;
    await click(recent);await settle();
    expect(ids()).toEqual(["dm-zara","dm-bob"]);
    expect(JSON.parse(localStorage.getItem("buzz-channel-sort.v1:self")!)).toEqual({version:1,groups:{dms:"recent"}});
  });
  it("retains the original New message then Sort menu and actual new-message callback",async()=>{
    const {host,opened}=await mount();
    await act(async()=>host.querySelector('[data-testid="conversation-actions"]')!.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})));
    expect([...document.querySelectorAll('[role="menuitem"]')].map(item=>item.textContent)).toEqual(["New message","Sort"]);
    await click(menu("New message"));await settle();expect(opened()).toBe(1);
  });
  it("keeps original resolved-label ties and quiet/invalid activity at the end",()=>{
    const rows=[{id:"a",name:"Z",lastMessageAt:"bad"},{id:"b",name:"Y",lastMessageAt:null},{id:"c",name:"X",lastMessageAt:new Date(20_000).toISOString()}];
    expect(sortDmChannelsForSidebar(rows,{a:"Adam",b:"Bob"},"recent").map(row=>row.id)).toEqual(["c","a","b"]);
    expect(rows.map(row=>row.id)).toEqual(["a","b","c"]);
  });
});

describe("original DM row avatar, presence dot and count (DD-120)",()=>{
  const people=[
    {principalId:"self",displayName:"Me",pubkeys:["a".repeat(64)]},
    {principalId:"bob",displayName:"Bob",pubkeys:["b".repeat(64),"d".repeat(64)]},
    {principalId:"zara",displayName:"Zara",pubkeys:["c".repeat(64)]},
  ];
  const group:ConversationView={id:"group",channelId:"dm-group",state:ConversationViewState.Active,participantPrincipalIds:["self","bob","zara"],version:1,operationId:"open-group"};
  async function mountRows(presence?:PresenceHost){
    const client=createBffClient({send:async request=>{
      if(request.path === "/api/v1/workspaces") return {status:200,body:[]};
      if(request.path.startsWith("/api/v1/conversation-participants")) return {status:200,body:{maxParticipants:9,items:people}};
      return {status:200,body:{version:0,workspacePreferences:{},conversationPreferences:{},readContexts:{}}};
    }});
    const list=<ConversationList currentPrincipalId="self" items={[...items,group]} loading={false} error={null} selectedId={null}
      onSelect={()=>{}} onNewMessage={()=>{}} onReload={()=>{}}/>;
    const wrap=(ui:ReactNode)=>presence?<PresenceHostProvider host={presence}>{ui}</PresenceHostProvider>:ui;
    const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    const host=await render(<QueryClientProvider client={cache}><PlatformProvider client={client} locale="en">
      <ConversationVisibilityProvider value={{read:async()=>new Set(),prepare:async()=>async()=>{}}}>{wrap(list)}</ConversationVisibilityProvider>
    </PlatformProvider></QueryClientProvider>);
    await settle();
    return host;
  }
  it("shows the participant avatar and group count without inventing presence",async()=>{
    const host=await mountRows();
    expect(host.querySelector('[data-testid="channel-avatar-Bob"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="channel-presence-Bob"]')).toBeNull();
    expect(host.querySelector('[data-testid="channel-dm-count-Bob, Zara"]')?.textContent).toBe("2");
  });
  it("dots the pair participant through any admitted key from one batched lookup",async()=>{
    const calls:string[][]=[];
    const presence:PresenceHost={
      queryPresence:async pubkeys=>{calls.push(pubkeys);return {presences:pubkeys.filter(key=>key==="d".repeat(64)).map(pubkey=>({pubkey,status:WebPresenceStatus.Online}))};},
      updatePresence:async()=>{},queryUserStatus:async()=>({statuses:[]}),updateUserStatus:async()=>({eventId:"e".repeat(64)}),
    };
    const host=await mountRows(presence);
    // Directory, visibility and the batched presence read resolve over several turns.
    await vi.waitFor(()=>expect(host.querySelector('[data-testid="channel-presence-Bob"]')?.getAttribute("data-presence-status")).toBe("online"));
    expect(host.querySelector('[data-testid="channel-presence-Zara"]')).toBeNull();
    expect(calls).toHaveLength(1);
    expect([...calls[0]!].sort()).toEqual(["b".repeat(64),"c".repeat(64),"d".repeat(64)]);
  });
});
