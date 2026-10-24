// DD-122, V-SCN-108/109/111/112: Installation tool view, same-version re-grant, delegation tool
// scopes and AGENT receivers of resource.grant_read on the shared surfaces.
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorClass, ReasonCode } from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { setLocale } from "../src/i18n";
import { ApplicationBindingsPanel } from "../src/react/application-bindings";
import { PlatformProvider } from "../src/react/context";
import { AgentDefinitionsPage } from "../src/react/pages";
import type { BffReply, BffRequest } from "../src/transport";
import { button, click, render, settle } from "./render";

type Route = (request: BffRequest) => BffReply | Promise<BffReply> | undefined;
const forbidden = { status: 403, body: { class: ErrorClass.Denied, reason: ReasonCode.PermissionDenied } };

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); setLocale("en");
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

const workspaceId = "workspace-1";
const memoryTool = "11111111-1111-4111-8111-111111111111";
const searchTool = "22222222-2222-4222-8222-222222222222";
const provider = "33333333-3333-4333-8333-333333333333";
const installation = { resourceId: "installation-1", resourceVersion: 6, workspaceId, agentResourceId: "agent-1",
  pinnedVersionAssetId: "published-1", ownerPrincipalId: "human-1", agentPrincipalId: "agent-principal-1",
  agentPrincipalState: "ACTIVE", state: "ACTIVE", resourceState: "ACTIVE", agentDisplayName: "Researcher",
  activeProjectionGeneration: 2, projection: { generation: 2, agentVersionAssetId: "published-1",
    runtimeProfileKey: "profile-1", configHash: "c".repeat(64), state: "ACTIVE" } };
const version = { assetId: "published-1", assetVersion: 9, agentResourceId: "agent-1", ownerPrincipalId: "human-1",
  ordinal: 3, state: "PUBLISHED", configHash: "a".repeat(64), canUpdate: false, canPublish: false,
  content: { personaIdentity: { displayName: "Researcher" }, instructions: "Exact instructions",
    runtimeProfileKey: "profile-1", modelRouteResourceId: "route-1", replyPolicy: "profile-declared-reply",
    skillVersionAssetIds: [], declaredToolResourceIds: [memoryTool], capabilityRequirements: ["knowledge.search@v1"],
    triggerDefaults: ["MENTION"], parallelism: 1, turnLimits: { idleTimeoutSeconds: 30, maxTurnDurationSeconds: 90 },
    memoryPolicy: { coreWrite: "HUMAN_ONLY", coldWrite: "DISABLED" } } };
const tools = [
  { source: "PLATFORM_NATIVE", name: "Memory list", toolResourceId: memoryTool, bindingStatus: "ACTIVE" },
  { source: "APPLICATION", name: "Knowledge search", toolResourceId: searchTool, capabilityRequirement: "knowledge.search@v1",
    applicationBindingId: provider, bindingStatus: "NO_PERMISSION", reasonCode: "PERMISSION_DENIED" },
  { source: "APPLICATION", capabilityRequirement: "files.read@v1", bindingStatus: "PENDING" },
  { source: "PLATFORM_NATIVE", name: "Memory read", toolResourceId: "44444444-4444-4444-8444-444444444444", bindingStatus: "REVOKED" },
];
const toolPage = (rows: unknown[] = tools) => ({ installationResourceId: installation.resourceId, generation: 2, tools: rows });

function agentsPage(extra?: Route) {
  const send = vi.fn(async (r: BffRequest): Promise<BffReply> => {
    const reply = await extra?.(r);
    if (reply) return reply;
    if (r.path === "/api/v1/tasks") return { status: 200, body: [] };
    if (r.path === "/api/v1/agent-definitions") return { status: 200, body: { definitions: [] } };
    if (r.path === "/api/v1/workspaces") return { status: 200, body: [{ id: workspaceId, name: "Ops", slug: "ops" }] };
    if (r.path.startsWith("/api/v1/agent-installations?")) return { status: 200, body: { installations: [installation] } };
    if (r.path === `/api/v1/agent-installations/${installation.resourceId}`) return { status: 200, body: { ...installation, canUpgrade: true, resourceVersion: 12 } };
    if (r.path === `/api/v1/agent-installations/${installation.resourceId}/tools`) return { status: 200, body: toolPage() };
    if (r.path === `/api/v1/agent-versions/${version.assetId}`) return { status: 200, body: version };
    return forbidden;
  });
  return send;
}

