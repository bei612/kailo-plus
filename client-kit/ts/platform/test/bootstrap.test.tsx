import { ErrorClass, ReasonCode, type NativeCommunityFacts } from "@client-kit/contracts";
import { describe, expect, it, vi } from "vitest";
import { translate } from "../src/i18n";
import type { Invoke, NativeConfig } from "../src/native";
import { NativeBootstrap } from "../src/react/NativeBootstrap";
import { button, click, render, settle, type } from "./render";

const facts = { communityHost: "c.example:8443", relayUrl: "wss://c.example:8443" };
const PUBKEY = "a".repeat(64);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

type Scripted = Partial<Record<string, (args?: Record<string, unknown>) => unknown>>;

/** 一个按命令名作答的 invoke 替身；未登记的命令即测试错误。 */
function fakeInvoke(script: Scripted) {
  return vi.fn<Invoke>(async (command, args) => {
    const handler = script[command];
    if (!handler) throw new Error(`未预期的命令 ${command}`);
    return handler(args);
  });
}

const api = (routes: Record<string, () => unknown>) => (args?: Record<string, unknown>) => {
  const route = routes[`${args?.method} ${args?.path}`];
  if (!route) throw new Error(`未预期的请求 ${args?.method} ${args?.path}`);
  return route();
};

async function mount(invoke: Invoke, connect: (facts: NativeCommunityFacts, signal: AbortSignal) => Promise<void> = vi.fn(async () => {})) {
  const host = await render(
    <NativeBootstrap invoke={invoke} connect={connect} locale="en">
      {(s) => <div data-testid="app">connected {s.facts.relayUrl} as {s.devicePubkey}</div>}
    </NativeBootstrap>,
  );
  await settle();
  return host;
}

