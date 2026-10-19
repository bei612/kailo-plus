// DD-125(6) / V-SCN-144: the original Stop / Start agent / Restart agent entries submit exactly the
// governed Installation commands; an UNKNOWN outcome keeps the identical command and key.
import type { ActionCommand, AgentInstallationView } from "@client-kit/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { AgentLifecycleSection } from "../src/react/agent-activity/AgentLifecycleControls";
import { disableCommand, enableCommand, lifecycleOffer, restartCommand } from "../src/react/agent-activity/agentLifecycle";
import type { BffReply, BffRequest } from "../src/transport";
import { click, render, settle } from "./render";

afterEach(() => { vi.restoreAllMocks(); });

const base = {
  resourceId: "inst", workspaceId: "ws", agentResourceId: "def", pinnedVersionAssetId: "ver",
  agentPrincipalId: "agent", ownerPrincipalId: "me", resourceVersion: 4, resourceState: "ACTIVE",
  state: "ACTIVE", agentPrincipalState: "ACTIVE", agentPubkey: "a".repeat(64), agentDisplayName: "Scout",
} as AgentInstallationView;
const running = { ...base, canDisable: true, canRestart: true, canUpgrade: true } as AgentInstallationView;
const stopped = { ...base, state: "DISABLED", resourceVersion: 5, canEnable: true } as AgentInstallationView;
const version = { assetId: "ver", agentResourceId: "def", ordinal: 2, assetVersion: 3, ownerPrincipalId: "me",
  content: { personaIdentity: { displayName: "Scout" } }, configHash: "0".repeat(64), state: "PUBLISHED" };
const receipt = (command: ActionCommand, dispatchState = "DISPATCHED") => ({ operationId: "op-1", actionExecutionId: "ae-1",
  actionKey: command.actionKey, gateState: "ALLOWED", dispatchState });

describe("lifecycle command builders", () => {
  it("disable and enable carry only resourceId, resourceVersion and explicit confirmation", () => {
    expect(disableCommand(running, "k1")).toEqual({ actionKey: "agent.installation.disable", idempotencyKey: "k1",
      resourceId: "inst", resourceVersion: 4, explicitConfirmation: true });
    expect(enableCommand(stopped, "k2")).toEqual({ actionKey: "agent.installation.enable", idempotencyKey: "k2",
      resourceId: "inst", resourceVersion: 5, explicitConfirmation: true });
  });

  it("restart is a same-version upgrade of the freshly read pinned Version", async () => {
    const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
      if (request.path === "/api/v1/agent-installations/inst") return { status: 200, body: running };
      if (request.path === "/api/v1/agent-versions/ver") return { status: 200, body: version };
      return { status: 404, body: {} };
    });
    const command = await restartCommand(createBffClient({ send }), running, "k3");
    expect(command).toEqual({ actionKey: "agent.installation.upgrade", idempotencyKey: "k3", workspaceId: "ws",
      resourceId: "inst", resourceVersion: 4, assetId: "ver", assetVersion: 3 });
  });

  it("offers follow the BFF hints and the Installation state only", () => {
    expect(lifecycleOffer(running)).toEqual({ stop: true, start: false, restart: true });
    expect(lifecycleOffer(stopped)).toEqual({ stop: false, start: true, restart: false });
    expect(lifecycleOffer(base)).toEqual({ stop: false, start: false, restart: false });
  });
});

describe("AgentLifecycleSection", () => {
  async function mount(row: AgentInstallationView, dispatchState = "DISPATCHED") {
    const commands: ActionCommand[] = [];
    const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
      if (request.method === "POST" && request.path === "/api/v1/actions") {
        const command = request.body as ActionCommand;
        commands.push(command);
        return { status: 200, body: receipt(command, dispatchState) };
      }
      return { status: 404, body: {} };
    });
    const recorded = vi.fn();
    const host = await render(<PlatformProvider locale="en" client={createBffClient({ send })} currentPrincipalId="me">
      <AgentLifecycleSection installation={row} name="Scout" onRecorded={recorded} />
    </PlatformProvider>);
    await settle();
    return { host, commands, recorded };
  }

  it("shows the original Stop and Restart agent for a running Agent and confirms before disabling", async () => {
    const { host, commands, recorded } = await mount(running);
    expect(host.textContent).toContain("Running");
    expect(host.querySelector('[data-testid="agent-lifecycle-start"]')).toBeNull();
    await click(host.querySelector<HTMLButtonElement>('[data-testid="agent-lifecycle-stop"]')!);
    const confirm = document.querySelector<HTMLElement>('[data-testid="agent-lifecycle-confirm"]')!;
    expect(confirm.textContent).toContain("Stop 1 agent?");
    expect(confirm.textContent).toContain("profile, history and settings are kept");
    expect(commands).toHaveLength(0);
    await click(document.querySelector<HTMLButtonElement>('[data-testid="agent-lifecycle-confirm-action"]')!);
    await vi.waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({ actionKey: "agent.installation.disable", resourceId: "inst", resourceVersion: 4,
      explicitConfirmation: true });
    expect(Object.keys(commands[0]!).sort()).toEqual(["actionKey", "explicitConfirmation", "idempotencyKey", "resourceId", "resourceVersion"]);
    expect(recorded).toHaveBeenCalled();
  });

  it("offers Start agent for a stopped Agent", async () => {
    const { host, commands } = await mount(stopped);
    expect(host.textContent).toContain("Stopped");
    await click(host.querySelector<HTMLButtonElement>('[data-testid="agent-lifecycle-start"]')!);
    await click(document.querySelector<HTMLButtonElement>('[data-testid="agent-lifecycle-confirm-action"]')!);
    await vi.waitFor(() => expect(commands[0]?.actionKey).toBe("agent.installation.enable"));
  });

  it("keeps the same command and key when the outcome is unknown", async () => {
    const { host, commands } = await mount(running, "UNKNOWN");
    await click(host.querySelector<HTMLButtonElement>('[data-testid="agent-lifecycle-stop"]')!);
    await click(document.querySelector<HTMLButtonElement>('[data-testid="agent-lifecycle-confirm-action"]')!);
    await vi.waitFor(() => expect(host.querySelector('[data-testid="agent-lifecycle-unknown"]')).not.toBeNull());
    expect(host.textContent).toContain("Result unknown. Operation op-1.");
    const retry = [...host.querySelectorAll("button")].find((button) => button.textContent === "Retry same request")!;
    await click(retry);
    await vi.waitFor(() => expect(commands).toHaveLength(2));
    expect(commands[1]).toEqual(commands[0]);
  });
});
