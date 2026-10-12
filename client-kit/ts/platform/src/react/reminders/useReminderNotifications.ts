import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUiT } from "../context";
import { formatNotificationTitle, truncateNotificationBody } from "../notifications/notificationFormat";
import { playNotificationSound, resolveSlotSound } from "../notifications/sound";
import { useReminderHost } from "./host";
import { remindersQueryKey } from "./hooks";
import { dueSince } from "./lib/reminderFilters";
import { startReminderNotificationPoll } from "./lib/reminderNotificationPoll";

const WATERMARK_STORAGE_PREFIX = "buzz:lastReminderCheck:";

/** Original reminder detector; only trusted reads and OS delivery differ by host. */
export function useReminderNotifications(pubkey: string | undefined): void {
  const host = useReminderHost();
  const current = useRef(host);
  current.current = host;
  const t = useUiT();
  const text = useRef(t);
  text.current = t;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!pubkey || pubkey !== host.pubkey) return;
    const queryKey = remindersQueryKey(host.scopeKey, pubkey);
    const storageKey = `${WATERMARK_STORAGE_PREFIX}${JSON.stringify([host.scopeKey, pubkey.trim().toLowerCase()])}`;
    let active = true;
    let pending = false;
    const isCurrent = () => active && current.current.scopeKey === host.scopeKey && current.current.pubkey === pubkey;
    const check = async () => {
      if (!isCurrent() || pending || queryClient.getQueryState(queryKey)?.data === undefined) return;
      pending = true;
      try {
        // The original poll refreshes this same query. Await its actual current
        // authorization before exposing a reminder's private preview to the OS.
        const reminders = await queryClient.fetchQuery({ queryKey, queryFn: current.current.query, staleTime: 0 });
        if (!isCurrent()) return;
        const notification = current.current.notifications;
        if (!notification) return;
        const now = Math.floor(Date.now() / 1_000);
        const stored = window.localStorage.getItem(storageKey);
        const parsed = stored === null ? NaN : Number(stored);
        const watermark = Number.isFinite(parsed) ? parsed : now;
        const due = dueSince(reminders, watermark, now);
        // Original no-backlog rule: muted or undelivered alerts never replay
        // later. This local time cursor contains no event body or authority.
        window.localStorage.setItem(storageKey, String(now));
        if (!notification.settings.desktopEnabled || !notification.settings.slotAlertsEnabled.needs_action || due.length === 0) return;
        const sources = await Promise.all(due.map(reminder => reminder.content.target
          ? current.current.source(reminder.content.target) : Promise.resolve(null)));
        if (!isCurrent() || !current.current.notifications?.settings.desktopEnabled || !current.current.notifications.settings.slotAlertsEnabled.needs_action) return;
        const channel = due.length === 1 ? sources[0]?.channelLabel.trim() : undefined;
        const body = due.length === 1
          ? truncateNotificationBody(due[0]!.content.target?.preview ?? due[0]!.content.note ?? "", text.current("reminders.notificationFallback"))
          : text.current("reminders.notificationPlural", { count: due.length });
        const sent = await current.current.notifications.send({
          title: formatNotificationTitle({ prefix: text.current("reminders.notificationTitle"), channelLabel: channel ? `#${channel}` : null }),
          body,
        });
        if (!isCurrent() || !sent || !current.current.notifications?.settings.desktopEnabled || !current.current.notifications.settings.slotAlertsEnabled.needs_action) return;
        playNotificationSound(resolveSlotSound(current.current.notifications.settings, "needs_action"));
        await current.current.notifications.requestAttention?.();
      } catch {
        // A rejected authorization or unknown OS delivery is not success and
        // never causes a sound, attention request, or a blind send retry.
      } finally {
        pending = false;
      }
    };
    const stop = startReminderNotificationPoll(() => { void check(); });
    return () => { active = false; stop(); };
  }, [host.scopeKey, host.pubkey, pubkey, queryClient]);
}
