// DD-125(9), SF-BUZ-58(2): Buzz desktop/src/features/community-members/lib/joinAlerts.ts and
// useCommunityJoinAlerts.ts behaviour over the Core `GET /api/v1/tenant-member-joins` read.
import type { TenantMemberJoinPage } from "@client-kit/contracts";
import { act, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import {
  createJoinAlertBatcher, EMPTY_JOIN_ALERT_LEDGER, JOIN_ALERT_DEPARTED_MAX_ITEMS, joinAlertStorageKey,
  type JoinNotification, planJoinNotifications, readJoinAlertLedger, reconcileJoinAlertLedger, type TenantJoin,
  useTenantJoinAlerts,
} from "../src/react/tenant-join-alerts";
import { BffError } from "../src/transport";
import { render } from "./render";

const JOINED_AT = "2026-10-20T08:00:00.000Z";
const join = (principalId: string, displayName = principalId): TenantJoin =>
  ({ principalId, displayName, joinedAt: new Date(JOINED_AT) });
const page = (items: TenantJoin[], cursor: string, hasMore = false): TenantMemberJoinPage => ({ items, cursor, hasMore });

function joinsClient(replies: Array<TenantMemberJoinPage | Error>) {
  const tenantMemberJoins = vi.fn(async (_after?: string): Promise<TenantMemberJoinPage> => {
    const next = replies.shift();
    if (next === undefined) throw new Error("no scripted reply");
    if (next instanceof Error) throw next;
    return next;
  });
  return { tenantMemberJoins };
}

type HarnessProps = { client: ReturnType<typeof joinsClient>; notify: (notification: JoinNotification) => void };
let setEnabled: (enabled: boolean) => void = () => {};
let setTenant: (tenantId: string) => void = () => {};
function Harness({ client, notify }: HarnessProps) {
  const [enabled, changeEnabled] = useState(true);
  const [tenantId, changeTenant] = useState("tenant-1");
  setEnabled = changeEnabled;
  setTenant = changeTenant;
  useTenantJoinAlerts({ client, tenantId, viewerPrincipalId: "me", communityName: "Acme", enabled, notify });
  return null;
}

async function mount(client: ReturnType<typeof joinsClient>, notify: (notification: JoinNotification) => void) {
  await render(<PlatformProvider client={createBffClient({ send: vi.fn() })} locale="en">
    <Harness client={client} notify={notify} />
  </PlatformProvider>);
  await advance(0);
}
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const stored = (tenantId = "tenant-1") => readJoinAlertLedger(tenantId, "me");

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T09:00:00Z"));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("tenant join ledger", () => {
  it("seeds silently, then skips the viewer and Principals already recorded", () => {
    const seeded = reconcileJoinAlertLedger({ ledger: EMPTY_JOIN_ALERT_LEDGER, items: [join("a"), join("me")], cursor: "c1", viewerPrincipalId: "me" });
    expect(seeded).toEqual({ alerts: [], changed: true, ledger: { seeded: true, principalIds: ["a"], cursor: "c1" } });
    const next = reconcileJoinAlertLedger({ ledger: seeded.ledger, items: [join("a"), join("me"), join("b"), join("b")], cursor: "c2", viewerPrincipalId: "me" });
    expect(next.alerts.map((item) => item.principalId)).toEqual(["b"]);
    expect(next.ledger).toEqual({ seeded: true, principalIds: ["a", "b"], cursor: "c2" });
    expect(reconcileJoinAlertLedger({ ledger: next.ledger, items: [join("b")], cursor: "c2", viewerPrincipalId: "me" }).changed).toBe(false);
  });

  it("sheds only the oldest Principals past the retention cap", () => {
    const principalIds = Array.from({ length: JOIN_ALERT_DEPARTED_MAX_ITEMS }, (_, index) => `p${index}`);
    const { ledger } = reconcileJoinAlertLedger({ ledger: { seeded: true, principalIds, cursor: "c1" },
      items: [join("new-1"), join("new-2")], cursor: "c2", viewerPrincipalId: "me" });
    expect(ledger.principalIds).toHaveLength(JOIN_ALERT_DEPARTED_MAX_ITEMS);
    expect(ledger.principalIds.slice(0, 1)).toEqual(["p2"]);
    expect(ledger.principalIds.slice(-2)).toEqual(["new-1", "new-2"]);
  });

  it("reads an unreadable ledger as not seeded", () => {
    localStorage.setItem(joinAlertStorageKey("tenant-1", "me"), "{not json");
    expect(stored()).toEqual(EMPTY_JOIN_ALERT_LEDGER);
    localStorage.setItem(joinAlertStorageKey("tenant-1", "me"), JSON.stringify({ principalIds: ["a"], cursor: 7 }));
    expect(stored()).toEqual(EMPTY_JOIN_ALERT_LEDGER);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("denied", "SecurityError"); });
    expect(stored()).toEqual(EMPTY_JOIN_ALERT_LEDGER);
  });

  it("uses the original copy and collapses more than three arrivals into one summary", () => {
    expect(planJoinNotifications([join("a", "Alice")], "en", "Acme")).toEqual([
      { title: "New member in Acme", body: "Alice joined", key: `join:a:${JOINED_AT}`, principalId: "a" }]);
    expect(planJoinNotifications([join("a", "Alice")], "en", " ")[0]?.title).toBe("New community member");
    expect(planJoinNotifications(["a", "b", "c", "d"].map((id) => join(id)), "zh-CN", "Acme")).toEqual([
      { title: "Acme 有新成员", body: "4 位新成员已加入", key: `join:a:${JOINED_AT}:batch:4` }]);
    expect(planJoinNotifications(["a", "b", "c"].map((id) => join(id)), "en", null)).toHaveLength(3);
  });

  it("coalesces on a 1.5 s trailing window clamped to 5 s after the first pending arrival", async () => {
    const flush = vi.fn();
    const batcher = createJoinAlertBatcher(flush);
    batcher.push([join("a")]);
    await vi.advanceTimersByTimeAsync(1_400);
    batcher.push([join("b")]);
    await vi.advanceTimersByTimeAsync(1_400);
    batcher.push([join("c")]);
    await vi.advanceTimersByTimeAsync(1_400);
    batcher.push([join("d")]);
    await vi.advanceTimersByTimeAsync(799);
    expect(flush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0]?.[0].map((item: TenantJoin) => item.principalId)).toEqual(["a", "b", "c", "d"]);
    batcher.push([join("e")]);
    await vi.advanceTimersByTimeAsync(1_499);
    expect(flush).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledTimes(2);
    batcher.push([join("f")]);
    batcher.clear();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(flush).toHaveBeenCalledTimes(2);
  });
});

