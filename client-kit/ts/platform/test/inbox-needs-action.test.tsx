import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApprovalDecision, ApprovalStatus, type ApprovalView } from "@client-kit/contracts";
import { setLocale } from "../src/i18n";
import { createBffClient } from "../src/client";
import { PlatformProvider, useCurrentPrincipalId } from "../src/react/context";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import { ReminderHostProvider, RemindMeLaterProvider, type ReminderHost } from "../src/react/reminders";
import { InboxView, useInboxViewState } from "../src/react/inbox-view";
import { needsActionItems, needsActionSortAt, useNeedsActionSource } from "../src/react/inbox/needs-action";
import type { BffRequest } from "../src/transport";
import { click, render, settle } from "./render";

const pubkey = "a".repeat(64);
const approval = (workflowId: string, status: ApprovalStatus, decidedAt?: string): ApprovalView => ({
  workflowId, actionExecutionId: "00000000-0000-4000-8000-000000000001", actionKey: "workspace.create",
  targetType: "WORKSPACE", targetId: "00000000-0000-4000-8000-000000000002",
  initiatorPrincipalId: "00000000-0000-4000-8000-000000000003", status, expiresAt: "2026-10-20T00:00:00Z",
  decisions: decidedAt ? [{ approverPrincipalId: "00000000-0000-4000-8000-000000000004", decision: ApprovalDecision.Approve, decidedAt, satisfiedSelectors: [] }] : [],
  roleRequirements: [],
});
const waiting = approval("approval-wait", ApprovalStatus.Waiting);
const approved = approval("approval-done", ApprovalStatus.Approved, "2026-10-18T08:00:00Z");

describe("DD-125(5) Needs action source", () => {
  it("lists my pending decisions first and my requests' results by their decision time", () => {
    const items = needsActionItems([waiting, approved], [approved, waiting]);
    expect(items.map((item) => [item.key, item.role])).toEqual([
      ["approval:approval-wait:decide", "approver"],
      ["approval:approval-done:APPROVED", "initiator"],
    ]);
    expect(needsActionSortAt(items[0]!)).toBe(Number.POSITIVE_INFINITY);
    expect(needsActionSortAt(items[1]!)).toBe(Date.parse("2026-10-18T08:00:00Z") / 1000);
  });
});

function reminderHost(): ReminderHost {
  return { scopeKey: "tenant:inbox", pubkey, query: vi.fn().mockResolvedValue([]), publish: vi.fn(), source: vi.fn(), navigate: vi.fn() };
}
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  })) });
});
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); setLocale("en");
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.hasAttribute("data-index") ? 96 : 420; });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return new DOMRect(0, 0, 1200, this.offsetHeight); });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const requests: BffRequest[] = [];
const client = createBffClient({ send: async (request) => {
  requests.push(request);
  if (request.path === "/api/v1/approvals") return { status: 200, body: [waiting] };
  if (request.path === "/api/v1/approvals/initiated") return { status: 200, body: [approved] };
  if (request.path === "/api/v1/approvals/approval-wait") return { status: 200, body: waiting };
  if (request.path === "/api/v1/invitations") return { status: 200, body: [] };
  return { status: 404, body: undefined };
} });
const noRows: never[] = [];
const list = { activeDraftCount: 0, draftList: null, onMarkRead: () => {}, onMarkUnread: () => {}, onOpen: () => {},
  reopenState: () => ({ pending: false, error: false, unknown: false }), sourceChannelId: () => null,
  presentation: () => { throw new Error("No feed rows in this case"); } };
const drafts = { hasSelection: false, renderDetail: () => null };

function Host() {
  const [url, setUrl] = useState<string | null>(null);
  const state = useInboxViewState({ itemId: url, setItemId: setUrl });
  const needsAction = useNeedsActionSource({ client, scopeKey: "principal-1" });
  return <InboxView state={state} status={{ kind: "ready" }} items={noRows} selectedConversationId={null}
    matchesFilter={() => true} isRead={() => true} list={list} drafts={drafts} needsAction={needsAction}
    renderMessageDetail={() => null} />;
}

async function mount() {
  const ui = await render(<PlatformProvider client={client} locale="en"><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
    <TooltipProvider><ReminderHostProvider host={reminderHost()}><RemindMeLaterProvider pubkey={pubkey}><Host /></RemindMeLaterProvider></ReminderHostProvider></TooltipProvider>
  </QueryClientProvider></PlatformProvider>);
  await settle();
  return ui;
}

