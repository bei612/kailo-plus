import {
  ActionGateState,
  ApprovalStatus,
  ErrorClass,
  type InvitationRedemptionView,
  ReasonCode,
  TenantMembershipState,
} from "@kailo/contracts";
import { describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { newIdempotencyKey, redemptionPhase } from "../src/governance";
import { PlatformProvider } from "../src/react/context";
import { ApprovalsPage } from "../src/react/governance";
import { InvitationRedeemPage, TenantInvitations } from "../src/react/invitations";
import { type BffReply, type BffRequest, TransportError } from "../src/transport";
import { button, click, render, settle, type } from "./render";

type Route = (r: BffRequest) => BffReply | Promise<BffReply>;

function mount(route: Route, ui: React.ReactNode) {
  const send = vi.fn(async (r: BffRequest) => route(r));
  return {
    send,
    host: render(
      <PlatformProvider client={createBffClient({ send })} locale="en">
        {ui}
      </PlatformProvider>,
    ),
  };
}

const denied = { status: 403, body: { class: ErrorClass.Denied, reason: ReasonCode.PermissionDenied } };
const CREDENTIAL = "c".repeat(64);
const LINK = `http://gateway.example/app/invite#${CREDENTIAL}`;

const invitation = (over: Record<string, unknown> = {}) => ({
  invitationId: "inv-1",
  inviteeLabel: "Grace from Ops",
  inviterPrincipalId: "p-admin",
  status: "ISSUED",
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  ...over,
});

const redemption = (over: Partial<InvitationRedemptionView> = {}): InvitationRedemptionView => ({
  invitationId: "inv-1",
  tenantId: "t1",
  tenantName: "Acme",
  membershipState: TenantMembershipState.Invited,
  admissionGateState: ActionGateState.Waiting,
  redeemedAt: new Date().toISOString(),
  ...over,
});

describe("newIdempotencyKey / redemptionPhase", () => {
  it("幂等键是 UUID v4，每次不同", () => {
    const a = newIdempotencyKey();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newIdempotencyKey()).not.toBe(a);
  });

  it("INVITED + WAITING 是等待确认；REVOKED 带原因终结；ACTIVE 可进入", () => {
    expect(redemptionPhase(redemption()).kind).toBe("waiting");
    expect(
      redemptionPhase(
        redemption({ membershipState: TenantMembershipState.Revoked, reason: ReasonCode.ApprovalDenied }),
      ),
    ).toEqual({ kind: "ended", reason: ReasonCode.ApprovalDenied });
    expect(redemptionPhase(redemption({ membershipState: TenantMembershipState.Active })).kind).toBe("active");
  });
});

describe("TenantInvitations", () => {
  it("BFF 回 403（不是 admin）：整节不渲染", async () => {
    const { host } = mount(() => denied, <TenantInvitations />);
    const el = await host;
    await settle();
    expect(el.textContent).toBe("");
  });

  it("签发：链接只显示一次、提示丢失即撤回重发；撤回需确认并带 invitationId", async () => {
    let rows = [] as ReturnType<typeof invitation>[];
    const { send, host } = mount((r) => {
      if (r.method === "GET") return { status: 200, body: rows };
      const cmd = r.body as { actionKey: string; name?: string; invitationId?: string };
      if (cmd.actionKey === "tenant.member.invite") {
        rows = [invitation({ inviteeLabel: cmd.name })];
        return {
          status: 200,
          body: {
            operationId: "op-1",
            actionExecutionId: "ae-1",
            actionKey: cmd.actionKey,
            gateState: "ALLOWED",
            dispatchState: "DISPATCHED",
            invitation: { invitationId: "inv-1", link: LINK, expiresAt: rows[0]?.expiresAt },
          },
        };
      }
      rows = [invitation({ status: "REVOKED" })];
      return {
        status: 200,
        body: { operationId: "op-2", actionExecutionId: "ae-2", actionKey: cmd.actionKey, gateState: "ALLOWED", dispatchState: "DISPATCHED" },
      };
    }, <TenantInvitations />);
    const el = await host;
    await settle();
    expect(el.textContent).toContain("No invitations yet.");
    await type(el.querySelector("input[name=inviteeLabel]") as HTMLInputElement, "Grace from Ops");
    await click(button(el, "Create invitation link"));
    const issued = el.querySelector("[data-testid=issued-invitation]");
    expect(issued?.textContent).toContain("shown only this once");
    expect((issued?.querySelector("input") as HTMLInputElement).value).toBe(LINK);
    const post = send.mock.calls.map(([r]) => r as BffRequest).find((r) => r.method === "POST");
    expect(post?.path).toBe("/api/v1/actions");
    expect(post?.body).toMatchObject({ actionKey: "tenant.member.invite", name: "Grace from Ops" });
    // 列表不含凭据：链接只在签发回应里
    expect(el.querySelector("table")?.textContent).not.toContain(CREDENTIAL);

    await click(button(el, "Withdraw"));
    expect(el.textContent).toContain("Its link will stop working");
    await click(button(el, "Confirm"));
    const posts = send.mock.calls.map(([r]) => r as BffRequest).filter((r) => r.method === "POST");
    expect(posts[1]?.body).toMatchObject({ actionKey: "tenant.member.invite.revoke", invitationId: "inv-1" });
    expect(el.textContent).toContain("Withdrawn");
  });

  it("签发结果不明：不说成功或失败，给出 operation 并提示去列表核对", async () => {
    const { host } = mount(
      (r) =>
        r.method === "GET"
          ? { status: 200, body: [] }
          : { status: 503, body: { class: ErrorClass.Unknown, reason: ReasonCode.DependencyUnavailable, operationId: "op-9" } },
      <TenantInvitations />,
    );
    const el = await host;
    await settle();
    await type(el.querySelector("input[name=inviteeLabel]") as HTMLInputElement, "Grace");
    await click(button(el, "Create invitation link"));
    const alert = el.querySelector("[role=alert]")?.textContent ?? "";
    expect(alert).toContain("not known");
    expect(alert).toContain("op-9");
    expect(alert).not.toContain("not created");
  });
});

