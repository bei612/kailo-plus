// DD-131(6) "从目录选择": the restored CommunityCatalogDialog over governed BFF reads and the existing
// agent.definition.create → agent.version.create, agent.installation.create and agent.team.create
// actions. The fake transport asserts real request paths and command shapes; Core decides outcomes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionDispatchState,
  ActionGateState,
  ErrorClass,
  ReasonCode,
  type ActionCommand,
  type AgentDefinitionView,
  type AgentTeamView,
  type AgentVersionContent,
} from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { AgentCatalogDialog, type CatalogAvatarHost } from "../src/react/agent-library/AgentCatalogDialog";
import {
  catalogOwnerLabel,
  loadCatalogOwners,
  portableVersionContent,
  suggestedCopySlug,
  teamCopyCommand,
} from "../src/react/agent-library/agentCatalog";
import { TransportError, type BffReply, type BffRequest } from "../src/transport";
import { click, render, settle, until, type } from "./render";

const ME = "00000000-0000-4000-8000-000000000001";
const DANA = "00000000-0000-4000-8000-000000000002";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const TEAM = "44444444-4444-4444-8444-444444444444";
const NEW_DEF = "66666666-6666-4666-8666-666666666666";
const WORKSPACE = "55555555-5555-4555-8555-555555555555";
const EXEC = "99999999-9999-4999-8999-999999999999";
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const definition = (id: string, name: string, extra: Partial<AgentDefinitionView> = {}) => ({
  resourceId: id, displayName: name, stableSlug: name.toLowerCase(), ownerPrincipalId: DANA, resourceVersion: 1,
  resourceState: "ACTIVE", status: "ACTIVE", currentPublishedVersionAssetId: `${id}-v`, ...extra,
}) as AgentDefinitionView;
const team = (extra: Partial<AgentTeamView> = {}) => ({
  resourceId: TEAM, name: "Review Crew", description: "Reviews", memberAgentResourceIds: [A, B], hiddenMemberCount: 1,
  ownerPrincipalId: DANA, resourceVersion: 2, resourceState: "ACTIVE", catalogShared: true, ...extra,
}) as AgentTeamView;
const content = (): AgentVersionContent => ({
  personaIdentity: { displayName: "Scout", description: "Finds things" },
  instructions: "Exact *instructions* [link](https://x)",
  runtimeProfileKey: "profile", modelRouteResourceId: "route", replyPolicy: "MENTION_ONLY",
  parallelism: 2, turnLimits: { idleTimeoutSeconds: 60, maxTurnDurationSeconds: 600 },
  memoryPolicy: { coreWrite: "OWNER_ONLY", coldWrite: "OFF" },
  capabilityRequirements: ["chat"], triggerDefaults: ["mention"], skillVersionAssetIds: ["skill-v"], declaredToolResourceIds: ["tool"],
}) as unknown as AgentVersionContent;
const version = (id: string) => ({
  assetId: `${id}-v`, agentResourceId: id, ordinal: 1, assetVersion: 3, ownerPrincipalId: DANA, content: content(),
  configHash: "b".repeat(64), state: "PUBLISHED",
});
const receipt = (command: ActionCommand, extra: Record<string, unknown> = {}) => ({
  actionKey: command.actionKey, actionExecutionId: EXEC, operationId: OP,
  gateState: ActionGateState.Allowed, dispatchState: ActionDispatchState.Dispatched, ...extra,
});
const ok = (body: unknown): BffReply => ({ status: 200, body });
const notFound: BffReply = { status: 404, body: { class: ErrorClass.Precondition, reason: ReasonCode.TargetNotFound } };

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

function catalogRoute(definitions: AgentDefinitionView[], teams: AgentTeamView[]) {
  return (request: BffRequest): BffReply | undefined => {
    if (request.path === "/api/v1/agent-definitions") return ok({ definitions });
    if (request.path === "/api/v1/agent-teams") return ok({ teams });
    if (request.path.startsWith("/api/v1/agent-catalog/owners?ids=")) {
      const ids = decodeURIComponent(request.path.split("ids=")[1] ?? "").split(",");
      return ok({ owners: ids.map((id) => ({ resourceId: id, ownerPrincipalId: DANA, ownerDisplayName: "Dana" })) });
    }
    for (const row of definitions) {
      if (request.path === `/api/v1/agent-definitions/${row.resourceId}`) return ok(row);
      if (request.path === `/api/v1/agent-versions/${row.resourceId}-v`) return ok(version(row.resourceId));
    }
    if (request.path === "/api/v1/workspaces") return ok([{ id: WORKSPACE, name: "general", isMember: true }]);
    return undefined;
  };
}

