// DD-134 网关管理区（V-SCN-191..197 的前端部分）：入口与分区由 access 决定；统计、下钻与
// 读取失败不显示为零；写入只提交既有动作，结果不明只重查原请求；向导不探测未登记端点。

import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { act } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { GatewayPage, gatewayTabs } from "../src/react/gateway";
import { PlatformNavigation } from "../src/react/navigation";
import { canonicalDigest, canonicalJson } from "../src/gateway-drafts";
import { type BffReply, type BffRequest, TransportError } from "../src/transport";
import { button, click, render, settle, type } from "./render";

beforeAll(() => {
  if (!globalThis.crypto?.subtle) vi.stubGlobal("crypto", webcrypto);
});

const tenantId = "11111111-1111-4111-8111-111111111111";
const tenantAccess = { scope: "TENANT", tenantId, canReadStats: true, canReadTools: true, canReadModelRoutes: true,
  canCreateModelRoute: true, canReadConfig: false, canManageMcp: false, canBindMcp: true };
const platformAccess = { scope: "PLATFORM", tenantId, canReadStats: true, canReadTools: false, canReadModelRoutes: false,
  canCreateModelRoute: false, canReadConfig: true, canManageMcp: true, canBindMcp: false };
const noAccess = { ...tenantAccess, canReadStats: false, canReadTools: false, canReadModelRoutes: false,
  canCreateModelRoute: false, canBindMcp: false };

const counters = (requests: number, extra: Record<string, number> = {}) => ({ requests, succeeded: requests, failed: 0, denied: 0,
  running: 0, unknown: 0, billingUnavailable: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, ...extra });

function stats(dimension: string, overrides: Record<string, unknown> = {}) {
  return { scope: "TENANT", from: "2026-10-21T00:00:00Z", to: "2026-10-22T00:00:00Z", bucketSeconds: 3600, dimension,
    truncated: false, modelLogAvailable: true,
    totals: counters(12, { failed: 2, denied: 1, billingUnavailable: 3, totalTokens: 4500, inputTokens: 4000, outputTokens: 500,
      modelP50Ms: 800, modelP95Ms: 2400, toolP50Ms: 40, toolP95Ms: 90 }),
    rows: [{ key: "route-1", label: "chat-route", kind: "MODEL", counters: counters(9, { failed: 2, totalTokens: 4500, modelP50Ms: 800, modelP95Ms: 2400 }) },
      { key: "UNATTRIBUTED", counters: counters(3) }],
    buckets: [{ start: "2026-10-21T00:00:00Z", requests: 4, failed: 1, denied: 0, totalTokens: 100 },
      { start: "2026-10-21T01:00:00Z", requests: 8, failed: 1, denied: 1, totalTokens: 4400 }],
    ...overrides };
}

const call = { callId: "tool:22222222-2222-4222-8222-222222222222", kind: "TOOL", startedAt: "2026-10-21T01:00:00Z",
  outcome: "DENIED", reasonCode: "DELEGATION_REQUIRED", toolName: "time.convert", agentName: "研究助理",
  operationId: "33333333-3333-4333-8333-333333333333", actionExecutionId: "22222222-2222-4222-8222-222222222222" };

type Route = (request: BffRequest) => BffReply | Promise<BffReply>;

function routes(access: unknown, extra: Route = () => ({ status: 503, body: undefined })): Route {
  return (request) => {
    const path = request.path.split("?")[0];
    if (path === "/api/v1/gateway/access") return { status: 200, body: access };
    if (path === "/api/v1/workspaces") return { status: 200, body: [] };
    return extra(request);
  };
}

async function mount(route: Route, ui = <GatewayPage />) {
  const send = vi.fn(async (request: BffRequest) => route(request));
  const host = await render(<PlatformProvider client={createBffClient({ send })} locale="en">{ui}</PlatformProvider>);
  await settle();
  return { host, send };
}

