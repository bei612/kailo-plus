// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/channels/ui/AddChannelBotTeamsSection.tsx:
// the channel's add-agent dialog lists the caller's teams; choosing one deploys every member to this
// channel with one governed agent.installation.create each (DD-131(1)), the channel fixed.
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
import { ChannelTeamsSection } from "../src/react/agent-library/ChannelTeamsSection";
import type { BffReply, BffRequest } from "../src/transport";
import { click, render, until } from "./render";

const OWNER = "00000000-0000-4000-8000-000000000001";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const TEAM = "44444444-4444-4444-8444-444444444444";
const WORKSPACE = "55555555-5555-4555-8555-555555555555";
const OTHER_WORKSPACE = "66666666-6666-4666-8666-666666666666";
const VERSION = "88888888-8888-4888-8888-888888888888";

const definition = (id: string, name: string) => ({
  resourceId: id, displayName: name, stableSlug: name.toLowerCase(), ownerPrincipalId: OWNER, resourceVersion: 1,
  resourceState: "ACTIVE", status: "ACTIVE", currentPublishedVersionAssetId: VERSION,
}) as AgentDefinitionView;
const team = {
  resourceId: TEAM, name: "Engineering Squad", description: "Ships", memberAgentResourceIds: [A, B], hiddenMemberCount: 0,
  ownerPrincipalId: OWNER, resourceVersion: 3, resourceState: "ACTIVE", catalogShared: false,
} as AgentTeamView;
const ok = (body: unknown): BffReply => ({ status: 200, body });
const notFound: BffReply = { status: 404, body: { class: ErrorClass.Precondition, reason: ReasonCode.TargetNotFound } };

function transport(teams: AgentTeamView[]) {
  const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
    if (request.path === "/api/v1/agent-teams") return ok({ teams });
    if (request.path === "/api/v1/agent-definitions") return ok({ definitions: [definition(A, "Scribe"), definition(B, "Critic")] });
    if (request.path === "/api/v1/workspaces") return ok([
      { id: OTHER_WORKSPACE, name: "elsewhere", isMember: true },
      { id: WORKSPACE, name: "release", isMember: true },
    ]);
    if (request.path.startsWith("/api/v1/agent-installations?")) return ok({ installations: [] });
    if (request.path.startsWith("/api/v1/agent-definitions/")) {
      const id = request.path.split("/").pop()!;
      return ok(definition(id, id === A ? "Scribe" : "Critic"));
    }
    if (request.path === `/api/v1/agent-versions/${VERSION}`) return ok({ assetId: VERSION, state: "PUBLISHED" });
    if (request.path.startsWith("/api/v1/agent-installation-candidates?"))
      return ok({ workspaceId: WORKSPACE, canCreate: true, candidates: [A, B].map((id) => ({ agentResourceId: id, agentVersionAssetId: VERSION,
        assetVersion: 2, displayName: id, ordinal: 1, resourceVersion: 1 })) });
    if (request.path === "/api/v1/actions") {
      const command = request.body as ActionCommand;
      return ok({ actionKey: command.actionKey, actionExecutionId: "99999999-9999-4999-8999-999999999999",
        operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", gateState: ActionGateState.Allowed, dispatchState: ActionDispatchState.Dispatched });
    }
    return notFound;
  });
  const actions = () => send.mock.calls.map(([request]) => request).filter((request) => request.path === "/api/v1/actions")
    .map((request) => request.body as ActionCommand);
  return { send, actions };
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

describe("channel add-agent Teams section", () => {
  it("is absent without teams, like the original", async () => {
    const fake = transport([]);
    const host = await render(<PlatformProvider client={createBffClient({ send: fake.send })} locale="en">
      <ChannelTeamsSection workspaceId={WORKSPACE} />
    </PlatformProvider>);
    await until(() => fake.send.mock.calls.some(([request]) => request.path === "/api/v1/agent-definitions"), "directory read");
    await until(() => true, "settle");
    expect(host.querySelector('[data-testid="channel-teams-section"]')).toBeNull();
  });

  it("deploys every member of the chosen team to this channel only, one governed install each", async () => {
    const fake = transport([team]);
    const onDeployed = vi.fn();
    await render(<PlatformProvider client={createBffClient({ send: fake.send })} locale="en">
      <ChannelTeamsSection workspaceId={WORKSPACE} onDeployed={onDeployed} />
    </PlatformProvider>);
    await until(() => !!document.querySelector(`[data-testid="channel-team-${TEAM}"]`), "team chip");
    const chip = document.querySelector<HTMLButtonElement>(`[data-testid="channel-team-${TEAM}"]`)!;
    expect(chip.textContent).toContain("Engineering Squad");
    expect(chip.textContent).toContain("Agents (2)");
    await click(chip);
    await until(() => !!document.querySelector<HTMLSelectElement>("#team-channel-id")?.value, "channel preselected");
    const select = document.querySelector<HTMLSelectElement>("#team-channel-id")!;
    expect(select.disabled).toBe(true);
    expect([...select.options].map((option) => option.value)).toEqual([WORKSPACE]);
    await click(document.querySelector<HTMLButtonElement>('[data-testid="team-deploy-confirm"]')!);
    await until(() => onDeployed.mock.calls.length === 1, "deploy finished");
    expect(fake.actions().map((command) => [command.actionKey, command.workspaceId, command.resourceId])).toEqual([
      ["agent.installation.create", WORKSPACE, A], ["agent.installation.create", WORKSPACE, B]]);
    expect(new Set(fake.actions().map((command) => command.idempotencyKey)).size).toBe(2);
  });

  it("speaks Chinese", async () => {
    const fake = transport([team]);
    await render(<PlatformProvider client={createBffClient({ send: fake.send })} locale="zh-CN">
      <ChannelTeamsSection workspaceId={WORKSPACE} />
    </PlatformProvider>);
    await until(() => !!document.querySelector('[data-testid="channel-teams-section"]'), "section");
    expect(document.querySelector('[data-testid="channel-teams-section"]')!.textContent).toContain("团队");
  });
});
