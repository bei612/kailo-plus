import { ErrorClass, ReasonCode } from "@kailo/contracts";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { AuditPage, DevicesPage, WorkspaceMembersPage } from "../src/react/pages";
import { PlatformProvider } from "../src/react/context";
import { LegacySecretRefManagement, RoleManagement, RoleMembers } from "../src/react/roles";
import type { BffReply, BffRequest, BffTransport } from "../src/transport";
import { TransportError } from "../src/transport";
import { button, click, render, settle } from "./render";

type Route = (request: BffRequest) => BffReply | Promise<BffReply>;

function transport(route: Route): BffTransport & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn(async (r: BffRequest) => route(r)) };
}

function mount(t: BffTransport, ui: React.ReactNode, locale: "en" | "zh-CN" = "en") {
  return render(
    <PlatformProvider client={createBffClient(t)} locale={locale}>
      {ui}
    </PlatformProvider>,
  );
}

const key = (pubkey: string, state = "ACTIVE") => ({
  pubkey,
  state,
  createdAt: new Date().toISOString(),
});

describe("DevicesPage", () => {
  it("读不到不是「没有设备」：显示结果不明并可重试", async () => {
    let fail = true;
    const t = transport(() => {
      if (fail) throw new TransportError("down");
      return { status: 200, body: [key("a".repeat(64))] };
    });
    const host = await mount(t, <DevicesPage />);
    await settle();
    expect(host.textContent).toContain("the result is unknown");
    expect(host.textContent).not.toContain("No devices yet");
    fail = false;
    await click(button(host, "Try again"));
    expect(host.textContent).toContain("aaaaaaaa…aaaa");
  });

  it("标出本机；撤销结果不明时不说成功也不说失败", async () => {
    const mine = "b".repeat(64);
    const t = transport((r) => {
      if (r.method === "DELETE")
        return { status: 503, body: { class: ErrorClass.Unknown, reason: ReasonCode.DependencyUnavailable, operationId: "op-7" } };
      return { status: 200, body: [key(mine), key("c".repeat(64))] };
    });
    const host = await mount(t, <DevicesPage currentDevicePubkey={mine} />);
    await settle();
    expect(host.textContent).toContain("This device");
    expect(host.textContent).toContain("Active");
    expect(host.textContent).not.toContain("ACTIVE");
    await click(host.querySelectorAll("button")[0] as HTMLButtonElement);
    const alert = host.querySelector("[role=alert]")?.textContent ?? "";
    expect(alert).toContain("unknown");
    expect(alert).toContain("op-7");
    expect(alert).not.toContain("rejected");
    // 撤销之后重新读取列表，不自己推断状态
    expect(t.send.mock.calls.filter(([r]) => r.method === "GET")).toHaveLength(2);
  });

  it("确定被拒时给出 reason", async () => {
    const t = transport((r) =>
      r.method === "DELETE"
        ? { status: 404, body: { class: ErrorClass.Precondition, reason: ReasonCode.ClientKeyNotFound } }
        : { status: 200, body: [key("d".repeat(64))] },
    );
    const host = await mount(t, <DevicesPage />);
    await settle();
    await click(button(host, "Revoke"));
    expect(host.querySelector("[role=alert]")?.textContent).toContain("CLIENT_KEY_NOT_FOUND");
  });
});

