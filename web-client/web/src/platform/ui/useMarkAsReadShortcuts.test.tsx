// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PlatformSessionAccessMode, type PlatformSessionView, type ReadMarkRequest } from "@client-kit/contracts";
import { createBffClient } from "@client-kit/platform/client";
import { TransportError, type BffRequest } from "@client-kit/platform/transport";
import { useInboxState } from "@client-kit/platform/react/use-inbox-state";
import { loadReadShortcutContexts, useWebMarkAsReadShortcuts } from "./useMarkAsReadShortcuts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const session: PlatformSessionView = { accessMode: PlatformSessionAccessMode.Full, displayName: "Person", humanIdentityId: "human",
  platformSessionId: "session", tenantId: "tenant", tenantMembershipId: "membership", tenantPrincipalId: "principal" };
const conversation = { id: "conversation", channelId: "dm-native", state: "ACTIVE", participantPrincipalIds: ["principal", "other"] };
const page = (channel: string, seconds = 20) => ({ events: [
  {id:"a".repeat(64),pubkey:"b".repeat(64),kind:9,created_at:seconds,content:"actual message",tags:[["h",channel]]},
  {id:"c".repeat(64),pubkey:"d".repeat(64),kind:39006,created_at:90,content:JSON.stringify({has_more:false,next_cursor:null}),tags:[["h",channel],["d",`${channel}:head`]]},
] });
function source() {
  const state = { member: true, channel: "workspace-native", type: "stream", active: true, identity: session, empty: false,
    writeUnknown: false, version: 0, streamAt: 20, dmAt: 30, readContexts: {} as Record<string,string>,
    messageGate: null as Promise<void>|null, beforeMessages: () => {}, afterMessages: () => {}, writes: [] as ReadMarkRequest[] };
  const send = vi.fn(async (request: BffRequest) => {
    let body: unknown;
    if (request.path === "/api/v1/session") body = state.identity;
    else if (request.path === "/api/v1/workspaces") body = [{ id: "workspace", isMember: state.member }];
    else if (request.path === "/api/v1/conversations") body = {items:state.active?[conversation]:[]};
    else if (request.path === "/api/v1/workspaces/workspace/channel") body = { channelId:state.channel,channelType:state.type,name:"Actual",archived:false };
    else if (request.path.endsWith("/messages")) {
      state.beforeMessages();
      await state.messageGate;
      body = state.empty ? page(request.path.includes("/workspaces/") ? state.channel : conversation.channelId, 20) :
        page(request.path.includes("/workspaces/") ? state.channel : conversation.channelId, request.path.includes("/workspaces/") ? state.streamAt : state.dmAt);
      if (state.empty) (body as ReturnType<typeof page>).events.shift();
      state.afterMessages();
    } else if (request.path === "/api/v1/user-state") body = {version:state.version,workspacePreferences:{},readContexts:{...state.readContexts}};
    else if (request.path === "/api/v1/user-state/read") {
      const mark = request.body as ReadMarkRequest;
      state.writes.push(mark);
      if (state.writeUnknown) throw new TransportError("ACK missing");
      expect(mark.version).toBe(state.version);
      state.readContexts[mark.contextKey] = mark.lastReadAt;
      body = {version:++state.version};
    } else throw new Error(`Unexpected request ${request.path}`);
    return {status:200,body};
  });
  return {state,send,client:createBffClient({send})};
}
afterEach(() => vi.restoreAllMocks());
it("reads real stream/DM windows and uses native channel IDs, never Workspace IDs or metadata timestamps", async () => {
  const {client} = source();
  expect(await loadReadShortcutContexts(client,session,null,()=>true)).toEqual([
    {key:"workspace-native",seconds:20},{key:"dm-native",seconds:30},
  ]);
});
it.each(["revoked", "conversation-closed", "identity", "binding", "scope"])("refuses changed %s before any CAS write", async kind => {
  const {client,state} = source();
  let valid = true;
  state.afterMessages = () => {
    if (kind === "revoked") state.member = false;
    if (kind === "conversation-closed") state.active = false;
    if (kind === "identity") state.identity = {...session,platformSessionId:"replacement"};
    if (kind === "binding") state.channel = "replacement-native";
    if (kind === "scope") valid = false;
  };
  await expect(loadReadShortcutContexts(client,session,null,()=>valid)).rejects.toThrow();
  expect(state.writes).toEqual([]);
});
it("does not invent a read timestamp for an empty window or a forum's incomplete activity", async () => {
  const {client,state} = source();
  state.empty = true;
  expect(await loadReadShortcutContexts(client,session,null,()=>true)).toEqual([]);
  state.type = "forum";
  await expect(loadReadShortcutContexts(client,session,null,()=>true)).rejects.toThrow("activity unavailable");
  expect(state.writes).toEqual([]);
});
it("routes actual Escape and Shift+Escape through the shared CAS writer; UNKNOWN cannot replay", async () => {
  const {client,state} = source();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const error = vi.fn();
  let replace!: () => void;
  function Host() {
    const reads = useInboxState(client);
    const [scope,setScope] = useState("workspace");
    replace = () => setScope("replacement");
    useWebMarkAsReadShortcuts({client,session,reads,workspaceId:scope,conversationId:null,disabled:false,onError:error});
    return <div data-ready={reads.state!==null} data-unknown={reads.unknown} />;
  }
  const press = async (shiftKey = false) => {
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",shiftKey,cancelable:true})); });
    for (let index=0;index<5;index++) await act(async()=>{});
  };
  try {
    await act(async () => root.render(<Host />));
    expect(host.querySelector('[data-ready="true"]')).not.toBeNull();
    await press();
    expect(state.writes).toEqual([{contextKey:"workspace-native",lastReadAt:"1970-01-01T00:00:20.000Z",version:0}]);
    await press(true);
    expect(state.writes).toHaveLength(2);
    expect(state.writes[1]).toEqual({contextKey:"dm-native",lastReadAt:"1970-01-01T00:00:30.000Z",version:1});
    state.writeUnknown = true;
    state.streamAt = 40;
    await act(async () => window.dispatchEvent(new Event("focus")));
    await press();
    expect(host.querySelector('[data-unknown="true"]')).not.toBeNull();
    const attempts = state.writes.length;
    await press(); await press(true);
    expect(state.writes).toHaveLength(attempts);
    await act(async () => replace());
    await press();
    expect(state.writes).toHaveLength(attempts);
  } finally { await act(async()=>root.unmount()); host.remove(); }
});
it("fences an in-flight original shortcut when its authenticated view leaves", async () => {
  const {client,state} = source();
  const host = document.createElement("div");
  const root = createRoot(host);
  let replace!: () => void, release!: () => void;
  const error = vi.fn();
  function Host() {
    const reads = useInboxState(client);
    const [workspaceId,setWorkspaceId] = useState("workspace");
    replace = () => setWorkspaceId("replacement");
    useWebMarkAsReadShortcuts({client,session,reads,workspaceId,conversationId:null,disabled:false,onError:error});
    return null;
  }
  try {
    await act(async () => root.render(<Host />));
    state.messageGate = new Promise<void>(resolve => {release=resolve;});
    await act(async () => {window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",cancelable:true}));});
    await act(async () => replace());
    await act(async () => release());
    expect(state.writes).toEqual([]);
    expect(error).not.toHaveBeenCalled();
  } finally { await act(async()=>root.unmount()); host.remove(); }
});
