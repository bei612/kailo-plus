// DD-125(6) / V-SCN-144: original respondTo over Installation use authorization. Owner only ≙ default,
// Selected people ≙ one governed use.grant per member, and there is no "Anyone".
import type { ActionCommand, AgentInstallationUsePage } from "@client-kit/contracts";
import { AgentRespondToMode } from "@client-kit/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { EditRespondToDialog } from "../src/react/agent-activity/EditRespondToDialog";
import {
  respondToAllowlistOf,
  respondToChanges,
  respondToCommand,
  respondToModeOf,
} from "../src/react/agent-activity/respondTo";
import type { BffReply, BffRequest } from "../src/transport";
import { click, render, settle, type } from "./render";

afterEach(() => { vi.restoreAllMocks(); });

const member = (principalId: string, displayName: string, requested: boolean) =>
  ({ principalId, displayName, requested, effective: requested, canGrant: true, canRevoke: true });
const page = (version: number, members: ReturnType<typeof member>[], respondTo?: AgentRespondToMode): AgentInstallationUsePage => ({
  installationId: "inst", resourceVersion: version, members, ...(respondTo ? { respondTo } : {}),
}) as AgentInstallationUsePage;

describe("respondTo mapping", () => {
  it("reads the mode from the page and falls back to explicit grants", () => {
    expect(respondToModeOf(page(1, [member("a", "Ada", false)], AgentRespondToMode.Allowlist))).toBe(AgentRespondToMode.Allowlist);
    expect(respondToModeOf(page(1, [member("a", "Ada", true)]))).toBe(AgentRespondToMode.Allowlist);
    expect(respondToModeOf(page(1, [member("a", "Ada", false)]))).toBe(AgentRespondToMode.OwnerOnly);
    expect(Object.values(AgentRespondToMode).sort()).toEqual(["ALLOWLIST", "OWNER_ONLY"]);
  });

  it("diffs into one grant or revoke per changed member; Owner only revokes every explicit grant", () => {
    const current = page(1, [member("a", "Ada", true), member("b", "Bo", false), member("c", "Cy", true)]);
    expect(respondToAllowlistOf(current)).toEqual(["a", "c"]);
    expect(respondToChanges(current, AgentRespondToMode.Allowlist, ["a", "b"])).toEqual([
      { principalId: "b", displayName: "Bo", grant: true },
      { principalId: "c", displayName: "Cy", grant: false },
    ]);
    expect(respondToChanges(current, AgentRespondToMode.OwnerOnly, ["a", "b"])).toEqual([
      { principalId: "a", displayName: "Ada", grant: false },
      { principalId: "c", displayName: "Cy", grant: false },
    ]);
    expect(respondToCommand(current, { principalId: "b", grant: true }, "k")).toEqual({
      actionKey: "agent.installation.use.grant", idempotencyKey: "k", resourceId: "inst", resourceVersion: 1,
      principalId: "b", explicitConfirmation: true });
  });
});

describe("EditRespondToDialog", () => {
  it("offers only Only me and Selected people, and saves sequentially on the re-read version", async () => {
    const pages = [
      page(1, [member("a", "Ada", true), member("b", "Bo", false)]),
      page(1, [member("a", "Ada", true), member("b", "Bo", false)]),
      page(2, [member("a", "Ada", false), member("b", "Bo", false)]),
      page(3, [member("a", "Ada", false), member("b", "Bo", true)]),
    ];
    let reads = 0;
    const commands: ActionCommand[] = [];
    const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
      if (request.path === "/api/v1/agent-installations/inst/users") return { status: 200, body: pages[Math.min(reads++, pages.length - 1)] };
      if (request.method === "POST" && request.path === "/api/v1/actions") {
        const command = request.body as ActionCommand;
        commands.push(command);
        return { status: 200, body: { operationId: `op-${commands.length}`, actionExecutionId: "ae", actionKey: command.actionKey,
          gateState: "ALLOWED", dispatchState: "DISPATCHED" } };
      }
      return { status: 404, body: {} };
    });
    const closed = vi.fn();
    await render(<PlatformProvider locale="en" client={createBffClient({ send })} currentPrincipalId="me">
      <EditRespondToDialog agent={{ installationId: "inst", name: "Scout" }} open onOpenChange={(open) => { if (!open) closed(); }} />
    </PlatformProvider>);
    await vi.waitFor(() => expect(document.querySelector('[data-testid="agent-respond-to-select"]')).not.toBeNull());
    const select = document.querySelector<HTMLSelectElement>('[data-testid="agent-respond-to-select"]')!;
    expect([...select.options].map((option) => option.textContent)).toEqual(["Only me (default)", "Selected people"]);
    expect(select.value).toBe("ALLOWLIST");
    expect(document.body.textContent).toContain("Choose who can send instructions to Scout.");
    // Swap Ada for Bo: in member order, revoke Ada then grant Bo, each on the freshly read version.
    await type(document.querySelector<HTMLInputElement>('[data-testid="agent-respond-to-search"]')!, "Bo");
    await settle();
    await click(document.querySelector<HTMLButtonElement>('[data-testid="agent-respond-to-result-b"]')!);
    await click(document.querySelector<HTMLButtonElement>('[aria-label="Remove Ada"]')!);
    await click(document.querySelector<HTMLButtonElement>('[data-testid="agent-respond-to-save"]')!);
    await vi.waitFor(() => expect(commands).toHaveLength(2));
    expect(commands.map((command) => [command.actionKey, command.principalId, command.resourceVersion])).toEqual([
      ["agent.installation.use.revoke", "a", 1],
      ["agent.installation.use.grant", "b", 2],
    ]);
    expect(new Set(commands.map((command) => command.idempotencyKey)).size).toBe(2);
    await vi.waitFor(() => expect(closed).toHaveBeenCalled());
  });
});
