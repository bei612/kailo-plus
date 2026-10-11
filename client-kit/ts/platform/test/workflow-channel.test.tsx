import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { createBffClient } from "../src/client";
import { AutomationManagement } from "../src/react/agents";
import { ChannelCombobox } from "../src/react/workflow-channel-combobox";
import { PlatformProvider } from "../src/react/context";
import { WorkspaceVisibility } from "@client-kit/contracts";
import type { BffReply, BffRequest } from "../src/transport";
import { button, click, render, settle, type } from "./render";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

const channels = [
  {id: "one", name: "First channel", slug: "first", visibility: WorkspaceVisibility.Open},
  {id: "two", name: "Second channel", slug: "second", visibility: WorkspaceVisibility.Private},
];
const draft = {name: "Retained draft", description: "Original description", trigger: {kind: "CHANNEL_MESSAGE"},
  action: {kind: "POST_MESSAGE", template: "Preserved message"}, resultTarget: "TRIGGER_THREAD"};
const policy = {id: "5d302c74-7f3f-49d5-9583-616e6c9a32a7", version: 1};
function executor(scope: string) {
  return {resourceId: `executor-${scope}`, workspaceId: scope, agentResourceId: "agent",
    pinnedVersionAssetId: "agent-version", agentPrincipalId: "agent-principal", agentPrincipalState: "ACTIVE",
    ownerPrincipalId: "human", resourceVersion: 1, resourceState: "ACTIVE", state: "ACTIVE",
    automationResultTargets: ["TRIGGER_THREAD", "CHANNEL"], activeProjectionGeneration: 1,
    projection: {generation: 1, agentVersionAssetId: "agent-version", runtimeProfileKey: "profile", configHash: "a".repeat(64), state: "ACTIVE"}};
}
async function changeSelect(select: HTMLSelectElement, value: string) {
  await act(async () => { select.value = value; select.dispatchEvent(new Event("change", {bubbles: true})); });
  await settle();
}
async function createDraft(denied = false, draftBody: unknown = draft) {
  const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
    const scope = new URL(request.path, "https://test.invalid").searchParams.get("workspaceId");
    if (request.path === "/api/v1/workspaces") return {status: 200, body: channels};
    if (request.path === "/api/v1/tasks") return {status: 200, body: []};
    if (request.path.startsWith("/api/v1/automations?")) return {status: 200, body: {automations: [], canCreate: !(denied && scope === "two"), availableApprovalPolicies: scope === "one" ? [policy] : []}};
    if (request.path.startsWith("/api/v1/agent-installations?")) return {status: 200, body: {installations: [executor(scope!)]}};
    return {status: 503, body: undefined};
  });
  const client = createBffClient({send});
  const cache = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const host = await render(<QueryClientProvider client={cache}><PlatformProvider client={client} locale="en"><AutomationManagement /></PlatformProvider></QueryClientProvider>);
  await settle();
  await click(host.querySelector<HTMLElement>('[data-testid="new-workflow-card"]')!);
  const dialog = document.querySelector<HTMLElement>('[data-testid="workflow-editor-dialog"]')!;
  await changeSelect(dialog.querySelector<HTMLSelectElement>("select:has(option[value=executor-one])")!, "executor-one");
  await click(button(dialog, "Workflow YAML"));
  const yaml = dialog.querySelector<HTMLTextAreaElement>("textarea")!;
  await type(yaml, stringify(draftBody));
  return {dialog, send, yaml};
}
async function chooseSecond(dialog: HTMLElement) {
  await click(dialog.querySelector<HTMLElement>("#wf-channel-select")!);
  const search = document.querySelector<HTMLInputElement>('input[aria-label="Search channels"]')!;
  await type(search, "Second");
  await act(async () => { search.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true})); });
  await settle();
}

