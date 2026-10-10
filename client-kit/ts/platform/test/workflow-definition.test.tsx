import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { createBffClient } from "../src/client";
import { AutomationManagement } from "../src/react/agents";
import { buildConditionExpressions, type ConditionOperator } from "../src/react/workflow-condition-expression";
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
  const panel = document.querySelector<HTMLElement>('[data-testid="workflow-detail-panel"]')!;
  return { host, panel, send };
}

describe("original complete Definition view with immutable pinned governance", () => {
  it.each(["en", "zh-CN"] as const)("keeps original description separate from the trigger and through form/YAML in %s", async locale => {
    const described = { ...content, description: "Original description <script>inert</script>" };
    const { panel, send } = await setup(request => request.path.startsWith("/api/v1/automations/workflow?")
      ? {status: 200, body: {...detail, versions: [{...pinned, content: described}]}} : undefined, locale);
    const description = [...panel.querySelectorAll("p")].find(node => node.textContent === described.description)!;
    expect(description.className).toBe("mt-1 truncate text-xs text-muted-foreground");
    expect(description.querySelector("script")).toBeNull();
    expect(panel.querySelector('[data-testid="workflow-trigger-summary"]')).not.toBe(description);
    await click(button(panel, locale === "en" ? "Edit" : "编辑"));
    const dialog = document.querySelector<HTMLElement>('[data-testid="workflow-editor-dialog"]')!;
    await click(button(dialog, locale === "en" ? "Workflow YAML" : "工作流 YAML"));
    expect(parse(dialog.querySelector<HTMLTextAreaElement>("textarea")!.value)).toEqual(described);
    await click(button(dialog, locale === "en" ? "Form" : "表单"));
    await click(button(dialog, locale === "en" ? "Workflow YAML" : "工作流 YAML"));
    expect(parse(dialog.querySelector<HTMLTextAreaElement>("textarea")!.value)).toEqual(described);
    expect(send.mock.calls.some(([request]) => request.method !== "GET")).toBe(false);
  });

  it.each(["", "  ", " leading\nand trailing "])("keeps non-form description %j in the original YAML rather than dropping it", async description => {
    const described = {...content, description};
    const {panel} = await setup(request => request.path.startsWith("/api/v1/automations/workflow?")
      ? {status: 200, body: {...detail, versions: [{...pinned, content: described}]}} : undefined);
    await click(button(panel, "Edit"));
    const dialog = document.querySelector<HTMLElement>('[data-testid="workflow-editor-dialog"]')!;
    const yaml = dialog.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(parse(yaml.value)).toEqual(described);
    await click(button(dialog, "Form"));
    expect(button(dialog, "Workflow YAML").getAttribute("aria-pressed")).toBe("true");
    expect(parse(yaml.value)).toEqual(described);
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain("Your text has been kept");
  });

  it.each([
    ["contains", "When a message by anyone except Alice contains “ready”", "Message contains “ready”"],
    ["not_contains", "When a message by anyone except Alice doesn’t contain “ready”", "Message doesn’t contain “ready”"],
    ["starts_with", "When a message by anyone except Alice starts with “ready”", "Message starts with “ready”"],
    ["ends_with", "When a message by anyone except Alice ends with “ready”", "Message ends with “ready”"],
    ["equals", "When “ready” is posted by anyone except Alice", "Message “ready” is posted"],
    ["not_equals", "When a message with text other than “ready” is posted by anyone except Alice", "Message with text other than “ready” posted"],
    ["is_not_empty", "When a message with text is posted by anyone except Alice", "Message with text posted"],
    ["is_empty", "When a message without text is posted by anyone except Alice", "Message without text posted"],
  ] satisfies [ConditionOperator, string, string][])("preserves the original %s + author card and independent detail summary", async (operator, cardLabel, summary) => {
    const pubkey = "a".repeat(64);
    const body = {...content, trigger: {kind:"CHANNEL_MESSAGE", filter:buildConditionExpressions([
      {field:"trigger_author", operator:"not_equals", value:pubkey, webhookField:""},
      {field:"trigger_text", operator, value:"ready", webhookField:""},
    ])}};
    const {host, panel, send} = await setup(request =>
      request.path.startsWith("/api/v1/automations/workflow?") ? {status:200, body:{...detail, versions:[{...pinned, content:body}]}}
        : request.path === "/api/v1/workspaces/workspace/members" ? {status:200, body:[{principalId:"alice", displayName:"Alice", pubkeys:[pubkey], state:"ACTIVE"}]}
          : request.path === "/api/v1/conversation-participants" ? {status:200, body:{items:[]}} : undefined);
    expect(host.querySelector('[data-testid="workflow-card-semantic-label"]')?.textContent).toBe(`${cardLabel}, wait 2 seconds, then 2 more steps`);
    expect(panel.querySelector('[data-testid="workflow-trigger-summary"]')?.textContent).toBe(summary);
    expect(send.mock.calls.some(([request]) => request.method !== "GET")).toBe(false);
  });

  it("localizes the combined trigger without turning its detail summary into a card sentence", async () => {
    const pubkey = "a".repeat(64);
    const body = {...content, trigger:{kind:"CHANNEL_MESSAGE", filter:`str_contains(trigger_text, "ready") && trigger_author == "${pubkey}"`}};
    const {host, panel} = await setup(request => request.path.startsWith("/api/v1/automations/workflow?")
      ? {status:200, body:{...detail, versions:[{...pinned, content:body}]}}
      : request.path === "/api/v1/workspaces/workspace/members" ? {status:200, body:[{principalId:"alice", displayName:"Alice", pubkeys:[pubkey], state:"ACTIVE"}]}
        : request.path === "/api/v1/conversation-participants" ? {status:200, body:{items:[]}} : undefined, "zh-CN");
    expect(host.querySelector('[data-testid="workflow-card-semantic-label"]')?.textContent).toBe("由Alice消息包含“ready”时，等待 2 秒，然后执行另外 2 个步骤");
    expect(panel.querySelector('[data-testid="workflow-trigger-summary"]')?.textContent).toBe("消息包含“ready”");
  });

  it("keeps the original schedule summary distinct from the time-specific card", async () => {
    const body = {...content, trigger:{kind:"SCHEDULE", scheduleSpec:{cron:"0 9 * * *"}}};
    const {host, panel} = await setup(request => request.path.startsWith("/api/v1/automations/workflow?")
      ? {status:200, body:{...detail, versions:[{...pinned, content:body}]}} : undefined);
    expect(host.querySelector('[data-testid="workflow-card-semantic-label"]')?.textContent).toBe("Every day at 09:00 UTC, wait 2 seconds, then 2 more steps");
    expect(panel.querySelector('[data-testid="workflow-trigger-summary"]')?.textContent).toBe("Schedule");
  });

  it.each(["en", "zh-CN"] as const)("keeps the original semantic card, footer and real writer date in %s", async locale => {
    const dated = {...automation, createdAt:"2026-10-01T10:00:00Z", updatedAt:"2026-10-09T12:00:00Z"};
    const {host, panel, send} = await setup(request => request.path.startsWith("/api/v1/automations?")
      ? {status:200, body:{automations:[dated], canCreate:true}} : request.path.startsWith("/api/v1/automations/workflow?")
        ? {status:200, body:{...detail, automation:dated}} : undefined, locale);
    const card = host.querySelector<HTMLElement>('[data-testid="workflow-card-workflow"]')!;
    expect(card.querySelector("h3")?.textContent).toBe(locale === "en"
      ? "When a matching message is posted, wait 2 seconds, then 2 more steps"
      : "发布符合条件的消息时，等待 2 秒，然后执行另外 2 个步骤");
    expect(card.querySelector('[data-testid="workflow-card-name"]')?.textContent).toBe(content.name);
    expect(card.querySelector('[data-testid="workflow-card-channel"]')?.textContent).toBe("#Channel");
    expect(card.querySelector("time")?.getAttribute("datetime")).toBe(dated.updatedAt);
    expect(card.querySelector("time")?.textContent).toBe(new Date(dated.updatedAt).toLocaleDateString(locale));
    expect(card.querySelector("select, dl")).toBeNull();
    expect(panel.closest('[role="dialog"]')).not.toBeNull();
    expect(panel.querySelector("select")).not.toBeNull();
    expect(panel.textContent).toContain("executor");
    expect(panel.textContent).toContain("human");
    expect(send.mock.calls.some(([request]) => request.method !== "GET")).toBe(false);
  });

  it("does not invent a current date for historical definitions", async () => {
    const {host} = await setup();
    expect(host.querySelector('[data-testid="workflow-card-workflow"] time')).toBeNull();
  });

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
    await click(button(panel, "Edit"));
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
    const {host, panel, send} = await setup(undefined, locale);
    await click(panel.querySelector<HTMLButtonElement>(`button[aria-label="${locale === "en" ? "Close" : "关闭"}"]`)!);
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
    expect(button(panel, "Edit").disabled).toBe(true);
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
    const { panel, send } = await setup((request) => request.path.startsWith("/api/v1/automations/workflow?")
      ? { status: 200, body: request.path.includes("versionOffset=5") ? { ...detail, versions: [pinned] }
        : { ...detail, versions: [latest], nextVersionOffset: 5 } } : undefined);
    expect(button(panel, "Edit").disabled).toBe(true);
    await click(button(panel, "Next page"));
    const next = document.querySelector<HTMLElement>('[data-testid="workflow-detail-panel"]')!;
    expect(JSON.parse(next.querySelector('[data-testid="workflow-definition"]')!.textContent!)).toEqual(content);
    await click(button(next, "Edit"));
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
    await click(button(panel, "Edit"));
    expect(document.querySelector('[data-testid="workflow-editor-dialog"]')).toBeNull();
    expect(panel.textContent).toContain("Couldn't load this");
  });
});
