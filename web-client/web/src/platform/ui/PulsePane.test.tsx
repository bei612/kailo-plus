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

const api=vi.hoisted(()=>({profile:vi.fn(),queryPulse:vi.fn()}));
vi.mock("../bff-client",()=>({bff:{profile:api.profile},queryPulse:api.queryPulse,
  publishPulse:vi.fn(),uploadPulseMedia:vi.fn(),pulseMediaUrl:(value:string)=>value}));
// This batch exercises the original Pulse/Profile/Message consumer, not post editing.
vi.mock("./ChannelPane",()=>({Composer:()=>null}));
vi.mock("@/features/chat/ui/MessageContent",()=>({MessageContent:({content}:{content:string})=><p>{content}</p>}));
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
  api.queryPulse.mockReset().mockImplementation(async(request:{view:string;authors?:string[]})=>({mediaPaths:{},events:
    request.view==="NOTES"?[{id:eventId,pubkey:peer,created_at:1,kind:1,tags:[],content:"Actual Pulse note"}]:
      request.view==="PROFILES"?(request.authors??[]).map(pubkey=>({id:eventId,pubkey,created_at:1,kind:0,tags:[],
        content:JSON.stringify({display_name:pubkey===peer?"Actual author":"Viewer",about:"Original public biography"})})):[]}));
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
  cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
});
afterEach(async()=>{await act(async()=>root.unmount());cache.clear();host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
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
