// DD-170 (.design/20 §16, 06 §8, 14 §7), V-SCN-320–324: the business operations page as a
// read-only governance timeline grouped by day — names instead of identifiers, one-line status
// and usage, filters, the total and pages, a detail with history and usage lines, technical
// identifiers folded, a link back to the task detail, and the four states.
import { act } from "react";
import { ErrorClass, ReasonCode } from "@client-kit/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { setLocale } from "../src/i18n";
import { BusinessOperationsPage } from "../src/react/business-observability";
import { PlatformProvider } from "../src/react/context";
import type { BffReply, BffRequest, BffTransport } from "../src/transport";
import { button, click, render, settle } from "./render";

type Route = (request: BffRequest) => BffReply | Promise<BffReply> | undefined;

const ME = "11111111-1111-4111-8111-111111111111";
const ADA = "22222222-2222-4222-8222-222222222222";
const AGENT = "23f9c2e3-3333-4333-8333-333333333333";
const STRANGER = "44444444-4444-4444-8444-444444444444";
const WS = "55555555-5555-4555-8555-555555555555";

function op(index: number, extra: Record<string, unknown> = {}) {
  const id = `ae-${String(index).padStart(4, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
  return {
    actionExecutionId: id, operationId: `op-${index}`, actionKey: "application_binding.disable", actionVersion: 1,
    actorPrincipalId: ME, initiatorPrincipalId: ME, targetId: `target-${index}`,
    createdAt: new Date(Date.UTC(2026, 9, 30, 8, 0, 0) - index * 60_000).toISOString(),
    phase: "COMPLETED", usage: [], usageState: "NOT_METERED", ...extra,
  };
}

const metered = op(1, {
  actionKey: "agent.invoke", initiatorPrincipalId: ADA, actorPrincipalId: AGENT, workspaceId: WS,
  phase: "DENIED", reason: ReasonCode.PermissionDenied, terminalAt: "2026-10-30T07:59:30Z", usageState: "UNKNOWN",
  usage: [
    { meterKey: "component_model_tokens", quantity: 883, status: "UNKNOWN" },
    { meterKey: "component_model_tokens", quantity: 288, status: "UNKNOWN" },
    { meterKey: "native_import_count", quantity: 3, status: "COMMITTED" },
  ],
});

function transport(route: Route): BffTransport & { send: ReturnType<typeof vi.fn> } {
  return {
    send: vi.fn(async (request: BffRequest): Promise<BffReply> => {
      const reply = await route(request);
      if (reply) return reply;
      if (request.path === "/api/v1/workspaces") return { status: 200, body: [{ id: WS, name: "Launch team", slug: "launch" }] };
      if (request.path.startsWith("/api/v1/conversation-participants")) return { status: 200, body: {
        items: [{ principalId: ADA, displayName: "Ada Lovelace", pubkeys: [] }], maxParticipants: 10,
      } };
      if (request.path.startsWith("/api/v1/agent-installations?")) return { status: 200, body: {
        installations: [{ agentPrincipalId: AGENT, agentDisplayName: "Release helper" }],
      } };
      return { status: 503, body: undefined };
    }),
  };
}

async function mount(route: Route, locale: "en" | "zh-CN" = "en") {
  const t = transport(route);
  const host = await render(
    <PlatformProvider client={createBffClient(t)} locale={locale} currentPrincipalId={ME}>
      <BusinessOperationsPage />
    </PlatformProvider>,
  );
  await settle();
  return { host, t };
}

const mine = (operations: unknown[], nextCursor?: string): Route => (request) =>
  request.path.startsWith("/api/v1/operations?") ? { status: 200, body: { operations, ...(nextCursor ? { nextCursor } : {}) } } : undefined;
const table = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-testid=operation-table]")!;
const rows = (host: HTMLElement) => [...table(host).querySelectorAll<HTMLTableRowElement>("tbody tr[data-row-key]")];

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); setLocale("en");
});

describe("business operations timeline (DD-170 §16.2, 06 §8)", () => {
  it("names the action, people and workspace, keeps the status on one line and never shows wire keys or IDs", async () => {
    const { host } = await mount(mine([metered, op(2)]));
    const [first, second] = rows(host);
    expect(first!.textContent).toContain("Run Agent");
    expect(first!.textContent).toContain("Not allowed");
    expect(first!.textContent).toContain("Ada Lovelace");
    expect(first!.textContent).toContain("Release helper");
    expect(first!.textContent).toContain("Launch team");
    expect(first!.textContent).toContain("3 items · To reconcile");
    expect(first!.textContent).toContain("30 s");
    expect(second!.textContent).toContain("Disable application binding");
    expect(second!.textContent).toContain("Me");
    expect(second!.textContent).toContain("Organization");
    expect(second!.textContent).toContain("Not metered");
    const text = table(host).textContent!;
    for (const raw of ["agent.invoke", "application_binding.disable", "component_model_tokens", AGENT.slice(0, 8), ADA, WS, "op-1"])
      expect(text).not.toContain(raw);
    const badge = first!.querySelector<HTMLElement>("td:nth-child(2) span.whitespace-nowrap")!;
    expect(badge.textContent).toBe("Not allowed");
    // Read-only: rows carry no controls.
    expect(table(host).querySelectorAll("tbody button, tbody a, tbody input")).toHaveLength(0);
    expect(host.querySelector("[data-testid=list-total]")?.textContent).toBe("2 total");
    expect(host.querySelector("[data-testid=operation-timeline]")?.textContent).toContain("The latest 2 operations, newest first.");
  });

  it("groups rows by day under date separators and summarizes the loaded window", async () => {
    const { host } = await mount(mine([op(1), op(2), op(3, { createdAt: "2026-10-28T10:00:00Z" }), op(4, { createdAt: "2026-10-28T09:00:00Z", phase: "FAILED" })]));
    const body = table(host).querySelector("tbody")!;
    const kinds = [...body.children].map((row) => row.getAttribute("data-testid") === "operation-day" ? "day" : "op");
    expect(kinds).toEqual(["day", "op", "op", "day", "op", "op"]);
    const days = [...body.querySelectorAll("[data-testid=operation-day]")].map((row) => row.textContent);
    expect(days[0]).not.toBe(days[1]);
    const summary = host.querySelector<HTMLElement>("[data-testid=operation-window-summary]")!;
    expect(summary.textContent).toContain("Completed3");
    expect(summary.textContent).toContain("Failed1");
    expect(summary.textContent).toContain("Not metered4");
  });

  it("links an own operation back to its task detail", async () => {
    const { host, t } = await mount(mine([op(2)]));
    await click(rows(host)[0]!);
    await click(button(host.querySelector<HTMLElement>("[data-testid=operation-detail]")!, "Open in Tasks"));
    expect(host.querySelector("[data-testid=operation-task]")).not.toBeNull();
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: `/api/v1/tasks/${op(2).actionExecutionId}` });
    expect(t.send.mock.calls.every(([request]) => (request as BffRequest).method === "GET")).toBe(true);
  });

  it("reads an unresolved person as an unknown member", async () => {
    const { host } = await mount(mine([op(1, { initiatorPrincipalId: STRANGER, actorPrincipalId: STRANGER })]));
    expect(rows(host)[0]!.textContent).toContain("Unknown member");
    expect(rows(host)[0]!.textContent).not.toContain(STRANGER.slice(0, 8));
  });

  it("pages 100 operations 20 at a time with the total and page count", async () => {
    const { host } = await mount(mine(Array.from({ length: 100 }, (_, i) => op(i))));
    expect(rows(host)).toHaveLength(20);
    expect(host.querySelector("[data-testid=list-total]")?.textContent).toBe("100 total");
    expect(host.querySelector("[data-testid=list-page]")?.textContent).toBe("Page 1 of 5");
    await click(host.querySelector<HTMLButtonElement>('button[aria-label="Next page"]')!);
    expect(host.querySelector("[data-testid=list-page]")?.textContent).toBe("Page 2 of 5");
    expect(rows(host)[0]!.getAttribute("data-row-key")).toBe(op(20).actionExecutionId);
  });

  it("filters by status and by text, and clears a filter with no match", async () => {
    const { host } = await mount(mine([metered, op(2), op(3, { phase: "UNKNOWN" })]));
    const chip = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
      .find((node) => node.textContent?.startsWith(label))!;
    expect(chip("All").textContent).toBe("All3");
    await click(chip("Not done"));
    expect(rows(host).map((row) => row.getAttribute("data-row-key"))).toEqual([metered.actionExecutionId]);
    await click(chip("To check"));
    expect(rows(host)).toHaveLength(1);
    expect(rows(host)[0]!.textContent).toContain("Outcome not known yet");
    await click(chip("In progress"));
    expect(host.querySelector("[data-testid=operation-table]")?.textContent).toContain("No results match this filter.");
    await click(button(table(host), "Clear filter"));
    expect(rows(host)).toHaveLength(3);
    const search = table(host).querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "ada");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(rows(host)).toHaveLength(1);
  });

  it("opens a detail with history, usage lines and folded technical details, and returns to the same page", async () => {
    const { host } = await mount(mine([...Array.from({ length: 25 }, (_, i) => op(i + 2)), metered]));
    await click(host.querySelector<HTMLButtonElement>('button[aria-label="Next page"]')!);
    const row = table(host).querySelector<HTMLTableRowElement>(`tr[data-row-key="${metered.actionExecutionId}"]`)!;
    await click(row);
    const detail = host.querySelector<HTMLElement>("[data-testid=operation-detail]")!;
    expect(detail.querySelector("h2")?.textContent).toBe("Run Agent");
    expect(detail.textContent).toContain("You do not have permission");
    expect(detail.querySelector("[data-testid=operation-history]")?.textContent).toContain("Requested");
    expect(detail.querySelector("[data-testid=operation-history]")?.textContent).toContain("By Ada Lovelace");
    const usage = detail.querySelector<HTMLElement>("[data-testid=operation-usage-lines]")!;
    expect(usage.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(usage.textContent).toContain("Component model tokens");
    expect(usage.textContent).toContain("Native import count");
    expect(usage.textContent).not.toContain("component_model_tokens");
    expect(detail.textContent).not.toContain("agent.invoke");
    // Not this person's execution: no link to a task they cannot follow.
    expect([...detail.querySelectorAll("button")].some((node) => node.textContent === "Open in Tasks")).toBe(false);
    await click(button(detail, "Technical details"));
    expect(detail.querySelector('code[title="agent.invoke"]')).not.toBeNull();
    expect(detail.querySelector(`code[title="${metered.actionExecutionId}"]`)).not.toBeNull();
    await click(button(detail, "Back"));
    expect(host.querySelector("[data-testid=operation-detail]")).toBeNull();
    expect(host.querySelector("[data-testid=list-page]")?.textContent).toBe("Page 2 of 2");
  });

  it("states a partial window and loads older operations with the cursor", async () => {
    const { host, t } = await mount((request) => request.path.includes("cursor=older")
      ? { status: 200, body: { operations: [op(9)] } }
      : request.path.startsWith("/api/v1/operations?") ? { status: 200, body: { operations: [op(1)], nextCursor: "older" } } : undefined);
    expect(host.querySelector("[data-testid=list-total]")?.textContent).toContain("first 1 loaded");
    await click(host.querySelector<HTMLButtonElement>("[data-testid=operations-load-more]")!);
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/operations?scope=mine&cursor=older" });
    expect(rows(host)).toHaveLength(2);
    expect(host.querySelector("[data-testid=list-total]")?.textContent).toBe("2 total");
  });
});

describe("business operations states (DD-170 §16.4)", () => {
  it("shows a first-time empty state with an explanation", async () => {
    const { host } = await mount(mine([]));
    const empty = host.querySelector<HTMLElement>("[data-testid=empty-state]")!;
    expect(empty.textContent).toContain("No operations yet");
    expect(empty.textContent).toContain("Operations you start or carry out");
  });

  it("shows a table skeleton while loading, then the rows", async () => {
    let finish!: (reply: BffReply) => void;
    const { host } = await mount((request) => request.path.startsWith("/api/v1/operations?")
      ? new Promise<BffReply>((resolve) => { finish = resolve; }) : undefined);
    expect(host.querySelector("[data-testid=table-skeleton]")).not.toBeNull();
    await act(async () => finish({ status: 200, body: { operations: [op(1)] } }));
    await settle();
    expect(host.querySelector("[data-testid=table-skeleton]")).toBeNull();
    expect(rows(host)).toHaveLength(1);
  });

  it("explains a refused scope instead of drawing it empty, and offers a retry for other failures", async () => {
    const forbidden: BffReply = { status: 403, body: { class: ErrorClass.Denied, reason: ReasonCode.PermissionDenied } };
    const { host } = await mount((request) => request.path.startsWith("/api/v1/operations") && !request.path.includes("scope=mine")
      ? forbidden : mine([op(1)])(request));
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Scope"]')!;
    await act(async () => { select.value = "tenant"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await settle();
    const denied = [...host.querySelectorAll<HTMLElement>("[data-testid=permission-state]")];
    expect(denied).toHaveLength(2);
    expect(denied[0]!.textContent).toContain("You do not have audit permission on the whole organization");
    expect(host.querySelector("[data-testid=empty-state]")).toBeNull();

    const failing = await mount((request) => request.path.startsWith("/api/v1/operations?") ? { status: 503, body: undefined } : undefined);
    const error = failing.host.querySelector<HTMLElement>("[data-testid=error-state]")!;
    expect(error).not.toBeNull();
    expect(button(error, "Try again")).toBeDefined();
  });
});

describe("scope overview (DD-170, 06 §8)", () => {
  it("summarizes a scope with totals, statuses and a by-action table in words", async () => {
    const summary = {
      tenantId: "tenant", from: "2026-10-01T00:00:00Z", to: "2026-10-31T00:00:00Z", total: 7,
      phases: [{ phase: "COMPLETED", count: 5 }, { phase: "UNKNOWN", count: 2 }],
      usageStates: [{ state: "NOT_METERED", count: 7 }],
      actions: [{ actionKey: "agent.invoke", total: 7, phases: [{ phase: "COMPLETED", count: 5 }], timedTerminalCount: 5, averageTerminalSeconds: 75 }],
    };
    const { host } = await mount((request) => request.path.startsWith("/api/v1/operations/summary")
      ? { status: 200, body: summary } : mine([op(1)])(request));
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Scope"]')!;
    await act(async () => { select.value = WS; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await settle();
    const section = host.querySelector<HTMLElement>("[data-testid=operation-summary]")!;
    expect(section.textContent).toContain("Overview");
    expect(section.textContent).toContain("7");
    expect(section.textContent).toContain("Completed5");
    const actions = section.querySelector<HTMLElement>("[data-testid=operation-summary-actions]")!;
    expect(actions.textContent).toContain("Run Agent");
    expect(actions.textContent).toContain("1 min 15 s");
    expect(actions.textContent).not.toContain("agent.invoke");
  });
});
