// DD-125(2): the original moderation surfaces over Core (V-SCN-126..130). Pure triage maths,
// the composer timeout learned from a structured PUBLISH_REJECTED, the message menu items
// and report dialog submitting governed moderation.* commands with one key per intent.
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionDispatchState, ActionGateState, ModerationReportStatus, ModerationReportTargetKind, ModerationReportType,
  ModerationResolutionAction, ModerationResolutionStatus, ModerationTimeoutDuration, PublishRestrictionKind,
  type ActionSubmission,
} from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { setLocale } from "../src/i18n";
import {
  buildModerationQueue, memberCommand, memberRestrictionState, moderationOutcome, reportCommand, resolvableActions,
  statusForAction, timeoutFromRestriction, timeoutRemaining, type ModerationReport,
} from "../src/moderation";
import { PlatformProvider } from "../src/react/context";
import { MessageActionBarSurface, type TimelineMessage } from "../src/react/messages";
import { ComposerTimeoutBanner, clearTimeoutState, recordTimeoutFromRestriction, useTimeoutState } from "../src/react/moderation";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import type { BffReply, BffRequest } from "../src/transport";
import { click, render, settle } from "./render";

const author = "b".repeat(64);
const self = "a".repeat(64);
const eventId = "e".repeat(64);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setLocale("en");
});
afterEach(() => {
  act(() => clearTimeoutState());
  vi.restoreAllMocks();
});

function report(id: string, patch: Partial<ModerationReport> = {}): ModerationReport {
  return {
    id: `row-${id}`, reportEventId: id.repeat(64).slice(0, 64), reporterPubkey: "f".repeat(64),
    targetKind: ModerationReportTargetKind.Event, target: eventId, reportType: ModerationReportType.Spam,
    status: ModerationReportStatus.Open, createdAt: "2026-10-19T08:00:00Z", workspaceId: "w",
    targetAuthorPubkey: author, targetPrincipalId: "p-author", ...patch,
  };
}

describe("original moderation triage over Core views", () => {
  it("groups reports by target, orders by severity and offers only completable resolutions", () => {
    const groups = buildModerationQueue([
      report("1"),
      report("2", { reportType: ModerationReportType.Malware, createdAt: "2026-10-19T09:00:00Z" }),
      report("3", { targetKind: ModerationReportTargetKind.Pubkey, target: author, workspaceId: undefined, reportType: ModerationReportType.Other }),
    ], [{ id: "a1", actorPubkey: self, action: "timeout", targetEventId: eventId, createdAt: "2026-10-19T07:00:00Z" }]);
    expect(groups.map((group) => group.targetKind)).toEqual([ModerationReportTargetKind.Event, ModerationReportTargetKind.Pubkey]);
    expect(groups[0]!.reports.map((r) => r.id)).toEqual(["row-2", "row-1"]);
    expect(groups[0]!.priorActions).toHaveLength(1);
    expect(resolvableActions(groups[0]!)).toEqual([ModerationResolutionAction.Delete, ModerationResolutionAction.Ban,
      ModerationResolutionAction.Kick, ModerationResolutionAction.Escalate, ModerationResolutionAction.Dismiss]);
    // An Agent author (no HUMAN Principal) is neither banned nor kicked; no Workspace, no delete.
    expect(resolvableActions({ ...groups[0]!, authorPrincipalId: null, workspaceId: null }))
      .toEqual([ModerationResolutionAction.Escalate, ModerationResolutionAction.Dismiss]);
    expect(statusForAction(ModerationResolutionAction.Dismiss)).toBe(ModerationResolutionStatus.Dismissed);
    expect(statusForAction(ModerationResolutionAction.Ban)).toBe(ModerationResolutionStatus.Resolved);
  });

  it("reads one person's restriction over every bound key and the original countdown", () => {
    const now = Date.parse("2026-10-19T08:00:00Z");
    const rows = [{ pubkey: "c".repeat(64), banned: false, mutedUntil: "2026-10-19T09:05:00Z", updatedAt: "x" }];
    expect(memberRestrictionState(rows, [author, "C".repeat(64)], now)).toEqual({ banned: false, timedOut: true });
    expect(memberRestrictionState(rows, [author], now)).toEqual({ banned: false, timedOut: false });
    expect(timeoutRemaining(now + 3_900_000, now)).toEqual({ key: "moderation.remaining.hours", variables: { hours: 1, minutes: 5 } });
    expect(timeoutRemaining(now + 12_000, now)).toEqual({ key: "moderation.remaining.seconds", variables: { seconds: 12 } });
    expect(timeoutRemaining(null, now)).toBeNull();
    expect(timeoutFromRestriction({ kind: PublishRestrictionKind.TimedOut })).toEqual({ expiresAtMs: null });
    expect(timeoutFromRestriction({ kind: PublishRestrictionKind.Banned })).toBeNull();
  });

  it("builds only the governed command shapes and reads outcomes without guessing", () => {
    expect(memberCommand("timeout", author.toUpperCase(), "k", ModerationTimeoutDuration.OneDay)).toEqual({
      actionKey: "moderation.timeout", idempotencyKey: "k", explicitConfirmation: true,
      moderationMember: { targetPubkey: author, timeoutDuration: ModerationTimeoutDuration.OneDay },
    });
    expect(memberCommand("ban", author, "k", ModerationTimeoutDuration.OneDay).moderationMember).toEqual({ targetPubkey: author });
    expect(reportCommand({ eventId, reportType: ModerationReportType.Spam, note: "  ", scope: { conversationId: "c" } }, "k"))
      .toEqual({ actionKey: "moderation.report.submit", idempotencyKey: "k", explicitConfirmation: true,
        moderationReport: { reportType: ModerationReportType.Spam, eventId, conversationId: "c" } });
    const base = { operationId: "op", actionExecutionId: "ae", actionKey: "moderation.ban" };
    expect(moderationOutcome({ ...base, gateState: ActionGateState.Allowed, dispatchState: ActionDispatchState.Dispatched }))
      .toEqual({ kind: "done" });
    expect(moderationOutcome({ ...base, gateState: ActionGateState.Allowed, dispatchState: ActionDispatchState.Unknown }))
      .toEqual({ kind: "unknown", operationId: "op" });
    expect(moderationOutcome({ ...base, gateState: ActionGateState.Allowed, dispatchState: ActionDispatchState.Aborted }).kind)
      .toBe("failed");
  });
});

