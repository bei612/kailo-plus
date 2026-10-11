// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlatformProvider } from "@client-kit/platform/react/context";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { setLocale } from "@client-kit/platform/i18n";
import { TransportError } from "@client-kit/platform/transport";
import { createBffClient } from "@client-kit/platform/client";
import { PulsePane } from "./PulsePane";
import { usePulseHost } from "@client-kit/platform/react/pulse";
import { BffMessageLinkHost } from "@/features/chat/ui/BffMessageLinkHost";
import { ProjectRichContent } from "../../../../../client-kit/ts/platform/src/react/projects/ProjectRichContent";

const api=vi.hoisted(()=>({profile:vi.fn(),queryPulse:vi.fn(),discoverableWorkspaces:vi.fn(),error:vi.fn()}));
vi.mock("sonner",()=>({toast:{error:api.error,success:vi.fn()}}));
vi.mock("../bff-client",()=>({bff:{profile:api.profile,discoverableWorkspaces:api.discoverableWorkspaces},queryPulse:api.queryPulse,
  publishPulse:vi.fn(),uploadPulseMedia:vi.fn(),pulseMediaUrl:(value:string)=>value}));
// This batch exercises the original Pulse/Profile/Message consumer, not post editing.
vi.mock("./ChannelPane",()=>({Composer:()=>null}));
const own="a".repeat(64),peer="b".repeat(64),eventId="c".repeat(64);
let root:Root,host:HTMLDivElement,cache:QueryClient;
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>{
  setLocale("en");
  vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));
  vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});
  vi.spyOn(HTMLElement.prototype,"offsetHeight","get").mockReturnValue(420);
  vi.spyOn(HTMLElement.prototype,"offsetWidth","get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockReturnValue(new DOMRect(0,0,800,420));
  api.profile.mockReset().mockResolvedValue({pubkey:own});
  api.error.mockReset();api.discoverableWorkspaces.mockReset();
  api.queryPulse.mockReset().mockImplementation(async(request:{view:string;authors?:string[]})=>({mediaPaths:{},events:
    request.view==="NOTES"?[{id:eventId,pubkey:peer,created_at:1,kind:1,tags:[],content:"Actual Pulse note"}]:
      request.view==="PROFILES"?(request.authors??[]).map(pubkey=>({id:eventId,pubkey,created_at:1,kind:0,tags:[],
        content:JSON.stringify({display_name:pubkey===peer?"Actual author":"Viewer",about:"Original public biography"})})):[]}));
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
  cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
});
afterEach(async()=>{await act(async()=>root.unmount());cache.clear();host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
it.each([undefined,"mt-1 text-sm text-foreground/90","text-sm text-muted-foreground"])("passes original project rich-content classes %s to the actual Web Markdown body",async className=>{
  const client=createBffClient({send:async()=>({status:200,body:{maxParticipants:9,items:[]}})});
  await act(async()=>root.render(<QueryClientProvider client={cache}><PlatformProvider client={client} locale="en"><TooltipProvider>
    <PulsePane scopeKey="tenant:viewer" onStartDm={vi.fn()}><ProjectRichContent className={className} content="Original **project body** with [a link](https://example.test/page)"/></PulsePane>
  </TooltipProvider></PlatformProvider></QueryClientProvider>));
  await vi.waitFor(()=>expect(host.querySelector(".message-markdown strong")?.textContent).toBe("project body"));
  const body=host.querySelector(".message-markdown")!;
  expect(body.classList.contains("text-sm")).toBe(true);
  expect(body.classList.contains("text-message")).toBe(false);
  expect(body.classList.contains(className?.includes("text-muted-foreground")?"text-muted-foreground":className?"text-foreground/90":"text-foreground")).toBe(true);
  if(className)expect(body.classList.contains("text-foreground")).toBe(false);
  if(className?.includes("mt-1"))expect(body.classList.contains("mt-1")).toBe(true);
  expect(body.querySelector("a")?.getAttribute("href")).toBe("https://example.test/page");
  expect(body.parentElement?.className).not.toBe(className??"text-sm");
});
async function mount(start:(pubkey:string)=>Promise<void>) {
  const client=createBffClient({send:async(request)=>{
    expect(request.path).toMatch(/^\/api\/v1\/conversation-participants/);
    return {status:200,body:{maxParticipants:9,items:[{principalId:"peer",displayName:"Actual author",pubkeys:[peer]}]}};
  }});
  await act(async()=>root.render(<QueryClientProvider client={cache}><PlatformProvider client={client} locale="en">
    <TooltipProvider><PulsePane scopeKey="tenant:viewer" onStartDm={start}/></TooltipProvider>
  </PlatformProvider></QueryClientProvider>));
  await vi.waitFor(()=>expect([...host.querySelectorAll("article button")].find(button=>button.textContent==="Actual author")).toBeDefined());
  await act(async()=>[...host.querySelectorAll<HTMLButtonElement>("article button")].find(button=>button.textContent==="Actual author")!.click());
  await vi.waitFor(()=>expect(host.querySelector('[data-testid="user-profile-message"]')).not.toBeNull());
}

it("the actual Web Pulse adapter awaits confirmed DM navigation before closing the original profile",async()=>{
  let finish!:()=>void;
  const start=vi.fn((_pubkey:string)=>new Promise<void>(resolve=>{finish=resolve;}));
  await mount(start);
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="user-profile-message"]')!.click());
  expect(start).toHaveBeenCalledWith(peer);
  expect(host.querySelector('[data-testid="user-profile-panel"]')).not.toBeNull();
  expect(host.querySelector<HTMLButtonElement>('[data-testid="user-profile-message"]')!.disabled).toBe(true);
  await act(async()=>finish());
  await vi.waitFor(()=>expect(host.querySelector('[data-testid="user-profile-panel"]')).toBeNull());
});

it("the actual Web Pulse adapter propagates an unknown result and keeps the original profile open",async()=>{
  const start=vi.fn().mockRejectedValue(new TransportError("Direct message result unknown"));
  await mount(start);
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="user-profile-message"]')!.click());
  expect(start).toHaveBeenCalledWith(peer);
  expect(host.querySelector('[data-testid="user-profile-panel"]')).not.toBeNull();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Direct message result unknown");
});

