import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { MembersPane, WorkspaceManagementPanels } from "../src/react/pages";
import type { BffRequest, BffReply } from "../src/transport";
import { render, click, button, type, settle } from "./render";

beforeEach(()=>{
  vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));
  vi.stubGlobal("ResizeObserver",class {observe(){} disconnect(){} unobserve(){}});
  vi.spyOn(HTMLElement.prototype,"offsetHeight","get").mockReturnValue(420);
  vi.spyOn(HTMLElement.prototype,"offsetWidth","get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockReturnValue(new DOMRect(0,0,800,420));
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

const first="e".repeat(64),second="f".repeat(64);
const member={principalId:"person",displayName:"Ada",state:"ACTIVE",pubkeys:[first,second]};
const profile={pubkey:second,displayName:"Relay Ada",about:"Original profile",avatarUrl:null,avatarMediaPaths:{}};
function mount(route:(request:BffRequest)=>BffReply, ui:React.ReactNode) {
  const send=vi.fn(async(request:BffRequest)=>route(request));
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  return {send,render:()=>render(<QueryClientProvider client={cache}><PlatformProvider locale="en" client={createBffClient({send})}>{ui}</PlatformProvider></QueryClientProvider>)};
}

describe("original member browsing with governed identity",()=>{
  it("keeps all real keys, searches, and lazily opens only the selected member profile",async()=>{
    const m=mount(request=>({status:200,body:request.path.endsWith("/members")?[member]:profile}),<MembersPane workspaceId="workspace"/>);
    const host=await m.render();await settle();
    expect(m.send).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('[data-testid="member-person"]')).toHaveLength(1);
    expect(host.textContent).toContain("eeeeeeee…eeee");expect(host.textContent).toContain("ffffffff…ffff");
    await type(host.querySelector('input')!,"missing");expect(host.textContent).toContain("No members match");
    await type(host.querySelector('input')!,"Ada");
    const key=host.querySelector<HTMLElement>(`span[title="${second}"] [role="button"]`)!;
    await click(key);
    await vi.waitFor(()=>expect(host.textContent).toContain("Original profile"));
    expect(m.send).toHaveBeenCalledWith({method:"GET",path:`/api/v1/workspaces/workspace/members/person/profiles/${second}`});
    expect(m.send.mock.calls.every(([request])=>!request.path.includes("pulse")&&!request.path.includes("author-profile"))).toBe(true);
  });
  it("fresh read failure removes both member rows and an open profile",async()=>{
    let refused=false;
    const m=mount(request=>refused?{status:403,body:{}}:{status:200,body:request.path.endsWith("/members")?[member]:profile},<MembersPane workspaceId="workspace"/>);
    const host=await m.render();await settle();
    await click(host.querySelector<HTMLElement>(`span[title="${second}"] [role="button"]`)!);
    await vi.waitFor(()=>expect(host.querySelector('[data-testid="member-profile-panel"]')).not.toBeNull());
    refused=true;await act(async()=>window.dispatchEvent(new Event("focus")));await settle();
    expect(host.querySelector('[data-testid="member-profile-panel"]')).toBeNull();
    expect(host.querySelector('[data-testid="member-person"]')).toBeNull();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
  it("retains the native identity host instead of replacing it with SERVER profile transport",async()=>{
    const native=vi.fn();const m=mount(()=>({status:200,body:[member]}),<MembersPane workspaceId="workspace"
      renderIdentity={(pubkey,children,label)=><button aria-label={label} onClick={()=>native(pubkey)}>{children}</button>}/>);
    const host=await m.render();await settle();
    await click(host.querySelector<HTMLButtonElement>(`span[title="${second}"] button`)!);
    expect(native).toHaveBeenCalledWith(second);expect(m.send).toHaveBeenCalledTimes(1);
  });
  it("does not fetch all management forms on entry or unmount a visited context on navigation",async()=>{
    const m=mount(()=>({status:200,body:{workspaces:[]}}),<WorkspaceManagementPanels><p>Directory</p></WorkspaceManagementPanels>);
    const host=await m.render();expect(m.send).not.toHaveBeenCalled();
    await click(button(host,"Administrator roles"));
    expect(m.send.mock.calls.some(([request])=>request.path.startsWith("/api/v1/role-workspaces"))).toBe(true);
    const original=host.querySelector('[data-testid="role-management"]');expect(original).not.toBeNull();
    await click(button(host,"Members"));
    expect(host.querySelector('[data-testid="role-management"]')).toBe(original);
    expect(original?.closest('section')?.hidden).toBe(true);
  });
});
