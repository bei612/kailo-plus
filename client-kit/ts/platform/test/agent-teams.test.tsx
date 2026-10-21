// DD-131(1)-(9), SF-BUZ-60, V-SCN-180..185: restored Agents page teams, snapshot export/import,
// catalog and sharing over the governed BFF. The fake transport asserts the real request paths and
// command shapes; Core decides admission, approval and every outcome.
import { webcrypto } from "node:crypto";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionDispatchState,
  ActionGateState,
  AgentSnapshotDiscardedField,
  AgentSnapshotEncoding,
  AgentSnapshotKind,
  ErrorClass,
  ExportPackageState,
  ReasonCode,
  type ActionCommand,
  type AgentDefinitionView,
  type AgentSnapshotUploadView,
  type AgentTeamView,
  type AgentVersionView,
  type ExportPackageView,
} from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { createInvokeTransport, decodeBytesReply } from "../src/native";
import { PlatformProvider } from "../src/react/context";
import { AgentTeamsLibrary } from "../src/react/agent-library/AgentTeamsLibrary";
import { AgentSnapshotExportDialog } from "../src/react/agent-library/AgentSnapshotExportDialog";
import { AgentSnapshotImportDialog } from "../src/react/agent-library/AgentSnapshotImportDialog";
import { CommunityCatalogDialog } from "../src/react/agent-library/CommunityCatalogDialog";
import { copyCatalogDefinition, copyTeamCommand } from "../src/react/agent-library/catalogCopy";
import { deployTeamToChannel } from "../src/react/agent-library/teamDeploy";
import { observeExport } from "../src/react/agent-library/snapshotFlow";
import { buildTeamMentionCandidates, formatTeamMention } from "../src/react/composer/features/messages/lib/teamMentionCandidates";
import { resolveSnapshotCard } from "../src/react/messages/resolveFileCard";
import { AgentSnapshotCard } from "../src/react/messages/AgentSnapshotCard";
import { consumePendingSnapshotImport } from "../src/react/open-snapshot-import-event";
import type { AgentSnapshotHost } from "../src/react/agent-library/agentSnapshotHost";
import { BffError, TransportError, type BffBytesRequest, type BffReply, type BffRequest } from "../src/transport";
import { click, render, settle, type } from "./render";

const OWNER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const TEAM = "44444444-4444-4444-8444-444444444444";
const WORKSPACE = "55555555-5555-4555-8555-555555555555";
const ROUTE = "66666666-6666-4666-8666-666666666666";
const UPLOAD = "77777777-7777-4777-8777-777777777777";
const VERSION_A = "88888888-8888-4888-8888-888888888888";
const DIGEST = "d".repeat(64);

const definition = (id: string, name: string, extra: Partial<AgentDefinitionView> = {}) => ({
  resourceId: id, displayName: name, stableSlug: name.toLowerCase(), ownerPrincipalId: OWNER, resourceVersion: 1,
  resourceState: "ACTIVE", status: "ACTIVE", ...extra,
}) as AgentDefinitionView;
const team = (extra: Partial<AgentTeamView> = {}) => ({
  resourceId: TEAM, name: "Engineering Squad", description: "Ships", memberAgentResourceIds: [A, B], hiddenMemberCount: 1,
  ownerPrincipalId: OWNER, resourceVersion: 3, resourceState: "ACTIVE", catalogShared: false, ...extra,
}) as AgentTeamView;
const receipt = (command: ActionCommand, extra: Record<string, unknown> = {}) => ({
  actionKey: command.actionKey, actionExecutionId: "99999999-9999-4999-8999-999999999999",
  operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", gateState: ActionGateState.Allowed,
  dispatchState: ActionDispatchState.Dispatched, ...extra,
});
const ok = (body: unknown): BffReply => ({ status: 200, body });
const notFound: BffReply = { status: 404, body: { class: ErrorClass.Precondition, reason: ReasonCode.TargetNotFound } };
const noHost: AgentSnapshotHost = { saveExportPackage: vi.fn(async () => true), sendAttachment: vi.fn(async () => undefined) };

