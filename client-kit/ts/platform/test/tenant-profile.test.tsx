import { describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { TenantProfileDialog } from "../src/react/tenant-profile/TenantProfileDialog";
import { TransportError, type BffRequest } from "../src/transport";
import { button, click, render, settle, type } from "./render";
const receipt={actionKey:"tenant.profile.update",actionExecutionId:"ae-1",operationId:"op-1",gateState:"ALLOWED",dispatchState:"DISPATCHED"};
describe("DD-158 actual shared Tenant profile consumer",()=>{
 it("reads as a member but offers no administrator write",async()=>{
  const send=vi.fn(async (_r:BffRequest)=>({status:200,body:{name:"Community",version:3,icon:"🎉"}}));
  await render(<PlatformProvider client={createBffClient({send})} locale="en"><TenantProfileDialog open onOpenChange={()=>{}}/></PlatformProvider>);await settle();
  const dialog=document.querySelector<HTMLElement>('[data-testid="tenant-profile-dialog"]')!;
  expect(dialog.textContent).toContain("Only community administrators");
  expect(dialog.querySelector<HTMLInputElement>('[data-testid="tenant-profile-name"]')!.disabled).toBe(true);
  expect(dialog.querySelector('button[type="submit"]')).toBeNull();
  expect(send).toHaveBeenCalledTimes(1);
 });
 it("confirms the displayed version and retries a lost result with the same frozen command",async()=>{
  const sent:BffRequest[]=[];let saved=false;
  const send=vi.fn(async (r:BffRequest)=>{
   if(r.method==="GET")return {status:200,body:{name:saved?"After":"Before",version:saved?4:3,icon:"🎉",updateActionKey:"tenant.profile.update"}};
   sent.push(structuredClone(r));if(sent.length===1)throw new TransportError("lost");saved=true;return {status:200,body:receipt};
  });
  await render(<PlatformProvider client={createBffClient({send})} locale="en"><TenantProfileDialog open onOpenChange={()=>{}}/></PlatformProvider>);await settle();
  const dialog=document.querySelector<HTMLElement>('[data-testid="tenant-profile-dialog"]')!;
  const name=dialog.querySelector<HTMLInputElement>('[data-testid="tenant-profile-name"]')!;
  await type(name,"After");expect(button(dialog,"Save profile").disabled).toBe(true);
  await click(dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  await click(button(dialog,"Save profile"));expect(name.disabled).toBe(true);
  await click(button(dialog,"Retry the same change"));await settle();
  expect(sent).toHaveLength(2);expect(sent[0]).toEqual(sent[1]);
  expect(sent[0]).toMatchObject({method:"POST",path:"/api/v1/actions",body:{resourceVersion:3,explicitConfirmation:true,tenantProfile:{name:"After"}}});
  expect(name.value).toBe("After");expect(name.disabled).toBe(false);
 });
 it("requires a fresh profile after a definite conflict",async()=>{
  const send=vi.fn(async (r:BffRequest)=>r.method==="GET"?{status:200,body:{name:"Before",version:3,updateActionKey:"tenant.profile.update"}}:{status:409,body:{}});
  await render(<PlatformProvider client={createBffClient({send})} locale="en"><TenantProfileDialog open onOpenChange={()=>{}}/></PlatformProvider>);await settle();
  const dialog=document.querySelector<HTMLElement>('[data-testid="tenant-profile-dialog"]')!;
  await type(dialog.querySelector<HTMLInputElement>('[data-testid="tenant-profile-name"]')!,"After");
  await click(dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!);await click(button(dialog,"Save profile"));
  await click(dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  expect(button(dialog,"Save profile").disabled).toBe(true);
  await click(button(dialog,"Refresh current profile"));await settle();
  expect(dialog.querySelector<HTMLInputElement>('[data-testid="tenant-profile-name"]')!.value).toBe("Before");
 });
});
