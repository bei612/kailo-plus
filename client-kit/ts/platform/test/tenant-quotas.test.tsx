// DD-123, V-SCN-114/115: the organization quota section of the usage page and the governed
// tenant.quota.set submission (explicit confirmation, no approval, unknown → same-key re-check).
import { ErrorClass, ReasonCode } from "@client-kit/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { setLocale } from "../src/i18n";
import { TenantQuotaSection, UsageBillingPage } from "../src/react/business-observability";
import { PlatformProvider } from "../src/react/context";
import type { BffReply, BffRequest, BffTransport } from "../src/transport";
import { button, click, render, settle, type } from "./render";

type Route = (request: BffRequest) => BffReply | Promise<BffReply>;

function transport(route: Route): BffTransport & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn(async (r: BffRequest) => route(r)) };
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); setLocale("en");
});

const quotas = {
  setActionKey: "tenant.quota.set",
  quotas: [
    { feature: "agent_memory_writes", hasAccess: true, hardLimit: true },
    { feature: "automation_runs", limitPerPeriod: 10000, usage: 25, hasAccess: true, hardLimit: false,
      periodResetAt: "2026-11-01T00:00:00Z" },
    { feature: "agent_tokens", limitPerPeriod: 1000, usage: 1200, hasAccess: false, hardLimit: true,
      periodResetAt: "2026-11-01T00:00:00Z" },
  ],
};
const forbidden: BffReply = { status: 403, body: { class: ErrorClass.Denied, reason: ReasonCode.PermissionDenied } };
const recorded: BffReply = {
  status: 200,
  body: { operationId: "op-1", actionExecutionId: "ae-1", actionKey: "tenant.quota.set", gateState: "ALLOWED", dispatchState: "DISPATCHED" },
};
const routes = (action: (r: BffRequest) => BffReply) =>
  transport((r) => (r.path === "/api/v1/tenant/quotas" ? { status: 200, body: quotas } : action(r)));

function mount(t: BffTransport, locale: "en" | "zh-CN" = "en") {
  return render(
    <PlatformProvider client={createBffClient(t)} locale={locale}>
      <TenantQuotaSection />
    </PlatformProvider>,
  );
}

const rows = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLTableRowElement>("[data-testid=tenant-quota-row]")];
const row = (host: HTMLElement, feature: string) => {
  const found = host.querySelector<HTMLTableRowElement>(`[data-testid=tenant-quota-row][data-feature=${feature}]`);
  if (!found) throw new Error(`no quota row ${feature}`);
  return found;
};
const posts = (t: { send: ReturnType<typeof vi.fn> }) =>
  t.send.mock.calls.map(([r]) => r as BffRequest).filter((r) => r.path === "/api/v1/actions");
const quotaInput = () => {
  const input = document.querySelector<HTMLInputElement>("[data-testid=tenant-quota-input]");
  if (!input) throw new Error("no quota input");
  return input;
};

