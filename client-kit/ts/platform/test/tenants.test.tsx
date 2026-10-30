import { ErrorClass, ReasonCode } from "@client-kit/contracts";
import { act } from "react";
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

async function menuAction(host: HTMLElement, name: string, label: string) {
  const trigger = host.querySelector<HTMLButtonElement>(`button[aria-label="Actions for ${name}"], button[aria-label="${name} 的操作"]`);
  if (!trigger) throw new Error(`no row menu for ${name}`);
  await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await settle();
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((node) => node.textContent === label);
  if (!item) throw new Error(`no menu item ${label}`);
  await click(item);
}
const dialog = () => document.querySelector<HTMLElement>("[data-testid=tenant-lifecycle-dialog]");

const tenant = (extra: Record<string, unknown>) => ({ id: "t-1", name: "Acme", slug: "acme", state: "ACTIVE", ...extra });
const recorded = (actionKey: string) => ({
  status: 200,
  body: { operationId: "op-1", actionExecutionId: "ae-1", actionKey, gateState: "ALLOWED", dispatchState: "DISPATCHED" },
});
const routes = (rows: unknown[], action: (r: BffRequest) => BffReply) =>
  transport((r) => (r.path.startsWith("/api/v1/platform/tenants") ? { status: 200, body: { tenants: rows } } : action(r)));

describe("PlatformTenantManagement", () => {
  it("非 Catalog 会话（403）说明需要的角色，不留空白；未发布（404）说明未开放", async () => {
    const host = await mount(transport(() => ({ status: 403, body: { class: ErrorClass.Denied, reason: ReasonCode.PermissionDenied } })));
    await settle();
    expect(host.querySelector("[data-testid=permission-state]")?.textContent).toContain("Only operators of this deployment can manage organizations.");
    expect(host.querySelector("[data-testid=platform-tenants]")).toBeNull();
    const missing = await mount(transport(() => ({ status: 404, body: {} })));
    await settle();
    expect(missing.querySelector("[data-testid=empty-state]")?.textContent).toContain("Not available here");
  });

  it("组织表显示总数、状态译文与标识；无动作的行没有菜单", async () => {
    const t = routes([tenant({ lifecycleActionKey: "tenant.suspend" }), tenant({ id: "t-2", name: "Beta", slug: "beta", state: "SUSPENDING" })], () => recorded("tenant.suspend"));
    const host = await mount(t, "zh-CN");
    await settle();
    expect(host.querySelector("[data-testid=list-total]")?.textContent).toBe("共 2 条");
    expect(host.textContent).toContain("正常");
    expect(host.textContent).toContain("正在暂停");
    expect(host.textContent).not.toContain("SUSPENDING");
    expect(host.textContent).not.toContain("租户");
    expect(host.querySelector('button[aria-label="Acme 的操作"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Beta 的操作"]')).toBeNull();
  });

  it("暂停带显式确认提交；受理回应只说已登记", async () => {
    const t = routes([tenant({ lifecycleActionKey: "tenant.suspend" })], () => recorded("tenant.suspend"));
    const host = await mount(t);
    await settle();
    expect(host.textContent).toContain("Active");
    await menuAction(host, "Acme", "Suspend");
    expect(t.send.mock.calls.some(([r]) => r.path === "/api/v1/actions")).toBe(false);
    expect(dialog()?.textContent).toContain("Suspend organization Acme?");
    expect(dialog()?.textContent).toContain("All of its members lose access at once");
    await click(button(dialog()!, "Suspend"));
    expect(dialog()).toBeNull();
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
    await menuAction(host, "Acme", "恢复");
    expect(dialog()?.textContent).toContain("恢复组织 Acme？");
    await click(button(dialog()!, "恢复"));
    expect(host.querySelector("[role=alert]")?.textContent).toContain("op-u");
    // 结果不明：对话框保留原请求，只能重查；关闭对话框也不放下意图
    expect(dialog()?.textContent).toContain("结果不明");
    expect(button(dialog()!, "重查原请求")).toBeTruthy();
    await click(button(dialog()!, "取消"));
    expect(dialog()).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Acme 的操作"]')?.disabled).toBe(true);
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
    expect(host.querySelectorAll('button[aria-label^="Actions for"]').length).toBe(1); // 只有可暂停的一行有菜单
    await menuAction(host, "Acme", "Suspend");
    await click(button(dialog()!, "Suspend"));
    expect(host.querySelector("[role=alert]")?.textContent).toContain("op-a");
    expect(dialog()).toBeNull();

    const odd = await mount(routes([tenant({ state: "GONE" })], () => recorded("tenant.suspend")));
    await settle();
    expect(odd.querySelector("[data-testid=error-state]")).not.toBeNull();
    expect(odd.textContent).not.toContain("GONE");
  });
});