describe("useTenantJoinAlerts", () => {
  it("seeds on the first read, then alerts only new other members after the trailing window", async () => {
    const client = joinsClient([page([join("old-1")], "c1"),
      page([join("me"), join("alice", "Alice"), join("old-1")], "c2")]);
    const notify = vi.fn();
    await mount(client, notify);
    expect(client.tenantMemberJoins).toHaveBeenCalledTimes(1);
    expect(client.tenantMemberJoins).toHaveBeenLastCalledWith(undefined);
    expect(stored()).toEqual({ seeded: true, principalIds: ["old-1"], cursor: "c1" });
    await advance(30_000);
    expect(client.tenantMemberJoins).toHaveBeenCalledTimes(2);
    expect(client.tenantMemberJoins).toHaveBeenLastCalledWith("c1");
    await advance(1_499);
    expect(notify).not.toHaveBeenCalled();
    await advance(1);
    expect(notify.mock.calls).toEqual([[{ title: "New member in Acme", body: "Alice joined",
      key: `join:alice:${JOINED_AT}`, principalId: "alice" }]]);
    expect(stored()).toEqual({ seeded: true, principalIds: ["old-1", "alice"], cursor: "c2" });
  });

  it("follows hasMore immediately and merges more than three arrivals into one notification", async () => {
    const client = joinsClient([page([], "c1"), page([join("p1"), join("p2")], "c2", true),
      page([join("p3"), join("p4"), join("p5")], "c3")]);
    const notify = vi.fn();
    await mount(client, notify);
    await advance(30_000);
    expect(client.tenantMemberJoins.mock.calls.map(([after]) => after)).toEqual([undefined, "c1", "c2"]);
    await advance(1_500);
    expect(notify.mock.calls).toEqual([[{ title: "New member in Acme", body: "5 new members joined",
      key: `join:p1:${JOINED_AT}:batch:5` }]]);
  });

  it("echoes the empty start cursor back as a real position", async () => {
    const client = joinsClient([page([], ""), page([join("first", "First")], "c1")]);
    const notify = vi.fn();
    await mount(client, notify);
    expect(stored()).toEqual({ seeded: true, principalIds: [], cursor: "" });
    await advance(31_500);
    expect(client.tenantMemberJoins.mock.calls.map(([after]) => after)).toEqual([undefined, ""]);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("stops reading on PERMISSION_DENIED and drops the pending batch", async () => {
    const client = joinsClient([page([], "c1"), page([join("alice")], "c2", true), new BffError(403, "denied")]);
    const notify = vi.fn();
    await mount(client, notify);
    await advance(30_000);
    expect(client.tenantMemberJoins).toHaveBeenCalledTimes(3);
    await advance(120_000);
    expect(notify).not.toHaveBeenCalled();
    expect(client.tenantMemberJoins).toHaveBeenCalledTimes(3);
  });

  it("does not notify when the ledger cannot persist, and retries the same cursor later", async () => {
    const client = joinsClient([page([], "c1"), page([join("alice")], "c2"), page([join("alice")], "c2")]);
    const notify = vi.fn();
    await mount(client, notify);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    await advance(30_000);
    await advance(5_000);
    expect(notify).not.toHaveBeenCalled();
    setItem.mockRestore();
    expect(stored()).toEqual({ seeded: true, principalIds: [], cursor: "c1" });
    await advance(25_000);
    expect(client.tenantMemberJoins.mock.calls.map(([after]) => after)).toEqual([undefined, "c1", "c1"]);
    await advance(1_500);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(stored()).toEqual({ seeded: true, principalIds: ["alice"], cursor: "c2" });
  });

  it("cancels a pending batch when the gate closes or the Tenant changes", async () => {
    const client = joinsClient([page([], "c1"), page([join("alice")], "c2"), page([], "t2-c1"), page([join("bob")], "t2-c2")]);
    const notify = vi.fn();
    await mount(client, notify);
    await advance(30_000);
    await act(async () => setEnabled(false));
    await advance(5_000);
    expect(notify).not.toHaveBeenCalled();
    await act(async () => { setEnabled(true); setTenant("tenant-2"); });
    await advance(0);
    expect(stored("tenant-2")).toEqual({ seeded: true, principalIds: [], cursor: "t2-c1" });
    await advance(30_000);
    await act(async () => setTenant("tenant-1"));
    await advance(5_000);
    expect(notify).not.toHaveBeenCalled();
    expect(stored("tenant-2")).toEqual({ seeded: true, principalIds: ["bob"], cursor: "t2-c2" });
  });
});
