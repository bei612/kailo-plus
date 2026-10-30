// DD-138(4), 07 §4.8.3 呈现: component notifications in the Kailo Inbox. Core is the authority
// (ComponentNotification, not projected to Relay); this module reads the caller's page through
// the BFF, keeps the optimistic read marks and renders one Inbox row per item. Rows name the
// presentation category (云盘/知识工程/数据建模) as their source, never a component, type key or binding.
// All items are in 「全部」; MENTIONED also in 「提及」, ACCESS_REQUESTED also in 「需要处理」.
// Opening marks the item read and opens the binding's native page at `path` (host navigation).
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MailOpen, Bell } from "lucide-react";
import { ComponentNotificationCategory, type ComponentNotificationPage, type ComponentNotificationView } from "@client-kit/contracts";
import type { BffClient } from "../../client";
import { relativeTime } from "../../format";
import type { PlatformLocale, PlatformMessageKey } from "../../i18n";
import { useLocale, useUiT } from "../context";
import { InboxRow } from "../inbox-row";
import { InboxRowActionButton, type InboxFilter } from "../inbox-surface";
import { UserAvatar } from "../messages/UserAvatar";
import { nativePageCategoryTitle } from "../native-page-category";
import { componentAlertEnabled, type ComponentAlertsEnabled } from "../notifications/component-alerts";

export type ComponentNotificationItem = ComponentNotificationView;

export type ComponentNotificationSource = {
  items: readonly ComponentNotificationItem[];
  status: "loading" | "ready" | "unavailable";
  /** Server unread total less the items read optimistically here (not filtered by alert settings). */
  unreadCount: number;
  isRead: (item: ComponentNotificationItem) => boolean;
  /** Optimistic: the items read at once, Core told in batches of ≤100; a failure restores them. */
  markRead: (items: readonly ComponentNotificationItem[]) => Promise<void>;
  refresh: () => void;
};

export const COMPONENT_NOTIFICATION_PAGE_LIMIT = 50;
export const COMPONENT_NOTIFICATION_REFRESH_MS = 30_000;
const READ_BATCH = 100;

const categoryLabelKeys = {
  [ComponentNotificationCategory.Shared]: "inbox.component.shared",
  [ComponentNotificationCategory.Mentioned]: "inbox.component.mentioned",
  [ComponentNotificationCategory.Commented]: "inbox.component.commented",
  [ComponentNotificationCategory.AccessRequested]: "inbox.component.accessRequested",
  [ComponentNotificationCategory.TaskCompleted]: "inbox.component.taskCompleted",
  [ComponentNotificationCategory.ContentUpdated]: "inbox.component.contentUpdated",
} as const satisfies Record<ComponentNotificationCategory, PlatformMessageKey>;

/** The ZH_CN or EN text for the current Kailo locale; the other one only when it is empty. */
export function componentText(text: { ZH_CN: string; EN: string } | undefined, locale: PlatformLocale): string {
  if (!text) return "";
  const [preferred, other] = locale === "zh-CN" ? [text.ZH_CN, text.EN] : [text.EN, text.ZH_CN];
  return preferred.trim() ? preferred : other;
}

const isText = (value: unknown): value is { ZH_CN: string; EN: string } =>
  typeof value === "object" && value !== null && typeof (value as Record<string, unknown>).ZH_CN === "string"
  && typeof (value as Record<string, unknown>).EN === "string";
const optionalString = (value: unknown) => value === undefined || typeof value === "string";