const posts = (send: { mock: { calls: unknown[][] } }) =>
  send.mock.calls.map(([request]) => request as BffRequest).filter((request) => request.method === "POST");
const tab = (host: HTMLElement, id: string) => host.querySelector<HTMLButtonElement>(`[data-testid=gateway-tab-${id}]`)!;

describe("gateway entry and sections", () => {
  it("shows the navigation entry only when the session has a gateway section", async () => {
    const nav = (access: unknown) => mount(routes(access), <PlatformNavigation locale="en" selectedSection={null} onSelectSection={vi.fn()}
      icons={{ pulse: null, projects: null, members: null, agents: null, workflows: null, tasks: null, approvals: null, usage: null,
        operations: null, gateway: null, audit: null, devices: null }} />);
    expect((await nav(tenantAccess)).host.querySelector("[data-testid=sidebar-platform-gateway]")).not.toBeNull();
    expect((await nav(noAccess)).host.querySelector("[data-testid=sidebar-platform-gateway]")).toBeNull();
    const refused = await mount(() => ({ status: 403, body: { class: "DENIED", reason: "PERMISSION_DENIED" } }),
      <PlatformNavigation locale="en" selectedSection={null} onSelectSection={vi.fn()} icons={{ pulse: null, projects: null, members: null,
        agents: null, workflows: null, tasks: null, approvals: null, usage: null, operations: null, gateway: null, audit: null, devices: null }} />);
    expect(refused.host.querySelector("[data-testid=sidebar-platform-gateway]")).toBeNull();
  });

  it("derives sections from scope: platform has config and the wizard, a tenant has tools and routes", () => {
    expect(gatewayTabs(tenantAccess as never)).toEqual(["stats", "calls", "tools", "routes"]);
    expect(gatewayTabs(platformAccess as never)).toEqual(["stats", "calls", "tools", "config"]);
    expect(gatewayTabs(noAccess as never)).toEqual([]);
  });

  it("says the area is denied instead of rendering empty sections", async () => {
    const { host } = await mount(routes(noAccess));
    expect(host.textContent).toContain("You do not have access to the gateway area");
    expect(host.querySelector("[data-testid=gateway-tab-stats]")).toBeNull();
  });
});

