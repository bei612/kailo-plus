import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { createBffClient } from "../src/client";
import { AutomationManagement } from "../src/react/agents";
import { PlatformProvider } from "../src/react/context";
import type { BffReply, BffRequest } from "../src/transport";
import { button, click, render, settle, type } from "./render";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

const installation = { resourceId: "executor", workspaceId: "workspace", agentResourceId: "agent",
  pinnedVersionAssetId: "agent-version", agentPrincipalId: "agent-principal", agentPrincipalState: "ACTIVE",
  ownerPrincipalId: "human", resourceVersion: 1, resourceState: "ACTIVE", state: "ACTIVE",
  automationResultTargets: ["TRIGGER_THREAD", "CHANNEL"], activeProjectionGeneration: 1,
  projection: { generation: 1, agentVersionAssetId: "agent-version", runtimeProfileKey: "profile",
    configHash: "a".repeat(64), state: "ACTIVE" } };
const automation = { resourceId: "workflow", workspaceId: "workspace", ownerPrincipalId: "human",
  executorInstallationResourceId: "executor", resourceVersion: 2, resourceState: "ACTIVE", state: "ENABLED",
  pinnedVersionAssetId: "pinned", delegationId: "grant" };
const content = { name: "Pinned original definition", trigger: { kind: "CHANNEL_MESSAGE", textPrefix: "release", filter: "content.contains(\"ready\")" },
  formatVersion: 3, steps: [{ id: "pause", action: "delay", duration: "2s" },
    { id: "first", action: "send_message", text: "<script>never execute</script> {{event.content}}" },
    { id: "last", action: "send_message", text: "{{steps.first.event_id}}" }], resultTarget: "TRIGGER_THREAD" };
const version = (assetId: string, ordinal: number, body = content) => ({ assetId, ordinal,
  automationResourceId: "workflow", ownerPrincipalId: "human", assetVersion: 1, state: "PUBLISHED",
  configHash: "b".repeat(64), content: body });
const pinned = version("pinned", 1);
const latest = version("latest", 2, { ...content, name: "Latest but not pinned" });
const detail = { automation, canManage: true, canRun: true, versions: [latest, pinned], delegations: [] };

async function setup(override: (request: BffRequest) => BffReply | undefined = () => undefined,
  locale: "en" | "zh-CN" = "en") {
  const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
    const extra = override(request);
    if (extra) return extra;
    if (request.path === "/api/v1/workspaces") return { status: 200, body: [{ id: "workspace", name: "Channel", slug: "channel" }] };
    if (request.path === "/api/v1/tasks") return { status: 200, body: [] };
    if (request.path.startsWith("/api/v1/automations?")) return { status: 200, body: { automations: [automation], canCreate: true, availableApprovalPolicies: [] } };
    if (request.path.startsWith("/api/v1/automations/workflow?")) return { status: 200, body: detail };
    if (request.path.startsWith("/api/v1/agent-installations?")) return { status: 200, body: { installations: [installation] } };
    if (request.path === "/api/v1/agent-installations/executor") return { status: 200, body: installation };
    return { status: 503, body: undefined };
  });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = await render(<QueryClientProvider client={cache}><PlatformProvider client={createBffClient({ send })} locale={locale}>
    <AutomationManagement />
  </PlatformProvider></QueryClientProvider>);
  await settle();
  await click(button(host, locale === "en" ? "View definition" : "查看定义"));
  const panel = host.querySelector<HTMLElement>('[data-testid="workflow-detail-panel"]')!;
  return { host, panel, send };
}