describe("original channel chooser with scoped workflow draft consumers", () => {
  it("keeps YAML/name/description while clearing the old executor and reading new admission", async () => {
    const {dialog, send, yaml} = await createDraft();
    await chooseSecond(dialog);
    expect(yaml.value).toBe(stringify(draft));
    expect(dialog.querySelector("#wf-channel-select")?.textContent).toContain("Second channel");
    expect(dialog.querySelector("option[value=executor-one]")).toBeNull();
    const selected = dialog.querySelector<HTMLSelectElement>("select:has(option[value=executor-two])")!;
    expect(selected.value).toBe("");
    expect(dialog.querySelector('button[type="submit"]')).toBeNull();
    expect(send.mock.calls.some(([request]) => request.path.startsWith("/api/v1/automations?") && request.path.includes("workspaceId=two"))).toBe(true);
    await changeSelect(selected, "executor-two");
    await click(button(dialog, "Review request"));
    expect(dialog.textContent).toContain("automation.create · two");
    expect(dialog.textContent).toContain("executor-two");
    expect(dialog.textContent).toContain("Retained draft");
    expect(dialog.querySelector("#wf-channel-select")).toBeNull();
    expect(send.mock.calls.some(([request]) => request.method !== "GET")).toBe(false);
  });

  it("does not treat discoverable channels as fresh create permission", async () => {
    const {dialog, send, yaml} = await createDraft(true);
    await chooseSecond(dialog);
    const selected = dialog.querySelector<HTMLSelectElement>("select:has(option[value=executor-two])")!;
    await changeSelect(selected, "executor-two");
    expect(yaml.value).toBe(stringify(draft));
    expect(dialog.querySelector('button[type="submit"]')).toBeNull();
    expect(send.mock.calls.some(([request]) => request.method !== "GET")).toBe(false);
  });

  it.each(["form", "yaml", "unchanged-yaml-to-form"] as const)("keeps explicit top-level approval after scope change in %s", async mode => {
    const approved = {...draft, approvalPolicy: policy};
    const {dialog, send} = await createDraft(false, approved);
    if (mode !== "yaml") {
      await click(button(dialog, "Form"));
      expect(button(dialog, "Form").getAttribute("aria-pressed")).toBe("true");
      if (mode === "unchanged-yaml-to-form") await click(button(dialog, "Workflow YAML"));
    }
    await chooseSecond(dialog);
    await changeSelect(dialog.querySelector<HTMLSelectElement>("select:has(option[value=executor-two])")!, "executor-two");
    if (mode === "unchanged-yaml-to-form") await click(button(dialog, "Form"));
    if (mode === "yaml") {
      expect(dialog.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(stringify(approved));
    } else {
      const approval = [...dialog.querySelectorAll("select")].find(select => [...select.options].some(option => option.value === `${policy.id}:${policy.version}`))!;
      expect(approval.value).toBe(`${policy.id}:${policy.version}`);
      expect(approval.selectedOptions[0]?.disabled).toBe(true);
      await click(button(dialog, "Workflow YAML"));
      expect(button(dialog, "Form").getAttribute("aria-pressed")).toBe("true");
    }
    expect(dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    expect(send.mock.calls.some(([request]) => request.method !== "GET")).toBe(false);
  });

  it.each(["form", "yaml"] as const)("keeps the original step approval reference after scope change in %s", async mode => {
    const approved = {name: draft.name, trigger: draft.trigger, formatVersion: 3, resultTarget: draft.resultTarget,
      steps: [{id: "approval", action: "request_approval", message: "Please approve", approvalPolicy: policy},
        {id: "message", action: "send_message", text: "Keep this gated"}]};
    const {dialog, send} = await createDraft(false, approved);
    if (mode === "form") await click(button(dialog, "Form"));
    await chooseSecond(dialog);
    await changeSelect(dialog.querySelector<HTMLSelectElement>("select:has(option[value=executor-two])")!, "executor-two");
    if (mode === "form") await click(button(dialog, "Workflow YAML"));
    expect(dialog.querySelector<HTMLTextAreaElement>("textarea")!.value).toContain(`id: ${policy.id}`);
    expect(dialog.querySelector<HTMLTextAreaElement>("textarea")!.value).toContain("action: request_approval");
    expect(dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    expect(send.mock.calls.some(([request]) => request.method !== "GET")).toBe(false);
  });

  it("keeps the original immutable-channel control with unknown labels unavailable", async () => {
    const change = vi.fn();
    const host = await render(<PlatformProvider client={createBffClient({send: async () => ({status: 503, body: undefined})})} locale="en">
      <ChannelCombobox channels={channels} value="missing" readOnly onChange={change} />
    </PlatformProvider>);
    const control = host.querySelector<HTMLButtonElement>('button[aria-disabled="true"]')!;
    expect(control.getAttribute("aria-label")).toBe("Channel: Unavailable channel. Read only.");
    await click(control);
    expect(document.querySelector('[data-testid="channel-combobox-list"]')).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });
});
