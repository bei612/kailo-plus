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
    expect(cells("agent_tokens").slice(0, 5)).toEqual(["Agent tokens", "1,000", "1,200", "0", "Hard"]);
    expect(cells("agent_tokens")[5]).toContain("(UTC)");
    expect(cells("agent_tokens")[6]).toBe("No access");
    expect(cells("automation_runs").slice(0, 5)).toEqual(["Automation runs", "10,000", "25", "9,975", "Soft"]);
    // Absent facts are not shown as zero.
    expect(cells("agent_memory_writes").slice(0, 6)).toEqual(["Memory writes", "Not set", "—", "—", "Hard", "—"]);
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
