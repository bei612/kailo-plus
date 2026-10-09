import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { WorkflowsPage } from "../src/react/workflows";
import type { BffReply, BffRequest } from "../src/transport";
import { button, click, render, settle } from "./render";

const crypto = globalThis.crypto;
beforeEach(() => {
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

const automation = { resourceId: "workflow", workspaceId: "workspace", ownerPrincipalId: "human",
  executorInstallationResourceId: "executor", resourceVersion: 2, resourceState: "ACTIVE", state: "ENABLED",
  pinnedVersionAssetId: "version", delegationId: "grant" };
const receipt = { actionKey: "automation.run", actionExecutionId: "execution", operationId: "operation",
  gateState: "ALLOWED", dispatchState: "DISPATCHED", workflowId: "temporal-workflow" };
const task = { ...receipt, actionVersion: 1, targetId: "workflow", workspaceId: "workspace",
  createdAt: "2026-10-07T01:00:00Z", taskStatus: "RUNNING" };
const run = { task, usageEventIds: [] };
const page = { automationResourceId: "workflow", runs: [run] };

async function setup(override: (request: BffRequest) => BffReply | undefined | Promise<BffReply | undefined> = () => undefined,
  locale: "en" | "zh-CN" = "en") {
  const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
    const extra = await override(request);
    if (extra) return extra;
    if (request.path === "/api/v1/workspaces") return { status: 200, body: [
      { id: "workspace", name: "Channel", slug: "channel" }, { id: "other", name: "Other", slug: "other" },
    ] };
    if (request.path === "/api/v1/tasks") return { status: 200, body: [] };
    if (request.path === "/api/v1/tasks/execution") return { status: 200, body: task };
    if (request.path.startsWith("/api/v1/automations?")) return { status: 200, body: {
      automations: request.path.includes("other") ? [] : [automation], canCreate: false,
    } };
    if (request.path.startsWith("/api/v1/automations/workflow?")) return { status: 200, body: {
      automation, versions: [], delegations: [], canManage: false, canRun: true,
    } };
    if (request.path === "/api/v1/automations/workflow/runs") return { status: 200, body: page };
    if (request.path.startsWith("/api/v1/agent-installations?")) return { status: 200, body: { installations: [] } };
    if (request.path === "/api/v1/actions") return { status: 202, body: receipt };
    return { status: 503, body: undefined };
  });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = await render(<QueryClientProvider client={cache}><PlatformProvider client={createBffClient({ send })} locale={locale}>
    <WorkflowsPage />
  </PlatformProvider></QueryClientProvider>);
  await settle();
  return { host, send };
}
async function trigger(host: HTMLElement) {
  await click(button(host, "View definition"));
  await click(button(host, "Run once"));
  await click(button(document.body, "Review request"));
  await click(button(document.body, "Submit governed request"));
}
const history = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-testid="workflow-runs"]')!;