describe("original complete Definition view with immutable pinned governance", () => {
  it.each(["en", "zh-CN"] as const)("shows the complete real pinned content, not a lossy summary, in %s", async (locale) => {
    const { panel, send } = await setup(undefined, locale);
    expect(panel.querySelector("h3")!.textContent).toBe(content.name);
    expect(panel.querySelector("h4")!.textContent).toBe(locale === "en" ? "Definition" : "定义");
    const pre = panel.querySelector('[data-testid="workflow-definition"]')!;
    expect(JSON.parse(pre.textContent!)).toEqual(content);
    expect(pre.className).toBe("max-h-64 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs leading-relaxed");
    expect(pre.querySelector("script")).toBeNull();
    expect(send.mock.calls.some(([request]) => request.method !== "GET")).toBe(false);
  });

  it("edits the same pinned body shown in the title and JSON through the original form/YAML editor", async () => {
    const { panel, send } = await setup();
    const reads = send.mock.calls.filter(([request]) => request.path.startsWith("/api/v1/automations/workflow?")).length;
    await click(button(panel, "Publish a new version"));
    const dialog = document.querySelector<HTMLElement>('[data-testid="workflow-editor-dialog"]')!;
    expect(dialog.textContent).toContain(content.name);
    expect(dialog.textContent).not.toContain(latest.content.name);
    await click(button(dialog, "Workflow YAML"));
    expect(parse(dialog.querySelector<HTMLTextAreaElement>("textarea")!.value)).toEqual(content);
    expect(dialog.querySelector("textarea")!.getAttribute("autocapitalize")).toBe("off");
    expect(dialog.textContent).toContain("Edit the raw YAML definition directly.");
    expect(dialog.querySelector("textarea")!.parentElement!.className).toBe("flex min-h-0 flex-1 flex-col gap-1.5");
    expect(send.mock.calls.filter(([request]) => request.path.startsWith("/api/v1/automations/workflow?")).length).toBe(reads + 1);
    expect(send.mock.calls.some(([request]) => request.method !== "GET")).toBe(false);
  });

  it.each(["en", "zh-CN"] as const)("adds the first step from the actual dialog and closes its inspector before the dirty editor in %s", async locale => {
    const {host, send} = await setup(undefined, locale);
    await click(host.querySelector<HTMLElement>('[data-testid="new-workflow-card"]')!);
    const dialog = document.querySelector<HTMLElement>('[data-testid="workflow-editor-dialog"]')!;
    const action = [...dialog.querySelectorAll("label")].find(label => label.textContent?.startsWith(locale === "en" ? "Action" : "执行动作"))!.querySelector("select")!;
    await act(async () => { action.value = "POST_MESSAGE"; action.dispatchEvent(new Event("change", {bubbles:true})); });
    const primary = dialog.querySelector<HTMLButtonElement>('[data-testid="workflow-dialog-primary-action"]')!;
    expect(primary.getAttribute("aria-label")).toBe(locale === "en" ? "Add first step" : "添加第一个步骤");
    expect(primary.textContent).toBe(locale === "en" ? "Add step" : "添加步骤");
    expect(primary.disabled).toBe(true);
    const executor = [...dialog.querySelectorAll("select")].find(select => [...select.options].some(option => option.value === "executor"))!;
    await act(async () => { executor.value = "executor"; executor.dispatchEvent(new Event("change", {bubbles:true})); });
    expect(primary.disabled).toBe(false);
    await click(primary);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(dialog.querySelectorAll('ol > li')).toHaveLength(2);
    const draft = dialog.querySelector<HTMLTextAreaElement>("textarea")!;
    await type(draft, "Kept real draft");
    const escape = new KeyboardEvent("keydown", {key:"Escape",bubbles:true,cancelable:true});
    await act(async () => document.dispatchEvent(escape));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(escape.defaultPrevented).toBe(true);
    expect(document.querySelector('[data-testid="workflow-editor-dialog"]')).toBe(dialog);
    expect(dialog.querySelector('[data-testid="workflow-node-inspector"]')).toBeNull();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await click(button(dialog, locale === "en" ? "Workflow YAML" : "工作流 YAML"));
    const yaml = dialog.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(parse(yaml.value).steps).toEqual([{id:"step_1",action:"send_message",text:"Kept real draft"}]);
    expect(dialog.textContent).toContain(locale === "en" ? "Edit the raw YAML definition directly." : "直接编辑原始 YAML 定义。");
    expect(send.mock.calls.some(([request]) => request.method !== "GET")).toBe(false);
  });

  it("does not substitute the newest version when the pin is absent from the readable page", async () => {
    const { panel } = await setup((request) => request.path.startsWith("/api/v1/automations/workflow?")
      ? { status: 200, body: { ...detail, versions: [latest] } } : undefined);
    expect(panel.querySelector('[data-testid="workflow-definition"]')).toBeNull();
    expect(panel.querySelector("h3")!.textContent).toBe("Not available here");
    expect(button(panel, "Publish a new version").disabled).toBe(true);
    expect(panel.textContent).toContain(latest.content.name);
  });

  it("reads the original latest version for an unpinned draft without inventing an execution pin", async () => {
    const draft = { ...automation, state: "DRAFT", pinnedVersionAssetId: undefined, delegationId: undefined };
    const { panel } = await setup((request) => request.path.startsWith("/api/v1/automations/workflow?")
      ? { status: 200, body: { ...detail, automation: draft, canRun: false } } : request.path.startsWith("/api/v1/automations?")
        ? { status: 200, body: { automations: [draft], canCreate: true } } : undefined);
    expect(panel.querySelector("h3")!.textContent).toBe(latest.content.name);
    expect(JSON.parse(panel.querySelector('[data-testid="workflow-definition"]')!.textContent!)).toEqual(latest.content);
    expect([...panel.querySelectorAll("button")].some((node) => node.textContent === "Run once")).toBe(false);
  });

  it("uses the existing authorized version pagination to inspect and edit a pin on a later page", async () => {
    const { host, panel, send } = await setup((request) => request.path.startsWith("/api/v1/automations/workflow?")
      ? { status: 200, body: request.path.includes("versionOffset=5") ? { ...detail, versions: [pinned] }
        : { ...detail, versions: [latest], nextVersionOffset: 5 } } : undefined);
    expect(button(panel, "Publish a new version").disabled).toBe(true);
    await click(button(panel, "Next page"));
    const next = host.querySelector<HTMLElement>('[data-testid="workflow-detail-panel"]')!;
    expect(JSON.parse(next.querySelector('[data-testid="workflow-definition"]')!.textContent!)).toEqual(content);
    await click(button(next, "Publish a new version"));
    expect(document.querySelector('[data-testid="workflow-editor-dialog"]')!.textContent).toContain(content.name);
    expect(send.mock.calls.at(-1)?.[0].method).toBe("GET");
    expect(send.mock.calls.filter(([request]) => request.path.includes("versionOffset=5"))).toHaveLength(2);
  });

  it.each(["revoked", "changed", "missing"])("refuses an edit after fresh %s facts without opening stale body", async (failure) => {
    let stale = false;
    const { panel } = await setup((request) => request.path.startsWith("/api/v1/automations/workflow?") && stale
      ? { status: 200, body: { ...detail, canManage: failure !== "revoked",
        automation: failure === "changed" ? { ...automation, resourceVersion: 3 } : automation,
        versions: failure === "missing" ? [latest] : detail.versions } } : undefined);
    stale = true;
    await click(button(panel, "Publish a new version"));
    expect(document.querySelector('[data-testid="workflow-editor-dialog"]')).toBeNull();
    expect(panel.textContent).toContain("Couldn't load this");
  });
});
