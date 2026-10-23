// DD-138(4)(5), 07 §4.8.3 / §4.8.4 呈现: deep links into native pages, component notification
// rows and filters in the Kailo Inbox, per-category alert gating, and component search groups.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ComponentNotificationCategory,
  ComponentSearchResultKind,
  ComponentSearchSourceState,
  NativePageCategory,
  type ComponentNotificationView,
} from "@client-kit/contracts";
import { setLocale } from "../src/i18n";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import { ReminderHostProvider, RemindMeLaterProvider, type ReminderHost } from "../src/react/reminders";
import { InboxView, useInboxViewState } from "../src/react/inbox-view";
import { NativeApplicationPage } from "../src/react/native-application-page";
import { nativeDeepLinkUrl, validComponentPath } from "../src/react/native-deep-link";
import {
  componentNotificationInFilter,
  componentNotificationPresentation,
  componentNotificationSortAt,
  componentText,
  componentUnreadBadgeCount,
  freshComponentNotifications,
  useComponentNotificationSource,
  validComponentNotificationPage,
} from "../src/react/inbox/component-notifications";
import {
  DEFAULT_COMPONENT_ALERTS_ENABLED,
  componentAlertAllowed,
  componentNotificationSlot,
  sanitizeComponentAlertsEnabled,
} from "../src/react/notifications/component-alerts";
import { groupComponentSearchResults, unavailableComponentSources, validComponentSearchPage, type ComponentSearchHit } from "../src/react/search/componentSearch";
import { componentSearchSections } from "../src/react/search/TopbarSearch";
import type { InboxFilter } from "../src/react/inbox-surface";
import type { BffRequest } from "../src/transport";
import { click, render, settle } from "./render";

const page = { bindingId: "binding-files", projectionGeneration: 3,
  url: "https://files.example.test/app/#/home", origin: "https://files.example.test",
  allowedOrigins: ["https://files.example.test"] };

const notification = (id: string, category: ComponentNotificationCategory, extra: Partial<ComponentNotificationView> = {}): ComponentNotificationView => ({
  notificationId: id, bindingId: page.bindingId, workspaceId: "workspace-1", nativePageCategory: NativePageCategory.FileStorage,
  category, title: { ZH_CN: `张三分享了 ${id}`, EN: `Zhang San shared ${id}` }, summary: { ZH_CN: "季度报告", EN: "Quarterly report" },
  path: `/files/${id}?view=1`, actorPrincipalId: "actor-1", actorDisplayName: "Zhang San",
  occurredAt: "2026-10-22T08:00:00Z", receivedAt: "2026-10-22T08:00:01Z", ...extra,
});

describe("07 §4.8.3 deep link path", () => {
  it("accepts only a single-slash relative path without backslash, whitespace or control characters", () => {
    for (const path of ["/", "/files/a?x=1", "/a/b#c", `/${"a".repeat(1023)}`]) expect(validComponentPath(path)).toBe(true);
    for (const path of [undefined, 1, "", "files", "//evil.test/x", "/a\\b", "/a b", "/a\tb", "/a\nb", "/a\u0000", "/a\u007f",
      "/a\u0085", "/a\u00a0b", "/a\u3000b", `/${"a".repeat(1024)}`, "https://evil.test/"]) expect(validComponentPath(path)).toBe(false);
  });

  it("joins the path to the descriptor origin and adds the launch parameters, else opens the entry page", () => {
    const presentation = { theme: "dark", locale: "zh-CN" } as const;
    const deep = new URL(nativeDeepLinkUrl(page, "/files/a?view=1#top", presentation));
    expect(deep.origin).toBe(page.origin);
    expect(deep.pathname).toBe("/files/a");
    expect(deep.hash).toBe("#top");
    expect([...deep.searchParams]).toEqual([["view", "1"], ["kailo_theme", "dark"], ["kailo_locale", "zh-CN"]]);
    for (const path of [undefined, "//evil.test/x", "/a\\b", "files/a"]) {
      const launch = new URL(nativeDeepLinkUrl(page, path, presentation));
      expect(`${launch.origin}${launch.pathname}${launch.hash}`).toBe("https://files.example.test/app/#/home");
    }
  });

  it("opens the native page frame at the path", async () => {
    const client = createBffClient({ send: async () => ({ status: 200, body: page }) });
    const host = await render(<PlatformProvider client={client} locale="en">
      <NativeApplicationPage bindingId={page.bindingId} path="/files/a?view=1" />
    </PlatformProvider>);
    await settle();
    const src = new URL(host.querySelector("iframe")!.getAttribute("src")!);
    expect(src.origin + src.pathname).toBe("https://files.example.test/files/a");
    expect(src.searchParams.get("view")).toBe("1");
    expect(src.searchParams.get("kailo_locale")).toBe("en");
  });
});

