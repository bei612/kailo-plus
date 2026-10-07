import { act, useState } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../src/i18n";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { NewMessageScreen, ConversationList, ConversationVisibilityProvider, hiddenConversationChannels, DM_VISIBILITY_KIND } from "../src/react/new-message";
import { conversationNotificationMutes } from "../src/inbox";
import { useConversationState } from "../src/react/conversations/use-conversation-state";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { ItemState, type ConversationView } from "@client-kit/contracts";
import { TransportError, type BffRequest } from "../src/transport";
import { button, click, render, settle } from "./render";
import { reopenHiddenInboxConversation, type HiddenDmInboxIntent } from "../src/react/conversations/hidden-dm-inbox-action";
import { useHiddenDmInboxNavigation } from "../src/react/conversations/use-hidden-dm-inbox-navigation";

const alice = { principalId: "alice", displayName: "Alice", pubkeys: ["a".repeat(64)] };
const bob = { principalId: "bob", displayName: "Bob", pubkeys: ["b".repeat(64)] };
beforeEach(() => setLocale("en"));
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});

describe("original hidden DM Inbox navigation", () => {
  const conversation: ConversationView = {id:"existing-dm",channelId:"native-dm",participantPrincipalIds:["alice","bob"],state:ItemState.Active,operationId:"op",version:1};
  it("reopens the exact binding, retains the same uncertain publication, and never creates a DM",async()=>{
    const send=vi.fn(async(_request:BffRequest)=>({status:200,body:{items:[conversation]}}));
    const client=createBffClient({send}); const intent:HiddenDmInboxIntent={};
    const publish=vi.fn().mockRejectedValueOnce(new TransportError("lost receipt")).mockResolvedValue(undefined);
    const host={read:vi.fn(async()=>new Set([conversation.channelId])),prepare:vi.fn(async()=>publish)};
    await expect(reopenHiddenInboxConversation({conversation,client,host,intent,isCurrent:()=>true})).rejects.toThrow("lost receipt");
    expect(intent.publish).toBe(publish);
    expect(await reopenHiddenInboxConversation({conversation,client,host,intent,isCurrent:()=>true})).toEqual(conversation);
    expect(host.prepare).toHaveBeenCalledTimes(1); expect(publish).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.every(call => (call[0] as BffRequest | undefined)?.method === "GET")).toBe(true);
    await reopenHiddenInboxConversation({conversation,client,host,intent,isCurrent:()=>true});
    expect(publish).toHaveBeenCalledTimes(2);
  });
  it("observes an already reopened conversation without replay and rejects changed or revoked binding",async()=>{
    let items=[conversation]; const client=createBffClient({send:async()=>({status:200,body:{items}})});
    const publish=vi.fn(); const intent:HiddenDmInboxIntent={publish,unknown:true};
    const host={read:async()=>new Set<string>(),prepare:vi.fn(async()=>publish)};
    expect(await reopenHiddenInboxConversation({conversation,client,host,intent,isCurrent:()=>true})).toEqual(conversation);
    expect(publish).not.toHaveBeenCalled(); expect(intent.publish).toBeUndefined();
    items=[{...conversation,channelId:"different"}];
    await expect(reopenHiddenInboxConversation({conversation,client,host,intent,isCurrent:()=>true})).rejects.toThrow("admission");
    items=[];
    await expect(reopenHiddenInboxConversation({conversation,client,host,intent,isCurrent:()=>true})).rejects.toThrow("admission");
    expect(host.prepare).not.toHaveBeenCalled();
  });
  it("fences scope change while the original directory or signer is preparing",async()=>{
    let current=true;
    const send=vi.fn(async()=>{current=false;return {status:200,body:{items:[conversation],nextCursor:"old-identity-cursor"}};});
    const client=createBffClient({send});
    const host={read:vi.fn(async()=>new Set([conversation.channelId])),prepare:vi.fn(async()=>vi.fn())};
    expect(await reopenHiddenInboxConversation({conversation,client,host,intent:{},isCurrent:()=>current})).toBeNull();
    expect(host.read).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    current=true;
    const fresh=createBffClient({send:async()=>({status:200,body:{items:[conversation]}})});
    const publish=vi.fn(); host.prepare=vi.fn(async()=>{current=false;return publish;});
    expect(await reopenHiddenInboxConversation({conversation,client:fresh,host,intent:{},isCurrent:()=>current})).toBeNull();
    expect(publish).not.toHaveBeenCalled();
  });
  it("mounts the original pending guard and navigates to the selected message only after confirmed reopen",async()=>{
    let done!:()=>void; const publication=new Promise<void>(resolve=>{done=resolve;});
    const publish=vi.fn(()=>publication); const prepare=vi.fn(async()=>publish); const open=vi.fn().mockRejectedValueOnce(new Error("navigation interrupted")).mockResolvedValue(undefined);
    const client=createBffClient({send:async()=>({status:200,body:{items:[conversation]}})});
    function InboxOpen(){const dm=useHiddenDmInboxNavigation({scopeKey:"alice",conversations:[conversation],onOpenContext:open,onError:vi.fn()});return <button disabled={dm.isReopenPending("native-dm")} onClick={()=>void dm.openContext({channelId:"native-dm",messageId:"selected",threadRootId:"root"})}>Open original</button>;}
    const host=await render(<PlatformProvider client={client}><ConversationVisibilityProvider value={{read:async()=>new Set(["native-dm"]),prepare}}><InboxOpen/></ConversationVisibilityProvider></PlatformProvider>);
    await click(button(host,"Open original")); await settle();
    expect(button(host,"Open original").disabled).toBe(true); expect(open).not.toHaveBeenCalled();
    await act(async()=>done());await settle();
    expect(open).toHaveBeenCalledWith({channelId:"native-dm",messageId:"selected",threadRootId:"root",conversation});
    expect(prepare).toHaveBeenCalledTimes(1);
    await click(button(host,"Open original"));await settle();
    expect(open).toHaveBeenCalledTimes(2);expect(publish).toHaveBeenCalledTimes(1);
  });
  it("does not navigate on a late receipt after the mounted Inbox changes identity",async()=>{
    let done!:()=>void;const pending=new Promise<void>(resolve=>{done=resolve;});const open=vi.fn();
    const client=createBffClient({send:async()=>({status:200,body:{items:[conversation]}})});
    function InboxOpen(){const [scope,setScope]=useState("alice");const dm=useHiddenDmInboxNavigation({scopeKey:scope,conversations:[conversation],onOpenContext:open,onError:vi.fn()});return <><button onClick={()=>void dm.openContext({channelId:"native-dm",messageId:"selected"})}>Open original</button><button onClick={()=>setScope("new-identity")}>Switch</button></>;}
    const host=await render(<PlatformProvider client={client}><ConversationVisibilityProvider value={{read:async()=>new Set(["native-dm"]),prepare:async()=>()=>pending}}><InboxOpen/></ConversationVisibilityProvider></PlatformProvider>);
    await click(button(host,"Open original"));await settle();
    await click(button(host,"Switch"));await act(async()=>done());await settle();
    expect(open).not.toHaveBeenCalled();
  });
});