function transport(route: (request: BffRequest) => BffReply | undefined | Promise<BffReply | undefined>) {
  const send = vi.fn(async (request: BffRequest) => (await route(request)) ?? notFound);
  const actions = () => send.mock.calls.map(([request]) => request).filter((request) => request.path === "/api/v1/actions")
    .map((request) => request.body as ActionCommand);
  return { send, actions };
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

async function openMenu(trigger: HTMLElement) {
  await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await settle();
  return document.querySelector<HTMLElement>('[role="menu"]')!;
}
function menuItem(menu: HTMLElement, label: string) {
  return [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((node) => node.textContent === label)!;
}

describe("DD-131 snapshot package bytes over the BFF client", () => {
  it("stages an upload with the original file name header and reads the package content", async () => {
    const exchangeBytes = vi.fn(async (request: BffBytesRequest) => request.method === "POST"
      ? { status: 200, contentType: "application/json", bytes: new TextEncoder().encode(JSON.stringify({ uploadId: UPLOAD })) }
      : { status: 200, contentType: "image/png", bytes: new Uint8Array([1, 2, 3]) });
    const client = createBffClient({ send: vi.fn(), exchangeBytes });
    expect(client.supportsSnapshotBytes).toBe(true);
    const upload = await client.uploadAgentSnapshot(new Uint8Array([9]), "Scribé.agent.png", "image/png");
    expect(upload.uploadId).toBe(UPLOAD);
    expect(exchangeBytes.mock.calls[0]![0]).toEqual({ method: "POST", path: "/api/v1/agent-snapshots/uploads", body: new Uint8Array([9]),
      contentType: "image/png", headers: { "X-Snapshot-Filename": "Scrib_.agent.png" } });
    expect([...await client.exportPackageContent(UPLOAD)]).toEqual([1, 2, 3]);
    expect(exchangeBytes.mock.calls[1]![0]).toEqual({ method: "GET", path: `/api/v1/export-packages/${UPLOAD}/content` });
  });

  it("surfaces the shared rejection body (413 PAYLOAD_TOO_LARGE) and refuses without a binary seam", async () => {
    const body = new TextEncoder().encode(JSON.stringify({ class: ErrorClass.Limit, reason: ReasonCode.PayloadTooLarge }));
    const client = createBffClient({ send: vi.fn(), exchangeBytes: vi.fn(async () => ({ status: 413, bytes: body })) });
    const error = await client.uploadAgentSnapshot(new Uint8Array([1]), "big.agent.json", "application/json").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BffError);
    expect((error as BffError).status).toBe(413);
    expect((error as BffError).reason).toBe(ReasonCode.PayloadTooLarge);
    const plain = createBffClient({ send: vi.fn() });
    expect(plain.supportsSnapshotBytes).toBe(false);
    await expect(plain.exportPackageContent(UPLOAD)).rejects.toBeInstanceOf(TransportError);
  });

  it("sends native bytes through platform_api_bytes and decodes its status/content-type frame", async () => {
    const frame = new Uint8Array([0, 200, 0, 9, ...new TextEncoder().encode("image/png"), 7, 8]);
    const invoke = vi.fn(async () => frame.buffer);
    const native = createInvokeTransport(invoke, { onSessionEnded: vi.fn() });
    const reply = await native.exchangeBytes!({ method: "POST", path: "/api/v1/agent-snapshots/uploads", body: new Uint8Array([5]),
      contentType: "image/png", headers: { "X-Snapshot-Filename": "a.agent.png" } });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("platform_api_bytes", { method: "POST", path: "/api/v1/agent-snapshots/uploads",
      body: [5], contentType: "image/png", snapshotFilename: "a.agent.png" });
    expect(reply).toEqual({ status: 200, contentType: "image/png", bytes: new Uint8Array([7, 8]) });
    expect(() => decodeBytesReply(new Uint8Array([0, 200, 0, 9]).buffer)).toThrow(TransportError);
  });
});

describe("DD-131(1) Teams section over governed agent_team actions", () => {
  async function mountLibrary(route: (request: BffRequest) => BffReply | undefined) {
    const fake = transport((request) => {
      if (request.path === "/api/v1/agent-teams") return ok({ teams: [team()] });
      if (request.path === "/api/v1/agent-definitions") return ok({ definitions: [definition(A, "Scribe"), definition(B, "Critic"), definition(C, "Planner")] });
      return route(request);
    });
    const client = createBffClient({ send: fake.send });
    const host = await render(<PlatformProvider client={client} locale="en" currentPrincipalId={OWNER}>
      <AgentTeamsLibrary host={noHost} refreshRevision={0} onDirectoryChanged={vi.fn()} onCreateAgent={vi.fn()}
        shareDefinition={null} onShareDefinitionChange={vi.fn()} />
    </PlatformProvider>);
    await settle();
    return { host, ...fake };
  }

  it("lists visible members with the hidden count and creates an ordered team without team instructions", async () => {
    const { host, send, actions } = await mountLibrary((request) => request.path === "/api/v1/actions" ? ok(receipt(request.body as ActionCommand)) : undefined);
    const card = host.querySelector<HTMLElement>(`[data-testid="team-card-${TEAM}"]`)!;
    expect(card.textContent).toContain("Engineering Squad");
    expect(card.textContent).toContain("3 agents");
    expect(card.textContent).toContain("1 member is not visible to you");
    await click(menuItem(await openMenu(host.querySelector<HTMLElement>('[data-testid="new-team-card"]')!), "Create team"));
    const dialog = document.querySelector<HTMLElement>('[data-testid="team-dialog"]')!;
    expect(dialog.textContent).not.toContain("Team Instructions");
    await type(dialog.querySelector<HTMLInputElement>("#team-name")!, "QA crew");
    await click(dialog.querySelector<HTMLElement>(`[data-testid="team-member-option-${C}"]`)!);
    await click(dialog.querySelector<HTMLElement>(`[data-testid="team-member-option-${A}"]`)!);
    const reads = send.mock.calls.filter(([request]) => request.path === "/api/v1/agent-teams").length;
    await click(dialog.querySelector<HTMLElement>('[data-testid="team-dialog-submit"]')!);
    expect(actions()).toEqual([{ actionKey: "agent.team.create", idempotencyKey: actions()[0]!.idempotencyKey, explicitConfirmation: true,
      agentTeam: { name: "QA crew", memberAgentResourceIds: [C, A] } }]);
    expect(document.querySelector('[data-testid="team-dialog"]')).toBeNull();
    expect(host.textContent).toContain('Created team "QA crew".');
    expect(send.mock.calls.filter(([request]) => request.path === "/api/v1/agent-teams").length).toBeGreaterThan(reads);
  });

  it("keeps an unknown delete on the same request and re-checks it with the same key", async () => {
    let attempt = 0;
    const { host, actions } = await mountLibrary((request) => {
      if (request.path !== "/api/v1/actions") return undefined;
      attempt += 1;
      if (attempt === 1) throw new TransportError("network");
      return ok(receipt(request.body as ActionCommand));
    });
    await click(menuItem(await openMenu(host.querySelector<HTMLElement>(`[data-testid="team-actions-${TEAM}"]`)!), "Delete"));
    await click(document.querySelector<HTMLElement>('[data-testid="team-delete-confirm"]')!);
    const confirm = document.querySelector<HTMLButtonElement>('[data-testid="team-delete-confirm"]')!;
    expect(confirm.textContent).toBe("Re-check same request");
    await click(confirm);
    const [first, second] = actions();
    expect(first).toEqual({ actionKey: "agent.team.delete", idempotencyKey: first!.idempotencyKey, resourceId: TEAM, resourceVersion: 3, explicitConfirmation: true });
    expect(second).toEqual(first);
    expect(document.querySelector('[data-testid="team-delete-dialog"]')).toBeNull();
  });

  it("offers Edit and Delete only to the team owner", async () => {
    const fake = transport((request) => request.path === "/api/v1/agent-teams" ? ok({ teams: [team({ ownerPrincipalId: OTHER })] })
      : request.path === "/api/v1/agent-definitions" ? ok({ definitions: [definition(A, "Scribe"), definition(B, "Critic")] }) : undefined);
    const host = await render(<PlatformProvider client={createBffClient({ send: fake.send })} locale="en" currentPrincipalId={OWNER}>
      <AgentTeamsLibrary host={noHost} refreshRevision={0} onDirectoryChanged={vi.fn()} onCreateAgent={vi.fn()}
        shareDefinition={null} onShareDefinitionChange={vi.fn()} />
    </PlatformProvider>);
    await settle();
    const menu = await openMenu(host.querySelector<HTMLElement>(`[data-testid="team-actions-${TEAM}"]`)!);
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual(["Deploy to channel", "Duplicate", "Share"]);
  });
});

describe("DD-131(1) deploy to channel and @team", () => {
  it("installs each member's published version separately, reports existing/unavailable members and keeps successes", async () => {
    const fake = transport((request) => {
      if (request.path === `/api/v1/agent-installations?workspaceId=${WORKSPACE}&offset=0`)
        return ok({ installations: [{ workspaceId: WORKSPACE, agentResourceId: A, resourceState: "ACTIVE" }] });
      if (request.path === `/api/v1/agent-definitions/${B}`) return ok(definition(B, "Critic", { currentPublishedVersionAssetId: VERSION_A }));
      if (request.path === `/api/v1/agent-definitions/${C}`) return ok(definition(C, "Planner"));
      if (request.path === `/api/v1/agent-versions/${VERSION_A}`) return ok({ assetId: VERSION_A, state: "PUBLISHED" });
      if (request.path === `/api/v1/agent-installation-candidates?workspaceId=${WORKSPACE}&offset=0`)
        return ok({ workspaceId: WORKSPACE, canCreate: true, candidates: [{ agentResourceId: B, agentVersionAssetId: VERSION_A, assetVersion: 2,
          displayName: "Critic", ordinal: 1, resourceVersion: 1 }] });
      if (request.path === "/api/v1/actions") return ok(receipt(request.body as ActionCommand));
      return undefined;
    });
    const results = await deployTeamToChannel(createBffClient({ send: fake.send }), [
      { resourceId: A, name: "Scribe" }, { resourceId: B, name: "Critic" }, { resourceId: C, name: "Planner" }], WORKSPACE, () => true);
    expect(results.map((result) => result.outcome)).toEqual(["already", "submitted", "unavailable"]);
    expect(fake.actions()).toEqual([{ actionKey: "agent.installation.create", idempotencyKey: fake.actions()[0]!.idempotencyKey,
      workspaceId: WORKSPACE, resourceId: B, resourceVersion: 1, assetId: VERSION_A, assetVersion: 2 }]);
  });

  it("expands @team only to members installed in this channel and omits teams with none", () => {
    const agents = [
      { pubkey: "a".repeat(64), displayName: "Scribe", installation: { agentResourceId: A } },
      { pubkey: "b".repeat(64), displayName: "Scribe", installation: { agentResourceId: B } },
    ] as Parameters<typeof buildTeamMentionCandidates>[1];
    const rows = buildTeamMentionCandidates([team({ memberAgentResourceIds: [B, C, A] }), team({ resourceId: OTHER, name: "Empty", memberAgentResourceIds: [C] })], agents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "team", teamId: TEAM, displayName: "Engineering Squad", isAgent: false });
    expect(rows[0]!.teamMembers!.map((member) => member.pubkey)).toEqual(["b".repeat(64), "a".repeat(64)]);
    expect(rows[0]!.pubkey).not.toMatch(/^[0-9a-f]{64}$/);
    expect(formatTeamMention("Engineering Squad", [{ displayName: "Scribe" }, { displayName: "Scribe (2)" }])).toBe("Engineering Squad(@Scribe @Scribe (2)) ");
  });
});

