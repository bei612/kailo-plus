// DD-138(4), 07 §4.8.3: the shell-level component notification source. One instance for the
// signed-in person feeds the Inbox rows, the Home badge (alert-enabled categories only) and the
// desktop alerts for newly arrived unread items, on every view like the Home feed.
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  componentNotificationPresentation,
  componentUnreadBadgeCount,
  freshComponentNotifications,
  useComponentNotificationSource,
  type ComponentNotificationItem,
} from "@client-kit/platform/react/inbox/component-notifications";
import { useLocale, useT } from "@client-kit/platform/react/context";
import { bff } from "../bff-client";
import { useBrowserNotifications } from "./BrowserNotifications";

export function useComponentNotifications({ principalId, openApplication }: {
  principalId: string;
  /** Host navigation to the binding's native page at the item's path (07 §4.8.3 打开). */
  openApplication: (bindingId: string, workspaceId: string | undefined, path: string) => unknown;
}) {
  const t = useT();
  const locale = useLocale();
  const notifications = useBrowserNotifications();
  const source = useComponentNotificationSource({ client: bff, scopeKey: principalId });
  // Opening marks the item read (optimistic, personal state) and opens the native page.
  const open = useCallback((item: ComponentNotificationItem) => {
    void source.markRead([item]).catch(() => toast.error(t("platform.loadFailed")));
    void openApplication(item.bindingId, item.workspaceId, item.path);
  }, [source, openApplication, t]);
  const seen = useRef<{ scope: string; ids: Set<string> } | null>(null);
  const notify = notifications?.notifyComponent;
  useEffect(() => {
    if (source.status !== "ready") return;
    const previous = seen.current?.scope === principalId ? seen.current.ids : null;
    const next = freshComponentNotifications(previous, source.items, source.isRead);
    seen.current = { scope: principalId, ids: next.seen };
    for (const item of next.fresh) {
      const view = componentNotificationPresentation(item, locale, t);
      notify?.({ notificationId: item.notificationId, category: item.category, title: view.title,
        body: [view.actor, view.category, view.source].filter(Boolean).join(" · "), onOpen: () => open(item) });
    }
    // Only a new page is a new arrival; read marks and settings changes never alert.
  }, [source.items, source.status, principalId]);
  const unreadCount = source.status === "ready" ? componentUnreadBadgeCount({ unreadCount: source.unreadCount,
    items: source.items, isRead: source.isRead, enabled: notifications?.settings.componentAlertsEnabled }) : 0;
  return { source, open, unreadCount };
}
