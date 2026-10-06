// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { setLocale } from "@client-kit/platform/i18n";
import { MessageAuthorIdentity, MessageAuthorProfile } from "./MessageAuthorProfile";

const api=vi.hoisted(()=>({messageAuthorProfile:vi.fn(),conversationMessageAuthorProfile:vi.fn()}));
vi.mock("../bff-client",()=>({bff:api}));
const author="a".repeat(64),other="b".repeat(64),eventId="c".repeat(64);
const target={principalId:"human",workspaceId:"workspace",eventId,pubkey:author};
let root:Root;let host:HTMLDivElement;let cache:QueryClient;
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>{
  setLocale("en");
  vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));
  vi.stubGlobal("ResizeObserver",class{observe(){} unobserve(){} disconnect(){}});
  api.messageAuthorProfile.mockReset();api.conversationMessageAuthorProfile.mockReset();
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
  cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
});
afterEach(async()=>{await act(async()=>root.unmount());cache.clear();host.remove();vi.unstubAllGlobals();});
async function render(content:React.ReactNode){await act(async()=>root.render(<QueryClientProvider client={cache}><TooltipProvider>{content}</TooltipProvider></QueryClientProvider>));}
function profile(pubkey=author){return {pubkey,eventId,displayName:"Message author",about:"Original biography",avatarUrl:null,nip05Handle:"author@example.org",avatarMediaPaths:{}};}

it("keeps original author triggers lazy until a real open, without a directory request",async()=>{
  const open=vi.fn();
  await render(<MessageAuthorIdentity target={target} onOpen={open}><span>Author</span></MessageAuthorIdentity>);
  expect(api.messageAuthorProfile).not.toHaveBeenCalled();
  expect(api.conversationMessageAuthorProfile).not.toHaveBeenCalled();
  await act(async()=>host.querySelector<HTMLElement>('[role="button"]')!.click());
  expect(open).toHaveBeenCalledOnce();
  expect(api.messageAuthorProfile).not.toHaveBeenCalled();
});

it("opens the actual message author, uses the private scope and passes the verified identity to DM",async()=>{
  api.conversationMessageAuthorProfile.mockResolvedValue(profile());const start=vi.fn();
  await render(<MessageAuthorProfile target={{...target,conversationId:"private"}} onClose={()=>{}} onStartDm={start}/>);
  await vi.waitFor(()=>expect(host.textContent).toContain("Original biography"));
  expect(api.conversationMessageAuthorProfile).toHaveBeenCalledWith("private",eventId);
  expect(api.messageAuthorProfile).not.toHaveBeenCalled();
  await act(async()=>[...host.querySelectorAll("button")].find(button=>button.textContent?.includes("Start direct message"))!.click());
  expect(start).toHaveBeenCalledWith(author);
});

it("does not expose another author's profile when a response mismatches the signed message",async()=>{
  api.messageAuthorProfile.mockResolvedValue(profile(other));
  await render(<MessageAuthorProfile target={target} onClose={()=>{}}/>);
  await vi.waitFor(()=>expect(host.querySelector('[role="alert"]')).not.toBeNull());
  expect(host.textContent).not.toContain("Original biography");
  expect(host.textContent).not.toContain("Message author");
});

it("rechecks the actual event and never shows prior-scope profile data after a scope switch",async()=>{
  api.messageAuthorProfile.mockResolvedValue(profile());
  await render(<MessageAuthorProfile target={target} onClose={()=>{}}/>);
  await vi.waitFor(()=>expect(host.textContent).toContain("Original biography"));
  api.conversationMessageAuthorProfile.mockRejectedValue(new Error("denied"));
  await render(<MessageAuthorProfile target={{...target,conversationId:"not-admitted"}} onClose={()=>{}}/>);
  await vi.waitFor(()=>expect(host.querySelector('[role="alert"]')).not.toBeNull());
  expect(host.textContent).not.toContain("Original biography");
});
