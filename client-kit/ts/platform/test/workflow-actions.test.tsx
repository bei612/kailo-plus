import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { AutomationManagement } from "../src/react/agents";
import type { BffReply, BffRequest } from "../src/transport";
import { button, click, render, settle } from "./render";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

const installation = {
  resourceId: "executor", workspaceId: "workspace", agentResourceId: "agent",
  pinnedVersionAssetId: "agent-version", agentPrincipalId: "agent-principal", agentPrincipalState: "ACTIVE",
  ownerPrincipalId: "human", resourceVersion: 1, resourceState: "ACTIVE", state: "ACTIVE",
  automationResultTargets: ["TRIGGER_THREAD", "CHANNEL"], activeProjectionGeneration: 1,
  projection: { generation: 1, agentVersionAssetId: "agent-version", runtimeProfileKey: "profile",
    configHash: "a".repeat(64), state: "ACTIVE" },
};
const automation = { resourceId: "workflow", workspaceId: "workspace", ownerPrincipalId: "human",
  executorInstallationResourceId: "executor", resourceVersion: 2, resourceState: "ACTIVE", state: "ENABLED",
  pinnedVersionAssetId: "version-new", delegationId: "grant" };
const version = (assetId: string, ordinal: number, name: string) => ({
  assetId, ordinal, automationResourceId: "workflow", ownerPrincipalId: "human", assetVersion: 1,
  state: "PUBLISHED", configHash: "b".repeat(64), content: { name,
    trigger: { kind: "CHANNEL_MESSAGE", textPrefix: "release" },
    action: { kind: "AGENT_TURN", template: `${name} instructions` }, resultTarget: "TRIGGER_THREAD" },
});
const detail = { automation, canManage: true, canRun: true,
  versions: [version("version-new", 2, "Latest"), version("version-old", 1, "Selected older version")],
  delegations: [{ delegationId: "grant", delegationVersion: 1, ownerPrincipalId: "human",
    executorInstallationResourceId: "executor", expiresAt: "2099-01-01T00:00:00Z" }],
};

async function setup(override?: (request: BffRequest) => BffReply | Promise<BffReply> | undefined,
  locale: "en" | "zh-CN" = "en") {
  const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
    const changed = override?.(request);
    if (changed) return changed;
    if (request.path === "/api/v1/workspaces") return { status: 200, body: [
      { id: "workspace", name: "Channel", slug: "channel" }, { id: "other", name: "Other", slug: "other" },
    ] };
    if (request.path === "/api/v1/tasks") return { status: 200, body: [] };
    if (request.path.startsWith("/api/v1/automations?")) return { status: 200,
      body: { automations: request.path.includes("other") ? [] : [automation], canCreate: true, availableApprovalPolicies: [] } };
    if (request.path.startsWith("/api/v1/automations/workflow?")) return { status: 200, body: detail };
    if (request.path.startsWith("/api/v1/agent-installations?")) return { status: 200, body: { installations: [installation] } };
    if (request.path === "/api/v1/agent-installations/executor") return { status: 200, body: installation };
    if (request.path === "/api/v1/actions") return { status: 202, body: {
      actionKey: (request.body as { actionKey: string }).actionKey,
      actionExecutionId: "execution", operationId: "operation", gateState: "ALLOWED", dispatchState: "UNKNOWN",
    } };
    return { status: 503, body: undefined };
  });
  const host = await render(<PlatformProvider client={createBffClient({ send })} locale={locale}>
    <AutomationManagement />
  </PlatformProvider>);
  await settle();
  return { host, send };
}