async function mount(route: (request: BffRequest) => BffReply | undefined | Promise<BffReply | undefined>,
  definitions = [definition(A, "Scout"), definition(B, "Critic", { ownerPrincipalId: ME })], teams = [team()],
  locale: "en" | "zh-CN" = "en", preferSection: "agents" | "teams" = "agents", avatarHost?: CatalogAvatarHost) {
  const base = catalogRoute(definitions, teams);
  const send = vi.fn(async (request: BffRequest) => (await route(request)) ?? base(request) ?? notFound);
  const client = createBffClient({ send });
  const onRecorded = vi.fn();
  await render(<PlatformProvider client={client} locale={locale} currentPrincipalId={ME}>
    <AgentCatalogDialog open preferSection={preferSection} onOpenChange={() => undefined} onRecorded={onRecorded} avatarHost={avatarHost} />
  </PlatformProvider>);
  await until(() => !!document.querySelector('[data-testid="agent-catalog-dialog"]')
    && !document.querySelector('[data-testid="agent-catalog-loading"]'), "catalog directory");
  await settle();
  const actions = () => send.mock.calls.map(([request]) => request).filter((request) => request.path === "/api/v1/actions")
    .map((request) => request.body as ActionCommand);
  const dialog = document.querySelector<HTMLElement>('[data-testid="agent-catalog-dialog"]')!;
  return { send, actions, dialog, onRecorded };
}

describe("DD-131(6) catalog helpers", () => {
  it("reads owner names in bounded pages and refuses rows it did not ask for", async () => {
    const agentCatalogOwners = vi.fn(async (ids: readonly string[]) => ({ owners: ids.map((id) => ({ resourceId: id, ownerPrincipalId: DANA, ownerDisplayName: " Dana " })) }));
    const owners = await loadCatalogOwners({ agentCatalogOwners } as never, [A, B, A], 1);
    expect(agentCatalogOwners).toHaveBeenCalledTimes(2);
    expect(owners.get(A)).toEqual({ principalId: DANA, displayName: "Dana" });
    await expect(loadCatalogOwners({ agentCatalogOwners: vi.fn(async () => ({ owners: [{ resourceId: TEAM, ownerPrincipalId: DANA }] })) } as never, [A]))
      .rejects.toBeInstanceOf(TransportError);
  });

  it("labels you, a named owner, or owner unavailable — never another Principal's name", () => {
    const owners = new Map([[A, { principalId: DANA, displayName: "Dana" }], [B, { principalId: ME }]]);
    expect(catalogOwnerLabel({ resourceId: A, ownerPrincipalId: DANA }, owners, ME)).toEqual({ kind: "name", name: "Dana" });
    expect(catalogOwnerLabel({ resourceId: B, ownerPrincipalId: ME }, owners, ME)).toEqual({ kind: "you" });
    expect(catalogOwnerLabel({ resourceId: A, ownerPrincipalId: ME }, owners, undefined)).toEqual({ kind: "unavailable" });
  });

  it("copies only portable fields; route, runtime profile and tools stay with the source owner", () => {
    const copy = portableVersionContent(content());
    expect(copy).not.toHaveProperty("runtimeProfileKey");
    expect(copy).not.toHaveProperty("modelRouteResourceId");
    expect(copy.declaredToolResourceIds).toEqual([]);
    expect(copy.instructions).toBe(content().instructions);
    expect(copy.skillVersionAssetIds).toEqual(["skill-v"]);
    expect(suggestedCopySlug("scout", new Set(["scout-copy", "scout-copy-2"]))).toBe("scout-copy-3");
    expect(teamCopyCommand(team(), "  Mine ")).toEqual({ actionKey: "agent.team.create", explicitConfirmation: true,
      agentTeam: { name: "Mine", description: "Reviews", memberAgentResourceIds: [A, B] } });
  });
});

