import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationVersionContent } from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { translate, type PlatformMessageKey } from "../src/i18n";
import { AutomationManagement } from "../src/react/agents";
import { PlatformProvider } from "../src/react/context";
import { getWorkflowActivationWarning } from "../src/react/workflow-activation-warning";
import { reactionConditionValue } from "../src/react/workflow-reaction-condition";
import { WorkflowTriggerConditions } from "../src/react/workflow-trigger-conditions";
import type { ParsedConditionExpression } from "../src/react/workflow-condition-expression";
import type { BffReply, BffRequest } from "../src/transport";
import { button, click, render, settle } from "./render";

const t = (key: PlatformMessageKey, variables?: Record<string, string | number>) => translate("en", key, variables);
const content = (trigger: AutomationVersionContent["trigger"]): AutomationVersionContent => ({
  name: "Test", trigger, action: {kind: "POST_MESSAGE", template: "Hi"},
  resultTarget: trigger.kind === "SCHEDULE" ? "CHANNEL" : "TRIGGER_THREAD",
} as unknown as AutomationVersionContent);
const cron = (expression: string) => getWorkflowActivationWarning(content({kind: "SCHEDULE",
  scheduleSpec: {kind: "CRON", cron: expression, catchupWindowSeconds: 60}} as unknown as AutomationVersionContent["trigger"]), t)?.description ?? null;
const every = (minutes: number) => `It is scheduled to run every ${minutes} minutes. Review the schedule before turning it on.`;
const hourly = "It is scheduled to run every hour. Review the schedule before turning it on.";

// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/workflows/ui/workflowActivationWarning.test.mjs cases over AutomationVersionContent.
describe("original workflow activation warning", () => {
  it("warns only for an unnarrowed channel message trigger", () => {
    expect(getWorkflowActivationWarning(content({kind: "CHANNEL_MESSAGE"} as unknown as AutomationVersionContent["trigger"]), t)).toEqual({
      description: "It will run for every new message in this channel. Review the trigger before turning it on.",
      title: "This workflow may run often",
    });
    expect(getWorkflowActivationWarning(content({kind: "CHANNEL_MESSAGE", filter: 'str_contains(trigger_text, "deploy")'} as unknown as AutomationVersionContent["trigger"]), t)).toBeNull();
    expect(getWorkflowActivationWarning(content({kind: "CHANNEL_MESSAGE", textPrefix: "/deploy"} as unknown as AutomationVersionContent["trigger"]), t)).toBeNull();
    expect(getWorkflowActivationWarning(content({kind: "REACTION_ADDED"} as unknown as AutomationVersionContent["trigger"]), t)).toBeNull();
  });

  it("warns for hourly-or-faster interval schedules with concrete copy", () => {
    const interval = (everySeconds: number) => getWorkflowActivationWarning(content({kind: "SCHEDULE",
      scheduleSpec: {everySeconds, offsetSeconds: 0, catchupWindowSeconds: 60}} as unknown as AutomationVersionContent["trigger"]), t)?.description ?? null;
    expect(interval(900)).toBe(every(15));
    expect(interval(7200)).toBeNull();
  });

  it("classifies clear, stepped, ranged and listed cron schedules", () => {
    for (const expression of ["*/5 * * * *", "0 */5 * * * *", "0 */5 * * * * *", "*/5 0-23 * * *"]) expect(cron(expression)).toBe(every(5));
    expect(cron("*/10 * * * * *")).toBe("It is scheduled to run multiple times a minute. Review the schedule before turning it on.");
    for (const expression of ["0 0 */1 * * *", "0 0 * * * *", "0 0 0-23 * * *", "0 0 0-11,12-23 * * *", "0 0 */1 * * * *"]) expect(cron(expression)).toBe(hourly);
    for (const expression of ["0 9 * * *", "0 */3 * * *", "0 0 0,12 * * *", "0 0 8-17 * * *"]) expect(cron(expression)).toBeNull();
  });
});

// desktop/src/features/workflows/ui/workflowReactionCondition.test.mjs cases.
describe("original legacy reaction emoji condition", () => {
  const a = "a".repeat(64);
  const b = "b".repeat(64);
  it("folds the legacy emoji into the structured filter and preserves alternatives", () => {
    expect(reactionConditionValue(`trigger_author == "${a}"`, "🔥")).toBe(`trigger_emoji == "🔥" && trigger_author == "${a}"`);
    expect(reactionConditionValue(`trigger_author == "${a}" || trigger_author == "${b}"`, "✅"))
      .toBe(`trigger_emoji == "✅" && (trigger_author == "${a}" || trigger_author == "${b}")`);
    expect(reactionConditionValue(`(trigger_author == "${a}" || trigger_author == "${b}")`, "✅"))
      .toBe(`trigger_emoji == "✅" && (trigger_author == "${a}" || trigger_author == "${b}")`);
    expect(reactionConditionValue("trigger_text", undefined)).toBe("trigger_text");
  });
});

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

