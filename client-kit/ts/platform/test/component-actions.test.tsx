import { describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { ComponentActionsPanel, componentActionDocument } from "../src/react/component-actions";
import type { BffReply, BffRequest } from "../src/transport";
import { button, click, render, type } from "./render";

const resource = "123e4567-e89b-42d3-a456-426614174000";
const execution = "123e4567-e89b-42d3-a456-426614174001";
const operation = "123e4567-e89b-42d3-a456-426614174002";
const document = { actionKey: "reference.query", resourceId: resource, resourceVersion: 2,
  componentAction: { actionVersion: 1, resultExposurePolicyId: "123e4567-e89b-42d3-a456-426614174003", resultExposurePolicyVersion: 1,
    inputReference: { resourceId: resource, nativeObjectRef: "original-view:4", nativeRevision: "frozen-revision", displayName: "Query", mediaType: "application/json" } } };

describe("HUMAN component action actual form", () => {
  it.each([
    { ...document, sql: "select private_data" },
    { ...document, resourceId: operation },
    { ...document, resourceVersion: 0 },
    { ...document, componentAction: { ...document.componentAction, inputReference: { ...document.componentAction.inputReference, sql: "select 1" } } },
  ])("rejects body/target substitution before submitting (%j)", async (source) => {
    expect(componentActionDocument(JSON.stringify(source))).toBeNull();
    const send = vi.fn(async (): Promise<BffReply> => ({ status: 500, body: undefined }));
    const host = await render(<PlatformProvider client={createBffClient({ send })} locale="en"><ComponentActionsPanel onOpen={() => {}} /></PlatformProvider>);
    await type(host.querySelector("textarea")!, JSON.stringify(source));
    await click(button(host, "Review action"));
    expect(host.textContent).toContain("Nothing was submitted");
    expect(send).not.toHaveBeenCalled();
  });

  it("reconciles only the frozen key/operation and does not unlock on another operation's denial", async () => {
    const receipts = [
      { actionKey: document.actionKey, actionExecutionId: execution, operationId: operation, gateState: "ALLOWED", dispatchState: "UNKNOWN" },
      { actionKey: document.actionKey, actionExecutionId: execution, operationId: resource, gateState: "DENIED", dispatchState: "NOT_DISPATCHED", reason: "SCOPE_GUARD_FAILED" },
      { actionKey: document.actionKey, actionExecutionId: execution, operationId: operation, gateState: "ALLOWED", dispatchState: "DISPATCHED", workflowId: "original-workflow" },
    ];
    const send = vi.fn(async (_request: BffRequest): Promise<BffReply> => ({ status: 202, body: receipts.shift() }));
    const open = vi.fn();
    const host = await render(<PlatformProvider client={createBffClient({ send })} locale="en"><ComponentActionsPanel onOpen={open} /></PlatformProvider>);
    await type(host.querySelector("textarea")!, JSON.stringify(document));
    await click(button(host, "Review action"));
    await click(button(host, "Confirm"));
    expect(host.querySelector("textarea")!.disabled).toBe(true);
    const retry = () => button(host, "Re-check same request");
    await click(retry());
    expect(host.querySelector("textarea")!.disabled).toBe(true);
    expect(host.textContent).toContain(operation);
    expect(host.textContent).not.toContain("SCOPE_GUARD_FAILED");
    await click(retry());
    expect(host.querySelector("textarea")!.disabled).toBe(false);
    expect(send).toHaveBeenCalledTimes(3);
    const requests = send.mock.calls.map(([request]) => request);
    expect(requests[0]!.method).toBe("POST");
    expect(requests[0]!.path).toBe("/api/v1/actions");
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[2]).toEqual(requests[0]);
    expect(open).not.toHaveBeenCalled();
  });
});