describe("TenantQuotaSection", () => {
  it("lists limit, used, remaining, limit type and reset per feature with an exhausted banner", async () => {
    const t = routes(() => recorded);
    const host = await mount(t);
    await settle();
    expect(t.send.mock.calls[0]?.[0]).toMatchObject({ path: "/api/v1/tenant/quotas" });
    expect(rows(host).map((r) => r.dataset.feature)).toEqual(["agent_tokens", "automation_runs", "agent_memory_writes"]);
    const cells = (feature: string) => [...row(host, feature).querySelectorAll("td")].map((c) => c.textContent);
    expect(cells("agent_tokens").slice(0, 6)).toEqual(["Agent tokens", "1,000", "—", "1,200", "0", "Hard"]);
    expect(cells("agent_tokens")[6]).toContain("(UTC)");
    expect(cells("agent_tokens")[7]).toBe("No access");
    expect(cells("automation_runs").slice(0, 6)).toEqual(["Automation runs", "10,000", "—", "25", "9,975", "Soft"]);
    // Absent facts are not shown as zero.
    expect(cells("agent_memory_writes").slice(0, 7)).toEqual(["Memory writes", "Not set", "—", "—", "—", "Hard", "—"]);
    const banners = [...host.querySelectorAll("[data-testid=tenant-quota-exhausted]")];
    expect(banners.map((b) => b.getAttribute("data-feature"))).toEqual(["agent_tokens"]);
    expect(banners[0]?.getAttribute("role")).toBe("alert");
    expect(banners[0]?.textContent).toContain("new Agent calls are being rejected");
    expect(rows(host).map((r) => r.querySelector("button")?.textContent)).toEqual(["Set quota", "Set quota", "Set quota"]);
  });

  it("renders the Chinese banner and labels", async () => {
    await mount(routes(() => recorded), "zh-CN");
    await settle();
    const section = document.querySelector("[data-testid=tenant-quotas]");
    expect(section?.textContent).toContain("组织额度");
    expect(section?.textContent).toContain("自动化运行");
    expect(section?.textContent).toContain("记忆写入");
    expect(section?.querySelector("[data-testid=tenant-quota-exhausted]")?.textContent).toContain("新的 Agent 调用正在被拒绝");
    expect(section?.textContent).toContain("设置额度");
  });

  it("is hidden entirely for members (403)", async () => {
    const host = await mount(transport(() => forbidden));
    await settle();
    expect(host.textContent).toBe("");
    const page = await render(
      <PlatformProvider client={createBffClient(transport(() => forbidden))} locale="en">
        <UsageBillingPage />
      </PlatformProvider>,
    );
    await settle();
    expect(page.querySelector("[data-testid=usage-billing]")).not.toBeNull();
    expect(page.querySelector("[data-testid=tenant-quotas]")).toBeNull();
  });

  it("an out-of-contract page is a read failure, not an empty list", async () => {
    const host = await mount(transport(() => ({ status: 200, body: { quotas: [{ feature: "gpu_hours", hasAccess: true, hardLimit: true }] } })));
    await settle();
    expect(host.querySelector("[role=alert]")).not.toBeNull();
    expect(button(host, "Try again")).toBeTruthy();
    expect(rows(host)).toHaveLength(0);
  });

  it("sets a quota through edit → review → explicit confirmation with the exact command, then refreshes", async () => {
    const t = routes(() => recorded);
    const host = await mount(t);
    await settle();
    await click(button(row(host, "agent_tokens"), "Set quota"));
    expect(document.querySelector("[data-testid=tenant-quota-dialog]")?.textContent).toContain("Set quota: Agent tokens");
    expect(quotaInput().value).toBe("1000");
    await type(quotaInput(), "12.5");
    expect(button(document.body, "Review").disabled).toBe(true);
    expect(document.querySelector("[data-testid=tenant-quota-dialog] [role=alert]")?.textContent)
      .toBe("Enter a whole number from 0 to 1,000,000,000,000.");
    await type(quotaInput(), "500000");
    await click(button(document.body, "Review"));
    const review = document.querySelector("[data-testid=tenant-quota-review]");
    expect(review?.textContent).toContain("from 1,000 to 500,000");
    expect(review?.textContent).toContain("No approval is required");
    expect(review?.querySelector("[role=alert]")).toBeNull();
    expect(posts(t)).toHaveLength(0);
    await click(button(document.body, "Confirm and set"));
    const sent = posts(t);
    expect(sent).toHaveLength(1);
    const body = sent[0]?.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["actionKey", "explicitConfirmation", "idempotencyKey", "tenantQuotaSetting"]);
    expect(body).toMatchObject({
      actionKey: "tenant.quota.set",
      explicitConfirmation: true,
      tenantQuotaSetting: { feature: "agent_tokens", limitPerPeriod: 500000 },
    });
    expect(Object.keys(body.tenantQuotaSetting as object).sort()).toEqual(["feature", "limitPerPeriod"]);
    expect(body.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(document.querySelector("[data-testid=tenant-quota-dialog]")).toBeNull();
    expect(host.querySelector("[data-testid=tenant-quota-outcome]")?.textContent).toContain("Quota set. Operation: op-1.");
    expect(t.send.mock.calls.filter(([r]) => (r as BffRequest).path === "/api/v1/tenant/quotas")).toHaveLength(2);
  });

  it("warns at review when the new limit is not above this period's usage", async () => {
    const host = await mount(routes(() => recorded));
    await settle();
    await click(button(row(host, "automation_runs"), "Set quota"));
    await type(quotaInput(), "25");
    await click(button(document.body, "Review"));
    expect(document.querySelector("[data-testid=tenant-quota-review] [role=alert]")?.textContent)
      .toContain("not above this period's usage (25)");
    await click(button(document.body, "Back"));
    expect(quotaInput().value).toBe("25");
  });

  it("an unknown result keeps the frozen command and only re-checks it with the same key", async () => {
    let calls = 0;
    const t = routes(() => {
      calls++;
      return calls === 1
        ? { status: 503, body: { class: ErrorClass.Unknown, reason: ReasonCode.DependencyUnavailable, operationId: "op-u" } }
        : { ...recorded, body: { ...(recorded.body as object), operationId: "op-u" } };
    });
    const host = await mount(t);
    await settle();
    await click(button(row(host, "agent_tokens"), "Set quota"));
    await type(quotaInput(), "2000");
    await click(button(document.body, "Review"));
    await click(button(document.body, "Confirm and set"));
    const outcome = host.querySelector("[data-testid=tenant-quota-outcome]");
    expect(outcome?.getAttribute("role")).toBe("alert");
    expect(outcome?.textContent).toContain("op-u");
    expect(rows(host).every((r) => r.querySelector("button")?.disabled)).toBe(true);
    await click(button(host, "Retry same request"));
    const sent = posts(t);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.body).toEqual(sent[0]?.body);
    expect(host.querySelector("[data-testid=tenant-quota-outcome]")?.textContent).toContain("Quota set");
  });

  it("an auditor's page carries no set action: the table is read-only", async () => {
    const auditorPage = { quotas: quotas.quotas };
    const host = await mount(transport((r) => (r.path === "/api/v1/tenant/quotas"
      ? { status: 200, body: auditorPage } : forbidden)));
    await settle();
    expect(rows(host)).toHaveLength(3);
    expect(host.querySelectorAll("[data-testid=tenant-quota-row] button")).toHaveLength(0);
    expect([...host.querySelectorAll("th")].map((h) => h.textContent)).not.toContain("Action");
  });

  it("a definite refusal (e.g. Tenant manage revoked after the page loaded) is shown and nothing is retried", async () => {
    const t = routes(() => forbidden);
    const host = await mount(t);
    await settle();
    await click(button(row(host, "automation_runs"), "Set quota"));
    await type(quotaInput(), "20000");
    await click(button(document.body, "Review"));
    await click(button(document.body, "Confirm and set"));
    expect(host.querySelector("[data-testid=tenant-quota-outcome]")?.textContent).toContain("Request rejected");
    expect(rows(host).every((r) => r.querySelector("button")?.disabled === false)).toBe(true);
    expect(posts(t)).toHaveLength(1);
  });
});

