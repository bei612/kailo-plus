// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChannelScreenHeader } from "../../src/features/channels/ui/ChannelScreenHeader";
import { ProfilePanelProvider } from "../../src/shared/context/ProfilePanelContext";
import { createBffClient } from "@client-kit/platform/client";
import { PlatformProvider } from "@client-kit/platform/react/context";
import { setLocale } from "@client-kit/platform/i18n";
import type { Channel } from "../../src/shared/api/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ active: true, unknown: false, multikey: false, group: false, missing: false,
  device: "a".repeat(64), title: "DM", keys: [] as string[], open: vi.fn(), requests: [] as string[] }));
const own="a".repeat(64), ownAlias="c".repeat(64), peer="b".repeat(64), peerAlias="d".repeat(64);
const conversation={id:"conversation",channelId:"native-dm",state:"ACTIVE",participantPrincipalIds:["self","peer"]};
vi.mock("@/app/AppShellContext",()=>({useAppShell:()=>({coreReads:{state:{},failed:false,unknown:state.unknown,
  conversations:[{...conversation,state:state.active?"ACTIVE":"PROVISIONING",
    participantPrincipalIds:state.group?["self","peer","two","three","four"]:conversation.participantPrincipalIds}]}})}));
vi.mock("@/features/platform/activeCommunity",()=>({useNativeSession:()=>({client,devicePubkey:state.device,
  facts:{communityHost:"actual-community"}})}));
vi.mock("@/features/profile/hooks",()=>({useUsersBatchQuery:(keys:string[])=>{
  state.keys=keys;
  return {isSuccess:true,isFetching:false,isPlaceholderData:false,data:{profiles:{[peer]:{displayName:"Peer",avatarUrl:null}}}};
},useUserProfileQuery:()=>({isSuccess:true,isFetching:false,data:{pubkey:peer,displayName:"Peer",avatarUrl:null}})}));
vi.mock("@/shared/lib/mediaUrl",()=>({rewriteRelayUrl:(url:string)=>url}));
vi.mock("@/shared/lib/clipboard",()=>({writeTextToClipboard:vi.fn()}));

const client=createBffClient({send:async request=>{
  state.requests.push(request.path);
  if(request.path==="/api/v1/session")return {status:200,body:{tenantPrincipalId:"self",accessMode:"FULL"}};
  if(request.path.startsWith("/api/v1/conversation-participants"))return {status:200,body:{maxParticipants:9,items:[
    {principalId:"self",displayName:"Self",pubkeys:[own,ownAlias]},
    ...(state.missing?[]:[{principalId:"peer",displayName:"Actual peer",pubkeys:state.multikey?[peer,peerAlias]:[peer]}]),
    ...(state.group?[{principalId:"two",displayName:"Two",pubkeys:["e".repeat(64)]},
      {principalId:"three",displayName:"Three",pubkeys:["f".repeat(64)]},
      {principalId:"four",displayName:"Four",pubkeys:["1".repeat(64)]}]:[]),
  ]}};
  throw new Error(request.path);
}});
const channel:Channel={id:"native-dm",name:"DM",channelType:"dm",visibility:"private",description:"",
  topic:null,purpose:null,memberCount:3,memberPubkeys:[own,ownAlias,peer],lastMessageAt:null,archivedAt:null,
  participants:["Self","Other own device","Actual peer"],participantPubkeys:[own,ownAlias,peer],isMember:true,
  ttlSeconds:null,ttlDeadline:null};
let root:Root;let host:HTMLDivElement;let cache:QueryClient;
async function render(){
  await act(async()=>root.render(<QueryClientProvider client={cache}><PlatformProvider client={client} locale="en">
    <ProfilePanelProvider onOpenProfilePanel={state.open}>
      <ChannelScreenHeader activeChannel={{...channel,name:state.title}} activeChannelEphemeralDisplay={null} currentPubkey={own}/>
    </ProfilePanelProvider>
  </PlatformProvider></QueryClientProvider>));
  for(let turn=0;turn<8;turn++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});
}
beforeEach(()=>{
  setLocale("en");state.active=true;state.unknown=false;state.multikey=false;state.group=false;state.missing=false;
  state.device=own;state.title="DM";state.keys=[];state.requests=[];state.open.mockReset();
  vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});
  vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));
  cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());cache.clear();host.remove();vi.unstubAllGlobals();});

it("restores the original Native DM header from actual governed people, not a viewer's second device",async()=>{
  await render();
  expect(host.querySelector('[data-testid="chat-title"]')?.textContent).toBe("Actual peer");
  expect(host.querySelector('[data-testid="chat-header-dm-avatar"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="chat-header-dm-avatar-stack"]')).toBeNull();
  expect(state.keys).toEqual([peer]);
  expect(host.textContent).not.toContain("Other own device");
  const trigger=host.querySelector<HTMLElement>('[role="button"]')!;
  await act(async()=>trigger.click());
  expect(state.open).toHaveBeenCalledExactlyOnceWith(peer);
  expect(state.requests).toContain("/api/v1/conversation-participants");
  expect(host.querySelector('[data-testid="chat-presence-badge"]')).toBeNull();
});
it("does not select an arbitrary canonical key or expose a fake profile for a multi-device person",async()=>{
  state.multikey=true;await render();
  expect(host.querySelector('[data-testid="chat-title"]')?.textContent).toBe("Actual peer");
  expect(state.keys).toEqual([]);
  expect(host.querySelector('[data-testid="chat-header-dm-avatar"]')).not.toBeNull();
  expect(host.querySelector('[role="button"]')).toBeNull();
});
it("retains an original authored DM name instead of replacing it with computed people labels",async()=>{
  state.title="Authored conversation name";await render();
  expect(host.querySelector('[data-testid="chat-title"]')?.textContent).toBe("Authored conversation name");
  expect(host.querySelector('[data-testid="chat-header-dm-avatar"]')).not.toBeNull();
});
it("restores original group preview and +remaining using principal count",async()=>{
  state.group=true;await render();
  expect(host.querySelectorAll('[data-testid="chat-header-dm-avatar-stack-participant"]')).toHaveLength(3);
  expect(host.querySelector('[data-testid="chat-header-dm-avatar-stack-more"]')?.textContent).toBe("+1");
  expect(host.querySelector('[data-testid="chat-title"]')?.textContent).toBe("Actual peer, Two, Three, +1 more");
});
it.each(["inactive","unknown","missing","identity-changed"])("closes the %s Native header source",async(condition)=>{
  if(condition==="inactive")state.active=false;
  if(condition==="unknown")state.unknown=true;
  if(condition==="missing")state.missing=true;
  if(condition==="identity-changed")state.device=ownAlias;
  await render();
  expect(host.querySelector('[data-testid="chat-title"]')?.textContent).toBe("DM");
  expect(host.querySelector('[data-testid="chat-header-dm-avatar"]')).toBeNull();
  expect(state.keys).toEqual([]);
});
