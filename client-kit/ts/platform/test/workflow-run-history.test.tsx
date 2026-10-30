import { act } from "react";
import { AutomationStepStatus, type AutomationRunView, type AutomationStepTrace } from "@client-kit/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { automationRunSummary, WorkflowsPage } from "../src/react/workflows";
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
const runView = run as unknown as AutomationRunView;
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
  await click(button(definition(), "Run once"));
  expect(document.querySelector('[data-testid="workflow-detail-panel"]')).toBeNull();
  await click(button(document.body, "Review request"));
  await click(button(document.body, "Submit governed request"));
}
const history = (_host: HTMLElement) => document.querySelector<HTMLElement>('[role="dialog"] [data-testid="workflow-detail-panel"] [data-testid="workflow-runs"]')!;
const definition = () => document.querySelector<HTMLElement>('[role="dialog"] [data-testid="workflow-detail-panel"]')!;

describe("original trigger to persisted run selection through governed automation", () => {
  it.each(["en", "zh-CN"] as const)("names the run by its absolute local time and keeps its identity in technical details in %s", async (locale) => {
    const { host } = await setup(undefined, locale);
    if (locale === "en") await trigger(host);
    else {
      await click(button(host, "查看定义"));
      await click(button(definition(), "运行一次"));
      await click(button(document.body, "核对请求"));
      await click(button(document.body, "提交受治理请求"));
    }
    const selected = history(host).querySelector<HTMLElement>('[data-testid="workflow-selected-run"]')!;
    expect(selected.getAttribute("data-run-id")).toBe(task.actionExecutionId);
    // DD-170 §16.5: the run is named by its time; the raw identifier is not the visible text.
    expect(selected.querySelector("h2")!.textContent).toContain(new Date(task.createdAt).toLocaleString(locale));
    expect(selected.querySelector(`code[title="${task.actionExecutionId}"]`)).toBeNull();
    const createdAt = selected.querySelector("time")!;
    expect(createdAt.textContent).toBe(new Date(task.createdAt).toLocaleString(locale));
    expect(createdAt.dateTime).toBe(task.createdAt);
    expect(createdAt.title).toBe(task.createdAt);
    await click(button(selected, locale === "en" ? "Technical details" : "技术信息"));
    expect(selected.querySelector(`code[title="${task.actionExecutionId}"]`)).not.toBeNull();
    expect(selected.querySelector(`code[title="${task.operationId}"]`)).not.toBeNull();
  });

  it("keeps a table skeleton until the authorized persisted run arrives", async () => {
    let resolveHistory!: (reply: BffReply) => void;
    const awaitingHistory = new Promise<BffReply>((resolve) => { resolveHistory = resolve; });
    const { host } = await setup((request) => request.path.endsWith("/runs") ? awaitingHistory : undefined);
    await trigger(host);
    expect(history(host).querySelector('[data-testid="table-skeleton"]')).not.toBeNull();
    expect(history(host).querySelector('[data-testid="workflow-selected-run"]')).toBeNull();
    expect(history(host).textContent).not.toContain("No runs yet");
    await act(async () => resolveHistory({ status: 200, body: page }));
    await settle();
    expect(history(host).querySelector('[data-testid="table-skeleton"]')).toBeNull();
    expect(history(host).querySelector('[data-testid="workflow-selected-run"]')).not.toBeNull();
  });

  it("replaces the original skeleton with a real refusal, not an empty history", async () => {
    let resolveHistory!: (reply: BffReply) => void;
    const awaitingHistory = new Promise<BffReply>((resolve) => { resolveHistory = resolve; });
    const { host } = await setup((request) => request.path.endsWith("/runs") ? awaitingHistory : undefined);
    await trigger(host);
    expect(history(host).querySelector('[data-testid="table-skeleton"]')).not.toBeNull();
    await act(async () => resolveHistory({ status: 403, body: { reason: "PERMISSION_DENIED" } }));
    await settle();
    expect(history(host).querySelector('[data-testid="table-skeleton"]')).toBeNull();
    expect(history(host).querySelector('[data-testid="workflow-selected-run"]')).toBeNull();
    // DD-170 §16.4(4): a definitive refusal is the no-access state, never an empty history.
    expect(history(host).querySelector('[data-testid="permission-state"]')).not.toBeNull();
    expect(history(host).querySelector('[data-testid="empty-state"]')).toBeNull();
    expect(history(host).textContent).toContain("You don\u2019t have access");
  });

  it("selects a historical execution without inventing step evidence and follows the existing task reader", async () => {
    const { host, send } = await setup();
    await trigger(host);
    expect(document.querySelector('[data-testid="workflow-editor-dialog"]')).toBeNull();
    expect(history(host).querySelector('[data-testid="workflow-selected-run"]')?.getAttribute("data-run-id")).toBe("execution");
    const selected = history(host).querySelector<HTMLElement>('[data-testid="workflow-selected-run"]')!;
    expect(selected.textContent).toContain("Running");
    expect(history(host).querySelector('[data-testid="workflow-run-trace"]')).toBeNull();
    expect(history(host).textContent).toContain("No steps recorded yet.");
    await click(button(history(host), "Open task"));
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
    await click(history(host).querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!);
    expect(history(host).querySelector('[data-testid="workflow-run-created"]')).toBeNull();
    expect(history(host).querySelector('[data-testid="workflow-selected-run"]')).not.toBeNull();
    expect(history(host).querySelector('[data-testid="workflow-run-trace"]')).toBeNull();
    expect(history(host).textContent).toContain("No steps recorded yet.");
    expect(send.mock.calls.filter(([request]) => request.method === "POST")).toHaveLength(1);
  });

  it("retains UNKNOWN and retries the identical intention before navigating to its confirmed receipt", async () => {
    let confirmed = false;
    const { host, send } = await setup((request) => request.path === "/api/v1/actions" && !confirmed
      ? { status: 202, body: { ...receipt, dispatchState: "UNKNOWN" } } : undefined);
    await trigger(host);
    expect(document.querySelector('[data-testid="workflow-editor-dialog"]')?.textContent).toContain("Outcome is not confirmed");
    expect(history(host)).toBeNull();
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
    expect(history(host).textContent).toContain("Couldn\u2019t load this");
  });

  it("does not turn a later unknown projection into success", async () => {
    const { host } = await setup((request) => request.path.endsWith("/runs") ? { status: 200,
      body: { ...page, runs: [{ ...run, task: { ...task, dispatchState: "UNKNOWN", taskStatus: "COMPLETED" } }] } } : undefined);
    await trigger(host);
    const selected = history(host).querySelector('[data-testid="workflow-selected-run"]')!;
    expect(selected.textContent).toContain("Outcome not known yet");
    expect(selected.textContent).not.toContain("Completed");
    expect(history(host).querySelector('[data-testid="workflow-run-trace"]')).toBeNull();
    expect(history(host).textContent).toContain("No steps recorded yet.");
  });

  it("renders only the authorized selected run's recorded steps without deriving their status from its parent", async () => {
    const executionTrace: AutomationStepTrace[] = [{ stepId: "publish", status: AutomationStepStatus.Completed,
      startedAt: "2026-10-07T01:00:00Z", completedAt: "2026-10-07T01:00:02Z", output: { eventId: "recorded-event" } },
    { stepId: "future", status: AutomationStepStatus.Pending, output: {} }];
    const { host, send } = await setup((request) => request.path.endsWith("/runs") ? { status: 200,
      body: { ...page, runs: [{ ...run, executionTrace }] } } : undefined);
    await trigger(host);
    const trace = history(host).querySelector('[data-testid="workflow-run-trace"]')!;
    expect(trace.textContent).toContain("publish");
    expect(trace.textContent).toContain("completed");
    expect(trace.textContent).toContain("2.0s");
    expect(trace.textContent).toContain("future");
    expect(trace.textContent).toContain("pending");
    // DD-170 §16.5(6): step output is folded; one disclosure per step that has output.
    expect(trace.querySelectorAll("pre")).toHaveLength(0);
    const outputs = [...trace.querySelectorAll("button")].filter((node) => node.textContent === "Output");
    expect(outputs).toHaveLength(1);
    await click(outputs[0]!);
    expect(trace.querySelector("pre")?.textContent).toContain('"eventId": "recorded-event"');
    expect(history(host).querySelector('[data-testid="workflow-selected-run"]')?.textContent).toContain("Running");
    await click(button(history(host), "Open task"));
    expect(send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/tasks/execution" });
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
    await click(button(definition(), "运行一次"));
    await click(button(document.body, "核对请求"));
    await click(button(document.body, "提交受治理请求"));
    const pending = history(host).querySelector('[data-testid="workflow-run-created"]')!;
    expect(pending.textContent).toContain("运行请求已记录");
    expect(pending.textContent).toContain("状态可能尚未更新，等待对账");
  });
});

describe("original WorkflowDetailPanel run-card facts", () => {
  const step = (stepId: string, status: AutomationStepTrace["status"], startedAt?: string, completedAt?: string): AutomationStepTrace =>
    ({ stepId, status, output: {}, ...(startedAt ? { startedAt } : {}), ...(completedAt ? { completedAt } : {}) });

  it("derives step count, duration and current step only from native trace facts", () => {
    expect(automationRunSummary({ ...runView, executionTrace: [step("a", AutomationStepStatus.Completed, "2026-10-07T01:00:00Z", "2026-10-07T01:00:01Z"),
      step("b", AutomationStepStatus.Completed, "2026-10-07T01:00:01Z", "2026-10-07T01:00:03.5Z")] }))
      .toEqual({ steps: 2, duration: "3.5s", currentStep: null });
    expect(automationRunSummary({ ...runView, executionTrace: [step("a", AutomationStepStatus.Completed, "2026-10-07T01:00:00Z", "2026-10-07T01:00:00.25Z")] }).duration).toBe("250ms");
    // An open step: no duration, its 1-based position is the current step.
    expect(automationRunSummary({ ...runView, executionTrace: [step("a", AutomationStepStatus.Completed, "2026-10-07T01:00:00Z", "2026-10-07T01:00:01Z"),
      step("b", AutomationStepStatus.WaitingApproval, "2026-10-07T01:00:01Z")] })).toEqual({ steps: 2, duration: null, currentStep: 2 });
    // A missing native completion time or an unknown step is never inferred into a duration.
    expect(automationRunSummary({ ...runView, executionTrace: [step("a", AutomationStepStatus.Completed, "2026-10-07T01:00:00Z")] }).duration).toBeNull();
    expect(automationRunSummary({ ...runView, executionTrace: [step("a", AutomationStepStatus.Unknown, "2026-10-07T01:00:00Z", "2026-10-07T01:00:01Z")] }).duration).toBeNull();
    expect(automationRunSummary(runView)).toEqual({ steps: 0, duration: null, currentStep: null });
  });

  it.each([["en", "2 steps", "Current step 2"], ["zh-CN", "2 个步骤", "当前第 2 步"]] as const)("renders the run card facts in %s", async (locale, steps, current) => {
    const executionTrace = [step("a", AutomationStepStatus.Completed, "2026-10-07T01:00:00Z", "2026-10-07T01:00:01Z"),
      step("b", AutomationStepStatus.Running, "2026-10-07T01:00:01Z")];
    const { host } = await setup((request) => request.path.endsWith("/runs") ? { status: 200,
      body: { ...page, runs: [{ ...run, executionTrace }] } } : undefined, locale);
    if (locale === "en") await trigger(host);
    else {
      await click(button(host, "查看定义"));
      await click(button(definition(), "运行一次"));
      await click(button(document.body, "核对请求"));
      await click(button(document.body, "提交受治理请求"));
    }
    const card = history(host).querySelector<HTMLElement>('[data-testid="workflow-selected-run"]')!;
    expect(card.textContent).toContain(steps);
    expect(card.textContent).toContain(current);
  });

  it("shows a failed run's reason in red and keeps an unknown outcome neutral", async () => {
    const { host } = await setup((request) => request.path.endsWith("/runs") ? { status: 200, body: { ...page, runs: [
      { ...run, task: { ...task, taskStatus: "FAILED", reason: "PERMISSION_DENIED" } }] } } : undefined);
    await trigger(host);
    const reason = history(host).querySelector<HTMLElement>('[data-testid="workflow-run-failure-reason"]')!;
    expect(reason.textContent).toContain("You do not have permission");
    expect(reason.className).toContain("text-destructive");
  });

  it("does not render an unknown outcome's reason as a failure", async () => {
    const { host } = await setup((request) => request.path.endsWith("/runs") ? { status: 200, body: { ...page, runs: [
      { ...run, task: { ...task, dispatchState: "UNKNOWN", reason: "PERMISSION_DENIED" } }] } } : undefined);
    await trigger(host);
    const reason = history(host).querySelector<HTMLElement>('[data-testid="workflow-run-failure-reason"]')!;
    expect(reason.className).toContain("text-muted-foreground");
    expect(reason.className).not.toContain("text-destructive");
  });
});