/** Shape check of a page; a malformed page is a failure, never "no notifications". */
export function validComponentNotificationPage(value: unknown): value is ComponentNotificationPage {
  if (typeof value !== "object" || value === null) return false;
  const page = value as Record<string, unknown>;
  if (!Array.isArray(page.items) || !Number.isSafeInteger(page.unreadCount) || (page.unreadCount as number) < 0
    || !optionalString(page.nextCursor)) return false;
  return page.items.every((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return false;
    const item = entry as Record<string, unknown>;
    return typeof item.notificationId === "string" && typeof item.bindingId === "string"
      && typeof item.category === "string" && isText(item.title) && (item.summary === undefined || isText(item.summary))
      && typeof item.path === "string" && typeof item.receivedAt === "string" && Number.isFinite(Date.parse(item.receivedAt))
      && typeof item.occurredAt === "string" && optionalString(item.workspaceId) && optionalString(item.readAt)
      && optionalString(item.actorDisplayName) && optionalString(item.actorPicture) && optionalString(item.nativePageCategory);
  });
}

/** 07 §4.8.3 分类: every item in 「全部」, MENTIONED in 「提及」, ACCESS_REQUESTED in 「需要处理」. */
export function componentNotificationInFilter(item: Pick<ComponentNotificationItem, "category">, filter: InboxFilter): boolean {
  if (filter === "all") return true;
  if (filter === "mention") return item.category === ComponentNotificationCategory.Mentioned;
  if (filter === "needs_action") return item.category === ComponentNotificationCategory.AccessRequested;
  return false;
}

/** Inbox sort position in Unix seconds (rows share one descending order). */
export function componentNotificationSortAt(item: Pick<ComponentNotificationItem, "receivedAt">): number {
  const at = Date.parse(item.receivedAt);
  return Number.isFinite(at) ? Math.floor(at / 1000) : 0;
}

/**
 * Unread badge contribution: Core's unread total less the items read here and the loaded
 * unread items whose category alert is off (07 §4.8.3: a disabled category stops its badge count).
 */
export function componentUnreadBadgeCount({ unreadCount, items, isRead, enabled }: {
  unreadCount: number;
  items: readonly ComponentNotificationItem[];
  isRead: (item: ComponentNotificationItem) => boolean;
  enabled: ComponentAlertsEnabled | undefined;
}): number {
  const muted = items.filter((item) => !isRead(item) && !componentAlertEnabled(enabled, item.category)).length;
  return Math.max(0, unreadCount - muted);
}

/**
 * Newly arrived unread items since the last seen set. The first page seen only seeds the set,
 * so the existing backlog never alerts. The set is bounded by what the page lists.
 */
export function freshComponentNotifications(seen: ReadonlySet<string> | null, items: readonly ComponentNotificationItem[],
  isRead: (item: ComponentNotificationItem) => boolean): { fresh: ComponentNotificationItem[]; seen: Set<string> } {
  const next = new Set(items.map((item) => item.notificationId));
  if (seen === null) return { fresh: [], seen: next };
  return { fresh: items.filter((item) => !seen.has(item.notificationId) && !isRead(item)), seen: next };
}

/**
 * Host adapter: `scopeKey` must be the trusted platform identity (the tenant Principal), so a
 * read mark or cache never crosses people sharing a browser. Refreshes every 30 s and on focus.
 */