describe("gateway statistics and calls", () => {
  it("renders totals, buckets and rows, and re-reads with the chosen dimension", async () => {
    const { host, send } = await mount(routes(tenantAccess, (request) => request.path.startsWith("/api/v1/gateway/stats")
      ? { status: 200, body: stats(new URLSearchParams(request.path.split("?")[1]).get("dimension") ?? "MODEL_ROUTE") }
      : { status: 503, body: undefined }));
    expect(host.querySelector("[data-testid=gateway-totals]")?.textContent).toContain("Billing unavailable");
    expect(host.querySelector("[data-testid=gateway-totals]")?.textContent).toContain("4,500");
    expect(host.querySelectorAll("[data-testid=gateway-buckets] rect").length).toBeGreaterThanOrEqual(2);
    expect(host.textContent).toContain("Unattributed");
    const select = host.querySelector<HTMLSelectElement>("[data-testid=gateway-stats] select")!;
    expect([...select.options].map((option) => option.value)).toEqual(["MODEL_ROUTE", "TOOL", "AGENT", "BINDING"]);
    await act(async () => {
      select.value = "TOOL";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(send.mock.calls.some(([request]) => (request as BffRequest).path.includes("dimension=TOOL"))).toBe(true);
  });

  it("marks a truncated scan and a missing request log instead of showing zero", async () => {
    const { host } = await mount(routes(tenantAccess, () => ({ status: 200,
      body: stats("MODEL_ROUTE", { truncated: true, modelLogAvailable: false }) })));
    expect(host.textContent).toContain("Only part of the window was scanned");
    expect(host.textContent).toContain("model call counts are missing, not zero");
    const totals = host.querySelector("[data-testid=gateway-totals]")!.textContent ?? "";
    expect(totals).toContain("—");
  });

  it("drills from a row into the filtered calls and one call's audit chain without any body", async () => {
    const detail = { call, execution: { actionExecutionId: call.actionExecutionId, operationId: call.operationId,
      actionKey: "time.convert@v1", actionVersion: 1, gateState: "DENIED", dispatchState: "NOT_DISPATCHED",
      reasonCode: "DELEGATION_REQUIRED", createdAt: "2026-10-21T01:00:00Z" },
      auditEvents: [{ eventId: "44444444-4444-4444-8444-444444444444", eventType: "DECISION", actionKey: "time.convert@v1",
        decision: "DENY", resultCode: "DELEGATION_REQUIRED", occurredAt: "2026-10-21T01:00:01Z" }] };
    const { host, send } = await mount(routes(tenantAccess, (request) => {
      const path = request.path.split("?")[0];
      if (path === "/api/v1/gateway/stats") return { status: 200, body: stats("MODEL_ROUTE") };
      if (path === "/api/v1/gateway/calls") return { status: 200, body: { scope: "TENANT", calls: [call], truncated: false, modelLogAvailable: true } };
      if (path.startsWith("/api/v1/gateway/calls/")) return { status: 200, body: detail };
      return { status: 503, body: undefined };
    }));
    await click(button(host.querySelector("[data-testid=gateway-stats-row]") as HTMLElement, "View calls"));
    const query = send.mock.calls.map(([request]) => (request as BffRequest).path).find((path) => path.startsWith("/api/v1/gateway/calls?"))!;
    expect(new URLSearchParams(query.split("?")[1]).get("key")).toBe("route-1");
    expect(new URLSearchParams(query.split("?")[1]).get("dimension")).toBe("MODEL_ROUTE");
    expect(host.querySelector("[data-testid=gateway-calls-filter]")?.textContent).toContain("chat-route");
    await click(button(host.querySelector("[data-testid=gateway-call-row]") as HTMLElement, "Details"));
    expect(send.mock.calls.some(([request]) => (request as BffRequest).path === `/api/v1/gateway/calls/${encodeURIComponent(call.callId)}`)).toBe(true);
    const shown = host.querySelector("[data-testid=gateway-call-detail]")!;
    expect(shown.querySelector("[data-testid=gateway-call-audit]")?.textContent).toContain("DELEGATION_REQUIRED");
    expect(shown.querySelector("[data-testid=gateway-call-execution]")).not.toBeNull();
    expect(shown.textContent).not.toMatch(/prompt|completion/i);
  });
});

describe("gateway writes only submit existing actions", () => {
  const tool = { resourceId: "55555555-5555-4555-8555-555555555555", resourceVersion: 1, name: "time.convert", source: "APPLICATION",
    resourceState: "ACTIVE", actionKey: "time.convert@v1", capabilityContractKey: "time.convert@v1", contractPermission: "consume",
    applicationBindingId: "66666666-6666-4666-8666-666666666666", applicationBindingVersion: 3, bindingState: "ACTIVE",
    componentTypeKey: "time_server", releaseVersion: "1.0.0", requests: 5, failed: 0, denied: 1, toolP95Ms: 70,
    canDisableBinding: true, canTestCall: true,
    testCall: { actionKey: "time.convert@v1", actionVersion: 1, inputSchemaJson: '{"type":"object","properties":{"time":{"type":"string"}}}',
      resultExposurePolicyId: "77777777-7777-4777-8777-777777777777", resultExposurePolicyVersion: 2,
      targets: [{ resourceId: "88888888-8888-4888-8888-888888888888", resourceVersion: 4, displayName: "clock" }] } };
  const native = { resourceId: "99999999-9999-4999-8999-999999999999", resourceVersion: 1, name: "agent.memory.entry.read",
    source: "PLATFORM_NATIVE", resourceState: "ACTIVE", actionKey: "agent.memory.entry.read", requests: 0, failed: 0, denied: 0,
    canDisableBinding: false, canTestCall: false };
  const toolRoutes = (write: Route) => routes(tenantAccess, (request) => {
    const path = request.path.split("?")[0];
    if (path === "/api/v1/gateway/tools") return { status: 200, body: { from: "x", to: "y", tools: [tool, native] } };
    if (path === "/api/v1/gateway/mcp/releases") return { status: 200, body: { releases: [] } };
    if (path === "/api/v1/gateway/stats") return { status: 200, body: stats("MODEL_ROUTE") };
    if (request.method === "POST" && path === "/api/v1/actions") return write(request);
    return { status: 503, body: undefined };
  });

  it("disables the whole connection and re-checks the same request after an unknown outcome", async () => {
    let writes = 0;
    const { host, send } = await mount(toolRoutes(() => {
      writes++;
      if (writes === 1) throw new TransportError("lost response");
      return { status: 200, body: { actionKey: "application_binding.disable", actionExecutionId: "a1", operationId: "o1",
        gateState: "ALLOWED", dispatchState: "DISPATCHED", workflowId: "w1" } };
    }));
    await click(tab(host, "tools"));
    const rows = host.querySelectorAll<HTMLElement>("[data-testid=gateway-tool-row]");
    expect(rows).toHaveLength(2);
    expect([...rows[1]!.querySelectorAll("button")].map((node) => node.textContent)).toEqual([]);
    await click(button(rows[0]!, "Disable connection"));
    expect(host.textContent).toContain("every tool of the connection");
    await click(button(host, "Submit governed request"));
    expect(button(host, "Re-check same request")).toBeTruthy();
    expect([...host.querySelectorAll("button")].some((node) => node.textContent === "Cancel")).toBe(false);
    await click(button(host, "Re-check same request"));
    const writesSent = posts(send);
    expect(writesSent).toHaveLength(2);
    expect(writesSent[1]).toEqual(writesSent[0]);
    expect(writesSent[0]).toMatchObject({ path: "/api/v1/actions", body: { actionKey: "application_binding.disable",
      explicitConfirmation: true, applicationBindingId: tool.applicationBindingId, applicationBindingVersion: 3 } });
  });

  it("submits a test call as the tool's own registered action with canonical input", async () => {
    const { host, send } = await mount(toolRoutes(() => ({ status: 200, body: { actionKey: "time.convert@v1",
      actionExecutionId: "a2", operationId: "o2", gateState: "ALLOWED", dispatchState: "DISPATCHED" } })));
    await click(tab(host, "tools"));
    await click(button(host.querySelector("[data-testid=gateway-tool-row]") as HTMLElement, "Test call"));
    const input = host.querySelector<HTMLTextAreaElement>("[data-testid=gateway-tool-test] textarea")!;
    await type(input, ' { "time" : "12:00" } ');
    await click(button(host, "Review test call"));
    await click(button(host, "Submit governed request"));
    const [sent] = posts(send);
    expect(sent).toMatchObject({ body: { actionKey: "time.convert@v1", resourceId: tool.testCall.targets[0]!.resourceId, resourceVersion: 4,
      componentAction: { actionVersion: 1, inputJson: '{"time":"12:00"}', resultExposurePolicyId: tool.testCall.resultExposurePolicyId,
        resultExposurePolicyVersion: 2 } } });
    expect(host.querySelector("[data-testid=gateway-tool-test-result]")?.textContent).toContain("a2");
  });

  it("disables a model route through llm_route.disable with its exact version", async () => {
    const route = { resourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", resourceVersion: 7, nativeId: "chat-route", resourceState: "ACTIVE",
      ownerPrincipalId: tenantId, provider: "openai", model: "qwen", installationCount: 2, bindingCount: 1, requests: 9, canDisable: true };
    const { host, send } = await mount(routes(tenantAccess, (request) => {
      const path = request.path.split("?")[0];
      if (path === "/api/v1/gateway/model-routes") return { status: 200, body: { from: "x", to: "y", canCreate: false, routes: [route] } };
      if (path === "/api/v1/gateway/stats") return { status: 200, body: stats("MODEL_ROUTE") };
      if (path === "/api/v1/actions") return { status: 200, body: { actionKey: "llm_route.disable", actionExecutionId: "a3",
        operationId: "o3", gateState: "ALLOWED", dispatchState: "DISPATCHED" } };
      return { status: 503, body: undefined };
    }));
    await click(tab(host, "routes"));
    expect(host.textContent).toContain("2 Agents · 1 connections");
    await click(button(host.querySelector("[data-testid=gateway-route-row]") as HTMLElement, "Disable"));
    expect(host.textContent).toContain("cannot be undone");
    await click(button(host, "Submit governed request"));
    expect(posts(send)[0]).toMatchObject({ body: { actionKey: "llm_route.disable", explicitConfirmation: true,
      resourceId: route.resourceId, resourceVersion: 7 } });
  });
});

describe("MCP server wizard", () => {
  const peer = { adapterServiceRef: "time-mcp", mcpUrl: "http://time-mcp:8000/mcp", nativeInstanceRef: "time-1",
    artifactDigest: `sha256:${"b".repeat(64)}`, timeoutSeconds: 10, maxResponseBytes: 65536, conformanceReady: true, bindingFacts: [] };
  const probe = { probeId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", adapterServiceRef: "time-mcp", probedAt: "2026-10-21T02:00:00Z",
    serverName: "mcp-time", serverVersion: "1.0", protocolVersion: "2025-06-18", toolSchemaDigest: "d".repeat(64),
    tools: [{ name: "convert_time", description: "Convert", inputSchemaJson: '{"type":"object"}', inputSchemaDigest: "e".repeat(64),
      readOnlyHint: true, matchingContracts: [{ categoryKey: "time", contractVersion: 1, contractKey: "time.convert_time@v1", permission: "consume" }] }] };
  const wizardRoutes = (write: Route) => routes(platformAccess, (request) => {
    const path = request.path.split("?")[0];
    if (path === "/api/v1/platform/gateway/mcp/peers") return { status: 200, body: { directoryAvailable: true, peers: [peer] } };
    if (path === "/api/v1/platform/gateway/mcp/probes") return { status: 200, body: probe };
    if (path === "/api/v1/gateway/stats") return { status: 200, body: stats("MODEL_ROUTE", { scope: "PLATFORM" }) };
    if (path === "/api/v1/actions") return write(request);
    return { status: 503, body: undefined };
  });

  it("never probes an endpoint missing from the delivery directory", async () => {
    const { host, send } = await mount(wizardRoutes(() => ({ status: 500, body: undefined })));
    await click(tab(host, "tools"));
    await type(host.querySelector<HTMLInputElement>("[data-testid=gateway-mcp-endpoint] input")!, "http://evil.example/mcp");
    await click(button(host, "Match"));
    expect(host.querySelector("[data-testid=gateway-mcp-unregistered]")?.textContent).toContain("http://evil.example/mcp");
    expect(posts(send)).toHaveLength(0);
    expect(host.querySelector("[data-testid=gateway-mcp-probe]")).toBeNull();
  });

  it("probes a directory peer, registers a PROTOCOL_PEER release and keeps approval WAITING", async () => {
    const { host, send } = await mount(wizardRoutes((request) => {
      const key = (request.body as { actionKey: string }).actionKey;
      return key === "component_release.register"
        ? { status: 200, body: { actionKey: key, actionExecutionId: "r1", operationId: "o1", gateState: "ALLOWED", dispatchState: "DISPATCHED", workflowId: "w1" } }
        : { status: 202, body: { actionKey: key, actionExecutionId: "r2", operationId: "o2", gateState: "WAITING", dispatchState: "NOT_DISPATCHED", approvalWorkflowId: "approval-1" } };
    }));
    await click(tab(host, "tools"));
    await click(button(host.querySelector("[data-testid=gateway-mcp-peer]") as HTMLElement, "Select"));
    await click(button(host, "Probe"));
    expect(posts(send)[0]).toMatchObject({ path: "/api/v1/platform/gateway/mcp/probes", body: { adapterServiceRef: "time-mcp" } });
    expect(host.querySelector("[data-testid=gateway-mcp-probe-result]")?.textContent).toContain("convert_time");
    const release = host.querySelector<HTMLElement>("[data-testid=gateway-mcp-release]")!;
    const [, vendor, version] = release.querySelectorAll<HTMLInputElement>("input");
    await type(vendor!, "modelcontextprotocol"); await type(version!, "2025.1");
    await click(button(release, "Draft release"));
    await settle();
    const manifest = JSON.parse(release.querySelector("textarea")!.value);
    expect(manifest.executionConnector).toEqual({ mode: "PROTOCOL_PEER", adapterProtocolRange: "NONE", actionTokenAudience: "NONE" });
    expect(manifest.adapterBuildRef).toBe(peer.artifactDigest);
    expect(manifest.toolDefinitions[0]).toMatchObject({ name: "convert_time", capabilityContractKey: "time.convert_time@v1" });
    expect(manifest.bindingConfigSchemaDigest).toBe(await canonicalDigest(JSON.parse(release.querySelectorAll("textarea")[2]!.value)));
    await click(button(release, "Review release registration"));
    await click(button(host, "Submit governed request"));
    await click(button(host.querySelector("[data-testid=gateway-mcp-approval]") as HTMLElement, "Request approval"));
    await click(button(host, "Submit governed request"));
    const writes = posts(send).filter((request) => request.path === "/api/v1/actions");
    expect(writes.map((request) => (request.body as { actionKey: string }).actionKey)).toEqual(["component_release.register", "component_release.approve"]);
    expect(writes[1]).toMatchObject({ body: { componentReleaseId: manifest.id } });
    expect(host.querySelector("[data-testid=gateway-mcp-approval-action]")?.textContent).toContain("approval-1");
  });

  it("drafts the delivery entry a tenant connection still needs, without writing", async () => {
    const release = { componentReleaseId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", componentTypeKey: "time_server", version: "1.0.0",
      status: "APPROVED", adapterBuildRef: peer.artifactDigest, adapterServiceRef: "time-mcp", nativeInstanceRef: "time-1",
      capabilityCategories: [{ category: "time", version: 1 }], tools: [{ name: "convert_time", actionKey: "time.convert_time@v1",
        capabilityContractKey: "time.convert_time@v1" }], secretKeys: [], allowedModelCallModes: ["NONE"], deliveryFacts: [], bindingIds: [] };
    const { host, send } = await mount(routes(tenantAccess, (request) => {
      const path = request.path.split("?")[0];
      if (path === "/api/v1/gateway/mcp/releases") return { status: 200, body: { releases: [release] } };
      if (path === "/api/v1/gateway/tools") return { status: 200, body: { from: "x", to: "y", tools: [] } };
      if (path === "/api/v1/gateway/stats") return { status: 200, body: stats("MODEL_ROUTE") };
      if (path === "/api/v1/gateway/mcp/binding-drafts") return { status: 200, body: { bindingId: "b1", servicePrincipalId: "s1",
        configDigest: "f".repeat(64), adapterServiceRef: "time-mcp", directoryEntryJson: '{"bindingId":"b1"}' } };
      return { status: 503, body: undefined };
    }));
    await click(tab(host, "tools"));
    await click(button(host.querySelector("[data-testid=gateway-mcp-release-row]") as HTMLElement, "Draft a directory entry"));
    await type(host.querySelector<HTMLInputElement>("[data-testid=gateway-mcp-draft-fact] input")!, "scope-1");
    await click(button(host.querySelector("[data-testid=gateway-mcp-draft-fact]") as HTMLElement, "Generate entry"));
    expect(host.querySelector("[data-testid=gateway-mcp-draft-entry]")?.textContent).toContain('"bindingId":"b1"');
    const sent = posts(send);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ path: "/api/v1/gateway/mcp/binding-drafts", body: { componentReleaseId: release.componentReleaseId,
      nativeScopeRef: "scope-1", normalizedConfigJson: "{}" } });
  });
});