describe("DD-131(6) catalog dialog", () => {
  it("shows each entry's published persona avatar through the host's media view, else initials", async () => {
    const avatarUrl = `https://relay.test/media/${"c".repeat(64)}.png`;
    const rewriteMediaUrl = vi.fn((url: string) => url === avatarUrl ? `/api/v1/profile/media/${"c".repeat(64)}` : url);
    const avatarHost = vi.fn((_version?: unknown) => ({ locale: "en" as const, rewriteMediaUrl,
      uploadMediaBytes: vi.fn(), performDefaultHaptic: vi.fn() }));
    const withAvatar = () => ({ ...version(A), content: { ...content(), personaIdentity: { displayName: "Scout", avatarUrl } } });
    const { dialog } = await mount((request) => request.path === `/api/v1/agent-versions/${A}-v` ? ok(withAvatar()) : undefined,
      undefined, undefined, "en", "agents", avatarHost as unknown as CatalogAvatarHost);
    await settle();
    // List row and detail header both use the exact published Version's avatar.
    expect(dialog.querySelectorAll(`[data-testid="agent-catalog-avatar-${A}"]`).length).toBe(2);
    expect(rewriteMediaUrl).toHaveBeenCalledWith(avatarUrl);
    expect(avatarHost).toHaveBeenCalledWith(expect.objectContaining({ assetId: `${A}-v`, agentResourceId: A }));
    // No avatar on the published Version: the original initials stay.
    expect(dialog.querySelector(`[data-testid="agent-catalog-avatar-${B}"]`)).toBeNull();
    expect(dialog.querySelector(`[data-testid="agent-catalog-agent-${B}"]`)!.textContent).toContain("C");
  });

  it("keeps initials without a host media view", async () => {
    const { dialog } = await mount(() => undefined);
    expect(dialog.querySelector(`[data-testid="agent-catalog-avatar-${A}"]`)).toBeNull();
  });

  it("lists agents and teams with Added by, and shows the exact instructions (en and zh-CN)", async () => {
    const { dialog } = await mount(() => undefined);
    expect(dialog.querySelector(`[data-testid="agent-catalog-agent-${A}"]`)!.getAttribute("aria-current")).toBe("true");
    expect(dialog.querySelector(`[data-testid="agent-catalog-team-${TEAM}"]`)!.textContent).toContain("3");
    expect(dialog.querySelector('[data-testid="agent-catalog-owner"]')!.textContent).toBe("Added by Dana");
    expect(dialog.querySelector('[data-testid="agent-catalog-instructions"]')!.textContent).toBe("Exact *instructions* [link](https://x)");
    await click(dialog.querySelector<HTMLElement>(`[data-testid="agent-catalog-agent-${B}"]`)!);
    expect(dialog.querySelector('[data-testid="agent-catalog-owner"]')!.textContent).toBe("Added by you");
    expect(dialog.querySelector('[data-testid="agent-catalog-copy-submit"]')!.textContent).toBe("Already yours");
  });

  it("speaks Chinese with the same owner facts", async () => {
    const { dialog } = await mount(() => undefined, undefined, undefined, "zh-CN");
    expect(dialog.querySelector('[data-testid="agent-catalog-owner"]')!.textContent).toBe("由 Dana 添加");
    expect(dialog.querySelector('[data-testid="agent-catalog-copy-submit"]')!.textContent).toBe("添加 Agent");
  });

  it("copies as my own Definition: create, wait for its task, then a DRAFT version with portable fields", async () => {
    const { actions, dialog, onRecorded } = await mount((request) => {
      if (request.path === "/api/v1/actions") return ok(receipt(request.body as ActionCommand));
      if (request.path === `/api/v1/tasks/${EXEC}`) return ok({ operationId: OP, actionExecutionId: EXEC, actionKey: "agent.definition.create",
        actionVersion: 1, targetId: NEW_DEF, gateState: ActionGateState.Allowed, dispatchState: ActionDispatchState.Dispatched,
        taskStatus: "COMPLETED", createdAt: "2026-10-23T00:00:00Z" });
      if (request.path === `/api/v1/agent-definitions/${NEW_DEF}`) return ok(definition(NEW_DEF, "Scout", { ownerPrincipalId: ME, resourceVersion: 4, currentPublishedVersionAssetId: undefined }));
      return undefined;
    });
    const slug = dialog.querySelector<HTMLInputElement>('[data-testid="agent-catalog-copy-slug"]')!;
    expect(slug.value).toBe("scout-copy");
    await type(slug, "my-scout");
    await click(dialog.querySelector<HTMLElement>('[data-testid="agent-catalog-copy-submit"]')!);
    // 复制要等新 Definition 落定（轮询带计时器）后再提交版本：按完成标记等待。
    await until(() => !!dialog.querySelector('[data-testid="agent-catalog-copy-done"]'), "copy completion");
    const [create, versionCreate] = actions();
    expect(create).toMatchObject({ actionKey: "agent.definition.create", name: "Scout", slug: "my-scout" });
    expect(versionCreate).toMatchObject({ actionKey: "agent.version.create", resourceId: NEW_DEF, resourceVersion: 4 });
    expect(versionCreate!.agentVersionContent).not.toHaveProperty("modelRouteResourceId");
    expect(versionCreate!.agentVersionContent!.declaredToolResourceIds).toEqual([]);
    expect(create!.idempotencyKey).not.toBe(versionCreate!.idempotencyKey);
    expect(dialog.querySelector('[data-testid="agent-catalog-copy-done"]')).not.toBeNull();
    expect(onRecorded).toHaveBeenCalled();
  });

  it("keeps an unknown create outcome as the same request and never sends a second definition", async () => {
    let first = true;
    const { actions, dialog } = await mount((request) => {
      if (request.path !== "/api/v1/actions") return undefined;
      const command = request.body as ActionCommand;
      if (first) { first = false; return ok(receipt(command, { dispatchState: ActionDispatchState.Unknown })); }
      return ok(receipt(command, { gateState: ActionGateState.Denied, reason: ReasonCode.InvalidParameters, dispatchState: ActionDispatchState.NotDispatched }));
    });
    await click(dialog.querySelector<HTMLElement>('[data-testid="agent-catalog-copy-submit"]')!);
    await until(() => dialog.querySelector('[data-testid="agent-catalog-copy-submit"]')?.textContent === "Re-check same request", "unknown outcome");
    const retry = dialog.querySelector<HTMLElement>('[data-testid="agent-catalog-copy-submit"]')!;
    expect(retry.textContent).toBe("Re-check same request");
    expect(dialog.querySelector<HTMLInputElement>('[data-testid="agent-catalog-copy-slug"]')!.disabled).toBe(true);
    await click(retry);
    await until(() => actions().length === 2, "re-check of the same request");
    const [one, two] = actions();
    expect(two!.idempotencyKey).toBe(one!.idempotencyKey);
    expect(actions().every((command) => command.actionKey === "agent.definition.create")).toBe(true);
  });

  it("installs the current published version in a channel with the existing governed install", async () => {
    const { actions, dialog } = await mount((request) => {
      if (request.path === "/api/v1/actions") return ok(receipt(request.body as ActionCommand));
      if (request.path.startsWith("/api/v1/agent-installations?")) return ok({ installations: [] });
      if (request.path.startsWith("/api/v1/agent-installation-candidates?")) return ok({ workspaceId: WORKSPACE, canCreate: true,
        candidates: [{ agentResourceId: A, agentVersionAssetId: `${A}-v`, displayName: "Scout", resourceVersion: 1, assetVersion: 3, ordinal: 1 }] });
      return undefined;
    });
    await click(dialog.querySelector<HTMLElement>('[data-testid="agent-catalog-install-submit"]')!);
    await until(() => !!dialog.querySelector('[data-testid="agent-catalog-install-result"]'), "install result");
    expect(actions()).toEqual([expect.objectContaining({ actionKey: "agent.installation.create", workspaceId: WORKSPACE,
      resourceId: A, assetId: `${A}-v`, assetVersion: 3 })]);
    expect(dialog.querySelector('[data-testid="agent-catalog-install-result"]')!.textContent).toContain("Install requested");
  });

  it("copies a team as my own team referring to the visible Definitions only", async () => {
    const { actions, dialog } = await mount((request) => request.path === "/api/v1/actions" ? ok(receipt(request.body as ActionCommand)) : undefined,
      undefined, undefined, "en", "teams");
    expect(dialog.querySelector(`[data-testid="agent-catalog-team-${TEAM}"]`)!.getAttribute("aria-current")).toBe("true");
    expect(dialog.textContent).toContain("1 member is not visible to you");
    await type(dialog.querySelector<HTMLInputElement>('[data-testid="agent-catalog-team-copy-name"]')!, "My crew");
    await click(dialog.querySelector<HTMLElement>('[data-testid="agent-catalog-add-team"]')!);
    await until(() => (dialog.textContent ?? "").includes("Team added."), "team copy result");
    expect(actions()).toEqual([expect.objectContaining({ actionKey: "agent.team.create", explicitConfirmation: true,
      agentTeam: { name: "My crew", description: "Reviews", memberAgentResourceIds: [A, B] } })]);
    expect(dialog.textContent).toContain(`Team added. Operation: ${OP}.`);
  });
});