async function openMenu(host: HTMLElement, label = "Workflow actions") {
  const trigger = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  expect(trigger).not.toBeNull();
  await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await settle();
  return document.querySelector<HTMLElement>('[role="menu"]')!;
}
async function chooseAction(host: HTMLElement, label: string) {
  const menu = await openMenu(host);
  const item = [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((node) => node.textContent === label)!;
  expect(item).toBeDefined();
  await click(item);
}
async function select(select: HTMLSelectElement, value: string) {
  await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle();
}
const writes = (send: ReturnType<typeof vi.fn>) => send.mock.calls.map(([request]) => request as BffRequest)
  .filter((request) => request.method === "POST").map((request) => request.body);

describe("original workflow action menu with governed consumers", () => {
  it("retains original menu and switch visual with Chinese labels", async () => {
    const { host, send } = await setup(undefined, "zh-CN");
    const menu = await openMenu(host, "工作流操作");
    expect(menu.textContent).toContain("编辑");
    expect(menu.textContent).toContain("复制为新草稿");
    expect(menu.textContent).toContain("运行一次");
    expect(menu.querySelector('[role="menuitemcheckbox"]')?.getAttribute("aria-checked")).toBe("true");
    expect(menu.querySelector('[data-testid="workflow-enabled-switch-visual"]')).not.toBeNull();
    expect(writes(send)).toHaveLength(0);
  });

  it("edits the selected immutable version through form/YAML and retains UNKNOWN intent", async () => {
    const { host, send } = await setup();
    await select(host.querySelector<HTMLSelectElement>('[data-testid="workflow-card-workflow"] select')!, "version-old");
    await chooseAction(host, "Edit");
    const dialog = document.querySelector<HTMLElement>('[data-testid="workflow-editor-dialog"]')!;
    expect(dialog.textContent).toContain("Selected older version");
    await click(button(dialog, "Workflow YAML"));
    expect(dialog.querySelector<HTMLTextAreaElement>("textarea")?.value).toContain("Selected older version instructions");
    await click(button(dialog, "Form"));
    await click(button(dialog, "Review request"));
    await click(button(dialog, "Submit governed request"));
    expect(dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.disabled).toBe(true);
    await click(button(dialog, "Re-check same request"));
    const commands = writes(send);
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual(commands[0]);
    expect(commands[0]).toMatchObject({ actionKey: "automation.publish_version", resourceId: "workflow", resourceVersion: 2,
      automationVersionContent: { name: "Selected older version", action: { template: "Selected older version instructions" } } });
  });

  it("copies the selected readable version but does not inherit source authority or execution state", async () => {
    const { host, send } = await setup();
    await select(host.querySelector<HTMLSelectElement>('[data-testid="workflow-card-workflow"] select')!, "version-old");
    await chooseAction(host, "Copy as new draft");
    const dialog = document.querySelector<HTMLElement>('[data-testid="workflow-editor-dialog"]')!;
    const executor = [...dialog.querySelectorAll("label")].find((label) => label.textContent?.startsWith("Executor installation"))!;
    await select(executor.querySelector("select")!, "executor");
    await click(button(dialog, "Review request"));
    await click(button(dialog, "Submit governed request"));
    const command = writes(send)[0];
    expect(command).toMatchObject({ actionKey: "automation.create", workspaceId: "workspace", executorInstallationResourceId: "executor",
      automationVersionContent: { name: "Selected older version" } });
    expect(command).not.toHaveProperty("resourceId");
    expect(command).not.toHaveProperty("delegationId");
    expect(command).not.toHaveProperty("assetId");
  });

  it.each([["Run once", "automation.run"], ["Enable", "automation.disable"], ["Delete", "automation.delete"]])(
    "routes %s through the existing confirmed action without optimistic state", async (label, actionKey) => {
      const { host, send } = await setup();
      await chooseAction(host, label);
      const dialog = document.querySelector<HTMLElement>('[data-testid="workflow-editor-dialog"]')!;
      expect(writes(send)).toHaveLength(0);
      await click(button(dialog, "Review request"));
      await click(button(dialog, "Submit governed request"));
      expect(writes(send)[0]).toMatchObject({ actionKey, resourceId: "workflow", resourceVersion: 2 });
      expect(host.querySelector('[data-testid="workflow-card-workflow"]')?.textContent).toContain("Enabled");
    });

  it("does not expose ungranted management or run commands", async () => {
    const { host } = await setup((request) => request.path.startsWith("/api/v1/automations/workflow?")
      ? { status: 200, body: { ...detail, canManage: false, canRun: false } } : undefined);
    const menu = await openMenu(host);
    expect([...menu.querySelectorAll('[role^="menuitem"]')].map((item) => item.textContent)).toEqual(["Copy as new draft"]);
  });

  it("enables only through explicit published-version and delegation selection", async () => {
    const paused = { ...automation, state: "PAUSED" };
    const { host, send } = await setup((request) => request.path.startsWith("/api/v1/automations?")
      ? { status: 200, body: { automations: [paused], canCreate: true, availableApprovalPolicies: [] } }
      : request.path.startsWith("/api/v1/automations/workflow?")
        ? { status: 200, body: { ...detail, automation: paused, canRun: false } } : undefined);
    await chooseAction(host, "Enable");
    const dialog = document.querySelector<HTMLElement>('[data-testid="workflow-editor-dialog"]')!;
    expect(button(dialog, "Review request").disabled).toBe(true);
    const fields = dialog.querySelectorAll("select");
    await select(fields[0]!, "version-old");
    await select(fields[1]!, "grant");
    await click(button(dialog, "Review request"));
    await click(button(dialog, "Submit governed request"));
    expect(writes(send)[0]).toMatchObject({ actionKey: "automation.enable", assetId: "version-old", assetVersion: 1,
      delegationId: "grant", delegationVersion: 1, resourceId: "workflow", resourceVersion: 2 });
    expect(host.querySelector('[data-testid="workflow-card-workflow"]')?.textContent).toContain("Paused");
  });

  it("drops a late menu read after the user changes Workspace", async () => {
    let delay = false;
    let resolve!: (reply: BffReply) => void;
    const { host, send } = await setup((request) => delay && request.path.startsWith("/api/v1/automations/workflow?")
      ? new Promise((finish) => { resolve = finish; }) : undefined);
    delay = true;
    await chooseAction(host, "Edit");
    await select(host.querySelector("select")!, "other");
    await act(async () => resolve({ status: 200, body: detail }));
    await settle();
    expect(document.querySelector('[data-testid="workflow-editor-dialog"]')).toBeNull();
    expect(writes(send)).toHaveLength(0);
  });

  it("refuses an action when fresh detail revokes management", async () => {
    let revoked = false;
    const { host, send } = await setup((request) => request.path.startsWith("/api/v1/automations/workflow?")
      ? { status: 200, body: { ...detail, canManage: !revoked } } : undefined);
    revoked = true;
    await chooseAction(host, "Edit");
    expect(document.querySelector('[data-testid="workflow-editor-dialog"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Couldn't load this");
    expect(writes(send)).toHaveLength(0);
  });
});
