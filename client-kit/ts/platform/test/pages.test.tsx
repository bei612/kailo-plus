import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ErrorClass, ReasonCode } from "@client-kit/contracts";
import { AgentMemoryEntryPageState, AgentMemoryReadViewState, type AgentMemoryEntryPage, type AgentMemoryReadView } from "@client-kit/contracts";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { AgentDefinitionsPage, AuditPage, DevicesPage, WorkspaceMembersPage } from "../src/react/pages";
import { PlatformProvider } from "../src/react/context";
import { InstallationMemory, validMemoryEntries, validMemoryRead } from "../src/react/memory";
import { LegacySecretRefManagement, RoleManagement, RoleMembers } from "../src/react/roles";
import type { BffReply, BffRequest, BffTransport } from "../src/transport";
import { TransportError } from "../src/transport";
import { button, click, render, settle } from "./render";

type Route = (request: BffRequest) => BffReply | Promise<BffReply>;

function transport(route: Route): BffTransport & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn(async (r: BffRequest) => route(r)) };
}

function mount(t: BffTransport, ui: React.ReactNode, locale: "en" | "zh-CN" = "en") {
  return render(
    <PlatformProvider client={createBffClient(t)} locale={locale}>
      {ui}
    </PlatformProvider>,
  );
}

const key = (pubkey: string, state = "ACTIVE") => ({
  pubkey,
  state,
  createdAt: new Date().toISOString(),
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
  function routes(extra?: (request: BffRequest) => BffReply | undefined) {
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
  async function change(host: HTMLElement, label: string, value: string) {
    const row = [...host.querySelectorAll("label")].find((row) => row.firstChild?.textContent === label);
    const field = row?.querySelector("input,textarea,select");
    if (!field) throw new Error(`Missing real control ${label}`);
    const prototype = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    await act(async () => { setter?.call(field, value);
      field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
    await settle();
  }
  const posts = (t: ReturnType<typeof routes>) => t.send.mock.calls.map(([r]) => r).filter((r) => r.path === "/api/v1/actions");

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
    expect([...action.querySelectorAll("select")].every((field) => field.value === "")).toBe(true);
    await change(action, "Display name", "New governed draft");
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

  it("publishes an immutable exact draft with Explicit Confirmation and no replacement content", async () => {
    const t = routes((r) => r.path === "/api/v1/actions" ? { status: 200, body: submission("agent.version.publish") } : undefined);
    const host = await open(t);
    await click(button(section(host, "agent-version-directory"), "Publish exact draft"));
    const action = section(host, "agent-version-action");
    expect(action.querySelector("fieldset")?.disabled).toBe(true);
    await click(button(action, "Review request"));
    expect(posts(t)).toHaveLength(0);
    expect(action.textContent).toContain(version.configHash);
    expect(action.textContent).toContain("existing installations remain pinned");
    await click(button(action, "Submit governed request"));
    expect(posts(t)[0]?.body).toEqual({ actionKey: "agent.version.publish", idempotencyKey: expect.any(String),
      resourceId: definition.resourceId, resourceVersion: definition.resourceVersion,
      assetId: version.assetId, assetVersion: version.assetVersion, explicitConfirmation: true });
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

  it("installation UNKNOWN freezes the exact published candidate and rejects another operation", async () => {
    let count = 0;
    const t = routes((r) => {
      if (r.path !== "/api/v1/actions") return undefined;
      count += 1;
      return { status: 200, body: count === 1 ? submission("agent.installation.create", "UNKNOWN")
        : { ...submission("agent.installation.create"), operationId: "foreign-operation" } };
    });
    const host = await open(t);
    const action = section(host, "agent-installation-create");
    await change(action, "Definition reference", installation.pinnedVersionAssetId);
    await click(button(action, "Review request"));
    expect(posts(t)).toHaveLength(0);
    await click(button(action, "Submit governed request"));
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
    await click(button(installed, "View delegation grants"));
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
    if (kind === "version") {
      await click(button(section(host, "agent-version-directory"), "Publish exact draft"));
    } else if (kind === "delegation") {
      const installed = section(host, "agent-installations");
      await click(button(installed, "View installation"));
      await click(button(installed, "View delegation grants"));
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
        expect(action.querySelector("[role=alert]")).toBeNull();
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
  it("取 Workspace 后按人列出成员与全部公钥", async () => {
    const t = transport((r) =>
      r.path === "/api/v1/workspaces"
        ? { status: 200, body: [{ id: "w1", name: "Ops", slug: "ops" }] }
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
    expect(host.textContent).toContain("eeeeeeee…eeee · ffffffff…ffff");
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
  const hosts = ["../../../web-client/web", "../../../collaboration/desktop"].map((dir) =>
    readFileSync(join(root, dir, "tailwind.config.js"), "utf8"),
  );
  const semanticColors = [
    "accent", "accent-foreground", "background", "border", "destructive", "destructive-foreground",
    "foreground", "input", "muted", "muted-foreground", "secondary", "secondary-foreground",
    "sidebar-ring", "sidebar-accent", "sidebar-accent-foreground", "sidebar-active", "sidebar-active-foreground",
  ];
  const neutral = new Set(["transparent", "current", "inherit"]);
  const notColor =
    /^(xs|sm|base|lg|xl|[2-9]xl|left|center|right|justify|start|end|[tblrxyse]|\d+|none|solid|dashed|dotted|double|collapse|separate|wrap|nowrap|balance|pretty|ellipsis|clip)$/;
  const colorUtility =
    /\b(bg|text|border|ring|outline|fill|stroke|divide|placeholder|from|via|to|accent|caret|decoration|shadow)-([a-z][a-z0-9-]*)(?:\/\d+)?/g;

  it("uses no own theme, colour literal or dark variant", async () => {
    expect(sources.length).toBeGreaterThan(0);
    // DD-36/53: the only exception is Buzz's native token colour, selected
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
    expect(web).toContain("const { isDark } = useTheme()");
    expect(web).toContain("<SyntaxHighlightedCode");
    expect(web).toContain("shikiTheme={resolveShikiThemeName(isDark ? BUZZ_DARK_THEME_NAME : BUZZ_THEME_NAME)}");
    expect(loader).toContain("if (name === BUZZ_THEME_NAME) return BUZZ_BASE_THEME");
    expect(loader).toContain("if (name === BUZZ_DARK_THEME_NAME) return BUZZ_DARK_BASE_THEME");
    const nativeStyle = styles[0]!;
    let tokenLoop: import("typescript").Node = nativeStyle;
    while (tokenLoop.parent && !ts.isArrowFunction(tokenLoop)) tokenLoop = tokenLoop.parent;
    if (!ts.isArrowFunction(tokenLoop)) throw new Error("Native token style has no token source");
    expect(tokenLoop.parameters.map((parameter) => parameter.name.getText(parsed))).toEqual(["token", "tokenIdx"]);
    expect(tokenLoop.parent.getText(parsed)).toContain("renderedTokens.map(");
    for (const { name, text } of sources) {
      // Remove just the verified JSX attribute, not its function or file.
      const inspected = name === native.name
        ? text.slice(0, nativeStyle.getStart(parsed)) + text.slice(nativeStyle.end)
        : text;
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

  it("uses only semantic colours that both hosts map to their root CSS variables", () => {
    const used = new Set<string>();
    for (const { text } of sources) {
      for (const [, utility, token] of text.matchAll(colorUtility)) {
        if (utility === "outline" && token === "hidden") continue;
        if (utility === "border" && /^[tblrxyse]-\d+$/.test(token!)) continue;
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
        if (!notColor.test(token!) && !neutral.has(token!)) used.add(token!);
      }
    }
    expect([...used].filter((token) => !semanticColors.includes(token))).toEqual([]);
    for (const token of semanticColors) {
      for (const config of hosts) expect(config).toContain(`var(--${token})`);
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
    expect(host.textContent).not.toContain("No definitions visible");
    expect(host.textContent).not.toContain("PERMISSION_DENIED");
    expect(host.textContent).not.toContain("TARGET_NOT_FOUND");

    reply = { status: 200, body: { definitions: [] } };
    await click(button(host, "Try again"));
    expect(host.textContent).toContain("No definitions visible on this page.");
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
    await click(button(host, open));
    expect(host.querySelector("[role=alert]")?.textContent).toContain(label);
    expect(host.textContent).not.toMatch(/result is unknown|结果不明/);
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/agent-definitions/agent-1" });
    expect(t.send.mock.calls.some(([r]) => r.path.startsWith("/api/v1/agent-versions/"))).toBe(false);
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
    const section = host.querySelector("h3")?.parentElement;
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
    const section = host.querySelector("h3")?.parentElement;
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
    const detail = section.querySelector("[data-testid=agent-installation-detail]") as HTMLElement;
    expect(detail.textContent).toContain("Projection pending");
    expect(detail.textContent).toContain("Disabled channel binding");
    expect(detail.textContent).toContain("Mention · Manual assignment");
    expect(detail.textContent).toContain("SERVER_CODEX");
    expect(detail.textContent).toContain("a".repeat(64));
    expect(section.textContent).toContain("do not prove runtime health or authorize an invocation");
    expect(section.textContent).not.toMatch(/private-prompt|private-secret-ref|\/private\/runtime\/root/);
    const controls = [...section.querySelectorAll("button")].map((b) => b.textContent);
    for (const label of ["Install", "Run", "Create session", "Disable"]) {
      expect(controls).not.toContain(label);
    }
    expect(t.send.mock.calls.every(([r]) => r.method === "GET")).toBe(true);
    expect(t.send.mock.calls.some(([r]) => r.path.startsWith("/api/v1/agent-versions/"))).toBe(false);
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/agent-installations?workspaceId=workspace-1&offset=0" });
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/agent-installations/installation-1" });
  });

  it("an authorized empty scan page can continue; it does not assert no installations exist", async () => {
    const t = routes((r) => r.path.endsWith("offset=0")
      ? { status: 200, body: { installations: [], nextOffset: 9 } }
      : { status: 200, body: { installations: [installation] } });
    const host = await mount(t, <AgentDefinitionsPage />);
    await settle();
    const section = host.querySelector("[data-testid=agent-installations]") as HTMLElement;
    expect(section.textContent).toContain("No installations you may read on this page.");
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
    expect(section.textContent).not.toContain("No installations you may read");
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
    expect(section.textContent).not.toContain("No installations you may read");
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