// DD-163(3)(4): component quota items, the per-member limit and the two usage views.
const componentQuotas = {
  setActionKey: "tenant.quota.set",
  quotas: [
    { feature: "knowledge_answers", limitPerPeriod: 100, memberLimitPerPeriod: 5, usage: 7, hasAccess: true, hardLimit: true },
    { feature: "file_storage", limitPerPeriod: 107374182400, usage: 1610612736, hasAccess: true, hardLimit: true },
    { feature: "component_tokens", limitPerPeriod: 10, usage: 10, hasAccess: false, hardLimit: true },
    { feature: "data_queries", limitPerPeriod: 50, hasAccess: true, hardLimit: true },
  ],
};
const componentRoutes = (action: (r: BffRequest) => BffReply) =>
  transport((r) => (r.path === "/api/v1/tenant/quotas" ? { status: 200, body: componentQuotas } : action(r)));
const memberInput = () => {
  const input = document.querySelector<HTMLInputElement>("[data-testid=tenant-quota-member-input]");
  if (!input) throw new Error("no member input");
  return input;
};

describe("TenantQuotaSection with component items (DD-163)", () => {
  it("orders component items after platform items, shows member limits, bytes and banners", async () => {
    const host = await mount(componentRoutes(() => recorded));
    await settle();
    expect(rows(host).map((r) => r.dataset.feature)).toEqual(["component_tokens", "knowledge_answers", "data_queries", "file_storage"]);
    const cells = (feature: string) => [...row(host, feature).querySelectorAll("td")].map((c) => c.textContent);
    expect(cells("knowledge_answers").slice(0, 5)).toEqual(["Knowledge answers", "100", "5", "7", "93"]);
    expect(cells("data_queries").slice(0, 3)).toEqual(["Data queries", "50", "Not set"]);
    expect(cells("file_storage").slice(0, 5)).toEqual(["File storage", "100 GiB", "—", "1.5 GiB", "98.5 GiB"]);
    const banners = [...host.querySelectorAll("[data-testid=tenant-quota-exhausted]")];
    expect(banners.map((b) => b.getAttribute("data-feature"))).toEqual(["component_tokens"]);
    expect(banners[0]?.textContent).toContain("model calls from Files, Knowledge and Data Q&A are being rejected");
  });

  it("a member limit on a non-member item is out of contract (read failure)", async () => {
    const host = await mount(transport(() => ({ status: 200, body: { quotas: [
      { feature: "component_tokens", memberLimitPerPeriod: 3, hasAccess: true, hardLimit: true }] } })));
    await settle();
    expect(rows(host)).toHaveLength(0);
    expect(host.querySelector("[role=alert]")).not.toBeNull();
  });

  it("sets the organization and per-member limit together; the current member limit is prefilled", async () => {
    const t = componentRoutes(() => recorded);
    const host = await mount(t);
    await settle();
    await click(button(row(host, "knowledge_answers"), "Set quota"));
    expect(quotaInput().value).toBe("100");
    expect(memberInput().value).toBe("5");
    await type(memberInput(), "500");
    expect(document.querySelector("[data-testid=tenant-quota-dialog] [role=alert]")?.textContent)
      .toBe("The per-member limit cannot exceed the organization limit.");
    expect(button(document.body, "Review").disabled).toBe(true);
    await type(memberInput(), "3");
    await click(button(document.body, "Review"));
    expect(document.querySelector("[data-testid=tenant-quota-member-review]")?.textContent).toBe("Each member may use at most 3 per month.");
    await click(button(document.body, "Confirm and set"));
    const body = posts(t)[0]?.body as Record<string, unknown>;
    expect(body.tenantQuotaSetting).toEqual({ feature: "knowledge_answers", limitPerPeriod: 100, memberLimitPerPeriod: 3 });
  });

  it("clearing the member limit sends a setting without it (removes the per-member limit)", async () => {
    const t = componentRoutes(() => recorded);
    const host = await mount(t);
    await settle();
    await click(button(row(host, "knowledge_answers"), "Set quota"));
    await type(memberInput(), "");
    await click(button(document.body, "Review"));
    expect(document.querySelector("[data-testid=tenant-quota-member-review]")?.textContent).toBe("No per-member limit.");
    await click(button(document.body, "Confirm and set"));
    const body = posts(t)[0]?.body as Record<string, unknown>;
    expect(body.tenantQuotaSetting).toEqual({ feature: "knowledge_answers", limitPerPeriod: 100 });
  });

  it("file storage is entered in GiB and sent in bytes; non-member items have no member input", async () => {
    const t = componentRoutes(() => recorded);
    const host = await mount(t);
    await settle();
    await click(button(row(host, "file_storage"), "Set quota"));
    expect(quotaInput().value).toBe("100");
    expect(document.querySelector("[data-testid=tenant-quota-member-input]")).toBeNull();
    await type(quotaInput(), "932");
    expect(document.querySelector("[data-testid=tenant-quota-dialog] [role=alert]")?.textContent)
      .toBe("Enter a whole number of GiB from 0 to 931.");
    await type(quotaInput(), "200");
    await click(button(document.body, "Review"));
    expect(document.querySelector("[data-testid=tenant-quota-review]")?.textContent).toContain("to 200 GiB");
    await click(button(document.body, "Confirm and set"));
    const body = posts(t)[0]?.body as Record<string, unknown>;
    expect(body.tenantQuotaSetting).toEqual({ feature: "file_storage", limitPerPeriod: 214748364800 });
  });
});