describe("DD-131(2)(4)(8) governed export, approval and download", () => {
  const pkg = (state = ExportPackageState.Ready) => ({ assetId: "99999999-9999-4999-8999-999999999999", sourceResourceId: A, formatKey: "buzz-agent-snapshot",
    formatVersion: 1, encoding: AgentSnapshotEncoding.Json, contentDigest: DIGEST, byteSize: 3, mediaType: "application/json",
    fileName: "scribe.agent.json", state }) as ExportPackageView;

  it("submits agent.definition.export for the published version and shows the owner's own approval while waiting", async () => {
    const fake = transport((request) => {
      if (request.path === "/api/v1/actions") return ok(receipt(request.body as ActionCommand, { gateState: ActionGateState.Waiting,
        dispatchState: ActionDispatchState.NotDispatched, approvalWorkflowId: "wf-1" }));
      if (request.path === "/api/v1/tasks/99999999-9999-4999-8999-999999999999") return ok({ actionExecutionId: "99999999-9999-4999-8999-999999999999",
        operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", actionKey: "agent.definition.export", actionVersion: 1, createdAt: "2026-10-21T00:00:00Z",
        gateState: ActionGateState.Waiting, dispatchState: ActionDispatchState.NotDispatched, targetId: A, approvalWorkflowId: "wf-1" });
      return undefined;
    });
    const onSaveFile = vi.fn(async () => true);
    await render(<PlatformProvider client={createBffClient({ send: fake.send })} locale="en" currentPrincipalId={OWNER}>
      <AgentSnapshotExportDialog definition={definition(A, "Scribe", { currentPublishedVersionAssetId: VERSION_A })} agentName="Scribe" open
        onOpenChange={vi.fn()} onSaveFile={onSaveFile} />
    </PlatformProvider>);
    const dialog = document.querySelector<HTMLElement>('[data-testid="agent-snapshot-export-dialog"]')!;
    expect(dialog.textContent).not.toContain("Memories");
    await click(dialog.querySelector<HTMLElement>('[data-testid="agent-snapshot-export-confirm"]')!);
    await settle();
    expect(fake.actions()).toEqual([{ actionKey: "agent.definition.export", idempotencyKey: fake.actions()[0]!.idempotencyKey,
      resourceId: A, resourceVersion: 1, assetId: VERSION_A, snapshotExport: { encoding: AgentSnapshotEncoding.Png } }]);
    expect(document.querySelector('[data-testid="agent-snapshot-approval"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="agent-snapshot-progress"]')!.textContent).toContain("Approve this export to continue");
    expect(onSaveFile).not.toHaveBeenCalled();
  });

  it("saves the READY package once with the chosen JSON encoding", async () => {
    const fake = transport((request) => {
      if (request.path === "/api/v1/actions") return ok(receipt(request.body as ActionCommand));
      if (request.path === "/api/v1/export-packages/99999999-9999-4999-8999-999999999999") return ok(pkg());
      return undefined;
    });
    const onSaveFile = vi.fn(async () => true);
    await render(<PlatformProvider client={createBffClient({ send: fake.send })} locale="en" currentPrincipalId={OWNER}>
      <AgentSnapshotExportDialog definition={definition(A, "Scribe", { currentPublishedVersionAssetId: VERSION_A })} agentName="Scribe" open
        onOpenChange={vi.fn()} onSaveFile={onSaveFile} />
    </PlatformProvider>);
    await click(menuItem(await openMenu(document.querySelector<HTMLElement>('[data-testid="agent-snapshot-format-trigger"]')!), "JSON"));
    await click(document.querySelector<HTMLElement>('[data-testid="agent-snapshot-export-confirm"]')!);
    await settle();
    expect(fake.actions()[0]!.snapshotExport).toEqual({ encoding: AgentSnapshotEncoding.Json });
    expect(onSaveFile).toHaveBeenCalledExactlyOnceWith(pkg());
    expect(document.querySelector('[data-testid="agent-snapshot-export-dialog"]')!.textContent).toContain("Saved.");
  });

  it("ends observation on a refused task without re-submitting", async () => {
    const client = createBffClient({ send: vi.fn(async (request: BffRequest): Promise<BffReply> => request.path.startsWith("/api/v1/export-packages/") ? notFound
      : ok({ actionExecutionId: "e", operationId: "o", actionKey: "agent.team.export", actionVersion: 1, createdAt: "x", targetId: TEAM,
        gateState: ActionGateState.Denied, dispatchState: ActionDispatchState.NotDispatched, reason: ReasonCode.PermissionDenied })) });
    const error = await observeExport(client, receipt({ actionKey: "agent.team.export", idempotencyKey: "k" }, { actionExecutionId: "e", operationId: "o" }) as never)
      .catch((e: unknown) => e);
    expect((error as { reason?: ReasonCode }).reason).toBe(ReasonCode.PermissionDenied);
  });
});