describe("InvitationRedeemPage", () => {
  it("凭据只进请求体；等待确认如实显示", async () => {
    let redeemed = false;
    const { send, host } = mount((r) => {
      if (r.path === "/api/v1/invitations/redeem") {
        redeemed = true;
        return { status: 202, body: redemption() };
      }
      return { status: 200, body: redeemed ? [redemption()] : [] };
    }, <InvitationRedeemPage credential={CREDENTIAL} />);
    const el = await host;
    await settle();
    await type(el.querySelector("input[name=displayName]") as HTMLInputElement, "Grace Hopper");
    await click(button(el, "Use this invitation"));
    const calls = send.mock.calls.map(([r]) => r as BffRequest);
    expect(calls.find((r) => r.method === "POST")?.body).toEqual({ credential: CREDENTIAL, displayName: "Grace Hopper" });
    expect(calls.every((r) => !r.path.includes(CREDENTIAL))).toBe(true);
    expect(el.textContent).toContain("Waiting for an admin of Acme to confirm it is you.");
  });

  it("结果不明可原样重发；确定被拒给出用户能懂的原因", async () => {
    let attempt = 0;
    const { host } = mount((r) => {
      if (r.path !== "/api/v1/invitations/redeem") return { status: 200, body: [] };
      attempt += 1;
      if (attempt === 1) throw new TransportError("down");
      return { status: 409, body: { class: ErrorClass.Conflict, reason: ReasonCode.InvitationRevoked } };
    }, <InvitationRedeemPage credential={CREDENTIAL} />);
    const el = await host;
    await settle();
    await type(el.querySelector("input[name=displayName]") as HTMLInputElement, "Grace");
    await click(button(el, "Use this invitation"));
    expect(el.querySelector("[role=alert]")?.textContent).toContain("Submitting again is safe.");
    await click(button(el, "Submit again"));
    expect(el.querySelector("[role=alert]")?.textContent).toBe(
      "The invitation could not be used: This invitation was withdrawn. Ask for a new one. (INVITATION_REVOKED)",
    );
  });

  it("没有凭据：只显示进度与再次打开链接的提示", async () => {
    const { send, host } = mount(() => ({ status: 200, body: [] }), <InvitationRedeemPage credential={null} />);
    const el = await host;
    await settle();
    expect(el.textContent).toContain("open the link again now that you are signed in");
    expect(el.querySelector("input[name=displayName]")).toBeNull();
    expect(send.mock.calls.every(([r]) => (r as BffRequest).method === "GET")).toBe(true);
  });
});

describe("审批详情里的邀请", () => {
  it("确认兑换的审批带出邀请称呼与兑换者自报名", async () => {
    const wf = "kailo:APPROVAL:t1:ae-admit:1";
    const approval = {
      workflowId: wf,
      actionExecutionId: "ae-admit",
      actionKey: "tenant.member.admit",
      targetType: "TENANT_MEMBERSHIP",
      targetId: "m1",
      initiatorPrincipalId: "p-admin",
      status: ApprovalStatus.Waiting,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      decisions: [],
      roleRequirements: [{ selector: "TENANT_ADMIN", minDistinct: 1 }],
    };
    const { host } = mount((r) => {
      if (r.path === "/api/v1/approvals") return { status: 200, body: [approval] };
      if (r.path === "/api/v1/invitations")
        return {
          status: 200,
          body: [
            invitation({
              status: "REDEEMED",
              redeemerDisplayName: "Grace Hopper",
              approvalWorkflowId: wf,
              approvalStatus: "WAITING",
            }),
          ],
        };
      return { status: 200, body: approval };
    }, <ApprovalsPage />);
    const el = await host;
    await settle();
    await click(button(el, "tenant.member.admit"));
    expect(el.querySelector("[data-testid=invitation-for-approval]")?.textContent).toBe(
      "Invitation for “Grace from Ops”, used by someone who calls themselves “Grace Hopper”. Confirm it is really them before approving.",
    );
  });
});