export function useComponentNotificationSource({ client, scopeKey, enabled = true }: {
  client: Pick<BffClient, "componentNotifications" | "markComponentNotificationsRead">;
  scopeKey: string;
  enabled?: boolean;
}): ComponentNotificationSource {
  const queryClient = useQueryClient();
  const queryKey = React.useMemo(() => ["platform", "inbox-component-notifications", scopeKey] as const, [scopeKey]);
  const query = useQuery({
    queryKey,
    enabled,
    refetchInterval: COMPONENT_NOTIFICATION_REFRESH_MS,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const page: unknown = await client.componentNotifications({ limit: COMPONENT_NOTIFICATION_PAGE_LIMIT });
      if (!validComponentNotificationPage(page)) throw new Error("Invalid component notification page");
      return page;
    },
  });
  const [localRead, setLocalRead] = React.useState<{ scopeKey: string; ids: ReadonlySet<string> }>(() => ({ scopeKey, ids: new Set() }));
  const readIds = localRead.scopeKey === scopeKey ? localRead.ids : null;
  const isRead = React.useCallback((item: ComponentNotificationItem) =>
    Boolean(item.readAt) || readIds?.has(item.notificationId) === true, [readIds]);
  const markRead = React.useCallback(async (items: readonly ComponentNotificationItem[]) => {
    const ids = [...new Set(items.filter((item) => !item.readAt).map((item) => item.notificationId))];
    if (ids.length === 0) return;
    const update = (change: (current: Set<string>) => void) => setLocalRead((previous) => {
      const next = new Set(previous.scopeKey === scopeKey ? previous.ids : []);
      change(next);
      return { scopeKey, ids: next };
    });
    update((current) => { for (const id of ids) current.add(id); });
    try {
      for (let start = 0; start < ids.length; start += READ_BATCH) {
        await client.markComponentNotificationsRead(ids.slice(start, start + READ_BATCH));
      }
      await queryClient.invalidateQueries({ queryKey });
    } catch (error) {
      update((current) => { for (const id of ids) current.delete(id); });
      throw error;
    }
  }, [client, queryClient, queryKey, scopeKey]);
  const refresh = React.useCallback(() => { void queryClient.invalidateQueries({ queryKey }); }, [queryClient, queryKey]);
  const items = query.data?.items;
  const serverUnread = query.data?.unreadCount ?? 0;
  const unreadCount = React.useMemo(() => Math.max(0, serverUnread
    - (items ?? []).filter((item) => !item.readAt && readIds?.has(item.notificationId)).length), [items, serverUnread, readIds]);
  return React.useMemo<ComponentNotificationSource>(() => ({
    items: items ?? [],
    status: query.isError ? "unavailable" : query.isSuccess ? "ready" : "loading",
    unreadCount, isRead, markRead, refresh,
  }), [items, query.isError, query.isSuccess, unreadCount, isRead, markRead, refresh]);
}

/** Row labels shared by the Inbox row and a desktop notification. */
export function componentNotificationPresentation(item: ComponentNotificationItem, locale: PlatformLocale,
  t: (key: PlatformMessageKey) => string) {
  const categoryKey = (categoryLabelKeys as Partial<Record<string, PlatformMessageKey>>)[item.category];
  const source = nativePageCategoryTitle(item.nativePageCategory, t);
  return {
    category: categoryKey ? t(categoryKey) : "",
    source,
    actor: item.actorDisplayName?.trim() || null,
    title: componentText(item.title, locale),
    summary: componentText(item.summary, locale),
  };
}

export function ComponentNotificationInboxRow({ item, read, onOpen, onMarkRead }: {
  item: ComponentNotificationItem; read: boolean;
  onOpen: () => void; onMarkRead: () => void;
}) {
  const t = useUiT();
  const locale = useLocale();
  const view = componentNotificationPresentation(item, locale, t);
  const sender = view.actor ?? view.source ?? view.category;
  const label = [view.category, view.source].filter(Boolean).join(" · ");
  return <InboxRow profileTriggers={false} id={`component-${item.notificationId}`} selected={false} read={read}
    actionRequired={item.category === ComponentNotificationCategory.AccessRequested}
    sender={<span className="block max-w-full truncate rounded text-sm font-semibold leading-4 text-foreground">{sender}</span>}
    avatar={view.actor
      ? <UserAvatar avatarUrl={item.actorPicture ?? null} className="h-9 w-9" displayName={view.actor} size="md" shape="circle" />
      : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Bell className="h-4 w-4" /></span>}
    timestamp={relativeTime(locale, item.receivedAt)}
    label={label} channel={null}
    openLabel={t("inbox.openItem", { sender })}
    onSelect={onOpen}
    preview={<span className="line-clamp-2" data-testid={`component-notification-text-${item.notificationId}`}>
      {view.title}{view.summary ? <span className="font-normal text-muted-foreground"> — {view.summary}</span> : null}
    </span>}
    actions={read ? null : <InboxRowActionButton label={t("inbox.markRead")} onClick={onMarkRead}><MailOpen className="h-4 w-4" /></InboxRowActionButton>} />;
}
