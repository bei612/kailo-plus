import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { AutomationManagement } from "../src/react/agents";
import { PlatformProvider } from "../src/react/context";
import type { BffReply, BffRequest } from "../src/transport";
import { button, click, render, settle } from "./render";

const automation = {resourceId: "workflow", workspaceId: "workspace", ownerPrincipalId: "human",
  executorInstallationResourceId: "executor", resourceVersion: 2, resourceState: "ACTIVE", state: "ENABLED",
  pinnedVersionAssetId: "pinned", delegationId: "grant"};
const content = {name: "Original <script>inert</script>", trigger: {kind: "CHANNEL_MESSAGE"},
  action: {kind: "POST_MESSAGE", template: "hello"}, resultTarget: "TRIGGER_THREAD"};
const pinned = {assetId: "pinned", ordinal: 1, automationResourceId: "workflow", ownerPrincipalId: "human",
  assetVersion: 1, state: "PUBLISHED", configHash: "b".repeat(64), content};
const detail = {automation, canManage: true, canRun: true,
  versions: [{...pinned, assetId: "latest", ordinal: 2, content: {...content, name: "Unpinned"}}, pinned], delegations: []};

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

async function setup(reply: (request: BffRequest) => BffReply | Promise<BffReply>, locale: "en" | "zh-CN" = "en") {
  const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
    if (request.method !== "GET") return reply(request);
    if (request.path === "/api/v1/workspaces") return {status: 200, body: [{id: "workspace", name: "Channel", slug: "channel"}]};
    if (request.path === "/api/v1/tasks") return {status: 200, body: []};
    if (request.path.startsWith("/api/v1/automations?")) return {status: 200, body: {automations: [automation], canCreate: false, availableApprovalPolicies: []}};
    if (request.path.startsWith("/api/v1/automations/workflow?")) return {status: 200, body: detail};
    return {status: 503, body: undefined};
  });
  const cache = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const host = await render(<QueryClientProvider client={cache}><PlatformProvider client={createBffClient({send})} locale={locale}>
    <AutomationManagement />
  </PlatformProvider></QueryClientProvider>);
  await settle();
  await click(button(host, locale === "en" ? "View definition" : "查看定义"));
  const panel = document.querySelector<HTMLElement>('[data-testid="workflow-detail-panel"]')!;
  await click(button(panel, locale === "en" ? "Delete" : "删除"));
  const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')!;
  return {send, dialog};
}

describe("original workflow delete dialog with the existing governed command", () => {
  it.each(["en", "zh-CN"] as const)("restores the compact original confirmation and safe cancel in %s", async locale => {
    const {send, dialog} = await setup(() => ({status: 500, body: undefined}), locale);
    expect(dialog).not.toBeNull();
    expect(dialog.className).toContain("max-w-md");
    expect(dialog.className).not.toContain("88vh");
    expect(dialog.textContent).toContain(locale === "en" ? "Delete workflow?" : "删除工作流？");
    expect(dialog.textContent).toContain(content.name);
    expect(dialog.textContent).not.toContain("Unpinned");
    expect(dialog.querySelector("script")).toBeNull();
    expect(dialog.textContent).toContain(locale === "en" ? "Versions and run history remain" : "版本与运行历史保留");
    await click(button(dialog, locale === "en" ? "Cancel" : "取消"));
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(send.mock.calls.filter(([request]) => request.method !== "GET")).toHaveLength(0);
  });

  it("freezes one command and prevents duplicate confirmation or closing during submission", async () => {
    let resolve!: (reply: BffReply) => void;
    const {send, dialog} = await setup(() => new Promise<BffReply>(done => {resolve = done;}));
    await click(button(dialog, "Delete"));
    expect(button(dialog, "Deleting…").disabled).toBe(true);
    expect(button(dialog, "Cancel").disabled).toBe(true);
    await click(button(dialog, "Deleting…"));
    const writes = send.mock.calls.filter(([request]) => request.method !== "GET");
    expect(writes).toHaveLength(1);
    expect(writes[0]![0].body).toMatchObject({actionKey: "automation.delete", resourceId: "workflow", resourceVersion: 2, explicitConfirmation: true});
    await act(async () => resolve({status: 200, body: {actionKey: "automation.delete", actionExecutionId: "execution",
      operationId: "operation", gateState: "ALLOWED", dispatchState: "DISPATCHED"}}));
    await settle();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("keeps UNKNOWN neutral and verifies the same frozen request without a second delete intent", async () => {
    const {send, dialog} = await setup(() => ({status: 200, body: {actionKey: "automation.delete", actionExecutionId: "execution",
      operationId: "operation", gateState: "ALLOWED", dispatchState: "UNKNOWN"}}));
    await click(button(dialog, "Delete"));
    expect(dialog.querySelector('[role="alert"]')).toBeNull();
    expect(dialog.querySelector('[role="status"]')?.textContent).toContain("operation");
    expect(button(dialog, "Cancel").disabled).toBe(true);
    const retry = [...dialog.querySelectorAll("button")].find(node => !node.disabled)!;
    await click(retry);
    const writes = send.mock.calls.filter(([request]) => request.method !== "GET");
    expect(writes).toHaveLength(2);
    expect(writes[1]![0].body).toEqual(writes[0]![0].body);
    expect(document.querySelector('[role="alertdialog"]')).toBe(dialog);
  });

  it("shows a confirmed refusal with the original error surface and allows cancel", async () => {
    const {dialog} = await setup(() => ({status: 403, body: {reason: "PERMISSION_DENIED"}}));
    await click(button(dialog, "Delete"));
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain("Couldn’t delete workflow.");
    expect(button(dialog, "Cancel").disabled).toBe(false);
    await click(button(dialog, "Cancel"));
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
