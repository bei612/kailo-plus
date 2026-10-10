import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ChannelType, ErrorClass, ReasonCode, type ActionCommand } from "@client-kit/contracts";
import { AgentMemoryEntryPageState, AgentMemoryReadViewState, type AgentMemoryEntryPage, type AgentMemoryReadView } from "@client-kit/contracts";
import { act, isValidElement, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { AgentDefinitionsPage, AuditPage, DevicesPage, WorkspaceMembersPage } from "../src/react/pages";
import { PlatformProvider } from "../src/react/context";
import { InstallationMemory, validMemoryEntries, validMemoryRead } from "../src/react/memory";
import { ToolManagement, validPlatformToolPage } from "../src/react/tools";
import { WorkflowsPage, validAutomationRuns } from "../src/react/workflows";
import { PlatformNavigation, platformNavigationSections } from "../src/react/navigation";
import { setOverride } from "../src/react/features/store";
import { LegacySecretRefManagement, RoleManagement, RoleMembers } from "../src/react/roles";
import { CreateChannelDialog } from "../src/react/create-channel-dialog";
import { ChannelBrowser } from "../src/react/channel-browser";
import type { BffReply, BffRequest, BffTransport } from "../src/transport";
import { TransportError } from "../src/transport";
import { button, click, render, settle, type } from "./render";

type Route = (request: BffRequest) => BffReply | Promise<BffReply>;

function transport(route: Route): BffTransport & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn(async (r: BffRequest) => route(r)) };
}

async function mount(t: BffTransport, ui: React.ReactNode, locale: "en" | "zh-CN" = "en") {
  const host = await render(
    <PlatformProvider client={createBffClient(t)} locale={locale}>
      {ui}
    </PlatformProvider>,
  );
  // Original Agent dialogs portal beside the page; queries include both real surfaces.
  return isValidElement(ui) && ui.type === AgentDefinitionsPage ? document.body : host;
}

const key = (pubkey: string, state = "ACTIVE") => ({
  pubkey,
  state,
  createdAt: new Date().toISOString(),
});

describe("original channel browser with governed public membership", () => {
  const workspace = { id: "b8acd285-a7de-4b2b-9c26-584ea4f55b59", visibility: "open",
    channel: { channelId: "b8acd285-a7de-4b2b-9c26-584ea4f55b59", channelType: "stream", name: "Release planning", archived: false },
    isMember: false, memberCount: 1, createdAt: "2026-10-06T00:00:00Z", joinActionKey: "workspace.join" };
  function browserEnvironment() {
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  }
  it("does not open on acceptance and refreshes the same membership without a second write", async () => {
    browserEnvironment();
    let membership: "absent" | "PROVISIONING" | "ACTIVE" = "absent";
    const t = transport((request) => {
      if (request.method === "POST") {
        membership = "PROVISIONING";
        return { status: 202, body: { operationId: "join-operation", actionExecutionId: "join-execution",
          actionKey: "workspace.join", gateState: "ALLOWED", dispatchState: "DISPATCHED" } };
      }
      if (request.path.startsWith("/api/v1/discoverable-workspaces")) return { status: 200, body: { items: [{ ...workspace,
        isMember: membership === "ACTIVE", ...(membership === "absent" ? {} : { membershipState: membership, joinActionKey: undefined }),
      }] } };
      if (request.path.startsWith("/api/v1/role-workspaces")) return { status: 200, body: { workspaces: [] } };
      return { status: 200, body: [] };
    });
    const select = vi.fn();
    const close = vi.fn();
    await mount(t, <ChannelBrowser open onOpenChange={close} onSelect={select} />);
    await settle();
    await click(button(document.body, "Join"));
    expect(select).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Being set up");
    membership = "ACTIVE";
    await click(document.querySelector<HTMLButtonElement>("[data-testid=channel-join-status]")!);
    expect(select).toHaveBeenCalledOnce();
    expect(select.mock.calls[0]?.[0]).toMatchObject({ id: workspace.id, isMember: true, membershipState: "ACTIVE" });
    const writes = t.send.mock.calls.map(([r]) => r).filter((r) => r.method === "POST");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.body).toMatchObject({ actionKey: "workspace.join", workspaceId: workspace.id });
    expect(writes[0]?.body).not.toHaveProperty("principalId");
  });
  it("keeps the original idempotency key after a lost join response", async () => {
    browserEnvironment();
    const t = transport((request) => request.method === "POST"
      ? { status: 503, body: { class: ErrorClass.Unknown, reason: ReasonCode.DependencyUnavailable, operationId: "join-operation" } }
      : request.path.startsWith("/api/v1/discoverable-workspaces") ? { status: 200, body: { items: [workspace] } }
      : request.path.startsWith("/api/v1/role-workspaces") ? { status: 200, body: { workspaces: [] } }
      : { status: 200, body: [] });
    const select = vi.fn();
    await mount(t, <ChannelBrowser open onOpenChange={() => {}} onSelect={select} />);
    await settle();
    await click(button(document.body, "Join"));
    await click(document.querySelector<HTMLButtonElement>("[data-testid=channel-join-status]")!);
    const writes = t.send.mock.calls.map(([r]) => r).filter((r) => r.method === "POST");
    expect(writes).toHaveLength(2);
    expect(writes[1]?.body).toEqual(writes[0]?.body);
    expect(select).not.toHaveBeenCalled();
  });
  it("recovers an accepted join after directory read failure without another write", async () => {
    browserEnvironment();
    let accepted = false;
    let recover = false;
    const t = transport((request) => {
      if (request.method === "POST") {
        accepted = true;
        return { status: 202, body: { operationId: "join-operation", actionExecutionId: "join-execution",
          actionKey: "workspace.join", gateState: "ALLOWED", dispatchState: "DISPATCHED" } };
      }
      if (request.path.startsWith("/api/v1/discoverable-workspaces")) {
        if (accepted && !recover) return { status: 503, body: {} };
        return { status: 200, body: { items: [{ ...workspace,
          ...(recover ? { isMember: true, membershipState: "ACTIVE", joinActionKey: undefined } : {}),
        }] } };
      }
      return { status: 200, body: { workspaces: [] } };
    });
    const select = vi.fn();
    await mount(t, <ChannelBrowser open onOpenChange={() => {}} onSelect={select} />);
    await settle();
    await click(button(document.body, "Join"));
    expect(select).not.toHaveBeenCalled();
    recover = true;
    await click(document.querySelector<HTMLButtonElement>("[data-testid=channel-join-status]")!);
    expect(select).toHaveBeenCalledOnce();
    expect(t.send.mock.calls.filter(([request]) => request.method === "POST")).toHaveLength(1);
  });
});

describe("shared original channel creation entry", () => {
  const recorded = { status: 202, body: { operationId: "create-operation", actionExecutionId: "create-execution",
    actionKey: "workspace.create", gateState: "ALLOWED", dispatchState: "DISPATCHED" } };
  function routes(write: Route, allowed = true) {
    return transport((request) => request.method === "POST" ? write(request)
      : request.path.startsWith("/api/v1/role-workspaces") ? { status: 200, body: {
        workspaces: [], ...(allowed ? { createActionKey: "workspace.create" } : {}),
      } } : { status: 200, body: [] });
  }
  async function fill() {
    const dialog = document.querySelector<HTMLElement>("[data-testid=create-channel-dialog]")!;
    const inputs = dialog.querySelectorAll("input");
    await type(inputs[0]!, "Release planning");
    expect(inputs).toHaveLength(1);
    return dialog;
  }
  it("submits the existing governed command and reports acceptance, not channel readiness", async () => {
    const t = routes(() => recorded);
    await mount(t, <CreateChannelDialog open onOpenChange={() => {}} />);
    const dialog = await fill();
    await click(button(dialog, "Create channel"));
    const writes = t.send.mock.calls.map(([request]) => request).filter((request) => request.method === "POST");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ path: "/api/v1/actions", body: {
      actionKey: "workspace.create", name: "Release planning",
      workspaceChannel: { channelType: "stream" },
    } });
    const intent = writes[0]?.body as ActionCommand;
    expect(intent.workspaceChannel?.ttlSeconds).toBeUndefined();
    expect(intent.slug).toBe(intent.idempotencyKey);
    expect(dialog.textContent).toContain("create-execution");
    expect(dialog.textContent).not.toContain("Channel created");
  });
  it("preserves the original forum context and description in the governed creation intent", async () => {
    const t = routes(() => recorded);
    await mount(t, <CreateChannelDialog open channelKind={ChannelType.Forum} onOpenChange={() => {}} />);
    const dialog = await fill();
    expect(dialog.querySelector("h2")?.textContent).toBe("Create a new forum");
    expect(dialog.querySelector<HTMLInputElement>("input")?.placeholder).toBe("design-discussions");
    expect(dialog.querySelector<HTMLTextAreaElement>("textarea")?.placeholder).toBe("What this forum is for");
    await type(dialog.querySelector<HTMLTextAreaElement>("textarea")!, "  Architecture decisions  ");
    await click(button(dialog, "Create forum"));
    expect(t.send.mock.calls.find(([request]) => request.method === "POST")?.[0].body).toMatchObject({
      workspaceChannel: { channelType: "forum", description: "Architecture decisions" },
    });
  });
  it("uses the original public/private control but keeps product visibility outside Relay metadata", async () => {
    const t = routes(() => recorded);
    await mount(t, <CreateChannelDialog open onOpenChange={() => {}} />);
    const dialog = await fill();
    await click(button(dialog, "Create channel"));
    const command = t.send.mock.calls.find(([request]) => request.method === "POST")?.[0].body as ActionCommand;
    expect(command.workspaceVisibility).toBe("open");
    expect(command.workspaceChannel).not.toHaveProperty("visibility");
  });
  it("keeps the original submit footer outside the scroll body and resets a cancelled opening", async () => {
    const t = routes(() => recorded);
    let reopen!: () => void;
    function Host() {
      const [open, setOpen] = useState(true);
      reopen = () => setOpen(true);
      return <CreateChannelDialog open={open} onOpenChange={setOpen} />;
    }
    await mount(t, <Host />);
    const dialog = await fill();
    const form = dialog.querySelector<HTMLFormElement>("form")!;
    expect(form.querySelector('label[for="create-channel-name"]')?.textContent).toBe("Name");
    const submit = button(dialog, "Create channel");
    expect(submit.form).toBe(form);
    expect(form.contains(submit)).toBe(false);
    expect(form.closest(".overflow-y-auto")?.contains(submit)).toBe(false);
    await type(dialog.querySelector<HTMLTextAreaElement>("textarea")!, "Discarded description");
    await click(dialog.querySelector<HTMLButtonElement>("[data-testid=create-channel-permissions-option-private]")!);
    await click(dialog.querySelector<HTMLButtonElement>("[data-testid=create-channel-channel-type-option-temporary]")!);
    await click(dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!);
    await act(async () => reopen());
    await settle();
    const fresh = document.querySelector<HTMLElement>("[data-testid=create-channel-dialog]")!;
    expect(fresh.querySelector<HTMLInputElement>("input")?.value).toBe("");
    expect(fresh.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    expect(fresh.querySelector("[data-testid=create-channel-ttl]")).toBeNull();
    await type(fresh.querySelector<HTMLInputElement>("input")!, "Fresh channel");
    await click(button(fresh, "Create channel"));
    expect(t.send.mock.calls.find(([request]) => request.method === "POST")?.[0].body).toMatchObject({
      name: "Fresh channel", workspaceVisibility: "open", workspaceChannel: { channelType: "stream" },
    });
    expect((t.send.mock.calls.find(([request]) => request.method === "POST")?.[0].body as ActionCommand).workspaceChannel?.ttlSeconds).toBeUndefined();
  });
  it("prefills the browser creation form and keeps UNKNOWN visible instead of returning to browse", async () => {
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const close = vi.fn();
    const t = transport((request) => request.method === "POST" ? { status: 503, body: {
      class: ErrorClass.Unknown, reason: ReasonCode.DependencyUnavailable, operationId: "create-unknown",
    } } : request.path.startsWith("/api/v1/role-workspaces") ? { status: 200, body: {
      workspaces: [], createActionKey: "workspace.create",
    } } : { status: 200, body: { items: [] } });
    await mount(t, <ChannelBrowser open onOpenChange={close} onSelect={() => {}} />);
    await settle();
    await type(document.querySelector<HTMLInputElement>('input')!, "release-notes");
    await click(document.querySelector<HTMLButtonElement>('[data-testid="channel-browser-create-row"]')!);
    const input = document.querySelector<HTMLInputElement>('[data-testid="create-channel-name"]')!;
    expect(input.value).toBe("release-notes");
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(input.value.length);
    const submit = button(document.body, "Create channel");
    expect(submit.form).toBe(document.querySelector("form"));
    expect(submit.form?.closest(".overflow-y-auto")?.contains(submit)).toBe(false);
    await click(submit);
    expect(document.body.textContent).toContain("create-unknown");
    const back = document.querySelector<HTMLButtonElement>('[data-testid="channel-browser-create-back"]')!;
    expect(back.disabled).toBe(true);
    await click(back);
    expect(document.querySelector('[data-testid="create-channel-name"]')).toBe(input);
    expect(input.value).toBe("release-notes");
    expect(close).not.toHaveBeenCalled();
    expect(t.send.mock.calls.filter(([request]) => request.method === "POST")).toHaveLength(1);
  });
  it("keeps the original unknown command and blocks dismissing it until it is located", async () => {
    let writes = 0;
    const t = routes(() => ++writes === 1 ? { status: 503, body: {
      class: ErrorClass.Unknown, reason: ReasonCode.DependencyUnavailable, operationId: "unknown-operation",
    } } : recorded);
    const close = vi.fn();
    await mount(t, <CreateChannelDialog open onOpenChange={close} />);
    const dialog = await fill();
    await click(dialog.querySelector<HTMLButtonElement>("[data-testid=create-channel-channel-type-option-temporary]")!);
    await click(button(dialog, "Create channel"));
    expect(dialog.querySelector<HTMLButtonElement>("button[aria-label=Close]")?.disabled).toBe(true);
    expect([...dialog.querySelectorAll("input")].every((input) => input.disabled)).toBe(true);
    expect(dialog.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(true);
    expect(dialog.querySelector<HTMLButtonElement>("[data-testid=create-channel-ttl]")?.disabled).toBe(true);
    expect(dialog.querySelector<HTMLButtonElement>("[data-testid=create-channel-channel-type-option-ongoing]")?.matches(":disabled")).toBe(true);
    const retry = dialog.querySelector<HTMLButtonElement>("[data-testid=create-channel-submit]")!;
    await click(retry);
    const commands = t.send.mock.calls.map(([request]) => request).filter((request) => request.method === "POST");
    expect(commands).toHaveLength(2);
    expect(commands[1]?.body).toEqual(commands[0]?.body);
    expect(commands[0]?.body).toMatchObject({ workspaceChannel: { ttlSeconds: 604800 } });
    expect(dialog.querySelector<HTMLButtonElement>("button[aria-label=Close]")?.disabled).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });
  it("keeps the original temporary channel presets and submits the selected native TTL", async () => {
    const t = routes(() => recorded);
    await mount(t, <CreateChannelDialog open onOpenChange={() => {}} />);
    const dialog = await fill();
    await click(dialog.querySelector<HTMLButtonElement>("[data-testid=create-channel-channel-type-option-temporary]")!);
    const trigger = dialog.querySelector<HTMLButtonElement>("[data-testid=create-channel-ttl]")!;
    expect(trigger.textContent).toContain("7 days");
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); trigger.focus(); });
    await act(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await settle();
    expect(document.querySelectorAll("[data-testid^=create-channel-ttl-option-]")).toHaveLength(9);
    await click(document.querySelector<HTMLButtonElement>("[data-testid=create-channel-ttl-option-1800]")!);
    await click(button(dialog, "Create channel"));
    expect(t.send.mock.calls.find(([request]) => request.method === "POST")?.[0].body).toMatchObject({
      workspaceChannel: { channelType: "stream", ttlSeconds: 1800 },
    });
  });
  it.each([
    ["en", "You do not have permission to create a channel.", "Create channel"],
    ["zh-CN", "你没有创建频道的权限。", "创建频道"],
  ] as const)("keeps the %s entry understandable without inventing a creation capability", async (locale, message, label) => {
    const t = routes(() => recorded, false);
    await mount(t, <CreateChannelDialog open onOpenChange={() => {}} />, locale);
    const dialog = document.querySelector<HTMLElement>("[data-testid=create-channel-dialog]")!;
    expect(dialog.textContent).toContain(message);
    expect(button(dialog, label).disabled).toBe(true);
    expect(t.send.mock.calls.every(([request]) => request.method === "GET")).toBe(true);
  });
});

describe("shared governed platform Tool catalog", () => {
  const tool = { resourceId: "tool-resource", resourceVersion: 1, ownerPrincipalId: "tool-owner",
    name: "agent.memory.entry.list", actionKey: "agent.memory.entry.list", source: "PLATFORM_NATIVE",
    status: "ACTIVE", resourceState: "ACTIVE", inputSchemaHash: "a".repeat(64), outputSchemaHash: "b".repeat(64), canConsume: true };
  const page = { tools: [tool], nextOffset: null };
  it("reads the catalog without generating a registration request or consulting write tasks", async () => {
    const t = transport(() => ({ status: 200, body: page }));
    const host = await mount(t, <ToolManagement />);
    expect(host.textContent).toContain("Read-only tool catalog");
    expect(host.textContent).toContain(tool.resourceId);
    await click(button(host, "Refresh"));
    expect(t.send.mock.calls.every(([request]) => request.method === "GET"
      && request.path.startsWith("/api/v1/platform-tools?"))).toBe(true);
    expect(host.querySelector("form")).toBeNull();
    expect([...host.querySelectorAll("button")].some((node) => node.textContent?.startsWith("Register tool"))).toBe(false);
  });
  it("discards a previous client's late directory response after identity replacement", async () => {
    let finishRead!: (value: BffReply) => void;
    const first = transport(() => new Promise<BffReply>((resolve) => { finishRead = resolve; }));
    const second = transport(() => ({ status: 200, body: { tools: [] } }));
    const clients = [createBffClient(first), createBffClient(second)];
    function Host() {
      const [index, setIndex] = useState(0);
      return <><button type="button" onClick={() => setIndex(1)}>Change client</button>
        <PlatformProvider client={clients[index]!} locale="en"><ToolManagement /></PlatformProvider></>;
    }
    const host = await render(<Host />);
    await click(button(host, "Change client"));
    await act(async () => finishRead({ status: 200, body: page }));
    await settle();
    expect(host.textContent).not.toContain(tool.resourceId);
    expect(host.textContent).toContain("No visible registered tools");
  });
  it.each([
    { ...page, tools: [{ ...tool, status: "FUTURE" }] },
    { ...page, tools: [{ ...tool, source: "APPLICATION" }] },
    { ...page, tools: [{ ...tool, resourceState: "PROVISIONING" }] },
    { ...page, tools: [{ ...tool, actionKey: "agent.memory.entry.read" }] },
    { ...page, tools: [{ ...tool, outputSchemaHash: "unknown" }] },
    { ...page, tools: [tool, tool] },
    { ...page, nextOffset: 0 },
  ])("rejects malformed or falsely consumable directory facts (%j)", (value) => {
    expect(validPlatformToolPage(JSON.parse(JSON.stringify(value)), 0)).toBe(false);
  });
  it("continues a filtered empty scan page", async () => {
    const t = transport((request) => ({ status: 200, body: request.path.endsWith("offset=0")
      ? { tools: [], nextOffset: 7 } : page }));
    const host = await mount(t, <ToolManagement />);
    expect(host.textContent).toContain("No visible registered tools");
    await click(button(host, "Next page"));
    expect(host.textContent).toContain(tool.resourceId);
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/platform-tools?offset=7" });
  });
  it("does not render an unreadable catalog as empty", async () => {
    const host = await mount(transport(() => ({ status: 403, body: undefined })), <ToolManagement />);
    expect(host.textContent).not.toContain("No visible registered tools");
  });
});