const myUsage = {
  items: [
    { feature: "data_queries", state: "TENANT_EXHAUSTED", used: 2, periodResetAt: "2026-11-01T00:00:00Z" },
    { feature: "knowledge_answers", state: "MEMBER_LIMIT_REACHED", used: 5, memberLimitPerPeriod: 5,
      periodResetAt: "2026-11-01T00:00:00Z" },
  ],
};
const componentUsage = {
  from: "2026-10-01T00:00:00Z",
  to: "2026-10-31T00:00:00Z",
  meters: [
    { meterKey: "component_model_tokens", aggregation: "sum", state: "COMMITTED", bindings: [
      { bindingId: "b-know", nativePageCategory: "knowledge", workspaceId: "ws-1", quantity: "1200" },
      { bindingId: "b-data", nativePageCategory: "data_query", quantity: "300" }] },
    { meterKey: "knowledge_answer_count", aggregation: "count", state: "COMMITTED", bindings: [
      { bindingId: "b-know", nativePageCategory: "knowledge", workspaceId: "ws-1", quantity: "7" }] },
    { meterKey: "data_query_count", aggregation: "count", state: "NO_COMMITTED_USAGE", bindings: [] },
    { meterKey: "file_storage_bytes", aggregation: "latest", state: "UNAVAILABLE", bindings: [] },
  ],
};