describe("DD-131(2)(5) upload preview and governed import", () => {
  const preview = {
    uploadId: UPLOAD, contentDigest: DIGEST, byteSize: 42, encoding: AgentSnapshotEncoding.Png, snapshotKind: AgentSnapshotKind.Agent,
    expiresAt: "2999-01-01T00:00:00Z", members: [{ displayName: "Scribe", instructions: "Write release notes.", parallelism: 2,
      discardedFields: [AgentSnapshotDiscardedField.RespondToAllowlist, AgentSnapshotDiscardedField.Memory, AgentSnapshotDiscardedField.Runtime] }],
  } as AgentSnapshotUploadView;

  it("shows discarded fields, requires this Tenant's runtime choice and submits agent.definition.import", async () => {
    const fake = transport((request) => {
      if (request.path === "/api/v1/agent-definitions") return ok({ definitions: [definition(A, "Scribe")] });
      if (request.path === `/api/v1/agent-definitions/${A}/version-configuration?offset=0`) return ok({ agentResourceId: A, resourceVersion: 1,
        canCreate: true, nextOffset: null, profiles: [{ key: "codex", kind: "SERVER_CODEX", status: "ACTIVE", webAvailability: "ENABLED",
          capabilityContract: { capabilityRequirements: [], maxIdleTimeoutSeconds: 60, maxParallelism: 4, maxTurnDurationSeconds: 600, replyPolicies: ["thread"] } }],
        routes: [{ resourceId: ROUTE, resourceVersion: 1, ownerPrincipalId: OWNER, homeWorkspaceId: null, nativeConfigResourceId: ROUTE,
          nativeRevision: 1, nativeConfigHash: "c".repeat(64) }] });
      if (request.path === "/api/v1/actions") return ok(receipt(request.body as ActionCommand, { dispatchState: ActionDispatchState.Dispatched }));
      return undefined;
    });
    const onImported = vi.fn();
    await render(<PlatformProvider client={createBffClient({ send: fake.send })} locale="en" currentPrincipalId={OWNER}>
      <AgentSnapshotImportDialog open preview={preview} onOpenChange={vi.fn()} onImported={onImported} />
    </PlatformProvider>);
    await settle();
    const dialog = document.querySelector<HTMLElement>('[data-testid="agent-snapshot-import-dialog"]')!;
    expect(dialog.querySelector('[data-testid="agent-snapshot-import-system-prompt"]')!.textContent).toBe("Write release notes.");
    expect([...dialog.querySelectorAll('[data-testid="agent-snapshot-import-discarded"] li')].map((item) => item.getAttribute("data-field")))
      .toEqual(["RESPOND_TO_ALLOWLIST", "MEMORY", "RUNTIME"]);
    const confirm = dialog.querySelector<HTMLButtonElement>('[data-testid="agent-snapshot-import-confirm"]')!;
    expect(confirm.disabled).toBe(true);
    await click(menuItem(await openMenu(dialog.querySelector<HTMLElement>("#agent-snapshot-import-runtime-profile")!), "codex"));
    await click([...(await openMenu(dialog.querySelector<HTMLElement>("#agent-snapshot-import-model-route")!)).querySelectorAll<HTMLElement>('[role="menuitemradio"]')][0]!);
    expect(confirm.disabled).toBe(false);
    await click(confirm);
    expect(fake.actions()).toEqual([{ actionKey: "agent.definition.import", idempotencyKey: fake.actions()[0]!.idempotencyKey, explicitConfirmation: true,
      snapshotImport: { uploadId: UPLOAD, contentDigest: DIGEST, runtimeProfileKey: "codex", modelRouteResourceId: ROUTE } }]);
    expect(onImported).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-testid="agent-snapshot-import-result"]')).not.toBeNull();
  });
});

