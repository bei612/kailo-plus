// DD-131(1)(6), SF-BUZ-60, V-SCN-180/184: restored Agents page teams over the governed BFF. The fake
// transport asserts the real request paths and command shapes; Core decides admission and outcomes.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionDispatchState,
  ActionGateState,
  ErrorClass,
  ReasonCode,
  type ActionCommand,
  type AgentDefinitionView,
  type AgentTeamView,
} from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { AgentTeamsLibrary } from "../src/react/agent-library/AgentTeamsLibrary";
import { deployTeamToChannel } from "../src/react/agent-library/teamDeploy";
import { loadAgentTeams, resolveTeamMembers, validAgentTeam } from "../src/react/agent-library/teamPersonas";
import { TransportError, type BffReply, type BffRequest } from "../src/transport";
import { click, render, settle, type } from "./render";

const OWNER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const TEAM = "44444444-4444-4444-8444-444444444444";
const WORKSPACE = "55555555-5555-4555-8555-555555555555";
const VERSION_B = "88888888-8888-4888-8888-888888888888";

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

async function mountLibrary(route: (request: BffRequest) => BffReply | undefined, teams: AgentTeamView[] = [team()],
  locale: "en" | "zh-CN" = "en") {
  const fake = transport((request) => {
    if (request.path === "/api/v1/agent-teams") return ok({ teams });
    if (request.path === "/api/v1/agent-definitions") return ok({ definitions: [definition(A, "Scribe"), definition(B, "Critic"), definition(C, "Planner")] });
    return route(request);
  });
  const client = createBffClient({ send: fake.send });
  const host = await render(<PlatformProvider client={client} locale={locale} currentPrincipalId={OWNER}>
    <AgentTeamsLibrary refreshRevision={0} />
  </PlatformProvider>);
  await settle();
  return { host, ...fake };
}

describe("DD-131(1) team directory reads", () => {
  it("reads every page, refuses a duplicate row or a non-advancing cursor", async () => {
    const pages: Record<string, unknown> = { 0: { teams: [team()], nextOffset: 100 }, 100: { teams: [team({ resourceId: C })] } };
    const client = { agentTeams: vi.fn(async (offset?: number) => pages[String(offset ?? 0)] as never) };
    expect((await loadAgentTeams(client)).map((row) => row.resourceId)).toEqual([TEAM, C]);
    await expect(loadAgentTeams({ agentTeams: vi.fn(async () => ({ teams: [team(), team()] }) as never) })).rejects.toBeInstanceOf(TransportError);
    await expect(loadAgentTeams({ agentTeams: vi.fn(async () => ({ teams: [team()], nextOffset: 0 }) as never) })).rejects.toBeInstanceOf(TransportError);
  });

  it("validates the team shape and resolves visible, missing and hidden members without naming hidden ones", () => {
    expect(validAgentTeam(team())).toBe(true);
    expect(validAgentTeam(team({ memberAgentResourceIds: [A, A] }))).toBe(false);
    expect(validAgentTeam(team({ hiddenMemberCount: -1 }))).toBe(false);
    expect(validAgentTeam(team({ catalogShared: undefined as never }))).toBe(false);
    const resolved = resolveTeamMembers(team({ memberAgentResourceIds: [C, A] }), [definition(A, "Scribe")]);
    expect(resolved.resolvedMemberIds).toEqual([A]);
    expect(resolved.missingMemberIds).toEqual([C]);
    expect(resolved.hiddenMemberCount).toBe(1);
  });
});

describe("DD-131(1) Teams section over governed agent_team actions", () => {
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

  it("does not let the owner edit a team whose members are partly hidden (update replaces the member list)", async () => {
    const { host } = await mountLibrary(() => undefined);
    const menu = await openMenu(host.querySelector<HTMLElement>(`[data-testid="team-actions-${TEAM}"]`)!);
    expect(menuItem(menu, "Edit").hasAttribute("data-disabled")).toBe(true);
    expect(menuItem(menu, "Delete").hasAttribute("data-disabled")).toBe(false);
  });

  it("updates a fully visible team with its read version (CAS) and the edited member order", async () => {
    const { host, actions } = await mountLibrary((request) => request.path === "/api/v1/actions" ? ok(receipt(request.body as ActionCommand)) : undefined,
      [team({ hiddenMemberCount: 0 })]);
    await click(menuItem(await openMenu(host.querySelector<HTMLElement>(`[data-testid="team-actions-${TEAM}"]`)!), "Edit"));
    const dialog = document.querySelector<HTMLElement>('[data-testid="team-dialog"]')!;
    await click(dialog.querySelector<HTMLElement>(`[data-testid="team-member-option-${C}"]`)!);
    await click(dialog.querySelector<HTMLElement>('[data-testid="team-dialog-submit"]')!);
    expect(actions()).toEqual([{ actionKey: "agent.team.update", idempotencyKey: actions()[0]!.idempotencyKey, resourceId: TEAM,
      resourceVersion: 3, explicitConfirmation: true,
      agentTeam: { name: "Engineering Squad", description: "Ships", memberAgentResourceIds: [A, B, C] } }]);
  });

  it("offers Edit and Delete only to the team owner, and the catalog switch only to the owner", async () => {
    const { host } = await mountLibrary(() => undefined, [team({ ownerPrincipalId: OTHER })]);
    const menu = await openMenu(host.querySelector<HTMLElement>(`[data-testid="team-actions-${TEAM}"]`)!);
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual(["Deploy to channel", "Duplicate", "Share"]);
    await click(menuItem(menu, "Share"));
    const share = document.querySelector<HTMLElement>('[data-testid="team-share-dialog"]')!;
    expect(share.querySelector<HTMLButtonElement>('[data-testid="team-share-catalog-access"]')!.disabled).toBe(true);
    expect(share.textContent).toContain("Only the owner can change catalog sharing.");
  });

  it("shares to the catalog with the read version and re-reads the team; unknown keeps the same request", async () => {
    let attempt = 0;
    const { host, actions, send } = await mountLibrary((request) => {
      if (request.path === `/api/v1/agent-teams/${TEAM}`) return ok(team({ catalogShared: true, resourceVersion: 3 }));
      if (request.path !== "/api/v1/actions") return undefined;
      attempt += 1;
      if (attempt === 1) throw new TransportError("network");
      return ok(receipt(request.body as ActionCommand));
    });
    await click(menuItem(await openMenu(host.querySelector<HTMLElement>(`[data-testid="team-actions-${TEAM}"]`)!), "Share"));
    await click(document.querySelector<HTMLElement>('[data-testid="team-share-catalog-access"]')!);
    expect(document.querySelector('[data-testid="team-share-recheck"]')).not.toBeNull();
    expect(document.querySelector<HTMLButtonElement>('[data-testid="team-share-catalog-access"]')!.disabled).toBe(true);
    await click(document.querySelector<HTMLElement>('[data-testid="team-share-recheck"]')!);
    const [first, second] = actions();
    expect(first).toEqual({ actionKey: "agent.team.share", idempotencyKey: first!.idempotencyKey, resourceId: TEAM, resourceVersion: 3, explicitConfirmation: true });
    expect(second).toEqual(first);
    expect(send.mock.calls.some(([request]) => request.path === `/api/v1/agent-teams/${TEAM}`)).toBe(true);
  });

  it("renders the Chinese catalog", async () => {
    const { host } = await mountLibrary(() => undefined, [team()], "zh-CN");
    expect(host.textContent).toContain("Agent 团队");
    expect(host.querySelector<HTMLElement>(`[data-testid="team-card-${TEAM}"]`)!.textContent).toContain("Engineering Squad");
  });
});

