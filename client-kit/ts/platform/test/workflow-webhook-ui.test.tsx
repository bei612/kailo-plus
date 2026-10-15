import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { AutomationManagement } from "../src/react/agents";
import type { BffReply, BffRequest } from "../src/transport";
import { button, click, render, settle } from "./render";

// DD-116: a form-created WEBHOOK workflow as Core reads it back, through the
// card, detail panel, edit/publish, rotate and the one-time secret dialog.
const platformCrypto = globalThis.crypto;
beforeEach(() => {
  vi.stubGlobal("crypto", { getRandomValues: platformCrypto.getRandomValues.bind(platformCrypto) });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

const installation = {
  resourceId: "executor", workspaceId: "workspace", agentResourceId: "agent",
  pinnedVersionAssetId: "agent-version", agentPrincipalId: "agent-principal", agentPrincipalState: "ACTIVE",
  ownerPrincipalId: "human", resourceVersion: 1, resourceState: "ACTIVE", state: "ACTIVE",
  automationResultTargets: ["TRIGGER_THREAD", "CHANNEL"], activeProjectionGeneration: 1,
  projection: { generation: 1, agentVersionAssetId: "agent-version", runtimeProfileKey: "profile",
    configHash: "a".repeat(64), state: "ACTIVE" },
};
// Exactly what automation_query returns for a form-created WEBHOOK version.
const content = { name: "Deploy hook", trigger: { kind: "WEBHOOK" }, resultTarget: "CHANNEL", formatVersion: 3,
  steps: [{ id: "step_1", action: "send_message", text: "Deployed {{trigger.service}}" }] };
const automation = { resourceId: "workflow", workspaceId: "workspace", ownerPrincipalId: "human",
  executorInstallationResourceId: "executor", resourceVersion: 2, resourceState: "ACTIVE", state: "ENABLED",
  pinnedVersionAssetId: "version", delegationId: "grant",
  webhookUrl: "http://192.168.0.193:58093/hooks/workflow", webhookSecretHint: "Ab0=" };
const detail = { automation, canManage: true, canRun: true,
  versions: [{ assetId: "version", ordinal: 1, automationResourceId: "workflow", ownerPrincipalId: "human",
    assetVersion: 1, state: "PUBLISHED", configHash: "b".repeat(64), content }],
  delegations: [{ delegationId: "grant", delegationVersion: 1, ownerPrincipalId: "human",
    executorInstallationResourceId: "executor", expiresAt: "2099-01-01T00:00:00Z" }],
};
const secret = `whsec_${"B".repeat(43)}=`;

async function setup() {
  const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
    if (request.path === "/api/v1/workspaces") return { status: 200, body: [{ id: "workspace", name: "Channel", slug: "channel" }] };
    if (request.path === "/api/v1/tasks") return { status: 200, body: [] };
    if (request.path.startsWith("/api/v1/automations?")) return { status: 200,
      body: { automations: [automation], canCreate: true, availableApprovalPolicies: [] } };
    if (request.path.startsWith("/api/v1/automations/workflow?")) return { status: 200, body: detail };
    if (request.path.startsWith("/api/v1/agent-installations?")) return { status: 200, body: { installations: [installation] } };
    if (request.path === "/api/v1/agent-installations/executor") return { status: 200, body: installation };
    if (request.path === "/api/v1/actions") {
      const actionKey = (request.body as { actionKey: string }).actionKey;
      return { status: 202, body: { actionKey, actionExecutionId: "execution", operationId: "operation",
        gateState: "ALLOWED", dispatchState: "DISPATCHED",
        ...(actionKey === "automation.rotate_webhook_secret"
          ? { webhookSecret: { automationResourceId: "workflow", secret, hint: "BBB=", url: automation.webhookUrl } } : {}) } };
    }
    return { status: 503, body: undefined };
  });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = await render(<QueryClientProvider client={cache}><PlatformProvider client={createBffClient({ send })} locale="en">
    <AutomationManagement />
  </PlatformProvider></QueryClientProvider>);
  await settle();
  return { host, send };
}

const writes = (send: ReturnType<typeof vi.fn>) => send.mock.calls.map(([request]) => request as BffRequest)
  .filter((request) => request.method === "POST").map((request) => request.body as Record<string, unknown>);

async function chooseAction(host: HTMLElement, label: string) {
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Workflow actions"]')!;
  await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await settle();
  const item = [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((node) => node.textContent === label)!;
  expect(item).toBeDefined();
  await click(item);
}

describe("WEBHOOK workflow UI path", () => {
  it("renders Core's WEBHOOK read shape as a normal card and detail", async () => {
    const { host } = await setup();
    const card = host.querySelector<HTMLElement>('[data-testid="workflow-card-workflow"]')!;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain("Deploy hook");
    expect(card.textContent).toContain("When a webhook arrives");
    await click(button(host, "View definition"));
    const panel = document.querySelector<HTMLElement>('[data-testid="workflow-detail-panel"]')!;
    expect(panel.textContent).toContain("http://192.168.0.193:58093/hooks/workflow");
    expect(panel.textContent).toContain("Ends in Ab0=");
    expect(panel.textContent).toContain("Rotate secret");
  });

  it("publishes an edited WEBHOOK version with its name, trigger and Channel result", async () => {
    const { host, send } = await setup();
    await chooseAction(host, "Edit");
    const dialog = document.querySelector<HTMLElement>('[data-testid="workflow-editor-dialog"]')!;
    await click(button(dialog, "Workflow YAML"));
    const yaml = dialog.querySelector<HTMLTextAreaElement>("textarea")!.value;
    expect(yaml).toContain("kind: WEBHOOK");
    expect(yaml).toContain("resultTarget: CHANNEL");
    expect(yaml).toContain("name: Deploy hook");
    await click(button(dialog, "Form"));
    await click(button(dialog, "Save changes"));
    await click(button(dialog, "Submit governed request"));
    expect(writes(send)[0]).toMatchObject({ actionKey: "automation.publish_version", automationVersionContent: {
      name: "Deploy hook", trigger: { kind: "WEBHOOK" }, resultTarget: "CHANNEL",
      steps: [{ action: "send_message", text: "Deployed {{trigger.service}}" }] } });
  });

  it("rotates the key and shows the new secret once", async () => {
    const { host, send } = await setup();
    await click(button(host, "View definition"));
    const panel = document.querySelector<HTMLElement>('[data-testid="workflow-detail-panel"]')!;
    await click(button(panel, "Rotate secret"));
    const dialog = document.querySelector<HTMLElement>('[data-testid="workflow-editor-dialog"]')!;
    expect(dialog.textContent).toContain("The current secret stops working immediately");
    await click(button(dialog, "Review request"));
    await click(button(dialog, "Submit governed request"));
    expect(writes(send)[0]).toMatchObject({ actionKey: "automation.rotate_webhook_secret", resourceId: "workflow", resourceVersion: 2 });
    const reveal = document.querySelector<HTMLElement>('[data-testid="workflow-webhook-secret-dialog"]')!;
    expect(reveal).not.toBeNull();
    expect(reveal.textContent).toContain(automation.webhookUrl);
    expect(reveal.textContent).not.toContain(secret);
  });
});
