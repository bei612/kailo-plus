import { act } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { NewMessageScreen } from "../src/react/new-message";
import { TransportError, type BffRequest } from "../src/transport";
import { button, click, render, settle } from "./render";

const alice = { principalId: "alice", displayName: "Alice", pubkeys: ["a".repeat(64)] };
const bob = { principalId: "bob", displayName: "Bob", pubkeys: ["b".repeat(64)] };
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
async function keyboard(input: HTMLElement, key: string) {
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });
  await settle();
}
function setup({unknown = false, active = true, maxParticipants = 9} = {}) {
  let ready = active;
  let writes = 0;
  const onReady = vi.fn();
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
  return {transport, onReady, activate: () => { ready = true; }, mount: () => render(
    <PlatformProvider client={createBffClient(transport)} locale="en">
      <NewMessageScreen currentPrincipalId="alice" renderComposer={(host) => <button disabled={host.disabled}
        onClick={() => void host.prepareConversation().then(onReady).catch(() => undefined)}>Send retained draft</button>} />
    </PlatformProvider>)};
}
describe("shared original new-message surface", () => {
  it("keeps the original keyboard recipient selection and removable chips", async () => {
    const {mount} = setup();
    const host = await mount();
    const input = host.querySelector<HTMLInputElement>("#new-dm-search")!;
    expect(document.querySelector("[data-testid=new-dm-result-alice]")).toBeNull();
    expect(document.querySelector("[data-testid=new-dm-result-bob]")).not.toBeNull();
    await keyboard(input, "Enter");
    expect(host.querySelector("[data-testid=new-dm-selected-bob]")).not.toBeNull();
    expect(button(host, "Send retained draft").disabled).toBe(false);
    await keyboard(input, "Backspace");
    expect(host.querySelector("[data-testid=new-dm-selected-bob]")).toBeNull();
    expect(button(host, "Send retained draft").disabled).toBe(true);
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
});