describe("original trigger to persisted run selection through governed automation", () => {
  it.each(["en", "zh-CN"] as const)("keeps the original compact run identity and absolute local timestamp in %s", async (locale) => {
    const { host } = await setup(undefined, locale);
    if (locale === "en") await trigger(host);
    else {
      await click(button(host, "查看定义"));
      await click(button(host, "运行一次"));
      await click(button(document.body, "核对请求"));
      await click(button(document.body, "提交受治理请求"));
    }
    const selected = history(host).querySelector<HTMLElement>('[data-testid="workflow-selected-run"]')!;
    const identity = selected.querySelector<HTMLElement>(`span[title="${task.actionExecutionId}"]`)!;
    expect(identity.textContent).toBe(task.actionExecutionId.slice(0, 8));
    expect(identity.className).toBe("truncate font-mono text-xs font-medium");
    expect(selected.getAttribute("aria-label")).toBe(task.actionExecutionId);
    const createdAt = selected.querySelector("time")!;
    expect(createdAt.textContent).toBe(new Date(task.createdAt).toLocaleString(locale));
    expect(createdAt.dateTime).toBe(task.createdAt);
    expect(createdAt.title).toBe(task.createdAt);
  });

  it("keeps the original history skeleton until the authorized persisted run arrives", async () => {
    let resolveHistory!: (reply: BffReply) => void;
    const awaitingHistory = new Promise<BffReply>((resolve) => { resolveHistory = resolve; });
    const { host } = await setup((request) => request.path.endsWith("/runs") ? awaitingHistory : undefined);
    await trigger(host);
    const pending = history(host).querySelector<HTMLElement>('[role="status"]')!;
    expect(pending.className).toBe("space-y-2");
    expect(pending.querySelector('[aria-hidden="true"]')?.className).toContain("h-16 w-full rounded-xl");
    expect(history(host).querySelector('[data-testid="workflow-selected-run"]')).toBeNull();
    expect(history(host).textContent).not.toContain("No visible runs on this page.");
    await act(async () => resolveHistory({ status: 200, body: page }));
    await settle();
    expect(history(host).querySelector('[role="status"]')).toBeNull();
    expect(history(host).querySelector('[data-testid="workflow-selected-run"]')).not.toBeNull();
  });

  it("replaces the original skeleton with a real refusal, not an empty history", async () => {
    let resolveHistory!: (reply: BffReply) => void;
    const awaitingHistory = new Promise<BffReply>((resolve) => { resolveHistory = resolve; });
    const { host } = await setup((request) => request.path.endsWith("/runs") ? awaitingHistory : undefined);
    await trigger(host);
    expect(history(host).querySelector('[role="status"]')).not.toBeNull();
    await act(async () => resolveHistory({ status: 403, body: { reason: "PERMISSION_DENIED" } }));
    await settle();
    expect(history(host).querySelector('[role="status"]')).toBeNull();
    expect(history(host).querySelector('[data-testid="workflow-selected-run"]')).toBeNull();
    expect(history(host).querySelector('[role="alert"]')).not.toBeNull();
    expect(history(host).textContent).not.toContain("No visible runs on this page.");
    expect(history(host).textContent).toContain("You do not have permission");
  });

  it("selects the returned execution, opens its real trace and follows the existing task reader", async () => {
    const { host, send } = await setup();
    await trigger(host);
    expect(document.querySelector('[data-testid="workflow-editor-dialog"]')).toBeNull();
    expect(history(host).querySelector('[data-testid="workflow-selected-run"]')?.getAttribute("aria-label")).toBe("execution");
    const trace = history(host).querySelector<HTMLElement>('[data-testid="workflow-execution-trace"]')!;
    expect(trace.textContent).toContain("Running");
    await click(button(trace, "Action execution"));
    expect(send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/tasks/execution" });
    expect(history(host).textContent).toContain("operation");
  });

  it("keeps the real receipt while projection is absent, refreshes to select it without resubmitting", async () => {
    let projected = false;
    const { host, send } = await setup((request) => request.path.endsWith("/runs") && !projected
      ? { status: 200, body: { ...page, runs: [] } } : undefined);
    await trigger(host);
    const pending = history(host).querySelector('[data-testid="workflow-run-created"]')!;
    expect(pending.textContent).toContain("Run request recorded");
    expect(pending.textContent).toContain("operation");
    expect(pending.textContent).toContain("waiting for reconciliation");
    expect(history(host).querySelector('[data-testid="workflow-run-trace"]')).toBeNull();
    expect(history(host).textContent).not.toContain("No runs");
    projected = true;
    await click(button(history(host), "Refresh"));
    expect(history(host).querySelector('[data-testid="workflow-run-created"]')).toBeNull();
    expect(history(host).querySelector('[data-testid="workflow-run-trace"]')).not.toBeNull();
    expect(send.mock.calls.filter(([request]) => request.method === "POST")).toHaveLength(1);
  });

  it("retains UNKNOWN and retries the identical intention before navigating to its confirmed receipt", async () => {
    let confirmed = false;
    const { host, send } = await setup((request) => request.path === "/api/v1/actions" && !confirmed
      ? { status: 202, body: { ...receipt, dispatchState: "UNKNOWN" } } : undefined);
    await trigger(host);
    expect(document.querySelector('[data-testid="workflow-editor-dialog"]')?.textContent).toContain("Outcome is not confirmed");
    expect(history(host).querySelector('[data-testid="workflow-selected-run"]')).toBeNull();
    confirmed = true;
    await click(button(document.body, "Re-check same request"));
    expect(history(host).querySelector('[data-testid="workflow-selected-run"]')).not.toBeNull();
    const writes = send.mock.calls.filter(([request]) => request.method === "POST").map(([request]) => request.body);
    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual(writes[1]);
  });

  it("refuses the same execution ID paired with a different operation", async () => {
    const { host } = await setup((request) => request.path.endsWith("/runs")
      ? { status: 200, body: { ...page, runs: [{ ...run, task: { ...task, operationId: "wrong-operation" } }] } } : undefined);
    await trigger(host);
    expect(history(host).querySelector('[data-testid="workflow-run-trace"]')).toBeNull();
    expect(history(host).textContent).not.toContain("wrong-operation");
    expect(history(host).textContent).toContain("Couldn't load this");
  });

  it("does not turn a later unknown projection into success", async () => {
    const { host } = await setup((request) => request.path.endsWith("/runs") ? { status: 200,
      body: { ...page, runs: [{ ...run, task: { ...task, dispatchState: "UNKNOWN", taskStatus: "COMPLETED" } }] } } : undefined);
    await trigger(host);
    const trace = history(host).querySelector('[data-testid="workflow-execution-trace"]')!;
    expect(trace.textContent).toContain("Outcome not known yet");
    expect(trace.textContent).not.toContain("Completed");
  });

  it("does not carry a run reference across workspaces", async () => {
    const { host } = await setup();
    await trigger(host);
    const select = host.querySelector("select")!;
    await act(async () => { select.value = "other"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await settle();
    expect(history(host)).toBeNull();
    expect(host.textContent).not.toContain("execution");
  });

  it("keeps a definitive refusal visible without announcing an uncreated run", async () => {
    const { host } = await setup((request) => request.path === "/api/v1/actions" ? { status: 200,
      body: { ...receipt, gateState: "DENIED", dispatchState: "NOT_DISPATCHED", reason: "PERMISSION_DENIED" } } : undefined);
    await trigger(host);
    expect(history(host)).toBeNull();
    expect(host.querySelector('[data-testid="workflow-run-created"]')).toBeNull();
    expect(host.textContent).toContain("Request recorded");
    expect(host.textContent).toContain("You do not have permission to do this.");
  });

  it("renders the pending receipt and reconciliation state in Chinese", async () => {
    const { host } = await setup((request) => request.path.endsWith("/runs")
      ? { status: 200, body: { ...page, runs: [] } } : undefined, "zh-CN");
    await click(button(host, "查看定义"));
    await click(button(host, "运行一次"));
    await click(button(document.body, "核对请求"));
    await click(button(document.body, "提交受治理请求"));
    const pending = history(host).querySelector('[data-testid="workflow-run-created"]')!;
    expect(pending.textContent).toContain("运行请求已记录");
    expect(pending.textContent).toContain("状态可能尚未更新，等待对账");
  });
});