describe("DD-131(6) catalog install and copy paths", () => {
  it("lists only shared items and copies a shared team as the person's own team", async () => {
    const fake = transport((request) => request.path === "/api/v1/actions" ? ok(receipt(request.body as ActionCommand)) : undefined);
    await render(<PlatformProvider client={createBffClient({ send: fake.send })} locale="en" currentPrincipalId={OWNER}>
      <CommunityCatalogDialog open preferSection="teams" onOpenChange={vi.fn()} onCreateAgent={vi.fn()} onImportFile={null} onChanged={vi.fn()}
        definitions={[definition(A, "Scribe", { catalogShared: true, ownerPrincipalId: OTHER }), definition(B, "Critic")]} definitionsError={null} definitionsLoading={false}
        teams={[team({ catalogShared: true, ownerPrincipalId: OTHER })]} teamsError={null} teamsLoading={false} />
    </PlatformProvider>);
    await settle();
    expect(document.querySelector(`[data-testid="community-catalog-agent-${A}"]`)).not.toBeNull();
    expect(document.querySelector(`[data-testid="community-catalog-agent-${B}"]`)).toBeNull();
    expect(document.querySelector('[data-testid="agent-catalog-import"]')).toBeNull();
    await click(document.querySelector<HTMLElement>('[data-testid="community-catalog-add-team"]')!);
    expect(fake.actions()).toEqual([{ ...copyTeamCommand({ name: "Engineering Squad", description: "Ships", memberAgentResourceIds: [A, B] }),
      idempotencyKey: fake.actions()[0]!.idempotencyKey }]);
    expect(document.querySelector<HTMLButtonElement>('[data-testid="community-catalog-add-team"]')!.textContent).toBe("Added to my teams");
  });

  it("copies a shared definition as a new Definition plus a DRAFT version with portable fields only", async () => {
    const commands: ActionCommand[] = [];
    const created = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const client = {
      submitAction: async (command: ActionCommand) => { commands.push(command); return receipt(command, { actionExecutionId: `x-${commands.length}` }); },
      task: async (id: string) => ({ actionExecutionId: id, targetId: created }),
      agentDefinition: async (id: string) => definition(id, "Scribe copy", { resourceVersion: 4 }),
    } as unknown as Parameters<typeof copyCatalogDefinition>[0];
    const source = { assetId: VERSION_A, content: { personaIdentity: { displayName: "Scribe", description: "Notes" }, instructions: "Write.",
      runtimeProfileKey: "theirs", modelRouteResourceId: "their-route", replyPolicy: "thread", parallelism: 2,
      turnLimits: { idleTimeoutSeconds: 30, maxTurnDurationSeconds: 300 }, memoryPolicy: { coreWrite: "HUMAN_ONLY", coldWrite: "DISABLED" },
      capabilityRequirements: [], triggerDefaults: ["MENTION"], skillVersionAssetIds: ["skill"], declaredToolResourceIds: ["tool"] } } as unknown as AgentVersionView;
    const profile = { key: "codex", contract: { capabilityRequirements: [], maxIdleTimeoutSeconds: 60, maxParallelism: 4, maxTurnDurationSeconds: 600, replyPolicies: ["thread"] } };
    const result = await copyCatalogDefinition(client, source, { name: "Scribe copy", slug: "scribe-copy", profile, routeId: ROUTE },
      { isCurrent: () => true, sleep: async () => undefined });
    expect(result.outcome).toBe("copied");
    expect(commands[0]).toEqual({ actionKey: "agent.definition.create", idempotencyKey: commands[0]!.idempotencyKey, name: "Scribe copy", slug: "scribe-copy" });
    expect(commands[1]).toMatchObject({ actionKey: "agent.version.create", resourceId: created, resourceVersion: 4 });
    expect(commands[1]!.agentVersionContent).toMatchObject({ runtimeProfileKey: "codex", modelRouteResourceId: ROUTE, instructions: "Write.",
      skillVersionAssetIds: [], declaredToolResourceIds: [], triggerDefaults: ["MENTION"] });
    expect(commands[0]!.idempotencyKey).not.toBe(commands[1]!.idempotencyKey);
  });
});