describe("NativeBootstrap", () => {
  it.each([{}, { accessMode: "UNRECOGNIZED" }, null])("缺失或未知会话准入模式不登记设备：%j", async (body) => {
    const invoke = fakeInvoke({
      platform_get_config: () => ({}),
      platform_status: () => ({ configured: true, signedIn: true }),
      platform_api: api({ "GET /api/v1/session": () => ({ status: 200, body }) }),
    });
    const host = await mount(invoke);
    expect(host.querySelector("[data-testid=app]")).toBeNull();
    expect(host.querySelector("[role=alert]")).not.toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("platform_register_device", undefined);
  });

  it("受限会话只显示共享生命周期任务与审批，不登记设备或连接Relay", async () => {
    const connect = vi.fn(async () => {});
    const invoke = fakeInvoke({
      platform_get_config: () => ({}),
      platform_status: () => ({ configured: true, signedIn: true }),
      platform_api: api({
        "GET /api/v1/session": () => ({ status: 200, body: { accessMode: "LIFECYCLE_RESTRICTED" } }),
        "GET /api/v1/platform-info": () => ({ status: 200, body: { displayName: "Platform" } }),
        "GET /api/v1/tasks": () => ({ status: 200, body: [] }),
        "GET /api/v1/approvals": () => ({ status: 200, body: [] }),
      }),
    });
    const host = await mount(invoke, connect);
    expect(button(host, translate("en", "platform.tab.tasks"))).toBeTruthy();
    await click(button(host, translate("en", "platform.tab.approvals")));
    expect(host.querySelector("[data-testid=app]")).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("platform_register_device", undefined);
    expect(connect).not.toHaveBeenCalled();
  });

  it("未配置：空表单，不预填任何地址；保存后进入登录", async () => {
    let saved: NativeConfig | null = null;
    const invoke = fakeInvoke({
      platform_get_config: () => saved,
      platform_status: () => ({ configured: saved !== null, signedIn: false }),
      platform_set_config: (args) => {
        saved = args?.config as NativeConfig;
      },
    });
    const host = await mount(invoke);
    const inputs = [...host.querySelectorAll("input")];
    expect(inputs.map((i) => i.value)).toEqual(["", "", ""]);
    await type(inputs[0] as HTMLInputElement, "https://platform.example:8091");
    await type(inputs[1] as HTMLInputElement, "https://idp.example/realms/k");
    await type(inputs[2] as HTMLInputElement, "platform-native");
    await click(button(host, "Save and continue"));
    expect(saved).toEqual({
      nativeApiUrl: "https://platform.example:8091",
      oidcIssuer: "https://idp.example/realms/k",
      oidcClientId: "platform-native",
    });
    expect(button(host, "Sign in")).toBeTruthy();
  });

  it("配置被 Rust 侧拒绝时显示本地化拒绝而不泄露原生错误，并保留输入", async () => {
    const invoke = fakeInvoke({
      platform_get_config: () => null,
      platform_status: () => ({ configured: false, signedIn: false }),
      platform_set_config: () => {
        throw "原生入口地址必须是 http 或 https 地址";
      },
    });
    const host = await mount(invoke);
    const inputs = [...host.querySelectorAll("input")] as HTMLInputElement[];
    for (const [i, v] of ["ftp://x", "https://i", "c"].entries()) await type(inputs[i] as HTMLInputElement, v);
    await click(button(host, "Save and continue"));
    expect(host.querySelector("[role=alert]")?.textContent).toBe(
      translate("en", "native.config.rejected"),
    );
    expect(host.textContent).not.toContain("原生入口地址必须是 http 或 https 地址");
    expect((host.querySelector("input") as HTMLInputElement).value).toBe("ftp://x");
  });

  it("登录可取消：取消不是失败", async () => {
    let reject: (e: unknown) => void = () => {};
    const invoke = fakeInvoke({
      platform_get_config: () => ({}),
      platform_status: () => ({ configured: true, signedIn: false }),
      platform_sign_in: () =>
        new Promise((_, r) => {
          reject = r;
        }),
      platform_cancel_sign_in: () => reject("登录已取消"),
    });
    const host = await mount(invoke);
    await click(button(host, "Sign in"));
    expect(host.textContent).toContain("Waiting for sign-in");
    await click(button(host, "Cancel"));
    expect(invoke).toHaveBeenCalledWith("platform_cancel_sign_in", undefined);
    expect(host.querySelector("[role=alert]")).toBeNull();
    expect(button(host, "Sign in")).toBeTruthy();
  });

  it.each(["resolve", "reject"] as const)("取消后原登录迟到 %s 不登记设备或显示错误", async (outcome) => {
    const pending = deferred<void>();
    const invoke = fakeInvoke({
      platform_get_config: () => ({}),
      platform_status: () => ({ configured: true, signedIn: false }),
      platform_sign_in: () => pending.promise,
      platform_cancel_sign_in: () => {},
    });
    const host = await mount(invoke);
    await click(button(host, "Sign in"));
    await click(button(host, "Cancel"));
    if (outcome === "resolve") pending.resolve();
    else pending.reject("late native failure");
    await settle();
    expect(button(host, "Sign in")).toBeTruthy();
    expect(host.querySelector("[role=alert]")).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("platform_register_device", undefined);
    expect(invoke.mock.calls.some(([command]) => command === "platform_api")).toBe(false);
  });

  it.each(["community", "connect"] as const)("会话已结束时丢弃迟到的 %s 成功", async (phase) => {
    const info = deferred<unknown>();
    const community = deferred<unknown>();
    const connected = deferred<void>();
    const connect = vi.fn((_facts: NativeCommunityFacts, _signal: AbortSignal) => phase === "connect" ? connected.promise : Promise.resolve());
    const invoke = fakeInvoke({
      platform_get_config: () => ({}),
      platform_status: () => ({ configured: true, signedIn: true }),
      platform_register_device: () => ({ status: 200, body: { pubkey: PUBKEY, state: "ACTIVE" } }),
      platform_api: api({
        "GET /api/v1/session": () => ({ status: 200, body: { accessMode: "FULL" } }),
        "GET /api/v1/platform-info": () => info.promise,
        "GET /api/v1/native/community": () => phase === "community"
          ? community.promise
          : { status: 200, body: facts },
      }),
    });
    const host = await mount(invoke, connect);
    info.reject("PLATFORM_NOT_SIGNED_IN");
    await settle();
    expect(button(host, "Sign in")).toBeTruthy();
    if (phase === "connect") expect(connect.mock.calls[0]?.[1].aborted).toBe(true);
    if (phase === "community") community.resolve({ status: 200, body: facts });
    else connected.resolve();
    await settle();
    expect(button(host, "Sign in")).toBeTruthy();
    expect(host.querySelector("[data-testid=app]")).toBeNull();
    if (phase === "community") expect(connect).not.toHaveBeenCalled();
  });

  it("旧会话迟到的失效通知不退出后来登录的新会话", async () => {
    const oldInfo = deferred<unknown>();
    let informationReads = 0;
    const connect = vi.fn(async (_facts: NativeCommunityFacts, _signal: AbortSignal) => {});
    const invoke = fakeInvoke({
      platform_get_config: () => ({}),
      platform_status: () => ({ configured: true, signedIn: true }),
      platform_sign_in: () => {},
      platform_sign_out: () => ({ coreSessionRevoked: true, refreshTokenRevoked: true }),
      platform_register_device: () => ({ status: 200, body: { pubkey: PUBKEY, state: "ACTIVE" } }),
      platform_api: api({
        "GET /api/v1/session": () => ({ status: 200, body: { accessMode: "FULL" } }),
        "GET /api/v1/platform-info": () => ++informationReads === 1
          ? oldInfo.promise
          : { status: 200, body: { displayName: "Platform" } },
        "GET /api/v1/native/community": () => ({ status: 200, body: facts }),
      }),
    });
    const host = await render(
      <NativeBootstrap invoke={invoke} connect={connect} locale="en">
        {(session) => <button onClick={() => void session.signOut()}>End session</button>}
      </NativeBootstrap>,
    );
    await settle();
    await click(button(host, "End session"));
    await click(button(host, "Sign in"));
    expect(button(host, "End session")).toBeTruthy();
    oldInfo.reject("PLATFORM_NOT_SIGNED_IN");
    await settle();
    expect(button(host, "End session")).toBeTruthy();
    expect(connect.mock.calls).toHaveLength(2);
    expect(connect.mock.calls[0]?.[1].aborted).toBe(true);
    expect(connect.mock.calls[1]?.[1].aborted).toBe(false);
  });

  it("登录 → 登记 RECONCILING → 等到 ACTIVE → 取连接事实 → 交给宿主连接", async () => {
    let listed = 0;
    let signedIn = false;
    const connect = vi.fn(async () => {});
    const invoke = fakeInvoke({
      platform_get_config: () => ({}),
      platform_status: () => ({ configured: true, signedIn }),
      platform_sign_in: () => {
        signedIn = true;
      },
      platform_register_device: () => ({
        status: 202,
        body: { pubkey: PUBKEY, state: "RECONCILING", workflowId: "wf", recheckAfterMillis: 5 },
      }),
      platform_api: api({
        "GET /api/v1/session": () => ({ status: 200, body: { accessMode: "FULL" } }),
        "GET /api/v1/identity/client-keys": () => {
          listed += 1;
          return { status: 200, body: [{ pubkey: PUBKEY, state: listed < 2 ? "RECONCILING" : "ACTIVE", createdAt: "2026-09-24T00:00:00Z" }] };
        },
        "GET /api/v1/native/community": () => ({ status: 200, body: facts }),
      }),
    });
    const host = await mount(invoke, connect);
    await click(button(host, "Sign in"));
    expect(host.textContent).toContain("RECONCILING");
    // 重查间隔来自登记回应，不由 Desktop 自己猜。
    await new Promise((r) => setTimeout(r, 50));
    await settle();
    expect(host.querySelector("[data-testid=app]")).not.toBeNull();
    expect(connect).toHaveBeenCalledWith(facts, expect.any(AbortSignal));
    expect(host.textContent).toContain(`connected ${facts.relayUrl} as ${PUBKEY}`);
    expect(listed).toBe(2);
  });

  it("老服务端没有重查间隔时不猜测、不后台敲 BFF，仍可手动确认", async () => {
    let listed = 0;
    const invoke = fakeInvoke({
      platform_get_config: () => ({}),
      platform_status: () => ({ configured: true, signedIn: true }),
      platform_register_device: () => ({
        status: 202,
        body: { pubkey: PUBKEY, state: "RECONCILING", workflowId: "wf" },
      }),
      platform_api: api({
        "GET /api/v1/session": () => ({ status: 200, body: { accessMode: "FULL" } }),
        "GET /api/v1/identity/client-keys": () => {
          listed += 1;
          return {
            status: 200,
            body: [{ pubkey: PUBKEY, state: "ACTIVE", createdAt: "2026-09-24T00:00:00Z" }],
          };
        },
        "GET /api/v1/native/community": () => ({ status: 200, body: facts }),
      }),
    });
    const host = await mount(invoke);
    await new Promise((r) => setTimeout(r, 20));
    await settle();
    expect(listed).toBe(0);
    await click(button(host, "Check again"));
    expect(host.querySelector("[data-testid=app]")).not.toBeNull();
  });

  it("还不是成员（兑换了邀请、等待确认）：指向浏览器里的邀请链接并显示本人的兑换进度", async () => {
    let active = false;
    const invoke = fakeInvoke({
      platform_get_config: () => ({}),
      platform_status: () => ({ configured: true, signedIn: true }),
      platform_register_device: () =>
        active
          ? { status: 200, body: { pubkey: PUBKEY, state: "ACTIVE" } }
          : { status: 403, body: { class: ErrorClass.Denied, reason: ReasonCode.TenantMembershipNotActive } },
      platform_api: api({
        "GET /api/v1/session": () => active
          ? { status: 200, body: { accessMode: "FULL" } }
          : { status: 403, body: { class: ErrorClass.Denied, reason: ReasonCode.TenantMembershipNotActive } },
        "GET /api/v1/invitations/redemptions": () => ({
          status: 200,
          body: [
            {
              invitationId: "inv-1",
              tenantId: "t1",
              tenantName: "Acme",
              membershipState: active ? "ACTIVE" : "INVITED",
              admissionGateState: active ? "ALLOWED" : "WAITING",
              redeemedAt: "2026-09-25T00:00:00Z",
            },
          ],
        }),
        "GET /api/v1/native/community": () => ({ status: 200, body: facts }),
      }),
    });
    const host = await mount(invoke);
    expect(host.textContent).toContain("open your invitation link in the browser");
    expect(host.textContent).toContain("Waiting for an admin of Acme to confirm it is you.");
    expect(host.querySelector("[role=alert]")).toBeNull();
    active = true;
    await click(button(host, "Check again"));
    expect(host.querySelector("[data-testid=app]")).not.toBeNull();
  });

  it("登记没有得到回应：显示结果不明，重新确认是再登记一次", async () => {
    let attempts = 0;
    const invoke = fakeInvoke({
      platform_get_config: () => ({}),
      platform_status: () => ({ configured: true, signedIn: true }),
      platform_register_device: () => {
        attempts += 1;
        if (attempts === 1) throw "平台服务不可达：timed out";
        return { status: 200, body: { pubkey: PUBKEY, state: "ACTIVE" } };
      },
      platform_api: api({
        "GET /api/v1/session": () => ({ status: 200, body: { accessMode: "FULL" } }),
        "GET /api/v1/native/community": () => ({ status: 200, body: facts }),
      }),
    });
    const host = await mount(invoke);
    expect(host.textContent).toContain("result is unknown");
    expect(host.querySelector("[role=alert]")).toBeNull();
    expect(host.querySelector("[data-testid=app]")).toBeNull();
    await click(button(host, "Check again"));
    expect(host.querySelector("[data-testid=app]")).not.toBeNull();
  });

  it("BFF 明说 UNKNOWN 同样是结果不明，并给出 operationId", async () => {
    const invoke = fakeInvoke({
      platform_get_config: () => ({}),
      platform_status: () => ({ configured: true, signedIn: true }),
      platform_register_device: () => ({
        status: 503,
        body: { class: ErrorClass.Unknown, reason: ReasonCode.DependencyUnavailable, operationId: "op-9" },
      }),
      platform_api: api({ "GET /api/v1/session": () => ({ status: 200, body: { accessMode: "FULL" } }) }),
    });
    const host = await mount(invoke);
    expect(host.textContent).toContain("result is unknown (op-9)");
  });

  it("已撤销的本机公钥不复活：显示撤销，不进入应用", async () => {
    const invoke = fakeInvoke({
      platform_get_config: () => ({}),
      platform_status: () => ({ configured: true, signedIn: true }),
      platform_register_device: () => ({
        status: 409,
        body: { class: ErrorClass.Conflict, reason: ReasonCode.ClientKeyAlreadyBound },
      }),
      platform_api: api({ "GET /api/v1/session": () => ({ status: 200, body: { accessMode: "FULL" } }) }),
    });
    const host = await mount(invoke);
    expect(host.querySelector("[role=alert]")?.textContent).toContain("revoked");
    expect(host.querySelector("[data-testid=app]")).toBeNull();
  });

  it("会话在途中结束（刷新令牌被拒）回到登录", async () => {
    const invoke = fakeInvoke({
      platform_get_config: () => ({}),
      platform_status: () => ({ configured: true, signedIn: true }),
      platform_register_device: () => {
        throw "PLATFORM_NOT_SIGNED_IN";
      },
      platform_api: api({ "GET /api/v1/session": () => ({ status: 200, body: { accessMode: "FULL" } }) }),
    });
    const host = await mount(invoke);
    expect(button(host, "Sign in")).toBeTruthy();
  });

  it("连接事实取不到或连接失败：不进入应用，可重试", async () => {
    let connectFails = true;
    const invoke = fakeInvoke({
      platform_get_config: () => ({}),
      platform_status: () => ({ configured: true, signedIn: true }),
      platform_register_device: () => ({ status: 200, body: { pubkey: PUBKEY, state: "ACTIVE" } }),
      platform_api: api({
        "GET /api/v1/session": () => ({ status: 200, body: { accessMode: "FULL" } }),
        "GET /api/v1/native/community": () => ({ status: 200, body: facts }),
      }),
    });
    const connect = vi.fn(async () => {
      if (connectFails) throw new Error("invalid relay");
    });
    const host = await mount(invoke, connect);
    expect(host.querySelector("[role=alert]")?.textContent).toBe(
      translate("en", "native.connect.failed"),
    );
    expect(host.textContent).not.toContain("invalid relay");
    connectFails = false;
    await click(button(host, "Try again"));
    expect(host.querySelector("[data-testid=app]")).not.toBeNull();
  });

  it("显示名（DD-111）：登录前只有中性文案；登录后取自 BFF、按服务器缓存，换服务器不串名", async () => {
    window.localStorage.clear();
    const server = { nativeApiUrl: "https://a.example:8091", oidcIssuer: "https://i", oidcClientId: "c" };
    let config: NativeConfig = server;
    let signedIn = true;
    const invoke = fakeInvoke({
      platform_get_config: () => config,
      platform_status: () => ({ configured: true, signedIn }),
      platform_register_device: () => ({ status: 200, body: { pubkey: PUBKEY, state: "ACTIVE" } }),
      platform_api: api({
        "GET /api/v1/session": () => ({ status: 200, body: { accessMode: "FULL" } }),
        "GET /api/v1/native/community": () => ({ status: 200, body: facts }),
        "GET /api/v1/platform-info": () => ({ status: 200, body: { displayName: "  协作平台  " } }),
      }),
      platform_sign_out: () => {
        signedIn = false;
      },
      platform_set_config: (args) => {
        config = args?.config as NativeConfig;
      },
    });
    const seen: (string | null)[] = [];
    const host = await render(
      <NativeBootstrap invoke={invoke} connect={async () => {}} locale="en">
        {(s) => {
          seen.push(s.displayName);
          return (
            <button type="button" onClick={() => void s.signOut()}>
              out
            </button>
          );
        }}
      </NativeBootstrap>,
    );
    await settle();
    expect(seen.at(-1)).toBe("协作平台");
    expect(window.localStorage.getItem("platform.display-name:https://a.example:8091")).toBe("协作平台");
    await click(button(host, "out"));
    // 重新启动（新的引导实例、未登录）：同一服务器的登录页显示缓存值
    const again = await mount(invoke);
    expect(again.querySelector("h1")?.textContent).toBe("Sign in to 协作平台");
    // 换一台没有缓存的服务器：回到中性文案
    await click(button(again, "Change connection settings"));
    const inputs = [...again.querySelectorAll("input")] as HTMLInputElement[];
    await type(inputs[0] as HTMLInputElement, "https://b.example:8091");
    await click(button(again, "Save and continue"));
    expect(again.querySelector("h1")?.textContent).toBe("Sign in");
  });

  // 服务器侧结果：两项都确认才不提示；任一未确认或返回值畸形一律提示（fail closed）
  it.each([
    ["两项都确认", { coreSessionRevoked: true, refreshTokenRevoked: true }, false],
    ["Core 未确认", { coreSessionRevoked: false, refreshTokenRevoked: true }, true],
    ["IdP 未确认", { coreSessionRevoked: true, refreshTokenRevoked: false }, true],
    ["返回 null", null, true],
    ["返回非对象", "ok", true],
    ["字段不是布尔值", { coreSessionRevoked: "true", refreshTokenRevoked: 1 }, true],
    ["缺字段", { coreSessionRevoked: true }, true],
  ])("注销经 platform_sign_out 回到登录：%s", async (_, report, unconfirmed) => {
    const invoke = fakeInvoke({
      platform_get_config: () => ({}),
      platform_status: () => ({ configured: true, signedIn: true }),
      platform_register_device: () => ({ status: 200, body: { pubkey: PUBKEY, state: "ACTIVE" } }),
      platform_api: api({
        "GET /api/v1/session": () => ({ status: 200, body: { accessMode: "FULL" } }),
        "GET /api/v1/native/community": () => ({ status: 200, body: facts }),
      }),
      platform_sign_out: () => report,
    });
    const host = await render(
      <NativeBootstrap invoke={invoke} connect={async () => {}} locale="en">
        {(s) => (
          <button type="button" onClick={() => void s.signOut()}>
            out
          </button>
        )}
      </NativeBootstrap>,
    );
    await settle();
    await click(button(host, "out"));
    expect(invoke).toHaveBeenCalledWith("platform_sign_out", undefined);
    expect(button(host, "Sign in")).toBeTruthy();
    const notice = host.querySelector("[data-testid=native-signout-unconfirmed]");
    expect(notice?.textContent ?? null).toBe(
      unconfirmed
        ? "Signed out on this device. The server did not confirm that your sign-in was ended; it will expire on its own."
        : null,
    );
  });
});