const originId="12345678-1234-4234-8234-123456789012";
const origin=()=>({id:"origin-workspace",visibility:"open",isMember:false,memberCount:1,
  createdAt:new Date("2026-10-07T00:00:00Z"),channel:{channelId:originId,channelType:"stream",name:"Visible origin",description:"",archived:false}});
function OriginConsumer(){const {OriginReference}=usePulseHost();if(!OriginReference)throw new Error("Missing original origin consumer");return <OriginReference channelId={originId}/>;}
async function mountOrigin(open:(id:string)=>void,scopeKey="tenant:viewer") {
  const client=createBffClient({send:async()=>({status:200,body:{maxParticipants:9,items:[]}})});
  await act(async()=>root.render(<QueryClientProvider client={cache}><PlatformProvider client={client} locale="en"><TooltipProvider>
    <BffMessageLinkHost scopeKey={scopeKey} principalId="viewer" conversations={[]} onOpenChannel={open} onOpenMessageLink={vi.fn()}>
      <PulsePane scopeKey={scopeKey} onStartDm={vi.fn()}><OriginConsumer/></PulsePane>
    </BffMessageLinkHost>
  </TooltipProvider></PlatformProvider></QueryClientProvider>));
}
it("the Web origin host performs a fresh bounded metadata read before original open-channel navigation",async()=>{
  const open=vi.fn();api.discoverableWorkspaces.mockResolvedValue({items:[origin()]});
  await mountOrigin(open);
  await vi.waitFor(()=>expect(host.querySelector('[aria-label="Open author-claimed origin channel #Visible origin"]')).not.toBeNull());
  expect(api.discoverableWorkspaces).toHaveBeenCalledWith(undefined,originId);
  const reads=api.discoverableWorkspaces.mock.calls.length;
  await act(async()=>host.querySelector<HTMLButtonElement>("button")!.click());
  await vi.waitFor(()=>expect(open).toHaveBeenCalledWith(originId));
  expect(api.discoverableWorkspaces).toHaveBeenCalledTimes(reads+1);
});
it.each(["revoked","unavailable","wrong-channel"])("the Web origin host refuses %s on click instead of using a warm label as authorization",async fault=>{
  const open=vi.fn();api.discoverableWorkspaces.mockResolvedValue({items:[origin()]});
  await mountOrigin(open);
  await vi.waitFor(()=>expect(host.querySelector("button")).not.toBeNull());
  if(fault==="unavailable")api.discoverableWorkspaces.mockRejectedValue(new Error("Discovery unavailable"));
  else api.discoverableWorkspaces.mockResolvedValue(fault==="revoked"?{items:[]}:{items:[{...origin(),channel:{...origin().channel,channelId:"22345678-1234-4234-8234-123456789012"}}]});
  await act(async()=>host.querySelector<HTMLButtonElement>("button")!.click());
  await vi.waitFor(()=>expect(api.error).toHaveBeenCalled());
  expect(open).not.toHaveBeenCalled();await vi.waitFor(()=>expect(host.querySelector("button")).toBeNull());
  if(fault!=="revoked")expect(host.textContent).not.toContain("a private channel");
});
it("a lookup completing after the original scope leaves cannot navigate",async()=>{
  const open=vi.fn();api.discoverableWorkspaces.mockResolvedValue({items:[origin()]});
  await mountOrigin(open);await vi.waitFor(()=>expect(host.querySelector("button")).not.toBeNull());
  let finish!:(page:{items:ReturnType<typeof origin>[]})=>void;
  api.discoverableWorkspaces.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  await act(async()=>host.querySelector<HTMLButtonElement>("button")!.click());
  await mountOrigin(open,"tenant:other");
  await act(async()=>finish({items:[origin()]}));
  expect(open).not.toHaveBeenCalled();
});