function reply(request: BffRequest, trigger: AutomationVersionContent["trigger"]): BffReply {
  const automation = {resourceId: "workflow", workspaceId: "workspace", ownerPrincipalId: "human",
    executorInstallationResourceId: "executor", resourceVersion: 2, resourceState: "ACTIVE", state: "DRAFT"};
  if (request.path === "/api/v1/workspaces") return {status: 200, body: [{id: "workspace", name: "Channel", slug: "channel"}]};
  if (request.path === "/api/v1/tasks") return {status: 200, body: []};
  if (request.path === "/api/v1/custom-emoji") return {status: 503, body: undefined};
  if (request.path.startsWith("/api/v1/automations?")) return {status: 200, body: {automations: [automation], canCreate: false, availableApprovalPolicies: []}};
  if (request.path.startsWith("/api/v1/automations/workflow?")) return {status: 200, body: {automation, canManage: true,
    versions: [{assetId: "version", ordinal: 1, automationResourceId: "workflow", ownerPrincipalId: "human", assetVersion: 1,
      state: "PUBLISHED", configHash: "b".repeat(64), content: content(trigger)}],
    delegations: [{delegationId: "grant", delegationVersion: 1, ownerPrincipalId: "human", executorInstallationResourceId: "executor",
      expiresAt: "2099-01-01T00:00:00Z"}]}};
  if (request.path === "/api/v1/agent-installations/executor") return {status: 503, body: undefined};
  return {status: 503, body: undefined};
}

async function mountCard(trigger: AutomationVersionContent["trigger"], locale: "en" | "zh-CN" = "en") {
  const send = vi.fn(async (request: BffRequest): Promise<BffReply> => reply(request, trigger));
  const host = await render(<QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
    <PlatformProvider client={createBffClient({send})} locale={locale}><AutomationManagement /></PlatformProvider>
  </QueryClientProvider>);
  await settle();
  const toggle = host.querySelector<HTMLButtonElement>('[data-testid="workflow-card-workflow"] [role="switch"]')!;
  return {send, toggle};
}

describe("original activation confirmation before the governed enable review", () => {
  it.each(["en", "zh-CN"] as const)("asks before turning on an every-message workflow and keeps it off on cancel (%s)", async locale => {
    const {send, toggle} = await mountCard({kind: "CHANNEL_MESSAGE"} as unknown as AutomationVersionContent["trigger"], locale);
    expect(toggle.disabled).toBe(false);
    await click(toggle);
    const dialog = document.querySelector<HTMLElement>('[data-testid="workflow-activation-confirmation"]')!;
    expect(dialog.textContent).toContain(translate(locale, "workflows.activation.title"));
    expect(dialog.textContent).toContain(translate(locale, "workflows.activation.everyMessage"));
    expect(document.querySelector('[data-testid="workflow-editor-dialog"]')).toBeNull();
    await click(button(dialog, translate(locale, "workflows.activation.keepOff")));
    expect(document.querySelector('[data-testid="workflow-activation-confirmation"]')).toBeNull();
    expect(document.querySelector('[data-testid="workflow-editor-dialog"]')).toBeNull();
    expect(send.mock.calls.filter(([request]) => request.method !== "GET")).toHaveLength(0);

    await click(toggle);
    await click(button(document.querySelector<HTMLElement>('[data-testid="workflow-activation-confirmation"]')!,
      translate(locale, "workflows.activation.turnOn")));
    expect(document.querySelector('[data-testid="workflow-activation-confirmation"]')).toBeNull();
    // Turning on only opens the existing explicit automation.enable review.
    expect(document.querySelector('[data-testid="workflow-editor-dialog"]')?.textContent).toContain(translate(locale, "agents.automation.enable"));
    expect(send.mock.calls.filter(([request]) => request.method !== "GET")).toHaveLength(0);
  });

  it("goes straight to the governed enable review for a narrowed trigger", async () => {
    const {send, toggle} = await mountCard({kind: "CHANNEL_MESSAGE", filter: 'str_contains(trigger_text, "deploy")'} as unknown as AutomationVersionContent["trigger"]);
    await click(toggle);
    expect(document.querySelector('[data-testid="workflow-activation-confirmation"]')).toBeNull();
    expect(document.querySelector('[data-testid="workflow-editor-dialog"]')).not.toBeNull();
    expect(send.mock.calls.filter(([request]) => request.method !== "GET")).toHaveLength(0);
  });
});

describe("original reaction emoji condition field", () => {
  function Harness({initial, onValue}: {initial: string; onValue: (value: string) => void}) {
    const [value, setValue] = useState(initial);
    const [drafts, setDrafts] = useState<ParsedConditionExpression[] | null>(null);
    return <WorkflowTriggerConditions triggerType="reaction_added" value={value} conditionDrafts={drafts}
      onConditionDraftsChange={setDrafts} onChange={next => { setValue(next); onValue(next); }} />;
  }
  async function mountField(initial: string) {
    const values: string[] = [];
    const send = vi.fn(async (): Promise<BffReply> => ({status: 503, body: undefined}));
    const host = await render(<QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
      <PlatformProvider client={createBffClient({send})} locale="en"><Harness initial={initial} onValue={value => values.push(value)} /></PlatformProvider>
    </QueryClientProvider>);
    await settle();
    return {host, values};
  }

  it("summarizes the selected emoji and edits it only through the picker or clear control", async () => {
    const {host, values} = await mountField('trigger_emoji == "🔥"');
    expect(host.textContent).toContain("Selected reaction emoji: 🔥");
    const picker = host.querySelector<HTMLButtonElement>('#wf-trigger-emoji')!;
    expect(picker.getAttribute("aria-label")).toBe("Choose trigger emoji");
    expect(picker.textContent).toContain("🔥");
    expect(host.querySelector('#wf-trigger-trigger_emoji-value')).toBeNull();
    await click(host.querySelector<HTMLButtonElement>('button[aria-label="Clear trigger emoji"]')!);
    expect(values.at(-1)).toBe("");
    expect(host.querySelector<HTMLButtonElement>('#wf-trigger-emoji')!.textContent).toContain("Choose a reaction");
  });

  it("strikes through an excluded emoji", async () => {
    const {host} = await mountField('trigger_emoji != "👀"');
    expect(host.textContent).toContain("Excluded reaction emoji: 👀");
  });
});