async function mountAgents(send: ReturnType<typeof agentsPage>) {
  await render(<PlatformProvider client={createBffClient({ send })} locale="en">
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AgentDefinitionsPage />
    </QueryClientProvider>
  </PlatformProvider>);
  await settle();
  // Agent dialogs portal beside the page.
  const host = document.body;
  await click(button(section(host, "agent-installations"), "View installation"));
  return host;
}

function section(host: HTMLElement, name: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(`[data-testid=${name}]`);
  if (!found) throw new Error(`Missing section ${name}: ${host.textContent}`);
  return found;
}

async function choose(host: HTMLElement, label: string, value: string) {
  const field = [...host.querySelectorAll("label")].find((row) => row.textContent?.startsWith(label))?.querySelector("select,input");
  if (!(field instanceof HTMLSelectElement || field instanceof HTMLInputElement)) throw new Error(`Missing control ${label}`);
  const prototype = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value);
    field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
  await settle();
}

/** DD-153: delegation scopes are a checkbox list; tick the one whose label starts with `label`. */
async function tick(host: HTMLElement, label: string) {
  const row = [...host.querySelectorAll<HTMLElement>("[data-testid=agent-delegation-scope-choice]")]
    .find((item) => item.textContent?.startsWith(label));
  const box = row?.querySelector("input[type=checkbox]");
  if (!(box instanceof HTMLInputElement)) throw new Error(`Missing scope choice ${label}`);
  await click(box);
}

const posts = (send: ReturnType<typeof agentsPage>) => send.mock.calls.map(([r]) => r).filter((r) => r.path === "/api/v1/actions");

describe("Installation tools (DD-122)", () => {
  it("renders every binding status with its source, requirement, provider and reason", async () => {
    const send = agentsPage();
    const host = await mountAgents(send);
    expect(send.mock.calls.some(([r]) => r.path.endsWith("/tools"))).toBe(false);
    await click(button(host, "View tools"));
    const view = section(host, "agent-installation-tools");
    const rows = [...view.querySelectorAll<HTMLElement>("[data-testid=agent-installation-tool]")];
    expect(rows.map((row) => row.dataset.status)).toEqual(["ACTIVE", "NO_PERMISSION", "PENDING", "REVOKED"]);
    expect(rows[0]?.textContent).toContain("Memory list");
    expect(rows[0]?.textContent).toContain("Platform");
    expect(rows[0]?.textContent).toContain("Built into the platform");
    expect(rows[0]?.textContent).toContain("Granted");
    expect(rows[1]?.textContent).toContain("Knowledge search");
    expect(rows[1]?.textContent).toContain("Application");
    expect(rows[1]?.textContent).toContain("knowledge.search@v1");
    expect(rows[1]?.textContent).toContain(provider);
    expect(rows[1]?.textContent).toContain("Not granted");
    expect(rows[1]?.textContent).toContain("The installer needs share permission on this tool.");
    expect(rows[2]?.textContent).toContain("files.read@v1");
    expect(rows[2]?.textContent).toContain("No provider yet");
    expect(rows[2]?.textContent).toContain("Awaiting provider");
    expect(rows[3]?.textContent).toContain("Revoked");
    expect(view.textContent).toContain("Projection generation: 2");
    expect(posts(send)).toHaveLength(0);
  });

  it("re-grants through agent.installation.upgrade to the same freshly read pinned version", async () => {
    const send = agentsPage((r) => r.path === "/api/v1/actions" ? { status: 202, body: { actionKey: "agent.installation.upgrade",
      actionExecutionId: "regrant-ae", operationId: "regrant-op", gateState: "ALLOWED", dispatchState: "UNKNOWN" } } : undefined);
    const host = await mountAgents(send);
    await click(button(host, "View tools"));
    await click(button(section(host, "agent-installation-tools"), "Re-grant tools"));
    const action = section(host, "agent-installation-regrant");
    expect(action.querySelector("select")).toBeNull();
    expect(action.textContent).toContain(`Pinned version: Researcher · 3 · ${version.assetId}`);
    await click(button(action, "Review request"));
    expect(posts(send)).toHaveLength(0);
    await click(button(action, "Request tool re-grant"));
    const command = posts(send)[0]?.body;
    expect(command).toEqual({ actionKey: "agent.installation.upgrade", idempotencyKey: expect.any(String),
      workspaceId, resourceId: installation.resourceId, resourceVersion: 12,
      assetId: installation.pinnedVersionAssetId, assetVersion: version.assetVersion });
    // UNKNOWN keeps the same intent: the re-check resends the identical command.
    await click(button(action, "Re-check same request"));
    expect(posts(send)).toHaveLength(2);
    expect(posts(send)[1]?.body).toEqual(command);
  });

  it("does not offer re-grant when every tool is granted or revoked", async () => {
    const granted = agentsPage((r) => r.path.endsWith("/tools")
      ? { status: 200, body: toolPage([tools[0], tools[3]]) } : undefined);
    const host = await mountAgents(granted);
    await click(button(host, "View tools"));
    expect(section(host, "agent-installation-tools").querySelectorAll("[data-testid=agent-installation-tool]")).toHaveLength(2);
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Re-grant tools")).toBe(false);
    expect(host.textContent).not.toContain("must re-grant its tools");
  });

  it("does not offer re-grant to a reader who cannot upgrade the installation", async () => {
    const viewer = agentsPage((r) => r.path === `/api/v1/agent-installations/${installation.resourceId}`
      ? { status: 200, body: { ...installation, canUpgrade: false } } : undefined);
    const host = await mountAgents(viewer);
    await click(button(host, "View tools"));
    const view = section(host, "agent-installation-tools");
    expect([...view.querySelectorAll("button")].some((b) => b.textContent === "Re-grant tools")).toBe(false);
    expect(view.textContent).toContain("Someone who can upgrade this installation must re-grant its tools.");
    expect(posts(viewer)).toHaveLength(0);
  });

  it("does not render a page that speaks about another installation", async () => {
    const send = agentsPage((r) => r.path.endsWith("/tools")
      ? { status: 200, body: { ...toolPage(), installationResourceId: "installation-2" } } : undefined);
    const host = await mountAgents(send);
    await click(button(host, "View tools"));
    const view = section(host, "agent-installation-tools");
    expect(view.querySelector("[data-testid=agent-installation-tool]")).toBeNull();
    expect(view.textContent).not.toContain("Re-grant tools");
  });
});

