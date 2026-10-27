import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApprovalStatus, ComponentNotificationCategory, type ApprovalView, type ComponentNotificationView } from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { translate } from "../src/i18n";
import { PlatformProvider } from "../src/react/context";
import { InboxView, useInboxViewState } from "../src/react/inbox-view";
import type { InboxFilter } from "../src/react/inbox-surface";
import { useNeedsActionSource } from "../src/react/inbox/needs-action";
import { useComponentNotificationSource } from "../src/react/inbox/component-notifications";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import { ReminderHostProvider, RemindMeLaterProvider, type ReminderHost } from "../src/react/reminders";
import type { BffRequest } from "../src/transport";
import { click, render, settle } from "./render";

const pubkey = "a".repeat(64);
const approval: ApprovalView = { workflowId: "retry-approval", actionExecutionId: "execution", actionKey: "workspace.create",
  targetType: "WORKSPACE", targetId: "workspace", initiatorPrincipalId: "initiator", status: ApprovalStatus.Waiting,
  expiresAt: "2026-12-20T00:00:00Z", decisions: [], roleRequirements: [] };
const component: ComponentNotificationView = { notificationId: "retry-component", bindingId: "binding", workspaceId: "workspace",
  category: ComponentNotificationCategory.AccessRequested, title: { EN: "Access requested", ZH_CN: "访问申请" },
  summary: { EN: "Read the file", ZH_CN: "读取文件" }, path: "/file", actorPrincipalId: "actor",
  occurredAt: "2026-10-27T00:00:00Z", receivedAt: "2026-10-27T00:00:01Z" };
const reminders: ReminderHost = { scopeKey: "retry-principal", pubkey, query: async () => [], publish: vi.fn(), source: vi.fn(), navigate: vi.fn() };
const list = { activeDraftCount: 0, draftList: null, onMarkRead: () => {}, onMarkUnread: () => {}, onOpen: () => {},
  reopenState: () => ({ pending: false, error: false, unknown: false }), sourceChannelId: () => null,
  presentation: () => { throw new Error("No ordinary feed in this case"); } };
function Host({ client, filter }: { client: ReturnType<typeof createBffClient>; filter: InboxFilter }) {
  const [item, setItem] = useState<string | null>(null);
  const state = useInboxViewState({ itemId: item, setItemId: setItem });
  useEffect(() => state.setFilter(filter), [filter, state.setFilter]);
  const needsAction = useNeedsActionSource({ client, scopeKey: "retry-principal" });
  const componentSource = useComponentNotificationSource({ client, scopeKey: "retry-principal" });
  return <InboxView state={state} status={{ kind: "ready" }} items={[]} matchesFilter={() => true} isRead={() => true}
    selectedConversationId={null} list={list} drafts={{ hasSelection: false, renderDetail: () => null }}
    needsAction={needsAction} componentNotifications={{ source: componentSource, onOpen: () => {} }} renderMessageDetail={() => null} />;
}
async function mount(client: ReturnType<typeof createBffClient>, filter: InboxFilter, locale: "en" | "zh-CN" = "en") {
  const ui = await render(<PlatformProvider client={client} currentPrincipalId="retry-principal" locale={locale}>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <TooltipProvider><ReminderHostProvider host={reminders}><RemindMeLaterProvider pubkey={pubkey}>
        <Host client={client} filter={filter} />
      </RemindMeLaterProvider></ReminderHostProvider></TooltipProvider>
    </QueryClientProvider>
  </PlatformProvider>);
  await settle();
  return ui.querySelector<HTMLElement>('[data-testid="home-inbox-list"]')!;
}
beforeAll(() => Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({
  matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
})) }));
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.hasAttribute("data-index") ? 96 : 420; });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return new DOMRect(0, 0, 1200, this.offsetHeight); });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const approvalRow = '[data-testid="home-inbox-item-approval:retry-approval:decide"]';
const componentRow = '[data-testid="home-inbox-item-component-retry-component"]';

for (const filter of ["all", "needs_action"] as const) for (const failedSource of ["approval", "component"] as const) {
  it(`Inbox explicit retry restores ${failedSource} in ${filter} without discarding the other source`, async () => {
    const locale = filter === "all" ? "en" : "zh-CN";
    let failing = true;
    const calls: BffRequest[] = [];
    const isComponent = (request: BffRequest) => request.path.startsWith("/api/v1/inbox/component-notifications?");
    const failed = (request: BffRequest) => failedSource === "component" ? isComponent(request) : request.path === "/api/v1/approvals";
    const client = createBffClient({ send: async request => {
      calls.push(request);
      if (failing && failed(request)) return { status: 503, body: { reason: "DEPENDENCY_UNAVAILABLE" } };
      if (isComponent(request)) return { status: 200, body: { items: [component], unreadCount: 1 } };
      if (request.path === "/api/v1/approvals") return { status: 200, body: [approval] };
      if (request.path === "/api/v1/approvals/retry-approval") return { status: 200, body: approval };
      return { status: 200, body: [] };
    } });
    const pane = await mount(client, filter, locale);
    await vi.waitFor(() => expect(pane.textContent).toContain(translate(locale, "platform.loadFailed")));
    expect(pane.querySelector(failedSource === "approval" ? componentRow : approvalRow)).not.toBeNull();
    expect(pane.querySelector(failedSource === "approval" ? approvalRow : componentRow)).toBeNull();
    const otherCalls = () => calls.filter(request => failedSource === "approval" ? isComponent(request) : request.path === "/api/v1/approvals").length;
    const before = otherCalls();
    failing = false;
    await click([...pane.querySelectorAll("button")].find(button => button.textContent === translate(locale, "platform.retry"))!);
    await vi.waitFor(() => expect(pane.querySelector(failedSource === "approval" ? approvalRow : componentRow)).not.toBeNull());
    expect(pane.querySelector(failedSource === "approval" ? componentRow : approvalRow)).not.toBeNull();
    expect(pane.textContent).not.toContain(translate(locale, "platform.loadFailed"));
    expect(otherCalls()).toBe(before);
    expect(calls.filter(request => request.method !== "GET")).toEqual([]);
  });
}

it("Inbox never announces a complete empty result while both visible reads are pending or failed", async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let failing = true;
  const client = createBffClient({ send: async request => {
    await pending;
    if (failing) return { status: 403, body: { reason: "PERMISSION_DENIED" } };
    return { status: 200, body: request.path.startsWith("/api/v1/inbox/component-notifications?") ? { items: [], unreadCount: 0 } : [] };
  } });
  const pane = await mount(client, "needs_action");
  expect(pane.textContent).toContain("Loading…");
  expect(pane.textContent).not.toContain("Nothing needs action");
  await act(async () => release());
  await vi.waitFor(() => expect(pane.textContent).toContain(translate("en", "platform.loadFailed")));
  expect(pane.textContent).not.toContain("Nothing needs action");
  failing = false;
  await click([...pane.querySelectorAll("button")].find(button => button.textContent === translate("en", "platform.retry"))!);
  await vi.waitFor(() => expect(pane.textContent).toContain("Nothing needs action"));
  expect(pane.textContent).not.toContain(translate("en", "platform.loadFailed"));
});