describe("WorkspaceMembersPage", () => {
  it("取 Workspace 后按人列出成员与全部公钥", async () => {
    const t = transport((r) =>
      r.path === "/api/v1/workspaces"
        ? { status: 200, body: [{ id: "w1", name: "Ops", slug: "ops" }] }
        : r.path.startsWith("/api/v1/role-workspaces")
          ? { status: 200, body: { workspaces: [{ id: "w1", name: "Ops", state: "ACTIVE" }] } }
        : r.path.startsWith("/api/v1/role-members")
          ? { status: 403, body: {} }
        : {
            status: 200,
            body: [
              { principalId: "p1", displayName: "Ada", state: "ACTIVE", pubkeys: ["e".repeat(64), "f".repeat(64)] },
            ],
          },
    );
    const host = await mount(t, <WorkspaceMembersPage />);
    await settle();
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/workspaces/w1/members" });
    expect(host.textContent).toContain("Ada");
    expect(host.textContent).toContain("Member");
    expect(host.textContent).not.toContain("ACTIVE");
    expect(host.textContent).toContain("eeeeeeee…eeee · ffffffff…ffff");
  });

  it("没有可进入的 Workspace 就不画选择器", async () => {
    const host = await mount(transport((r) =>
      r.path.startsWith("/api/v1/role-members")
        ? { status: 403, body: {} }
        : r.path.startsWith("/api/v1/role-workspaces")
          ? { status: 200, body: { workspaces: [] } }
        : { status: 200, body: [] },
    ), <WorkspaceMembersPage />);
    await settle();
    expect(host.querySelector("select")).toBeNull();
    expect(host.textContent).toContain("no workspace");
  });
});

describe("LegacySecretRefManagement", () => {
  const binding = {
    principalId: "00000000-0000-0000-0000-000000000009",
    pubkey: "a".repeat(64),
    kind: "HUMAN",
  };

  it("无 Tenant manage 时入口不出现；读失败不伪装为空列表", async () => {
    const denied = await mount(transport(() => ({ status: 403, body: {} })), <LegacySecretRefManagement />);
    await settle();
    expect(denied.querySelector("[data-testid=legacy-secret-ref-management]")).toBeNull();
    const unpublished = await mount(transport(() => ({ status: 404, body: {} })), <LegacySecretRefManagement />);
    await settle();
    expect(unpublished.querySelector("[data-testid=legacy-secret-ref-management]")).toBeNull();
    const down = await mount(transport(() => ({ status: 503, body: {} })), <LegacySecretRefManagement />);
    await settle();
    expect(down.textContent).toContain("the result is unknown");
    expect(down.textContent).not.toContain("No legacy identity references");
  });

  it("显式确认后经语义命令提交；结果不明重试复用同一幂等键", async () => {
    let posts = 0;
    const t = transport((r) => {
      if (r.method === "GET") return { status: 200, body: { bindings: [binding] } };
      posts += 1;
      if (posts === 1) throw new TransportError("reply lost");
      return {
        status: 200,
        body: {
          actionKey: "identity.secret_ref.rehome",
          actionExecutionId: "execution-9",
          operationId: "operation-9",
          gateState: "ALLOWED",
          dispatchState: "DISPATCHED",
        },
      };
    });
    const host = await mount(t, <LegacySecretRefManagement />);
    await settle();
    await click(button(host, "Move reference"));
    expect(t.send.mock.calls.filter(([r]) => r.method === "POST")).toHaveLength(0);
    expect(host.textContent).toContain(binding.pubkey);
    await click(button(host, "Confirm"));
    expect(host.textContent).toContain("outcome unknown");
    await click(button(host, "Confirm"));
    const submitted = t.send.mock.calls
      .map(([r]) => r)
      .filter((r) => r.method === "POST");
    expect(submitted).toHaveLength(2);
    expect(submitted[0]?.body).toEqual(expect.objectContaining({
      actionKey: "identity.secret_ref.rehome",
      principalId: binding.principalId,
      explicitConfirmation: true,
    }));
    expect((submitted[0]?.body as { idempotencyKey: string }).idempotencyKey)
      .toBe((submitted[1]?.body as { idempotencyKey: string }).idempotencyKey);
    expect(host.textContent).toContain("Check Tasks for the final result");
  });
});

