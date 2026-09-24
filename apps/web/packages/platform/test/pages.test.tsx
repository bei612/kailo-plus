import { ErrorClass, ReasonCode } from "@kailo/contracts";
import { describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { AuditPage, DevicesPage, WorkspaceMembersPage } from "../src/react/pages";
import { PlatformProvider } from "../src/react/context";
import type { BffReply, BffRequest, BffTransport } from "../src/transport";
import { TransportError } from "../src/transport";
import { button, click, render, settle } from "./render";

type Route = (request: BffRequest) => BffReply | Promise<BffReply>;

function transport(route: Route): BffTransport & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn(async (r: BffRequest) => route(r)) };
}

function mount(t: BffTransport, ui: React.ReactNode) {
  return render(
    <PlatformProvider client={createBffClient(t)} locale="en">
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
    expect(host.textContent).toContain("eeeeeeee…eeee · ffffffff…ffff");
  });

  it("没有可进入的 Workspace 就不画选择器", async () => {
    const host = await mount(transport(() => ({ status: 200, body: [] })), <WorkspaceMembersPage />);
    await settle();
    expect(host.querySelector("select")).toBeNull();
    expect(host.textContent).toContain("no workspace");
  });
});

describe("AuditPage", () => {
  it("列出本人的动作", async () => {
    const t = transport(() => ({
      status: 200,
      body: [
        {
          actionKey: "identity.client-key.register",
          decision: "ALLOW",
          eventType: "DECISION",
          occurredAt: new Date().toISOString(),
          resultCode: "ACCEPTED",
        },
      ],
    }));
    const host = await mount(t, <AuditPage />);
    await settle();
    expect(t.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/audit" });
    expect(host.textContent).toContain("identity.client-key.register");
  });
});
