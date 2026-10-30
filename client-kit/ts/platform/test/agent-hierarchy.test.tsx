// DD-168: owners are people (display names, chosen from members), and the Agents page
// separates design (definitions) from running agents (workspace installations).
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { AgentDefinitionsPage } from "../src/react/agents";
import { PlatformProvider } from "../src/react/context";
import { loadTenantPeople } from "../src/react/tenant-people";
import type { BffReply, BffRequest } from "../src/transport";
import { button, click, render, settle } from "./render";

const pubkey = "a".repeat(64);
const definition = { resourceId: "definition", displayName: "Writing assistant", stableSlug: "writing",
  ownerPrincipalId: "owner-1", resourceVersion: 3, resourceState: "ACTIVE", status: "ACTIVE", currentPublishedVersionAssetId: "published" };
const draftOnly = { ...definition, resourceId: "draft-only", displayName: "Draft only", currentPublishedVersionAssetId: undefined };
const content = { personaIdentity: { displayName: "Writing assistant", description: "Drafts announcements" },
  instructions: "Write well", runtimeProfileKey: "runtime-profile", modelRouteResourceId: "route", replyPolicy: "THREAD",
  skillVersionAssetIds: [], declaredToolResourceIds: [], capabilityRequirements: [], triggerDefaults: ["MENTION"], parallelism: 2,
  turnLimits: { idleTimeoutSeconds: 30, maxTurnDurationSeconds: 90 }, memoryPolicy: { coreWrite: "HUMAN_ONLY", coldWrite: "DISABLED" } };
const version = { assetId: "published", agentResourceId: definition.resourceId, ownerPrincipalId: "owner-1", assetVersion: 4, ordinal: 5,
  state: "PUBLISHED", configHash: "b".repeat(64), content };
const installation = { resourceId: "installation", workspaceId: "workspace", agentResourceId: definition.resourceId,
  pinnedVersionAssetId: "published", agentPrincipalId: "agent-principal", agentPrincipalState: "ACTIVE", agentPubkey: pubkey,
  ownerPrincipalId: "owner-2", resourceVersion: 1, resourceState: "ACTIVE", state: "ACTIVE", activeProjectionGeneration: 1,
  projection: { generation: 1, agentVersionAssetId: "published", runtimeProfileKey: "runtime-profile", configHash: "c".repeat(64), state: "ACTIVE" } };
const people = [
  { principalId: "owner-1", displayName: "Lin Wei", pubkeys: [pubkey] },
  { principalId: "owner-2", displayName: "Zhao Min", pubkeys: ["d".repeat(64)] },
  { principalId: "owner-3", displayName: "An Qi", pubkeys: ["e".repeat(64)] },
];

function fixture(extra?: (request: BffRequest) => BffReply | undefined) {
  const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
    const override = extra?.(request);
    if (override) return override;
    if (request.path === "/api/v1/agent-definitions") return { status: 200, body: { definitions: [definition, draftOnly] } };
    if (request.path === "/api/v1/agent-definitions/definition") return { status: 200, body: definition };
    if (request.path === "/api/v1/agent-versions/published") return { status: 200, body: version };
    if (request.path === "/api/v1/workspaces") return { status: 200, body: [{ id: "workspace", name: "Release", slug: "release" }] };
    if (request.path.startsWith("/api/v1/agent-installations?")) return { status: 200, body: { installations: [installation] } };
    if (request.path === "/api/v1/conversation-participants") return { status: 200, body: { items: people, maxParticipants: 8 } };
    if (request.path === "/api/v1/tasks") return { status: 200, body: [] };
    if (request.method === "POST" && request.path === "/api/v1/actions") return { status: 202, body: {
      actionKey: "resource.transfer_owner", actionExecutionId: "ae-1", operationId: "op-1",
      gateState: "WAITING", dispatchState: "NOT_DISPATCHED", approvalWorkflowId: "approval-1" } };
    return { status: 403, body: {} };
  });
  return { send, client: createBffClient({ send }) };
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

describe("Agents page design and running areas (DD-168(7))", () => {
  it("titles the two areas differently and shows each in its own form", async () => {
    const f = fixture();
    await render(<PlatformProvider client={f.client} locale="en"><AgentDefinitionsPage /></PlatformProvider>);
    await settle();
    expect(document.querySelector('[data-testid="agents-design-heading"] h2')?.textContent).toBe("Agent design");
    const running = document.querySelector<HTMLElement>('[data-testid="agent-installations"]')!;
    expect(running.querySelector("h2")?.textContent).toBe("Running agents");
    const definitionCard = document.querySelector<HTMLElement>('[data-testid="agent-definition-definition"]')!;
    expect(definitionCard.className).toContain("aspect-[4/5]");
    expect(definitionCard.textContent).toContain("Published · v5");
    expect(document.querySelector('[data-testid="agent-definition-draft-only"]')?.textContent).toContain("Not published");
    const row = running.querySelector<HTMLElement>('[data-testid="agent-installation-installation"]')!;
    expect(row.className).not.toContain("aspect-[4/5]");
    expect(row.textContent).toContain("Running");
    expect(row.textContent).toContain("Version 5");
    expect(row.textContent).toContain("Installed by Zhao Min");
    expect(row.textContent).not.toContain("owner-2");
  });
});

