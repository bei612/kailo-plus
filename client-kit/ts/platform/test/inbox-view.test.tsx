import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setLocale } from "../src/i18n";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import { ReminderHostProvider, RemindMeLaterProvider, type ReminderHost } from "../src/react/reminders";
import { InboxView, getHomePaneLayout, resolveInboxFilterSelection, useInboxViewState, type InboxViewStatus } from "../src/react/inbox-view";
import { click, render, settle } from "./render";

const pubkey = "a".repeat(64);
type Row = {
  id: string; conversationId: string; latestActivityAt: number; category: "mention" | "thread";
  item: { id: string; channelId: string | null; pubkey: string; content: string };
  groupItems: { id: string }[];
};
const row = (id: string, category: Row["category"], read = false): Row & { read: boolean } => ({
  id: id.repeat(64), conversationId: `conversation-${id}`, latestActivityAt: 10, category, read,
  item: { id: id.repeat(64), channelId: "channel", pubkey, content: `${category} body` }, groupItems: [{ id: id.repeat(64) }],
});
function reminderHost(): ReminderHost {
  return { scopeKey: "tenant:inbox", pubkey, query: vi.fn().mockResolvedValue([]), publish: vi.fn(),
    source: vi.fn(), navigate: vi.fn() };
}
let width = 1200;
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  })) });
});
beforeEach(() => {
  setLocale("en"); localStorage.clear(); width = 1200;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 0, width, 800));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function Host({ rows, status, onUrl }: { rows: (Row & { read: boolean })[]; status: InboxViewStatus; onUrl: (id: string | null) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const state = useInboxViewState({ itemId: url, setItemId: (id) => { setUrl(id); onUrl(id); } });
  return <InboxView state={state} status={status} items={rows} selectedConversationId={rows.find((item) => item.id === state.selectedEventId)?.conversationId ?? null}
    matchesFilter={(item, filter) => filter === "all" || item.category === filter} isRead={(item) => item.read}
    list={{ activeDraftCount: 0, draftList: <p>drafts</p>, onMarkRead: vi.fn(), onMarkUnread: vi.fn(), onOpen: vi.fn(),
      reopenState: () => ({ pending: false, error: false, unknown: false }), sourceChannelId: () => null,
      presentation: (item) => ({ senderLabel: item.category, sender: item.category, avatar: null, preview: item.item.content,
        timestamp: "now", unreadCount: 1, label: item.category, channel: null }) }}
    drafts={{ hasSelection: false, renderDetail: () => <p>draft detail</p> }}
    renderMessageDetail={({ visible, isSinglePanel, onBack }) => visible ? <section data-testid="detail">
      <span data-testid="detail-selection">{state.selectedEventId ?? "none"}</span>
      {isSinglePanel && onBack ? <button onClick={onBack} type="button">back</button> : null}
    </section> : null} />;
}
async function mount(rows: (Row & { read: boolean })[], status: InboxViewStatus = { kind: "ready" }) {
  const onUrl = vi.fn();
  const client = createBffClient({ send: async () => { throw new Error("The shared Inbox body adds no transport"); } });
  const ui = await render(<PlatformProvider client={client} locale="en"><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
    <TooltipProvider><ReminderHostProvider host={reminderHost()}><RemindMeLaterProvider pubkey={pubkey}>
      <Host rows={rows} status={status} onUrl={onUrl} />
    </RemindMeLaterProvider></ReminderHostProvider></TooltipProvider></QueryClientProvider></PlatformProvider>);
  await settle();
  return { ui, onUrl };
}
async function chooseFilter(ui: HTMLElement, label: string) {
  const trigger = ui.querySelector<HTMLElement>('[data-testid="inbox-filter-trigger"]')!;
  await act(async () => { trigger.focus(); trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
  await settle();
  const option = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((item) => item.textContent?.startsWith(label));
  if (!option) throw new Error(`Missing filter ${label}`);
  await click(option);
}

describe("original shared Inbox page body", () => {
  it("keeps the original pane layout and filter selection rules", () => {
    expect(resolveInboxFilterSelection({ isNarrow: false, items: [{ conversationId: "a", id: "1" }], selectedConversationId: "b" }))
      .toEqual({ autoSelectedEventId: "1", preserveSelection: false });
    expect(resolveInboxFilterSelection({ isNarrow: true, items: [{ conversationId: "a", id: "1" }], selectedConversationId: "b" }))
      .toEqual({ autoSelectedEventId: null, preserveSelection: false });
    expect(resolveInboxFilterSelection({ isNarrow: false, items: [{ conversationId: "a", id: "1" }], selectedConversationId: "a" }))
      .toEqual({ autoSelectedEventId: null, preserveSelection: true });
    const narrowReminder = getHomePaneLayout({ hasAuxiliaryPane: false, homeWidthPx: 500, inboxListWidthPx: 360, isDrafts: false,
      isMessagesMode: false, isNarrow: true, isReminders: true, isSinglePanelAuxiliaryView: false, selectedDraft: false,
      selectedEvent: false, selectedReminder: true, threadPanelWidthPx: 380 });
    expect(narrowReminder).toMatchObject({ showListPane: false, showDetailPane: true, isSinglePanelReminderDetailView: true });
    const wide = getHomePaneLayout({ hasAuxiliaryPane: true, homeWidthPx: 1000, inboxListWidthPx: 500, isDrafts: false,
      isMessagesMode: true, isNarrow: false, isReminders: false, isSinglePanelAuxiliaryView: false, selectedDraft: false,
      selectedEvent: true, selectedReminder: false, threadPanelWidthPx: 380 });
    expect(wide).toMatchObject({ showListPane: true, showDetailPane: true, auxiliaryPaneWidthPx: 380, effectiveInboxListWidthPx: 320 });
  });

  it("auto-selects locally and moves to the first visible row on a filter change without writing the URL", async () => {
    const mention = row("1", "mention"), thread = row("2", "thread");
    const { ui, onUrl } = await mount([mention, thread]);
    await vi.waitFor(() => expect(ui.querySelector('[data-testid="detail-selection"]')?.textContent).toBe(mention.id));
    expect(onUrl).not.toHaveBeenCalledWith(mention.id);
    await chooseFilter(ui, "Threads");
    await vi.waitFor(() => expect(ui.querySelector('[data-testid="detail-selection"]')?.textContent).toBe(thread.id));
    expect(ui.querySelector(`[data-testid="home-inbox-item-${mention.id}"]`)).toBeNull();
    expect(ui.querySelector(`[data-testid="home-inbox-item-${thread.id}"]`)).not.toBeNull();
  });

  it("uses the URL for explicit selection and the original single-panel back path when narrow", async () => {
    width = 500;
    const mention = row("1", "mention");
    const { ui, onUrl } = await mount([mention]);
    expect(ui.querySelector('[data-testid="detail"]')).toBeNull();
    await click(ui.querySelector<HTMLButtonElement>(`[data-testid="home-inbox-item-${mention.id}"] button[aria-label]`)!);
    expect(onUrl).toHaveBeenLastCalledWith(mention.id);
    expect(ui.querySelector('[data-testid="home-inbox-list"]')).toBeNull();
    await click([...ui.querySelectorAll("button")].find((item) => item.textContent === "back")!);
    expect(onUrl).toHaveBeenLastCalledWith(null);
    expect(ui.querySelector('[data-testid="home-inbox-list"]')).not.toBeNull();
  });

  it("renders the original unavailable state with its retry action instead of an empty Inbox", async () => {
    const retry = vi.fn();
    const { ui } = await mount([row("1", "mention")], { kind: "unavailable", message: "Read state unavailable", onRetry: retry });
    expect(ui.textContent).toContain("Home feed unavailable");
    expect(ui.textContent).toContain("Read state unavailable");
    expect(ui.querySelector('[data-testid="home-inbox"]')).toBeNull();
    await click([...ui.querySelectorAll("button")].find((item) => item.textContent === "Try again")!);
    expect(retry).toHaveBeenCalledOnce();
  });
});
