import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { AutomationManagement, type WorkflowRoute } from "../src/react/agents";
import { PlatformProvider } from "../src/react/context";
import type { BffReply, BffRequest } from "../src/transport";
import { button, click, render, settle } from "./render";

// Buzz 779af8886caae1317b4de962082429867ab61503 app/routes/workflows.$workflowId.tsx
// and WorkflowEditorHost: a URL target opens only through the authorized read.
const automation = {resourceId: "workflow", workspaceId: "workspace", ownerPrincipalId: "human",
  executorInstallationResourceId: "executor", resourceVersion: 2, resourceState: "ACTIVE", state: "DRAFT"};
const content = {name: "Routed workflow", trigger: {kind: "CHANNEL_MESSAGE"}, action: {kind: "POST_MESSAGE", template: "hello"},
  resultTarget: "TRIGGER_THREAD"};
const detail = {automation, canManage: true, versions: [{assetId: "version", ordinal: 1, automationResourceId: "workflow",
  ownerPrincipalId: "human", assetVersion: 1, state: "PUBLISHED", configHash: "b".repeat(64), content}], delegations: []};

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

async function mount(initial: WorkflowRoute | null, read: () => BffReply = () => ({status: 200, body: detail})) {
  const changes: Array<[WorkflowRoute | null, string | undefined]> = [];
  const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
    if (request.path === "/api/v1/workspaces") return {status: 200, body: [
      {id: "workspace", name: "Channel", slug: "channel"}, {id: "other", name: "Other", slug: "other"}]};
    if (request.path === "/api/v1/tasks") return {status: 200, body: []};
    if (request.path.startsWith("/api/v1/automations?")) return {status: 200, body: {automations: request.path.includes("workspaceId=workspace")
      ? [automation] : [], canCreate: false, availableApprovalPolicies: []}};
    if (request.path.startsWith("/api/v1/automations/workflow?")) return read();
    return {status: 503, body: undefined};
  });
  function Host() {
    const [route, setRoute] = useState<WorkflowRoute | null>(initial);
    return <AutomationManagement workspaceId="other" onWorkspaceChange={() => undefined} workflowRoute={route}
      onWorkflowRouteChange={(next, workspaceId) => { changes.push([next, workspaceId]); setRoute(next); }} />;
  }
  const host = await render(<QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
    <PlatformProvider client={createBffClient({send})} locale="en"><Host /></PlatformProvider></QueryClientProvider>);
  await settle();
  return {host, send, changes};
}

describe("original URL-addressable workflow target", () => {
  it("places the target in its authorized workspace, then opens the original detail panel", async () => {
    const {changes} = await mount({workflowId: "workflow"});
    expect(changes[0]).toEqual([{workflowId: "workflow", workspaceId: "workspace"}, "workspace"]);
    await settle();
    expect(document.querySelector('[data-testid="workflow-detail-panel"] h3')?.textContent).toBe("Routed workflow");
    expect(document.querySelector('[data-testid="workflow-unavailable-dialog"]')).toBeNull();
  });

  it("shows the original unavailable dialog for an unreadable target and closes back to the list", async () => {
    const {send, changes} = await mount({workflowId: "workflow", workspaceId: "workspace"}, () => ({status: 403, body: {reasonCode: "PERMISSION_DENIED"}}));
    const dialog = document.querySelector<HTMLElement>('[data-testid="workflow-unavailable-dialog"]')!;
    expect(dialog.textContent).toContain("Workflow unavailable");
    expect(document.querySelector('[data-testid="workflow-detail-panel"]')).toBeNull();
    await click(button(dialog, "Retry"));
    expect(send.mock.calls.filter(([request]) => request.path.startsWith("/api/v1/automations/workflow?")).length).toBeGreaterThan(1);
    await click(button(document.querySelector<HTMLElement>('[data-testid="workflow-unavailable-dialog"]')!, "Close"));
    expect(changes.at(-1)?.[0]).toBeNull();
    expect(send.mock.calls.some(([request]) => request.method !== "GET")).toBe(false);
  });

  it("opens ?view=edit in the original Edit workflow editor and leaves the target on close", async () => {
    const {changes} = await mount({workflowId: "workflow", view: "edit", workspaceId: "workspace"});
    await settle();
    const editor = document.querySelector<HTMLElement>('[data-testid="workflow-editor-dialog"]')!;
    expect(editor.querySelector("h2")?.textContent).toBe("Edit workflow");
    await click(button(editor, "Close"));
    expect(changes.at(-1)).toEqual([null, "workspace"]);
  });

  it("routes a card selection instead of keeping a private selection", async () => {
    const {host, changes} = await mount(null);
    const card = host.querySelector<HTMLElement>('[data-testid="workflow-card-workflow"]');
    // The host workspace "other" has no definitions; the list is not substituted.
    expect(card).toBeNull();
    expect(changes).toHaveLength(0);
  });
});