describe("RoleMembers", () => {
  const members = [
    {
      principalId: "00000000-0000-0000-0000-000000000001",
      displayName: "Ada",
      tenantAdmin: true,
      workspaceAdmin: false,
      canGrantTenantAdmin: false,
      canRevokeTenantAdmin: false,
      canGrantWorkspaceAdmin: false,
      canRevokeWorkspaceAdmin: false,
      lastTenantAdmin: true,
    },
    {
      principalId: "00000000-0000-0000-0000-000000000002",
      displayName: "Bo",
      tenantAdmin: false,
      workspaceAdmin: false,
      canGrantTenantAdmin: true,
      canRevokeTenantAdmin: false,
      canGrantWorkspaceAdmin: false,
      canRevokeWorkspaceAdmin: false,
      lastTenantAdmin: false,
    },
  ];

  it("候选人不依赖 WorkspaceMembership；最后一位 admin 不能撤，授予仍走 Governed Action", async () => {
    const t = transport((r) =>
      r.method === "POST"
        ? {
            status: 200,
            body: {
              actionKey: "tenant.admin.grant",
              actionExecutionId: "execution-1",
              operationId: "operation-1",
              gateState: "ALLOWED",
              dispatchState: "DISPATCHED",
            },
          }
        : { status: 200, body: { members } },
    );
    const host = await mount(t, <RoleMembers />);
    await settle();
    expect(host.textContent).toContain("Ada");
    expect(host.textContent).toContain("Bo");
    expect(host.textContent).toContain("LAST_TENANT_ADMIN");
    expect(button(host, "Revoke").disabled).toBe(true);
    await click(button(host, "Grant"));
    await click(button(host, "Confirm"));
    expect(t.send).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      path: "/api/v1/actions",
      body: expect.objectContaining({
        actionKey: "tenant.admin.grant",
        principalId: "00000000-0000-0000-0000-000000000002",
      }),
    }));
    expect(host.textContent).toContain("Check Tasks for its final result");
  });

  it("角色关系读取失败不变成空角色；无管理权时整节不出现", async () => {
    const down = await mount(transport(() => ({ status: 503, body: {} })), <RoleMembers />);
    await settle();
    expect(down.textContent).toContain("result is unknown");
    const denied = await mount(transport(() => ({ status: 403, body: {} })), <RoleMembers />);
    await settle();
    expect(denied.textContent).toBe("");
  });

  it("角色管理的 200 响应缺字段时显示读取失败，不当作空列表", async () => {
    const host = await mount(transport(() => ({ status: 200, body: { members: [null] } })), <RoleMembers />);
    await settle();
    expect(host.textContent).toContain("result is unknown");
    expect(host.textContent).not.toContain("No members");
  });

  it("Workspace 管理员即使不是频道成员，也能从独立管理列表选中 Workspace", async () => {
    const t = transport((r) =>
      r.path.startsWith("/api/v1/role-workspaces")
        ? { status: 200, body: { workspaces: [{ id: "w-admin", name: "Managed only", state: "ACTIVE" }] } }
        : { status: 200, body: { members: [{
          ...members[1],
          canGrantTenantAdmin: false,
          canGrantWorkspaceAdmin: true,
        }] } },
    );
    const host = await mount(t, <RoleManagement />);
    await settle();
    expect(host.textContent).toContain("Managed only");
    expect(t.send).toHaveBeenCalledWith({
      method: "GET", path: "/api/v1/role-members?workspaceId=w-admin",
    });
    expect(button(host, "Grant").disabled).toBe(false);
    // 没有给出动作键就不渲染暂停/恢复入口
    expect(host.querySelector("[data-testid=workspace-lifecycle]")).toBeNull();
  });
});

