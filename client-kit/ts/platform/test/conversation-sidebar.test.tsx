import { act, useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { ConversationList, ConversationVisibilityProvider } from "../src/react/new-message";
import { useInboxState } from "../src/react/use-inbox-state";
import { setLocale } from "../src/i18n";
import { ItemState, type ConversationView, type ReadMarkRequest } from "@client-kit/contracts";
import { TransportError, type BffRequest } from "../src/transport";
import type { InboxEvent } from "../src/inbox";
import { sortDmChannelsForSidebar } from "../src/react/sidebar/dmSidebarSort";
import { click, render, settle } from "./render";

const items: ConversationView[] = [
  {id:"bob",channelId:"dm-bob",state:ItemState.Active,participantPrincipalIds:["self","bob"],version:1,operationId:"open-bob"},
  {id:"zara",channelId:"dm-zara",state:ItemState.Active,participantPrincipalIds:["self","zara"],version:1,operationId:"open-zara"},
];
const incoming: InboxEvent[] = [
  {id:"one",tags:[],createdAt:10,channelId:"dm-bob",channelType:"dm",category:"activity"},
  {id:"two",tags:[["e","one","","reply"]],createdAt:20,channelId:"dm-bob",channelType:"dm",category:"activity"},
  {id:"three",tags:[],createdAt:30,channelId:"dm-zara",channelType:"dm",category:"activity"},
];
beforeEach(() => {setLocale("en");localStorage.clear();});
async function mount(unknown = false) {
  let version = 0; const contexts: Record<string,string> = {};
  const writes: BffRequest[] = []; let opened = 0;
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
    const [selected,setSelected]=useState<string|null>(null);
    return <ConversationList currentPrincipalId="self" items={items} loading={false} error={null}
      selectedId={selected} onSelect={item=>setSelected(item.id)} onNewMessage={()=>{opened++;}} onReload={()=>{}}
      reads={reads} events={[...incoming,incoming[0]!,{...incoming[0]!,id:"foreign",channelId:"unadmitted"}]}
      lastMessageAtByChannelId={latest}/>;
  }
  const host=await render(<PlatformProvider client={client} locale="en"><ConversationVisibilityProvider value={{read:async()=>new Set(),prepare:async()=>async()=>{}}}><Sidebar/></ConversationVisibilityProvider></PlatformProvider>);
  await settle();
  return {host,writes,opened:()=>opened};
}
async function openContext(host:HTMLElement){
  const row=host.querySelector('[data-channel-id="dm-bob"]')!.closest("li")!;
  await act(async()=>row.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:1,clientY:1})));
}
function menu(text:string){return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item=>item.textContent===text)!;}

describe("original governed DM sidebar consumers",()=>{
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
