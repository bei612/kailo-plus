// DD-125(9), SF-BUZ-58(2): the shared mount of first-join alerts. Ported from Buzz
// desktop/src/features/community-members/useCommunityJoinAlerts.ts; the kind:13534 live
// subscription is replaced by the Core read-only route both hosts already reach over the BFF.
import { useEffect, useRef } from "react";
import type { TenantMemberJoinPage } from "@client-kit/contracts";
import type { BffClient } from "../../client";
import { BffError } from "../../transport";
import { useLocale } from "../context";
import {
  createJoinAlertBatcher, JOIN_ALERT_POLL_INTERVAL_MS, type JoinNotification, planJoinNotifications,
  readJoinAlertLedger, reconcileJoinAlertLedger, type TenantJoin, writeJoinAlertLedger,
} from "./joinAlerts";

/** Bound on immediate `hasMore` continuations within one read. */
const JOIN_ALERT_MAX_PAGES_PER_READ = 20;

const validJoinedAt = (value: unknown): boolean =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

function validJoinPage(page: TenantMemberJoinPage): boolean {
  // An empty cursor is the start position (no recorded entry yet), still a cursor to echo back.
  return !!page && typeof page.cursor === "string" && typeof page.hasMore === "boolean"
    && Array.isArray(page.items) && page.items.every((item: TenantJoin) => !!item
      && typeof item.principalId === "string" && !!item.principalId
      && typeof item.displayName === "string" && validJoinedAt(item.joinedAt));
}

const foreground = () => typeof document === "undefined" || document.visibilityState !== "hidden";

export function useTenantJoinAlerts({ client, tenantId, viewerPrincipalId, communityName, enabled, notify }: {
  client: Pick<BffClient, "tenantMemberJoins">;
  tenantId: string | null | undefined;
  viewerPrincipalId: string | null | undefined;
  communityName?: string | null;
  /** Host gate: its own notification switch (and, on Web, browser permission). */
  enabled: boolean;
  /** Host presentation: Desktop native notification or Web browser notification. */
  notify: (notification: JoinNotification) => void;
}): void {
  const locale = useLocale();
  // Read at flush time so a rename or locale switch never re-keys the read session.
  const latest = useRef({ locale, communityName, notify });
  latest.current = { locale, communityName, notify };
  const active = enabled && !!tenantId && !!viewerPrincipalId;

  useEffect(() => {
    if (!active || !tenantId || !viewerPrincipalId) return;
    const tenant = tenantId;
    const viewer = viewerPrincipalId;
    // One read session per effect run. Unmount, a Tenant/viewer switch or a disabled gate
    // retires it; every boundary below re-checks `live()` so a parked read cannot deliver.
    let disposed = false;
    let revoked = false;
    let reading = false;
    let lastReadAt = 0;
    let ledger = readJoinAlertLedger(tenant, viewer);
    let interval: ReturnType<typeof setInterval> | undefined;
    const live = () => !disposed && !revoked;
    const batcher = createJoinAlertBatcher((batch) => {
      if (!live()) return;
      const { locale: currentLocale, communityName: name, notify: present } = latest.current;
      for (const notification of planJoinNotifications(batch, currentLocale, name)) {
        if (!live()) return;
        present(notification);
      }
    });

    const read = async () => {
      if (!live() || reading || !foreground()) return;
      reading = true;
      lastReadAt = Date.now();
      try {
        for (let page = 0; page < JOIN_ALERT_MAX_PAGES_PER_READ; page++) {
          const before = ledger.cursor;
          // `null` only before seeding; "" is a real cursor and must be sent back as `after=`.
          const reply = await client.tenantMemberJoins(before ?? undefined);
          if (!live() || !validJoinPage(reply)) return;
          const { alerts, changed, ledger: next } = reconcileJoinAlertLedger({
            ledger, items: reply.items, cursor: reply.cursor, viewerPrincipalId: viewer,
          });
          if (changed) {
            // Persisted before presenting, never after: a write that did not land keeps the
            // old cursor, so the next read retries this page instead of losing or repeating it.
            if (!writeJoinAlertLedger(tenant, viewer, next)) return;
            ledger = next;
          }
          batcher.push(alerts);
          if (!reply.hasMore || reply.cursor === before) return;
        }
      } catch (error) {
        // DD-125(9): losing Tenant `manage` is PERMISSION_DENIED. Stop for this session and
        // drop whatever was queued but not yet presented. Other failures retry on the next tick.
        if (error instanceof BffError && error.status === 403) {
          revoked = true;
          clearInterval(interval);
          batcher.clear();
        }
      } finally {
        reading = false;
      }
    };

    interval = setInterval(() => { void read(); }, JOIN_ALERT_POLL_INTERVAL_MS);
    const onVisible = () => {
      if (foreground() && Date.now() - lastReadAt >= JOIN_ALERT_POLL_INTERVAL_MS) void read();
    };
    document.addEventListener("visibilitychange", onVisible);
    void read();
    return () => {
      disposed = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      batcher.clear();
    };
  }, [active, client, tenantId, viewerPrincipalId]);
}