describe("live configuration", () => {
  it("shows masked values, unrecorded revisions and per-revision diffs with their executions", async () => {
    const { host, send } = await mount(routes(platformAccess, (request) => {
      const path = request.path.split("?")[0];
      if (path === "/api/v1/gateway/stats") return { status: 200, body: stats("MODEL_ROUTE", { scope: "PLATFORM" }) };
      if (path === "/api/v1/platform/gateway/config") return { status: 200, body: { readAt: "2026-10-21T03:00:00Z",
        effectiveConfigJson: '{"llm":{"providers":[{"apiKey":"[REDACTED]"}]}}', resources: [
          { kind: "traffic.route", id: "application-tools/b/1", revision: 2, valueJson: "{}", source: "CORE_RECORDED",
            actionExecutionId: "a1", actionKey: "application_binding.create" },
          { kind: "llm.provider", id: "manual", revision: 5, valueJson: "{}", source: "UNRECORDED" }] } };
      if (path === "/api/v1/platform/gateway/config/history") return { status: 200, body: { kind: "traffic.route",
        id: "application-tools/b/1", currentRevision: 2, currentSource: "CORE_RECORDED", revisions: [
          { revision: 2, recordedAt: "2026-10-21T02:00:00Z", valueJson: '{"a":2}', valueDigest: "1".repeat(64), deleted: false,
            actionExecutionId: "a1", operationId: "o1", actionKey: "application_binding.create",
            changes: [{ path: "/a", change: "CHANGED", beforeJson: "1", afterJson: "2" }] }] } };
      return { status: 503, body: undefined };
    }));
    await click(tab(host, "config"));
    expect(host.querySelector("[data-testid=gateway-config-effective]")?.textContent).toContain("[REDACTED]");
    expect(host.textContent).toContain("1 resources have a current revision without platform write evidence");
    const rows = host.querySelectorAll<HTMLElement>("[data-testid=gateway-config-row]");
    expect(rows[1]?.textContent).toContain("Unrecorded");
    await click(button(rows[0]!, "History"));
    expect(new URLSearchParams(send.mock.calls.map(([request]) => (request as BffRequest).path)
      .find((path) => path.startsWith("/api/v1/platform/gateway/config/history"))!.split("?")[1]).get("id")).toBe("application-tools/b/1");
    expect(host.querySelector("[data-testid=gateway-config-change]")?.textContent).toContain("/a");
    expect(host.querySelector("[data-testid=gateway-config-revision]")?.textContent).toContain("a1");
    expect(posts(send)).toHaveLength(0);
  });
});

describe("gateway drafts", () => {
  it("matches the Core canonical JSON", () => {
    expect(canonicalJson({ b: 2, a: [1, { d: true, c: "x" }] })).toBe('{"a":[1,{"c":"x","d":true}],"b":2}');
  });

  it("keeps every gateway page within the host theme (no inline style or colour literal)", () => {
    const root = resolve(import.meta.dirname, "../src/react");
    for (const name of ["gateway.tsx", "gateway-stats.tsx", "gateway-tools.tsx", "gateway-mcp.tsx", "gateway-routes.tsx",
      "gateway-config.tsx", "gateway-shared.tsx", "gateway-action.tsx", "gateway-entry.tsx"]) {
      const source = readFileSync(join(root, name), "utf8");
      expect(source, name).not.toMatch(/\bstyle=\{|#[0-9a-fA-F]{6}\b|\b(?:rgba?|hsla?|oklch)\(|\bdark:/);
    }
  });
});
