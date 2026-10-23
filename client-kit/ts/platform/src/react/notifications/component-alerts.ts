// DD-138(4), 07 §4.8.3 提醒: Kailo 设置「通知」 has one switch per component notification
// category, default on. Turning one off stops only its desktop notification, sound and unread
// badge count; the items still enter the Inbox. No component declares a synonym (§4.8.2).
import { ComponentNotificationCategory } from "@client-kit/contracts";
import type { PlatformMessageKey } from "../../i18n";
import type { SoundSlot } from "./sound";

export const COMPONENT_NOTIFICATION_CATEGORIES = [
  ComponentNotificationCategory.Shared,
  ComponentNotificationCategory.Mentioned,
  ComponentNotificationCategory.Commented,
  ComponentNotificationCategory.AccessRequested,
  ComponentNotificationCategory.TaskCompleted,
  ComponentNotificationCategory.ContentUpdated,
] as const;

export type ComponentAlertsEnabled = Record<ComponentNotificationCategory, boolean>;

export const DEFAULT_COMPONENT_ALERTS_ENABLED: ComponentAlertsEnabled = {
  [ComponentNotificationCategory.Shared]: true,
  [ComponentNotificationCategory.Mentioned]: true,
  [ComponentNotificationCategory.Commented]: true,
  [ComponentNotificationCategory.AccessRequested]: true,
  [ComponentNotificationCategory.TaskCompleted]: true,
  [ComponentNotificationCategory.ContentUpdated]: true,
};

export function sanitizeComponentAlertsEnabled(value: unknown): ComponentAlertsEnabled {
  const result = { ...DEFAULT_COMPONENT_ALERTS_ENABLED };
  if (!value || typeof value !== "object") return result;
  const candidate = value as Partial<Record<string, unknown>>;
  for (const category of COMPONENT_NOTIFICATION_CATEGORIES) {
    const picked = candidate[category];
    if (typeof picked === "boolean") result[category] = picked;
  }
  return result;
}

/** Unknown categories (a newer Core) are treated as enabled, like the default. */
export function componentAlertEnabled(enabled: ComponentAlertsEnabled | undefined, category: string): boolean {
  return (enabled as Partial<Record<string, boolean>> | undefined)?.[category] !== false;
}

/** The existing sound slot that voices a category: access requests as Needs action, the rest as a mention. */
export function componentNotificationSlot(category: string): SoundSlot {
  return category === ComponentNotificationCategory.AccessRequested ? "needs_action" : "mention";
}

/**
 * Whether a newly arrived unread item may alert: its category switch is on and the existing
 * global settings allow a desktop notification now (desktop switch, OS permission, and the
 * "notify while viewing" rule while the page is in front).
 */
export function componentAlertAllowed({ settings, category, permission, visible }: {
  settings: { desktopEnabled: boolean; notifyWhileViewing: boolean; componentAlertsEnabled?: ComponentAlertsEnabled };
  category: string;
  permission: string;
  visible: boolean;
}): boolean {
  return componentAlertEnabled(settings.componentAlertsEnabled, category) && settings.desktopEnabled
    && permission === "granted" && (!visible || settings.notifyWhileViewing);
}

export const componentAlertLabelKeys = {
  [ComponentNotificationCategory.Shared]: ["platform.notifications.component.shared", "platform.notifications.component.sharedDescription"],
  [ComponentNotificationCategory.Mentioned]: ["platform.notifications.component.mentioned", "platform.notifications.component.mentionedDescription"],
  [ComponentNotificationCategory.Commented]: ["platform.notifications.component.commented", "platform.notifications.component.commentedDescription"],
  [ComponentNotificationCategory.AccessRequested]: ["platform.notifications.component.accessRequested", "platform.notifications.component.accessRequestedDescription"],
  [ComponentNotificationCategory.TaskCompleted]: ["platform.notifications.component.taskCompleted", "platform.notifications.component.taskCompletedDescription"],
  [ComponentNotificationCategory.ContentUpdated]: ["platform.notifications.component.contentUpdated", "platform.notifications.component.contentUpdatedDescription"],
} as const satisfies Record<ComponentNotificationCategory, readonly [PlatformMessageKey, PlatformMessageKey]>;