describe("DD-131(1) deploy to channel", () => {
  it("installs each member's published version separately, reports existing/unavailable members and keeps successes", async () => {
    const fake = transport((request) => {
      if (request.path === `/api/v1/agent-installations?workspaceId=${WORKSPACE}&offset=0`)
        return ok({ installations: [{ workspaceId: WORKSPACE, agentResourceId: A, resourceState: "ACTIVE" }] });
      if (request.path === `/api/v1/agent-definitions/${B}`) return ok(definition(B, "Critic", { currentPublishedVersionAssetId: VERSION_B }));
      if (request.path === `/api/v1/agent-definitions/${C}`) return ok(definition(C, "Planner"));
      if (request.path === `/api/v1/agent-versions/${VERSION_B}`) return ok({ assetId: VERSION_B, state: "PUBLISHED" });
      if (request.path === `/api/v1/agent-installation-candidates?workspaceId=${WORKSPACE}&offset=0`)
        return ok({ workspaceId: WORKSPACE, canCreate: true, candidates: [{ agentResourceId: B, agentVersionAssetId: VERSION_B, assetVersion: 2,
          displayName: "Critic", ordinal: 1, resourceVersion: 1 }] });
      if (request.path === "/api/v1/actions") return ok(receipt(request.body as ActionCommand));
      return undefined;
    });
    const results = await deployTeamToChannel(createBffClient({ send: fake.send }), [
      { resourceId: A, name: "Scribe" }, { resourceId: B, name: "Critic" }, { resourceId: C, name: "Planner" }], WORKSPACE, () => true);
    expect(results.map((result) => result.outcome)).toEqual(["already", "submitted", "unavailable"]);
    expect(fake.actions()).toEqual([{ actionKey: "agent.installation.create", idempotencyKey: fake.actions()[0]!.idempotencyKey,
      workspaceId: WORKSPACE, resourceId: B, resourceVersion: 1, assetId: VERSION_B, assetVersion: 2 }]);
  });

  it("reports a refused member on its own and does not roll back the others", async () => {
    let calls = 0;
    const fake = transport((request) => {
      if (request.path.startsWith("/api/v1/agent-installations?")) return ok({ installations: [] });
      if (request.path.startsWith("/api/v1/agent-definitions/")) {
        const id = request.path.split("/").pop()!;
        return ok(definition(id, id === A ? "Scribe" : "Critic", { currentPublishedVersionAssetId: VERSION_B }));
      }
      if (request.path === `/api/v1/agent-versions/${VERSION_B}`) return ok({ assetId: VERSION_B, state: "PUBLISHED" });
      if (request.path.startsWith("/api/v1/agent-installation-candidates?"))
        return ok({ workspaceId: WORKSPACE, canCreate: true, candidates: [A, B].map((id) => ({ agentResourceId: id, agentVersionAssetId: VERSION_B,
          assetVersion: 2, displayName: id, ordinal: 1, resourceVersion: 1 })) });
      if (request.path === "/api/v1/actions") {
        calls += 1;
        return ok(receipt(request.body as ActionCommand, calls === 1 ? { gateState: ActionGateState.Denied, dispatchState: ActionDispatchState.NotDispatched,
          reason: ReasonCode.PermissionDenied } : {}));
      }
      return undefined;
    });
    const results = await deployTeamToChannel(createBffClient({ send: fake.send }), [
      { resourceId: A, name: "Scribe" }, { resourceId: B, name: "Critic" }], WORKSPACE, () => true);
    expect(results.map((result) => result.outcome)).toEqual(["failed", "submitted"]);
    expect(fake.actions().map((command) => command.resourceId)).toEqual([A, B]);
    expect(new Set(fake.actions().map((command) => command.idempotencyKey)).size).toBe(2);
  });
});