describe("DD-131(5)(7) snapshot attachment card", () => {
  beforeEach(() => vi.stubGlobal("crypto", webcrypto));

  it("classifies the original snapshot names and needs the imeta digest", () => {
    const x = "e".repeat(64);
    expect(resolveSnapshotCard({ m: "application/json", x, size: 3, filename: "scribe.agent.json" }, "/media/a", "Scribe"))
      .toMatchObject({ snapshotKind: "agent", displayName: "Scribe", isAgentPng: false, filename: "scribe.agent.json" });
    expect(resolveSnapshotCard({ m: "image/png", x, filename: "eng-squad.team.png" }, "/media/a", "eng-squad.team.png")).toMatchObject({ snapshotKind: "team", displayName: "Eng Squad" });
    expect(resolveSnapshotCard({ m: "image/jpeg", x, filename: "a.agent.png" }, "/media/a", "")).toBeNull();
    expect(resolveSnapshotCard({ m: "application/json", filename: "a.agent.json" }, "/media/a", "")).toBeNull();
    expect(resolveSnapshotCard({ m: "application/json", x, filename: "a.persona.json" }, "/media/a", "")).toBeNull();
  });

  it("verifies size and digest before asking the Agents page to import", async () => {
    const bytes = new TextEncoder().encode("{}");
    const digest = [...new Uint8Array(await webcrypto.subtle.digest("SHA-256", bytes))].map((v) => v.toString(16).padStart(2, "0")).join("");
    const host = await render(<PlatformProvider client={createBffClient({ send: vi.fn() })} locale="en">
      <AgentSnapshotCard displayName="Scribe" filename="scribe.agent.json" size={2} sha256={digest} snapshotKind="agent"
        fetchBytes={async () => bytes} onDownload={async () => undefined} />
      <div data-testid="bad"><AgentSnapshotCard displayName="Bad" filename="bad.agent.json" size={2} sha256={"0".repeat(64)} snapshotKind="agent"
        fetchBytes={async () => bytes} onDownload={async () => undefined} /></div>
    </PlatformProvider>);
    await click(host.querySelector<HTMLElement>('[data-testid="bad"] [data-testid="agent-snapshot-card-import"]')!);
    expect(host.querySelector('[data-testid="bad"] [data-testid="agent-snapshot-card-error"]')).not.toBeNull();
    expect(consumePendingSnapshotImport()).toBeNull();
    await click(host.querySelector<HTMLElement>('[data-testid="agent-snapshot-card-import"]')!);
    expect(consumePendingSnapshotImport()).toEqual({ fileBytes: bytes, fileName: "scribe.agent.json", snapshotKind: "agent" });
  });
});