describe("07 §4.8.3 Inbox rows", () => {
  it("puts every item in All, MENTIONED in Mentions and ACCESS_REQUESTED in Needs action", () => {
    const filters: InboxFilter[] = ["all", "project", "mention", "thread", "needs_action", "agent_activity", "reminders", "drafts"];
    const member = (category: ComponentNotificationCategory) => filters.filter((filter) => componentNotificationInFilter({ category }, filter));
    expect(member(ComponentNotificationCategory.Shared)).toEqual(["all"]);
    expect(member(ComponentNotificationCategory.Mentioned)).toEqual(["all", "mention"]);
    expect(member(ComponentNotificationCategory.AccessRequested)).toEqual(["all", "needs_action"]);
    for (const category of [ComponentNotificationCategory.Commented, ComponentNotificationCategory.TaskCompleted, ComponentNotificationCategory.ContentUpdated])
      expect(member(category)).toEqual(["all"]);
  });

  it("maps a row to the Kailo locale, the category label and the presentation category source", () => {
    const item = notification("n1", ComponentNotificationCategory.Shared);
    expect(componentText(item.title, "zh-CN")).toBe("张三分享了 n1");
    expect(componentText(item.title, "en")).toBe("Zhang San shared n1");
    expect(componentText({ ZH_CN: "", EN: "Only English" }, "zh-CN")).toBe("Only English");
    const zh = componentNotificationPresentation(item, "zh-CN", (key) => ({ "bindings.native.files": "云盘", "inbox.component.shared": "分享给你" } as Record<string, string>)[key] ?? key);
    expect(zh).toEqual({ category: "分享给你", source: "云盘", actor: "Zhang San", title: "张三分享了 n1", summary: "季度报告" });
    expect(componentNotificationSortAt(item)).toBe(Date.parse("2026-10-22T08:00:01Z") / 1000);
  });

  it("rejects malformed pages", () => {
    const valid = { items: [notification("n1", ComponentNotificationCategory.Shared)], unreadCount: 1 };
    expect(validComponentNotificationPage(valid)).toBe(true);
    expect(validComponentNotificationPage({ items: [], unreadCount: 0, nextCursor: "c" })).toBe(true);
    for (const page of [null, { items: [] }, { items: {}, unreadCount: 0 }, { items: [], unreadCount: -1 },
      { items: [{ ...notification("n1", ComponentNotificationCategory.Shared), title: "plain" }], unreadCount: 1 },
      { items: [{ ...notification("n1", ComponentNotificationCategory.Shared), receivedAt: "never" }], unreadCount: 1 }])
      expect(validComponentNotificationPage(page)).toBe(false);
  });
});

