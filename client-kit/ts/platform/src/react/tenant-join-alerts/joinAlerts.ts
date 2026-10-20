// DD-125(9), SF-BUZ-58(2): first-join alerts for Tenant `manage` holders, shared by Web and
// Desktop. Ported from Buzz desktop/src/features/community-members/lib/joinAlerts.ts.
//
// The member authority is Core (DD-41/83), not the kind:13534 roster: Core records the moment
// a TenantMembership enters ACTIVE and `GET /api/v1/tenant-member-joins` returns the other
// members that entered after a cursor, counted per HUMAN Principal (a new device key is not a
// new member). The original's persisted ledger is kept for the question it answers — "is this
// new to this viewer on this machine" — and it also holds the read cursor, so a ledger that
// failed to persist re-reads the same page and the alert survives to the attempt that lands.
import type { TenantMemberJoinPage } from "@client-kit/contracts";
import { type PlatformLocale, translate } from "../../i18n";
import { setLocalStorageItemWithRecovery } from "../composer/shared/lib/localStorageQuota";

export type TenantJoin = TenantMemberJoinPage["items"][number];

const JOIN_ALERT_STORAGE_PREFIX = "kailo-tenant-join-seen.v1";

/**
 * Cap on Principals retained per Tenant ledger; only the oldest are shed.
 *
 * The original bounds the departed tail of a whole-roster ledger. Kailo reads joins after a
 * persisted cursor, never the whole roster, so a shed Principal only reappears by entering
 * ACTIVE again — which is a join. Shedding the oldest entries therefore cannot re-alert a
 * current member, and the same 5,000 bound applies.
 */
export const JOIN_ALERT_DEPARTED_MAX_ITEMS = 5_000;

/** Trailing quiet window that coalesces arrivals into one batch (original value). */
export const JOIN_ALERT_NOTIFY_WINDOW_MS = 1_500;
/** Ceiling on how long the trailing window may defer the first pending arrival. */
export const JOIN_ALERT_MAX_DEFERRAL_MS = 5_000;
/** Above this many arrivals, one summary replaces the per-member notifications. */
export const JOIN_ALERT_MAX_INDIVIDUAL = 3;
/** DD-125(9): read once every 30 seconds while the client is in the foreground. */
export const JOIN_ALERT_POLL_INTERVAL_MS = 30_000;

export type JoinAlertLedger = {
  /**
   * Whether the first read has already been folded in. Explicit rather than inferred from an
   * empty list: a Tenant whose only other members predate the ledger seeds to an empty list.
   */
  seeded: boolean;
  /** Principals already alerted on (or recorded while seeding), oldest first. */
  principalIds: string[];
  /** Cursor returned by the last read that persisted; null before seeding. */
  cursor: string | null;
};

export const EMPTY_JOIN_ALERT_LEDGER: JoinAlertLedger = { seeded: false, principalIds: [], cursor: null };

export function joinAlertStorageKey(tenantId: string, viewerPrincipalId: string): string {
  return `${JOIN_ALERT_STORAGE_PREFIX}:${tenantId}:${viewerPrincipalId}`;
}

/** An unreadable or absent ledger reads as not seeded: the next read only seeds. */
export function readJoinAlertLedger(tenantId: string, viewerPrincipalId: string): JoinAlertLedger {
  if (typeof window === "undefined" || !tenantId || !viewerPrincipalId) return EMPTY_JOIN_ALERT_LEDGER;
  try {
    const raw = window.localStorage.getItem(joinAlertStorageKey(tenantId, viewerPrincipalId));
    if (!raw) return EMPTY_JOIN_ALERT_LEDGER;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return EMPTY_JOIN_ALERT_LEDGER;
    const { seeded, principalIds, cursor } = parsed as Partial<JoinAlertLedger>;
    if (!Array.isArray(principalIds) || (cursor !== null && typeof cursor !== "string")) return EMPTY_JOIN_ALERT_LEDGER;
    return {
      // A stored ledger is the residue of a read already folded in (original rule).
      seeded: seeded !== false,
      principalIds: principalIds.filter((value): value is string => typeof value === "string" && value.length > 0),
      cursor: cursor ?? null,
    };
  } catch {
    return EMPTY_JOIN_ALERT_LEDGER;
  }
}