describe("owners are people (DD-168(1)(2))", () => {
  it("shows the definition and version owner by display name, never the Principal ID", async () => {
    const f = fixture();
    await render(<PlatformProvider client={f.client} locale="en"><AgentDefinitionsPage /></PlatformProvider>);
    await settle();
    await click(document.querySelector<HTMLButtonElement>('[data-testid="agent-definition-definition"] button')!);
    const detail = document.querySelector<HTMLElement>('[data-testid="agent-definition-detail"]')!;
    expect(detail.textContent).toContain("Owner: Lin Wei");
    expect(detail.textContent).not.toContain("owner-1");
  });

  it("marks an owner who is no longer an active member instead of showing an ID", async () => {
    const f = fixture((request) => request.path === "/api/v1/conversation-participants"
      ? { status: 200, body: { items: people.slice(1), maxParticipants: 8 } } : undefined);
    await render(<PlatformProvider client={f.client} locale="en"><AgentDefinitionsPage /></PlatformProvider>);
    await settle();
    await click(document.querySelector<HTMLButtonElement>('[data-testid="agent-definition-definition"] button')!);
    const detail = document.querySelector<HTMLElement>('[data-testid="agent-definition-detail"]')!;
    expect(detail.textContent).toContain("Owner: No longer in this organization");
  });

  it("transfers ownership only to a chosen active member, previews names and points to Kailo approvals", async () => {
    const f = fixture();
    const open = vi.fn();
    await render(<PlatformProvider client={f.client} locale="en"><AgentDefinitionsPage onOpenSection={open} /></PlatformProvider>);
    await settle();
    await click(document.querySelector<HTMLButtonElement>('[data-testid="agent-definition-definition"] button')!);
    await click(button(document.querySelector<HTMLElement>('[data-testid="agent-definition-detail"]')!, "Transfer ownership"));
    const editor = document.querySelector<HTMLElement>('[data-testid="agent-owner-transfer"]')!;
    expect(editor.querySelector("input")).toBeNull();
    expect(editor.textContent).toContain("Current owner: Lin Wei");
    const trigger = editor.querySelector<HTMLButtonElement>("button")!;
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await settle();
    const options = [...document.querySelectorAll<HTMLElement>("[role=menuitemradio]")];
    expect(options.map((option) => option.textContent)).toEqual(["An Qi", "Zhao Min"]);
    await click(options.find((option) => option.textContent === "Zhao Min")!);
    await click(button(document.querySelector<HTMLElement>('[data-testid="agent-definition-editor"]')!, "Review request"));
    const editorText = document.querySelector<HTMLElement>('[data-testid="agent-definition-editor"]')!.textContent;
    expect(editorText).toContain('Transfer "Writing assistant" (resource version 3) from Lin Wei to Zhao Min.');
    await click(button(document.querySelector<HTMLElement>('[data-testid="agent-definition-editor"]')!, "Submit governed request"));
    const post = f.send.mock.calls.map(([request]) => request).find((request) => request.method === "POST");
    expect(post?.body).toMatchObject({ actionKey: "resource.transfer_owner", resourceId: "definition", resourceVersion: 3, principalId: "owner-2" });
    await click(button(document.querySelector<HTMLElement>('[data-testid="agent-definition-next"]')!, "Go to Approvals"));
    expect(open).toHaveBeenCalledWith("approvals");
  });
});

describe("tenant member directory", () => {
  it("reads every page and fails closed on a repeated cursor", async () => {
    const pages = vi.fn(async (cursor?: string) => cursor === undefined
      ? { items: people.slice(0, 1), maxParticipants: 8, nextCursor: "c1" }
      : { items: people.slice(1), maxParticipants: 8 });
    expect((await loadTenantPeople({ conversationParticipants: pages })).map((person) => person.displayName))
      .toEqual(["Lin Wei", "Zhao Min", "An Qi"]);
    const looping = vi.fn(async () => ({ items: people, maxParticipants: 8, nextCursor: "same" }));
    await expect(loadTenantPeople({ conversationParticipants: looping })).rejects.toThrow();
  });
});