describe("private conversation user state", () => {
  const items: ConversationView[] = [{id: "conversation", channelId: "native-channel", state: ItemState.Active,
    participantPrincipalIds: ["alice", "bob"], operationId: "operation", version: 1}];
  function StateHarness() {
    const state = useConversationState(items);
    return <><output>{JSON.stringify({ready: state.ready, unknown: state.unknown,
      hidden: state.hidden?.has("native-channel"), preference: state.preferences.conversation})}</output>
      <button disabled={!state.canWrite} onClick={() => state.preference("conversation", {starred: true})}>Star</button>
      <button disabled={!state.canWrite} onClick={() => state.hide(items[0]!)}>Hide</button>
      <button onClick={() => void state.retry()}>Retry state</button></>;
  }
  it("uses Core DM mute for original notification and Inbox consumers, ignoring stale local DM mute", () => {
    const legacy = new Set(["stream", "native-channel"]);
    expect([...conversationNotificationMutes(legacy, ["native-channel"], items, {conversation: {muted: false, starred: false}})]).toEqual(["stream"]);
    expect(conversationNotificationMutes(new Set(), ["native-channel"], items, {conversation: {muted: true, starred: false}}).has("native-channel")).toBe(true);
    expect(conversationNotificationMutes(new Set(), ["native-channel"], items, undefined).has("native-channel")).toBe(true);
    expect(conversationNotificationMutes(new Set(), ["native-channel"], [], {}).has("native-channel")).toBe(true);
    expect([...legacy]).toEqual(["stream", "native-channel"]);
  });
  it("connects the original DM context menu and close button to real preference/visibility adapters", async () => {
    let hidden = false; let muted = false; let version = 0;
    const requests: BffRequest[] = [];
    const client = createBffClient({send: async (request) => {
      requests.push(request);
      if (request.path.startsWith("/api/v1/conversation-participants")) return {status: 200, body: {items: [alice, bob], maxParticipants: 9}};
      if (request.method === "PUT") { muted = true; version++; return {status: 200, body: {version}}; }
      return {status: 200, body: {version, workspacePreferences: {}, conversationPreferences: {conversation: {starred: false, muted}}, readContexts: {}}};
    }});
    const prepare = vi.fn(async () => async () => { hidden = true; });
    const closeSelected = vi.fn();
    const host = await render(<PlatformProvider client={client} locale="en"><ConversationVisibilityProvider value={{read: async () => new Set(hidden ? ["native-channel"] : []), prepare}}>
      <ConversationList currentPrincipalId="alice" items={items} loading={false} error={null} selectedId="conversation" onSelect={() => {}} onNewMessage={() => {}} onReload={() => {}} onCloseSelected={closeSelected} />
    </ConversationVisibilityProvider></PlatformProvider>);
    await settle();
    await act(async () => host.querySelector("li")!.dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, clientX: 1, clientY: 1})));
    const mute = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((item) => item.textContent === "Mute channel")!;
    await click(mute); await settle();
    expect(requests.find((request) => request.method === "PUT")).toMatchObject({path: "/api/v1/user-state/conversations/conversation", body: {muted: true, starred: false, version: 0}});
    expect(host.querySelector("[data-channel-id=native-channel] svg.lucide-bell-off")).not.toBeNull();
    await click(host.querySelector<HTMLButtonElement>("[data-testid=hide-dm-Bob]")!);
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining(items[0]!), true);
    expect(host.querySelector("[data-channel-id=native-channel]")).toBeNull();
    expect(closeSelected).toHaveBeenCalled();
  });
  it("uses the generated conversation preference endpoint and Core CAS, not Workspace preferences", async () => {
    let version = 2;
    let starred = false;
    const requests: BffRequest[] = [];
    const client = createBffClient({send: async (request) => {
      requests.push(request);
      if (request.method === "PUT") {
        expect(request.path).toBe("/api/v1/user-state/conversations/conversation");
        expect(request.body).toEqual({starred: true, muted: false, version: 2});
        starred = true; version++;
        return {status: 200, body: {version}};
      }
      return {status: 200, body: {version, workspacePreferences: {}, conversationPreferences: {conversation: {starred, muted: false}}, readContexts: {}}};
    }});
    const host = await render(<PlatformProvider client={client}><ConversationVisibilityProvider value={{read: async () => new Set(), prepare: async () => async () => {}}}><StateHarness /></ConversationVisibilityProvider></PlatformProvider>);
    await settle(); await click(button(host, "Star"));
    expect(host.querySelector("output")!.textContent).toContain('"starred":true');
    expect(requests.filter((request) => request.method === "PUT")).toHaveLength(1);
  });
  it("does not hide optimistically and confirms the same publication after UNKNOWN", async () => {
    let hidden = false; let attempts = 0;
    const prepare = vi.fn(async () => async () => {
      attempts++;
      if (attempts === 1) throw new TransportError("unknown");
      hidden = true;
    });
    const client = createBffClient({send: async () => ({status: 200, body: {version: 0, workspacePreferences: {}, conversationPreferences: {}, readContexts: {}}})});
    const host = await render(<PlatformProvider client={client}><ConversationVisibilityProvider value={{read: async () => new Set(hidden ? ["native-channel"] : []), prepare}}><StateHarness /></ConversationVisibilityProvider></PlatformProvider>);
    await settle(); await click(button(host, "Hide"));
    expect(host.querySelector("output")!.textContent).toContain('"unknown":true');
    expect(host.querySelector("output")!.textContent).toContain('"hidden":false');
    expect(button(host, "Star").disabled).toBe(true);
    await click(button(host, "Retry state"));
    expect(prepare).toHaveBeenCalledOnce();
    expect(host.querySelector("output")!.textContent).toContain('"hidden":true');
  });
  it("reads Core CAS after a lost preference ACK without replaying over a newer version", async () => {
    let version = 0; let starred = false; let writes = 0;
    const client = createBffClient({send: async (request) => {
      if (request.method === "PUT") { writes++; version++; starred = true; throw new TransportError("lost ACK"); }
      return {status: 200, body: {version, workspacePreferences: {}, conversationPreferences: {conversation: {starred, muted: false}}, readContexts: {}}};
    }});
    const host = await render(<PlatformProvider client={client}><ConversationVisibilityProvider value={{read: async () => new Set(), prepare: async () => async () => {}}}><StateHarness /></ConversationVisibilityProvider></PlatformProvider>);
    await settle(); await click(button(host, "Star"));
    expect(host.querySelector("output")!.textContent).toContain('"unknown":true');
    await click(button(host, "Retry state"));
    expect(writes).toBe(1);
    expect(host.querySelector("output")!.textContent).toContain('"unknown":false');
    expect(host.querySelector("output")!.textContent).toContain('"starred":true');
  });
  it("accepts only the signed original viewer's NIP-DV snapshot", () => {
    const key = generateSecretKey();
    const event = finalizeEvent({kind: DM_VISIBILITY_KIND, created_at: 1, content: "", tags: [["d", "viewer"], ["p", "viewer"], ["h", "native-channel"]]}, key);
    expect(hiddenConversationChannels([event], {relayPubkey: event.pubkey, viewer: "viewer"}).has("native-channel")).toBe(true);
    expect(() => hiddenConversationChannels([event], {relayPubkey: event.pubkey, viewer: "other"})).toThrow();
    expect(() => hiddenConversationChannels([{...JSON.parse(JSON.stringify(event)), sig: "invalid"}], {relayPubkey: event.pubkey, viewer: "viewer"})).toThrow();
  });
});
async function keyboard(input: HTMLElement, key: string) {
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });
  await settle();
}
function setup({unknown = false, active = true, maxParticipants = 9, hidden = false, reopenUnknown = false} = {}) {
  let ready = active;
  let writes = 0;
  const onReady = vi.fn();
  let reopenAttempts = 0;
  const visibility = { read: vi.fn(async () => new Set(hidden ? ["native-channel"] : [])), prepare: vi.fn(async () => async () => {
    reopenAttempts++;
    if (reopenUnknown && reopenAttempts === 1) throw new TransportError("unknown");
    hidden = false;
  }) };
  const transport = { send: vi.fn(async (request: BffRequest) => {
    if (request.path.startsWith("/api/v1/conversation-participants")) return {status: 200, body: { items: [alice, bob], maxParticipants }};
    if (request.path === "/api/v1/actions") {
      writes++;
      if (unknown && writes === 1) throw new TransportError("connection lost");
      return {status: 202, body: {actionKey: "conversation.open", actionExecutionId: "execution", operationId: "operation", gateState: "ALLOWED", dispatchState: "DISPATCHED"}};
    }
    if (request.path.startsWith("/api/v1/conversations")) return {status: 200, body: {items: [{
      id: "conversation", channelId: "native-channel", state: ready ? "ACTIVE" : "PROVISIONING",
      participantPrincipalIds: ["alice", "bob"], operationId: "operation", version: 1,
    }]}};
    throw new Error(request.path);
  }) };
  return {transport, onReady, visibility, activate: () => { ready = true; }, mount: () => render(
    <PlatformProvider client={createBffClient(transport)} locale="en">
      <ConversationVisibilityProvider value={visibility}>
      <NewMessageScreen currentPrincipalId="alice" renderComposer={(host) => <button disabled={host.disabled} data-recipients={JSON.stringify(host.recipients)}
        onClick={() => void host.prepareConversation().then(onReady).catch(() => undefined)}>Send retained draft</button>} />
      </ConversationVisibilityProvider>
    </PlatformProvider>)};
}
describe("shared original new-message surface", () => {
  it("reopens a hidden native DM and retains its exact pending publication", async () => {
    const {mount, onReady, visibility} = setup({hidden: true, reopenUnknown: true});
    const host = await mount();
    await keyboard(host.querySelector("#new-dm-search")!, "Enter");
    await click(button(host, "Send retained draft"));
    expect(onReady).not.toHaveBeenCalled();
    await click(button(host, "Send retained draft"));
    expect(visibility.prepare).toHaveBeenCalledOnce();
    expect(visibility.prepare).toHaveBeenCalledWith(expect.objectContaining({channelId: "native-channel"}), false);
    expect(onReady).toHaveBeenCalledOnce();
  });
  it("keeps the original keyboard recipient selection and removable chips", async () => {
    const {mount} = setup();
    const host = await mount();
    const input = host.querySelector<HTMLInputElement>("#new-dm-search")!;
    expect(document.querySelector("[data-testid=new-dm-result-alice]")).toBeNull();
    expect(document.querySelector("[data-testid=new-dm-result-bob]")).not.toBeNull();
    await keyboard(input, "Enter");
    expect(host.querySelector("[data-testid=new-dm-selected-bob]")).not.toBeNull();
    expect(button(host, "Send retained draft").disabled).toBe(false);
    expect(JSON.parse(button(host, "Send retained draft").dataset.recipients!)).toEqual([bob]);
    await keyboard(input, "Backspace");
    expect(host.querySelector("[data-testid=new-dm-selected-bob]")).toBeNull();
    expect(button(host, "Send retained draft").disabled).toBe(true);
    expect(JSON.parse(button(host, "Send retained draft").dataset.recipients!)).toEqual([]);
  });
  it("opens the governed human set and returns only actual ACTIVE native channel evidence", async () => {
    const {mount, transport, onReady} = setup();
    const host = await mount();
    await keyboard(host.querySelector("#new-dm-search")!, "Enter");
    await click(button(host, "Send retained draft"));
    const request = transport.send.mock.calls.map(([request]) => request).find((request) => request.method === "POST");
    expect(request?.body).toMatchObject({actionKey: "conversation.open", conversationOpen: {participantPrincipalIds: ["alice", "bob"]}});
    expect(onReady).toHaveBeenCalledWith(expect.objectContaining({state: "ACTIVE", channelId: "native-channel"}));
  });
  it("keeps one action after acceptance while Temporal is still provisioning", async () => {
    const {mount, transport, onReady, activate} = setup({active: false});
    const host = await mount();
    await keyboard(host.querySelector("#new-dm-search")!, "Enter");
    await click(button(host, "Send retained draft"));
    expect(onReady).not.toHaveBeenCalled();
    expect(host.textContent).toContain("being prepared");
    expect(host.querySelector<HTMLInputElement>("#new-dm-search")!.disabled).toBe(true);
    activate();
    await click(button(host, "Send retained draft"));
    expect(onReady).toHaveBeenCalledOnce();
    expect(transport.send.mock.calls.filter(([r]) => r.method === "POST")).toHaveLength(1);
  });
  it("reuses the exact original command after unknown transport outcome", async () => {
    const {mount, transport, onReady} = setup({unknown: true});
    const host = await mount();
    await keyboard(host.querySelector("#new-dm-search")!, "Enter");
    await click(button(host, "Send retained draft"));
    expect(onReady).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Outcome not yet known");
    await click(button(host, "Send retained draft"));
    const writes = transport.send.mock.calls.map(([r]) => r).filter((r) => r.method === "POST");
    expect(writes).toHaveLength(2);
    expect(writes[1]!.body).toEqual(writes[0]!.body);
    expect(onReady).toHaveBeenCalledOnce();
  });
  it("keeps status inspection enabled while recipients are locked and never sends the retained draft", async () => {
    const {mount, transport, onReady, activate, visibility} = setup({active: false, hidden: true});
    const host = await mount();
    await keyboard(host.querySelector("#new-dm-search")!, "Enter");
    await click(button(host, "Send retained draft"));
    expect(button(host, "Check status").disabled).toBe(false);
    await click(button(host, "Check status"));
    expect(host.textContent).toContain("being prepared");
    expect(host.querySelector<HTMLInputElement>("#new-dm-search")!.disabled).toBe(true);
    activate();
    await click(button(host, "Check status"));
    expect(host.textContent).not.toContain("being prepared");
    expect(transport.send.mock.calls.filter(([request]) => request.method === "POST")).toHaveLength(1);
    expect(visibility.prepare).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });
  it("queries UNKNOWN open intent without replaying conversation.open from the status button", async () => {
    const {mount, transport, onReady} = setup({unknown: true, active: false});
    const host = await mount();
    await keyboard(host.querySelector("#new-dm-search")!, "Enter");
    await click(button(host, "Send retained draft"));
    expect(button(host, "Check status").disabled).toBe(false);
    await click(button(host, "Check status"));
    expect(transport.send.mock.calls.filter(([request]) => request.method === "POST")).toHaveLength(1);
    expect(host.textContent).toContain("being prepared");
    expect(onReady).not.toHaveBeenCalled();
  });
});
