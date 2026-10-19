// DD-125(6) / V-SCN-143: the original working signal, channel activity rows and composer activity.
// Members see the Agent's 20002 only; turn start, headlines and "View activity" need Installation audit.
import type { ReactNode } from "react";
import type { AgentActiveTurnPage, AgentInstallationView } from "@client-kit/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/react/agent-transcript", async () => {
  const actual = await vi.importActual<typeof import("../src/react/agent-transcript")>("../src/react/agent-transcript");
  return {
    ...actual,
    useAgentTranscript: (installationId: string | null) => installationId === "inst-audit"
      ? [{ id: "1", headline: "Running git status" }, { id: "2", headline: "Editing notes.md" }]
      : [],
    getActivityHeadline: (item: { headline?: string }) => item.headline ?? null,
    isSpineItem: () => true,
    isMeaningfulItem: () => true,
  };
});

import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import {
  getWorkingAgentPubkeysForChannel,
  getWorkingChannels,
  reportChannelActiveTurns,
  reportChannelAgents,
  reportChannelBotTyping,
  resetAgentWorkingSignal,
} from "../src/react/agent-activity/agentWorkingSignal";
import { auditedTurns, botTypingPubkeyKey } from "../src/react/agent-activity/useChannelAgentActivity";
import { BotActivityComposerAction } from "../src/react/agent-activity/BotActivityBar";
import { WorkingAgentRows } from "../src/react/sidebar/channel-activity-popover";
import { formatWorkingTooltip } from "../src/react/agent-activity/ChannelWorkingBadge";
import { translate } from "../src/i18n";
import { render, settle } from "./render";

const A = "a".repeat(64);
const B = "b".repeat(64);
const send = vi.fn(async () => ({ status: 404, body: {} }));

beforeEach(() => { resetAgentWorkingSignal(); });
afterEach(() => { resetAgentWorkingSignal(); vi.restoreAllMocks(); });

describe("agentWorkingSignal", () => {
  it("merges audited turns (primary) with Agent typing (fallback) like the original", () => {
    reportChannelBotTyping("ws-1", [B.toUpperCase()]);
    reportChannelActiveTurns("ws-1", [{ agentPubkey: A, anchorAt: 1_000 }]);
    reportChannelBotTyping("ws-2", [B]);
    const [first, second] = getWorkingChannels();
    expect(first).toMatchObject({ channelId: "ws-1", source: "turn", anchorAt: 1_000, agentCount: 2, agentPubkeys: [A, B] });
    expect(second).toMatchObject({ channelId: "ws-2", source: "typing", agentCount: 1, agentPubkeys: [B] });
    expect(getWorkingAgentPubkeysForChannel("ws-1")).toEqual([A, B]);
    reportChannelBotTyping("ws-2", []);
    reportChannelActiveTurns("ws-1", []);
    expect(getWorkingChannels().map((row) => row.channelId)).toEqual(["ws-1"]);
  });

  it("names working Agents only from the admitted directory", () => {
    reportChannelAgents("ws-1", [{ pubkey: A, name: "Scout", canOpenActivity: true }]);
    reportChannelBotTyping("ws-1", [A]);
    const summary = getWorkingChannels()[0]!;
    expect(summary.agentNames).toEqual(["Scout"]);
    expect(formatWorkingTooltip(summary, (key, vars) => translate("en", key, vars))).toBe("Scout working");
    expect(formatWorkingTooltip({ ...summary, agentNames: [], agentCount: 2 }, (key, vars) => translate("en", key, vars)))
      .toBe("2 agents working");
  });

  it("keeps only Agent typing in the typing key", () => {
    expect(botTypingPubkeyKey([{ pubkey: B }, { pubkey: "c".repeat(64) }, { pubkey: A }, { pubkey: A }], new Set([A, B])))
      .toBe([A, B].join(","));
  });

  it("uses audited turns of audited Installations with a native start only", () => {
    const agents = [
      { resourceId: "inst-audit", agentPubkey: A, canAudit: true },
      { resourceId: "inst-member", agentPubkey: B, canAudit: false },
    ] as AgentInstallationView[];
    const page = { workspaceId: "ws", turns: [
      { installationId: "inst-audit", invocationId: "i1", originalActionExecutionId: "ae1", rootEventId: "r", projectionGeneration: 1,
        startedAt: "2026-10-19T08:00:00Z" },
      { installationId: "inst-member", invocationId: "i2", originalActionExecutionId: "ae2", rootEventId: "r", projectionGeneration: 1,
        startedAt: "2026-10-19T08:00:00Z" },
      { installationId: "inst-audit", invocationId: "i3", originalActionExecutionId: "ae3", rootEventId: "r2", projectionGeneration: 1 },
    ] } as AgentActiveTurnPage;
    expect(auditedTurns(page, "ws", agents)).toEqual([{ agentPubkey: A, anchorAt: Date.parse("2026-10-19T08:00:00Z") }]);
    expect(auditedTurns({ ...page, workspaceId: "other" }, "ws", agents)).toBeNull();
  });
});

