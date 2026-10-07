import { act, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { AutomationManagement } from "../src/react/agents";
import { WorkflowTriggerConditions } from "../src/react/workflow-trigger-conditions";
import { WorkflowScheduleFields } from "../src/react/workflow-schedule-fields";
import { scheduleFormFromTrigger, scheduleTriggerFromForm, type TriggerConfig } from "../src/react/workflow-schedule";
import { useWorkflowAuthorDirectory } from "../src/react/workflow-author-directory";
import { npubEncode } from "nostr-tools/nip19";
import { buildConditionExpressions, parseConditionExpressions, CONDITION_OPERATORS, type ParsedConditionExpression } from "../src/react/workflow-condition-expression";
import type { BffReply, BffRequest } from "../src/transport";
import { button, click, render, settle, type } from "./render";

const platformCrypto = globalThis.crypto;
beforeEach(() => {
  // HTTP LAN browsers expose secure randomness but not randomUUID.
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

describe("original schedule fields with existing native UTC contract", () => {
  async function scheduleEditor(initial: TriggerConfig, locale: "en" | "zh-CN" = "en") {
    function Editor() {
      const [trigger, update] = useState(initial);
      return <><WorkflowScheduleFields trigger={trigger} onUpdate={update} /><output>{JSON.stringify(trigger)}</output></>;
    }
    return render(<PlatformProvider client={createBffClient({send: async () => ({status:503,body:undefined})})} locale={locale}><Editor /></PlatformProvider>);
  }
  const value = (host: HTMLElement): TriggerConfig => JSON.parse(host.querySelector("output")!.textContent!);

  it("retains the seven original frequency cards and native interval values", async () => {
    const host = await scheduleEditor({on:"schedule",cron:"0 9 * * *"});
    expect(host.querySelectorAll('input[name="wf-trigger-frequency"]')).toHaveLength(7);
    for (const [frequency, interval] of [["every_15_minutes", "15m"], ["every_30_minutes", "30m"], ["hourly", "1h"]]) {
      await click(host.querySelector<HTMLInputElement>(`input[value="${frequency}"]`)!);
      expect(value(host)).toEqual({on:"schedule",interval});
    }
    await click(host.querySelector<HTMLInputElement>('input[value="custom_cron"]')!);
    expect(value(host)).toEqual({on:"schedule",cron:"0 * * * *"});
    expect(host.querySelectorAll('input[name="wf-trigger-frequency"]:checked')).toHaveLength(1);
    expect(host.querySelector<HTMLInputElement>('input[value="custom_cron"]')!.checked).toBe(true);
  });

  it("maps visible Sunday and Saturday once to the existing runtime ordinals", async () => {
    const host = await scheduleEditor({on:"schedule",cron:"0 9 * * 2"});
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Monday"]')!.checked).toBe(true);
    await click(host.querySelector<HTMLInputElement>('input[aria-label="Sunday"]')!);
    await click(host.querySelector<HTMLInputElement>('input[aria-label="Monday"]')!);
    expect(value(host).cron).toBe("0 9 * * 1");
    await click(host.querySelector<HTMLInputElement>('input[aria-label="Sunday"]')!);
    expect(value(host).cron).toBe("0 9 * * 1"); // Last weekday cannot be removed.
    await click(host.querySelector<HTMLInputElement>('input[aria-label="Saturday"]')!);
    expect(value(host).cron).toBe("0 9 * * 1,7");
    await click(host.querySelector<HTMLInputElement>('input[aria-label="Sunday"]')!);
    expect(value(host).cron).toBe("0 9 * * 7");
    await type(host.querySelector<HTMLInputElement>('#wf-trigger-time')!, "23:45");
    expect(value(host).cron).toBe("45 23 * * 7");
  });

  it("restores monthly date controls and the original short-month warning", async () => {
    const host = await scheduleEditor({on:"schedule",cron:"0 9 * * *"});
    await click(host.querySelector<HTMLInputElement>('input[value="monthly"]')!);
    await select(host.querySelector<HTMLSelectElement>('#wf-trigger-month-day')!, "31");
    expect(host.querySelector('[role="status"]')!.textContent).toContain("This schedule won’t run in some months.");
    expect(value(host).cron).toBe("0 9 31 * *");
    await select(host.querySelector<HTMLSelectElement>('#wf-trigger-month-day')!, "28");
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it("keeps legacy interval editing and localizes the complete original control", async () => {
    const host = await scheduleEditor({on:"schedule",interval:"5m"}, "zh-CN");
    expect(host.textContent).toContain("已有间隔");
    await type(host.querySelector<HTMLInputElement>('#wf-trigger-interval')!, "1h 2s");
    expect(value(host).interval).toBe("1h 2s");
    await click(host.querySelector<HTMLInputElement>('input[value="weekly"]')!);
    expect(host.textContent).toContain("运行时间（UTC）");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="星期日"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Repeat on");
  });

  it("round-trips existing cron and intervals without rewriting unsupported form shapes", () => {
    for (const trigger of [{on:"schedule",cron:"0 9 * * 1,7"}, {on:"schedule",cron:"0 9 * * MON-FRI"},
      {on:"schedule",cron:"15 0 9 * * MON-FRI 2027"}, {on:"schedule",interval:"1h 2s"}] satisfies TriggerConfig[]) {
      expect(scheduleTriggerFromForm(scheduleFormFromTrigger(trigger))).toEqual(trigger);
    }
  });
});

describe("original workflow action menu with governed consumers", () => {
  it("selects original author filters from the authorized directory, paginates and accepts npub", async () => {
    const alice = "a".repeat(64), bob = "b".repeat(64), carol = "c".repeat(64);
    const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
      if (request.path === "/api/v1/workspaces/workspace/members") return {status:200,body:[
        {principalId:"alice",displayName:"Alice",pubkeys:[alice],state:"ACTIVE"},
      ]};
      if (request.path === "/api/v1/conversation-participants") return {status:200,body:{items:[],nextCursor:"next"}};
      if (request.path === "/api/v1/conversation-participants?cursor=next") return {status:200,body:{items:[
        {principalId:"bob",displayName:"Bob",pubkeys:[bob]},
      ]}};
      return {status:503,body:undefined};
    });
    function Editor() {
      const [value, setValue] = useState("");
      const [drafts, setDrafts] = useState<ParsedConditionExpression[] | null>(null);
      return <><WorkflowTriggerConditions workflowChannelId="workspace" value={value} onChange={setValue}
        conditionDrafts={drafts} onConditionDraftsChange={setDrafts} /><output>{value}</output></>;
    }
    const host = await render(<PlatformProvider client={createBffClient({send})} locale="en"><Editor /></PlatformProvider>);
    await settle();
    await click([...host.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find((node) => node.textContent?.startsWith("Author"))!);
    expect(host.querySelector('[role="listbox"]')!.textContent).toContain("Alice");
    await click(button(host, "Load more authors"));
    const bobOption = [...host.querySelectorAll<HTMLElement>('[role="option"]')].find((node) => node.textContent?.includes("Bob"))!;
    await click(bobOption);
    expect(host.querySelector("output")!.textContent).toBe(`trigger_author == "${bob}"`);
    await click(button(host, "is not"));
    expect(host.querySelector("output")!.textContent).toBe(`trigger_author != "${bob}"`);
    const search = host.querySelector<HTMLInputElement>('[role="combobox"]')!;
    await type(search, npubEncode(carol));
    await settle();
    await act(async () => search.dispatchEvent(new KeyboardEvent("keydown", {key:"Enter",bubbles:true,cancelable:true})));
    expect(host.querySelector("output")!.textContent).toBe(`trigger_author != "${carol}"`);
    expect(send.mock.calls.filter(([request]) => request.method !== "GET")).toHaveLength(0);
  });

  it("ignores late author pages on workspace change and closes the directory on revalidation failure", async () => {
    let finish!: (reply:BffReply) => void;
    let failed = false;
    const send = vi.fn(async (request:BffRequest):Promise<BffReply> => {
      if (request.path === "/api/v1/workspaces/old/members") return new Promise((resolve) => { finish = resolve; });
      if (request.path === "/api/v1/workspaces/new/members") return failed ? {status:403,body:undefined} : {status:200,body:[
        {principalId:"new-person",displayName:"New scope",pubkeys:["b".repeat(64)],state:"ACTIVE"},
      ]};
      return {status:200,body:{items:[]}};
    });
    function Directory({workspace}:{workspace:string}) {
      const directory = useWorkflowAuthorDirectory(workspace);
      return <output>{directory.isError ? "directory failed" : directory.rows.map((person) => person.displayName).join(",")}</output>;
    }
    function Host() {
      const [workspace, setWorkspace] = useState("old");
      return <><button onClick={() => setWorkspace("new")}>Switch</button><Directory key={workspace} workspace={workspace}/></>;
    }
    const host = await render(<PlatformProvider client={createBffClient({send})} locale="en"><Host /></PlatformProvider>);
    await click(button(host,"Switch"));
    expect(host.querySelector("output")!.textContent).toBe("New scope");
    await act(async () => finish({status:200,body:[{principalId:"old-person",displayName:"Old scope",pubkeys:["a".repeat(64)],state:"ACTIVE"}]}));
    await settle();
    expect(host.querySelector("output")!.textContent).toBe("New scope");
    failed = true;
    await act(async () => window.dispatchEvent(new Event("focus")));
    await settle();
    expect(host.querySelector("output")!.textContent).toBe("directory failed");
  });

  it.each([
    ["en", "Edit", "Workflow YAML", "Form", "Review request", "Submit governed request", "Re-check same request"],
    ["zh-CN", "编辑", "工作流 YAML", "表单", "核对请求", "提交受治理请求", "重查原请求"],
  ] as const)("preserves original conditions through form/YAML and UNKNOWN in %s", async (locale, editLabel, yamlLabel, formLabel, reviewLabel, submitLabel, retryLabel) => {
    const { host, send } = await setup(undefined, locale);
    const menu = await openMenu(host, locale === "en" ? "Workflow actions" : "工作流操作");
    const edit = [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((item) => item.textContent === editLabel)!;
    await click(edit);
    const dialog = document.querySelector<HTMLElement>('[data-testid="workflow-editor-dialog"]')!;
    const input = dialog.querySelector<HTMLInputElement>("#wf-trigger-trigger_text-value")!;
    await type(input, 'deploy "中文"');
    const expression = 'str_contains(trigger_text, "deploy \\"中文\\"")';
    await click(button(dialog, yamlLabel));
    expect(dialog.querySelector<HTMLTextAreaElement>("textarea")!.value).toContain("filter:");
    await click(button(dialog, formLabel));
    expect(dialog.querySelector<HTMLInputElement>("#wf-trigger-trigger_text-value")!.value).toBe('deploy "中文"');
    await click(button(dialog, reviewLabel));
    expect(dialog.textContent).toContain(expression);
    await click(button(dialog, submitLabel));
    await click(button(dialog, retryLabel));
    const commands = writes(send);
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual(commands[0]);
    expect(commands[0]).toMatchObject({automationVersionContent: {
      trigger: {kind: "CHANNEL_MESSAGE", textPrefix: "release", filter: expression},
    }});
  });

  it("keeps advanced author/reply conditions until explicitly replacing original trigger filters", async () => {
    const original = 'trigger_author == "' + "a".repeat(64) + '" && !trigger_is_reply';
    function Editor() {
      const [value, setValue] = useState(original);
      const [drafts, setDrafts] = useState<ParsedConditionExpression[] | null>(null);
      return <><WorkflowTriggerConditions value={value} onChange={setValue}
        conditionDrafts={drafts} onConditionDraftsChange={setDrafts} /><output>{value}</output></>;
    }
    const host = await render(<PlatformProvider client={createBffClient({send: async () => ({status:503,body:undefined})})} locale="en"><Editor /></PlatformProvider>);
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Advanced expression"]')!.value).toBe(original);
    const basic = button(host, "Basic");
    await act(async () => basic.dispatchEvent(new MouseEvent("mousedown", {bubbles:true,button:0})));
    await click(basic);
    expect(host.querySelector("output")!.textContent).toBe(original);
    expect(host.textContent).toContain("cannot be undone");
    await click(button(host, "Replace with basic filters"));
    expect(host.querySelector("output")!.textContent).toBe("");
  });

  it("retains all eight original basic expressions and escaped values", () => {
    for (const operator of CONDITION_OPERATORS) {
      const condition = {field: "trigger_text", webhookField: "", operator, value: operator === "is_empty" || operator === "is_not_empty" ? "" : '中文 \\ "quoted"'};
      const expression = buildConditionExpressions([condition]);
      expect(parseConditionExpressions(expression, "message_posted")).toEqual([condition]);
    }
    expect(parseConditionExpressions('trigger_author == "a" && !trigger_is_reply', "message_posted")).toBeNull();
  });

  it.each(["add_reaction", "set_channel_topic", "delay", "request_approval"])(
    "creates %s steps without secure-context randomUUID", async (action) => {
      expect(crypto.randomUUID).toBeUndefined();
      const { host, send } = await setup((request) => request.path.startsWith("/api/v1/automations/workflow?")
        ? { status: 200, body: { ...detail, versions: detail.versions.map((row) => ({ ...row,
          content: { ...row.content, action: { kind: "POST_MESSAGE", template: "Original" } },
        })) } }
        : request.path.startsWith("/api/v1/automations?") ? { status: 200, body: { automations: [automation], canCreate: true,
          availableApprovalPolicies: [{ id: "5d302c74-7f3f-49d5-9583-616e6c9a32a7", version: 1 }] } } : undefined);
      await chooseAction(host, "Edit");
      const dialog = document.querySelector<HTMLElement>('[data-testid="workflow-editor-dialog"]')!;
      if (action === "add_reaction" || action === "set_channel_topic") {
        const control = [...dialog.querySelectorAll("select")].find((field) => [...field.options].some((option) => option.value === action))!;
        await select(control, action);
      } else {
        await click(button(dialog, action === "delay" ? "Add delay" : "Add approval request"));
      }
      await click(button(dialog, "Workflow YAML"));
      const yaml = dialog.querySelector<HTMLTextAreaElement>("textarea")!.value;
      expect(yaml).toContain(`action: ${action}`);
      const ids = [...yaml.matchAll(/\bid: (step_\d+)/g)].map((match) => match[1]!);
      expect(ids).toHaveLength(action === "delay" || action === "request_approval" ? 2 : 1);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^step_\d+$/);
      expect(writes(send)).toHaveLength(0);
    },
  );

  it("preserves ordered message effects and intervening delay across the original form and YAML", async () => {
    const { host, send } = await setup((request) => request.path.startsWith("/api/v1/automations/workflow?")
      ? { status: 200, body: { ...detail, versions: detail.versions.map((row) => ({ ...row,
        content: { ...row.content, action: { kind: "POST_MESSAGE", template: "First {{trigger.text}}" } },
      })) } } : undefined);
    await chooseAction(host, "Edit");
    const dialog = document.querySelector<HTMLElement>('[data-testid="workflow-editor-dialog"]')!;
    await click(button(dialog, "Add message"));
    const messages = dialog.querySelectorAll<HTMLTextAreaElement>("textarea");
    expect(messages).toHaveLength(2);
    await type(messages[1]!, "{{steps.");
    const priorOutputs = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(priorOutputs).toHaveLength(2);
    expect(priorOutputs.every((option) => option.textContent?.includes("steps.step_1.output."))).toBe(true);
    await click(priorOutputs.find((option) => option.textContent?.includes("event_id"))!);
    expect(messages[1]!.value).toBe("{{steps.step_1.output.event_id}}");
    await type(messages[1]!, "Second {{trigger.text}}");
    await click(button(dialog, "Add delay"));
    await type(dialog.querySelector<HTMLInputElement>("#wf-step-1-duration")!, "1m");
    await click(button(dialog, "Workflow YAML"));
    const yaml = dialog.querySelector<HTMLTextAreaElement>("textarea")!.value;
    expect(yaml).toContain("formatVersion: 3");
    expect(yaml.indexOf("First {{trigger.text}}")).toBeLessThan(yaml.indexOf("duration: 1m"));
    expect(yaml.indexOf("duration: 1m")).toBeLessThan(yaml.indexOf("Second {{trigger.text}}"));
    await click(button(dialog, "Form"));
    expect([...dialog.querySelectorAll<HTMLTextAreaElement>("textarea")].map((field) => field.value))
      .toEqual(["First {{trigger.text}}", "Second {{trigger.text}}"]);
    await click(button(dialog, "Review request"));
    await click(button(dialog, "Submit governed request"));
    const commands = writes(send);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ actionKey: "automation.publish_version", automationVersionContent: {
      formatVersion: 3, steps: [
        { action: "send_message", text: "First {{trigger.text}}" },
        { action: "delay", duration: "1m" },
        { action: "send_message", text: "Second {{trigger.text}}" },
      ],
    } });
  });

  it("carries the original template picker through form/YAML into the same governed version request", async () => {
    const { host, send } = await setup((request) => request.path.startsWith("/api/v1/automations/workflow?")
      ? { status: 200, body: { ...detail, versions: detail.versions.map((row) => ({ ...row,
        content: { ...row.content, action: { kind: "POST_MESSAGE", template: "Original" } },
      })) } } : undefined);
    await chooseAction(host, "Edit");
    const dialog = document.querySelector<HTMLElement>('[data-testid="workflow-editor-dialog"]')!;
    const field = dialog.querySelector<HTMLTextAreaElement>("textarea")!;
    await type(field, "Message: {{trigger.te");
    await act(async () => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(field.value).toBe("Message: {{trigger.text}}");
    await click(button(dialog, "Workflow YAML"));
    expect(dialog.querySelector<HTMLTextAreaElement>("textarea")?.value).toContain("Message: {{trigger.text}}");
    await click(button(dialog, "Form"));
    await click(button(dialog, "Review request"));
    await click(button(dialog, "Submit governed request"));
    const commands = writes(send);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ actionKey: "automation.publish_version", resourceId: "workflow",
      automationVersionContent: { action: { kind: "POST_MESSAGE", template: "Message: {{trigger.text}}" } } });
  });

  it("retains original menu and switch visual with Chinese labels", async () => {
    const { host, send } = await setup(undefined, "zh-CN");
    const menu = await openMenu(host, "工作流操作");
    expect(menu.textContent).toContain("编辑");
    expect(menu.textContent).toContain("复制为新草稿");
    expect(menu.textContent).toContain("运行一次");
    expect(host.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
    expect(menu.querySelector('[role="menuitemcheckbox"]')).toBeNull();
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

  it.each([["Run once", "automation.run"], ["Disable workflow", "automation.disable"], ["Delete", "automation.delete"]])(
    "routes %s through the existing confirmed action without optimistic state", async (label, actionKey) => {
      const { host, send } = await setup();
      if (label === "Disable workflow") await click(host.querySelector<HTMLButtonElement>('[role="switch"]')!);
      else await chooseAction(host, label);
      const dialog = document.querySelector<HTMLElement>('[data-testid="workflow-editor-dialog"]')!;
      expect(writes(send)).toHaveLength(0);
      await click(button(dialog, "Review request"));
      await click(button(dialog, "Submit governed request"));
      expect(writes(send)[0]).toMatchObject({ actionKey, resourceId: "workflow", resourceVersion: 2 });
      expect(host.querySelector('[data-testid="workflow-card-workflow"]')?.textContent).toContain("Enabled");
      expect(host.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
    });

  it("does not expose ungranted management or run commands", async () => {
    const { host } = await setup((request) => request.path.startsWith("/api/v1/automations/workflow?")
      ? { status: 200, body: { ...detail, canManage: false, canRun: false } } : undefined);
    const menu = await openMenu(host);
    expect([...menu.querySelectorAll('[role^="menuitem"]')].map((item) => item.textContent)).toEqual(["Copy as new draft"]);
    expect(host.querySelector<HTMLButtonElement>('[role="switch"]')?.disabled).toBe(true);
  });

  it("enables only through explicit published-version and delegation selection", async () => {
    const paused = { ...automation, state: "PAUSED" };
    const { host, send } = await setup((request) => request.path.startsWith("/api/v1/automations?")
      ? { status: 200, body: { automations: [paused], canCreate: true, availableApprovalPolicies: [] } }
      : request.path.startsWith("/api/v1/automations/workflow?")
        ? { status: 200, body: { ...detail, automation: paused, canRun: false } } : undefined);
    await click(host.querySelector<HTMLButtonElement>('[role="switch"]')!);
    const dialog = document.querySelector<HTMLElement>('[data-testid="workflow-editor-dialog"]')!;
    expect(button(dialog, "Review request").disabled).toBe(true);
    const fields = dialog.querySelectorAll("select");
    await select(fields[0]!, "version-old");
    await select(fields[1]!, "grant");
    await click(button(dialog, "Review request"));
    await click(button(dialog, "Submit governed request"));
    expect(writes(send)[0]).toMatchObject({ actionKey: "automation.enable", assetId: "version-old", assetVersion: 1,
      delegationId: "grant", delegationVersion: 1, resourceId: "workflow", resourceVersion: 2 });
    const state = host.querySelector<HTMLElement>('[data-testid="workflow-card-state"]')!;
    expect(state.textContent).toBe("Paused");
    // The open confirmation intentionally aria-hides its background, not its visual layout.
    expect(state.closest('.sr-only, [hidden]')).toBeNull();
    expect(host.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
  });

  it("restores the original card switch, not a duplicate enabled menu command", async () => {
    const { host } = await setup(undefined, "zh-CN");
    const toggle = host.querySelector('[role="switch"]')!;
    expect(toggle.getAttribute("aria-label")).toBe("停用工作流");
    const menu = await openMenu(host, "工作流操作");
    expect(menu.querySelector('[role="menuitemcheckbox"]')).toBeNull();
  });

  it("rechecks permission before the card switch opens a governed disable request", async () => {
    let revoked = false;
    const { host, send } = await setup((request) => request.path.startsWith("/api/v1/automations/workflow?")
      ? { status: 200, body: { ...detail, canManage: !revoked } } : undefined);
    revoked = true;
    await click(host.querySelector<HTMLButtonElement>('[role="switch"]')!);
    expect(document.querySelector('[data-testid="workflow-editor-dialog"]')).toBeNull();
    expect(writes(send)).toHaveLength(0);
    expect(host.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
  });

  it("renders the actual ordered steps in the original three-tile stack", async () => {
    const content = { formatVersion: 3, name: "Ordered steps", trigger: { kind: "CHANNEL_MESSAGE" },
      resultTarget: "TRIGGER_THREAD", steps: [
        { id: "step_1", action: "delay", duration: "1s" },
        { id: "step_2", action: "request_approval", message: "Approve", approvalPolicy: { id: "11111111-1111-4111-8111-111111111111", version: 1 } },
        { id: "step_3", action: "send_message", text: "first" },
        { id: "step_4", action: "send_message", text: "second" },
      ] };
    const { host } = await setup((request) => request.path.startsWith("/api/v1/automations/workflow?")
      ? { status: 200, body: { ...detail, versions: [{ ...detail.versions[0], content }] } } : undefined);
    const stack = host.querySelector('[data-testid="workflow-card-action-stack"]')!;
    expect(stack).not.toBeNull();
    expect(stack.children).toHaveLength(3);
    expect(stack.className).toContain("w-12");
    expect(stack.children[2]?.className).toContain("bg-sky-500");
    expect(stack.children[2]?.querySelector(".lucide-timer")).not.toBeNull();
    expect(stack.children[1]?.querySelector(".lucide-circle-check-big")).not.toBeNull();
    expect(stack.children[0]?.querySelector(".lucide-message-square")).not.toBeNull();
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