describe("independent shared Workflows page", () => {
  const definition = { resourceId: "workflow-one", workspaceId: "workspace-one", resourceVersion: 1,
    resourceState: "ACTIVE", ownerPrincipalId: "human", executorInstallationResourceId: "installation-one", state: "DRAFT" };
  const run = { task: { operationId: "run-operation", actionExecutionId: "run-ae", actionKey: "automation.run",
    actionVersion: 1, targetId: definition.resourceId, workspaceId: definition.workspaceId,
    gateState: "ALLOWED", dispatchState: "UNKNOWN", workflowId: "platform:automation_run:tenant:workflow-one:source",
    taskStatus: "COMPLETED", createdAt: "2026-10-04T01:00:00Z", waitingReason: "Waiting for reconciliation" },
    progress: "1/2", usageEventIds: ["usage-one"] };
  const page = { automationResourceId: definition.resourceId, runs: [run] };
  function routes(extra: (request: BffRequest) => BffReply | Promise<BffReply> | undefined = () => undefined) {
    return transport((request) => {
      const response = extra(request);
      if (response !== undefined) return response;
      if (request.path === "/api/v1/workspaces") return { status: 200, body: [
        { id: definition.workspaceId, name: "First workspace", slug: "first" }, { id: "workspace-two", name: "Second workspace", slug: "second" },
      ] };
      if (request.path.startsWith("/api/v1/automations?")) return { status: 200, body: {
        automations: request.path.includes("workspace-one") ? [definition] : [], canCreate: false,
      } };
      if (request.path.startsWith("/api/v1/automations/workflow-one?")) return { status: 200, body: {
        automation: definition, versions: [], delegations: [], canManage: false,
      } };
      if (request.path.startsWith("/api/v1/automations/workflow-one/runs")) return { status: 200, body: page };
      if (request.path === "/api/v1/tasks/run-ae") return { status: 200, body: run.task };
      if (request.path === "/api/v1/agent-definitions") return { status: 200, body: { definitions: [] } };
      if (request.path.startsWith("/api/v1/platform-tools?")) return { status: 200, body: { tools: [] } };
      if (request.path.startsWith("/api/v1/agent-installations?")) return { status: 200, body: { installations: [] } };
      if (request.path === "/api/v1/tasks") return { status: 200, body: [] };
      return { status: 503, body: undefined };
    });
  }
  async function openHistory(t = routes()) {
    const host = await mount(t, <WorkflowsPage />);
    await click(button(host.querySelector("[data-testid=agent-automations]") as HTMLElement, "View definition"));
    return { host, history: host.querySelector("[data-testid=workflow-runs]") as HTMLElement, t };
  }
  it("uses the shared navigation for the independent page and removes the Agents mount", async () => {
    setOverride("workflows", true);
    const t = routes();
    function Host() {
      const [section, setSection] = useState<"agents" | "workflows">("agents");
      return <><PlatformNavigation locale="en" selectedSection={section}
        onSelectSection={(next) => { if (next === "agents" || next === "workflows") setSection(next); }}
        icons={{ pulse: null, projects: null, members: null, agents: null, workflows: null, tasks: null, approvals: null, audit: null, devices: null }} />
        {section === "agents" ? <AgentDefinitionsPage /> : <WorkflowsPage />}</>;
    }
    const host = await mount(t, <Host />);
    expect(host.querySelector("[data-testid=agent-automations]")).toBeNull();
    expect(t.send.mock.calls.some(([request]) => request.path.startsWith("/api/v1/automations"))).toBe(false);
    expect(platformNavigationSections).toContain("workflows");
    await click(host.querySelector("[data-testid=sidebar-platform-workflows]") as HTMLElement);
    expect(host.querySelector("[data-testid=workflows-page]")).not.toBeNull();
    expect(host.textContent).toContain("workflow-one");
  });
  it("both host routes import and render the same page export", async () => {
    const ts = await import("typescript");
    const root = resolve(import.meta.dirname, "../../../..");
    for (const path of ["web-client/web/src/platform/ui/PlatformApp.tsx", "collaboration/desktop/src/app/routes/platform.$section.tsx"]) {
      const source = readFileSync(join(root, path), "utf8");
      const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const imports = parsed.statements.flatMap((node) => {
        if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)
          || node.moduleSpecifier.text !== "@client-kit/platform/react/workflows"
          || node.importClause?.isTypeOnly || !node.importClause?.namedBindings
          || !ts.isNamedImports(node.importClause.namedBindings)) return [];
        return node.importClause.namedBindings.elements.filter((item) => !item.isTypeOnly
          && (item.propertyName?.text ?? item.name.text) === "WorkflowsPage");
      });
      expect(imports).toHaveLength(1);
      const consumers: import("typescript").JsxAttributes[] = [];
      const visit = (node: import("typescript").Node) => {
        if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node))
          && node.tagName.getText(parsed) === imports[0]!.name.text) consumers.push(node.attributes);
        ts.forEachChild(node, visit);
      };
      visit(parsed);
      expect(consumers).toHaveLength(1);
      const props = consumers[0]!.properties.filter(ts.isJsxAttribute).map((prop) => prop.name.getText(parsed));
      expect(props).toContain("workspaceId");
      expect(props).toContain("onWorkspaceChange");
    }
  });
  it.each(["agents", "workflows"] as const)("restores the exact %s workspace and reports selection through host navigation", async (section) => {
    const t = routes();
    const navigate = vi.fn();
    function Host() {
      const [workspaceId, setWorkspaceId] = useState("workspace-two");
      const onWorkspaceChange = (id: string) => { navigate(id); setWorkspaceId(id); };
      return <><button onClick={() => setWorkspaceId("workspace-two")}>History back</button>
        {section === "agents" ? <AgentDefinitionsPage workspaceId={workspaceId} onWorkspaceChange={onWorkspaceChange} />
          : <WorkflowsPage workspaceId={workspaceId} onWorkspaceChange={onWorkspaceChange} />}</>;
    }
    const host = await mount(t, <Host />);
    const select = host.querySelector<HTMLSelectElement>("select")!;
    expect(select.value).toBe("workspace-two");
    await act(async () => { select.value = "workspace-one"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await settle();
    expect(navigate).toHaveBeenCalledWith("workspace-one");
    expect(select.value).toBe("workspace-one");
    await click(button(host, "History back"));
    expect(select.value).toBe("workspace-two");
    expect(t.send.mock.calls.every(([request]) => request.method === "GET")).toBe(true);
  });
  it.each(["agents", "workflows"] as const)("does not substitute another workspace for an unavailable %s URL target", async (section) => {
    const t = routes();
    await mount(t, section === "agents" ? <AgentDefinitionsPage workspaceId="revoked-workspace" onWorkspaceChange={vi.fn()} />
      : <WorkflowsPage workspaceId="revoked-workspace" onWorkspaceChange={vi.fn()} />);
    expect(t.send.mock.calls.some(([request]) => request.path.startsWith("/api/v1/agent-installations?")
      || request.path.startsWith("/api/v1/automations?"))).toBe(false);
  });
  it.each(["en", "zh-CN"] as const)("keeps the original create-card empty state and one refresh under the host title (%s)", async (locale) => {
    const title = locale === "en" ? "Workflows" : "工作流";
    const refresh = locale === "en" ? "Refresh" : "刷新";
    const t = routes((request) => request.path.startsWith("/api/v1/automations?")
      ? { status: 200, body: { automations: [], canCreate: true } } : undefined);
    const host = await mount(t, <><h1>{title}</h1><WorkflowsPage /></>, locale);
    expect(Array.from(host.querySelectorAll("h1,h2")).filter((node) => node.textContent === title)).toHaveLength(1);
    expect(host.querySelector("[data-testid=new-workflow-card]")).not.toBeNull();
    expect(host.textContent).not.toContain(locale === "en" ? "No workflows" : "暂无工作流");
    expect(host.textContent).toContain(locale === "en" ? "Automations that keep your community moving." : "让社区协作自动运转。");
    const refreshButtons = host.querySelectorAll<HTMLButtonElement>(`button[aria-label="${refresh}"]`);
    expect(refreshButtons).toHaveLength(1);
    const reads = (path: string) => t.send.mock.calls.filter(([request]) => request.path.startsWith(path)).length;
    const directoryReads = reads("/api/v1/workspaces");
    const definitionReads = reads("/api/v1/automations?");
    await click(refreshButtons[0]!);
    expect(reads("/api/v1/workspaces")).toBeGreaterThan(directoryReads);
    expect(reads("/api/v1/automations?")).toBeGreaterThan(definitionReads);
    expect(t.send.mock.calls.every(([request]) => request.method === "GET")).toBe(true);
  });
  it.each([403, 503])("does not represent definition read failure (%s) as an empty page", async (status) => {
    const host = await mount(routes((request) => request.path.startsWith("/api/v1/automations?")
      ? { status, body: undefined } : undefined), <WorkflowsPage />);
    expect(host.textContent).not.toContain("No workflows in this workspace yet.");
    expect(host.querySelector("[data-testid=workflow-runs]")).toBeNull();
    expect(host.querySelector("[role=alert], [role=status]")).not.toBeNull();
  });
  it("renders a real empty definition page only after a successful read", async () => {
    const host = await mount(routes((request) => request.path.startsWith("/api/v1/automations?")
      ? { status: 200, body: { automations: [], canCreate: false } } : undefined), <WorkflowsPage />);
    expect(host.textContent).toContain("No workflows in this workspace yet.");
  });
  it("reuses Task state and detail, retaining UNKNOWN even with a completed projection", async () => {
    const { history, t } = await openHistory();
    expect(history.textContent).toContain("My run history");
    expect(history.textContent).toContain("1/2");
    expect(history.textContent).toContain("Waiting for reconciliation");
    expect(history.textContent).not.toContain("Completed");
    expect(history.textContent).not.toContain("usage-one");
    const summary = history.querySelector<HTMLButtonElement>('button[aria-label="run-ae"]')!;
    expect(summary.type).toBe("button");
    expect(summary.querySelector("button, a, input")).toBeNull();
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    await click(summary);
    expect(summary.getAttribute("aria-expanded")).toBe("true");
    expect(history.querySelector('[data-testid="workflow-selected-run"]')).toBe(summary);
    expect(history.textContent).toContain("usage-one");
    await click(summary);
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    expect(history.textContent).not.toContain("usage-one");
    await click(summary);
    await click(button(history, "Action execution"));
    expect(history.querySelector("[data-testid=task-detail]")).not.toBeNull();
    expect(history.textContent).not.toContain("Completed");
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/tasks/run-ae" });
    expect(t.send.mock.calls.every(([request]) => request.method === "GET")).toBe(true);
  });
  it("uses the opaque history cursor verbatim and supports empty filtered pages", async () => {
    const cursor = "opaque/+?=&";
    const { history, t } = await openHistory(routes((request) => request.path === "/api/v1/automations/workflow-one/runs"
      ? { status: 200, body: { automationResourceId: definition.resourceId, runs: [], nextCursor: cursor } } : undefined));
    expect(history.textContent).toContain("No visible runs on this page");
    await click(button(history, "Next page"));
    expect(history.textContent).toContain("run-ae");
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/automations/workflow-one/runs?cursor=opaque%2F%2B%3F%3D%26" });
    await click(button(history, "Previous page"));
    expect(history.textContent).toContain("No visible runs on this page");
  });
  it("opens the exact step approval child through the existing Tasks and Approvals readers", async () => {
    const step = { ...run.task, actionExecutionId: "approval-child", gateState: "WAITING",
      dispatchState: "NOT_DISPATCHED", workflowId: undefined, taskStatus: undefined,
      approvalWorkflowId: "step-approval-workflow", approvalStatus: "WAITING" };
    const { history, t } = await openHistory(routes((request) => {
      if (request.path.includes("/runs")) return { status: 200, body: {
        ...page, runs: [{ ...run, stepApprovalTask: step }],
      } };
      if (request.path === "/api/v1/tasks/approval-child") return { status: 200, body: step };
      if (request.path === "/api/v1/approvals/step-approval-workflow") return { status: 403, body: undefined };
      return undefined;
    }));
    expect(history.textContent).toContain("Waiting for approval");
    await click(history.querySelector<HTMLButtonElement>('button[aria-label="run-ae"]')!);
    await click(button(history, "Step approval"));
    expect(history.querySelector("[data-testid=task-detail]")).not.toBeNull();
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/tasks/approval-child" });
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/approvals/step-approval-workflow" });
    expect(t.send.mock.calls.every(([request]) => request.method === "GET")).toBe(true);
    expect(history.textContent).not.toContain("Completed");
  });
  it.each([
    { operationId: "another-operation" }, { workspaceId: "another-workspace" },
    { targetId: "another-resource" }, { actionExecutionId: "run-ae" },
    { approvalWorkflowId: "" }, { gateState: "FUTURE" }, { actionVersion: 2 },
  ])("rejects an unprovable step approval association %j", (change) => {
    const step = { ...run.task, actionExecutionId: "approval-child", workflowId: undefined,
      taskStatus: undefined, approvalWorkflowId: "step-approval-workflow", ...change };
    expect(validAutomationRuns(JSON.parse(JSON.stringify({ ...page,
      runs: [{ ...run, stepApprovalTask: step }] })), definition.resourceId,
      definition.workspaceId, [])).toBe(false);
  });
  it("rejects a repeated cursor after its actual first page was read", async () => {
    const { history } = await openHistory(routes((request) => request.path.includes("/runs")
      ? { status: 200, body: { ...page, nextCursor: "already-read" } } : undefined));
    await click(button(history, "Next page"));
    expect(history.textContent).not.toContain("run-ae");
    expect(history.textContent).not.toContain("No visible runs on this page");
  });
  it.each([403, 503])("does not represent history refusal (%s) as zero runs", async (status) => {
    const { history } = await openHistory(routes((request) => request.path.includes("/runs") ? { status, body: undefined } : undefined));
    expect(history.textContent).not.toContain("No visible runs on this page");
    expect(history.textContent).not.toContain("run-ae");
  });
  it("discards an old Workspace history result after selection changes", async () => {
    let finish!: (reply: BffReply) => void;
    const { host } = await openHistory(routes((request) => request.path.includes("/runs")
      ? new Promise((resolve) => { finish = resolve; }) : undefined));
    const select = host.querySelector("select") as HTMLSelectElement;
    await act(async () => { select.value = "workspace-two"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => finish({ status: 200, body: page }));
    await settle();
    expect(host.textContent).not.toContain("run-ae");
    expect(host.querySelector("[data-testid=workflow-runs]")).toBeNull();
  });
  it.each([
    { ...page, automationResourceId: "another-automation" },
    { ...page, runs: [{ ...run, task: { ...run.task, targetId: "another-automation" } }] },
    { ...page, runs: [{ ...run, task: { ...run.task, workspaceId: "workspace-two" } }] },
    { ...page, runs: [{ ...run, task: { ...run.task, taskStatus: "FUTURE" } }] },
    { ...page, runs: [{ ...run, task: { ...run.task, waitingReason: {} } }] },
    { ...page, runs: [{ ...run, task: { ...run.task, workflowKind: "COMPONENT_TASK" } }] },
    { ...page, runs: [run, run] },
    { ...page, nextCursor: "" },
  ])("rejects unprovable association/enums/cursors before rendering %j", async (value) => {
    expect(validAutomationRuns(JSON.parse(JSON.stringify(value)), definition.resourceId, definition.workspaceId, [undefined, "already-read"])).toBe(false);
    const { history } = await openHistory(routes((request) => request.path.includes("/runs") ? { status: 200, body: value } : undefined));
    expect(history.textContent).not.toContain("run-ae");
    expect(history.textContent).not.toContain("No visible runs on this page");
  });
});

describe("shared Automation schedule consumer", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());
  const selectCanvasNode = async (section: HTMLElement, index: number) => {
    await click(section.querySelectorAll<HTMLElement>('ol[aria-label="Workflow sequence"] > li > div > button[aria-pressed]')[index]!);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
  };
  const insertCanvasStep = async (section: HTMLElement, index: number, action: string) => {
    const trigger = section.querySelectorAll<HTMLElement>('[data-testid="workflow-node-ingress"] button')[index]!;
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", {key:"Enter", bubbles:true})));
    await settle();
    await click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === action)!);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
  };
  const installation = {
    resourceId: "schedule-installation", workspaceId: "schedule-workspace", agentResourceId: "schedule-definition",
    pinnedVersionAssetId: "schedule-agent-version", agentPrincipalId: "schedule-agent", agentPrincipalState: "ACTIVE",
    ownerPrincipalId: "schedule-human", resourceVersion: 1, resourceState: "ACTIVE", state: "ACTIVE",
    activeProjectionGeneration: 1, projection: { generation: 1, agentVersionAssetId: "schedule-agent-version",
      runtimeProfileKey: "schedule-profile", configHash: "a".repeat(64), state: "ACTIVE" },
  };
  const scheduleContent = { name: "Scheduled report", trigger: { kind: "SCHEDULE", scheduleSpec: { everySeconds: 300, offsetSeconds: 0, catchupWindowSeconds: 60 } },
    action: { kind: "AGENT_TURN", template: "Report" }, resultTarget: "CHANNEL" };
  const setup = async (targets: unknown, content?: unknown, recheckStatus?: number, recheck?: Record<string, unknown>, policies?: unknown,
    readOverride?: (request: BffRequest) => BffReply | undefined) => {
    const automation = { resourceId: "schedule-automation", workspaceId: installation.workspaceId,
      ownerPrincipalId: installation.ownerPrincipalId, executorInstallationResourceId: installation.resourceId,
      resourceVersion: 2, resourceState: "ACTIVE", state: "DRAFT" };
    let writes = 0;
    const t = transport((r) => {
      const overridden = readOverride?.(r);
      if (overridden) return overridden;
      if (r.path === "/api/v1/tasks") return { status: 200, body: [] };
      if (r.path === "/api/v1/agent-definitions") return { status: 200, body: { definitions: [] } };
      if (r.path === "/api/v1/workspaces") return { status: 200, body: [{ id: installation.workspaceId, name: "Schedule workspace", slug: "schedule" }] };
      if (r.path.startsWith("/api/v1/automations?")) return { status: 200, body: { automations: content ? [automation] : [], canCreate: true, availableApprovalPolicies: policies } };
      if (r.path.startsWith("/api/v1/automations/schedule-automation?")) return { status: 200, body: {
        automation, canManage: true, versions: [{ assetId: "schedule-version", automationResourceId: automation.resourceId,
          ownerPrincipalId: installation.ownerPrincipalId, assetVersion: 1, ordinal: 1, state: "PUBLISHED", configHash: "b".repeat(64), content }],
        delegations: [{ delegationId: "schedule-grant", delegationVersion: 1, ownerPrincipalId: installation.ownerPrincipalId,
          executorInstallationResourceId: installation.resourceId, expiresAt: "2099-01-01T00:00:00Z" }],
      } };
      if (r.path === `/api/v1/agent-installations/${installation.resourceId}`) return { status: 200, body: { ...installation, automationResultTargets: targets } };
      if (r.path.startsWith("/api/v1/agent-installations?")) return { status: 200, body: { installations: [
        { ...installation, automationResultTargets: targets },
        { ...installation, resourceId: "thread-only", automationResultTargets: ["TRIGGER_THREAD"] },
      ] } };
      if (r.path === "/api/v1/actions" && ++writes > 1 && recheckStatus) return { status: recheckStatus, body: undefined };
      if (r.path === "/api/v1/actions") return { status: 202, body: {
        actionKey: (r.body as { actionKey: string }).actionKey, actionExecutionId: "schedule-ae", operationId: "schedule-op",
        gateState: "ALLOWED", dispatchState: "UNKNOWN",
        ...(writes > 1 ? recheck : {}),
      } };
      return { status: 503, body: undefined };
    });
    // Both real hosts provide this QueryClient. Original action emoji tiles
    // consume the admitted palette query, including its read failure state.
    const host = await mount(t, <QueryClientProvider client={new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })}><WorkflowsPage /></QueryClientProvider>);
    await settle();
    await click(host.querySelector<HTMLButtonElement>('[data-testid="new-workflow-card"]')!);
    // Original Dialog portals its content; exercise the same user-visible tree.
    const section = document.body;
    const field = (label: string) => [...section.querySelectorAll("label")].find((node) => node.textContent?.startsWith(label))
      ?? (label === "Instruction template" ? [...section.querySelectorAll("label")].find(node => node.htmlFor.endsWith("-text"))! : undefined!);
    const choose = async (label: string, value: string) => {
      const select = field(label).querySelector("select")!;
      await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
      await settle();
      if (label === "Action" && (value === "add_reaction" || value === "set_channel_topic")) await selectCanvasNode(section, 1);
    };
    const fill = async (label: string, value: string) => {
      if (!field(label) && label === "Instruction template" && section.querySelector('ol[aria-label="Workflow sequence"]')) {
        if (section.querySelectorAll('ol[aria-label="Workflow sequence"] > li').length === 1) await insertCanvasStep(section, 0, "Send message");
        else await selectCanvasNode(section, 1);
      }
      const input = field(label).querySelector("input,textarea")!;
      if (input instanceof HTMLInputElement) await type(input, value);
      else await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await settle();
    };
    await choose("Executor installation", installation.resourceId);
    if (content) {
      await click(button(section, "Close"));
      await click(button(document.querySelector<HTMLElement>('[role="alertdialog"]')!, "Discard changes"));
    }
    return { section, t, field, choose, fill };
  };

  it("freezes explicit native interval and channel target, preserving the same UNKNOWN request", async () => {
    const { section, t, choose, fill } = await setup(["CHANNEL"]);
    await choose("Trigger", "SCHEDULE");
    expect(section.querySelector<HTMLInputElement>('#wf-trigger-time')!.value).toBe("09:00");
    expect(button(section, "Review request").disabled).toBe(true);
    await click(section.querySelector<HTMLInputElement>('input[value="every_15_minutes"]')!);
    await fill("Offset (seconds)", "0");
    await fill("Catch-up window (seconds)", "60");
    await fill("Instruction template", "Report workspace progress");
    await click(button(section, "Review request"));
    expect(section.textContent).toContain("Workspace channel");
    await click(button(section, "Submit governed request"));
    await click(button(section, "Re-check same request"));
    const writes = t.send.mock.calls.filter(([r]) => r.path === "/api/v1/actions").map(([r]) => r.body);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(writes[0]).toEqual({ actionKey: "automation.create", idempotencyKey: expect.any(String), explicitConfirmation: true,
      workspaceId: installation.workspaceId, executorInstallationResourceId: installation.resourceId,
      automationVersionContent: { trigger: { kind: "SCHEDULE", scheduleSpec: { everySeconds: 900, offsetSeconds: 0, catchupWindowSeconds: 60 } },
        action: { kind: "AGENT_TURN", template: "Report workspace progress" }, resultTarget: "CHANNEL" } });
  });

  const writeYaml = async (section: HTMLElement, text: string) => {
    const textarea = section.querySelector('textarea[aria-label="Workflow YAML"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, text);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
  };

  it("preserves ordered Delay and message through form/YAML and the same UNKNOWN intent", async () => {
    const { section, t, choose, fill } = await setup(["TRIGGER_THREAD"]);
    await choose("Action", "POST_MESSAGE");
    await fill("Instruction template", "After the delay");
    await insertCanvasStep(section, 0, "Delay");
    await type(section.querySelector<HTMLInputElement>('#wf-step-0-duration')!, "1m 2s");
    await click(button(section, "Workflow YAML"));
    const yaml = section.querySelector<HTMLTextAreaElement>('textarea[aria-label="Workflow YAML"]')!;
    expect(yaml.value).toContain("formatVersion: 3");
    expect(yaml.value).toContain("action: delay");
    expect(yaml.value).toContain("action: send_message");
    await click(button(section, "Form"));
    await selectCanvasNode(section, 1);
    expect(section.querySelector<HTMLInputElement>('input[id="wf-step-0-duration"]')!.value).toBe("1m 2s");
    await click(button(section, "Review request"));
    await click(button(section, "Submit governed request"));
    await click(button(section, "Re-check same request"));
    const writes = t.send.mock.calls.filter(([request]) => request.path === "/api/v1/actions").map(([request]) => request.body);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(writes[0]).toMatchObject({automationVersionContent: {formatVersion: 3, steps: [
      {id:expect.any(String),action:"delay",duration:"1m 2s"},
      {id:expect.any(String),action:"send_message",text:"After the delay"},
    ]}});
    expect((writes[0] as {automationVersionContent:Record<string,unknown>}).automationVersionContent).not.toHaveProperty("action");
  });

  it("preserves original reaction form and YAML through the same UNKNOWN intent", async () => {
    const {section, t, choose} = await setup(["TRIGGER_THREAD"]);
    await choose("Action", "add_reaction");
    await type(section.querySelector<HTMLInputElement>("#wf-step-0-emoji")!, "👍");
    await insertCanvasStep(section, 0, "Delay");
    await type(section.querySelector<HTMLInputElement>("#wf-step-0-duration")!, "1s");
    await click(button(section, "Workflow YAML"));
    const yaml = section.querySelector<HTMLTextAreaElement>('textarea[aria-label="Workflow YAML"]')!.value;
    expect(yaml).toContain("action: add_reaction");
    expect(yaml).not.toContain("action: send_message");
    await click(button(section, "Form"));
    await selectCanvasNode(section, 2);
    expect(section.querySelector<HTMLInputElement>("#wf-step-1-emoji")!.value).toBe("👍");
    await click(button(section, "Review request"));
    await click(button(section, "Submit governed request"));
    await click(button(section, "Re-check same request"));
    const writes = t.send.mock.calls.filter(([r]) => r.path === "/api/v1/actions").map(([r]) => r.body);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(writes[0]).toMatchObject({automationVersionContent:{formatVersion:2,steps:[
      {action:"delay",duration:"1s"},{action:"add_reaction",emoji:"👍"}]}});
  });

  it("preserves original channel topic clearing through form YAML and UNKNOWN", async () => {
    const {section, t, choose} = await setup(["TRIGGER_THREAD"]);
    await choose("Action", "set_channel_topic");
    const input = section.querySelector<HTMLInputElement>("#wf-step-0-topic")!;
    await type(input, "Release discussion");
    await click(button(section, "Workflow YAML"));
    const yaml = section.querySelector<HTMLTextAreaElement>('textarea[aria-label="Workflow YAML"]')!.value;
    expect(yaml).toContain("action: set_channel_topic");
    expect(yaml).toContain("topic: Release discussion");
    expect(yaml).not.toContain("action: send_message");
    await click(button(section, "Form"));
    await selectCanvasNode(section, 1);
    await type(section.querySelector<HTMLInputElement>("#wf-step-0-topic")!, "");
    await click(button(section, "Review request"));
    await click(button(section, "Submit governed request"));
    await click(button(section, "Re-check same request"));
    const writes = t.send.mock.calls.filter(([r]) => r.path === "/api/v1/actions").map(([r]) => r.body);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(writes[0]).toMatchObject({automationVersionContent:{formatVersion:2,steps:[
      {action:"set_channel_topic",topic:""}]}});
  });

  it("preserves an explicit approval step through YAML and UNKNOWN without inventing an approver", async () => {
    const policy = {id: "00000000-0000-4000-8000-000000000001", version: 2};
    const {section, t, choose, fill} = await setup(["TRIGGER_THREAD"], undefined, undefined, undefined, [policy]);
    await choose("Action", "POST_MESSAGE");
    await fill("Instruction template", "Only after approval");
    await insertCanvasStep(section, 0, "Request approval");
    expect(button(section, "Review request").disabled).toBe(true);
    const selector = section.querySelector<HTMLSelectElement>("#wf-step-0-policy")!;
    expect(selector.value).toBe("");
    await act(async () => { selector.value = `${policy.id}:${policy.version}`; selector.dispatchEvent(new Event("change", {bubbles:true})); });
    await type(section.querySelector<HTMLInputElement>("#wf-step-0-message")!, "Please review the reply");
    await click(button(section, "Workflow YAML"));
    const yaml = section.querySelector<HTMLTextAreaElement>('textarea[aria-label="Workflow YAML"]')!.value;
    expect(yaml).toContain("action: request_approval");
    expect(yaml).toContain("message: Please review the reply");
    expect(yaml).not.toContain("from:");
    await click(button(section, "Form"));
    await selectCanvasNode(section, 1);
    expect(section.querySelector<HTMLSelectElement>("#wf-step-0-policy")!.value).toBe(`${policy.id}:${policy.version}`);
    await click(button(section, "Review request"));
    expect(section.textContent).toContain(`${policy.id} · ${policy.version}`);
    await click(button(section, "Submit governed request"));
    await click(button(section, "Re-check same request"));
    const writes = t.send.mock.calls.filter(([request]) => request.path === "/api/v1/actions").map(([request]) => request.body);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(writes[0]).toMatchObject({automationVersionContent:{formatVersion:3,steps:[
      {action:"request_approval",approvalPolicy:policy,message:"Please review the reply"},
      {action:"send_message",text:"Only after approval"},
    ]}});
    expect((writes[0] as {automationVersionContent:Record<string,unknown>}).automationVersionContent).not.toHaveProperty("approvalPolicy");
  });

  it("rejects unbound or duplicate approval YAML while keeping the original text editable", async () => {
    const policy = {id:"00000000-0000-4000-8000-000000000001",version:2};
    const {section} = await setup(["TRIGGER_THREAD"], undefined, undefined, undefined, [policy]);
    await click(button(section, "Workflow YAML"));
    const request = {trigger:{kind:"CHANNEL_MESSAGE"},resultTarget:"TRIGGER_THREAD",formatVersion:2,steps:[
      {id:"review",action:"request_approval",approvalPolicy:policy,message:"Review"},
      {id:"reply",action:"send_message",text:"Approved"},
    ]};
    await writeYaml(section, JSON.stringify(request));
    expect(button(section, "Review request").disabled).toBe(false);
    for (const invalid of [
      {...request,approvalPolicy:policy},
      {...request,steps:[{...request.steps[0],from:"owner"},request.steps[1]]},
      {...request,steps:[{...request.steps[0],approvalPolicy:{...policy,version:3}},request.steps[1]]},
      {...request,steps:[request.steps[0],{...request.steps[0],id:"second"},request.steps[1]]},
    ]) {
      const raw = JSON.stringify(invalid);
      await writeYaml(section, raw);
      expect(button(section, "Review request").disabled).toBe(true);
      expect(section.querySelector<HTMLTextAreaElement>('textarea[aria-label="Workflow YAML"]')!.value).toBe(raw);
    }
  });

  it("removing a delay preserves the message step identity and rejects unsupported conditions", async () => {
    const { section, choose, fill } = await setup(["TRIGGER_THREAD"]);
    await choose("Action", "POST_MESSAGE");
    await fill("Instruction template", "Retained");
    await insertCanvasStep(section, 0, "Delay");
    await type(section.querySelector<HTMLInputElement>('#wf-step-0-duration')!, "1s");
    await click(button(section, "Workflow YAML"));
    const first = section.querySelector<HTMLTextAreaElement>('textarea[aria-label="Workflow YAML"]')!.value;
    await click(button(section, "Form"));
    await click(section.querySelector<HTMLButtonElement>('button[aria-label="Remove step"]')!);
    await click(button(section, "Workflow YAML"));
    const after = section.querySelector<HTMLTextAreaElement>('textarea[aria-label="Workflow YAML"]')!.value;
    expect(after).toContain("formatVersion: 3");
    expect(after).not.toContain("action: delay");
    expect(first).toContain(after.slice(after.indexOf("steps:" ) + "steps:".length).trim());
    await writeYaml(section, after.replace("action: send_message", "action: send_message\n    if: true"));
    expect(button(section, "Review request").disabled).toBe(true);
  });

  it("submits original cron fields and preserves six/seven-field YAML without truncation", async () => {
    const { section, t, choose, fill } = await setup(["CHANNEL"]);
    await choose("Trigger", "SCHEDULE");
    await click(section.querySelector<HTMLInputElement>('input[value="custom_cron"]')!);
    const values = ["0", "9", "*", "*", "MON-FRI"];
    for (const [index, label] of ["Minute", "Hour", "Day", "Month", "Weekday"].entries()) {
      await type(section.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!, values[index]!);
    }
    await fill("Catch-up window (seconds)", "60");
    await fill("Instruction template", "Calendar report");
    await click(button(section, "Workflow YAML"));
    const yaml = section.querySelector<HTMLTextAreaElement>('textarea[aria-label="Workflow YAML"]')!;
    expect(yaml.value).toContain("kind: CRON");
    expect(yaml.value).toContain("0 9 * * MON-FRI");
    const exact = yaml.value.replace("0 9 * * MON-FRI", "15 0 9 * * MON-FRI 2027");
    await writeYaml(section, exact);
    await click(button(section, "Form"));
    expect(yaml.value).toBe(exact);
    expect(section.querySelector('textarea[aria-label="Workflow YAML"]')).toBe(yaml);
    await click(button(section, "Review request"));
    await click(button(section, "Submit governed request"));
    await click(button(section, "Re-check same request"));
    const posts = t.send.mock.calls.map(([request]) => request).filter((request) => request.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts[1]?.body).toEqual(posts[0]?.body);
    expect(posts[0]?.body).toMatchObject({ actionKey: "automation.create", automationVersionContent: {
      trigger: { kind: "SCHEDULE", scheduleSpec: { kind: "CRON", cron: "15 0 9 * * MON-FRI 2027", catchupWindowSeconds: 60 } },
      resultTarget: "CHANNEL",
    } });
  });

  it("rejects mixed cron/interval YAML without falling back to interval", async () => {
    const { section, t, choose, fill } = await setup(["CHANNEL"]);
    await choose("Trigger", "SCHEDULE");
    await click(section.querySelector<HTMLInputElement>('input[value="every_15_minutes"]')!);
    await fill("Offset (seconds)", "0");
    await fill("Catch-up window (seconds)", "60");
    await fill("Instruction template", "Report");
    await click(button(section, "Workflow YAML"));
    const yaml = section.querySelector<HTMLTextAreaElement>('textarea[aria-label="Workflow YAML"]')!;
    await writeYaml(section, yaml.value.replace("scheduleSpec:", "scheduleSpec:\n    kind: CRON\n    cron: '0 9 * * *'"));
    expect(button(section, "Review request").disabled).toBe(true);
    await click(button(section, "Form"));
    expect(section.querySelector('textarea[aria-label="Workflow YAML"]')).toBe(yaml);
    expect(t.send.mock.calls.every(([request]) => request.method !== "POST")).toBe(true);
  });

  it("uses the original runtime weekday ordinals instead of silently changing execution dates", async () => {
    const { section, choose, fill } = await setup(["CHANNEL"]);
    await choose("Trigger", "SCHEDULE");
    await click(section.querySelector<HTMLInputElement>('input[value="custom_cron"]')!);
    for (const [label, value] of [["Minute", "0"], ["Hour", "9"], ["Day", "*"], ["Month", "*"], ["Weekday", "0"]]) {
      await type(section.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!, value!);
    }
    await fill("Catch-up window (seconds)", "60");
    await fill("Instruction template", "Calendar report");
    expect(button(section, "Review request").disabled).toBe(true);
    await type(section.querySelector<HTMLInputElement>('input[aria-label="Weekday"]')!, "1-7");
    expect(button(section, "Review request").disabled).toBe(false);
    await type(section.querySelector<HTMLInputElement>('input[aria-label="Weekday"]')!, "MON-SUN");
    expect(button(section, "Review request").disabled).toBe(true);
    await type(section.querySelector<HTMLInputElement>('input[aria-label="Month"]')!, "January-March");
    for (const name of ["Monday-Friday", "Tues-Thurs"]) {
      await type(section.querySelector<HTMLInputElement>('input[aria-label="Weekday"]')!, name);
      expect(button(section, "Review request").disabled).toBe(false);
    }
    await type(section.querySelector<HTMLInputElement>('input[aria-label="Month"]')!, "Januar");
    expect(button(section, "Review request").disabled).toBe(true);
  });

  it("protects a canvas draft on footer close until the original discard confirmation", async () => {
    const { section, t, field, fill } = await setup(["TRIGGER_THREAD"]);
    expect(section.querySelector('[role="dialog"][data-testid="workflow-editor-dialog"]')).not.toBeNull();
    await fill("Instruction template", "Keep this draft");
    await click(button(section, "Close"));
    expect(section.querySelector('[data-testid="workflow-editor-dialog"]')).not.toBeNull();
    await click(button(document.querySelector<HTMLElement>('[role="alertdialog"]')!, "Keep editing"));
    expect(field("Instruction template").querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Keep this draft");
    await click(button(section, "Close"));
    await click(button(document.querySelector<HTMLElement>('[role="alertdialog"]')!, "Discard changes"));
    expect(section.querySelector('[data-testid="workflow-editor-dialog"]')).toBeNull();
    await click(section.querySelector<HTMLButtonElement>('[data-testid="new-workflow-card"]')!);
    expect(field("Instruction template").querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("");
    expect(t.send.mock.calls.filter(([request]) => request.method === "POST")).toHaveLength(0);
  });

  it("uses the original inline name editor and freezes its name through YAML and UNKNOWN", async () => {
    const { section, t, fill } = await setup(["TRIGGER_THREAD"]);
    await click(section.querySelector<HTMLButtonElement>('button[aria-label="Edit workflow name"]')!);
    await type(section.querySelector<HTMLInputElement>('input[aria-label="Workflow name"]')!, "协作播报");
    await click(section.querySelector<HTMLButtonElement>('button[aria-label="Save workflow name"]')!);
    await fill("Instruction template", "Report");
    await click(button(section, "Workflow YAML"));
    expect(section.querySelector<HTMLTextAreaElement>('textarea[aria-label="Workflow YAML"]')!.value).toContain("协作播报");
    await click(button(section, "Form"));
    expect(section.querySelector('[data-testid="workflow-editor-dialog"]')?.textContent).toContain("协作播报");
    await click(button(section, "Review request"));
    await click(button(section, "Submit governed request"));
    expect(section.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.disabled).toBe(true);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(section.querySelector('[data-testid="workflow-editor-dialog"]')).not.toBeNull();
    await click(button(section, "Re-check same request"));
    const writes = t.send.mock.calls.filter(([request]) => request.method === "POST").map(([request]) => request.body);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(writes[0]).toMatchObject({ automationVersionContent: { name: "协作播报" } });
  });

  it("renders real authorized version semantics in the original card, without inventing a workflow name", async () => {
    const { section } = await setup(["CHANNEL"], scheduleContent);
    const card = section.querySelector('[data-testid="workflow-card-schedule-automation"]')!;
    expect(card.querySelector('[data-testid="workflow-card-semantic-label"]')?.textContent).toBe("Scheduled report");
    expect(card.textContent).toContain("Report");
    expect(card.textContent).toContain("Schedule");
    expect(card.textContent).toContain("schedule-version");
    expect(card.textContent).toContain("#Schedule workspace");
    await click(button(section, "View definition"));
    expect(section.querySelector('[data-testid="workflow-detail-panel"]')).not.toBeNull();
  });

  const enabled = { resourceId: "schedule-automation", workspaceId: installation.workspaceId,
    ownerPrincipalId: installation.ownerPrincipalId, executorInstallationResourceId: installation.resourceId,
    resourceVersion: 2, resourceState: "ACTIVE", state: "ENABLED",
    pinnedVersionAssetId: "schedule-version", delegationId: "schedule-grant" };
  const manualRead = (canRun: unknown, canManage = false, state = "ENABLED") => (request: BffRequest): BffReply | undefined => {
    const automation = { ...enabled, state };
    if (request.path.startsWith("/api/v1/automations?")) return { status: 200, body: { automations: [automation], canCreate: true } };
    if (request.path.startsWith("/api/v1/automations/schedule-automation?")) return { status: 200, body: {
      automation, versions: [], delegations: [], canManage, ...(canRun === undefined ? {} : { canRun }),
    } };
    return undefined;
  };

  it.each([403, 409])("freezes one owner run without client Grant/pin/source and preserves UNKNOWN after %s", async (status) => {
    const { section, t } = await setup(["TRIGGER_THREAD", "CHANNEL"], scheduleContent, status, undefined, undefined, manualRead(true));
    await click(button(section, "View definition"));
    expect([...section.querySelectorAll("button")].some((node) => node.textContent === "Delete")).toBe(false);
    await click(button(section, "Run once"));
    expect(section.textContent).toContain("Admission, delegation, quota and step approval still apply");
    await click(button(section, "Review request")); await click(button(section, "Submit governed request"));
    await click(button(section, "Re-check same request"));
    expect(section.textContent).toContain("Outcome is not confirmed");
    expect(section.textContent).toContain("schedule-op");
    expect([...section.querySelectorAll("button")].some((node) => node.textContent === "Cancel request")).toBe(false);
    await click(button(section, "Re-check same request"));
    const writes = t.send.mock.calls.filter(([request]) => request.path === "/api/v1/actions").map(([request]) => request.body);
    expect(writes).toHaveLength(3);
    expect(writes[0]).toEqual({ actionKey: "automation.run", idempotencyKey: expect.any(String), explicitConfirmation: true,
      resourceId: enabled.resourceId, resourceVersion: enabled.resourceVersion, workspaceId: enabled.workspaceId });
    expect(writes[1]).toEqual(writes[0]); expect(writes[2]).toEqual(writes[0]);
  });

  it.each([undefined, false, "true", null])("does not generate manual execution without an exact capability fact (%j)", async (canRun) => {
    const { section, t } = await setup(["TRIGGER_THREAD", "CHANNEL"], scheduleContent, undefined, undefined, undefined, manualRead(canRun));
    await click(button(section, "View definition"));
    expect([...section.querySelectorAll("button")].some((node) => node.textContent === "Run once")).toBe(false);
    expect(t.send.mock.calls.filter(([request]) => request.path === "/api/v1/actions")).toHaveLength(0);
  });

  it("allows explicit deletion while an original run remains unknown and never labels an unknown delete completed", async () => {
    const originalRun = { actionKey: "automation.run", actionExecutionId: "existing-run", operationId: "existing-operation",
      targetId: enabled.resourceId, workspaceId: enabled.workspaceId, gateState: "ALLOWED", dispatchState: "UNKNOWN" };
    const reads = manualRead(false, true);
    const { section, t } = await setup(["TRIGGER_THREAD", "CHANNEL"], scheduleContent, undefined, undefined, undefined,
      (request) => request.path === "/api/v1/tasks" ? { status: 200, body: [originalRun] } : reads(request));
    await click(button(section, "View definition")); await click(button(section, "Delete"));
    expect(section.textContent).toContain("Versions and run history remain; admitted runs are not canceled");
    await click(button(section, "Review request")); await click(button(section, "Submit governed request"));
    await click(button(section, "Re-check same request"));
    const writes = t.send.mock.calls.filter(([request]) => request.path === "/api/v1/actions").map(([request]) => request.body);
    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual({ actionKey: "automation.delete", idempotencyKey: expect.any(String), explicitConfirmation: true,
      resourceId: enabled.resourceId, resourceVersion: enabled.resourceVersion });
    expect(writes[1]).toEqual(writes[0]);
    expect(section.textContent).toContain("Outcome is not confirmed");
    expect(section.textContent).not.toContain("Deleted");
  });

  it("retains a readable tombstone and history without management or manual-run controls", async () => {
    const { section, t } = await setup(["TRIGGER_THREAD", "CHANNEL"], scheduleContent, undefined, undefined, undefined, manualRead(false, false, "DELETED"));
    await click(button(section, "View definition"));
    expect(section.textContent).toContain("Deleted");
    expect(section.querySelector("[data-testid=workflow-runs]")).not.toBeNull();
    for (const label of ["Run once", "Delete", "Enable", "Pause", "Disable", "Publish a new version"]) {
      expect([...section.querySelectorAll("button")].some((node) => node.textContent === label)).toBe(false);
    }
    expect(t.send.mock.calls.filter(([request]) => request.path === "/api/v1/actions")).toHaveLength(0);
  });

  it("lets an untouched incomplete draft switch editors without an error or an admitted write", async () => {
    const { section, t, field } = await setup(["TRIGGER_THREAD"]);
    await click(button(section, "Workflow YAML"));
    expect(section.querySelector('textarea[aria-label="Workflow YAML"]')).not.toBeNull();
    expect(section.textContent).not.toContain("Your text has been kept");
    expect(button(section, "Review request").disabled).toBe(true);
    await act(async () => section.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await click(button(section, "Form"));
    expect(section.querySelector('textarea[aria-label="Workflow YAML"]')).toBeNull();
    expect(field("Instruction template").querySelector("textarea")!.value).toBe("");
    expect(section.textContent).not.toContain("Your text has been kept");
    expect(t.send.mock.calls.filter(([request]) => request.path === "/api/v1/actions")).toHaveLength(0);
  });

  it("roundtrips the original YAML editor into the same form and freezes structured UNKNOWN submission", async () => {
    const { section, t, field, fill } = await setup(["TRIGGER_THREAD"]);
    await fill("Instruction template", "Original");
    await click(button(section, "Workflow YAML"));
    const text = 'trigger:\n  kind: CHANNEL_MESSAGE\n  textPrefix: report\naction:\n  kind: POST_MESSAGE\n  template: "Result ${source}"\nresultTarget: TRIGGER_THREAD\n';
    await writeYaml(section, text);
    await click(button(section, "Form"));
    await selectCanvasNode(section, 1);
    expect(field("Instruction template").querySelector("textarea")!.value).toBe("Result ${source}");
    expect(field("Action").querySelector("select")!.value).toBe("POST_MESSAGE");
    await click(button(section, "Workflow YAML"));
    expect(section.querySelector('textarea[aria-label="Workflow YAML"]')?.textContent).toContain("POST_MESSAGE");
    await click(button(section, "Review request"));
    await click(button(section, "Submit governed request"));
    expect(section.querySelector('textarea[aria-label="Workflow YAML"]')).toBeNull();
    await click(button(section, "Re-check same request"));
    const writes = t.send.mock.calls.filter(([request]) => request.path === "/api/v1/actions").map(([request]) => request.body);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(writes[0]).toMatchObject({ actionKey: "automation.create", automationVersionContent: {
      trigger: { kind: "CHANNEL_MESSAGE", textPrefix: "report" },
      action: { kind: "POST_MESSAGE", template: "Result ${source}" }, resultTarget: "TRIGGER_THREAD",
    } });
    expect(writes[0]).not.toHaveProperty("yaml");
  });

  it.each([
    'trigger: [',
    'trigger: {kind: FUTURE}\naction: {kind: POST_MESSAGE, template: hello}\nresultTarget: TRIGGER_THREAD',
    'trigger: {kind: CHANNEL_MESSAGE}\naction: {kind: POST_MESSAGE, template: hello, secretRef: hidden}\nresultTarget: TRIGGER_THREAD',
    'trigger: {kind: CHANNEL_MESSAGE}\naction: {kind: POST_MESSAGE, template: hello}\nresultTarget: TRIGGER_THREAD\nresourceId: source',
    'trigger: {kind: MENTION, mentionPrincipalId: another-agent}\naction: {kind: POST_MESSAGE, template: hello}\nresultTarget: TRIGGER_THREAD',
    'trigger: {kind: CHANNEL_MESSAGE}\naction: {kind: POST_MESSAGE, template: hello}\nresultTarget: TRIGGER_THREAD\napprovalPolicy: {id: 88888888-8888-4888-8888-888888888888, version: 99}',
    'trigger: {kind: SCHEDULE, scheduleSpec: {everySeconds: 300, offsetSeconds: 0, catchupWindowSeconds: 60}}\naction: {kind: POST_MESSAGE, template: hello}\nresultTarget: CHANNEL',
  ])("keeps unsupported YAML intact without form fallback or a write (%s)", async (text) => {
    const { section, t, fill } = await setup(["TRIGGER_THREAD"]);
    await fill("Instruction template", "Original"); await click(button(section, "Workflow YAML"));
    await writeYaml(section, text); await click(button(section, "Form"));
    expect(section.querySelector<HTMLTextAreaElement>('textarea[aria-label="Workflow YAML"]')!.value).toBe(text);
    expect(section.textContent).toContain("Your text has been kept");
    expect(button(section, "Review request").disabled).toBe(true);
    await act(async () => section.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(t.send.mock.calls.filter(([request]) => request.path === "/api/v1/actions")).toHaveLength(0);
  });

  it("copies a freshly read version only, requiring a new executor and creating no inherited identity", async () => {
    const copied = { trigger: { kind: "CHANNEL_MESSAGE", textPrefix: "copy" },
      action: { kind: "POST_MESSAGE", template: "Copied instruction" }, resultTarget: "TRIGGER_THREAD" };
    const { section, t, choose, field } = await setup(["TRIGGER_THREAD"], copied);
    await click(button(section, "View definition"));
    await click(button(section, "Copy as new draft"));
    expect(field("Executor installation").querySelector("select")!.value).toBe("");
    expect([...section.querySelectorAll("button")].some((node) => node.textContent === "Review request")).toBe(false);
    await choose("Executor installation", "thread-only");
    await click(button(section, "Review request")); await click(button(section, "Submit governed request"));
    const request = t.send.mock.calls.find(([entry]) => entry.path === "/api/v1/actions")![0].body;
    expect(request).toEqual({ actionKey: "automation.create", idempotencyKey: expect.any(String), explicitConfirmation: true,
      workspaceId: installation.workspaceId, executorInstallationResourceId: "thread-only", automationVersionContent: copied });
    // Card metadata, explicit details, then fresh authorization immediately before copy.
    expect(t.send.mock.calls.filter(([entry]) => entry.path.startsWith("/api/v1/automations/schedule-automation?"))).toHaveLength(3);
  });

  it("does not copy a stale version after source permission is revoked", async () => {
    let revoked = false;
    const { section, t } = await setup(["CHANNEL"], scheduleContent, undefined, undefined, undefined,
      (request) => revoked && request.path.startsWith("/api/v1/automations/schedule-automation?")
        ? { status: 403, body: undefined } : undefined);
    await click(button(section, "View definition"));
    revoked = true;
    await click(button(section, "Copy as new draft"));
    expect(section.textContent).toContain("Not allowed");
    expect(section.querySelector('[data-testid="workflow-editor-dialog"]')).toBeNull();
    expect(t.send.mock.calls.filter(([request]) => request.path === "/api/v1/actions")).toHaveLength(0);
  });

  it.each([403, 409])("retains the original uncertain request after a later refusal (%s)", async (status) => {
    const { section, t, fill } = await setup(["TRIGGER_THREAD"], undefined, status);
    await fill("Instruction template", "Report");
    await click(button(section, "Review request"));
    await click(button(section, "Submit governed request"));
    await click(button(section, "Re-check same request"));
    expect(section.textContent).toContain("Outcome is not confirmed");
    expect(section.textContent).toContain("schedule-op");
    expect([...section.querySelectorAll("button")].map((node) => node.textContent)).not.toContain("Cancel request");
    await click(button(section, "Re-check same request"));
    const writes = t.send.mock.calls.filter(([request]) => request.path === "/api/v1/actions");
    expect(writes).toHaveLength(3);
    expect(writes[1]?.[0].body).toEqual(writes[0]?.[0].body);
    expect(writes[2]?.[0].body).toEqual(writes[0]?.[0].body);
  });

  it("freezes POST_MESSAGE as the existing governed automation action", async () => {
    const { section, t, choose, fill } = await setup(["TRIGGER_THREAD"]);
    await choose("Action", "POST_MESSAGE");
    await fill("Instruction template", "Literal ${source} template");
    await click(button(section, "Review request"));
    await click(button(section, "Submit governed request"));
    const writes = t.send.mock.calls.filter(([request]) => request.path === "/api/v1/actions");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0].body).toMatchObject({ actionKey: "automation.create",
      automationVersionContent: { formatVersion:3, steps: [{action:"send_message", text:"Literal ${source} template"}],
        resultTarget: "TRIGGER_THREAD" } });
  });

  it("freezes only the selected deployed step approval policy, including UNKNOWN retry", async () => {
    const policy={id:"88888888-8888-4888-8888-888888888888",version:2};
    const {section,t,choose,fill}=await setup(["TRIGGER_THREAD"],undefined,undefined,undefined,[policy]);
    await choose("Approval before execution",`${policy.id}:2`);
    await fill("Instruction template","Review before execution");
    await click(button(section,"Review request"));
    expect(section.textContent).toContain(policy.id);
    await click(button(section,"Submit governed request"));
    await click(button(section,"Re-check same request"));
    const writes=t.send.mock.calls.filter(([r])=>r.path==="/api/v1/actions").map(([r])=>r.body);
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({automationVersionContent:{approvalPolicy:policy}});
    expect(writes[1]).toEqual(writes[0]);
  });

  it.each(["operationId", "actionExecutionId"])("rejects another %s while reconciling the frozen UNKNOWN request", async (field) => {
    const { section, t, fill } = await setup(["TRIGGER_THREAD"], undefined, undefined,
      { [field]: "foreign-operation", gateState: "DENIED", dispatchState: "NOT_DISPATCHED", reason: "PERMISSION_DENIED" });
    await fill("Instruction template", "Report");
    await click(button(section, "Review request"));
    await click(button(section, "Submit governed request"));
    await click(button(section, "Re-check same request"));
    expect(section.textContent).toContain("Outcome is not confirmed");
    expect(section.textContent).toContain("schedule-op");
    expect(section.textContent).not.toContain("foreign-operation");
    expect([...section.querySelectorAll("button")].map((node) => node.textContent)).not.toContain("Cancel request");
    await click(button(section, "Re-check same request"));
    const writes = t.send.mock.calls.filter(([request]) => request.path === "/api/v1/actions");
    expect(writes).toHaveLength(3);
    expect(writes[1]?.[0].body).toEqual(writes[0]?.[0].body);
    expect(writes[2]?.[0].body).toEqual(writes[0]?.[0].body);
  });

  it.each([undefined, [], ["TRIGGER_THREAD"], ["CHANNEL", "CHANNEL"], ["CHANNEL", "FUTURE"]].map((targets) => ({ targets })))(
    "does not offer Schedule for absent or unverified native capability (%j)", async ({ targets }) => {
      const { section, t } = await setup(targets);
      expect(section.querySelector('option[value="SCHEDULE"]')).toBeNull();
      expect(t.send.mock.calls.filter(([r]) => r.path === "/api/v1/actions")).toHaveLength(0);
    },
  );

  it("cannot submit a retained Schedule after selecting an executor without channel replies", async () => {
    const { section, t, choose, fill } = await setup(["CHANNEL"]);
    await choose("Trigger", "SCHEDULE");
    await click(section.querySelector<HTMLInputElement>('input[value="every_15_minutes"]')!);
    await fill("Offset (seconds)", "0"); await fill("Catch-up window (seconds)", "60");
    await fill("Instruction template", "Report");
    await choose("Executor installation", "thread-only");
    expect(button(section, "Review request").disabled).toBe(true);
    await act(async () => section.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(section.textContent).toContain("Scheduling is unavailable");
    expect(section.textContent).not.toContain("Submit governed request");
    expect(t.send.mock.calls.filter(([r]) => r.path === "/api/v1/actions")).toHaveLength(0);
  });

  it.each([["0", "0", "10"], ["300", "300", "10"], ["300", "0", "9"], ["300", "", "10"], ["1.5", "0", "10"]])(
    "rejects invalid or implicit interval values %j/%j/%j", async (every, offset, catchup) => {
      const { section, fill } = await setup(["CHANNEL"], scheduleContent);
      await click(button(section, "View definition"));
      await click(button(section, "Publish a new version"));
      await type(section.querySelector<HTMLInputElement>('#wf-trigger-interval')!, every);
      await fill("Offset (seconds)", offset); await fill("Catch-up window (seconds)", catchup);
      await fill("Instruction template", "Report");
      expect(button(section, "Review request").disabled).toBe(true);
    },
  );

  it("keeps the existing MENTION trigger and thread result without schedule fields", async () => {
    const { section, t, choose, fill } = await setup(["TRIGGER_THREAD"]);
    await choose("Trigger", "MENTION");
    await act(async () => [...section.querySelectorAll<HTMLElement>('[role="tab"]')].find((node) => node.textContent === "Advanced")!
      .dispatchEvent(new KeyboardEvent("keydown", {key:"Enter",bubbles:true})));
    await settle();
    await type(section.querySelector<HTMLInputElement>('input[aria-label="Advanced expression"]')!, 'str_starts_with(trigger_text, "help")');
    await fill("Instruction template", "Reply");
    await click(button(section, "Review request")); await click(button(section, "Submit governed request"));
    expect(t.send.mock.calls.find(([r]) => r.path === "/api/v1/actions")![0].body).toMatchObject({
      automationVersionContent: { trigger: { kind: "MENTION", filter: 'str_starts_with(trigger_text, "help")', mentionPrincipalId: installation.agentPrincipalId },
        action: { kind: "AGENT_TURN", template: "Reply" }, resultTarget: "TRIGGER_THREAD" },
    });
    const content = (t.send.mock.calls.find(([r]) => r.path === "/api/v1/actions")![0].body as { automationVersionContent: { trigger: object } }).automationVersionContent;
    expect(content.trigger).not.toHaveProperty("scheduleSpec");
  });

  it("reads and republishes the explicit Schedule version without changing its parameters", async () => {
    const { section, t } = await setup(["CHANNEL"], scheduleContent);
    await click(button(section, "View definition"));
    expect(section.textContent).toContain("Interval (seconds): 300");
    await click(button(section, "Publish a new version"));
    await settle();
    await click(button(section, "Review request")); await click(button(section, "Submit governed request"));
    expect(t.send.mock.calls.find(([r]) => r.path === "/api/v1/actions")![0].body).toMatchObject({
      actionKey: "automation.publish_version", resourceId: "schedule-automation", resourceVersion: 2,
      automationVersionContent: scheduleContent,
    });
  });

  it.each([undefined, [], [{id:"88888888-8888-4888-8888-888888888888",version:3}]])(
    "does not silently remove a version's unavailable step policy (%j)", async (policies) => {
      const content={...scheduleContent,approvalPolicy:{id:"88888888-8888-4888-8888-888888888888",version:2}};
      const {section,t}=await setup(["CHANNEL"],content,undefined,undefined,policies);
      await click(button(section,"View definition"));
      expect(section.textContent).toContain(content.approvalPolicy.id);
      await click(button(section,"Publish a new version")); await settle();
      expect(button(section,"Review request").disabled).toBe(true);
      await act(async()=>section.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
      expect(t.send.mock.calls.filter(([r])=>r.path==="/api/v1/actions")).toHaveLength(0);
      expect(section.textContent).toContain("cannot be verified");
    });

  it.each([{ targets: ["CHANNEL"] }, { targets: ["TRIGGER_THREAD"] }])("enable checks the selected executor's actual native target %j", async ({ targets }) => {
    const { section, t, choose } = await setup(targets, scheduleContent);
    await click(button(section, "View definition")); await click(button(section, "Enable"));
    await choose("Published version", "schedule-version"); await choose("Verified delegation", "schedule-grant");
    const supported = targets.includes("CHANNEL");
    expect(button(section, "Review request").disabled).toBe(!supported);
    await act(async () => section.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    if (supported) {
      await click(button(section, "Submit governed request"));
      expect(t.send.mock.calls.find(([r]) => r.path === "/api/v1/actions")![0].body).toMatchObject({
        actionKey: "automation.enable", assetId: "schedule-version", assetVersion: 1, delegationId: "schedule-grant", delegationVersion: 1,
      });
    } else expect(t.send.mock.calls.filter(([r]) => r.path === "/api/v1/actions")).toHaveLength(0);
  });

  it.each([
    { ...scheduleContent, resultTarget: "TRIGGER_THREAD" },
    { ...scheduleContent, trigger: { ...scheduleContent.trigger, textPrefix: "hidden" } },
    { ...scheduleContent, trigger: { kind: "WEBHOOK" } },
    { ...scheduleContent, trigger: { kind: "CHANNEL_MESSAGE", scheduleSpec: scheduleContent.trigger.scheduleSpec }, resultTarget: "TRIGGER_THREAD" },
  ])("rejects unsupported or mismatched version combinations rather than enabling them", async (content) => {
    const { section, t } = await setup(["CHANNEL"], content);
    await click(button(section, "View definition"));
    expect([...section.querySelectorAll("button")].some((node) => node.textContent === "Enable")).toBe(false);
    expect([...section.querySelectorAll("button")].some((node) => node.textContent === "Publish a new version")).toBe(false);
    expect(t.send.mock.calls.filter(([r]) => r.path === "/api/v1/actions")).toHaveLength(0);
  });
});

describe("Installation execute permission actions", () => {
  const installation = {
    resourceId: "installation-execute", workspaceId: "workspace-execute", agentResourceId: "definition-execute",
    pinnedVersionAssetId: "version-execute", agentPrincipalId: "agent-execute", agentPrincipalState: "ACTIVE",
    ownerPrincipalId: "human-owner", resourceVersion: 3, resourceState: "ACTIVE", state: "ACTIVE",
    activeProjectionGeneration: 1, projection: { generation: 1, agentVersionAssetId: "version-execute",
      runtimeProfileKey: "profile-execute", configHash: "a".repeat(64), state: "ACTIVE" },
    executionPermission: { requested: false, effective: false, canGrant: true, canRevoke: true },
  };
  const setup = async (action: Route, permission?: unknown, readPermission?: unknown) => {
    let row = { ...installation, executionPermission: permission, readPermission };
    const changeTarget = (id: string) => { row = { ...row, resourceId: id }; };
    const t = transport((r) => {
      if (r.path === "/api/v1/actions") return action(r);
      if (r.path === "/api/v1/tasks") return { status: 200, body: [] };
      if (r.path === "/api/v1/agent-definitions") return { status: 200, body: { definitions: [] } };
      if (r.path === "/api/v1/workspaces") return { status: 200, body: [{ id: row.workspaceId, name: "Execute workspace", slug: "execute" }] };
      if (r.path.startsWith("/api/v1/agent-installation-candidates")) return { status: 200, body: { workspaceId: row.workspaceId, canCreate: false, candidates: [] } };
      if (r.path.startsWith("/api/v1/agent-installations?")) return { status: 200, body: { installations: [row] } };
      if (r.path === `/api/v1/agent-installations/${row.resourceId}`) return { status: 200, body: row };
      return { status: 503, body: undefined };
    });
    const host = await mount(t, <AgentDefinitionsPage />);
    await settle();
    if (!host.textContent?.includes("View installation")) return { host, t, changeTarget };
    await click(button(host.querySelector("[data-testid=agent-installations]") as HTMLElement, "View installation"));
    await click(button(host, "View self-installation permission"));
    await settle();
    return { host, t, changeTarget };
  };

  it("submits exact target and version, never a browser-selected Agent; waiting remains approval", async () => {
    const { host, t } = await setup((r) => ({ status: 202, body: { actionKey: (r.body as { actionKey: string }).actionKey,
      actionExecutionId: "permission-ae", operationId: "permission-op", gateState: "WAITING", dispatchState: "NOT_DISPATCHED",
      approvalWorkflowId: "permission-approval" } }), installation.executionPermission);
    const section = host.querySelector("[data-testid=agent-installation-execute]") as HTMLElement;
    await click(button(section, "Review execute grant"));
    expect(t.send.mock.calls.filter(([r]) => r.path === "/api/v1/actions")).toHaveLength(0);
    await click(button(section, "Submit governed request"));
    const submitted = t.send.mock.calls.find(([r]) => r.path === "/api/v1/actions")![0].body as Record<string, unknown>;
    expect(submitted).toEqual({ actionKey: "agent.installation.execute.grant", idempotencyKey: expect.any(String),
      resourceId: installation.resourceId, resourceVersion: installation.resourceVersion });
    expect(section.textContent).toContain("permission-approval");
    expect(section.textContent).toContain("Self-installation execute is not effective");
    expect(section.textContent).not.toContain("Fresh execute check passed");
  });

  it("unknown revocation preserves the exact key across GET refresh and retry", async () => {
    const { host, t } = await setup((r) => ({ status: 202, body: { actionKey: (r.body as { actionKey: string }).actionKey,
      actionExecutionId: "revoke-ae", operationId: "revoke-op", gateState: "ALLOWED", dispatchState: "UNKNOWN" } }), installation.executionPermission);
    const section = host.querySelector("[data-testid=agent-installation-execute]") as HTMLElement;
    await click(button(section, "Review execute revocation"));
    await click(button(section, "Submit governed request"));
    await click(button(section, "Refresh"));
    await settle();
    expect(t.send.mock.calls.filter(([r]) => r.path === "/api/v1/actions")).toHaveLength(1);
    await click(button(section, "Re-check same request"));
    const writes = t.send.mock.calls.filter(([r]) => r.path === "/api/v1/actions").map(([r]) => r.body);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(writes[0]).toMatchObject({ actionKey: "agent.installation.execute.revoke", resourceId: installation.resourceId,
      resourceVersion: installation.resourceVersion, explicitConfirmation: true });
  });

  it("memory read grant uses the same permission control but freezes the exact Agent and requires owner approval", async () => {
    const { host, t } = await setup((r) => ({ status: 202, body: {
      actionKey: (r.body as { actionKey: string }).actionKey, actionExecutionId: "read-ae", operationId: "read-op",
      gateState: "WAITING", dispatchState: "NOT_DISPATCHED", approvalWorkflowId: "read-owner-approval",
    } }), installation.executionPermission, installation.executionPermission);
    const section = host.querySelector("[data-testid=agent-installation-read]") as HTMLElement;
    await click(button(section, "Review memory read grant"));
    expect(section.textContent).toContain("exact installation owner must approve");
    expect(section.textContent).toContain(installation.agentPrincipalId);
    expect(t.send.mock.calls.filter(([r]) => r.path === "/api/v1/actions")).toHaveLength(0);
    expect(button(host.querySelector("[data-testid=agent-installation-execute]") as HTMLElement, "Review execute grant").disabled).toBe(true);
    await click(button(section, "Submit governed request"));
    expect(t.send.mock.calls.find(([r]) => r.path === "/api/v1/actions")![0].body).toEqual({
      actionKey: "resource.grant_read", resourceId: installation.resourceId, resourceVersion: installation.resourceVersion,
      principalId: installation.agentPrincipalId, idempotencyKey: expect.any(String),
    });
    expect(section.textContent).toContain("read-owner-approval");
    expect(section.textContent).toContain("Self-installation memory read is not effective");
    expect(section.textContent).not.toContain("Fresh memory read check passed");
  });

  it("memory revocation keeps the original unknown intent when refreshed and then denied", async () => {
    let calls = 0;
    const { host, t } = await setup((r) => ++calls === 1 ? { status: 202, body: {
      actionKey: (r.body as { actionKey: string }).actionKey, actionExecutionId: "read-revoke-ae", operationId: "read-revoke-op",
      gateState: "ALLOWED", dispatchState: "UNKNOWN",
    } } : { status: 403, body: undefined }, installation.executionPermission, installation.executionPermission);
    const section = host.querySelector("[data-testid=agent-installation-read]") as HTMLElement;
    await click(button(section, "Review memory read revocation"));
    expect(section.textContent).toContain("reader relationship");
    await click(button(section, "Submit governed request"));
    await click(button(section, "Refresh"));
    await settle();
    await click(button(section, "Re-check same request"));
    const writes = t.send.mock.calls.filter(([r]) => r.path === "/api/v1/actions").map(([r]) => r.body);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(writes[0]).toMatchObject({ actionKey: "resource.revoke_read", principalId: installation.agentPrincipalId,
      resourceId: installation.resourceId, resourceVersion: installation.resourceVersion, explicitConfirmation: true });
    expect(button(section, "Re-check same request")).toBeTruthy();
    expect([...section.querySelectorAll("button")].some((node) => node.textContent === "Cancel")).toBe(false);
  });

  it.each([undefined, { requested: false, effective: "UNKNOWN", canGrant: true, canRevoke: true }])(
    "absent or malformed read permission never enables memory authorization (%j)", async (readPermission) => {
      const { host, t } = await setup(() => ({ status: 500, body: undefined }), installation.executionPermission, readPermission);
      expect(host.querySelector("[data-testid=agent-installation-read]")).toBeNull();
      expect(t.send.mock.calls.filter(([r]) => r.path === "/api/v1/actions")).toHaveLength(0);
    },
  );

  it("switching exact installation clears the old receipt in the same shared component", async () => {
    const { host, changeTarget } = await setup((r) => ({ status: 200, body: { actionKey: (r.body as { actionKey: string }).actionKey,
      actionExecutionId: "old-permission-ae", operationId: "old-permission-op", gateState: "ALLOWED", dispatchState: "DISPATCHED" } }), installation.executionPermission);
    let section = host.querySelector("[data-testid=agent-installation-execute]") as HTMLElement;
    await click(button(section, "Review execute grant"));
    await click(button(section, "Submit governed request"));
    expect(section.textContent).toContain("old-permission-op");
    changeTarget("installation-other");
    await click(button(section, "Refresh"));
    await settle();
    await click(button(host.querySelector("[data-testid=agent-installations]") as HTMLElement, "View installation"));
    await click(button(host, "View self-installation permission"));
    await settle();
    section = host.querySelector("[data-testid=agent-installation-execute]") as HTMLElement;
    expect(section.textContent).not.toContain("old-permission-op");
    expect(section.textContent).not.toContain("old-permission-ae");
  });

  it.each([undefined, { requested: true, effective: false, canGrant: false, canRevoke: false },
    { requested: false, effective: "UNKNOWN", canGrant: true, canRevoke: true }])("missing, disabled or malformed authority offers no write (%j)", async (permission) => {
    const { host, t } = await setup(() => ({ status: 500, body: undefined }), permission);
    expect(host.textContent).not.toContain("Review execute grant");
    expect(host.textContent).not.toContain("Review execute revocation");
    expect(t.send.mock.calls.filter(([r]) => r.path === "/api/v1/actions")).toHaveLength(0);
  });
});

describe("InstallationMemory BFF read boundaries", () => {
  const resource = "installation-1";
  const workspace = "workspace-1";
  const read: AgentMemoryReadView = {
    installationResourceId: resource, workspaceId: workspace, operationId: "memory-op-1",
    slug: "core", state: AgentMemoryReadViewState.Found, eventId: "a".repeat(64),
    createdAt: 1, content: "记忆", contentBytes: 6,
  };
  const entries: AgentMemoryEntryPage = {
    installationResourceId: resource, workspaceId: workspace, operationId: "memory-op-2",
    state: AgentMemoryEntryPageState.Complete,
    entries: [{ slug: "mem/context", eventId: "b".repeat(64), createdAt: 2, tombstone: false }],
  };

  it("requires exact scope, native head and returned UTF-8 size before rendering plaintext", () => {
    expect(validMemoryRead(read, resource, workspace, "core")).toBe(true);
    expect(validMemoryRead({ ...read, workspaceId: "other" }, resource, workspace, "core")).toBe(false);
    expect(validMemoryRead({ ...read, eventId: "A".repeat(64) }, resource, workspace, "core")).toBe(false);
    expect(validMemoryRead({ ...read, contentBytes: 2 }, resource, workspace, "core")).toBe(false);
    expect(validMemoryRead({ ...read, valueHash: "c".repeat(64) }, resource, workspace, "core")).toBe(true);
    expect(validMemoryRead({ ...read, valueHash: "not-a-native-hash" }, resource, workspace, "core")).toBe(false);
    expect(validMemoryRead({ installationResourceId: resource, workspaceId: workspace, operationId: read.operationId,
      slug: "mem/context", state: AgentMemoryReadViewState.Absent, valueHash: "c".repeat(64) }, resource, workspace, "mem/context")).toBe(false);
    expect(validMemoryRead({ ...read, state: AgentMemoryReadViewState.Unreadable }, resource, workspace, "core")).toBe(false);
  });

  it("does not turn partial, duplicate or malformed native inventory into a complete list", () => {
    expect(validMemoryEntries(entries, resource, workspace)).toBe(true);
    expect(validMemoryEntries({ ...entries, state: AgentMemoryEntryPageState.Unknown }, resource, workspace)).toBe(false);
    expect(validMemoryEntries({ ...entries, entries: [...entries.entries, ...entries.entries] }, resource, workspace)).toBe(false);
    expect(validMemoryEntries({ ...entries, entries: [{ ...entries.entries[0]!, slug: "mem/../context" }] }, resource, workspace)).toBe(false);
    expect(validMemoryEntries({ ...entries, entries: [], state: AgentMemoryEntryPageState.Unknown }, resource, workspace)).toBe(true);
  });

  it("reads only on explicit open and removes plaintext when the shared view is closed", async () => {
    const t = transport((r) => ({ status: 200, body: r.path.endsWith("/entries") ? entries : read }));
    const host = await mount(t, <InstallationMemory resourceId={resource} workspaceId={workspace} />);
    expect(t.send).not.toHaveBeenCalled();
    await click(button(host, "Read memory"));
    expect(host.querySelector("pre")?.textContent).toBe("记忆");
    expect(t.send.mock.calls.map(([r]) => r)).toEqual(expect.arrayContaining([
      { method: "GET", path: `/api/v1/agent-installations/${resource}/memory/core` },
      { method: "GET", path: `/api/v1/agent-installations/${resource}/memory/entries` },
    ]));
    await click(button(host, "Close memory"));
    expect(host.querySelector("pre")).toBeNull();
    expect(host.textContent).not.toContain("记忆");
  });

  it("rejects a wrong-scope body and does not report a failed inventory as empty", async () => {
    const t = transport((r) => r.path.endsWith("/entries")
      ? { status: 503, body: { class: ErrorClass.Unknown, reason: ReasonCode.DependencyUnavailable } }
      : { status: 200, body: { ...read, workspaceId: "other" } });
    const host = await mount(t, <InstallationMemory resourceId={resource} workspaceId={workspace} />);
    await click(button(host, "Read memory"));
    expect(host.querySelector("pre")).toBeNull();
    expect(host.textContent).not.toContain("记忆");
    expect(host.textContent).not.toContain("Complete snapshot contains no cold entries.");
  });
});

// After-implementation evidence of the shared Version/Installation/Grant page.
// These are transport responses to the real page, not persisted business rows.
describe("AgentDefinitionsPage governed Version Installation Grant", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());
  const definition = { resourceId: "agent-1", resourceVersion: 3, displayName: "Governed Agent",
    stableSlug: "governed-agent", ownerPrincipalId: "human-1", resourceState: "ACTIVE", status: "ACTIVE" };
  const content = { personaIdentity: { displayName: "Draft persona" }, instructions: "Exact draft instructions",
    runtimeProfileKey: "profile-1", modelRouteResourceId: "route-1", replyPolicy: "profile-declared-reply",
    skillVersionAssetIds: [], declaredToolResourceIds: [], capabilityRequirements: [], triggerDefaults: ["MENTION"],
    parallelism: 2, turnLimits: { idleTimeoutSeconds: 30, maxTurnDurationSeconds: 90 },
    memoryPolicy: { coreWrite: "HUMAN_ONLY", coldWrite: "DISABLED" } };
  const version = { assetId: "draft-1", assetVersion: 4, agentResourceId: definition.resourceId,
    ownerPrincipalId: "human-1", ordinal: 2, state: "DRAFT", configHash: "a".repeat(64), content,
    canUpdate: true, canPublish: true };
  const profile = { key: "profile-1", kind: "SERVER_CODEX", status: "ACTIVE", webAvailability: "ENABLED",
    capabilityContract: { maxParallelism: 3, maxIdleTimeoutSeconds: 60, maxTurnDurationSeconds: 120,
      replyPolicies: [content.replyPolicy], capabilityRequirements: ["knowledge.search@v1"] } };
  const route = { resourceId: "route-1", resourceVersion: 7, ownerPrincipalId: "route-owner",
    nativeConfigResourceId: "route-1", nativeRevision: 5, nativeConfigHash: "b".repeat(64) };
  const configuration = { agentResourceId: definition.resourceId, resourceVersion: definition.resourceVersion,
    profiles: [profile], routes: [route], canCreate: true, nextOffset: null };
  const installation = { resourceId: "installation-1", resourceVersion: 6, workspaceId: "workspace-1",
    agentResourceId: definition.resourceId, pinnedVersionAssetId: "published-1", ownerPrincipalId: "human-1",
    agentPrincipalId: "agent-principal-1", agentPrincipalState: "ACTIVE", state: "ACTIVE", resourceState: "ACTIVE",
    activeProjectionGeneration: 2, projection: { generation: 2, agentVersionAssetId: "published-1",
      runtimeProfileKey: profile.key, configHash: "c".repeat(64), state: "ACTIVE" } };
  const scope = { actionKey: "automation.run", actionVersion: 2, targetType: "RESOURCE", targetId: "automation-1",
    resultExposureMode: "CONSUME_ONLY", outputSchemaHash: "d".repeat(64), redactionPolicy: "PLATFORM_METADATA_ONLY" };
  const grant = { delegationId: "grant-1", delegationVersion: 8, grantorPrincipalId: "human-1", state: "ACTIVE", uses: 1,
    parameters: { validFrom: "2026-10-01T00:00:00.000Z", expiresAt: "2027-10-01T00:00:00.000Z", maxUses: 5, scopes: [scope] } };
  const submission = (actionKey: string, dispatchState = "DISPATCHED") => ({ actionKey,
    actionExecutionId: "exact-ae", operationId: "exact-operation", gateState: "ALLOWED", dispatchState });
  function routes(extra?: (request: BffRequest) => BffReply | Promise<BffReply> | undefined) {
    return transport((r) => {
      const reply = extra?.(r);
      if (reply) return reply;
      if (r.path === "/api/v1/tasks") return { status: 200, body: [] };
      if (r.path === "/api/v1/agent-definitions") return { status: 200, body: { definitions: [definition] } };
      if (r.path === `/api/v1/agent-definitions/${definition.resourceId}`) return { status: 200, body: definition };
      if (r.path.startsWith(`/api/v1/agent-definitions/${definition.resourceId}/versions?`)) return { status: 200,
        body: { agentResourceId: definition.resourceId, resourceVersion: definition.resourceVersion, versions: [version], nextOffset: null } };
      if (r.path.startsWith(`/api/v1/agent-definitions/${definition.resourceId}/version-configuration?`)) return { status: 200, body: configuration };
      if (r.path === "/api/v1/workspaces") return { status: 200, body: [{ id: installation.workspaceId, name: "Ops", slug: "ops" }] };
      if (r.path.startsWith("/api/v1/agent-installations?")) return { status: 200, body: { installations: [installation] } };
      if (r.path === `/api/v1/agent-installations/${installation.resourceId}`) return { status: 200, body: installation };
      if (r.path.startsWith(`/api/v1/agent-installations/${installation.resourceId}/delegations?`)) return { status: 200,
        body: { installationResourceId: installation.resourceId, resourceVersion: installation.resourceVersion,
          workspaceId: installation.workspaceId, canGrant: true, canRevoke: true, grants: [grant] } };
      if (r.path.startsWith(`/api/v1/agent-installations/${installation.resourceId}/delegation-targets?`)) return { status: 200,
        body: { installationResourceId: installation.resourceId, resourceVersion: installation.resourceVersion,
          workspaceId: installation.workspaceId, scopes: [scope] } };
      if (r.path.startsWith("/api/v1/agent-installation-candidates?")) return { status: 200,
        body: { workspaceId: installation.workspaceId, canCreate: true, candidates: [{ agentResourceId: definition.resourceId,
          resourceVersion: definition.resourceVersion, displayName: definition.displayName,
          agentVersionAssetId: installation.pinnedVersionAssetId, assetVersion: 9, ordinal: 1 }] } };
      if (r.path.startsWith("/api/v1/automations?")) return { status: 200, body: { automations: [] } };
      return forbidden;
    });
  }
  async function open(t: BffTransport) {
    const host = await mount(t, <AgentDefinitionsPage />);
    await settle();
    await click(button(host, "View definition"));
    return host;
  }
  function section(host: HTMLElement, name: string): HTMLElement {
    const found = host.querySelector<HTMLElement>(`[data-testid=${name}]`);
    if (!found) throw new Error(`Missing real page section ${name}`);
    return found;
  }
  async function openInstallDialog(host: HTMLElement) {
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]');
    if (dialog) await click(button(dialog, "Close"));
    await click(button(host, "Install published Agent version"));
    return section(host, "agent-installation-create");
  }
  async function change(host: HTMLElement, label: string, value: string) {
    const row = [...host.querySelectorAll("label")].find((row) => row.firstChild?.textContent === label);
    const field = row?.control ?? row?.querySelector("input,textarea,select");
    if (!field) throw new Error(`Missing real control ${label}`);
    if (field instanceof HTMLButtonElement) {
      await act(async () => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      await settle();
      const optionLabel = value === route.resourceId ? `${route.resourceId} · ${route.resourceVersion} · ${route.nativeRevision}`
        : value === "HUMAN_ONLY" ? "Human only" : value === "DISABLED" ? "Agent writes disabled" : value;
      const option = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
        .find((item) => item.textContent === optionLabel);
      if (!option) throw new Error(`Missing authorized option ${optionLabel}`);
      await click(option);
      expect(document.querySelector('[role="menu"]')).toBeNull();
      return;
    }
    const prototype = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    await act(async () => { setter?.call(field, value);
      field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
    await settle();
  }
  const posts = (t: ReturnType<typeof routes>) => t.send.mock.calls.map(([r]) => r).filter((r) => r.path === "/api/v1/actions");

  it("closes the delegation dialog on Back and can reopen the same installation", async () => {
    const t = routes();
    const host = await open(t);
    await click(button(host.querySelector<HTMLElement>('[role="dialog"]')!, "Close"));
    await click(button(section(host, "agent-installations"), "View installation"));
    await click(button(host, "View delegation grants"));
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain(grant.delegationId);
    await click(button(section(host, "agent-delegation-management"), "Back"));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await click(button(section(host, "agent-installations"), "View installation"));
    await click(button(host, "View delegation grants"));
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain(grant.delegationId);
    expect(posts(t)).toHaveLength(0);
  });

  it("upgrades the actual Installation with its freshly read version and preserves an UNKNOWN command", async () => {
    const current = { ...installation, canUpgrade: true, resourceVersion: 12 };
    const published = { ...version, state: "PUBLISHED", canUpdate: false, canPublish: false };
    const t = routes((r) => r.path.startsWith("/api/v1/agent-installations?")
      ? { status: 200, body: { installations: [{ ...installation, canUpgrade: true }] } }
      : r.path === `/api/v1/agent-installations/${installation.resourceId}` ? { status: 200, body: current }
      : r.path.includes("/versions?") ? { status: 200, body: { agentResourceId: definition.resourceId,
        resourceVersion: definition.resourceVersion, versions: [published, version], nextOffset: null } }
      : r.path === "/api/v1/actions" ? { status: 200, body: submission("agent.installation.upgrade", "UNKNOWN") } : undefined);
    const host = await open(t);
    await click(button(section(host, "agent-installations"), "View installation"));
    await click(button(host, "Upgrade / roll back version"));
    const action = section(host, "agent-installation-upgrade");
    expect(action.querySelectorAll("option")).toHaveLength(2);
    await change(action, "Published target version", version.assetId);
    await click(button(action, "Review request"));
    await click(button(action, "Request version change"));
    const command = posts(t)[0]?.body;
    expect(command).toEqual({ actionKey: "agent.installation.upgrade", idempotencyKey: expect.any(String),
      workspaceId: installation.workspaceId, resourceId: installation.resourceId, resourceVersion: 12,
      assetId: version.assetId, assetVersion: version.assetVersion });
    expect(action.textContent).toContain("Outcome is not confirmed.");
    expect([...action.querySelectorAll("button")].some((b) => b.textContent === "Cancel request")).toBe(false);
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')?.disabled).toBe(true);
    await click(button(action, "Re-check same request"));
    expect(posts(t)).toHaveLength(2);
    expect(posts(t)[1]?.body).toEqual(command);
  });

  it.each([undefined, false])("does not infer upgrade permission from an ACTIVE Installation (%j)", async (canUpgrade) => {
    const t = routes((r) => r.path.startsWith("/api/v1/agent-installations?")
      ? { status: 200, body: { installations: [{ ...installation, canUpgrade }] } } : undefined);
    const host = await open(t);
    await click(button(section(host, "agent-installations"), "View installation"));
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Upgrade / roll back version")).toBe(false);
    expect(posts(t)).toHaveLength(0);
  });

  it("uses the original identity cards and creation entry without executing an Agent", async () => {
    const t = routes();
    const host = await mount(t, <AgentDefinitionsPage />);
    await settle();
    const card = host.querySelector<HTMLElement>("[data-testid=agent-definition-agent-1]")!;
    expect(card.className).toContain("aspect-[4/5]");
    expect(card.textContent).toContain("Governed Agent");
    expect(card.textContent).not.toContain("Definition ready");
    expect(host.querySelector("[data-testid=agent-definition-editor]")).toBeNull();
    await click(host.querySelector<HTMLElement>("[data-testid=new-agent-card]")!);
    expect(host.querySelector("[role=dialog] [data-testid=agent-definition-editor]")).not.toBeNull();
    await click(button(host.querySelector("[role=dialog]") as HTMLElement, "Close"));
    await click(button(card, "View definition"));
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/agent-definitions/agent-1" });
    expect(posts(t)).toHaveLength(0);
  });

  it("renders installation identity only from its authorized exact pinned version", async () => {
    const t = routes((request) => request.path === "/api/v1/agent-versions/published-1"
      ? { status: 200, body: { ...version, assetId: "published-1", state: "PUBLISHED", canUpdate: false, canPublish: false,
        content: { ...content, personaIdentity: { displayName: "Pinned persona", description: "Actual pinned description" } } } } : undefined);
    const host = await mount(t, <AgentDefinitionsPage />);
    await settle();
    const card = host.querySelector<HTMLElement>("[data-testid=agent-installation-installation-1]")!;
    expect(card.textContent).toContain("Pinned persona");
    expect(card.textContent).toContain("Actual pinned description");
    expect(card.textContent).not.toContain("Governed Agent");
    await click(button(card, "View installation"));
    expect(host.querySelector("[data-testid=agent-installation-detail]")).not.toBeNull();
    expect(posts(t)).toHaveLength(0);
  });

  it("does not borrow another version identity or infer Version permission from an installation", async () => {
    const t = routes((request) => request.path === "/api/v1/agent-versions/published-1"
      ? { status: 200, body: { ...version, assetId: "another-version", content: { ...content,
        personaIdentity: { displayName: "Wrong identity" } } } } : undefined);
    const host = await mount(t, <AgentDefinitionsPage />);
    await settle();
    const card = host.querySelector<HTMLElement>("[data-testid=agent-installation-installation-1]")!;
    expect(card.textContent).not.toContain("Wrong identity");
    expect(card.parentElement?.querySelector("[role=status]")?.textContent).toContain("the result is unknown");
    expect(posts(t)).toHaveLength(0);
  });

  it("preserves explicit Tool references across directory pages and freezes them into draft content", async () => {
    const first = { resourceId: "list-tool", resourceVersion: 1, ownerPrincipalId: "human-1", name: "agent.memory.entry.list",
      actionKey: "agent.memory.entry.list", source: "PLATFORM_NATIVE", status: "ACTIVE", resourceState: "ACTIVE",
      canConsume: true, inputSchemaHash: "a".repeat(64), outputSchemaHash: "b".repeat(64) };
    const second = { ...first, resourceId: "read-tool", name: "agent.memory.entry.read", actionKey: "agent.memory.entry.read" };
    const t = routes((r) => r.path.startsWith("/api/v1/platform-tools?") ? { status: 200, body: {
      tools: [r.path.endsWith("offset=0") ? first : second],
      nextOffset: r.path.endsWith("offset=0") ? 7 : null,
    } } : r.path === "/api/v1/actions" ? { status: 200, body: submission("agent.version.update") } : undefined);
    const host = await open(t);
    await click(button(section(host, "agent-version-directory"), "Edit draft"));
    const action = section(host, "agent-version-action");
    await click(button(action, "Advanced"));
    const tools = [...action.querySelectorAll("fieldset")].find((node) => node.querySelector("legend")?.textContent === "Requested tools")!;
    const choose = async (name: string) => {
      const label = [...tools.querySelectorAll("label")].find((node) => node.textContent?.includes(name))!;
      await act(async () => label.querySelector("input")!.click()); await settle();
    };
    await choose(first.name);
    await click(button(tools, "Next page"));
    await choose(second.name);
    expect(tools.textContent).toContain(first.resourceId);
    expect(tools.textContent).toContain(second.resourceId);
    await click(button(action, "Review request"));
    expect(posts(t)).toHaveLength(0);
    expect(action.textContent).toContain("list-tool, read-tool");
    await click(button(action, "Submit governed request"));
    expect(posts(t)[0]?.body).toMatchObject({ agentVersionContent: { declaredToolResourceIds: [first.resourceId, second.resourceId] } });
  });

  it("does not silently clear a saved Tool reference when its directory is unavailable", async () => {
    const t = routes((r) => r.path.includes("/versions?") ? { status: 200, body: {
      agentResourceId: definition.resourceId, resourceVersion: definition.resourceVersion,
      versions: [{ ...version, content: { ...content, declaredToolResourceIds: ["unavailable-tool"] } }], nextOffset: null,
    } } : undefined);
    const host = await open(t);
    await click(button(section(host, "agent-version-directory"), "Edit draft"));
    const action = section(host, "agent-version-action");
    await click(button(action, "AdvancedRequired"));
    expect(action.textContent).toContain("unavailable-tool");
    expect(button(action, "Review request").disabled).toBe(true);
    expect(posts(t)).toHaveLength(0);
    await click(button(action, "Remove reference"));
    expect(button(action, "Review request").disabled).toBe(false);
  });

  it("never permits selecting a provisioning Tool", async () => {
    const t = routes((r) => r.path.startsWith("/api/v1/platform-tools?") ? { status: 200, body: {
      tools: [{ resourceId: "pending-tool", resourceVersion: 1, ownerPrincipalId: "human-1", name: "agent.memory.entry.list",
        actionKey: "agent.memory.entry.list", source: "PLATFORM_NATIVE", status: "PROVISIONING", resourceState: "PROVISIONING",
        canConsume: false, inputSchemaHash: "a".repeat(64), outputSchemaHash: "b".repeat(64) }],
    } } : undefined);
    const host = await open(t);
    await click(button(section(host, "agent-version-directory"), "Edit draft"));
    const action = section(host, "agent-version-action");
    await click(button(action, "Advanced"));
    const label = [...action.querySelectorAll("label")].find((node) => node.textContent?.includes("pending-tool"))!;
    expect(label.querySelector("input")!.disabled).toBe(true);
    expect(posts(t)).toHaveLength(0);
  });

  it("continues authorized empty Version/configuration scan pages and treats null as the end", async () => {
    const t = routes((r) => r.path.endsWith("/versions?offset=0") ? { status: 200, body: {
      agentResourceId: definition.resourceId, resourceVersion: definition.resourceVersion, versions: [], nextOffset: 7 } }
      : r.path.endsWith("/version-configuration?offset=0") ? { status: 200, body: {
        ...configuration, profiles: [], routes: [], canCreate: false, nextOffset: 9 } } : undefined);
    const host = await open(t);
    const directory = section(host, "agent-version-directory");
    expect(directory.textContent).toContain("No authorized versions on this page.");
    expect(directory.querySelector("[role=status]")).toBeNull();
    const sourcePager = [...directory.querySelectorAll("span")].find((span) => span.textContent === "Authorized configuration pages")?.parentElement;
    expect(sourcePager).toBeTruthy();
    await click(button(sourcePager!, "Next page"));
    expect(button(directory, "Create version draft")).toBeTruthy();
    await click(button(directory, "Next page"));
    expect(directory.textContent).toContain(version.configHash);
    expect(directory.textContent).not.toContain("No authorized versions on this page.");
    expect([...directory.querySelectorAll("button")].some((b) => b.textContent === "Next page")).toBe(false);
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/agent-definitions/agent-1/versions?offset=7" });
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/agent-definitions/agent-1/version-configuration?offset=9" });
    expect(posts(t)).toHaveLength(0);
  });

  it("creates a draft only from explicitly selected authorized configuration and previews before posting", async () => {
    const t = routes((r) => r.path === "/api/v1/actions" ? { status: 200, body: submission("agent.version.create") } : undefined);
    const host = await open(t);
    await click(button(section(host, "agent-version-directory"), "Create version draft"));
    const action = section(host, "agent-version-action");
    expect(button(action, "Review request").disabled).toBe(true);
    const editorForm = action.querySelector("form")!;
    const reviewButton = button(action, "Review request");
    expect(reviewButton.form).toBe(editorForm);
    expect(editorForm.contains(reviewButton)).toBe(false);
    expect(action.querySelector(".overflow-y-auto")!.contains(reviewButton)).toBe(false);
    expect(action.querySelectorAll("h2")).toHaveLength(1);
    expect(button(action, "AdvancedRequired").getAttribute("aria-expanded")).toBe("false");
    expect(action.querySelector('input[type="number"]')).toBeNull();
    await click(button(action, "AdvancedRequired"));
    const configurationPickers = action.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="menu"]');
    expect(configurationPickers).toHaveLength(5);
    expect([...configurationPickers].every((field) => field.textContent === "Choose a verified record")).toBe(true);
    expect(action.querySelectorAll("select")).toHaveLength(0);
    await change(action, "Agent name", "New governed draft");
    await change(action, "Instructions", "New exact instructions");
    await change(action, "Requested runtime profile", profile.key);
    await change(action, "Requested model route", route.resourceId);
    await change(action, "Reply policy declared by this runtime profile", content.replyPolicy);
    await change(action, "Requested parallelism", "2");
    await change(action, "Idle timeout (seconds)", "30");
    await change(action, "Maximum turn duration (seconds)", "90");
    await change(action, "Requested core memory write policy", "HUMAN_ONLY");
    await change(action, "Requested cold memory write policy", "DISABLED");
    expect(button(action, "Review request").disabled).toBe(false);
    await click(button(action, "Review request"));
    expect(posts(t)).toHaveLength(0);
    expect(action.textContent).toContain("New exact instructions");
    expect(action.querySelector(".overflow-y-auto")!.contains(button(action, "Submit governed request"))).toBe(false);
    await click(button(action, "Submit governed request"));
    expect(posts(t)).toHaveLength(1);
    expect(posts(t)[0]?.body).toEqual({ actionKey: "agent.version.create", idempotencyKey: expect.any(String),
      resourceId: definition.resourceId, resourceVersion: definition.resourceVersion,
      agentVersionContent: { ...content, personaIdentity: { displayName: "New governed draft" },
        instructions: "New exact instructions", triggerDefaults: [] } });
    expect(action.textContent).toContain("Request recorded.");
    expect(action.textContent).not.toContain("Outcome is not confirmed.");
  });

  it("updates exact DRAFT content without publish confirmation or changing installation pins", async () => {
    const t = routes((r) => r.path === "/api/v1/actions" ? { status: 200, body: submission("agent.version.update") } : undefined);
    const host = await open(t);
    await click(button(section(host, "agent-version-directory"), "Edit draft"));
    const action = section(host, "agent-version-action");
    await change(action, "Instructions", "Edited exact draft");
    await click(button(action, "Review request"));
    expect(posts(t)).toHaveLength(0);
    await click(button(action, "Submit governed request"));
    expect(posts(t)[0]?.body).toEqual({ actionKey: "agent.version.update", idempotencyKey: expect.any(String),
      resourceId: definition.resourceId, resourceVersion: definition.resourceVersion, assetId: version.assetId,
      assetVersion: version.assetVersion, agentVersionContent: { ...content, instructions: "Edited exact draft" } });
    expect(section(host, "agent-installations").textContent).toContain(installation.pinnedVersionAssetId);
    expect(posts(t)).toHaveLength(1);
  });

  it("retains advanced values through collapse and enforces the selected runtime limit before review", async () => {
    const t = routes((r) => r.path === "/api/v1/actions" ? { status: 200, body: submission("agent.version.update") } : undefined);
    const host = await open(t);
    await click(button(section(host, "agent-version-directory"), "Edit draft"));
    const action = section(host, "agent-version-action");
    expect(button(action, "Advanced").getAttribute("aria-expanded")).toBe("false");
    await click(button(action, "Advanced"));
    const field = action.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!;
    expect(field.max).toBe(String(profile.capabilityContract.maxParallelism));
    await change(action, "Requested parallelism", String(profile.capabilityContract.maxParallelism + 1));
    expect(button(action, "Review request").disabled).toBe(true);
    expect(action.querySelector('[data-testid="persona-advanced-required-badge"]')).not.toBeNull();
    await change(action, "Requested parallelism", "1");
    await click(button(action, "Advanced"));
    expect(button(action, "Advanced").getAttribute("aria-expanded")).toBe("false");
    await click(button(action, "Advanced"));
    expect(action.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!.value).toBe("1");
    await click(button(action, "Review request"));
    expect(posts(t)).toHaveLength(0);
    await click(button(action, "Submit governed request"));
    expect(posts(t)[0]?.body).toMatchObject({ agentVersionContent: { ...content, parallelism: 1 } });
  });

  it("preserves a historical description byte-for-byte when only instructions change", async () => {
    const description = "😀".repeat(300);
    const historical = { ...content, personaIdentity: { ...content.personaIdentity, description } };
    const t = routes((r) => r.path.includes("/versions?") ? { status: 200, body: {
      agentResourceId: definition.resourceId, resourceVersion: definition.resourceVersion,
      versions: [{ ...version, content: historical }], nextOffset: null,
    } } : r.path === "/api/v1/actions" ? { status: 200, body: submission("agent.version.update") } : undefined);
    const host = await open(t);
    await click(button(section(host, "agent-version-directory"), "Edit draft"));
    const action = section(host, "agent-version-action");
    expect(action.querySelector<HTMLInputElement>("#persona-description")!.value).toBe(description);
    await change(action, "Instructions", "Only instructions changed");
    await click(button(action, "Review request"));
    await click(button(action, "Submit governed request"));
    expect(posts(t)[0]?.body).toMatchObject({ agentVersionContent: { personaIdentity: historical.personaIdentity } });
  });

  it("keeps the original avatar upload pending before freezing the exact Version command", async () => {
    let complete!: (value: { url: string; type: string }) => void;
    const upload = vi.fn(() => new Promise<{ url: string; type: string }>((resolve) => { complete = resolve; }));
    const t = routes((r) => r.path === "/api/v1/actions" ? { status: 200, body: submission("agent.version.update") } : undefined);
    const host = await mount(t, <AgentDefinitionsPage avatarHost={() => ({ locale: "en", uploadMediaBytes: upload,
      rewriteMediaUrl: (url) => url, performDefaultHaptic: () => {} })} />);
    await settle();
    await click(button(host, "View definition"));
    await click(button(section(host, "agent-version-directory"), "Edit draft"));
    const action = section(host, "agent-version-action");
    const file = new File([new Uint8Array([137, 80, 78, 71])], "avatar.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([137, 80, 78, 71]).buffer });
    const input = action.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await settle();
    expect(button(action, "Review request").disabled).toBe(true);
    expect(button(action, "Cancel request").disabled).toBe(true);
    expect(action.querySelector('[aria-label="Close"]')).toBeNull();
    expect(posts(t)).toHaveLength(0);
    await act(async () => complete({ url: "https://community.example/media/avatar.png", type: "image/png" }));
    await settle();
    expect(button(action, "Review request").disabled).toBe(false);
    await click(button(action, "Review request"));
    await click(button(action, "Submit governed request"));
    expect(posts(t)[0]?.body).toMatchObject({ agentVersionContent: { personaIdentity: {
      displayName: content.personaIdentity.displayName, avatarUrl: "https://community.example/media/avatar.png",
    } } });
    expect(upload).toHaveBeenCalledExactlyOnceWith([137, 80, 78, 71]);
    expect(t.send.mock.calls.every(([request]) => request.method !== "POST" || request.path === "/api/v1/actions")).toBe(true);
  });

  it("publishes an immutable exact draft with Explicit Confirmation and no replacement content", async () => {
    let published = false;
    const t = routes((r) => {
      if (r.path === "/api/v1/actions") {
        published = true;
        return { status: 200, body: submission("agent.version.publish") };
      }
      if (r.path.startsWith("/api/v1/agent-installation-candidates?")) return { status: 200,
        body: { workspaceId: installation.workspaceId, canCreate: true, candidates: published ? [{
          agentResourceId: definition.resourceId, resourceVersion: definition.resourceVersion,
          displayName: definition.displayName, agentVersionAssetId: version.assetId,
          assetVersion: version.assetVersion + 1, ordinal: version.ordinal,
        }] : [] } };
      return undefined;
    });
    const host = await open(t);
    expect((await openInstallDialog(host)).textContent).toContain("No authorized published Agent version on this page.");
    await click(button(host.querySelector('[role="dialog"]') as HTMLElement, "Close"));
    await click(button(host, "View definition"));
    await click(button(section(host, "agent-version-directory"), "Publish exact draft"));
    const action = section(host, "agent-version-action");
    expect(action.querySelector("fieldset")?.disabled).toBe(true);
    await click(button(action, "Advanced"));
    expect(button(action, "Advanced").getAttribute("aria-expanded")).toBe("true");
    expect(action.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!.matches(":disabled")).toBe(true);
    await click(button(action, "Review request"));
    expect(posts(t)).toHaveLength(0);
    expect(action.textContent).toContain(version.configHash);
    expect(action.textContent).toContain("existing installations remain pinned");
    await click(button(action, "Submit governed request"));
    expect(posts(t)[0]?.body).toEqual({ actionKey: "agent.version.publish", idempotencyKey: expect.any(String),
      resourceId: definition.resourceId, resourceVersion: definition.resourceVersion,
      assetId: version.assetId, assetVersion: version.assetVersion, explicitConfirmation: true });
    const create = await openInstallDialog(host);
    expect(create.querySelector(`option[value="${version.assetId}"]`)).toBeTruthy();
    expect(create.textContent).not.toContain("No authorized published Agent version on this page.");
    await change(create, "Definition reference", version.assetId);
    await click(button(create, "Review request"));
    expect(create.textContent).toContain(`${version.assetId} · ${version.assetVersion + 1}`);
    expect(posts(t)).toHaveLength(1);
    expect(section(host, "agent-installations").textContent).toContain(installation.pinnedVersionAssetId);
  });

  it("refreshes installation candidates from the authority without changing Workspace", async () => {
    let available = false;
    const t = routes((r) => !available && r.path.startsWith("/api/v1/agent-installation-candidates?")
      ? { status: 200, body: { workspaceId: installation.workspaceId, canCreate: true, candidates: [] } } : undefined);
    const host = await open(t);
    const installed = section(host, "agent-installations");
    expect((await openInstallDialog(host)).textContent).toContain("No authorized published Agent version on this page.");
    await click(button(host.querySelector('[role="dialog"]') as HTMLElement, "Close"));
    available = true;
    await click(host.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!);
    expect((await openInstallDialog(host)).querySelector(`option[value="${installation.pinnedVersionAssetId}"]`)).toBeTruthy();
    expect(installed.querySelector("select")?.value).toBe(installation.workspaceId);
    expect(posts(t)).toHaveLength(0);
  });

  it("retires only the authorized exact published version without needing configuration providers", async () => {
    const published = { ...version, state: "PUBLISHED", canUpdate: false, canPublish: false, canRetire: true };
    const t = routes((r) => r.path.includes("/versions?") ? { status: 200, body: {
      agentResourceId: definition.resourceId, resourceVersion: definition.resourceVersion, versions: [published], nextOffset: null } }
      : r.path.includes("/version-configuration?") ? { status: 200, body: {
        ...configuration, profiles: [], routes: [], canCreate: false } }
      : r.path === "/api/v1/actions" ? { status: 200, body: submission("agent.version.retire") } : undefined);
    const host = await open(t);
    const reads = t.send.mock.calls.filter(([r]) => r.path.includes("/version-configuration?")).length;
    await click(button(section(host, "agent-version-directory"), "Retire exact published version"));
    const action = section(host, "agent-version-action");
    expect(action.querySelector("input,textarea,select")).toBeNull();
    expect(button(action, "Review request").disabled).toBe(false);
    expect(action.textContent).toContain(published.configHash);
    expect(action.textContent).toContain("without selecting a replacement");
    expect(t.send.mock.calls.filter(([r]) => r.path.includes("/version-configuration?"))).toHaveLength(reads);
    await click(button(action, "Review request"));
    expect(posts(t)).toHaveLength(0);
    await click(button(action, "Submit governed request"));
    expect(posts(t)[0]?.body).toEqual({ actionKey: "agent.version.retire", idempotencyKey: expect.any(String),
      resourceId: definition.resourceId, resourceVersion: definition.resourceVersion,
      assetId: published.assetId, assetVersion: published.assetVersion, explicitConfirmation: true });
    expect(section(host, "agent-installations").textContent).toContain(installation.pinnedVersionAssetId);
    expect(posts(t)).toHaveLength(1);
  });

  it.each([undefined, false])("never infers retire permission from published read/manage UI (%j)", async (canRetire) => {
    const t = routes((r) => r.path.includes("/versions?") ? { status: 200, body: {
      agentResourceId: definition.resourceId, resourceVersion: definition.resourceVersion,
      versions: [{ ...version, state: "PUBLISHED", canUpdate: false, canPublish: false, canRetire }], nextOffset: null } } : undefined);
    const host = await open(t);
    expect(section(host, "agent-version-directory").textContent).toContain("Published");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Retire exact published version")).toBe(false);
    expect(posts(t)).toHaveLength(0);
  });

  it.each(["DRAFT", "RETIRED"])("does not turn contradictory canRetire on %s into a write entry", async (state) => {
    const t = routes((r) => r.path.includes("/versions?") ? { status: 200, body: {
      agentResourceId: definition.resourceId, resourceVersion: definition.resourceVersion,
      versions: [{ ...version, state, canUpdate: false, canPublish: false, canRetire: true }], nextOffset: null } } : undefined);
    const host = await open(t);
    expect(section(host, "agent-version-directory").querySelector("[role=status]")).toBeTruthy();
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Retire exact published version")).toBe(false);
    expect(posts(t)).toHaveLength(0);
  });

  it("keeps UNKNOWN retire intent and key through repeated refused rechecks until its exact execution is confirmed", async () => {
    let count = 0;
    const t = routes((r) => {
      if (r.path.includes("/versions?")) return { status: 200, body: {
        agentResourceId: definition.resourceId, resourceVersion: definition.resourceVersion,
        versions: [{ ...version, state: "PUBLISHED", canUpdate: false, canPublish: false, canRetire: true }], nextOffset: null } };
      if (r.path !== "/api/v1/actions") return undefined;
      count += 1;
      return count === 1 ? { status: 200, body: submission("agent.version.retire", "UNKNOWN") }
        : count < 4 ? { status: count === 2 ? 403 : 409, body: {} }
        : { status: 200, body: submission("agent.version.retire") };
    });
    const host = await open(t);
    await click(button(section(host, "agent-version-directory"), "Retire exact published version"));
    const action = section(host, "agent-version-action");
    await click(button(action, "Review request"));
    await click(button(action, "Submit governed request"));
    const command = posts(t)[0]?.body;
    for (let retry = 0; retry < 2; retry += 1) {
      await click(button(action, "Re-check same request"));
      expect(action.textContent).toContain("Outcome is not confirmed.");
      expect([...action.querySelectorAll("button")].some((b) => b.textContent === "Cancel request")).toBe(false);
    }
    await click(button(action, "Re-check same request"));
    expect(posts(t)).toHaveLength(4);
    expect(posts(t).every((r) => JSON.stringify(r.body) === JSON.stringify(command))).toBe(true);
    expect(action.textContent).toContain("Request recorded.");
    expect(action.textContent).not.toContain("Outcome is not confirmed.");
  });

  it("keeps the exact draft route selected until its authorized configuration page is loaded", async () => {
    const laterRoute = { ...route, resourceId: "route-later", nativeConfigResourceId: "route-later" };
    const t = routes((r) => r.path.includes("/versions?") ? { status: 200, body: {
      agentResourceId: definition.resourceId, resourceVersion: definition.resourceVersion,
      versions: [{ ...version, content: { ...content, modelRouteResourceId: laterRoute.resourceId } }], nextOffset: null } }
      : r.path.endsWith("/version-configuration?offset=0") ? { status: 200, body: { ...configuration, nextOffset: 9 } }
      : r.path.endsWith("/version-configuration?offset=9") ? { status: 200, body: { ...configuration, routes: [laterRoute] } }
      : r.path === "/api/v1/actions" ? { status: 200, body: submission("agent.version.update") } : undefined);
    const host = await open(t);
    await click(button(section(host, "agent-version-directory"), "Edit draft"));
    const action = section(host, "agent-version-action");
    expect(button(action, "Review request").disabled).toBe(true);
    await click(button(action, "Next page"));
    expect(button(action, "Review request").disabled).toBe(false);
    await click(button(action, "Review request"));
    await click(button(action, "Submit governed request"));
    expect(posts(t)[0]?.body).toEqual({ actionKey: "agent.version.update", idempotencyKey: expect.any(String),
      resourceId: definition.resourceId, resourceVersion: definition.resourceVersion, assetId: version.assetId,
      assetVersion: version.assetVersion, agentVersionContent: { ...content, modelRouteResourceId: laterRoute.resourceId } });
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/agent-definitions/agent-1/version-configuration?offset=9" });
  });

  it.each(["PUBLISHED", "RETIRED"])("reads %s history without generating draft write controls", async (state) => {
    const t = routes((r) => r.path.includes("/versions?") ? { status: 200, body: {
      agentResourceId: definition.resourceId, resourceVersion: definition.resourceVersion,
      versions: [{ ...version, state, canUpdate: false, canPublish: false }], nextOffset: null } } : undefined);
    const host = await open(t);
    const directory = section(host, "agent-version-directory");
    expect(directory.textContent).toContain(version.configHash);
    expect([...directory.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Edit draft");
    expect([...directory.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Publish exact draft");
    expect(posts(t)).toHaveLength(0);
  });

  it.each([
    { ...configuration, profiles: [], routes: [], canCreate: false },
    { ...configuration, profiles: [{ ...profile, kind: "LOCAL_ACP", webAvailability: "DISABLED" }] },
  ])("does not supply a default or write entry when configuration is absent/unsupported (%j)", async (source) => {
    const t = routes((r) => r.path.includes("/version-configuration?") ? { status: 200, body: source } : undefined);
    const host = await open(t);
    const directory = section(host, "agent-version-directory");
    const labels = [...directory.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).not.toContain("Create version draft");
    expect(labels).not.toContain("Edit draft");
    expect(labels).not.toContain("Publish exact draft");
    expect(posts(t)).toHaveLength(0);
  });

  it.each([{ canUpdate: undefined, canPublish: undefined }, { canUpdate: false, canPublish: false }])(
    "does not infer draft write permissions from read or configuration (%j)", async (permission) => {
      const t = routes((r) => r.path.includes("/versions?") ? { status: 200, body: {
        agentResourceId: definition.resourceId, resourceVersion: definition.resourceVersion,
        versions: [{ ...version, ...permission }], nextOffset: null } } : undefined);
      const host = await open(t);
      const directory = section(host, "agent-version-directory");
      expect(directory.textContent).toContain(version.configHash);
      expect([...directory.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Edit draft");
      expect([...directory.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Publish exact draft");
      expect(posts(t)).toHaveLength(0);
    });

  it.each([
    { versions: [{ ...version, state: "FUTURE_STATE" }], nextOffset: null },
    { versions: [{ ...version, agentResourceId: "other-definition" }], nextOffset: null },
    { versions: [version, version], nextOffset: null },
    { versions: [version], nextOffset: 0 },
  ])("keeps invalid Version page facts unknown (%j)", async (page) => {
    const t = routes((r) => r.path.includes("/versions?") ? { status: 200, body: {
      agentResourceId: definition.resourceId, resourceVersion: definition.resourceVersion, ...page } } : undefined);
    const host = await open(t);
    const directory = section(host, "agent-version-directory");
    expect(directory.textContent).toContain("the result is unknown");
    expect(directory.textContent).not.toContain(version.configHash);
    expect([...directory.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Create version draft");
    expect(posts(t)).toHaveLength(0);
  });

  it.each(["actionExecutionId", "operationId"])("UNKNOWN publish retains its command and rejects changed %s", async (changed) => {
    let count = 0;
    const t = routes((r) => {
      if (r.path !== "/api/v1/actions") return undefined;
      count += 1;
      return { status: 200, body: count === 1 ? submission("agent.version.publish", "UNKNOWN")
        : count === 2 ? { ...submission("agent.version.publish"), [changed]: "foreign-execution" }
        : submission("agent.version.publish") };
    });
    const host = await open(t);
    await click(button(section(host, "agent-version-directory"), "Publish exact draft"));
    const action = section(host, "agent-version-action");
    await click(button(action, "Review request"));
    await click(button(action, "Submit governed request"));
    expect(action.textContent).toContain("Outcome is not confirmed.");
    expect(action.textContent).toContain("exact-operation");
    expect([...action.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Cancel");
    expect(button(host, "View definition").disabled).toBe(true);
    await click(button(action, "Re-check same request"));
    expect(action.textContent).toContain("Outcome is not confirmed.");
    expect(action.textContent).not.toContain("Request recorded.");
    expect(action.textContent).not.toContain("foreign-execution");
    expect(button(host, "View definition").disabled).toBe(true);
    await click(button(action, "Re-check same request"));
    expect(posts(t)).toHaveLength(3);
    expect(posts(t)[1]?.body).toEqual(posts(t)[0]?.body);
    expect(posts(t)[2]?.body).toEqual(posts(t)[0]?.body);
    expect(action.textContent).toContain("Request recorded.");
    expect(button(host, "View definition").disabled).toBe(false);
  });

  const installationTask = { ...submission("agent.installation.create"), actionVersion: 1,
    workspaceId: installation.workspaceId, targetId: "new-installation-2", createdAt: "2026-10-04T00:00:00.000Z",
    workflowId: "installation-workflow-1", workflowKind: "AGENT_INSTALLATION", taskStatus: "RUNNING" };
  async function install(host: HTMLElement) {
    const action = await openInstallDialog(host);
    await change(action, "Definition reference", installation.pinnedVersionAssetId);
    await click(button(action, "Review request"));
    await click(button(action, "Submit governed request"));
    return action;
  }

  it("reads the exact installation receipt Task and refreshes outcome without another install", async () => {
    let reads = 0;
    const t = routes((r) => r.path === "/api/v1/actions" ? { status: 200, body: {
      ...submission("agent.installation.create"), workflowId: installationTask.workflowId } }
      : r.path === "/api/v1/tasks/exact-ae" ? { status: 200, body: {
        ...installationTask, taskStatus: ++reads === 1 ? "RUNNING" : "COMPLETED" } } : undefined);
    const host = await open(t);
    await install(host);
    const task = section(host, "agent-installation-task");
    expect(task.textContent).toContain("Running");
    expect(task.textContent).toContain(installationTask.targetId);
    expect(task.textContent).toContain(installationTask.workflowId);
    expect(task.textContent).toContain("exact-operation");
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/tasks/exact-ae" });
    await click(button(task, "Refresh"));
    expect(task.textContent).toContain("Completed");
    expect(reads).toBe(2);
    expect(posts(t)).toHaveLength(1);
  });

  it.each([
    { actionExecutionId: "another-ae" }, { operationId: "another-operation" },
    { actionKey: "agent.version.publish" }, { workspaceId: "another-workspace" },
    { workflowId: "another-workflow" }, { workflowKind: "TENANT_LIFECYCLE" },
    { workflowId: undefined }, { workflowKind: undefined }, { taskStatus: "FUTURE_STATE" },
    { waitingReason: { stage: "native" } },
  ])("rejects a foreign or incomplete installation Task receipt (%j)", async (changed) => {
    const t = routes((r) => r.path === "/api/v1/actions" ? { status: 200, body: {
      ...submission("agent.installation.create"), workflowId: installationTask.workflowId } }
      : r.path === "/api/v1/tasks/exact-ae" ? { status: 200, body: {
        ...installationTask, taskStatus: "COMPLETED", ...changed } } : undefined);
    const host = await open(t);
    await install(host);
    const task = section(host, "agent-installation-task");
    expect(task.textContent).toContain("the result is unknown");
    expect(task.textContent).not.toContain("Completed");
    expect(task.textContent).not.toContain("Applied");
    expect(task.textContent).not.toContain(installationTask.targetId);
    expect(posts(t)).toHaveLength(1);
  });

  it.each([
    { observation: "EXTERNAL_RESULT_UNKNOWN", label: "Outcome not known yet" },
    { observation: "PROJECTION_DELAYED", label: "Status may be out of date" },
  ])("does not treat an observed installation %s as a terminal outcome", async ({ observation, label }) => {
    const t = routes((r) => r.path === "/api/v1/actions" ? { status: 200, body: submission("agent.installation.create", "UNKNOWN") }
      : r.path === "/api/v1/tasks/exact-ae" ? { status: 200, body: {
        ...installationTask, taskStatus: "COMPLETED", observation } } : undefined);
    const host = await open(t);
    const action = await install(host);
    const task = section(host, "agent-installation-task");
    expect(task.textContent).toContain(label);
    expect(task.textContent).not.toContain("Completed");
    expect(action.textContent).toContain("Outcome is not confirmed.");
    expect(button(action, "Re-check same request")).toBeTruthy();
    expect(section(host, "agent-installations").querySelector("select")?.disabled).toBe(true);
    await click(button(task, "Refresh"));
    expect(posts(t)).toHaveLength(1);
  });

  it("does not present a dispatched installation without Workflow evidence as a synchronous applied action", async () => {
    const t = routes((r) => r.path === "/api/v1/actions" ? { status: 200, body: submission("agent.installation.create") }
      : r.path === "/api/v1/tasks/exact-ae" ? { status: 200, body: {
        ...installationTask, workflowId: undefined, workflowKind: undefined, taskStatus: undefined } } : undefined);
    const host = await open(t);
    await install(host);
    const task = section(host, "agent-installation-task");
    expect(task.textContent).toContain("the result is unknown");
    expect(task.textContent).not.toContain("Applied");
    expect(task.textContent).not.toContain(installationTask.targetId);
    expect(posts(t)).toHaveLength(1);
  });

  it("drops a late installation Task response after switching Workspace", async () => {
    let resolveTask: (reply: BffReply) => void = () => {};
    const t = routes((r) => r.path === "/api/v1/actions" ? { status: 200, body: submission("agent.installation.create") }
      : r.path === "/api/v1/tasks/exact-ae" ? new Promise<BffReply>((resolve) => { resolveTask = resolve; })
      : r.path === "/api/v1/workspaces" ? { status: 200, body: [
        { id: installation.workspaceId, name: "Ops", slug: "ops" }, { id: "workspace-2", name: "Other", slug: "other" } ] }
      : undefined);
    const host = await open(t);
    await install(host);
    expect(section(host, "agent-installation-task").textContent).toContain("Loading");
    await change(section(host, "agent-installations"), "Workspace", "workspace-2");
    expect(host.querySelector("[data-testid=agent-installation-task]")).toBeNull();
    await act(async () => resolveTask({ status: 200, body: { ...installationTask, taskStatus: "COMPLETED" } }));
    await settle();
    expect(host.querySelector("[data-testid=agent-installation-task]")).toBeNull();
    expect(section(host, "agent-installation-create").textContent).not.toContain("exact-operation");
    expect(posts(t)).toHaveLength(1);
  });

  it("drops a late installation Task response when the host replaces its session client", async () => {
    let resolveTask: (reply: BffReply) => void = () => {};
    const t = routes((r) => r.path === "/api/v1/actions" ? { status: 200, body: submission("agent.installation.create") }
      : r.path === "/api/v1/tasks/exact-ae" ? new Promise<BffReply>((resolve) => { resolveTask = resolve; }) : undefined);
    const next = routes();
    let changeSession = () => {};
    function SessionHost() {
      const [client, setClient] = useState(() => createBffClient(t));
      changeSession = () => setClient(createBffClient(next));
      return <PlatformProvider client={client} locale="en"><AgentDefinitionsPage /></PlatformProvider>;
    }
    await render(<SessionHost />);
    const host = document.body;
    await settle();
    await click(button(host, "View definition"));
    await install(host);
    await act(async () => changeSession());
    await act(async () => resolveTask({ status: 200, body: { ...installationTask, taskStatus: "COMPLETED" } }));
    await settle();
    expect(host.querySelector("[data-testid=agent-installation-task]")).toBeNull();
    expect(host.textContent).not.toContain("exact-operation");
    expect(posts(t)).toHaveLength(1);
    expect(posts(next)).toHaveLength(0);
  });

  it("installation UNKNOWN freezes the exact published candidate and rejects another operation", async () => {
    let count = 0;
    const t = routes((r) => {
      if (r.path !== "/api/v1/actions") return undefined;
      if (r.body && typeof r.body === "object" && "actionKey" in r.body && r.body.actionKey === "agent.version.publish") {
        return { status: 200, body: submission("agent.version.publish") };
      }
      count += 1;
      return { status: 200, body: count === 1 ? submission("agent.installation.create", "UNKNOWN")
        : { ...submission("agent.installation.create"), operationId: "foreign-operation" } };
    });
    const host = await open(t);
    const action = await openInstallDialog(host);
    await change(action, "Definition reference", installation.pinnedVersionAssetId);
    await click(button(action, "Review request"));
    expect(posts(t)).toHaveLength(0);
    await click(button(action, "Submit governed request"));
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(async () => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector('[role="dialog"]')).toBe(dialog);
    expect(section(host, "agent-installation-create")).toBe(action);
    expect(action.textContent).toContain("Outcome is not confirmed.");
    await click(button(action, "Re-check same request"));
    expect(posts(t)).toHaveLength(2);
    expect(posts(t)[0]?.body).toEqual({ actionKey: "agent.installation.create", idempotencyKey: expect.any(String),
      workspaceId: installation.workspaceId, resourceId: definition.resourceId, resourceVersion: definition.resourceVersion,
      assetId: installation.pinnedVersionAssetId, assetVersion: 9 });
    expect(posts(t)[1]?.body).toEqual(posts(t)[0]?.body);
    expect(action.textContent).toContain("Outcome is not confirmed.");
    expect(action.textContent).toContain("exact-operation");
    expect(action.textContent).not.toMatch(/Request recorded\.|foreign-operation/);
    expect(section(host, "agent-installations").querySelector("select")?.disabled).toBe(true);
  });

  it.each([false, true])("delegation %s freezes returned scope/revocation and exact UNKNOWN execution", async (revoke) => {
    const actionKey = revoke ? "agent.delegation.revoke" : "agent.delegation.grant";
    let count = 0;
    const t = routes((r) => {
      if (r.path !== "/api/v1/actions") return undefined;
      count += 1;
      return { status: 200, body: count === 1 ? submission(actionKey, "UNKNOWN")
        : { ...submission(actionKey), actionExecutionId: "foreign-ae" } };
    });
    const host = await open(t);
    const installed = section(host, "agent-installations");
    await click(button(installed, "View installation"));
    await click(button(host, "View delegation grants"));
    const action = section(host, "agent-delegation-management");
    if (revoke) await click(button(action, "Review revocation"));
    else {
      const select = action.querySelector("select");
      const option = select?.querySelectorAll("option")[1];
      expect(option).toBeTruthy();
      await change(action, "Exact governed action and target", option!.value);
      await change(action, "Valid from", "2026-10-03T12:00:00");
      await change(action, "Expires at", "2027-10-03T12:00:00");
      await change(action, "Maximum uses", "3");
      await click(button(action, "Review request"));
    }
    expect(posts(t)).toHaveLength(0);
    expect(action.textContent).toContain(scope.outputSchemaHash);
    await click(button(action, "Submit governed request"));
    await click(button(action, "Re-check same request"));
    expect(posts(t)).toHaveLength(2);
    expect(posts(t)[1]?.body).toEqual(posts(t)[0]?.body);
    expect(posts(t)[0]?.body).toEqual({ actionKey, resourceId: installation.resourceId,
      resourceVersion: installation.resourceVersion, idempotencyKey: expect.any(String), explicitConfirmation: true,
      delegationId: revoke ? grant.delegationId : expect.any(String), ...(revoke ? { delegationVersion: grant.delegationVersion }
        : { delegationGrant: { validFrom: new Date("2026-10-03T12:00:00"),
          expiresAt: new Date("2027-10-03T12:00:00"), maxUses: 3, scopes: [scope] } }) });
    expect(action.textContent).toContain("Outcome is not confirmed.");
    expect(action.textContent).toContain("exact-operation");
    expect(action.textContent).not.toMatch(/Request recorded\.|foreign-ae/);
    expect(button(installed, "View installation").disabled).toBe(true);
  });

  const recheckActions = [
    { kind: "installation", actionKey: "agent.installation.create", testId: "agent-installation-create" },
    { kind: "version", actionKey: "agent.version.publish", testId: "agent-version-action" },
    { kind: "delegation", actionKey: "agent.delegation.grant", testId: "agent-delegation-management" },
  ];
  async function prepareRecheck(host: HTMLElement, kind: string, testId: string) {
    if (kind === "installation") {
      await openInstallDialog(host);
    } else if (kind === "version") {
      await click(button(section(host, "agent-version-directory"), "Publish exact draft"));
    } else if (kind === "delegation") {
      const installed = section(host, "agent-installations");
      await click(button(installed, "View installation"));
      await click(button(host, "View delegation grants"));
    }
    const action = section(host, testId);
    if (kind === "installation") {
      await change(action, "Definition reference", installation.pinnedVersionAssetId);
    } else if (kind === "delegation") {
      const option = action.querySelector("select")?.querySelectorAll("option")[1];
      expect(option).toBeTruthy();
      await change(action, "Exact governed action and target", option!.value);
      await change(action, "Valid from", "2026-10-03T12:00:00");
      await change(action, "Expires at", "2027-10-03T12:00:00");
    }
    await click(button(action, "Review request"));
    return action;
  }

  it.each(recheckActions.flatMap((action) => [false, true].map((transportUnknown) => ({ ...action, transportUnknown }))))(
    "$kind keeps the original unknown request through repeated 403/409 (transport=$transportUnknown)",
    async ({ kind, actionKey, testId, transportUnknown }) => {
      let count = 0;
      const t = routes((r) => {
        if (r.path !== "/api/v1/actions") return undefined;
        count += 1;
        if (count === 1) {
          if (transportUnknown) throw new TransportError("reply unavailable");
          return { status: 200, body: submission(actionKey, "UNKNOWN") };
        }
        if (count === 2) return { status: 403, body: { class: ErrorClass.Denied, reason: ReasonCode.PermissionDenied } };
        if (count === 3) return { status: 409, body: { class: ErrorClass.Conflict, reason: ReasonCode.TargetStateConflict } };
        return { status: 200, body: submission(actionKey) };
      });
      const host = await open(t);
      const action = await prepareRecheck(host, kind, testId);
      await click(button(action, "Submit governed request"));
      for (let retry = 0; retry < 2; retry += 1) {
        expect(action.textContent).toContain("Outcome is not confirmed.");
        expect([...action.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Cancel request");
        await click(button(action, "Re-check same request"));
        expect(action.textContent).toContain("Outcome is not confirmed.");
        expect(action.textContent).not.toContain("Request recorded.");
        expect(action.querySelector(":scope > [role=alert]")).toBeNull();
        expect([...action.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Cancel request");
        if (!transportUnknown) expect(action.textContent).toContain("exact-operation");
        if (kind === "version") expect(button(host, "View definition").disabled).toBe(true);
        else if (kind === "delegation") expect(button(section(host, "agent-installations"), "View installation").disabled).toBe(true);
        else expect(section(host, "agent-installations").querySelector("select")?.disabled).toBe(true);
      }
      await click(button(action, "Re-check same request"));
      expect(posts(t)).toHaveLength(4);
      for (const request of posts(t).slice(1)) expect(request.body).toEqual(posts(t)[0]?.body);
      expect(action.textContent).toContain("Request recorded.");
      expect(action.textContent).not.toContain("Outcome is not confirmed.");
    },
  );

  it.each(recheckActions.flatMap((action) => [403, 409].map((status) => ({ ...action, status }))))(
    "$kind may release a first definite refusal ($status)",
    async ({ kind, actionKey, testId, status }) => {
      const t = routes((r) => r.path === "/api/v1/actions" ? { status,
        body: { class: status === 403 ? ErrorClass.Denied : ErrorClass.Conflict,
          reason: status === 403 ? ReasonCode.PermissionDenied : ReasonCode.TargetStateConflict } } : undefined);
      const host = await open(t);
      const action = await prepareRecheck(host, kind, testId);
      await click(button(action, "Submit governed request"));
      expect(posts(t)).toHaveLength(1);
      expect(posts(t)[0]?.body).toEqual(expect.objectContaining({ actionKey }));
      expect(action.querySelector("[role=alert]")).not.toBeNull();
      expect(action.textContent).not.toContain("Outcome is not confirmed.");
      expect([...action.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Re-check same request");
      if (kind === "version") {
        expect(button(action, "Cancel request").disabled).toBe(false);
        await click(button(action, "Cancel request"));
        expect(button(host, "View definition").disabled).toBe(false);
      }
      else if (kind === "delegation") expect(button(section(host, "agent-installations"), "View installation").disabled).toBe(false);
      else expect(section(host, "agent-installations").querySelector("select")?.disabled).toBe(false);
    },
  );
});

describe("DevicesPage", () => {
  it("读不到不是「没有设备」：显示结果不明并可重试", async () => {
    let fail = true;
    const t = transport(() => {
      if (fail) throw new TransportError("down");
      return { status: 200, body: [key("a".repeat(64))] };
    });
    const host = await mount(t, <DevicesPage />);
    await settle();
    expect(host.textContent).toContain("the result is unknown");
    expect(host.textContent).not.toContain("No devices yet");
    fail = false;
    await click(button(host, "Try again"));
    expect(host.textContent).toContain("aaaaaaaa…aaaa");
  });

  it("标出本机；撤销结果不明时不说成功也不说失败", async () => {
    const mine = "b".repeat(64);
    const t = transport((r) => {
      if (r.method === "DELETE")
        return { status: 503, body: { class: ErrorClass.Unknown, reason: ReasonCode.DependencyUnavailable, operationId: "op-7" } };
      return { status: 200, body: [key(mine), key("c".repeat(64))] };
    });
    const host = await mount(t, <DevicesPage currentDevicePubkey={mine} />);
    await settle();
    expect(host.textContent).toContain("This device");
    expect(host.textContent).toContain("Active");
    expect(host.textContent).not.toContain("ACTIVE");
    await click(host.querySelectorAll("button")[0] as HTMLButtonElement);
    const alert = host.querySelector("[role=alert]")?.textContent ?? "";
    expect(alert).toContain("unknown");
    expect(alert).toContain("op-7");
    expect(alert).not.toContain("rejected");
    // 撤销之后重新读取列表，不自己推断状态
    expect(t.send.mock.calls.filter(([r]) => r.method === "GET")).toHaveLength(2);
  });

  it("确定被拒时给出 reason", async () => {
    const t = transport((r) =>
      r.method === "DELETE"
        ? { status: 404, body: { class: ErrorClass.Precondition, reason: ReasonCode.ClientKeyNotFound } }
        : { status: 200, body: [key("d".repeat(64))] },
    );
    const host = await mount(t, <DevicesPage />);
    await settle();
    await click(button(host, "Revoke"));
    expect(host.querySelector("[role=alert]")?.textContent).toContain("CLIENT_KEY_NOT_FOUND");
  });
});

describe("WorkspaceMembersPage", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype,"offsetHeight","get").mockReturnValue(420);
    vi.spyOn(HTMLElement.prototype,"offsetWidth","get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockReturnValue(new DOMRect(0,0,800,420));
  });
  afterEach(() => vi.restoreAllMocks());
  it("取 Workspace 后按人列出成员与全部公钥", async () => {
    const t = transport((r) =>
      r.path === "/api/v1/workspaces"
        ? { status: 200, body: [{ id: "w1", name: "Ops", slug: "ops", isMember: true }] }
        : r.path.startsWith("/api/v1/role-workspaces")
          ? { status: 200, body: { workspaces: [{ id: "w1", name: "Ops", state: "ACTIVE" }] } }
        : r.path.startsWith("/api/v1/role-members")
          ? { status: 403, body: {} }
        : {
            status: 200,
            body: [
              { principalId: "p1", displayName: "Ada", state: "ACTIVE", pubkeys: ["e".repeat(64), "f".repeat(64)] },
            ],
          },
    );
    const host = await mount(t, <WorkspaceMembersPage />);
    await settle();
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/workspaces/w1/members" });
    expect(host.textContent).toContain("Ada");
    expect(host.textContent).toContain("Member");
    expect(host.textContent).not.toContain("ACTIVE");
    expect(host.textContent).toContain("eeeeeeee…eeee");
    expect(host.textContent).toContain("ffffffff…ffff");
  });

  it("没有可进入的 Workspace 就不画选择器", async () => {
    const host = await mount(transport((r) =>
      r.path.startsWith("/api/v1/role-members")
        ? { status: 403, body: {} }
        : r.path.startsWith("/api/v1/role-workspaces")
          ? { status: 200, body: { workspaces: [] } }
        : { status: 200, body: [] },
    ), <WorkspaceMembersPage />);
    await settle();
    expect(host.querySelector("select")).toBeNull();
    expect(host.textContent).toContain("no workspace");
  });
});

describe("LegacySecretRefManagement", () => {
  const binding = {
    principalId: "00000000-0000-0000-0000-000000000009",
    pubkey: "a".repeat(64),
    kind: "HUMAN",
  };

  it("无 Tenant manage 时入口不出现；读失败不伪装为空列表", async () => {
    const denied = await mount(transport(() => ({ status: 403, body: {} })), <LegacySecretRefManagement />);
    await settle();
    expect(denied.querySelector("[data-testid=legacy-secret-ref-management]")).toBeNull();
    const unpublished = await mount(transport(() => ({ status: 404, body: {} })), <LegacySecretRefManagement />);
    await settle();
    expect(unpublished.querySelector("[data-testid=legacy-secret-ref-management]")).toBeNull();
    const down = await mount(transport(() => ({ status: 503, body: {} })), <LegacySecretRefManagement />);
    await settle();
    expect(down.textContent).toContain("the result is unknown");
    expect(down.textContent).not.toContain("No legacy identity references");
  });

  it("显式确认后经语义命令提交；结果不明重试复用同一幂等键", async () => {
    let posts = 0;
    const t = transport((r) => {
      if (r.method === "GET") return { status: 200, body: { bindings: [binding] } };
      posts += 1;
      if (posts === 1) throw new TransportError("reply lost");
      return {
        status: 200,
        body: {
          actionKey: "identity.secret_ref.rehome",
          actionExecutionId: "execution-9",
          operationId: "operation-9",
          gateState: "ALLOWED",
          dispatchState: "DISPATCHED",
        },
      };
    });
    const host = await mount(t, <LegacySecretRefManagement />);
    await settle();
    await click(button(host, "Move reference"));
    expect(t.send.mock.calls.filter(([r]) => r.method === "POST")).toHaveLength(0);
    expect(host.textContent).toContain(binding.pubkey);
    await click(button(host, "Confirm"));
    expect(host.textContent).toContain("outcome unknown");
    await click(button(host, "Confirm"));
    const submitted = t.send.mock.calls
      .map(([r]) => r)
      .filter((r) => r.method === "POST");
    expect(submitted).toHaveLength(2);
    expect(submitted[0]?.body).toEqual(expect.objectContaining({
      actionKey: "identity.secret_ref.rehome",
      principalId: binding.principalId,
      explicitConfirmation: true,
    }));
    expect((submitted[0]?.body as { idempotencyKey: string }).idempotencyKey)
      .toBe((submitted[1]?.body as { idempotencyKey: string }).idempotencyKey);
    expect(host.textContent).toContain("Check Tasks for the final result");
  });
});

describe("RoleMembers", () => {
  const members = [
    {
      principalId: "00000000-0000-0000-0000-000000000001",
      displayName: "Ada",
      tenantAdmin: true,
      workspaceAdmin: false,
      canGrantTenantAdmin: false,
      canRevokeTenantAdmin: false,
      canGrantWorkspaceAdmin: false,
      canRevokeWorkspaceAdmin: false,
      lastTenantAdmin: true,
    },
    {
      principalId: "00000000-0000-0000-0000-000000000002",
      displayName: "Bo",
      tenantAdmin: false,
      workspaceAdmin: false,
      canGrantTenantAdmin: true,
      canRevokeTenantAdmin: false,
      canGrantWorkspaceAdmin: false,
      canRevokeWorkspaceAdmin: false,
      lastTenantAdmin: false,
    },
  ];

  it("候选人不依赖 WorkspaceMembership；最后一位 admin 不能撤，授予仍走 Governed Action", async () => {
    const t = transport((r) =>
      r.method === "POST"
        ? {
            status: 200,
            body: {
              actionKey: "tenant.admin.grant",
              actionExecutionId: "execution-1",
              operationId: "operation-1",
              gateState: "ALLOWED",
              dispatchState: "DISPATCHED",
            },
          }
        : { status: 200, body: { members } },
    );
    const host = await mount(t, <RoleMembers />);
    await settle();
    expect(host.textContent).toContain("Ada");
    expect(host.textContent).toContain("Bo");
    expect(host.textContent).toContain("LAST_TENANT_ADMIN");
    expect(button(host, "Revoke").disabled).toBe(true);
    await click(button(host, "Grant"));
    await click(button(host, "Confirm"));
    expect(t.send).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      path: "/api/v1/actions",
      body: expect.objectContaining({
        actionKey: "tenant.admin.grant",
        principalId: "00000000-0000-0000-0000-000000000002",
      }),
    }));
    expect(host.textContent).toContain("Check Tasks for its final result");
  });

  it("角色关系读取失败不变成空角色；无管理权时整节不出现", async () => {
    const down = await mount(transport(() => ({ status: 503, body: {} })), <RoleMembers />);
    await settle();
    expect(down.textContent).toContain("result is unknown");
    const denied = await mount(transport(() => ({ status: 403, body: {} })), <RoleMembers />);
    await settle();
    expect(denied.textContent).toBe("");
  });

  it("角色管理的 200 响应缺字段时显示读取失败，不当作空列表", async () => {
    const host = await mount(transport(() => ({ status: 200, body: { members: [null] } })), <RoleMembers />);
    await settle();
    expect(host.textContent).toContain("result is unknown");
    expect(host.textContent).not.toContain("No members");
  });

  it("Workspace 管理员即使不是频道成员，也能从独立管理列表选中 Workspace", async () => {
    const t = transport((r) =>
      r.path.startsWith("/api/v1/role-workspaces")
        ? { status: 200, body: { workspaces: [{ id: "w-admin", name: "Managed only", state: "ACTIVE" }] } }
        : { status: 200, body: { members: [{
          ...members[1],
          canGrantTenantAdmin: false,
          canGrantWorkspaceAdmin: true,
        }] } },
    );
    const host = await mount(t, <RoleManagement />);
    await settle();
    expect(host.textContent).toContain("Managed only");
    expect(t.send).toHaveBeenCalledWith({
      method: "GET", path: "/api/v1/role-members?workspaceId=w-admin",
    });
    expect(button(host, "Grant").disabled).toBe(false);
    // 没有给出动作键就不渲染暂停/恢复入口
    expect(host.querySelector("[data-testid=workspace-lifecycle]")).toBeNull();
  });
});

describe("Workspace 暂停与恢复", () => {
  const recorded = (actionKey: string) => ({
    status: 202,
    body: { operationId: "op-9", actionExecutionId: "ae-9", actionKey, gateState: "ALLOWED", dispatchState: "DISPATCHED" },
  });
  const roleRoutes = (workspace: Record<string, unknown>, action: (r: BffRequest) => BffReply) =>
    transport((r) =>
      r.path.startsWith("/api/v1/role-workspaces")
        ? { status: 200, body: { workspaces: [workspace] } }
        : r.path === "/api/v1/actions"
          ? action(r)
          : r.path.startsWith("/api/v1/role-members")
            ? { status: 200, body: { members: [] } }
            : { status: 200, body: [] },
    );

  it("只在给出暂停键时提供入口；受理回应只说已登记，不说成功", async () => {
    const t = roleRoutes(
      { id: "w-1", name: "Ops", state: "ACTIVE", lifecycleActionKey: "workspace.suspend" },
      () => recorded("workspace.suspend"),
    );
    const host = await mount(t, <RoleManagement />);
    await settle();
    expect(host.querySelector("[data-testid=workspace-state]")?.textContent).toContain("Active");
    await click(button(host, "Suspend"));
    expect(host.textContent).toContain("Suspend workspace Ops?");
    await click(button(host, "Confirm"));
    const post = t.send.mock.calls.map(([r]) => r).find((r) => r.path === "/api/v1/actions");
    expect(post?.body).toMatchObject({ actionKey: "workspace.suspend", workspaceId: "w-1" });
    expect(Object.keys(post?.body ?? {}).sort()).toEqual(["actionKey", "idempotencyKey", "workspaceId"]);
    const status = host.querySelector("[data-testid=workspace-lifecycle] [role=status]")?.textContent ?? "";
    expect(status).toContain("Request recorded");
    expect(status).toContain("op-9");
    expect(status).not.toMatch(/succe/i);
  });

  it("结果不明时保留原幂等键重查，不另发一笔也不能取消", async () => {
    let calls = 0;
    const t = roleRoutes(
      { id: "w-1", name: "Ops", state: "ACTIVE", lifecycleActionKey: "workspace.suspend" },
      () => {
        calls++;
        return calls === 1
          ? { status: 503, body: { class: ErrorClass.Unknown, reason: ReasonCode.DependencyUnavailable, operationId: "op-u" } }
          : recorded("workspace.suspend");
      },
    );
    const host = await mount(t, <RoleManagement />);
    await settle();
    await click(button(host, "Suspend"));
    await click(button(host, "Confirm"));
    expect(host.querySelector("[data-testid=workspace-lifecycle] [role=alert]")?.textContent).toContain("op-u");
    expect([...host.querySelectorAll("[data-testid=workspace-lifecycle] button")].map((b) => b.textContent))
      .not.toContain("Cancel");
    await click(button(host, "Retry same request"));
    const posts = t.send.mock.calls.map(([r]) => r).filter((r) => r.path === "/api/v1/actions");
    expect(posts).toHaveLength(2);
    expect((posts[1]?.body as { idempotencyKey: string }).idempotencyKey)
      .toBe((posts[0]?.body as { idempotencyKey: string }).idempotencyKey);
    expect(host.textContent).toContain("Request recorded");
  });

  it("已暂停的 Workspace 显示状态与恢复入口，角色视图退回 Tenant 级", async () => {
    const t = roleRoutes(
      { id: "w-2", name: "Paused", state: "SUSPENDED", lifecycleActionKey: "workspace.restore" },
      () => recorded("workspace.restore"),
    );
    const host = await mount(t, <RoleManagement />, "zh-CN");
    await settle();
    expect(host.querySelector("[data-testid=workspace-state]")?.textContent).toContain("已暂停");
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/role-members" });
    expect(t.send).not.toHaveBeenCalledWith({ method: "GET", path: "/api/v1/role-members?workspaceId=w-2" });
    await click(button(host, "恢复"));
    expect(host.textContent).toContain("恢复工作区 Paused？");
  });

  it("派发中止显示原因并放下意图；未派发按结果不明保留原幂等键", async () => {
    const aborted = roleRoutes(
      { id: "w-1", name: "Ops", state: "ACTIVE", lifecycleActionKey: "workspace.suspend" },
      () => ({ status: 202, body: { operationId: "op-a", actionExecutionId: "ae-a", actionKey: "workspace.suspend",
        gateState: "ALLOWED", dispatchState: "ABORTED" } }),
    );
    const host = await mount(aborted, <RoleManagement />);
    await settle();
    await click(button(host, "Suspend"));
    await click(button(host, "Confirm"));
    const alert = host.querySelector("[data-testid=workspace-lifecycle] [role=alert]")?.textContent ?? "";
    expect(alert).toContain("not carried out");
    expect(alert).toContain("ABORTED");
    expect(alert).toContain("op-a");
    expect(host.textContent).not.toContain("Retry same request");

    let calls = 0;
    const pending = roleRoutes(
      { id: "w-1", name: "Ops", state: "ACTIVE", lifecycleActionKey: "workspace.suspend" },
      () => {
        calls++;
        return calls === 1
          ? { status: 202, body: { operationId: "op-p", actionExecutionId: "ae-p", actionKey: "workspace.suspend",
            gateState: "ALLOWED", dispatchState: "UNKNOWN" } }
          : recorded("workspace.suspend");
      },
    );
    const again = await mount(pending, <RoleManagement />);
    await settle();
    await click(button(again, "Suspend"));
    await click(button(again, "Confirm"));
    expect(again.querySelector("[data-testid=workspace-lifecycle] [role=alert]")?.textContent).toContain("op-p");
    expect(again.textContent).not.toContain("Request recorded");
    await click(button(again, "Retry same request"));
    const posts = pending.send.mock.calls.map(([r]) => r).filter((r) => r.path === "/api/v1/actions");
    expect((posts[1]?.body as { idempotencyKey: string }).idempotencyKey)
      .toBe((posts[0]?.body as { idempotencyKey: string }).idempotencyKey);
    expect(again.textContent).toContain("Request recorded");
  });

  it("选中非 ACTIVE Workspace 时显式标注当前作用域为整个组织", async () => {
    const t = roleRoutes({ id: "w-4", name: "Broken", state: "ERROR", lifecycleActionKey: "workspace.suspend" },
      () => recorded("workspace.suspend"));
    const host = await mount(t, <RoleManagement />);
    await settle();
    expect(host.querySelector("[data-testid=role-scope-tenant]")?.textContent).toContain("whole organization");
    expect(button(host, "Suspend").disabled).toBe(false);
  });

  it("状态不合契约时显示读取失败", async () => {
    const t = roleRoutes({ id: "w-3", name: "Odd", state: "DELETED" }, () => recorded("workspace.suspend"));
    const host = await mount(t, <RoleManagement />);
    await settle();
    expect(host.textContent).toContain("result is unknown");
  });
});

const ownEntry = () => ({
  actionKey: "identity.client-key.register",
  decision: "ALLOW",
  eventType: "DECISION",
  occurredAt: new Date().toISOString(),
  resultCode: "ACCEPTED",
});

const forbidden = { status: 403, body: { class: ErrorClass.Denied, reason: ReasonCode.PermissionDenied } };

describe("AuditPage", () => {
  it.each(["en", "zh-CN"] as const)("labels restored collaboration actions without changing their wire keys in %s", async (locale) => {
    const labels = [
      ["pulse.publish", "Publish note", "发布动态"],
      ["identity.profile.publish", "Update profile", "更新个人资料"],
      ["conversation.hide", "Close direct conversation", "关闭私聊"],
      ["conversation.reopen", "Reopen direct conversation", "重新打开私聊"],
      ["scope.transition", "Scope state transition", "作用域状态变更"],
      ["membership.transition", "Membership state transition", "成员关系状态变更"],
    ];
    const entries = labels.map(([actionKey]) => ({ ...ownEntry(), actionKey }));
    const host = await mount(transport((r) => r.path === "/api/v1/audit"
      ? { status: 200, body: entries } : forbidden), <AuditPage />, locale);
    await settle();
    for (const [actionKey, en, zh] of labels) {
      const action = host.querySelector(`[title="${actionKey}"]`);
      expect(action?.querySelector("span")?.textContent).toBe(locale === "en" ? en : zh);
      expect(action?.querySelector("code")?.textContent).toBe(actionKey);
    }
  });
  it.each(["en", "zh-CN"] as const)("translates real gate and cancellation result codes without implying completion in %s", async (locale) => {
    const entries = ["ALLOWED", "EVALUATING", "CANCEL_REQUEST_ACCEPTED"].map((resultCode) =>
      ({ ...ownEntry(), actionKey: "workspace.create", resultCode }));
    entries.push({ ...ownEntry(), actionKey: "constructor", resultCode: "FUTURE_RESULT" });
    const host = await mount(transport((r) => r.path === "/api/v1/audit"
      ? { status: 200, body: entries } : forbidden), <AuditPage />, locale);
    await settle();
    expect(host.textContent).toContain(locale === "en" ? "Create channel" : "创建频道");
    expect(host.querySelector("code")?.textContent).toBe("workspace.create");
    expect(host.querySelector('[title="ALLOWED"]')?.textContent).toBe(locale === "en"
      ? "Admission allowed; execution not confirmed" : "已获准，尚未确认执行");
    expect(host.querySelector('[title="EVALUATING"]')?.textContent).toBe(locale === "en" ? "Being evaluated" : "正在判定");
    expect(host.querySelector('[title="CANCEL_REQUEST_ACCEPTED"]')?.textContent).toBe(locale === "en"
      ? "Cancellation request accepted; awaiting task outcome" : "取消请求已接收，等待任务终态");
    expect(host.textContent).toContain(locale === "en" ? "Unrecognized action" : "未识别的动作");
    expect(host.textContent).toContain("FUTURE_RESULT");
  });
  it.each(["en", "zh-CN"] as const)("translates observed audit results without upgrading intermediate evidence in %s", async (locale) => {
    const labels = [
      ["COMPLETED", "Completed", "已完成"],
      ["FAILED", "Failed", "失败"],
      ["CANCELED", "Canceled", "已取消"],
      ["COMMITTED", "Usage storage confirmed; bill settlement not confirmed", "用量已确认入库，尚未确认账单结算"],
      ["PENDING_PUBLISH", "Usage awaiting publication", "用量等待发布"],
      ["NATIVE_TURN_BOUND", "Native turn linked; completion not confirmed", "原生回合已关联，尚未确认完成"],
      ["DISPATCH_INTENT", "Dispatch intent recorded; dispatch not confirmed", "派发意图已记录，尚未确认派发"],
      ["DELEGATION_GRANTED", "Delegation granted", "委派已授权"],
      ["DELEGATION_REVOKED", "Delegation revoked", "委派已撤销"],
      ["INVITATION_REDEEMED", "Invitation redeemed", "邀请已兑换"],
      ["CANCELED_BEFORE_MODEL_DISPATCH", "Canceled before model dispatch", "已在模型派发前取消"],
      ["CANCELED_BEFORE_MESSAGE_DISPATCH", "Canceled before message dispatch", "已在消息派发前取消"],
      ["CANCEL_REQUEST_PENDING", "Cancellation pending; task outcome not confirmed", "取消请求待确认，尚未确认任务终态"],
      ["AUTOMATION_ENABLED", "Workflow enabled", "工作流已启用"],
      ["AUTOMATION_DISABLED", "Workflow disabled", "工作流已停用"],
      ["AUTOMATION_PAUSED", "Workflow paused", "工作流已暂停"],
      ["AUTOMATION_DELETED", "Workflow deleted", "工作流已删除"],
      ["ACTIVE", "Active", "已激活"],
    ];
    const entries = labels.map(([resultCode]) => ({ ...ownEntry(), decision: "NONE", resultCode }));
    const host = await mount(transport((r) => r.path === "/api/v1/audit"
      ? { status: 200, body: entries } : forbidden), <AuditPage />, locale);
    await settle();
    for (const [resultCode, en, zh] of labels) {
      expect(host.querySelector(`[title="${resultCode}"]`)?.textContent).toBe(locale === "en" ? en : zh);
    }
    for (const decision of host.querySelectorAll("[data-testid=audit-decision] span")) {
      expect(decision.className).toContain("text-muted-foreground");
    }
  });
  it("keeps non-decisions and unknown wire values neutral instead of reporting rejection", async () => {
    const entries = [
      { ...ownEntry(), decision: "NONE", resultCode: "UNKNOWN" },
      { ...ownEntry(), decision: "FUTURE_DECISION", resultCode: "constructor" },
    ];
    const host = await mount(transport((r) => r.path === "/api/v1/audit"
      ? { status: 200, body: entries } : forbidden), <AuditPage />, "zh-CN");
    await settle();
    expect(host.textContent).toContain("无准入决定");
    expect(host.textContent).toContain("结果不明");
    expect(host.textContent).toContain("未识别的决定：FUTURE_DECISION");
    expect(host.textContent).toContain("结果代码：constructor");
    for (const decision of host.querySelectorAll("[data-testid=audit-decision] span")) {
      expect(decision.className).toContain("text-muted-foreground");
      expect(decision.className).not.toContain("bg-destructive");
      expect(decision.className).not.toContain("bg-secondary");
    }
  });

  it.each(["en", "zh-CN"] as const)("localizes admission and dispatch without claiming completion in %s", async (locale) => {
    const host = await mount(transport((r) => r.path === "/api/v1/audit"
      ? { status: 200, body: [{ ...ownEntry(), resultCode: "DISPATCHED" },
        { ...ownEntry(), decision: "DENY", resultCode: ReasonCode.PermissionDenied }] }
      : forbidden), <AuditPage />, locale);
    await settle();
    expect(host.textContent).toContain(locale === "en" ? "Admission allowed" : "准入允许");
    expect(host.textContent).toContain(locale === "en" ? "Admission denied" : "准入拒绝");
    expect(host.textContent).toContain(locale === "en" ? "Dispatched; completion not confirmed" : "已派发，尚未确认完成");
    expect(host.querySelector('[title="ALLOW"]')).not.toBeNull();
    expect(host.querySelector('[title="DISPATCHED"]')).not.toBeNull();
    expect(host.querySelector('[title="PERMISSION_DENIED"]')?.textContent).not.toBe("PERMISSION_DENIED");
  });

  it("列出本人的动作", async () => {
    const t = transport((r) => (r.path === "/api/v1/audit" ? { status: 200, body: [ownEntry()] } : forbidden));
    const host = await mount(t, <AuditPage />);
    await settle();
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/audit" });
    expect(host.textContent).toContain("identity.client-key.register");
    expect(host.textContent).toContain("Decision");
    expect(host.textContent).not.toContain("DECISION");
  });

  it("中文界面从同一目录翻译审计事件类型", async () => {
    const host = await mount(
      transport((r) => (r.path === "/api/v1/audit" ? { status: 200, body: [ownEntry()] } : forbidden)),
      <AuditPage />,
      "zh-CN",
    );
    await settle();
    expect(host.textContent).toContain("决策");
    expect(host.textContent).not.toContain("DECISION");
  });
});

describe("AuditPage 范围审计", () => {
  const event = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    occurredAt: new Date().toISOString(),
    eventType: "DECISION",
    actionKey: "tenant.admin.grant",
    decision: "ALLOW",
    resultCode: "ACCEPTED",
    evidence: [],
    ...extra,
  });
  const workspaces = [{ id: "w-1", name: "Alpha" }];

  it("Tenant 无权且没有可进入的 Workspace 时整节不渲染，本人记录照常", async () => {
    const t = transport((r) => (r.path === "/api/v1/audit" ? { status: 200, body: [ownEntry()] } : r.path === "/api/v1/workspaces" ? { status: 200, body: [] } : forbidden));
    const host = await mount(t, <AuditPage />);
    await settle();
    expect(host.querySelector("[data-testid=scoped-audit]")).toBeNull();
    expect(host.textContent).toContain("identity.client-key.register");
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/audit/events" });
  });

  it("Workspace auditor：Tenant 403 时仍可选 Workspace；该 Workspace 403 显示无权；解引用 403 不显示 ref", async () => {
    const t = transport((r) => {
      if (r.path === "/api/v1/audit") return { status: 200, body: [] };
      if (r.path === "/api/v1/workspaces")
        return { status: 200, body: [...workspaces, { id: "w-2", name: "Beta" }] };
      if (r.path === "/api/v1/audit/events?workspaceId=w-2")
        return {
          status: 200,
          body: { events: [event("e-9", { workspaceId: "w-2", evidence: [{ index: 0, kind: "BUZZ_EVENT_ID", authority: "BUZZ", sensitivity: "SUMMARY" }] })] },
        };
      if (r.path === "/api/v1/audit/events/e-9/evidence/0")
        return { status: 403, body: { class: ErrorClass.Denied, reason: ReasonCode.PermissionDenied, stableId: "leak-me" } };
      return forbidden;
    });
    const host = await mount(t, <AuditPage />);
    await settle();
    const section = host.querySelector("[data-testid=scoped-audit]") as HTMLElement;
    expect(section.textContent).toContain("You do not have audit permission for the whole organization");
    const select = section.querySelector("select") as HTMLSelectElement;
    expect((select.querySelector("option[value='']") as HTMLOptionElement).disabled).toBe(true);
    // Tenant 已知无权，不再重复读取
    expect(t.send.mock.calls.filter(([r]) => r.path.startsWith("/api/v1/audit/events"))).toHaveLength(1);
    const choose = async (value: string) => {
      await act(async () => {
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await settle();
    };
    await choose("w-1");
    expect(section.textContent).toContain("You do not have audit permission for this scope.");
    expect((select.querySelector("option[value='']") as HTMLOptionElement).disabled).toBe(true);
    await choose("w-2");
    expect(section.textContent).toContain("tenant.admin.grant");
    await click(button(section, "Buzz event"));
    expect(section.textContent).toContain("You do not have audit permission for this scope.");
    expect(section.textContent).not.toContain("leak-me");
    expect(section.querySelector("[data-testid=evidence-available]")).toBeNull();
  });

  it("判定不明（503）不显示成没有事件，可重试", async () => {
    let fail = true;
    const t = transport((r) => {
      if (r.path === "/api/v1/audit") return { status: 200, body: [] };
      if (r.path === "/api/v1/workspaces") return { status: 200, body: workspaces };
      if (fail) return { status: 503, body: { class: ErrorClass.Unknown, reason: ReasonCode.DependencyUnavailable } };
      return { status: 200, body: { events: [event("e-1")] } };
    });
    const host = await mount(t, <AuditPage />);
    await settle();
    const section = host.querySelector("[data-testid=scoped-audit]") as HTMLElement;
    expect(section.textContent).toContain("the result is unknown");
    expect(section.textContent).not.toContain("No events recorded in this scope");
    fail = false;
    await click(button(section, "Try again"));
    expect(section.textContent).toContain("tenant.admin.grant");
  });

  it("证据按种类列出；受限在列表上标注；不可用只显示原因不显示 ref", async () => {
    const t = transport((r) => {
      if (r.path === "/api/v1/audit") return { status: 200, body: [] };
      if (r.path === "/api/v1/workspaces") return { status: 200, body: workspaces };
      if (r.path === "/api/v1/audit/events")
        return {
          status: 200,
          body: {
            events: [event("e-1", {
              workspaceId: "w-1",
              evidence: [
                { index: 0, kind: "TEMPORAL_WORKFLOW_ID", authority: "TEMPORAL", sensitivity: "SUMMARY" },
                { index: 1, kind: "BUZZ_EVENT_ID", authority: "BUZZ", sensitivity: "RESTRICTED" },
                { index: 2 },
              ],
            })],
          },
        };
      if (r.path === "/api/v1/audit/events/e-1/evidence/0")
        return { status: 200, body: { available: true, kind: "TEMPORAL_WORKFLOW_ID", authority: "TEMPORAL", sensitivity: "SUMMARY", stableId: "wf-123", version: 4 } };
      if (r.path === "/api/v1/audit/events/e-1/evidence/1")
        // 即使回应违约带了 ref，不可用时也不能显示
        return { status: 200, body: { available: false, unavailableReason: "RESTRICTED", stableId: "leak-me" } };
      if (r.path === "/api/v1/audit/events/e-1/evidence/2")
        return { status: 200, body: { available: false, unavailableReason: "UNRECOGNIZED" } };
      return forbidden;
    });
    const host = await mount(t, <AuditPage />);
    await settle();
    const section = host.querySelector("[data-testid=scoped-audit]") as HTMLElement;
    expect(section.textContent).toContain("Alpha");
    expect(section.textContent).toContain("Restricted");
    expect(section.textContent).not.toContain("wf-123");
    await click(button(section, "Workflow"));
    expect(section.textContent).toContain("wf-123");
    expect(section.textContent).toContain("version 4");
    expect(section.textContent).toContain("Workflow engine");
    await click(button(section, "Buzz event"));
    expect(section.textContent).toContain("Unavailable: restricted evidence you are not authorized to view");
    await click(button(section, "Unrecognized evidence"));
    expect(section.textContent).toContain("Unavailable: the evidence kind is not recognized");
    expect(section.textContent).not.toContain("leak-me");
  });

  it("原证据不存在（404）只显示不可用、不给重试；503 才显示载入失败并可重试", async () => {
    let evidence503 = true;
    const t = transport((r) => {
      if (r.path === "/api/v1/audit") return { status: 200, body: [] };
      if (r.path === "/api/v1/workspaces") return { status: 200, body: workspaces };
      if (r.path === "/api/v1/audit/events")
        return {
          status: 200,
          body: {
            events: [event("e-1", {
              evidence: [
                { index: 0, kind: "TEMPORAL_WORKFLOW_ID", authority: "TEMPORAL", sensitivity: "SUMMARY" },
                { index: 1, kind: "TEMPORAL_RUN_ID", authority: "TEMPORAL", sensitivity: "SUMMARY" },
                { index: 2, kind: "SPICEDB_ZEDTOKEN", authority: "SPICEDB", sensitivity: "SUMMARY" },
              ],
            })],
          },
        };
      if (r.path === "/api/v1/audit/events/e-1/evidence/0")
        // 即使 404 正文违约带了 ref，也不能显示
        return { status: 404, body: { available: false, unavailableReason: "NOT_FOUND", stableId: "leak-me" } };
      if (r.path === "/api/v1/audit/events/e-1/evidence/1")
        return evidence503
          ? { status: 503, body: { class: ErrorClass.Unknown, reason: ReasonCode.DependencyUnavailable } }
          : { status: 200, body: { available: true, kind: "TEMPORAL_RUN_ID", authority: "TEMPORAL", sensitivity: "SUMMARY", stableId: "run-7" } };
      if (r.path === "/api/v1/audit/events/e-1/evidence/2")
        return { status: 200, body: { available: false, unavailableReason: "UNVERIFIABLE" } };
      return forbidden;
    });
    const host = await mount(t, <AuditPage />);
    await settle();
    const section = host.querySelector("[data-testid=scoped-audit]") as HTMLElement;

    await click(button(section, "Workflow"));
    const notFound = section.querySelector("[data-testid=evidence-unavailable]") as HTMLElement;
    expect(notFound.textContent).toBe("Unavailable: the original record no longer exists.");
    expect(section.textContent).not.toContain("Couldn't load this");
    expect(section.textContent).not.toContain("Try again");
    expect(section.textContent).not.toContain("leak-me");

    await click(button(section, "Workflow run"));
    expect(section.textContent).toContain("Couldn't load this — the result is unknown.");
    expect(section.querySelector("[data-testid=evidence-available]")).toBeNull();
    evidence503 = false;
    await click(button(section, "Try again"));
    expect(section.textContent).toContain("run-7");
    expect(section.textContent).not.toContain("Couldn't load this");

    await click(button(section, "Permission snapshot"));
    expect(section.textContent).toContain("Unavailable: its source cannot confirm that it still exists");
  });

  it("404 在中文界面同样显示不可用", async () => {
    const t = transport((r) => {
      if (r.path === "/api/v1/audit") return { status: 200, body: [] };
      if (r.path === "/api/v1/workspaces") return { status: 200, body: workspaces };
      if (r.path === "/api/v1/audit/events")
        return {
          status: 200,
          body: { events: [event("e-1", { evidence: [{ index: 0, kind: "TEMPORAL_WORKFLOW_ID", authority: "TEMPORAL", sensitivity: "SUMMARY" }] })] },
        };
      if (r.path === "/api/v1/audit/events/e-1/evidence/0") return { status: 404, body: null };
      return forbidden;
    });
    const host = await mount(t, <AuditPage />, "zh-CN");
    await settle();
    const section = host.querySelector("[data-testid=scoped-audit]") as HTMLElement;
    await click(button(section, "流程"));
    expect(section.textContent).toContain("不可用：原记录已不存在。");
    expect(section.textContent).not.toContain("重试");
  });

  it("按 nextCursor 加载更多；选择 Workspace 按该范围读取", async () => {
    const t = transport((r) => {
      if (r.path === "/api/v1/audit") return { status: 200, body: [] };
      if (r.path === "/api/v1/workspaces") return { status: 200, body: workspaces };
      if (r.path === "/api/v1/audit/events") return { status: 200, body: { events: [event("e-1")], nextCursor: "e-1" } };
      if (r.path === "/api/v1/audit/events?cursor=e-1")
        return { status: 200, body: { events: [event("e-2", { actionKey: "tenant.admin.revoke" })] } };
      if (r.path === "/api/v1/audit/events?workspaceId=w-1")
        return { status: 200, body: { events: [event("e-3", { actionKey: "workspace.admin.grant", workspaceId: "w-1" })] } };
      return forbidden;
    });
    const host = await mount(t, <AuditPage />, "zh-CN");
    await settle();
    const section = host.querySelector("[data-testid=scoped-audit]") as HTMLElement;
    await click(button(section, "加载更多"));
    expect(section.textContent).toContain("tenant.admin.grant");
    expect(section.textContent).toContain("tenant.admin.revoke");
    expect(section.querySelectorAll("button").length).toBe(0);
    const select = section.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      select.value = "w-1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(section.textContent).toContain("workspace.admin.grant");
    expect(section.textContent).not.toContain("tenant.admin.revoke");
  });
});

// SS-WEB-PRESENTATION：平台页只经宿主主题渲染——Web 与 Desktop 的 ThemeProvider 在根元素上切换
// light/dark，颜色来自根 CSS variables，经各自 tailwind.config.js 的语义色映射到类名。平台页因此
// 不得自带主题、颜色字面量或暗色变体，用到的每个语义色都必须在两个宿主里映射到同名变量。
describe("platform pages render only through the host theme", () => {
  const root = resolve(import.meta.dirname, "..");
  const sources = readdirSync(join(root, "src/react"))
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => ({ name, text: readFileSync(join(root, "src/react", name), "utf8") }));
  const hosts = ["../../../web-client/web", "../../../collaboration/desktop"].map((dir) => {
    // Both real hosts consume the one shared Tailwind config, not local copies.
    const source = readFileSync(join(root, dir, "tailwind.config.js"), "utf8");
    if (source.trim() !== 'export { default } from "@client-kit/platform/tailwind.config";') {
      throw new Error(`Host does not consume the shared Tailwind config: ${dir}`);
    }
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (manifest.exports?.["./tailwind.config"] !== "./src/tailwind.config.js") {
      throw new Error("The shared Tailwind config export is missing");
    }
    return readFileSync(join(root, "src/tailwind.config.js"), "utf8");
  });
  const semanticColors = [
    "accent", "accent-foreground", "background", "border", "card", "destructive", "destructive-foreground",
    "foreground", "input", "muted", "muted-foreground", "primary", "primary-foreground", "ring", "secondary", "secondary-foreground", "popover-foreground",
    "sidebar-foreground", "sidebar-border",
    "sidebar-ring", "sidebar-accent", "sidebar-accent-foreground", "sidebar-active", "sidebar-active-foreground",
    "warning", "warning-bg",
  ];
  const neutral = new Set(["transparent", "current", "inherit"]);
  const notColor =
    /^(xs|sm|base|lg|xl|[2-9]xl|left|center|right|justify|start|end|[tblrxyse]|\d+|none|solid|dashed|dotted|double|collapse|separate|wrap|nowrap|balance|pretty|ellipsis|clip)$/;
  const colorUtility =
    /(?:^|[\s"'`:])(bg|text|border|ring|outline|fill|stroke|divide|placeholder|from|via|to|accent|caret|decoration|shadow)-([a-z][a-z0-9-]*)(?:\/\d+)?/g;

  it("uses no own theme or unverified colour expression", async () => {
    expect(sources.length).toBeGreaterThan(0);
    // DD-36/53: Buzz's native token colour is selected
    // by the host. Pin779af8886caae1317b4de962082429867ab61503,
    // desktop/src/shared/ui/markdown/CodeBlock.tsx::SyntaxHighlightedCode.
    const ts = await import("typescript");
    const native = sources.find(({ name }) => name === "message-body.tsx");
    if (!native) throw new Error("Shared native message renderer is missing");
    const parsed = ts.createSourceFile(native.name, native.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const highlight = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "SyntaxHighlightedCode");
    if (!highlight || !ts.isFunctionDeclaration(highlight)) throw new Error("Native highlighter symbol is missing");
    expect(highlight.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)).toBe(true);
    const styles: import("typescript").JsxAttribute[] = [];
    const visit = (node: import("typescript").Node) => {
      if (ts.isJsxAttribute(node) && node.name.getText(parsed) === "style") styles.push(node);
      ts.forEachChild(node, visit);
    };
    visit(highlight);
    const nativeColour = "style={token.color ? { color: token.color } : undefined}";
    expect(styles.map((node) => node.getText(parsed))).toEqual([nativeColour]);
    expect(highlight.getText(parsed)).toContain("shikiHighlighter.codeToTokens(code,");
    expect(highlight.getText(parsed)).toContain("theme: shikiTheme as BundledTheme");
    expect(highlight.getText(parsed)).toContain("tokenCache.set(cacheKey, result.tokens)");
    expect(highlight.getText(parsed)).toContain("renderedTokens.map((token, tokenIdx)");
    const desktop = readFileSync(join(root, "../../../collaboration/desktop/src/shared/ui/markdown/CodeBlock.tsx"), "utf8");
    const web = readFileSync(join(root, "../../../web-client/web/src/features/chat/ui/MessageContent.tsx"), "utf8");
    const loader = readFileSync(join(root, "src/theme/theme-loader.ts"), "utf8");
    for (const host of [desktop, web]) {
      expect(host).toContain('from "@client-kit/platform/react/message-body"');
      expect(host).toContain('from "@/shared/theme/ThemeProvider"');
      expect(host).toContain('from "@client-kit/platform/theme/theme-loader"');
    }
    expect(desktop).toContain("SyntaxHighlightedCode as SharedSyntaxHighlightedCode");
    expect(desktop).toContain("const { themeName } = useTheme()");
    expect(desktop).toContain("shikiTheme={resolveShikiThemeName(themeName)}");
    expect(web).toContain("const { themeName } = useTheme()");
    expect(web).toContain("<SyntaxHighlightedCode");
    expect(web).toContain("shikiTheme={resolveShikiThemeName(themeName)}");
    expect(loader).toContain("if (name === BUZZ_THEME_NAME) return BUZZ_BASE_THEME");
    expect(loader).toContain("if (name === BUZZ_DARK_THEME_NAME) return BUZZ_DARK_BASE_THEME");
    const nativeStyle = styles[0]!;
    // Same fixed CodeBlock.tsx::MarkdownCodeBlock, L104. Pin only this original
    // corner geometry; the whole renderer remains in the colour/style scan.
    const block = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "MessageCodeBlock");
    if (!block) throw new Error("Native code block symbol is missing");
    const blockStyles: import("typescript").JsxAttribute[] = [];
    const visitBlock = (node: import("typescript").Node) => {
      if (ts.isJsxAttribute(node) && node.name.getText(parsed) === "style") blockStyles.push(node);
      ts.forEachChild(node, visitBlock);
    };
    visitBlock(block);
    expect(blockStyles.map((node) => node.getText(parsed))).toEqual(['style={{ borderRadius: "1rem" }}']);
    let inspectedNative = native.text;
    for (const node of [nativeStyle, ...blockStyles].sort((a, b) => b.getStart(parsed) - a.getStart(parsed))) {
      inspectedNative = inspectedNative.slice(0, node.getStart(parsed)) + inspectedNative.slice(node.end);
    }
    let tokenLoop: import("typescript").Node = nativeStyle;
    while (tokenLoop.parent && !ts.isArrowFunction(tokenLoop)) tokenLoop = tokenLoop.parent;
    if (!ts.isArrowFunction(tokenLoop)) throw new Error("Native token style has no token source");
    expect(tokenLoop.parameters.map((parameter) => parameter.name.getText(parsed))).toEqual(["token", "tokenIdx"]);
    expect(tokenLoop.parent.getText(parsed)).toContain("renderedTokens.map(");
    // InboxListPane at the same fixed Buzz pin, L331–333: this exact row
    // highlight mixes only two host variables. Do not exempt arbitrary CSS.
    const inbox = sources.find(({ name }) => name === "inbox-row.tsx");
    if (!inbox) throw new Error("Shared native Inbox row is missing");
    const inboxParsed = ts.createSourceFile(inbox.name, inbox.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const row = inboxParsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "InboxRow");
    if (!row || !ts.isFunctionDeclaration(row) || !row.body) throw new Error("Native Inbox row symbol is missing");
    const declaration = row.body.statements.find((node) => ts.isVariableStatement(node)
      && node.declarationList.declarations.some((item) => item.name.getText(inboxParsed) === "highlight"));
    if (!declaration || !ts.isVariableStatement(declaration)) throw new Error("Native Inbox highlight is missing");
    expect(declaration.declarationList.declarations).toHaveLength(1);
    const value = declaration.declarationList.declarations[0]?.initializer;
    if (!value || !ts.isConditionalExpression(value)) throw new Error("Native Inbox highlight is not conditional");
    expect(value.condition.getText(inboxParsed)).toBe("selected");
    expect(ts.isStringLiteral(value.whenTrue) && value.whenTrue.text).toBe("color-mix(in srgb, hsl(var(--background)) 70%, hsl(var(--muted)) 30%)");
    expect(ts.isStringLiteral(value.whenFalse) && value.whenFalse.text).toBe("color-mix(in srgb, hsl(var(--background)) 75%, hsl(var(--muted)) 25%)");
    const inboxStyles: import("typescript").JsxAttribute[] = [];
    const visitInbox = (node: import("typescript").Node) => {
      if (ts.isJsxAttribute(node) && node.name.getText(inboxParsed) === "style") inboxStyles.push(node);
      ts.forEachChild(node, visitInbox);
    };
    visitInbox(row);
    expect(inboxStyles.map((node) => node.getText(inboxParsed))).toEqual(['style={{ "--inbox-row-highlight-bg": highlight } as CSSProperties}']);
    const inboxStyle = inboxStyles[0]!;
    const inboxRanges = [declaration, inboxStyle].sort((a, b) => b.getStart(inboxParsed) - a.getStart(inboxParsed));
    let inspectedInbox = inbox.text;
    for (const node of inboxRanges) inspectedInbox = inspectedInbox.slice(0, node.getStart(inboxParsed)) + inspectedInbox.slice(node.end);
    expect(inspectedInbox.match(/bg-\[var\(--inbox-row-highlight-bg\)\]/g)).toHaveLength(4);
    inspectedInbox = inspectedInbox.replaceAll("bg-[var(--inbox-row-highlight-bg)]", "");
    // Same fixed InboxListPane.tsx::InboxLabel, L95: this exact
    // minimum-height is host-controlled geometry, not a colour expression.
    const previewHeight = "min-h-[var(--inline-chip-min-height)]";
    expect(inspectedInbox.split(previewHeight)).toHaveLength(2);
    inspectedInbox = inspectedInbox.replace(previewHeight, "");
    // The fixed Buzz SegmentedControl uses inline geometry, not inline colour.
    // Validate precisely those two original expressions; do not exempt the file.
    const segmented = sources.find(({ name }) => name === "segmented-control.tsx");
    if (!segmented) throw new Error("Shared native segmented control is missing");
    const segmentedParsed = ts.createSourceFile(segmented.name, segmented.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const segmentedStyles: import("typescript").JsxAttribute[] = [];
    const visitSegmented = (node: import("typescript").Node) => {
      if (ts.isJsxAttribute(node) && node.name.getText(segmentedParsed) === "style") segmentedStyles.push(node);
      ts.forEachChild(node, visitSegmented);
    };
    visitSegmented(segmentedParsed);
    expect(segmentedStyles.map((node) => node.getText(segmentedParsed).replace(/\s+/g, ""))).toEqual([
      'style={{transform:`translateX(${selectedIndex*100}%)`,width:`calc((100%-0.25rem)/${options.length})`,}}',
    ]);
    const segmentedStyle = segmentedStyles[0]!;
    const inspectedSegmented = segmented.text.slice(0, segmentedStyle.getStart(segmentedParsed)) + segmented.text.slice(segmentedStyle.end);
    // Fixed Buzz 779af8886caae1317b4de962082429867ab61503:
    // desktop/src/shared/ui/popoverSurface.ts::POPOVER_SURFACE_CLASS/POPOVER_SHADOW.
    // Verify the original host-variable mix and shadow, never exempt their module.
    const surface = sources.find(({ name }) => name === "popover-surface.ts")!;
    const surfaceParsed = ts.createSourceFile(surface.name, surface.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const constants = new Map<string, import("typescript").Expression>();
    for (const statement of surfaceParsed.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.initializer) constants.set(declaration.name.getText(surfaceParsed), declaration.initializer);
      }
    }
    const mix = constants.get("POPOVER_SURFACE_CLASS")!;
    const shadow = constants.get("POPOVER_SHADOW")!;
    expect(ts.isStringLiteral(mix) && mix.text).toBe("border border-border/60 bg-[color-mix(in_srgb,hsl(var(--background))_80%,hsl(var(--muted))_20%)] text-popover-foreground");
    expect(ts.isStringLiteral(shadow) && shadow.text).toBe("0 6px 18px lch(0% 0 0 / 0.02), 0 3px 9px lch(0% 0 0 / 0.04), 0 1px 1px lch(0% 0 0 / 0.04)");
    const shadowStyle = constants.get("POPOVER_SHADOW_STYLE")!;
    if (!ts.isObjectLiteralExpression(shadowStyle)) throw new Error("Native popover shadow is not an object");
    expect(shadowStyle.properties).toHaveLength(1);
    expect(shadowStyle.properties[0]!.getText(surfaceParsed)).toBe("boxShadow: POPOVER_SHADOW");
    let inspectedSurface = surface.text;
    for (const expression of [mix, shadow].sort((a, b) => b.getStart(surfaceParsed) - a.getStart(surfaceParsed))) {
      inspectedSurface = inspectedSurface.slice(0, expression.getStart(surfaceParsed)) + inspectedSurface.slice(expression.end);
    }
    const picker = sources.find(({ name }) => name === "mention-autocomplete.tsx")!;
    const pickerParsed = ts.createSourceFile(picker.name, picker.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const pickerStyles: import("typescript").JsxAttribute[] = [];
    const visitPicker = (node: import("typescript").Node) => {
      if (ts.isJsxAttribute(node) && node.name.getText(pickerParsed) === "style") pickerStyles.push(node);
      ts.forEachChild(node, visitPicker);
    };
    visitPicker(pickerParsed);
    expect(pickerStyles.map((node) => node.getText(pickerParsed))).toEqual(["style={POPOVER_SHADOW_STYLE}"]);
    expect(pickerParsed.statements.some((node) => ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "./popover-surface"
      && node.importClause?.namedBindings?.getText(pickerParsed).includes("POPOVER_SHADOW_STYLE"))).toBe(true);
    const pickerStyle = pickerStyles[0]!;
    const inspectedPicker = picker.text.slice(0, pickerStyle.getStart(pickerParsed)) + picker.text.slice(pickerStyle.end);
    // DD-53: reuse the fixed Buzz appearance picker, including its preview
    // gradients and explicit accent swatches. Validate each expression before
    // removing only those nodes from the general page-colour scan.
    const appearance = sources.find(({ name }) => name === "theme-settings-controls.tsx")!;
    const appearanceParsed = ts.createSourceFile(appearance.name, appearance.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const appearanceStyles: import("typescript").JsxAttribute[] = [];
    const appearanceColors: import("typescript").VariableDeclaration[] = [];
    const visitAppearance = (node: import("typescript").Node) => {
      if (ts.isJsxAttribute(node) && node.name.getText(appearanceParsed) === "style") appearanceStyles.push(node);
      if (ts.isVariableDeclaration(node) && ["swatchColor", "selectionColor"].includes(node.name.getText(appearanceParsed))) appearanceColors.push(node);
      ts.forEachChild(node, visitAppearance);
    };
    visitAppearance(appearanceParsed);
    expect(appearanceStyles.map((node) => node.getText(appearanceParsed).replace(/\s+/g, ""))).toEqual([
      'style={{background:"linear-gradient(tobottom,hsl(var(--background)),hsl(var(--background)/0))",}}',
      'style={{background:"linear-gradient(totop,hsl(var(--background)),hsl(var(--background)/0))",}}',
      'style={{backgroundColor:swatchColor}}',
      'style={{borderColor:selectionColor}}',
    ]);
    expect(appearanceColors.map((node) => node.getText(appearanceParsed).replace(/\s+/g, ""))).toEqual([
      'swatchColor=isNeutral?"hsl(var(--foreground))":color.value',
      'selectionColor=isNeutral?isDark?"#000000":"#FFFFFF":contrastColorForBackground(color.value)',
    ]);
    expect(appearance.text).toContain("ACCENT_COLORS.map((color)");
    expect(appearance.text).toContain('from "../theme/use-appearance"');
    let inspectedAppearance = appearance.text;
    for (const node of [...appearanceStyles, ...appearanceColors].sort((a, b) => b.getStart(appearanceParsed) - a.getStart(appearanceParsed))) {
      inspectedAppearance = inspectedAppearance.slice(0, node.getStart(appearanceParsed)) + inspectedAppearance.slice(node.end);
    }
    for (const { name, text } of sources) {
      // Remove just the verified JSX attribute, not its function or file.
      let inspected = name === native.name
        ? inspectedNative
        : name === inbox.name ? inspectedInbox
        : name === segmented.name ? inspectedSegmented
        : name === surface.name ? inspectedSurface
        : name === picker.name ? inspectedPicker
        : name === appearance.name ? inspectedAppearance : text;
      if (name === "thread-layout-settings.tsx") {
        // Same Buzz pin, AppearanceSettingsControls.tsx::ThreadLayoutDiagram:
        // these exact SVG fills use the host variables, including native fallbacks.
        for (const expression of [
          '"var(--buzz-gradient-dark-top, #4a4616)"',
          '"var(--buzz-gradient-light-top, #e6e6b6)"',
          '"var(--buzz-gradient-dark-bottom, #0a1423)"',
          '"var(--buzz-gradient-light-bottom, #c4d0da)"',
          '"hsl(var(--muted))"',
          '"hsl(var(--background))"',
          '"hsl(var(--foreground) / 0.24)"',
          '"hsl(var(--foreground) / 0.14)"',
        ]) {
          expect(inspected.split(expression)).toHaveLength(2);
          inspected = inspected.replace(expression, '""');
        }
      }
      if (name === "workflow-template-textarea.tsx") {
        // Buzz 779af8886caae1317b4de962082429867ab61503:
        // desktop/src/features/workflows/ui/WorkflowTemplateTextarea.tsx.
        // The original Popover width follows its anchor; this is not a colour.
        const nativeWidth = "w-[var(--radix-popover-trigger-width)]";
        expect(inspected.split(nativeWidth)).toHaveLength(2);
        inspected = inspected.replace(nativeWidth, "");
      }
      if (name === "workflow-duration-field.tsx") {
        // Native delay slider width is layout, not a colour or theme override.
        const progressWidth = 'style={{ width: `${progress}%` }}';
        expect(inspected.split(progressWidth)).toHaveLength(2);
        inspected = inspected.replace(progressWidth, "");
      }
      if (name === "profile-settings.tsx") {
        // Buzz 779af8886caae1317b4de962082429867ab61503,
        // desktop/src/features/settings/ui/ProfileSettingsCard.tsx::ProfileSettingsCard.
        // The avatar colour is user content; the transition lists properties,
        // not a literal colour or a second theme. Pin both exact expressions.
        const avatarStyle = /style=\{\{\s*backgroundColor: emojiAvatarPreview\.color,\s*\}\}/g;
        expect(inspected.match(avatarStyle)).toHaveLength(1);
        inspected = inspected.replace(avatarStyle, "");
        const transition = "transition-[color,transform]";
        expect(inspected.split(transition)).toHaveLength(2);
        inspected = inspected.replace(transition, "transition-colors");
      }
      if (name === "channel-type-settings.tsx") {
        // Fixed Buzz ChannelTypeSettings sizes the TTL menu to its trigger.
        // This exact native layout attribute does not create another theme.
        const nativeWidth = 'style={{ minWidth: "var(--radix-dropdown-menu-trigger-width)" }}';
        expect(inspected.split(nativeWidth)).toHaveLength(2);
        inspected = inspected.replace(nativeWidth, "");
      }
      if (name === "settings-slider.tsx") {
        // Buzz 779af8886caae1317b4de962082429867ab61503,
        // desktop/src/features/profile/ui/AnimatedAvatarControls.tsx::AvatarFramingSlider.
        // The original fill/tick/reset positions are geometry, not a new theme.
        const slider = ts.createSourceFile(name, inspected, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const positions: import("typescript").JsxAttribute[] = [];
        const visitSlider = (node: import("typescript").Node) => {
          if (ts.isJsxAttribute(node) && node.name.getText(slider) === "style") positions.push(node);
          ts.forEachChild(node, visitSlider);
        };
        visitSlider(slider);
        expect(positions.map((node) => node.getText(slider).replace(/\s+/g, ""))).toEqual([
          'style={{"--buzz-avatar-framing-slider-fill":`${fill}%`,}asReact.CSSProperties}',
          'style={{left:`${percentFromSliderValue(tick,min,max)}%`,}}',
          'style={resetTickStyle}',
        ]);
        expect(inspected).toContain('left: `${percentFromSliderValue(resetValue, min, max)}%`');
        for (const node of positions.sort((a, b) => b.getStart(slider) - a.getStart(slider))) {
          inspected = inspected.slice(0, node.getStart(slider)) + inspected.slice(node.end);
        }
      }
      if (name === "channel-permissions-settings.tsx") {
        // Buzz 779af8886caae1317b4de962082429867ab61503
        // desktop/src/features/channels/ui/ChannelPermissionsSettings.tsx
        // uses this same trigger-width layout, not a colour/theme override.
        const nativeWidth = /style=\{\{\s*minWidth: "var\(--radix-dropdown-menu-trigger-width\)",\s*\}\}/g;
        expect(inspected.match(nativeWidth)).toHaveLength(1);
        inspected = inspected.replace(nativeWidth, "");
      }
      if (name === "new-message.tsx" || name === "inbox-surface.tsx") {
        // Fixed Buzz NewMessageScreen and HomeView use the host's dark root,
        // not another provider. HomeView at the same pin, line 687, repeats
        // this exact shared header backdrop. Keep translucency and blur.
        const variants = inspected.match(/\bdark:[a-z0-9:/-]+/g);
        expect(variants).toEqual([
          "dark:bg-background/70", "dark:backdrop-blur-xl",
          "dark:supports-backdrop-filter:bg-background/55",
        ]);
        for (const variant of variants ?? []) inspected = inspected.replace(variant, "");
      }
      if (name === "inbox-surface.tsx") {
        // Original HomeView split layout: dimensions are not colour/theme
        // expressions. Verify the exact host-controlled width attributes.
        const layout = ts.createSourceFile(name, inspected, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const layoutStyles: import("typescript").JsxAttribute[] = [];
        const visitLayout = (node: import("typescript").Node) => {
          if (ts.isJsxAttribute(node) && node.name.getText(layout) === "style") layoutStyles.push(node);
          ts.forEachChild(node, visitLayout);
        };
        visitLayout(layout);
        expect(layoutStyles.map((node) => node.getText(layout).replace(/\s+/g, ""))).toEqual([
          'style={{"--home-inbox-list-width":`${listWidth}px`,"--home-auxiliary-width":`${auxiliaryWidth??0}px`}asReact.CSSProperties}',
          'style={{left:`${listWidth}px`}}',
        ]);
        for (const node of layoutStyles.sort((a, b) => b.getStart(layout) - a.getStart(layout))) {
          inspected = inspected.slice(0, node.getStart(layout)) + inspected.slice(node.end);
        }
        for (const grid of [
          "grid-cols-[var(--home-inbox-list-width)_minmax(0,1fr)_var(--home-auxiliary-width)]",
          "grid-cols-[var(--home-inbox-list-width)_minmax(0,1fr)]",
          "grid-cols-[minmax(0,1fr)_var(--home-auxiliary-width)]",
        ]) {
          expect(inspected.split(grid)).toHaveLength(2);
          inspected = inspected.replace(grid, "grid-cols-1");
        }
      }
      for (const pattern of [
        /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/,
        /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\(/,
        /\bdark:/,
        /-\[(?:#|rgb|hsl|oklch|var\(|color)/,
        /\bstyle=\{/,
        /ThemeProvider|createTheme|matchMedia|prefers-color-scheme/,
      ]) {
        expect(pattern.exec(inspected)?.[0], `${name} ${pattern}`).toBeUndefined();
      }
    }
  });

  it("uses only semantic colours that both hosts map to their root CSS variables", async () => {
    const used = new Set<string>();
    const ts = await import("typescript");
    for (const source of sources) {
      // Comments, React keys and test selectors are not CSS utilities. Remove
      // their exact AST ranges, retaining className and executable expressions.
      const parsed = ts.createSourceFile(source.name, source.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const metadata: import("typescript").JsxAttribute[] = [];
      const comments = new Map<string, import("typescript").CommentRange>();
      const visit = (node: import("typescript").Node) => {
        if (ts.isJsxAttribute(node) && ["key", "data-testid"].includes(node.name.getText(parsed))) metadata.push(node);
        for (const range of [...(ts.getLeadingCommentRanges(source.text, node.pos) ?? []),
          ...(ts.getTrailingCommentRanges(source.text, node.end) ?? [])]) comments.set(`${range.pos}:${range.end}`, range);
        ts.forEachChild(node, visit);
      };
      visit(parsed);
      const ranges = [...metadata.map((node) => ({ pos: node.getStart(parsed), end: node.end })), ...comments.values()];
      if (source.name === "use-text-scale-shortcuts.ts") {
        // Fixed Buzz desktop/src/app/useWebviewZoomShortcuts.ts: this local
        // preference key is not the Tailwind utility "text-scale".
        const key = parsed.statements.filter(ts.isVariableStatement).flatMap((node) => node.declarationList.declarations)
          .find((node) => node.name.getText(parsed) === "TEXT_SCALE_STORAGE_KEY")?.initializer;
        if (!key || !ts.isStringLiteral(key)) throw new Error("Original zoom storage key is missing");
        expect(key.text).toBe("buzz:text-scale");
        ranges.push({ pos: key.getStart(parsed), end: key.end });
      }
      let text = source.text;
      for (const range of ranges.filter((range) => !ranges.some((outer) => outer !== range
        && outer.pos <= range.pos && outer.end >= range.end)).sort((a, b) => b.pos - a.pos)) {
        text = text.slice(0, range.pos) + text.slice(range.end);
      }
      if (source.name === "agents.tsx") {
        // REQ-24: preserve these exact WorkflowCard accents from Buzz
        // 779af8886caae1317b4de962082429867ab61503,
        // desktop/src/features/workflows/ui/WorkflowCard.tsx::TRIGGER_ACCENTS/ACTION_ACCENTS.
        // This is not a general allowance for literal colours in platform pages.
        const card = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "AutomationCard");
        expect(card).toBeDefined();
        for (const accent of [
          "border-emerald-400/30 bg-emerald-600 text-white",
          "border-blue-400/30 bg-blue-600 text-white",
        ]) {
          expect(card!.getText(parsed).split(accent)).toHaveLength(2);
          expect(text.split(accent)).toHaveLength(2);
          text = text.replace(accent, "");
        }
        expect(source.text).toContain('import { WorkflowActionTileStack, WorkflowStatusToggle } from "./workflow-card-actions"');
        expect(card!.getText(parsed)).toContain("<WorkflowActionTileStack content={content}");
      }
      if (source.name === "workflow-card-actions.tsx") {
        // The original WorkflowCard action tiles now have one shared module.
        // Pin each admitted original ACTION_ACCENTS entry and its real consumer;
        // do not exempt the file or any other literal colour expression.
        const declaration = parsed.statements.filter(ts.isVariableStatement)
          .flatMap((node) => node.declarationList.declarations)
          .find((node) => node.name.getText(parsed) === "ACTION_ACCENTS");
        const accents = declaration?.initializer;
        if (!accents || !ts.isObjectLiteralExpression(accents)) throw new Error("Original workflow action accents are missing");
        const entries = accents.properties.map((node) => {
          if (!ts.isPropertyAssignment(node) || !ts.isIdentifier(node.name)
            || !ts.isStringLiteral(node.initializer)) throw new Error("Unverified workflow action accent");
          return [node.name.text, node.initializer.text];
        });
        expect(entries).toEqual([
          ["add_reaction", "border-pink-400/30 bg-pink-600 text-white"],
          ["delay", "border-sky-300/30 bg-sky-500 text-white"],
          ["request_approval", "border-emerald-300/30 bg-emerald-600 text-white"],
          ["send_message", "border-blue-300/30 bg-blue-600 text-white"],
          ["set_channel_topic", "border-violet-300/30 bg-violet-600 text-white"],
        ]);
        const tile = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "ActionTile");
        expect(tile?.getText(parsed)).toContain('ACTION_ACCENTS[action] ?? "border-border/65 bg-background/80 text-muted-foreground"');
        const expression = accents.getText(parsed);
        expect(text.split(expression)).toHaveLength(2);
        text = text.replace(expression, "{}");
      }
      if (source.name === "members.tsx") {
        // Buzz 779af8886caae1317b4de962082429867ab61503,
        // desktop/src/features/community-members/ui/CommunityMembersSettingsCard.tsx::RelayMemberRow.
        // Preserve the original admin badge only; other literal colours still fail.
        const originalBadge = '<Shield className="h-4 w-4 text-blue-500" aria-label={t("roles.workspace")}/>';
        expect(text.split(originalBadge)).toHaveLength(2);
        text = text.replace(originalBadge, "");
      }
      if (source.name === "inbox-surface.tsx") {
        // Buzz 779af8886caae1317b4de962082429867ab61503,
        // desktop/src/features/home/ui/InboxListPane.tsx::InboxRowActionButton.
        // Preserve only this exact original active reminder tint, not a general
        // allowance for literal colours elsewhere in the shared UI.
        const originalTint = 'active && "bg-blue-500/10 text-blue-500 hover:text-blue-500"';
        expect(text.split(originalTint)).toHaveLength(2);
        text = text.replace(originalTint, "active");
      }
      if (source.name === "draft-surfaces.tsx" || source.name === "workflow-discard-dialog.tsx") {
        // Buzz 779af8886caae1317b4de962082429867ab61503,
        // desktop/src/shared/ui/alert-dialog.tsx::AlertDialogOverlay.
        // This exact modal backdrop is original; other literal colours remain
        // scanned, including any change to this element or its opacity.
        const originalOverlay = '<AlertDialog.Overlay className={cn("fixed inset-0 z-50 bg-black/60", MODAL_OVERLAY_MOTION_CLASS, MODAL_BACKDROP_BLUR_CLASS)} />';
        expect(text.split(originalOverlay)).toHaveLength(2);
        text = text.replace(originalOverlay, "");
      }
      for (const [, utility, token] of text.matchAll(colorUtility)) {
        if (token === "sidebar") {
          for (const config of hosts) expect(config).toContain('DEFAULT: "hsl(var(--sidebar-background))"');
          continue;
        }
        // Native Switch ring-offset utilities are width or a host colour,
        // not colours named "offset-2" / "offset-background".
        if ((utility === "ring" || utility === "outline") && /^offset-\d+$/.test(token!)) continue;
        if (utility === "ring" && token === "inset") continue;
        if (utility === "ring" && token!.startsWith("offset-")) {
          used.add(token!.slice("offset-".length));
          continue;
        }
        if (utility === "outline" && token === "hidden") continue;
        if (utility === "border" && /^[tblrxyse]-\d+$/.test(token!)) continue;
        if (utility === "border" && token === "l-transparent") continue;
        if (utility === "shadow" && token === "content-edge") {
          for (const config of hosts) {
            expect(config).toContain('"content-edge": "-1px -1px 0 0 hsl(var(--sidebar-border) / 0.45)"');
          }
          continue;
        }
        if (utility === "text" && token === "message") {
          for (const config of hosts) {
            expect(config).toContain('"var(--conversation-message-font-size)"');
            expect(config).toContain('lineHeight: "var(--conversation-message-line-height)"');
          }
          continue;
        }
        if (utility === "text" && token === "message-timestamp") {
          for (const config of hosts) {
            expect(config).toContain('"var(--conversation-timestamp-font-size)"');
            expect(config).toContain('lineHeight: "var(--conversation-timestamp-line-height)"');
          }
          continue;
        }
        if (!notColor.test(token!) && !neutral.has(token!)) used.add(token!);
      }
    }
    expect([...used].filter((token) => !semanticColors.includes(token))).toEqual([]);
    for (const token of semanticColors) {
      const variable = token === "warning" ? "ui-warning" : token === "warning-bg" ? "ui-warning-bg" : token;
      for (const config of hosts) expect(config).toContain(`var(--${variable})`);
    }
    // The original monthly schedule hint uses the same adaptive host warning
    // variables. Pin the real mapping rather than allowing a literal colour.
    const theme = readFileSync(join(root, "src/theme/adaptive-theme.ts"), "utf8");
    expect(theme).toContain('"--ui-warning": accentOrange');
    expect(theme).toContain('"--ui-warning-bg": overlay(accentOrange, isDark ? 0.1 : 0.08)');
    for (const config of hosts) {
      expect(config).toContain('DEFAULT: "var(--ui-warning)"');
      expect(config).toContain('bg: "var(--ui-warning-bg)"');
      expect(config).toContain('border: "hsl(var(--sidebar-border))"');
      expect(config).toContain('"conversation-body": "var(--conversation-body-gap)"');
      expect(config).toContain('"conversation-row": "var(--conversation-row-padding-block)"');
      expect(config).toContain('"message-author": "var(--conversation-author-line-height)"');
      expect(config).toContain('"2xs": "calc(var(--buzz-type-rem) * 0.6875)"');
    }
  });
});

// DD-24/25、17 §8、apps/06 §4：通过实际共享页与 GET 客户端检查读取结论，
// 不把 Definition 可见推导为 Asset 可读，也不从 UNKNOWN 制造确定失败。
describe("AgentDefinitionsPage read outcomes", () => {
  const definition = {
    resourceId: "agent-1", displayName: "Observed definition", stableSlug: "observed",
    ownerPrincipalId: "owner-1", resourceVersion: 1, resourceState: "ACTIVE", status: "ACTIVE",
    currentPublishedVersionAssetId: "asset-1",
  };

  it.each(["en", "zh-CN"] as const)("uses the original Agent introduction and one page refresh for both readers (%s)", async (locale) => {
    const t = transport((r) => r.path === "/api/v1/agent-definitions" ? { status: 200, body: { definitions: [] } }
      : r.path === "/api/v1/workspaces" ? { status: 200, body: [{ id: "workspace-one", name: "Workspace", slug: "workspace" }] }
      : r.path.startsWith("/api/v1/agent-installations?") ? { status: 200, body: { installations: [] } }
      : { status: 200, body: [] });
    const host = await mount(t, <AgentDefinitionsPage />, locale);
    expect(host.textContent).toContain(locale === "en" ? "Set up and manage your agents." : "设置和管理你的 Agent。");
    expect(host.textContent).not.toContain(locale === "en" ? "Manage stable definitions" : "此处管理稳定定义");
    expect(host.querySelector("[data-testid=new-agent-card]")).not.toBeNull();
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")].filter((node) =>
      (node.getAttribute("aria-label") ?? node.textContent) === (locale === "en" ? "Refresh" : "刷新"));
    expect(buttons).toHaveLength(1);
    const reads = (path: string) => t.send.mock.calls.filter(([r]) => r.path.startsWith(path)).length;
    const before = [reads("/api/v1/agent-definitions"), reads("/api/v1/workspaces"), reads("/api/v1/agent-installations?")];
    await click(buttons[0]!);
    for (const [index, path] of ["/api/v1/agent-definitions", "/api/v1/workspaces", "/api/v1/agent-installations?"].entries()) {
      expect(reads(path)).toBeGreaterThan(before[index]!);
    }
    expect(t.send.mock.calls.every(([r]) => r.method === "GET")).toBe(true);
  });

  it.each([
    { status: 403, label: "Not allowed" },
    { status: 404, label: "Not available here" },
  ])("list bare $status is definitive; retry only repeats GET", async ({ status, label }) => {
    let reply: BffReply = { status, body: undefined };
    const t = transport((r) => r.path === "/api/v1/tasks" ? { status: 200, body: [] } : reply);
    const host = await mount(t, <AgentDefinitionsPage />);
    await settle();
    expect(host.querySelector("[role=alert]")?.textContent).toContain(label);
    expect(host.textContent).not.toContain("result is unknown");
    expect(host.querySelector("[data-testid=new-agent-card]")).toBeNull();
    expect(host.textContent).not.toContain("PERMISSION_DENIED");
    expect(host.textContent).not.toContain("TARGET_NOT_FOUND");

    reply = { status: 200, body: { definitions: [] } };
    await click(button(host, "Try again"));
    expect(host.querySelector("[data-testid=new-agent-card]")).not.toBeNull();
    expect(t.send.mock.calls.filter(([r]) => r.path === "/api/v1/agent-definitions")).toHaveLength(2);
    expect(t.send.mock.calls.every(([r]) => r.method === "GET")).toBe(true);
  });

  it.each([
    { status: 403, label: "Not allowed", open: "View definition", locale: "en" as const },
    { status: 404, label: "此处不可用", open: "查看定义", locale: "zh-CN" as const },
  ])("definition detail bare $status does not become unknown", async ({ status, label, open, locale }) => {
    const t = transport((r) => r.path === "/api/v1/tasks" ? { status: 200, body: [] }
      : r.path === "/api/v1/agent-definitions" ? { status: 200, body: { definitions: [definition] } }
      : { status, body: undefined });
    const host = await mount(t, <AgentDefinitionsPage />, locale);
    await settle();
    // The original identity card independently reads its published Asset before
    // opening details. A visible Definition never grants that Asset permission.
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/agent-versions/asset-1" });
    const beforeOpen = t.send.mock.calls.length;
    await click(button(host, open));
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.querySelector("[role=alert]")?.textContent).toContain(label);
    expect(dialog!.textContent).not.toMatch(/result is unknown|结果不明/);
    expect(dialog!.querySelector('[data-testid="agent-definition-detail"]')).toBeNull();
    expect(t.send.mock.calls.slice(beforeOpen).map(([r]) => r)).toEqual([
      { method: "GET", path: "/api/v1/agent-definitions/agent-1" },
    ]);
    expect(t.send.mock.calls.every(([r]) => r.method === "GET")).toBe(true);
  });

  it.each([
    { reply: { status: 403, body: undefined }, label: "Not allowed", open: "View definition", locale: "en" as const },
    { reply: { status: 404, body: { class: ErrorClass.Precondition, reason: ReasonCode.TargetNotFound,
      content: "private-error-body" } }, label: "TARGET_NOT_FOUND", open: "查看定义", locale: "zh-CN" as const },
  ])("published Version shows actual refusal $label, not parent permission", async ({ reply, label, open, locale }) => {
    const t = transport((r) => r.path === "/api/v1/tasks" ? { status: 200, body: [] }
      : r.path === "/api/v1/agent-definitions" ? { status: 200, body: { definitions: [definition] } }
      : r.path === "/api/v1/agent-definitions/agent-1" ? { status: 200, body: definition }
      : reply);
    const host = await mount(t, <AgentDefinitionsPage />, locale);
    await settle();
    await click(button(host, open));
    const section = host.querySelector('[data-testid="agent-definition-detail"] h3')?.parentElement;
    expect(section?.querySelector("[role=alert]")?.textContent).toContain(label);
    expect(section?.textContent).not.toMatch(/result is unknown|结果不明/);
    expect(section?.textContent).not.toContain("private-error-body");
    if (reply.body === undefined) expect(section?.textContent).not.toContain("PERMISSION_DENIED");
    expect(section?.querySelector("pre")).toBeNull();
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/agent-versions/asset-1" });
    expect(t.send.mock.calls.every(([r]) => r.method === "GET")).toBe(true);
  });

  it.each([
    { name: "explicit UNKNOWN over 403", reply: { status: 403,
      body: { class: ErrorClass.Unknown, reason: ReasonCode.PermissionDenied, content: "private-error-body" } } },
    { name: "explicit UNKNOWN over 404", reply: { status: 404,
      body: { class: ErrorClass.Unknown, reason: ReasonCode.TargetNotFound, content: "private-error-body" } } },
    { name: "unknown classification over 403", reply: { status: 403,
      body: { class: "FUTURE_CLASS", reason: ReasonCode.PermissionDenied, content: "private-error-body" } } },
    { name: "unclassified 503", reply: { status: 503, body: undefined } },
    { name: "malformed 200", reply: { status: 200, body: { assetId: "asset-1" } } },
    { name: "transport error", reply: new TransportError("private-error-body") },
  ])("published Version keeps $name unknown", async ({ reply }) => {
    const t = transport((r) => {
      if (r.path === "/api/v1/tasks") return { status: 200, body: [] };
      if (r.path === "/api/v1/agent-definitions") return { status: 200, body: { definitions: [definition] } };
      if (r.path === "/api/v1/agent-definitions/agent-1") return { status: 200, body: definition };
      if (reply instanceof TransportError) throw reply;
      return reply;
    });
    const host = await mount(t, <AgentDefinitionsPage />);
    await settle();
    await click(button(host, "View definition"));
    const section = host.querySelector('[data-testid="agent-definition-detail"] h3')?.parentElement;
    expect(section?.querySelector("[role=status]")?.textContent).toContain("the result is unknown");
    expect(section?.querySelector("[role=alert]")).toBeNull();
    expect(section?.textContent).not.toMatch(/Not allowed|Not available here|PERMISSION_DENIED|TARGET_NOT_FOUND|private-error-body/);
    expect(section?.querySelector("pre")).toBeNull();
    expect(section && button(section, "Try again")).toBeTruthy();
    expect(t.send.mock.calls.every(([r]) => r.method === "GET")).toBe(true);
  });
});

describe("AgentDefinitionsPage installation read-only facts", () => {
  const installation = {
    resourceId: "installation-1", workspaceId: "workspace-1", agentResourceId: "agent-1",
    pinnedVersionAssetId: "pinned-asset-1", agentPrincipalId: "agent-principal-1",
    agentPrincipalState: "ACTIVE", ownerPrincipalId: "owner-1", resourceVersion: 1,
    resourceState: "PROVISIONING", state: "PROVISIONING",
    channelBinding: { status: "DISABLED", triggers: ["MENTION", "MANUAL_ASSIGNMENT"], channelId: "channel-1" },
    projection: { generation: 1, agentVersionAssetId: "pinned-asset-1", runtimeProfileKey: "SERVER_CODEX",
      configHash: "a".repeat(64), state: "PENDING" },
    runtimeIsolationRef: "/private/runtime/root", content: "private-prompt", secretRef: "private-secret-ref",
  };
  const routes = (page: (r: BffRequest) => BffReply) => transport((r) => {
    if (r.path === "/api/v1/tasks") return { status: 200, body: [] };
    if (r.path === "/api/v1/agent-definitions") return { status: 200, body: { definitions: [] } };
    if (r.path === "/api/v1/workspaces") return { status: 200, body: [{ id: "workspace-1", slug: "ops", name: "Ops" }] };
    if (r.path === "/api/v1/agent-installations/installation-1") return { status: 200, body: installation };
    return page(r);
  });

  it("shows the exact pin and recorded pending facts without body, credentials or write controls", async () => {
    const t = routes(() => ({ status: 200, body: { installations: [installation] } }));
    const host = await mount(t, <AgentDefinitionsPage />);
    await settle();
    const section = host.querySelector("[data-testid=agent-installations]") as HTMLElement;
    expect(section.textContent).toContain("Being installed");
    expect(section.textContent).toContain("pinned-asset-1");
    expect(section.textContent).toContain("agent-principal-1");
    await click(button(section, "View installation"));
    const detail = host.querySelector("[data-testid=agent-installation-detail]") as HTMLElement;
    expect(detail.textContent).toContain("Projection pending");
    expect(detail.textContent).toContain("Disabled channel binding");
    expect(detail.textContent).toContain("Mention · Manual assignment");
    expect(detail.textContent).toContain("SERVER_CODEX");
    expect(detail.textContent).toContain("a".repeat(64));
    expect(detail.textContent).toContain("do not prove runtime health or authorize an invocation");
    expect(section.textContent).not.toMatch(/private-prompt|private-secret-ref|\/private\/runtime\/root/);
    const controls = [...section.querySelectorAll("button")].map((b) => b.textContent);
    for (const label of ["Install", "Run", "Create session", "Disable"]) {
      expect(controls).not.toContain(label);
    }
    expect(t.send.mock.calls.every(([r]) => r.method === "GET")).toBe(true);
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/agent-installations?workspaceId=workspace-1&offset=0" });
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/agent-versions/pinned-asset-1" });
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/agent-installations/installation-1" });
  });

  it("an authorized empty scan page can continue; it does not assert no installations exist", async () => {
    const t = routes((r) => r.path.endsWith("offset=0")
      ? { status: 200, body: { installations: [], nextOffset: 9 } }
      : { status: 200, body: { installations: [installation] } });
    const host = await mount(t, <AgentDefinitionsPage />);
    await settle();
    const section = host.querySelector("[data-testid=agent-installations]") as HTMLElement;
    expect(section.textContent).toContain("No agents to show on this page.");
    await click(button(section, "Next page"));
    expect(section.textContent).toContain("pinned-asset-1");
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/agent-installations?workspaceId=workspace-1&offset=9" });
    expect(button(section, "Previous page")).toBeTruthy();
    expect(t.send.mock.calls.every(([r]) => r.method === "GET")).toBe(true);
  });

  it.each([
    { name: "cross-workspace row", row: { ...installation, workspaceId: "workspace-other" } },
    { name: "unknown installation state", row: { ...installation, state: "FUTURE_STATE" } },
    { name: "different pinned projection", row: { ...installation,
      projection: { ...installation.projection, agentVersionAssetId: "latest-instead-of-pin" } } },
    { name: "mismatched active generation", row: { ...installation, state: "ACTIVE", resourceState: "ACTIVE",
      activeProjectionGeneration: 2, projection: { ...installation.projection, state: "ACTIVE" } } },
  ])("keeps $name unknown rather than rendering usable installation metadata", async ({ row }) => {
    const host = await mount(routes(() => ({ status: 200, body: { installations: [row] } })), <AgentDefinitionsPage />);
    await settle();
    const section = host.querySelector("[data-testid=agent-installations]") as HTMLElement;
    expect(section.querySelector("[role=status]")?.textContent).toContain("result is unknown");
    expect(section.textContent).not.toContain("No agents to show on this page.");
    expect(section.textContent).not.toContain("pinned-asset-1");
    expect([...section.querySelectorAll("button")].some((b) => b.textContent === "View installation")).toBe(false);
  });

  it.each([
    { reply: { status: 403, body: undefined }, label: "Not allowed" },
    { reply: { status: 404, body: undefined }, label: "Not available here" },
    { reply: { status: 503, body: { class: ErrorClass.Unknown, reason: ReasonCode.DependencyUnavailable } },
      label: "result is unknown" },
  ])("installation read $reply.status does not turn into an authorized empty page", async ({ reply, label }) => {
    const t = routes(() => reply);
    const host = await mount(t, <AgentDefinitionsPage />);
    await settle();
    const section = host.querySelector("[data-testid=agent-installations]") as HTMLElement;
    expect(section.textContent).toContain(label);
    expect(section.textContent).not.toContain("No agents to show on this page.");
    expect(t.send.mock.calls.every(([r]) => r.method === "GET")).toBe(true);
  });

  // After-implementation protocol evidence of the same real page caller.
  // Reuse the existing Installation row/transport; no DB seed or native ACK.
  it.each([
    { name: "core replace", label: "Replace core memory", action: "agent.memory.core.replace", slug: "core", mode: "value", state: "FOUND", head: "a".repeat(64), reply: undefined },
    { name: "entry set", label: "Set entry value", action: "agent.memory.entry.set", slug: "mem/context", mode: "value", state: "ABSENT", head: "b".repeat(64), reply: undefined },
    { name: "entry patch", label: "Apply strict patch", action: "agent.memory.entry.patch", slug: "mem/context", mode: "patch", state: "FOUND", head: "b".repeat(64), reply: undefined },
    { name: "entry remove", label: "Write tombstone", action: "agent.memory.entry.remove", slug: "mem/context", mode: "remove", state: "FOUND", head: "b".repeat(64), reply: undefined },
    { name: "unclassified 503", label: "Replace core memory", action: "agent.memory.core.replace", slug: "core", mode: "value", state: "FOUND", head: "a".repeat(64), reply: { status: 503, body: undefined } },
    { name: "DENIED with unknown dispatch", label: "Replace core memory", action: "agent.memory.core.replace", slug: "core", mode: "value", state: "FOUND", head: "a".repeat(64), reply: { status: 200, body: { actionKey: "agent.memory.core.replace", actionExecutionId: "write-ae", operationId: "write-op", gateState: "DENIED", dispatchState: "UNKNOWN", reason: ReasonCode.PermissionDenied } } },
  ])("$name freezes the actual head and scope in the original ActionCommand", async ({ label, action, slug, mode, state, head, reply }) => {
    const active = { ...installation, state: "ACTIVE", resourceState: "ACTIVE", activeProjectionGeneration: 1,
      projection: { ...installation.projection, state: "ACTIVE" } };
    const t = transport((r) => {
      if (r.path === "/api/v1/tasks") return { status: 200, body: [] };
      if (r.path === "/api/v1/session") return { status: 200, body: { accessMode: "FULL", tenantPrincipalId: installation.ownerPrincipalId } };
      if (r.path === "/api/v1/agent-definitions") return { status: 200, body: { definitions: [] } };
      if (r.path === "/api/v1/workspaces") return { status: 200, body: [{ id: installation.workspaceId, slug: "ops", name: "Ops" }] };
      if (r.path === `/api/v1/agent-installations/${installation.resourceId}`) return { status: 200, body: active };
      if (r.path.startsWith("/api/v1/agent-installations?")) return { status: 200, body: { installations: [active] } };
      if (r.path.endsWith("/memory/entries")) return { status: 200, body: { installationResourceId: installation.resourceId,
        workspaceId: installation.workspaceId, operationId: "memory-op", state: "COMPLETE", entries: [] } };
      if (r.path.includes("/memory/")) return { status: 200, body: { installationResourceId: installation.resourceId,
        workspaceId: installation.workspaceId, operationId: "memory-op", slug, state, eventId: head, createdAt: 1,
        ...(state === "FOUND" ? { content: "记忆", contentBytes: 6, valueHash: "c".repeat(64) } : {}) } };
      if (r.path === "/api/v1/actions") {
        if (reply) return reply;
        throw new TransportError("reply lost");
      }
      return forbidden;
    });
    const host = await mount(t, <AgentDefinitionsPage />);
    await settle();
    await click(button(host.querySelector("[data-testid=agent-installations]") as HTMLElement, "View installation"));
    await click(button(host, "Read memory"));
    if (slug !== "core") {
      const input = host.querySelector("[data-testid=agent-memory] input") as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      await act(async () => { setter?.call(input, slug); input.dispatchEvent(new Event("input", { bubbles: true })); });
      await click(button(host, "Read entry"));
    }
    await click(button(host, label));
    const editor = host.querySelector("[data-testid=agent-memory-editor]") as HTMLElement;
    const textarea = editor.querySelector("textarea");
    const text = mode === "patch" ? "--- a\n+++ b\n@@ -1 +1 @@\n-记忆\n+更新\n" : "更新";
    if (textarea) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      await act(async () => { setter?.call(textarea, text); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    }
    await click(button(editor, "Review request"));
    await click(button(editor, "Submit governed request"));
    const posts = t.send.mock.calls.map(([r]) => r).filter((r) => r.path === "/api/v1/actions");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({ actionKey: action, idempotencyKey: expect.any(String),
      resourceId: installation.resourceId, resourceVersion: installation.resourceVersion, workspaceId: installation.workspaceId,
      memoryWrite: { slug, expectedHeadState: state, expectedHeadEventId: head,
        ...(mode === "value" ? { value: text } : mode === "patch" ? { patch: text, baseHash: "c".repeat(64) } : {}) } });
    expect(editor.textContent).toContain("Outcome is not confirmed");
    expect(button(host, "Close memory").disabled).toBe(true);
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    expect([...dialog.querySelectorAll("button")].some((node) => node.textContent === "Close")).toBe(false);
    await act(async () => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector('[data-testid="agent-memory-editor"]')).toBe(editor);
    expect(editor.querySelector("textarea")).toBeNull();
    await click(button(editor, "Re-check same request"));
    const retried = t.send.mock.calls.map(([r]) => r).filter((r) => r.path === "/api/v1/actions");
    expect(retried).toHaveLength(2);
    expect(retried[1]?.body).toEqual(retried[0]?.body);
  });

  it.each([
    { owner: "another-human", canWrite: false, tasks: { status: 200, body: [] } },
    { owner: installation.ownerPrincipalId, canWrite: false, tasks: { status: 503, body: undefined } },
    { owner: installation.ownerPrincipalId, tasks: { status: 200, body: [{ actionKey: "agent.memory.core.replace",
      targetId: installation.resourceId, actionExecutionId: "existing-ae", operationId: "existing-op",
      gateState: "ALLOWED", dispatchState: "UNKNOWN" }] }, canWrite: false },
    { owner: installation.ownerPrincipalId, tasks: { status: 200, body: [{ actionKey: "agent.memory.core.replace",
      targetId: installation.resourceId, actionExecutionId: "existing-ae", operationId: "existing-op",
      gateState: "DENIED", dispatchState: "UNKNOWN", reason: ReasonCode.PermissionDenied }] }, canWrite: false },
    { owner: installation.ownerPrincipalId, tasks: { status: 200, body: [{ actionKey: "agent.memory.core.replace",
      targetId: installation.resourceId, actionExecutionId: "existing-ae", operationId: "existing-op",
      gateState: "ALLOWED", dispatchState: "DISPATCHED", reason: ReasonCode.TargetStateConflict }] }, canWrite: true },
    { owner: installation.ownerPrincipalId, tasks: { status: 200, body: [{ actionKey: "agent.memory.core.replace",
      targetId: installation.resourceId, actionExecutionId: "existing-ae", operationId: "existing-op",
      gateState: "ALLOWED", dispatchState: "DISPATCHED", reason: ReasonCode.ExternalResultUnknown }] }, canWrite: false },
  ])("uses exact owner and confirmed task facts before offering replacement writes ($canWrite)", async ({ owner, tasks, canWrite }) => {
    const active = { ...installation, state: "ACTIVE", resourceState: "ACTIVE", activeProjectionGeneration: 1,
      projection: { ...installation.projection, state: "ACTIVE" } };
    const t = transport((r) => {
      if (r.path === "/api/v1/tasks") return tasks;
      if (r.path === "/api/v1/session") return { status: 200, body: { accessMode: "FULL", tenantPrincipalId: owner } };
      if (r.path === "/api/v1/agent-definitions") return { status: 200, body: { definitions: [] } };
      if (r.path === "/api/v1/workspaces") return { status: 200, body: [{ id: installation.workspaceId, slug: "ops", name: "Ops" }] };
      if (r.path === `/api/v1/agent-installations/${installation.resourceId}`) return { status: 200, body: active };
      if (r.path.startsWith("/api/v1/agent-installations?")) return { status: 200, body: { installations: [active] } };
      if (r.path.endsWith("/memory/entries")) return { status: 200, body: { installationResourceId: installation.resourceId,
        workspaceId: installation.workspaceId, operationId: "memory-op", state: "COMPLETE", entries: [] } };
      if (r.path.endsWith("/memory/core")) return { status: 200, body: { installationResourceId: installation.resourceId,
        workspaceId: installation.workspaceId, operationId: "memory-op", slug: "core", state: "ABSENT" } };
      return forbidden;
    });
    const host = await mount(t, <AgentDefinitionsPage />);
    await settle();
    await click(button(host.querySelector("[data-testid=agent-installations]") as HTMLElement, "View installation"));
    await click(button(host, "Read memory"));
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Replace core memory")).toBe(canWrite);
    expect(t.send.mock.calls.every(([r]) => r.method === "GET")).toBe(true);
  });
});