describe("channel activity and composer surfaces", () => {
  const mount = (ui: ReactNode) => render(<PlatformProvider locale="en" client={createBffClient({ send })} currentPrincipalId="me">
    {ui}</PlatformProvider>);

  it("shows elapsed and View activity only for audit-backed rows", async () => {
    reportChannelAgents("ws", [{ pubkey: A, name: "Scout", canOpenActivity: true }, { pubkey: B, name: "Helper", canOpenActivity: false }]);
    const onOpen = vi.fn();
    const host = await mount(<>
      <div data-testid="audited"><WorkingAgentRows channelId="ws" onOpen={onOpen}
        activeWorking={{ channelId: "ws", anchorAt: Date.now() - 65_000, agentCount: 1, agentPubkeys: [A], source: "turn" }} /></div>
      <div data-testid="member"><WorkingAgentRows channelId="ws" onOpen={onOpen}
        activeWorking={{ channelId: "ws", anchorAt: Date.now() - 65_000, agentCount: 1, agentPubkeys: [B], source: "typing" }} /></div>
    </>);
    await settle();
    const audited = host.querySelector<HTMLElement>('[data-testid="audited"]')!;
    const member = host.querySelector<HTMLElement>('[data-testid="member"]')!;
    expect(audited.textContent).toContain("Scout");
    expect(audited.textContent).toMatch(/1m \ds/);
    expect(audited.querySelector(`button[data-testid="channel-activity-agent-${A}"]`)).not.toBeNull();
    expect(member.textContent).toContain("Helper");
    expect(member.textContent).not.toMatch(/\dm \ds/);
    expect(member.querySelector("button")).toBeNull();
    audited.querySelector<HTMLButtonElement>("button")!.click();
    expect(onOpen).toHaveBeenCalledWith(A, "ws");
  });

  it("rotates transcript headlines only with audit; members get the plain Working label", async () => {
    const host = await mount(<>
      <div data-testid="audited"><BotActivityComposerAction channelId="ws" onOpenAgentSession={vi.fn()} openAgentSessionPubkey={null}
        agents={[{ pubkey: A, name: "Scout", auditInstallationId: "inst-audit" }]} workingBotPubkeys={[A]} variant="inline" /></div>
      <div data-testid="member"><BotActivityComposerAction channelId="ws" onOpenAgentSession={vi.fn()} openAgentSessionPubkey={null}
        agents={[{ pubkey: B, name: "Helper" }]} workingBotPubkeys={[B]} variant="inline" /></div>
      <div data-testid="many"><BotActivityComposerAction channelId="ws" onOpenAgentSession={vi.fn()} openAgentSessionPubkey={null}
        agents={[{ pubkey: A, name: "Scout" }, { pubkey: B, name: "Helper" }]} workingBotPubkeys={[A, B]} variant="inline" /></div>
    </>);
    await settle();
    expect(host.querySelector('[data-testid="audited"]')!.textContent).toContain("Scout: Running git status");
    expect(host.querySelector('[data-testid="member"]')!.textContent).toContain("Helper: Working");
    expect(host.querySelector('[data-testid="many"]')!.textContent).toContain("Scout +1");
    expect(host.querySelector('[data-testid="member"] [data-testid="bot-activity-composer-trigger"]')!.getAttribute("aria-label"))
      .toBe("Helper is working. View activity.");
  });
});
