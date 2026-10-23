// DD-138(4), 07 §4.8.3: the Desktop shell-level component notification source, mirroring the
// Web host's ComponentNotificationAlerts. One instance for the signed-in Principal feeds the
// Inbox rows, the Home/app badge (alert-enabled categories only) and the desktop notification
// (native Tauri path, same as mentions) with its slot sound for newly arrived unread items.
import * as React from "react";
import { toast } from "sonner";
import type { BffClient } from "@client-kit/platform/client";
import {
  componentNotificationPresentation,
  componentUnreadBadgeCount,
  freshComponentNotifications,
  useComponentNotificationSource,
  type ComponentNotificationItem,
} from "@client-kit/platform/react/inbox/component-notifications";
import { componentAlertAllowed, componentNotificationSlot } from "@client-kit/platform/react/notifications";
import { useLocale, useT } from "@client-kit/platform/react/context";
import type { NotificationSettings } from "./hooks";
import {
  getDesktopNotificationPermissionState,
  requestDockBounce,
  sendDesktopNotification,
  type DesktopNotificationApplicationTarget,
} from "./lib/desktop";
import { playNotificationSound, resolveSlotSound } from "./lib/sound";

export function componentNotificationTarget(item: ComponentNotificationItem) {
  return {
    channelId: null, eventId: null, kind: null,
    application: { notificationId: item.notificationId, bindingId: item.bindingId, workspaceId: item.workspaceId, path: item.path },
  };
}

export function useDesktopComponentNotifications({ client, principalId, settings, openApplication }: {
  client: Pick<BffClient, "componentNotifications" | "markComponentNotificationsRead">;
  /** Trusted platform identity (tenant Principal); absent until the platform session loads. */
  principalId: string | undefined;
  settings: NotificationSettings;
  /** Host navigation to the binding's native page at the item's path (07 §4.8.3 打开). */
  openApplication: (bindingId: string, workspaceId: string | undefined, path: string) => unknown;
}) {
  const t = useT();
  const locale = useLocale();
  const scopeKey = principalId ?? "";
  const source = useComponentNotificationSource({ client, scopeKey, enabled: Boolean(principalId) });
  // Opening marks the item read (optimistic, personal state) and opens the native page.
  const open = React.useCallback((item: ComponentNotificationItem) => {
    void source.markRead([item]).catch(() => toast.error(t("platform.loadFailed")));
    void openApplication(item.bindingId, item.workspaceId, item.path);
  }, [source, openApplication, t]);
  // A desktop notification click: the item may have left the loaded page meanwhile.
  const openTarget = React.useCallback((target: DesktopNotificationApplicationTarget) => {
    const item = source.items.find((entry) => entry.notificationId === target.notificationId);
    if (item) return open(item);
    void Promise.resolve(client.markComponentNotificationsRead([target.notificationId]))
      .then(() => source.refresh(), () => toast.error(t("platform.loadFailed")));
    return openApplication(target.bindingId, target.workspaceId, target.path);
  }, [client, source, open, openApplication, t]);
  const latestScope = React.useRef(scopeKey);
  latestScope.current = scopeKey;
  const deliver = React.useEffectEvent(async (item: ComponentNotificationItem) => {
    // Same rule as Web: category switch, desktop switch, OS permission and "notify while viewing"
    // (the Desktop window counts as viewed only while visible and focused).
    const permission = await getDesktopNotificationPermissionState();
    const visible = document.visibilityState === "visible" && document.hasFocus();
    if (!componentAlertAllowed({ settings, category: item.category, permission, visible })) return;
    const view = componentNotificationPresentation(item, locale, t);
    const didSend = await sendDesktopNotification({
      title: view.title,
      body: [view.actor, view.category, view.source].filter(Boolean).join(" · "),
      target: componentNotificationTarget(item),
    }, () => scopeKey === latestScope.current);
    if (!didSend) return;
    playNotificationSound(resolveSlotSound(settings, componentNotificationSlot(item.category)));
    void requestDockBounce();
  });
  const seen = React.useRef<{ scope: string; ids: Set<string> } | null>(null);
  React.useEffect(() => {
    if (!principalId || source.status !== "ready") return;
    const previous = seen.current?.scope === principalId ? seen.current.ids : null;
    const next = freshComponentNotifications(previous, source.items, source.isRead);
    seen.current = { scope: principalId, ids: next.seen };
    for (const item of next.fresh) void deliver(item);
    // Only a new page is a new arrival; read marks and settings changes never alert.
  }, [source.items, source.status, principalId]);
  const unreadCount = source.status === "ready" ? componentUnreadBadgeCount({ unreadCount: source.unreadCount,
    items: source.items, isRead: source.isRead, enabled: settings.componentAlertsEnabled }) : 0;
  return { source: principalId ? source : null, open, openTarget, unreadCount };
}

export type DesktopComponentNotifications = ReturnType<typeof useDesktopComponentNotifications>;