describe("07 §4.8.3 提醒 per-category alerts", () => {
  const settings = { desktopEnabled: true, notifyWhileViewing: false, componentAlertsEnabled: { ...DEFAULT_COMPONENT_ALERTS_ENABLED } };

  it("defaults every category on and keeps stored booleans only", () => {
    expect(Object.values(sanitizeComponentAlertsEnabled(undefined)).every(Boolean)).toBe(true);
    const stored = sanitizeComponentAlertsEnabled({ SHARED: false, MENTIONED: "no", UNKNOWN: false });
    expect(stored.SHARED).toBe(false);
    expect(stored.MENTIONED).toBe(true);
    expect(Object.keys(stored).sort()).toEqual(Object.keys(DEFAULT_COMPONENT_ALERTS_ENABLED).sort());
  });

  it("alerts only when the category is on and the global settings allow it", () => {
    const base = { settings, category: ComponentNotificationCategory.Shared, permission: "granted", visible: false };
    expect(componentAlertAllowed(base)).toBe(true);
    expect(componentAlertAllowed({ ...base, settings: { ...settings, componentAlertsEnabled: { ...settings.componentAlertsEnabled, SHARED: false } } })).toBe(false);
    expect(componentAlertAllowed({ ...base, settings: { ...settings, desktopEnabled: false } })).toBe(false);
    expect(componentAlertAllowed({ ...base, permission: "denied" })).toBe(false);
    expect(componentAlertAllowed({ ...base, visible: true })).toBe(false);
    expect(componentAlertAllowed({ ...base, visible: true, settings: { ...settings, notifyWhileViewing: true } })).toBe(true);
    expect(componentNotificationSlot(ComponentNotificationCategory.AccessRequested)).toBe("needs_action");
    expect(componentNotificationSlot(ComponentNotificationCategory.Mentioned)).toBe("mention");
  });

  it("alerts only newly arrived unread items and never the first page", () => {
    const read = (item: ComponentNotificationView) => Boolean(item.readAt);
    const first = [notification("a", ComponentNotificationCategory.Shared)];
    const seeded = freshComponentNotifications(null, first, read);
    expect(seeded.fresh).toEqual([]);
    const next = [notification("b", ComponentNotificationCategory.Mentioned), notification("c", ComponentNotificationCategory.Shared, { readAt: "2026-10-22T09:00:00Z" }), ...first];
    expect(freshComponentNotifications(seeded.seen, next, read).fresh.map((item) => item.notificationId)).toEqual(["b"]);
  });

  it("does not count disabled categories in the badge but still lists them", () => {
    const items = [notification("a", ComponentNotificationCategory.Shared), notification("b", ComponentNotificationCategory.Mentioned),
      notification("c", ComponentNotificationCategory.Shared, { readAt: "2026-10-22T09:00:00Z" })];
    const isRead = (item: ComponentNotificationView) => Boolean(item.readAt);
    expect(componentUnreadBadgeCount({ unreadCount: 5, items, isRead, enabled: undefined })).toBe(5);
    expect(componentUnreadBadgeCount({ unreadCount: 5, items, isRead,
      enabled: { ...DEFAULT_COMPONENT_ALERTS_ENABLED, SHARED: false } })).toBe(4);
    expect(componentUnreadBadgeCount({ unreadCount: 0, items, isRead,
      enabled: { ...DEFAULT_COMPONENT_ALERTS_ENABLED, SHARED: false } })).toBe(0);
  });
});

describe("07 §4.8.4 component search results", () => {
  const hit = (title: string, category: NativePageCategory, kind = ComponentSearchResultKind.File): ComponentSearchHit =>
    ({ bindingId: `binding-${category}`, nativePageCategory: category, kind, title, path: `/${title}` });

  it("groups by presentation category in sidebar order and keeps Core's order inside a group", () => {
    const groups = groupComponentSearchResults([hit("q1", NativePageCategory.DataQuery, ComponentSearchResultKind.Question),
      hit("f1", NativePageCategory.FileStorage), hit("k1", NativePageCategory.Knowledge, ComponentSearchResultKind.KnowledgeBase),
      hit("f2", NativePageCategory.FileStorage, ComponentSearchResultKind.Folder)]);
    expect(groups.map((group) => [group.category, group.results.map((result) => result.title)])).toEqual([
      ["file_storage", ["f1", "f2"]], ["knowledge", ["k1"]], ["data_query", ["q1"]]]);
  });

  it("labels sections 云盘/知识库/问数 and drops a category without a Kailo entry", () => {
    setLocale("zh-CN");
    const sections = componentSearchSections([
      { kind: "component", component: hit("k1", NativePageCategory.Knowledge) },
      { kind: "component", component: { ...hit("x", NativePageCategory.FileStorage), nativePageCategory: "other" as unknown as NativePageCategory } },
      { kind: "component", component: hit("f1", NativePageCategory.FileStorage) },
    ]);
    expect(sections.map((section) => [section.key, section.title, section.results.length])).toEqual([
      ["component-file_storage", "云盘", 1], ["component-knowledge", "知识库", 1]]);
    setLocale("en");
  });

  it("reports each unavailable source once and validates the page shape", () => {
    expect(unavailableComponentSources([
      { nativePageCategory: NativePageCategory.Knowledge, state: ComponentSearchSourceState.Unavailable },
      { nativePageCategory: NativePageCategory.FileStorage, state: ComponentSearchSourceState.Available },
      { nativePageCategory: NativePageCategory.Knowledge, state: ComponentSearchSourceState.Unavailable },
    ])).toEqual(["knowledge"]);
    expect(validComponentSearchPage({ results: [hit("f1", NativePageCategory.FileStorage)], sources: [] })).toBe(true);
    expect(validComponentSearchPage({ results: [{ title: "x" }], sources: [] })).toBe(false);
    expect(validComponentSearchPage({ results: [] })).toBe(false);
  });
});