/** Persist the ledger; false when the write did not land (quota-aware, never throws). */
export function writeJoinAlertLedger(tenantId: string, viewerPrincipalId: string, ledger: JoinAlertLedger): boolean {
  if (typeof window === "undefined" || !tenantId || !viewerPrincipalId) return false;
  try {
    return setLocalStorageItemWithRecovery(joinAlertStorageKey(tenantId, viewerPrincipalId),
      JSON.stringify(ledger satisfies JoinAlertLedger));
  } catch {
    return false;
  }
}

/**
 * Fold one page of joins into the ledger and return the arrivals to alert on.
 *
 * The viewer is never alerted on or recorded. A Principal already in the ledger is not new to
 * this viewer. `alerts` is empty on the seeding read, so opening the client against an
 * established Tenant does not announce every existing member.
 */
export function reconcileJoinAlertLedger({ ledger, items, cursor, viewerPrincipalId }: {
  ledger: JoinAlertLedger;
  items: readonly TenantJoin[];
  cursor: string;
  viewerPrincipalId: string;
}): { alerts: TenantJoin[]; changed: boolean; ledger: JoinAlertLedger } {
  const seen = new Set(ledger.principalIds);
  const fresh: TenantJoin[] = [];
  for (const item of items) {
    if (!item.principalId || item.principalId === viewerPrincipalId || seen.has(item.principalId)) continue;
    seen.add(item.principalId);
    fresh.push(item);
  }
  if (fresh.length === 0 && ledger.seeded && ledger.cursor === cursor) return { alerts: [], changed: false, ledger };
  const principalIds = [...ledger.principalIds, ...fresh.map((item) => item.principalId)];
  const shed = principalIds.length - JOIN_ALERT_DEPARTED_MAX_ITEMS;
  return {
    alerts: ledger.seeded ? fresh : [],
    changed: true,
    ledger: { seeded: true, principalIds: shed > 0 ? principalIds.slice(shed) : principalIds, cursor },
  };
}

export type JoinNotification = {
  title: string;
  body: string;
  /** Stable delivery key for host de-duplication: `join:<principalId>:<joinedAt>`, or the batch's. */
  key: string;
  principalId?: string;
};

/** RFC 3339 text of a join time (generated `Date`, JSON string at runtime). */
export function joinedAtText(value: TenantJoin["joinedAt"] | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/** Original copy: per member up to three, otherwise one "N new members joined" summary. */
export function planJoinNotifications(alerts: readonly TenantJoin[], locale: PlatformLocale,
  communityName?: string | null): JoinNotification[] {
  if (alerts.length === 0) return [];
  const name = communityName?.trim();
  const title = name ? translate(locale, "tenantJoin.title", { community: name }) : translate(locale, "tenantJoin.titleGeneric");
  const key = (alert: TenantJoin) => `join:${alert.principalId}:${joinedAtText(alert.joinedAt)}`;
  if (alerts.length > JOIN_ALERT_MAX_INDIVIDUAL) {
    return [{ title, body: translate(locale, "tenantJoin.summary", { count: alerts.length }),
      key: `${key(alerts[0]!)}:batch:${alerts.length}` }];
  }
  return alerts.map((alert) => ({
    title,
    body: translate(locale, "tenantJoin.body", { name: alert.displayName.trim() || alert.principalId }),
    key: key(alert),
    principalId: alert.principalId,
  }));
}

/**
 * Cross-read batch: a trailing window re-armed by each arrival, clamped so a steady drip
 * cannot defer the first pending arrival past JOIN_ALERT_MAX_DEFERRAL_MS. `clear` drops
 * everything queued; a dropped batch is never delivered.
 */
export function createJoinAlertBatcher(flush: (batch: TenantJoin[]) => void) {
  let pending: TenantJoin[] = [];
  let since: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    pending = []; since = null;
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };
  return {
    push(alerts: readonly TenantJoin[]) {
      if (alerts.length === 0) return;
      pending.push(...alerts);
      if (timer !== null) clearTimeout(timer);
      const now = Date.now();
      if (since === null) since = now;
      const delay = Math.max(0, Math.min(JOIN_ALERT_NOTIFY_WINDOW_MS, since + JOIN_ALERT_MAX_DEFERRAL_MS - now));
      timer = setTimeout(() => {
        const batch = pending;
        timer = null; pending = []; since = null;
        flush(batch);
      }, delay);
    },
    clear,
  };
}