function TimeoutHost() {
  const state = useTimeoutState();
  return state.active ? <ComposerTimeoutBanner expiresAtMs={state.expiresAtMs} /> : <p>open</p>;
}

describe("original composer timeout banner", () => {
  it("records a timeout only from a TIMED_OUT restriction and clears on an accepted send", async () => {
    const host = await render(<TimeoutHost />);
    expect(host.textContent).toBe("open");
    let recorded = false;
    act(() => { recorded = recordTimeoutFromRestriction({ kind: PublishRestrictionKind.Banned }); });
    expect(recorded).toBe(false);
    const until = new Date(Date.now() + 2 * 3_600_000 + 30_000).toISOString();
    act(() => { recorded = recordTimeoutFromRestriction({ kind: PublishRestrictionKind.TimedOut, until }); });
    expect(recorded).toBe(true);
    expect(host.querySelector('[data-testid="composer-timeout-banner"]')?.textContent)
      .toMatch(/^You're timed out by community moderators — 2h 0m left\.$/);
    act(() => { recordTimeoutFromRestriction({ kind: PublishRestrictionKind.TimedOut }); });
    expect(host.textContent).toBe("You're timed out by community moderators.");
    act(() => clearTimeoutState());
    expect(host.textContent).toBe("open");
  });
});

const message: TimelineMessage = {
  id: eventId, createdAt: 1, author: "Bob", time: "", body: "spam", depth: 0, kind: 9, pubkey: author, signerPubkey: author,
};

function submission(dispatchState: ActionDispatchState, actionKey: string): ActionSubmission {
  return { operationId: "op", actionExecutionId: "ae", actionKey, gateState: ActionGateState.Allowed, dispatchState };
}

function mount(target: TimelineMessage, answers: ActionDispatchState[] = [ActionDispatchState.Dispatched]) {
  const commands: Record<string, unknown>[] = [];
  const route = (request: BffRequest): BffReply => {
    if (request.path === "/api/v1/moderation/access") return { status: 200, body: { canModerate: true } };
    if (request.path === "/api/v1/moderation/restricted") return { status: 200, body: { items: [] } };
    if (request.path === "/api/v1/workspaces/w/members") {
      return { status: 200, body: [{ principalId: "p-author", displayName: "Bob", state: "ACTIVE", pubkeys: [author] }] };
    }
    if (request.path === "/api/v1/actions") {
      const command = request.body as Record<string, unknown>;
      commands.push(command);
      const state = answers[Math.min(commands.length - 1, answers.length - 1)]!;
      return { status: state === ActionDispatchState.Dispatched ? 200 : 202, body: submission(state, String(command.actionKey)) };
    }
    return { status: 403, body: {} };
  };
  const send = vi.fn(async (request: BffRequest) => route(request));
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const ui = render(<QueryClientProvider client={cache}><PlatformProvider client={createBffClient({ send })} locale="en">
    <TooltipProvider><MessageActionBarSurface message={target} onCopyMessage={vi.fn()}
      moderation={{ scope: { workspaceId: "w" }, selfPubkey: self }} /></TooltipProvider>
  </PlatformProvider></QueryClientProvider>);
  return { ui, send, commands };
}

async function openMenu(host: HTMLElement) {
  const trigger = host.querySelector<HTMLButtonElement>(`[data-testid="more-actions-${eventId}"]`)!;
  await act(async () => { trigger.focus(); trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
  await settle();
}

describe("original message menu moderation", () => {
  it("offers Report message and the moderator items, and bans the raw signer through Core", async () => {
    const { ui, commands } = mount(message);
    await openMenu(await ui);
    expect(document.querySelector(`[data-testid="report-message-${eventId}"]`)).not.toBeNull();
    await vi.waitFor(() => expect(document.querySelector(`[data-testid="message-ban-${eventId}"]`)).not.toBeNull());
    await vi.waitFor(() => expect(document.querySelector(`[data-testid="message-kick-${eventId}"]`)).not.toBeNull());
    expect(document.querySelector(`[data-testid="message-timeout-${eventId}"]`)).not.toBeNull();
    await click(document.querySelector<HTMLElement>(`[data-testid="message-ban-${eventId}"]`)!);
    await vi.waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({ actionKey: "moderation.ban", explicitConfirmation: true, moderationMember: { targetPubkey: author } });
  });

  it("never offers moderator items for the viewer's own or an Agent's message", async () => {
    for (const target of [{ ...message, signerPubkey: self, pubkey: self }, { ...message, isAgent: true }]) {
      const { ui, send } = mount(target);
      const host = await ui;
      await openMenu(host);
      expect(document.querySelector(`[data-testid="report-message-${eventId}"]`)).not.toBeNull();
      await settle();
      expect(document.querySelector(`[data-testid="message-ban-${eventId}"]`)).toBeNull();
      expect(send.mock.calls.some(([request]) => request.path === "/api/v1/moderation/restricted")).toBe(false);
      await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      host.remove();
    }
  });

  it("submits a report with the original categories and keeps one key while the outcome is unknown", async () => {
    const { ui, commands } = mount(message, [ActionDispatchState.Unknown, ActionDispatchState.Dispatched]);
    await openMenu(await ui);
    await click(document.querySelector<HTMLElement>(`[data-testid="report-message-${eventId}"]`)!);
    await vi.waitFor(() => expect(document.querySelector('[data-testid="report-message-dialog"]')).not.toBeNull());
    const dialog = document.querySelector<HTMLElement>('[data-testid="report-message-dialog"]')!;
    expect([...dialog.querySelectorAll('[data-testid^="report-category-"]')].map((node) => node.textContent)).toEqual([
      "Spam", "Profanity or hate speech", "Nudity or sexual content", "Impersonation", "Malware or scam", "Illegal content", "Other",
    ]);
    const submit = dialog.querySelector<HTMLButtonElement>('[data-testid="report-submit"]')!;
    expect(submit.disabled).toBe(true);
    await click(dialog.querySelector<HTMLElement>(`[data-testid="report-category-${ModerationReportType.Spam}"]`)!);
    await click(submit);
    await vi.waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({ actionKey: "moderation.report.submit", explicitConfirmation: true,
      moderationReport: { reportType: ModerationReportType.Spam, eventId, workspaceId: "w" } });
    await vi.waitFor(() => expect(submit.disabled).toBe(false));
    await click(submit);
    await vi.waitFor(() => expect(commands).toHaveLength(2));
    expect(commands[1]!.idempotencyKey).toBe(commands[0]!.idempotencyKey);
  });
});
