import { ErrorClass, ReasonCode } from "@kailo/contracts";
import { describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { PlatformTenantManagement } from "../src/react/tenants";
import type { BffReply, BffRequest, BffTransport } from "../src/transport";
import { button, click, render, settle } from "./render";

type Route = (request: BffRequest) => BffReply | Promise<BffReply>;

function transport(route: Route): BffTransport & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn(async (r: BffRequest) => route(r)) };
}

function mount(t: BffTransport, locale: "en" | "zh-CN" = "en") {
  return render(
    <PlatformProvider client={createBffClient(t)} locale={locale}>
      <PlatformTenantManagement />
    </PlatformProvider>,
  );
}

const tenant = (extra: Record<string, unknown>) => ({ id: "t-1", name: "Acme", slug: "acme", state: "ACTIVE", ...extra });
const recorded = (actionKey: string) => ({
  status: 200,
  body: { operationId: "op-1", actionExecutionId: "ae-1", actionKey, gateState: "ALLOWED", dispatchState: "DISPATCHED" },
});
const routes = (rows: unknown[], action: (r: BffRequest) => BffReply) =>
  transport((r) => (r.path.startsWith("/api/v1/platform/tenants") ? { status: 200, body: { tenants: rows } } : action(r)));

describe("PlatformTenantManagement", () => {
  it("非 Catalog 会话（403）整节不渲染", async () => {
    const host = await mount(transport(() => ({ status: 403, body: { class: ErrorClass.Denied, reason: ReasonCode.PermissionDenied } })));
    await settle();
    expect(host.textContent).toBe("");
  });

  it("暂停带显式确认提交；受理回应只说已登记", async () => {
    const t = routes([tenant({ lifecycleActionKey: "tenant.suspend" })], () => recorded("tenant.suspend"));
    const host = await mount(t);
    await settle();
    expect(host.textContent).toContain("Active");
    await click(button(host, "Suspend"));
    expect(host.textContent).toContain("Suspend organization Acme (acme)?");
    await click(button(host, "Confirm"));
    const post = t.send.mock.calls.map(([r]) => r).find((r) => r.path === "/api/v1/actions");
    expect(post?.body).toMatchObject({ actionKey: "tenant.suspend", tenantId: "t-1", explicitConfirmation: true });
    expect(Object.keys(post?.body ?? {}).sort()).toEqual(["actionKey", "explicitConfirmation", "idempotencyKey", "tenantId"]);
    const status = host.querySelector("[data-testid=platform-tenants] [role=status]")?.textContent ?? "";
    expect(status).toContain("Request recorded");
    expect(status).not.toMatch(/succe/i);
  });

  it("结果不明保留原幂等键只允许重查", async () => {
    let calls = 0;
    const t = routes([tenant({ state: "SUSPENDED", lifecycleActionKey: "tenant.restore" })], () => {
      calls++;
      return calls === 1
        ? { status: 503, body: { class: ErrorClass.Unknown, reason: ReasonCode.DependencyUnavailable, operationId: "op-u" } }
        : recorded("tenant.restore");
    });
    const host = await mount(t, "zh-CN");
    await settle();
    expect(host.textContent).toContain("已暂停");
    await click(button(host, "恢复"));
    await click(button(host, "确认"));
    expect(host.querySelector("[role=alert]")?.textContent).toContain("op-u");
    expect([...host.querySelectorAll("[role=group] button")].map((b) => b.textContent)).not.toContain("取消");
    await click(button(host, "重查原请求"));
    const posts = t.send.mock.calls.map(([r]) => r).filter((r) => r.path === "/api/v1/actions");
    expect((posts[1]?.body as { idempotencyKey: string }).idempotencyKey)
      .toBe((posts[0]?.body as { idempotencyKey: string }).idempotencyKey);
  });

  it("派发中止显示原因；收敛中不给动作；状态不合契约显示读取失败", async () => {
    const aborted = routes([tenant({ lifecycleActionKey: "tenant.suspend" }), tenant({ id: "t-2", slug: "b", state: "SUSPENDING" })],
      () => ({ status: 202, body: { operationId: "op-a", actionExecutionId: "ae-a", actionKey: "tenant.suspend",
        gateState: "ALLOWED", dispatchState: "ABORTED" } }));
    const host = await mount(aborted);
    await settle();
    expect(host.querySelectorAll("button").length).toBe(2); // 刷新 + 一行暂停
    await click(button(host, "Suspend"));
    await click(button(host, "Confirm"));
    expect(host.querySelector("[role=alert]")?.textContent).toContain("op-a");

    const odd = await mount(routes([tenant({ state: "GONE" })], () => recorded("tenant.suspend")));
    await settle();
    expect(odd.textContent).toContain("result is unknown");
  });
});