describe("original Needs action filter over Temporal approvals", () => {
  it("shows both approval kinds in All with the action-required label and keeps done marks local", async () => {
    requests.length = 0;
    const ui = await mount();
    const pendingRow = () => ui.querySelector('[data-testid="home-inbox-item-approval:approval-wait:decide"]');
    await vi.waitFor(() => expect(pendingRow()).not.toBeNull());
    expect(ui.querySelector('[data-testid="home-inbox-item-approval:approval-done:APPROVED"]')?.textContent).toContain("Approved, not carried out yet");
    expect(pendingRow()?.querySelector("[data-inbox-type-label]")?.className).toContain("text-amber-600/80");
    expect(pendingRow()?.textContent).toContain("A workflow is waiting for approval.");

    await click(pendingRow()!.querySelector<HTMLButtonElement>("button[aria-label]")!);
    await vi.waitFor(() => expect(ui.querySelector('[data-testid="home-inbox-needs-action-detail"]')?.textContent).toContain("Approve"));
    expect(requests.some((request) => request.path === "/api/v1/approvals/approval-wait")).toBe(true);
    // Selecting marks the item done on this device only; no read write leaves the browser.
    expect(JSON.parse(localStorage.getItem("kailo-inbox-needs-action-done.v1:principal-1") ?? "[]")).toEqual(["approval:approval-wait:decide"]);
    expect(requests.filter((request) => request.method !== "GET")).toEqual([]);
  });

  it("offers Needs action between Threads and Agents and lists only approval items there", async () => {
    const ui = await mount();
    await vi.waitFor(() => expect(ui.querySelector('[data-testid="home-inbox-item-approval:approval-wait:decide"]')).not.toBeNull());
    const trigger = ui.querySelector<HTMLElement>('[data-testid="inbox-filter-trigger"]')!;
    await act(async () => { trigger.focus(); trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    await settle();
    const labels = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].map((item) => item.textContent);
    expect(labels.slice(0, 6)).toEqual(["All", "Project", "Mentions", "Threads", "Needs action", "Agents"]);
    await click([...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((item) => item.textContent === "Needs action")!);
    expect(trigger.textContent).toBe("Needs action");
    await vi.waitFor(() => expect(ui.querySelector('[data-testid="home-inbox-needs-action-detail"]')).not.toBeNull());
  });
});

// Execute the actual Native HomeView source/prop binding, keeping its unrelated
// Relay feed and Tauri media adapters out of this approval HTTP consumer.
const nativeSource = ts.createSourceFile("HomeView.tsx", readFileSync(new URL(
  "../../../../collaboration/desktop/src/features/home/ui/HomeView.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nativeBindings: string[] = [];
let nativeApprovalProp = "null";
function visitNative(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ["principalId", "needsAction"].includes(node.name.getText(nativeSource)))
    nativeBindings.push(`const ${node.getText(nativeSource)};`);
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(nativeSource) === "InboxView") {
    for (const attribute of node.attributes.properties)
      if (ts.isJsxAttribute(attribute) && attribute.name.getText(nativeSource) === "needsAction"
        && attribute.initializer && ts.isJsxExpression(attribute.initializer))
        nativeApprovalProp = attribute.initializer.expression?.getText(nativeSource) ?? "null";
  }
  ts.forEachChild(node, visitNative);
}
visitNative(nativeSource);
const nativeNeedsAction = new Function("nativeSession", "useCurrentPrincipalId", "useNeedsActionSource",
  ts.transpile(`${nativeBindings.join("\n")}return ${nativeApprovalProp};`, { target: ts.ScriptTarget.ES2022 }));

function NativeApprovalInbox({ bff, onSource }: { bff: typeof client; onSource?: (source: ReturnType<typeof useNeedsActionSource>) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const state = useInboxViewState({ itemId: url, setItemId: setUrl });
  const source = nativeNeedsAction({ client: bff }, useCurrentPrincipalId, (options: Parameters<typeof useNeedsActionSource>[0]) => {
    const value = useNeedsActionSource(options); onSource?.(value); return value;
  });
  return <InboxView state={state} status={{ kind: "ready" }} items={noRows} selectedConversationId={null}
    matchesFilter={() => true} isRead={() => true} list={list} drafts={drafts} needsAction={source}
    renderMessageDetail={() => null} />;
}

it("Native HomeView connects my approval through the shared detail, decision and refreshed result", async () => {
  const calls: BffRequest[] = [];
  let decided = false;
  const bff = createBffClient({ send: async request => {
    calls.push(request);
    if (request.path === "/api/v1/approvals") return { status: 200, body: decided ? [] : [waiting] };
    if (request.path === "/api/v1/approvals/initiated") return { status: 200, body: [approved] };
    if (request.path === "/api/v1/approvals/approval-wait" && request.method === "GET")
      return { status: 200, body: decided ? { ...waiting, status: ApprovalStatus.Approved } : waiting };
    if (request.path === "/api/v1/approvals/approval-wait/decision") {
      decided = true;
      return { status: 200, body: { admitted: true, approverPrincipalId: "native-principal", decision: ApprovalDecision.Approve, status: ApprovalStatus.Approved } };
    }
    return { status: 404, body: undefined };
  } });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const ui = await render(<PlatformProvider client={bff} currentPrincipalId="native-principal" locale="en">
    <QueryClientProvider client={cache}><TooltipProvider><ReminderHostProvider host={reminderHost()}>
      <RemindMeLaterProvider pubkey={pubkey}><NativeApprovalInbox bff={bff} /></RemindMeLaterProvider>
    </ReminderHostProvider></TooltipProvider></QueryClientProvider></PlatformProvider>);
  const row = () => ui.querySelector('[data-testid="home-inbox-item-approval:approval-wait:decide"]');
  await vi.waitFor(() => expect(row()).not.toBeNull());
  await click(row()!.querySelector<HTMLButtonElement>("button[aria-label]")!);
  await vi.waitFor(() => expect(ui.textContent).toContain("Approve"));
  await click([...ui.querySelectorAll("button")].find(button => button.textContent === "Approve")!);
  await click([...ui.querySelectorAll("button")].find(button => button.textContent === "Confirm")!);
  await vi.waitFor(() => expect(row()).toBeNull());
  expect(calls.filter(request => request.method !== "GET").map(request => [request.path, request.body])).toEqual([
    ["/api/v1/approvals/approval-wait/decision", { decision: "APPROVE" }],
  ]);
  expect(ui.querySelector('[data-testid="home-inbox-needs-action-detail"]')?.textContent).toContain("Approved, not carried out yet");
  expect(localStorage.getItem("kailo-inbox-needs-action-done.v1:native-principal")).toContain("approval-wait:decide");
  cache.clear();
});

it("Native session readiness and retirement fence old approval reads, detail and refresh", async () => {
  let finishOld!: (value: { status: number; body: ApprovalView[] }) => void;
  const oldReply = new Promise<{ status: number; body: ApprovalView[] }>(resolve => { finishOld = resolve; });
  const oldCalls: BffRequest[] = [], newCalls: BffRequest[] = [];
  const oldClient = createBffClient({ send: async request => {
    oldCalls.push(request);
    return request.path === "/api/v1/approvals" ? oldReply : { status: 200, body: [] };
  } });
  const newClient = createBffClient({ send: async request => {
    newCalls.push(request);
    return { status: 200, body: request.path === "/api/v1/approvals" ? [{ ...waiting, workflowId: "new-approval" }] : [] };
  } });
  let update!: (value: { bff: typeof client; principal?: string }) => void;
  let oldSource: ReturnType<typeof useNeedsActionSource> | undefined;
  function Sessions() {
    const [session, setSession] = useState<{ bff: typeof client; principal?: string }>({ bff: oldClient });
    update = setSession;
    return <PlatformProvider client={session.bff} currentPrincipalId={session.principal} locale="en">
      <QueryClientProvider client={cache}><TooltipProvider><ReminderHostProvider host={reminderHost()}>
        <RemindMeLaterProvider pubkey={pubkey}><NativeApprovalInbox bff={session.bff}
          onSource={value => { if (session.principal === "old-principal") oldSource = value; }} />
        </RemindMeLaterProvider></ReminderHostProvider></TooltipProvider></QueryClientProvider>
    </PlatformProvider>;
  }
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const ui = await render(<Sessions />);
  await settle();
  expect(oldCalls).toEqual([]); // No inferred device pubkey/default identity while bootstrap is incomplete.
  await act(async () => update({ bff: oldClient, principal: "old-principal" }));
  await vi.waitFor(() => expect(oldCalls).toHaveLength(2));
  const retired = oldSource!;
  await act(async () => update({ bff: newClient, principal: "new-principal" }));
  await vi.waitFor(() => expect(ui.querySelector('[data-testid="home-inbox-item-approval:new-approval:decide"]')).not.toBeNull());
  const before = newCalls.length;
  await act(async () => { finishOld({ status: 200, body: [waiting] }); retired.refresh(); });
  await settle();
  expect(ui.querySelector('[data-testid="home-inbox-item-approval:approval-wait:decide"]')).toBeNull();
  expect(ui.querySelector('[data-testid="home-inbox-needs-action-detail"]')).toBeNull();
  expect(newCalls).toHaveLength(before);
  cache.clear();
});