function usagePage(route: Route, locale: "en" | "zh-CN" = "en") {
  return render(
    <PlatformProvider client={createBffClient(transport(route))} locale={locale}>
      <UsageBillingPage />
    </PlatformProvider>,
  );
}

describe("usage page views (DD-163(4))", () => {
  it("a member sees only their own usage: no organization numbers, no component split", async () => {
    const page = await usagePage((r) => r.path === "/api/v1/usage/me" ? { status: 200, body: myUsage } : forbidden);
    await settle();
    const mine = page.querySelector("[data-testid=my-usage]");
    expect(mine).not.toBeNull();
    const items = [...page.querySelectorAll<HTMLElement>("[data-testid=my-usage-row]")];
    expect(items.map((r) => r.dataset.feature)).toEqual(["knowledge_answers", "data_queries"]);
    const cells = (i: number) => [...(items[i]?.querySelectorAll("td") ?? [])].map((c) => c.textContent);
    expect(cells(0).slice(0, 4)).toEqual(["Knowledge answers", "5", "5", "Your limit for this month is used up"]);
    expect(cells(1).slice(0, 4)).toEqual(["Data queries", "2", "No personal limit",
      "The organization's quota is used up — contact an admin"]);
    expect(page.querySelector("[data-testid=tenant-quotas]")).toBeNull();
    expect(page.querySelector("[data-testid=component-usage]")).toBeNull();
  });

  it("the member view is localized", async () => {
    const page = await usagePage((r) => r.path === "/api/v1/usage/me" ? { status: 200, body: myUsage } : forbidden, "zh-CN");
    await settle();
    const text = page.querySelector("[data-testid=my-usage]")?.textContent ?? "";
    expect(text).toContain("我的用量");
    expect(text).toContain("组织额度已用完，请联系管理员");
    expect(text).toContain("你本月的额度已用完");
  });

  it("a failed member read is a retryable failure, not an empty list", async () => {
    const page = await usagePage((r) => r.path === "/api/v1/usage/me"
      ? { status: 503, body: { class: ErrorClass.Unknown, reason: ReasonCode.DependencyUnavailable } } : forbidden);
    await settle();
    const mine = page.querySelector("[data-testid=my-usage]");
    expect(mine?.querySelector("[role=alert]")).not.toBeNull();
    expect(mine?.querySelectorAll("[data-testid=my-usage-row]")).toHaveLength(0);
  });

  it("admins see the per-component split labelled by category, never by component name", async () => {
    const page = await usagePage((r) => {
      if (r.path === "/api/v1/usage/me") return { status: 200, body: { items: [] } };
      if (r.path.startsWith("/api/v1/usage/components?")) return { status: 200, body: componentUsage };
      if (r.path === "/api/v1/workspaces") return { status: 200, body: [{ id: "ws-1", name: "Sales", slug: "sales" }] };
      return forbidden;
    });
    await settle();
    const section = page.querySelector("[data-testid=component-usage]");
    expect(section).not.toBeNull();
    const rowsOf = [...page.querySelectorAll<HTMLElement>("[data-testid=component-usage-row]")];
    expect(rowsOf.map((r) => `${r.dataset.meter}:${r.dataset.binding ?? ""}`)).toEqual([
      "component_model_tokens:b-know", "component_model_tokens:b-data", "knowledge_answer_count:b-know",
      "data_query_count:", "file_storage_bytes:"]);
    const cells = (i: number) => [...(rowsOf[i]?.querySelectorAll("td") ?? [])].map((c) => c.textContent);
    expect(cells(0)).toEqual(["Model tokens", "Knowledge", "Sales", "Committed", "1,200"]);
    expect(cells(1)).toEqual(["Model tokens", "Data Q&A", "Whole organization", "Committed", "300"]);
    expect(cells(3).slice(3)).toEqual(["No stored events in this period", "—"]);
    expect(cells(4).slice(3)).toEqual(["Cannot be verified", "—"]);
    expect(section?.textContent).not.toContain("b-know");
  });
});
