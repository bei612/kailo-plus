// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BffError, TransportError } from "@client-kit/platform/transport";
import { useMessageReactions } from "./useMessageReactions";
import type { BuzzEvent } from "../bff-client";
const state=vi.hoisted(()=>({publish:vi.fn()}));
vi.mock("@/platform/bff-client",()=>({bff:{profile:async()=>({pubkey:"c".repeat(64)}),customEmoji:async()=>({events:[],mediaPaths:{}})},publishMessageReaction:(...args:unknown[])=>state.publish(...args)}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const id="a".repeat(64), own="c".repeat(64), reactionId="b".repeat(64);
const message={id,author:"Author",pubkey:own,body:"",time:"",depth:0,createdAt:10};
const event=(id:string,kind:number,content="",pubkey=own,tags:string[][]=[]):BuzzEvent=>({id,kind,content,pubkey,tags,created_at:10});
let events:BuzzEvent[],root:Root,host:HTMLDivElement,query:QueryClient;
let current:ReturnType<typeof useMessageReactions>;
function Probe({scope="workspace",conversationId,available=true}:{scope?:string;conversationId?:string;available?:boolean}) {
  current=useMessageReactions({principalId:"human",workspaceId:scope,conversationId,events,available});return null;
}
async function render(props:Parameters<typeof Probe>[0]={}) {
  await act(async()=>{root.render(<QueryClientProvider client={query}><Probe {...props}/></QueryClientProvider>);});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
}
beforeEach(()=>{localStorage.clear();state.publish.mockReset();state.publish.mockResolvedValue({eventId:"d".repeat(64),operationId:"op"});events=[event(id,9)];query=new QueryClient({defaultOptions:{queries:{retry:false}}});host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());query.clear();host.remove();vi.restoreAllMocks();});
it("uses the original signed reaction projection and removes only the actor's actual kind7 events",async()=>{
  events.push(event(reactionId,7,"👍",own,[["e",id]]),event("e".repeat(64),7,"👍","f".repeat(64),[["e",id]]));
  await render();expect(current.reactions.get(id)?.[0]).toMatchObject({count:2,reactedByCurrentUser:true});
  await act(async()=>current.onToggleReaction!(message,"👍",true));
  expect(state.publish).toHaveBeenCalledWith("workspace",undefined,{operation:"UNLIKE",content:"",targetEventId:reactionId},expect.any(String));
  expect(localStorage.length).toBe(0);
});
it("retains the exact pending request/key across a full hook and QueryClient remount",async()=>{
  state.publish.mockRejectedValueOnce(new TransportError("lost receipt"));await render();
  await act(async()=>{await expect(current.onToggleReaction!(message,"👍",false)).rejects.toBeInstanceOf(TransportError);});
  const frozen=state.publish.mock.calls[0];expect(localStorage.length).toBe(1);
  await act(async()=>root.unmount());query.clear();query=new QueryClient();root=createRoot(host);
  state.publish.mockRejectedValueOnce(new BffError(403,"later refused"));await render();
  await act(async()=>{await expect(current.onToggleReaction!(message,"👍",false)).rejects.toBeInstanceOf(TransportError);});
  expect(state.publish.mock.calls[1]).toEqual(frozen);expect(localStorage.length).toBe(1);
  await act(async()=>current.onToggleReaction!(message,"👍",false));
  expect(state.publish.mock.calls[2]).toEqual(frozen);expect(localStorage.length).toBe(0);
});
it("does not treat an ACK without event evidence as confirmed",async()=>{
  state.publish.mockResolvedValueOnce({operationId:"op"});await render();
  await act(async()=>{await expect(current.onToggleReaction!(message,"👍",false)).rejects.toBeInstanceOf(TransportError);});
  expect(localStorage.length).toBe(1);
});
it("resumes a partially confirmed duplicate-reaction removal without repeating the confirmed command",async()=>{
  const second="e".repeat(64);
  events.push(event(reactionId,7,"👍",own,[["e",id]]),event(second,7,"👍",own,[["e",id]]));
  state.publish.mockResolvedValueOnce({eventId:"d".repeat(64),operationId:"op"}).mockRejectedValueOnce(new TransportError("lost second receipt"));
  await render();
  await act(async()=>{await expect(current.onToggleReaction!(message,"👍",true)).rejects.toBeInstanceOf(TransportError);});
  const frozenSecond=state.publish.mock.calls[1];
  await act(async()=>root.unmount());query.clear();query=new QueryClient();root=createRoot(host);await render();
  await act(async()=>current.onToggleReaction!(message,"👍",true));
  expect(state.publish).toHaveBeenCalledTimes(3);
  expect(state.publish.mock.calls[2]).toEqual(frozenSecond);expect(localStorage.length).toBe(0);
});
it("does not execute a new opposite command while reconciling a pre-reload intent",async()=>{
  state.publish.mockRejectedValueOnce(new TransportError("lost receipt"));await render();
  await act(async()=>{await expect(current.onToggleReaction!(message,"👍",false)).rejects.toThrow();});
  events.push(event(reactionId,7,"👍",own,[["e",id]]));await render();
  await act(async()=>{await expect(current.onToggleReaction!(message,"👍",true)).rejects.toBeInstanceOf(BffError);});
  expect(state.publish.mock.calls[1]).toEqual(state.publish.mock.calls[0]);expect(localStorage.length).toBe(0);
  await act(async()=>current.onToggleReaction!(message,"👍",true));
  expect(state.publish.mock.calls[2]?.[2]).toEqual({operation:"UNLIKE",targetEventId:reactionId,content:""});
});
it("refuses non-durable intent storage before sending and does not offer archived actions",async()=>{
  await render();vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("unavailable");});
  await act(async()=>{await expect(current.onToggleReaction!(message,"👍",false)).rejects.toThrow();});
  expect(state.publish).not.toHaveBeenCalled();await render({available:false});expect(current.onToggleReaction).toBeUndefined();
});
it("uses the conversation route scope and rejects obsolete scope callbacks",async()=>{
  await render({conversationId:"dm"});const previous=current.onToggleReaction!;
  await act(async()=>previous(message,"👍",false));expect(state.publish.mock.calls[0]?.slice(0,2)).toEqual(["workspace","dm"]);
  await render({scope:"other"});await act(async()=>{await expect(previous(message,"👍",false)).rejects.toBeInstanceOf(BffError);});
  expect(state.publish).toHaveBeenCalledTimes(1);
});