describe("Delegation tool scopes (DD-122 (5))", () => {
  const hash = "d".repeat(64);
  const invoke = { actionKey: "agent.invoke", actionVersion: 1, targetType: "RESOURCE", targetId: installation.resourceId,
    resultExposureMode: "CONSUME_ONLY", outputSchemaHash: hash, redactionPolicy: "PLATFORM_METADATA_ONLY" };
  const memory = { actionKey: "agent.memory.entry.list", actionVersion: 1, targetType: "RESOURCE", targetId: installation.resourceId,
    toolResourceId: memoryTool, resultExposureMode: "CONSUME_ONLY", outputSchemaHash: hash, redactionPolicy: "PLATFORM_METADATA_ONLY" };
  const search = { actionKey: "knowledge.search", actionVersion: 2, targetType: "RESOURCE", targetId: "knowledge-base-1",
    toolResourceId: searchTool, resultExposureMode: "READ", outputSchemaHash: "e".repeat(64), redactionPolicy: "CONTRACT_DEFINED" };
  const grant = { delegationId: "grant-1", delegationVersion: 2, grantorPrincipalId: "human-1", state: "ACTIVE", effectiveState: "ACTIVE", uses: 0,
    parameters: { validFrom: "2026-10-01T00:00:00.000Z", expiresAt: "2027-10-01T00:00:00.000Z", scopes: [search] } };
  const routes = () => agentsPage((r) => {
    if (r.path.startsWith(`/api/v1/agent-installations/${installation.resourceId}/delegations?`)) return { status: 200,
      body: { installationResourceId: installation.resourceId, resourceVersion: installation.resourceVersion, workspaceId,
        canGrant: true, canRevoke: true, grants: [grant] } };
    if (r.path.startsWith(`/api/v1/agent-installations/${installation.resourceId}/delegation-targets?`)) return { status: 200,
      body: { installationResourceId: installation.resourceId, resourceVersion: installation.resourceVersion, workspaceId,
        scopes: [invoke, memory, search] } };
    if (r.path === `/api/v1/agent-installations/${installation.resourceId}`) return { status: 200, body: installation };
    if (r.path === "/api/v1/actions") return { status: 202, body: { actionKey: "agent.delegation.grant",
      actionExecutionId: "grant-ae", operationId: "grant-op", gateState: "WAITING", dispatchState: "NOT_DISPATCHED", approvalWorkflowId: "approval" } };
    return undefined;
  });

  const choices = (host: HTMLElement) => [...host.querySelectorAll("[data-testid=agent-delegation-scope-choice]")]
    .map((row) => row.textContent);

  it("grants agent.invoke and two tool scopes in one grant (DD-153, V-SCN-252)", async () => {
    const send = routes();
    const host = await mountAgents(send);
    await click(button(host, "View delegation grants"));
    await settle();
    const management = section(host, "agent-delegation-management");
    expect(choices(management)).toContain(`Memory list · agent.memory.entry.list · ${installation.resourceId} · 1`);
    expect(choices(management)).toContain("Knowledge search · knowledge.search · knowledge-base-1 · 2");
    expect(choices(management)).toContain(`agent.invoke · ${installation.resourceId} · 1`);
    expect(management.textContent).toContain("Tool reference: Knowledge search");
    expect(management.querySelector("form")).not.toBeNull();

    await tick(management, "agent.invoke");
    await tick(management, "Memory list");
    await tick(management, "Knowledge search");
    expect(management.textContent).toContain("3 scopes selected");
    await choose(management, "Valid from", "2026-11-01T00:00:00");
    await choose(management, "Expires at", "2026-12-01T00:00:00");
    expect(management.textContent).not.toContain("Tool scopes only take effect together with an invocation grant.");
    await click(button(management, "Review request"));
    expect(management.textContent).toContain("Tool reference: Memory list");
    await click(button(management, "Submit governed request"));
    const command = posts(send)[0]?.body as { actionKey: string; delegationGrant: { scopes: unknown[] } };
    expect(command.actionKey).toBe("agent.delegation.grant");
    expect(command.delegationGrant.scopes).toEqual([invoke, memory, search]);
  });

  it("refuses a grant with tool scopes but no invocation scope and explains why (DD-153)", async () => {
    const send = routes();
    const host = await mountAgents(send);
    await click(button(host, "View delegation grants"));
    await settle();
    const management = section(host, "agent-delegation-management");
    await tick(management, "Memory list");
    await choose(management, "Valid from", "2026-11-01T00:00:00");
    await choose(management, "Expires at", "2026-12-01T00:00:00");
    expect(management.textContent).toContain("Tool scopes only take effect together with an invocation grant.");
    expect(button(management, "Review request").disabled).toBe(true);
    await tick(management, "agent.invoke");
    expect(management.textContent).not.toContain("Tool scopes only take effect together with an invocation grant.");
    expect(button(management, "Review request").disabled).toBe(false);
    expect(posts(send)).toHaveLength(0);
  });

  it("marks an active tool-only grant as lacking an invocation grant (DD-153 (3))", async () => {
    const host = await mountAgents(routes());
    await click(button(host, "View delegation grants"));
    await settle();
    const management = section(host, "agent-delegation-management");
    expect(section(management, "agent-delegation-tool-only").textContent)
      .toContain("No invocation grant: the tools in it do not take effect in triggers.");
  });

  it("keeps selected scopes across target pages and grants them together (DD-153)", async () => {
    const send = agentsPage((r) => {
      if (r.path.includes("/delegations?")) return { status: 200, body: { installationResourceId: installation.resourceId,
        resourceVersion: installation.resourceVersion, workspaceId, canGrant: true, canRevoke: false, grants: [] } };
      if (r.path.includes("/delegation-targets?")) {
        const second = r.path.includes("offset=1");
        return { status: 200, body: { installationResourceId: installation.resourceId,
          resourceVersion: installation.resourceVersion, workspaceId, scopes: second ? [memory] : [invoke],
          ...(second ? {} : { nextOffset: 1 }) } };
      }
      if (r.path === `/api/v1/agent-installations/${installation.resourceId}`) return { status: 200, body: installation };
      if (r.path === "/api/v1/actions") return { status: 202, body: { actionKey: "agent.delegation.grant",
        actionExecutionId: "grant-ae", operationId: "grant-op", gateState: "WAITING", dispatchState: "NOT_DISPATCHED", approvalWorkflowId: "approval" } };
      return undefined;
    });
    const host = await mountAgents(send);
    await click(button(host, "View delegation grants"));
    await settle();
    const management = section(host, "agent-delegation-management");
    await tick(management, "agent.invoke");
    await click(button(management, "Next page"));
    await tick(management, "Memory list");
    expect(management.textContent).toContain("2 scopes selected");
    await choose(management, "Valid from", "2026-11-01T00:00:00");
    await choose(management, "Expires at", "2026-12-01T00:00:00");
    await click(button(management, "Review request"));
    await click(button(management, "Submit governed request"));
    const command = posts(send)[0]?.body as { delegationGrant: { scopes: unknown[] } };
    expect(command.delegationGrant.scopes).toEqual([invoke, memory]);
  });

  it("guides a tool scope into renewing the existing agent.invoke grant and appends it (DD-153 (2))", async () => {
    const invokeGrant = { ...grant, delegationId: "grant-invoke", delegationVersion: 4,
      parameters: { ...grant.parameters, scopes: [invoke] } };
    const send = agentsPage((r) => {
      if (r.path.includes("/delegations?")) return { status: 200, body: { installationResourceId: installation.resourceId,
        resourceVersion: installation.resourceVersion, workspaceId, canGrant: true, canRevoke: true, grants: [invokeGrant] } };
      if (r.path.includes("/delegation-targets?")) return { status: 200, body: { installationResourceId: installation.resourceId,
        resourceVersion: installation.resourceVersion, workspaceId, scopes: [invoke, memory, search] } };
      if (r.path === `/api/v1/agent-installations/${installation.resourceId}`) return { status: 200, body: installation };
      if (r.path === "/api/v1/actions") return { status: 202, body: { actionKey: "agent.delegation.grant",
        actionExecutionId: "grant-ae", operationId: "grant-op", gateState: "WAITING", dispatchState: "NOT_DISPATCHED", approvalWorkflowId: "approval" } };
      return undefined;
    });
    await render(<PlatformProvider client={createBffClient({ send })} locale="en" currentPrincipalId="human-1">
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AgentDefinitionsPage />
      </QueryClientProvider>
    </PlatformProvider>);
    await settle();
    await click(button(section(document.body, "agent-installations"), "View installation"));
    await click(button(document.body, "View delegation grants"));
    await settle();
    const management = section(document.body, "agent-delegation-management");
    await tick(management, "Memory list");
    expect(section(management, "agent-delegation-renew-for-tools").textContent).toContain("grant-invoke");
    await click(button(management, "Renew to add tools"));
    const renewal = section(management, "agent-delegation-renewal");
    expect(renewal.textContent).toContain("Renewal replaces grant-invoke (version 4).");
    await tick(renewal, "Knowledge search");
    await choose(renewal, "Valid from", "2026-11-01T00:00:00");
    await choose(renewal, "Expires at", "2026-12-01T00:00:00");
    await click(button(renewal, "Review request"));
    await click(button(management, "Submit governed request"));
    const command = posts(send)[0]?.body as { delegationGrant: { scopes: unknown[]; renewsDelegationId: string } };
    expect(command.delegationGrant.scopes).toEqual([invoke, memory, search]);
    expect(command.delegationGrant.renewsDelegationId).toBe("grant-invoke");
  });

  it("still refuses a tool scope whose memory target is another installation", async () => {
    const send = agentsPage((r) => {
      if (r.path.includes("/delegations?")) return { status: 200, body: { installationResourceId: installation.resourceId,
        resourceVersion: installation.resourceVersion, workspaceId, canGrant: true, canRevoke: false, grants: [] } };
      if (r.path.includes("/delegation-targets?")) return { status: 200, body: { installationResourceId: installation.resourceId,
        resourceVersion: installation.resourceVersion, workspaceId, scopes: [{ ...memory, targetId: "installation-2" }] } };
      if (r.path === `/api/v1/agent-installations/${installation.resourceId}`) return { status: 200, body: installation };
      return undefined;
    });
    const host = await mountAgents(send);
    await click(button(host, "View delegation grants"));
    await settle();
    const management = section(host, "agent-delegation-management");
    expect(choices(management).some((label) => label?.includes("installation-2"))).toBe(false);
  });
});

