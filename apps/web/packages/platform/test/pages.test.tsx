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
          ? { status: 200, body: { workspaces: [{ id: "w1", name: "Ops" }] } }
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
        ? { status: 200, body: { workspaces: [{ id: "w-admin", name: "Managed only" }] } }
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