describe("Workspace 暂停与恢复", () => {
  const recorded = (actionKey: string) => ({
    status: 202,
    body: { operationId: "op-9", actionExecutionId: "ae-9", actionKey, gateState: "ALLOWED", dispatchState: "DISPATCHED" },
  });
  const roleRoutes = (workspace: Record<string, unknown>, action: (r: BffRequest) => BffReply) =>
    transport((r) =>
      r.path.startsWith("/api/v1/role-workspaces")
        ? { status: 200, body: { workspaces: [workspace] } }
        : r.path === "/api/v1/actions"
          ? action(r)
          : r.path.startsWith("/api/v1/role-members")
            ? { status: 200, body: { members: [] } }
            : { status: 200, body: [] },
    );

  it("只在给出暂停键时提供入口；受理回应只说已登记，不说成功", async () => {
    const t = roleRoutes(
      { id: "w-1", name: "Ops", state: "ACTIVE", lifecycleActionKey: "workspace.suspend" },
      () => recorded("workspace.suspend"),
    );
    const host = await mount(t, <RoleManagement />);
    await settle();
    expect(host.querySelector("[data-testid=workspace-state]")?.textContent).toContain("Active");
    await click(button(host, "Suspend"));
    expect(host.textContent).toContain("Suspend workspace Ops?");
    await click(button(host, "Confirm"));
    const post = t.send.mock.calls.map(([r]) => r).find((r) => r.path === "/api/v1/actions");
    expect(post?.body).toMatchObject({ actionKey: "workspace.suspend", workspaceId: "w-1" });
    expect(Object.keys(post?.body ?? {}).sort()).toEqual(["actionKey", "idempotencyKey", "workspaceId"]);
    const status = host.querySelector("[data-testid=workspace-lifecycle] [role=status]")?.textContent ?? "";
    expect(status).toContain("Request recorded");
    expect(status).toContain("op-9");
    expect(status).not.toMatch(/succe/i);
  });

  it("结果不明时保留原幂等键重查，不另发一笔也不能取消", async () => {
    let calls = 0;
    const t = roleRoutes(
      { id: "w-1", name: "Ops", state: "ACTIVE", lifecycleActionKey: "workspace.suspend" },
      () => {
        calls++;
        return calls === 1
          ? { status: 503, body: { class: ErrorClass.Unknown, reason: ReasonCode.DependencyUnavailable, operationId: "op-u" } }
          : recorded("workspace.suspend");
      },
    );
    const host = await mount(t, <RoleManagement />);
    await settle();
    await click(button(host, "Suspend"));
    await click(button(host, "Confirm"));
    expect(host.querySelector("[data-testid=workspace-lifecycle] [role=alert]")?.textContent).toContain("op-u");
    expect([...host.querySelectorAll("[data-testid=workspace-lifecycle] button")].map((b) => b.textContent))
      .not.toContain("Cancel");
    await click(button(host, "Retry same request"));
    const posts = t.send.mock.calls.map(([r]) => r).filter((r) => r.path === "/api/v1/actions");
    expect(posts).toHaveLength(2);
    expect((posts[1]?.body as { idempotencyKey: string }).idempotencyKey)
      .toBe((posts[0]?.body as { idempotencyKey: string }).idempotencyKey);
    expect(host.textContent).toContain("Request recorded");
  });

  it("已暂停的 Workspace 显示状态与恢复入口，角色视图退回 Tenant 级", async () => {
    const t = roleRoutes(
      { id: "w-2", name: "Paused", state: "SUSPENDED", lifecycleActionKey: "workspace.restore" },
      () => recorded("workspace.restore"),
    );
    const host = await mount(t, <RoleManagement />, "zh-CN");
    await settle();
    expect(host.querySelector("[data-testid=workspace-state]")?.textContent).toContain("已暂停");
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/role-members" });
    expect(t.send).not.toHaveBeenCalledWith({ method: "GET", path: "/api/v1/role-members?workspaceId=w-2" });
    await click(button(host, "恢复"));
    expect(host.textContent).toContain("恢复工作区 Paused？");
  });

  it("派发中止显示原因并放下意图；未派发按结果不明保留原幂等键", async () => {
    const aborted = roleRoutes(
      { id: "w-1", name: "Ops", state: "ACTIVE", lifecycleActionKey: "workspace.suspend" },
      () => ({ status: 202, body: { operationId: "op-a", actionExecutionId: "ae-a", actionKey: "workspace.suspend",
        gateState: "ALLOWED", dispatchState: "ABORTED" } }),
    );
    const host = await mount(aborted, <RoleManagement />);
    await settle();
    await click(button(host, "Suspend"));
    await click(button(host, "Confirm"));
    const alert = host.querySelector("[data-testid=workspace-lifecycle] [role=alert]")?.textContent ?? "";
    expect(alert).toContain("not carried out");
    expect(alert).toContain("ABORTED");
    expect(alert).toContain("op-a");
    expect(host.textContent).not.toContain("Retry same request");

    let calls = 0;
    const pending = roleRoutes(
      { id: "w-1", name: "Ops", state: "ACTIVE", lifecycleActionKey: "workspace.suspend" },
      () => {
        calls++;
        return calls === 1
          ? { status: 202, body: { operationId: "op-p", actionExecutionId: "ae-p", actionKey: "workspace.suspend",
            gateState: "ALLOWED", dispatchState: "UNKNOWN" } }
          : recorded("workspace.suspend");
      },
    );
    const again = await mount(pending, <RoleManagement />);
    await settle();
    await click(button(again, "Suspend"));
    await click(button(again, "Confirm"));
    expect(again.querySelector("[data-testid=workspace-lifecycle] [role=alert]")?.textContent).toContain("op-p");
    expect(again.textContent).not.toContain("Request recorded");
    await click(button(again, "Retry same request"));
    const posts = pending.send.mock.calls.map(([r]) => r).filter((r) => r.path === "/api/v1/actions");
    expect((posts[1]?.body as { idempotencyKey: string }).idempotencyKey)
      .toBe((posts[0]?.body as { idempotencyKey: string }).idempotencyKey);
    expect(again.textContent).toContain("Request recorded");
  });

  it("选中非 ACTIVE Workspace 时显式标注当前作用域为整个组织", async () => {
    const t = roleRoutes({ id: "w-4", name: "Broken", state: "ERROR", lifecycleActionKey: "workspace.suspend" },
      () => recorded("workspace.suspend"));
    const host = await mount(t, <RoleManagement />);
    await settle();
    expect(host.querySelector("[data-testid=role-scope-tenant]")?.textContent).toContain("whole organization");
    expect(button(host, "Suspend").disabled).toBe(false);
  });

  it("状态不合契约时显示读取失败", async () => {
    const t = roleRoutes({ id: "w-3", name: "Odd", state: "DELETED" }, () => recorded("workspace.suspend"));
    const host = await mount(t, <RoleManagement />);
    await settle();
    expect(host.textContent).toContain("result is unknown");
  });
});

