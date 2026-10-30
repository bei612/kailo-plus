// DD-168(2): members being removed wait for ownership transfers; each goes through the
// governed resource.transfer_owner with a member picked by name.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { OwnerTransfersPanel } from "../src/react/owner-transfers";
import type { BffReply, BffRequest } from "../src/transport";
import { button, click, render, settle } from "./render";

const pubkey = "a".repeat(64);
const leaving = "leaving-member";
const page = { truncated: false, members: [{ principalId: leaving, displayName: "Qian Li", membershipState: "REVOKING", truncated: false, items: [
  { resourceId: "definition-1", typeKey: "agent.definition", name: "Research assistant", state: "ACTIVE", resourceVersion: 4,
    resourceOwnerPrincipalId: leaving, ownedResource: true, assetCount: 2, transferable: true },
  { resourceId: "automation-1", typeKey: "automation", name: "Weekly digest", homeWorkspaceId: "ws", homeWorkspaceName: "Release",
    state: "ACTIVE", resourceVersion: 2, resourceOwnerPrincipalId: leaving, ownedResource: true, assetCount: 1,
    transferable: false, blockReason: "AUTOMATION_ENABLED" },
  { resourceId: "definition-2", typeKey: "agent.definition", name: "Writing assistant", state: "ACTIVE", resourceVersion: 7,
    resourceOwnerPrincipalId: "owner-b", ownedResource: false, assetCount: 1, transferable: true },
] }] };
const people = [
  { principalId: "owner-b", displayName: "Zhao Min", pubkeys: [pubkey] },
  { principalId: "owner-c", displayName: "An Qi", pubkeys: ["b".repeat(64)] },
];

function fixture(extra?: (request: BffRequest) => BffReply | undefined) {
  const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
    const override = extra?.(request);
    if (override) return override;
    if (request.path === "/api/v1/owner-transfers") return { status: 200, body: page };
    if (request.path === "/api/v1/conversation-participants") return { status: 200, body: { items: people, maxParticipants: 8 } };
    if (request.method === "POST") return { status: 202, body: { actionKey: "resource.transfer_owner", actionExecutionId: "ae",
      operationId: "op", gateState: "WAITING", dispatchState: "NOT_DISPATCHED", approvalWorkflowId: "approval" } };
    return { status: 404, body: {} };
  });
  return { send, client: createBffClient({ send }) };
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

describe("ownership transfers (DD-168(2))", () => {
  it("lists what still blocks a member's removal and why", async () => {
    const f = fixture();
    await render(<PlatformProvider client={f.client} locale="en"><OwnerTransfersPanel /></PlatformProvider>);
    await settle();
    const member = document.querySelector<HTMLElement>(`[data-testid="owner-transfers-${leaving}"]`)!;
    expect(member.textContent).toContain("Removing · 3 to transfer");
    const automation = document.querySelector<HTMLElement>('[data-testid="owner-transfer-item-automation-1"]')!;
    expect(automation.textContent).toContain("In Release");
    expect(automation.textContent).toContain("Pause or disable this workflow first");
    expect(automation.querySelector("button")).toBeNull();
    const left = document.querySelector<HTMLElement>('[data-testid="owner-transfer-item-definition-2"]')!;
    expect(left.textContent).toContain("Resource owner: Zhao Min");
    expect(left.textContent).not.toContain("owner-b");
  });

  it("transfers an owned resource to a member chosen by name and points to approvals", async () => {
    const f = fixture();
    const approvals = vi.fn();
    await render(<PlatformProvider client={f.client} locale="en"><OwnerTransfersPanel onOpenApprovals={approvals} /></PlatformProvider>);
    await settle();
    await click(button(document.querySelector<HTMLElement>('[data-testid="owner-transfer-item-definition-1"]')!, "Transfer to…"));
    const form = document.querySelector<HTMLElement>('[data-testid="owner-transfer-form"]')!;
    expect(form.querySelector("input")).toBeNull();
    const trigger = form.querySelector<HTMLButtonElement>("button")!;
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await settle();
    const options = [...document.querySelectorAll<HTMLElement>("[role=menuitemradio]")];
    expect(options.map((option) => option.textContent)).toEqual(["An Qi", "Zhao Min"]);
    await click(options[0]!);
    await click(button(form, "Submit for approval"));
    const post = f.send.mock.calls.map(([request]) => request).find((request) => request.method === "POST");
    expect(post?.body).toMatchObject({ actionKey: "resource.transfer_owner", resourceId: "definition-1", resourceVersion: 4, principalId: "owner-c" });
    expect(form.textContent).toContain("Waiting for approval.");
    await click(button(form, "Go to Approvals"));
    expect(approvals).toHaveBeenCalledOnce();
  });

  it("returns left-behind versions to the resource's current owner without a picker", async () => {
    const f = fixture();
    await render(<PlatformProvider client={f.client} locale="en"><OwnerTransfersPanel /></PlatformProvider>);
    await settle();
    await click(button(document.querySelector<HTMLElement>('[data-testid="owner-transfer-item-definition-2"]')!, "Return to resource owner"));
    const form = document.querySelector<HTMLElement>('[data-testid="owner-transfer-form"]')!;
    expect(form.textContent).toContain("New owner: Zhao Min");
    await click(button(form, "Submit for approval"));
    const post = f.send.mock.calls.map(([request]) => request).find((request) => request.method === "POST");
    expect(post?.body).toMatchObject({ resourceId: "definition-2", resourceVersion: 7, principalId: "owner-b" });
  });

  it("tells a non-administrator the section is for administrators", async () => {
    const f = fixture((request) => request.path === "/api/v1/owner-transfers" ? { status: 403, body: { class: "DENIED", reason: "PERMISSION_DENIED" } } : undefined);
    await render(<PlatformProvider client={f.client} locale="en"><OwnerTransfersPanel /></PlatformProvider>);
    await settle();
    expect(document.querySelector('[data-testid="owner-transfers"]')?.textContent)
      .toContain("Only organization administrators can see ownership transfers.");
  });
});
