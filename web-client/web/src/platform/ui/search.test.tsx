// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChannelType, ItemState, WorkspaceVisibility, type ConversationView } from "@client-kit/contracts";
import { createBffClient } from "@client-kit/platform/client";
import { PlatformProvider } from "@client-kit/platform/react/context";
import { setLocale } from "@client-kit/platform/i18n";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import type { BffRequest } from "@client-kit/platform/transport";
import { TopbarSearch } from "./TopbarSearch";
import { loadWebSearchDirectory } from "./search";

const native="7a533c07-3817-4c91-81f7-25f31534359a", privateNative="d051419a-0f17-40cd-a7e9-6ddedb807979";
const alice={principalId:"alice",displayName:"Alice",pubkeys:["a".repeat(64)]};
const bob={principalId:"bob",displayName:"Bob",pubkeys:["b".repeat(64)]};
const conversation:ConversationView={id:"private-reference",channelId:privateNative,state:ItemState.Active,
  participantPrincipalIds:["alice","bob"],operationId:"operation",version:1};
function workspace(){return {id:"workspace-reference",createdAt:new Date(),visibility:WorkspaceVisibility.Open,isMember:true,memberCount:2,
  channel:{channelId:native,channelType:ChannelType.Stream,name:"Original channel",description:"Original description",archived:false}};}
function directoryClient(send:(request:BffRequest)=>Promise<{status:number;body:unknown}> = async request=>({status:200,
  body:request.path.startsWith("/api/v1/discoverable-workspaces")?{items:[workspace()]}:{items:[alice,bob],maxParticipants:4}})){
  return createBffClient({send});
}

let root:Root|undefined;let host:HTMLDivElement|undefined;let cache:QueryClient|undefined;
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>{
  setLocale("en");
  vi.stubGlobal("matchMedia",()=>({matches:true,addEventListener:()=>{},removeEventListener:()=>{},addListener:()=>{},removeListener:()=>{}}));
  vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});
  HTMLElement.prototype.scrollIntoView=vi.fn();
});
afterEach(async()=>{if(root)await act(async()=>root!.unmount());cache?.clear();host?.remove();root=undefined;cache=undefined;host=undefined;vi.unstubAllGlobals();});

it("uses actual native directory bindings and current participant labels without fabricating full Relay channel facts",async()=>{
  const page=await loadWebSearchDirectory(directoryClient(),[conversation],"alice",()=>{});
  expect(page.channels.map(row=>[row.id,row.channelType,row.name])).toEqual([[native,"stream","Original channel"],[privateNative,"dm","Direct message"]]);
  expect(page.workspaces[0]?.id).toBe("workspace-reference");
  expect(page.labels[privateNative]).toBe("Bob");
  expect(page.channels[0]).not.toHaveProperty("memberPubkeys");
  expect(page.channels[1]).not.toHaveProperty("participantPubkeys");
  expect(page.channels[1]).not.toHaveProperty("archivedAt");
  expect(page.people).toEqual([alice,bob]);
});

it.each(["unadmitted-dm","missing-person","ambiguous-binding","scope-changed"])("rejects the %s directory instead of manufacturing search facts",async(invalid)=>{
  let active=true;
  const client=directoryClient(async request=>{
    if(request.path.startsWith("/api/v1/discoverable-workspaces")){
      if(invalid==="scope-changed")active=false;
      return {status:200,body:{items:[workspace()]}};
    }
    return {status:200,body:{items:invalid==="missing-person"?[alice]:[alice,bob],maxParticipants:4}};
  });
  const actual=invalid==="unadmitted-dm"?{...conversation,participantPrincipalIds:["other","bob"]}
    :invalid==="ambiguous-binding"?{...conversation,channelId:native}:conversation;
  await expect(loadWebSearchDirectory(client,[actual],"alice",()=>{if(!active)throw new Error("scope changed");})).rejects.toThrow();
});

it("the actual Web Topbar consumes original shared search, real semantic BFF reads and native message focus",async()=>{
  const client=directoryClient();
  const directory=await loadWebSearchDirectory(client,[conversation],"alice",()=>{});
  const event={id:"c".repeat(64),pubkey:bob.pubkeys[0],kind:9,created_at:12,content:"original result",tags:[["h",native]]};
  const fetcher=vi.fn(async(url:RequestInfo|URL,_init?:RequestInit)=>new Response(JSON.stringify(String(url).includes("/search/messages")
    ?{events:[event]}:{events:[],mediaPaths:{}}),{status:200,headers:{"Content-Type":"application/json"}}));
  vi.stubGlobal("fetch",fetcher);
  const opened=vi.fn();
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
  cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  await act(async()=>root!.render(<QueryClientProvider client={cache!}><PlatformProvider client={client} locale="en"><TooltipProvider>
    <TopbarSearch scopeKey="alice-session" channels={directory.channels} channelLabels={directory.labels} onOpenChannel={()=>{}}
      onOpenResult={opened}/>
  </TooltipProvider></PlatformProvider></QueryClientProvider>));
  await act(async()=>host!.querySelector<HTMLButtonElement>('[data-testid="open-search"]')!.click());
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,40));});
  const input=document.querySelector<HTMLInputElement>('[data-testid="search-dialog-input"]')!;
  await act(async()=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"original");
    input.dispatchEvent(new Event("input",{bubbles:true}));
  });
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,450));});
  for(let turn=0;turn<5;turn++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
  expect(document.querySelector(`[data-testid="search-result-${event.id}"]`)).not.toBeNull();
  const request=fetcher.mock.calls.find(call=>String(call[0]).includes("/search/messages"))!;
  expect(JSON.parse(request[1]!.body as string)).toMatchObject({q:"original"});
  expect(JSON.parse(request[1]!.body as string)).not.toHaveProperty("filter");
  await act(async()=>document.querySelector<HTMLButtonElement>(`[data-testid="search-result-${event.id}"]`)!.click());
  expect(opened).toHaveBeenCalledWith(expect.objectContaining({channelId:native,eventId:event.id,content:"original result"}),"original");
});
