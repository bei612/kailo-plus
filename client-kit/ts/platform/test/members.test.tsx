import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { MembersPane, WorkspaceManagementPanels } from "../src/react/pages";
import type { BffRequest, BffReply } from "../src/transport";
import { TransportError } from "../src/transport";
import { TenantInvitations } from "../src/react/invitations";
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
function browse(request:BffRequest):BffReply {
  return request.path.includes("role-members")||request.path.includes("invitations")?{status:403,body:{}}:
    {status:200,body:request.path.endsWith("/members")?[member]:profile};
}
function mount(route:(request:BffRequest)=>BffReply, ui:React.ReactNode) {
  const send=vi.fn(async(request:BffRequest)=>route(request));
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  return {send,render:()=>render(<QueryClientProvider client={cache}><PlatformProvider locale="en" client={createBffClient({send})}>{ui}</PlatformProvider></QueryClientProvider>)};
}

describe("original member browsing with governed identity",()=>{
  it("keeps all real keys, searches, and lazily opens only the selected member profile",async()=>{
    const startDm=vi.fn();
    const m=mount(browse,<MembersPane workspaceId="workspace" onStartDm={startDm}/>);
    const host=await m.render();await settle();
    expect(m.send.mock.calls.filter(([request])=>request.path.includes("/profiles/"))).toHaveLength(0);
    expect(host.querySelectorAll('[data-testid="member-person"]')).toHaveLength(1);
    expect(host.textContent).toContain("eeeeeeee…eeee");expect(host.textContent).toContain("ffffffff…ffff");
    await type(host.querySelector('input')!,"missing");expect(host.textContent).toContain("No members match");
    await type(host.querySelector('input')!,"Ada");
    const key=host.querySelector<HTMLElement>(`span[title="${second}"] [role="button"]`)!;
    await click(key);
    await vi.waitFor(()=>expect(host.textContent).toContain("Original profile"));
    expect(m.send).toHaveBeenCalledWith({method:"GET",path:`/api/v1/workspaces/workspace/members/person/profiles/${second}`});
    expect(m.send.mock.calls.every(([request])=>!request.path.includes("pulse")&&!request.path.includes("author-profile"))).toBe(true);
    await click(host.querySelector<HTMLButtonElement>('[data-testid="user-profile-message"]')!);
    expect(startDm).toHaveBeenCalledExactlyOnceWith(second);
  });
  it("fresh read failure removes both member rows and an open profile",async()=>{
    let refused=false;
    const m=mount(request=>refused?{status:403,body:{}}:browse(request),<MembersPane workspaceId="workspace"/>);
    const host=await m.render();await settle();
    await click(host.querySelector<HTMLElement>(`span[title="${second}"] [role="button"]`)!);
    await vi.waitFor(()=>expect(host.querySelector('[data-testid="member-profile-panel"]')).not.toBeNull());
    refused=true;await act(async()=>window.dispatchEvent(new Event("focus")));await settle();
    expect(host.querySelector('[data-testid="member-profile-panel"]')).toBeNull();
    expect(host.querySelector('[data-testid="member-person"]')).toBeNull();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
  it("keeps the original member Message pending until the actual DM opens, then closes the panel",async()=>{
    let finish!:()=>void;
    const startDm=vi.fn((_pubkey:string)=>new Promise<void>(resolve=>{finish=resolve;}));
    const m=mount(browse,<MembersPane workspaceId="workspace" currentPrincipalId="viewer" onStartDm={startDm}/>);
    const host=await m.render();await settle();
    await click(host.querySelector<HTMLElement>(`span[title="${second}"] [role="button"]`)!);
    await vi.waitFor(()=>expect(host.querySelector('[data-testid="user-profile-message"]')).not.toBeNull());
    await click(host.querySelector<HTMLButtonElement>('[data-testid="user-profile-message"]')!);
    expect(startDm).toHaveBeenCalledWith(second);
    expect(host.querySelector('[data-testid="member-profile-panel"]')).not.toBeNull();
    expect(host.querySelector<HTMLButtonElement>('[data-testid="user-profile-message"]')!.disabled).toBe(true);
    await act(async()=>finish());
    expect(host.querySelector('[data-testid="member-profile-panel"]')).toBeNull();
  });
  it("preserves the original member profile when DM confirmation is unknown",async()=>{
    const startDm=vi.fn().mockRejectedValue(new TransportError("Direct message result unknown"));
    const m=mount(browse,<MembersPane workspaceId="workspace" currentPrincipalId="viewer" onStartDm={startDm}/>);
    const host=await m.render();await settle();
    await click(host.querySelector<HTMLElement>(`span[title="${second}"] [role="button"]`)!);
    await vi.waitFor(()=>expect(host.querySelector('[data-testid="user-profile-message"]')).not.toBeNull());
    await click(host.querySelector<HTMLButtonElement>('[data-testid="user-profile-message"]')!);
    expect(host.querySelector('[data-testid="member-profile-panel"]')).not.toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Direct message result unknown");
    expect(host.querySelector<HTMLButtonElement>('[data-testid="user-profile-message"]')!.disabled).toBe(false);
  });
  it("does not offer the original Message tile for the current principal's own key",async()=>{
    const startDm=vi.fn();
    const m=mount(browse,<MembersPane workspaceId="workspace" currentPrincipalId="person" onStartDm={startDm}/>);
    const host=await m.render();await settle();
    await click(host.querySelector<HTMLElement>(`span[title="${second}"] [role="button"]`)!);
    await vi.waitFor(()=>expect(host.textContent).toContain("Original profile"));
    expect(host.querySelector('[data-testid="user-profile-message"]')).toBeNull();
    expect(startDm).not.toHaveBeenCalled();
  });
  it("retains the native identity host instead of replacing it with SERVER profile transport",async()=>{
    const native=vi.fn();const m=mount(browse,<MembersPane workspaceId="workspace"
      renderIdentity={(pubkey,children,label)=><button aria-label={label} onClick={()=>native(pubkey)}>{children}</button>}/>);
    const host=await m.render();await settle();
    await click(host.querySelector<HTMLButtonElement>(`span[title="${second}"] button`)!);
    expect(native).toHaveBeenCalledWith(second);expect(m.send.mock.calls.some(([request])=>request.path.includes("/profiles/"))).toBe(false);
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

const role={principalId:member.principalId,displayName:member.displayName,tenantAdmin:false,workspaceAdmin:false,
  canGrantTenantAdmin:false,canRevokeTenantAdmin:false,canGrantWorkspaceAdmin:true,canRevokeWorkspaceAdmin:false,
  canRemoveFromWorkspace:true,canRemoveFromTenant:false,lastTenantAdmin:false};
async function memberMenu(host:HTMLElement) {
  const trigger=host.querySelector<HTMLButtonElement>('button[aria-label="Actions for Ada"]')!;
  expect(trigger).not.toBeNull();
  await act(async()=>trigger.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})));
  await settle();return document.querySelector<HTMLElement>('[role="menu"]')!;
}
async function chooseMember(host:HTMLElement,label:string) {
  const menu=await memberMenu(host);
  const item=[...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node=>node.textContent===label)!;
  expect(item).toBeDefined();await click(item);
}
describe("original member actions through the same governance entry",()=>{
  it("uses exact server flags and the original command scope, not role-derived removal",async()=>{
    const m=mount(request=>request.method==="POST"?{status:202,body:{actionKey:"workspace.admin.grant",actionExecutionId:"ae",operationId:"op",gateState:"ALLOWED",dispatchState:"DISPATCHED"}}:
      request.path.includes("role-members")?{status:200,body:{members:[{...role,canRemoveFromWorkspace:undefined}]}}:browse(request),<MembersPane workspaceId="workspace"/>);
    const host=await m.render();await settle();
    const menu=await memberMenu(host);expect(menu.textContent).not.toContain("Remove channel member");
    await click([...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node=>node.textContent==="Grant channel administrator")!);
    expect(m.send.mock.calls.some(([request])=>request.method==="POST")).toBe(false);
    await click(button(host,"Confirm"));
    expect(m.send).toHaveBeenCalledWith(expect.objectContaining({method:"POST",path:"/api/v1/actions",body:expect.objectContaining({actionKey:"workspace.admin.grant",principalId:"person",workspaceId:"workspace"})}));
    expect(host.textContent).toContain("Check Tasks for its final result");
  });
  it("keeps an uncertain removal intent and key across fresh reads",async()=>{
    let attempts=0;
    const m=mount(request=>request.method==="POST"?(++attempts===2?{status:403,body:{}}:{status:202,body:{actionKey:"workspace.member.revoke",actionExecutionId:"ae",operationId:"op",gateState:"ALLOWED",dispatchState:"UNKNOWN"}}):
      request.path.includes("role-members")?{status:200,body:{members:[role]}}:browse(request),<MembersPane workspaceId="workspace"/>);
    const host=await m.render();await settle();await chooseMember(host,"Remove channel member");
    await click(button(host,"Confirm"));expect(host.textContent).toContain("accepted is unknown");
    expect([...host.querySelectorAll('button')].some(node=>node.textContent==="Cancel")).toBe(false);
    await click(button(host,"Confirm"));
    expect(host.textContent).toContain("accepted is unknown");
    expect([...host.querySelectorAll('button')].some(node=>node.textContent==="Cancel")).toBe(false);
    await click(button(host,"Confirm"));
    const commands=m.send.mock.calls.filter(([request])=>request.method==="POST").map(([request])=>request.body);
    expect(commands).toHaveLength(3);for(const command of commands)expect(command).toEqual(commands[0]);
  });
  it("rejects repeated role cursors without retaining an actionable partial page",async()=>{
    let n=0;const m=mount(request=>request.path.includes("role-members")?{status:200,body:{members:[{...role,principalId:`person-${n++}`}],nextCursor:"repeat"}}:browse(request),<MembersPane workspaceId="workspace"/>);
    const host=await m.render();await settle();
    expect(host.querySelector('button[aria-label="Actions for Ada"]')).toBeNull();
    expect(host.textContent).toContain("result is unknown");
    expect(n).toBe(2);
  });
  it("retains an unknown invitation across the original dialog closing and retries only its original key",async()=>{
    const m=mount(request=>{if(request.method==="POST")throw new TransportError("response lost");return {status:200,body:[]};},<TenantInvitations dialog/>);
    const host=await m.render();await settle();await click(button(host,"Invite organization member"));
    await type(document.querySelector<HTMLInputElement>('input[name="inviteeLabel"]')!,"Ada");
    await act(async()=>document.querySelector('form')!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));await settle();
    await click(button(document.body,"Close"));await click(button(host,"Invite organization member"));
    expect(document.querySelector<HTMLInputElement>('input[name="inviteeLabel"]')!.value).toBe("Ada");
    await act(async()=>document.querySelector('form')!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));await settle();
    const commands=m.send.mock.calls.filter(([request])=>request.method==="POST").map(([request])=>request.body);
    expect(commands).toHaveLength(2);expect(commands[1]).toEqual(commands[0]);
  });
});