const ownEntry = () => ({
  actionKey: "identity.client-key.register",
  decision: "ALLOW",
  eventType: "DECISION",
  occurredAt: new Date().toISOString(),
  resultCode: "ACCEPTED",
});

const forbidden = { status: 403, body: { class: ErrorClass.Denied, reason: ReasonCode.PermissionDenied } };

describe("AuditPage", () => {
  it("列出本人的动作", async () => {
    const t = transport((r) => (r.path === "/api/v1/audit" ? { status: 200, body: [ownEntry()] } : forbidden));
    const host = await mount(t, <AuditPage />);
    await settle();
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/audit" });
    expect(host.textContent).toContain("identity.client-key.register");
    expect(host.textContent).toContain("Decision");
    expect(host.textContent).not.toContain("DECISION");
  });

  it("中文界面从同一目录翻译审计事件类型", async () => {
    const host = await mount(
      transport((r) => (r.path === "/api/v1/audit" ? { status: 200, body: [ownEntry()] } : forbidden)),
      <AuditPage />,
      "zh-CN",
    );
    await settle();
    expect(host.textContent).toContain("决策");
    expect(host.textContent).not.toContain("DECISION");
  });
});

describe("AuditPage 范围审计", () => {
  const event = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    occurredAt: new Date().toISOString(),
    eventType: "DECISION",
    actionKey: "tenant.admin.grant",
    decision: "ALLOW",
    resultCode: "ACCEPTED",
    evidence: [],
    ...extra,
  });
  const workspaces = [{ id: "w-1", name: "Alpha" }];

  it("Tenant 无权且没有可进入的 Workspace 时整节不渲染，本人记录照常", async () => {
    const t = transport((r) => (r.path === "/api/v1/audit" ? { status: 200, body: [ownEntry()] } : r.path === "/api/v1/workspaces" ? { status: 200, body: [] } : forbidden));
    const host = await mount(t, <AuditPage />);
    await settle();
    expect(host.querySelector("[data-testid=scoped-audit]")).toBeNull();
    expect(host.textContent).toContain("identity.client-key.register");
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/audit/events" });
  });

  it("Workspace auditor：Tenant 403 时仍可选 Workspace；该 Workspace 403 显示无权；解引用 403 不显示 ref", async () => {
    const t = transport((r) => {
      if (r.path === "/api/v1/audit") return { status: 200, body: [] };
      if (r.path === "/api/v1/workspaces")
        return { status: 200, body: [...workspaces, { id: "w-2", name: "Beta" }] };
      if (r.path === "/api/v1/audit/events?workspaceId=w-2")
        return {
          status: 200,
          body: { events: [event("e-9", { workspaceId: "w-2", evidence: [{ index: 0, kind: "BUZZ_EVENT_ID", authority: "BUZZ", sensitivity: "SUMMARY" }] })] },
        };
      if (r.path === "/api/v1/audit/events/e-9/evidence/0")
        return { status: 403, body: { class: ErrorClass.Denied, reason: ReasonCode.PermissionDenied, stableId: "leak-me" } };
      return forbidden;
    });
    const host = await mount(t, <AuditPage />);
    await settle();
    const section = host.querySelector("[data-testid=scoped-audit]") as HTMLElement;
    expect(section.textContent).toContain("You do not have audit permission for the whole organization");
    const select = section.querySelector("select") as HTMLSelectElement;
    expect((select.querySelector("option[value='']") as HTMLOptionElement).disabled).toBe(true);
    // Tenant 已知无权，不再重复读取
    expect(t.send.mock.calls.filter(([r]) => r.path.startsWith("/api/v1/audit/events"))).toHaveLength(1);
    const choose = async (value: string) => {
      await act(async () => {
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await settle();
    };
    await choose("w-1");
    expect(section.textContent).toContain("You do not have audit permission for this scope.");
    expect((select.querySelector("option[value='']") as HTMLOptionElement).disabled).toBe(true);
    await choose("w-2");
    expect(section.textContent).toContain("tenant.admin.grant");
    await click(button(section, "Buzz event"));
    expect(section.textContent).toContain("You do not have audit permission for this scope.");
    expect(section.textContent).not.toContain("leak-me");
    expect(section.querySelector("[data-testid=evidence-available]")).toBeNull();
  });

  it("判定不明（503）不显示成没有事件，可重试", async () => {
    let fail = true;
    const t = transport((r) => {
      if (r.path === "/api/v1/audit") return { status: 200, body: [] };
      if (r.path === "/api/v1/workspaces") return { status: 200, body: workspaces };
      if (fail) return { status: 503, body: { class: ErrorClass.Unknown, reason: ReasonCode.DependencyUnavailable } };
      return { status: 200, body: { events: [event("e-1")] } };
    });
    const host = await mount(t, <AuditPage />);
    await settle();
    const section = host.querySelector("[data-testid=scoped-audit]") as HTMLElement;
    expect(section.textContent).toContain("the result is unknown");
    expect(section.textContent).not.toContain("No events recorded in this scope");
    fail = false;
    await click(button(section, "Try again"));
    expect(section.textContent).toContain("tenant.admin.grant");
  });

  it("证据按种类列出；受限在列表上标注；不可用只显示原因不显示 ref", async () => {
    const t = transport((r) => {
      if (r.path === "/api/v1/audit") return { status: 200, body: [] };
      if (r.path === "/api/v1/workspaces") return { status: 200, body: workspaces };
      if (r.path === "/api/v1/audit/events")
        return {
          status: 200,
          body: {
            events: [event("e-1", {
              workspaceId: "w-1",
              evidence: [
                { index: 0, kind: "TEMPORAL_WORKFLOW_ID", authority: "TEMPORAL", sensitivity: "SUMMARY" },
                { index: 1, kind: "BUZZ_EVENT_ID", authority: "BUZZ", sensitivity: "RESTRICTED" },
                { index: 2 },
              ],
            })],
          },
        };
      if (r.path === "/api/v1/audit/events/e-1/evidence/0")
        return { status: 200, body: { available: true, kind: "TEMPORAL_WORKFLOW_ID", authority: "TEMPORAL", sensitivity: "SUMMARY", stableId: "wf-123", version: 4 } };
      if (r.path === "/api/v1/audit/events/e-1/evidence/1")
        // 即使回应违约带了 ref，不可用时也不能显示
        return { status: 200, body: { available: false, unavailableReason: "RESTRICTED", stableId: "leak-me" } };
      if (r.path === "/api/v1/audit/events/e-1/evidence/2")
        return { status: 200, body: { available: false, unavailableReason: "UNRECOGNIZED" } };
      return forbidden;
    });
    const host = await mount(t, <AuditPage />);
    await settle();
    const section = host.querySelector("[data-testid=scoped-audit]") as HTMLElement;
    expect(section.textContent).toContain("Alpha");
    expect(section.textContent).toContain("Restricted");
    expect(section.textContent).not.toContain("wf-123");
    await click(button(section, "Workflow"));
    expect(section.textContent).toContain("wf-123");
    expect(section.textContent).toContain("version 4");
    expect(section.textContent).toContain("Workflow engine");
    await click(button(section, "Buzz event"));
    expect(section.textContent).toContain("Unavailable: restricted evidence you are not authorized to view");
    await click(button(section, "Unrecognized evidence"));
    expect(section.textContent).toContain("Unavailable: the evidence kind is not recognized");
    expect(section.textContent).not.toContain("leak-me");
  });

  it("按 nextCursor 加载更多；选择 Workspace 按该范围读取", async () => {
    const t = transport((r) => {
      if (r.path === "/api/v1/audit") return { status: 200, body: [] };
      if (r.path === "/api/v1/workspaces") return { status: 200, body: workspaces };
      if (r.path === "/api/v1/audit/events") return { status: 200, body: { events: [event("e-1")], nextCursor: "e-1" } };
      if (r.path === "/api/v1/audit/events?cursor=e-1")
        return { status: 200, body: { events: [event("e-2", { actionKey: "tenant.admin.revoke" })] } };
      if (r.path === "/api/v1/audit/events?workspaceId=w-1")
        return { status: 200, body: { events: [event("e-3", { actionKey: "workspace.admin.grant", workspaceId: "w-1" })] } };
      return forbidden;
    });
    const host = await mount(t, <AuditPage />, "zh-CN");
    await settle();
    const section = host.querySelector("[data-testid=scoped-audit]") as HTMLElement;
    await click(button(section, "加载更多"));
    expect(section.textContent).toContain("tenant.admin.grant");
    expect(section.textContent).toContain("tenant.admin.revoke");
    expect(section.querySelectorAll("button").length).toBe(0);
    const select = section.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      select.value = "w-1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(section.textContent).toContain("workspace.admin.grant");
    expect(section.textContent).not.toContain("tenant.admin.revoke");
  });
});