describe("AGENT receivers of resource.grant_read (DD-122 (6))", () => {
  // Organization-level connection: the Agent's Workspace is chosen beside the Agent.
  const binding = { bindingId: "connection-fixture", tenantId: "tenant-fixture", componentReleaseId: "release-fixture",
    componentTypeKey: "external_fixture", state: "ACTIVE", version: 3, activeProjectionGeneration: 1,
    capabilityCategories: [{ category: "knowledge", version: 1 }], canDisable: false, hasReadReceiver: true };
  const readSource = { resourceId: "source-resource", version: 7, bindingId: "source-binding", typeKey: "files", nativeRef: "native-source" };
  const readReceiver = { resourceId: "receiver-resource", version: 9, bindingId: binding.bindingId, typeKey: "knowledge", nativeRef: "native-receiver" };
  const readPage = (direction: string) => ({ bindingId: binding.bindingId, bindingVersion: binding.version, tenantId: binding.tenantId,
    servicePrincipalId: "receiver-service", direction, resources: [direction === "SOURCE" ? readSource : readReceiver] });
  function bindingsPanel() {
    const send = vi.fn(async (r: BffRequest): Promise<BffReply> => {
      if (r.method === "POST") return { status: 202, body: { actionKey: (r.body as { actionKey: string }).actionKey,
        actionExecutionId: "read-action", operationId: "read-operation", gateState: "WAITING", dispatchState: "NOT_DISPATCHED",
        approvalWorkflowId: "owner-approval" } };
      if (r.path === "/api/v1/workspaces") return { status: 200, body: [{ id: workspaceId, name: "Ops", slug: "ops" }] };
      if (r.path.includes("/read-resources")) return { status: 200,
        body: readPage(new URL(r.path, "https://test.invalid").searchParams.get("direction")!) };
      if (r.path.startsWith("/api/v1/agent-installations?")) return { status: 200, body: { installations: [installation] } };
      if (r.path.startsWith("/api/v1/application-bindings")) return { status: 200, body: { bindings: [binding], canCreate: false } };
      return forbidden;
    });
    return send;
  }

  it("grants a workspace Agent the chosen contract permission and never sends it for a SERVICE", async () => {
    const send = bindingsPanel();
    const host = await render(<PlatformProvider client={createBffClient({ send })} locale="en"><ApplicationBindingsPanel /></PlatformProvider>);
    await settle();
    await click(button(host, "Resource read permissions"));
    await choose(host, "Receiver", "agent");
    expect(host.textContent).toContain("Services and people can only receive read access.");
    expect(send.mock.calls.some(([r]) => r.path.startsWith("/api/v1/agent-installations?"))).toBe(false);
    await choose(host, "Workspace", workspaceId);
    await choose(host, "Receiving Agent", installation.resourceId);
    await choose(host, "Permission", "execute");
    await choose(host, "Source resource", readSource.resourceId);
    await click(button(host, "Request Agent access"));
    expect(send.mock.calls.some(([r]) => r.method === "POST")).toBe(false);
    expect(host.textContent).toContain("native-source → Researcher · Execute");
    await click(button(host, "Confirm"));
    const command = send.mock.calls.find(([r]) => r.method === "POST")?.[0].body;
    expect(command).toEqual({ actionKey: "resource.grant_read", idempotencyKey: expect.any(String),
      resourceId: readSource.resourceId, resourceVersion: 7, principalId: installation.agentPrincipalId, grantPermission: "execute" });
    expect(host.textContent).toContain("read-operation");

    await choose(host, "Receiver", "service");
    await choose(host, "Receiving resource", readReceiver.resourceId);
    await choose(host, "Source resource", readSource.resourceId);
    expect([...host.querySelectorAll("label")].some((row) => row.textContent?.startsWith("Permission"))).toBe(false);
    await click(button(host, "Request read access"));
    await click(button(host, "Confirm"));
    const service = send.mock.calls.filter(([r]) => r.method === "POST")[1]?.[0].body;
    expect(service).toMatchObject({ actionKey: "resource.grant_read", principalId: "receiver-service",
      receiverResource: { id: readReceiver.resourceId, version: 9 } });
    expect(service).not.toHaveProperty("grantPermission");
  });

  it("revokes the same Agent permission with explicit confirmation", async () => {
    const send = bindingsPanel();
    const host = await render(<PlatformProvider client={createBffClient({ send })} locale="en"><ApplicationBindingsPanel /></PlatformProvider>);
    await settle();
    await click(button(host, "Resource read permissions"));
    await choose(host, "Receiver", "agent");
    await choose(host, "Workspace", workspaceId);
    await choose(host, "Receiving Agent", installation.resourceId);
    await choose(host, "Permission", "consume");
    await choose(host, "Source resource", readSource.resourceId);
    await click(button(host, "Revoke Agent access"));
    expect(host.textContent).toContain("Its next tool call on that resource is refused");
    await click(button(host, "Confirm"));
    expect(send.mock.calls.find(([r]) => r.method === "POST")?.[0].body).toMatchObject({ actionKey: "resource.revoke_read",
      principalId: installation.agentPrincipalId, grantPermission: "consume", explicitConfirmation: true });
  });
});