describe("Inbox view with component notifications", () => {
  const pubkey = "a".repeat(64);
  const requests: BffRequest[] = [];
  const items = [notification("n-share", ComponentNotificationCategory.Shared),
    notification("n-access", ComponentNotificationCategory.AccessRequested, { receivedAt: "2026-10-22T09:00:00Z" })];
  const client = createBffClient({ send: async (request) => {
    requests.push(request);
    if (request.path.startsWith("/api/v1/inbox/component-notifications?")) return { status: 200, body: { items, unreadCount: 2 } };
    if (request.path === "/api/v1/inbox/component-notifications/read") return { status: 204, body: undefined };
    return { status: 404, body: undefined };
  } });
  const reminderHost = (): ReminderHost => ({ scopeKey: "tenant:inbox", pubkey, query: vi.fn().mockResolvedValue([]), publish: vi.fn(), source: vi.fn(), navigate: vi.fn() });
  const list = { activeDraftCount: 0, draftList: null, onMarkRead: () => {}, onMarkUnread: () => {}, onOpen: () => {},
    reopenState: () => ({ pending: false, error: false, unknown: false }), sourceChannelId: () => null,
    presentation: () => { throw new Error("No feed rows in this case"); } };
  const opened: string[] = [];

  function Host() {
    const [url, setUrl] = useState<string | null>(null);
    const state = useInboxViewState({ itemId: url, setItemId: setUrl });
    const source = useComponentNotificationSource({ client, scopeKey: "principal-1" });
    return <InboxView state={state} status={{ kind: "ready" }} items={[]} selectedConversationId={null}
      matchesFilter={() => true} isRead={() => true} list={list} drafts={{ hasSelection: false, renderDetail: () => null }}
      componentNotifications={{ source, onOpen: (item) => { opened.push(item.path); void source.markRead([item]); } }}
      renderMessageDetail={() => null} />;
  }

  beforeAll(() => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    })) });
  });
  beforeEach(() => {
    localStorage.clear(); setLocale("zh-CN"); requests.length = 0; opened.length = 0;
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.hasAttribute("data-index") ? 96 : 420; });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return new DOMRect(0, 0, 1200, this.offsetHeight); });
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); setLocale("en"); });

  it("lists the rows with the category source, opens one and marks it read in Core", async () => {
    const ui = await render(<PlatformProvider client={client} locale="zh-CN"><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <TooltipProvider><ReminderHostProvider host={reminderHost()}><RemindMeLaterProvider pubkey={pubkey}><Host /></RemindMeLaterProvider></ReminderHostProvider></TooltipProvider>
    </QueryClientProvider></PlatformProvider>);
    await settle();
    const row = (id: string) => ui.querySelector(`[data-testid="home-inbox-item-component-${id}"]`);
    await vi.waitFor(() => expect(row("n-share")).not.toBeNull());
    expect(row("n-share")?.textContent).toContain("分享给你 · 云盘");
    expect(row("n-share")?.textContent).toContain("张三分享了 n-share");
    expect(row("n-share")?.textContent).toContain("Zhang San");
    expect(row("n-access")?.querySelector("[data-inbox-type-label]")?.className).toContain("text-amber-600/80");
    expect(ui.textContent).not.toContain("binding-files");

    await click(row("n-share")!.querySelector<HTMLButtonElement>("button[aria-label]")!);
    expect(opened).toEqual(["/files/n-share?view=1"]);
    await vi.waitFor(() => expect(requests.some((request) => request.method === "POST")).toBe(true));
    expect(requests.find((request) => request.method === "POST")).toEqual({ method: "POST",
      path: "/api/v1/inbox/component-notifications/read", body: { notificationIds: ["n-share"] } });
    expect(requests[0]?.path).toBe("/api/v1/inbox/component-notifications?limit=50");
  });
});
