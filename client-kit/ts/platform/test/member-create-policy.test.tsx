// DD-164(3): the Tenant member create policy in the Kailo admin area.
import { act } from "react";
import { describe, expect, it } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { MemberCreatePolicyPanel, memberCreatePolicyEditable } from "../src/react/member-create-policy";
import type { BffRequest } from "../src/transport";
import { render, settle, until } from "./render";

const managerProfile = { name: "Kailo Verify", version: 7, memberCreatePolicy: "MEMBERS_CREATE", policyActionKey: "tenant.member_create_policy.set" };

function client(dispatch: "DISPATCHED" | "UNKNOWN", sent: BffRequest[]) {
  return createBffClient({ send: async (request) => {
    sent.push(request);
    return { status: 200, body: { actionExecutionId: "a", actionKey: "tenant.member_create_policy.set", operationId: "op-1", gateState: "ALLOWED", dispatchState: dispatch } } as never;
  } });
}

describe("member create policy", () => {
  it("is editable only when Core offers the action to this manager", () => {
    expect(memberCreatePolicyEditable(managerProfile as never)).toBe(true);
    expect(memberCreatePolicyEditable({ name: "x", version: 7 } as never)).toBe(false);
    expect(memberCreatePolicyEditable({ ...managerProfile, policyActionKey: "tenant.profile.update" } as never)).toBe(false);
    expect(memberCreatePolicyEditable({ ...managerProfile, memberCreatePolicy: "EVERYONE" } as never)).toBe(false);
  });

  it("renders nothing for a member without the action", async () => {
    const sent: BffRequest[] = [];
    const host = await render(<PlatformProvider client={client("DISPATCHED", sent)} locale="zh-CN">
      <MemberCreatePolicyPanel profile={{ name: "x", version: 3 } as never} onChanged={() => {}} /></PlatformProvider>);
    expect(host.querySelector('[data-testid="member-create-policy"]')).toBeNull();
  });

  it("asks for confirmation and submits the governed action with the read version", async () => {
    const sent: BffRequest[] = [];
    let changed = 0;
    const host = await render(<PlatformProvider client={client("DISPATCHED", sent)} locale="zh-CN">
      <MemberCreatePolicyPanel profile={managerProfile as never} onChanged={() => { changed += 1; }} /></PlatformProvider>);
    expect(host.textContent).toContain("成员可以创建内容（默认）");
    expect(host.textContent).toContain("所有者始终保有自己的资源");
    const save = host.querySelector<HTMLButtonElement>('[data-testid="member-create-policy-save"]')!;
    expect(save.disabled).toBe(true);
    await act(async () => host.querySelector<HTMLInputElement>('[data-testid="member-create-policy-ADMINS_ONLY"]')!.click());
    expect(save.disabled).toBe(false);
    await act(async () => save.click());
    await until(() => !!document.querySelector('[data-testid="member-create-policy-confirm-button"]'), "confirm dialog");
    expect(sent).toHaveLength(0);
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="member-create-policy-confirm-button"]')!.click());
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ actionKey: "tenant.member_create_policy.set", explicitConfirmation: true,
      tenantMemberCreatePolicy: { policy: "ADMINS_ONLY", expectedVersion: 7 } });
    expect(changed).toBe(1);
    expect(host.querySelector('[data-testid="member-create-policy-outcome"]')).not.toBeNull();
  });

  it("keeps the same command for a retry after an unknown outcome", async () => {
    const sent: BffRequest[] = [];
    const host = await render(<PlatformProvider client={client("UNKNOWN", sent)} locale="en">
      <MemberCreatePolicyPanel profile={managerProfile as never} onChanged={() => {}} /></PlatformProvider>);
    await act(async () => host.querySelector<HTMLInputElement>('[data-testid="member-create-policy-ADMINS_ONLY"]')!.click());
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="member-create-policy-save"]')!.click());
    await until(() => !!document.querySelector('[data-testid="member-create-policy-confirm-button"]'), "confirm dialog");
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="member-create-policy-confirm-button"]')!.click());
    await settle();
    const retry = host.querySelector<HTMLButtonElement>('[data-testid="member-create-policy-save"]')!;
    expect(retry.textContent).toBe("Retry the same change");
    await act(async () => retry.click());
    await settle();
    expect(sent).toHaveLength(2);
    expect((sent[0]!.body as { idempotencyKey: string }).idempotencyKey).toBe((sent[1]!.body as { idempotencyKey: string }).idempotencyKey);
  });
});
