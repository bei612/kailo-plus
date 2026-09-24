import { ErrorClass, ReasonCode } from "@kailo/contracts";
import { describe, expect, it, vi } from "vitest";
import type { Invoke, NativeConfig } from "../src/native";
import { NativeBootstrap } from "../src/react/NativeBootstrap";
import { button, click, render, settle, type } from "./render";

const facts = { communityHost: "c.example:8443", relayUrl: "wss://c.example:8443" };
const PUBKEY = "a".repeat(64);

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

async function mount(invoke: Invoke, connect = vi.fn(async () => {})) {
  const host = await render(
    <NativeBootstrap invoke={invoke} connect={connect} locale="en" recheckEveryMs={10}>
      {(s) => <div data-testid="app">connected {s.facts.relayUrl} as {s.devicePubkey}</div>}
    </NativeBootstrap>,
  );
  await settle();
  return host;
}

describe("NativeBootstrap", () => {
  it("未配置：空表单，不预填任何地址；保存后进入登录", async () => {
    let saved: NativeConfig | null = null;
    const invoke = fakeInvoke({
      kailo_get_config: () => saved,
      kailo_status: () => ({ configured: saved !== null, signedIn: false }),
      kailo_set_config: (args) => {
        saved = args?.config as NativeConfig;
      },
    });
    const host = await mount(invoke);
    const inputs = [...host.querySelectorAll("input")];
    expect(inputs.map((i) => i.value)).toEqual(["", "", ""]);
    await type(inputs[0] as HTMLInputElement, "https://kailo.example:8091");
    await type(inputs[1] as HTMLInputElement, "https://idp.example/realms/k");
    await type(inputs[2] as HTMLInputElement, "kailo-native");
    await click(button(host, "Save and continue"));
    expect(saved).toEqual({
      nativeApiUrl: "https://kailo.example:8091",
      oidcIssuer: "https://idp.example/realms/k",
      oidcClientId: "kailo-native",
    });
    expect(button(host, "Sign in")).toBeTruthy();
  });

  it("配置被 Rust 侧拒绝时如实显示原因并保留输入", async () => {
    const invoke = fakeInvoke({
      kailo_get_config: () => null,
      kailo_status: () => ({ configured: false, signedIn: false }),
      kailo_set_config: () => {
        throw "原生入口地址必须是 http 或 https 地址";
      },
    });
    const host = await mount(invoke);
    const inputs = [...host.querySelectorAll("input")] as HTMLInputElement[];
    for (const [i, v] of ["ftp://x", "https://i", "c"].entries()) await type(inputs[i] as HTMLInputElement, v);
    await click(button(host, "Save and continue"));
    expect(host.querySelector("[role=alert]")?.textContent).toContain("http 或 https");
    expect((host.querySelector("input") as HTMLInputElement).value).toBe("ftp://x");
  });

  it("登录可取消：取消不是失败", async () => {
    let reject: (e: unknown) => void = () => {};
    const invoke = fakeInvoke({
      kailo_get_config: () => ({}),
      kailo_status: () => ({ configured: true, signedIn: false }),
      kailo_sign_in: () =>
        new Promise((_, r) => {
          reject = r;
        }),
      kailo_cancel_sign_in: () => reject("登录已取消"),
    });
    const host = await mount(invoke);
    await click(button(host, "Sign in"));
    expect(host.textContent).toContain("Waiting for sign-in");
    await click(button(host, "Cancel"));
    expect(invoke).toHaveBeenCalledWith("kailo_cancel_sign_in", undefined);
    expect(host.querySelector("[role=alert]")).toBeNull();
    expect(button(host, "Sign in")).toBeTruthy();
  });

  it("登录 → 登记 RECONCILING → 等到 ACTIVE → 取连接事实 → 交给宿主连接", async () => {
    let listed = 0;
    let signedIn = false;
    const connect = vi.fn(async () => {});
    const invoke = fakeInvoke({
      kailo_get_config: () => ({}),
      kailo_status: () => ({ configured: true, signedIn }),
      kailo_sign_in: () => {
        signedIn = true;
      },
      kailo_register_device: () => ({ status: 202, body: { pubkey: PUBKEY, state: "RECONCILING", workflowId: "wf" } }),
      kailo_api: api({
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
    await vi.waitFor(() => expect(host.querySelector("[data-testid=app]")).not.toBeNull());
    expect(connect).toHaveBeenCalledWith(facts);
    expect(host.textContent).toContain(`connected ${facts.relayUrl} as ${PUBKEY}`);
    expect(listed).toBe(2);
  });

  it("登记没有得到回应：显示结果不明，重新确认是再登记一次", async () => {
    let attempts = 0;
    const invoke = fakeInvoke({
      kailo_get_config: () => ({}),
      kailo_status: () => ({ configured: true, signedIn: true }),
      kailo_register_device: () => {
        attempts += 1;
        if (attempts === 1) throw "Kailo 服务不可达：timed out";
        return { status: 200, body: { pubkey: PUBKEY, state: "ACTIVE" } };
      },
      kailo_api: api({ "GET /api/v1/native/community": () => ({ status: 200, body: facts }) }),
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
      kailo_get_config: () => ({}),
      kailo_status: () => ({ configured: true, signedIn: true }),
      kailo_register_device: () => ({
        status: 503,
        body: { class: ErrorClass.Unknown, reason: ReasonCode.DependencyUnavailable, operationId: "op-9" },
      }),
    });
    const host = await mount(invoke);
    expect(host.textContent).toContain("result is unknown (op-9)");
  });

  it("已撤销的本机公钥不复活：显示撤销，不进入应用", async () => {
    const invoke = fakeInvoke({
      kailo_get_config: () => ({}),
      kailo_status: () => ({ configured: true, signedIn: true }),
      kailo_register_device: () => ({
        status: 409,
        body: { class: ErrorClass.Conflict, reason: ReasonCode.ClientKeyAlreadyBound },
      }),
    });
    const host = await mount(invoke);
    expect(host.querySelector("[role=alert]")?.textContent).toContain("revoked");
    expect(host.querySelector("[data-testid=app]")).toBeNull();
  });

  it("会话在途中结束（刷新令牌被拒）回到登录", async () => {
    const invoke = fakeInvoke({
      kailo_get_config: () => ({}),
      kailo_status: () => ({ configured: true, signedIn: true }),
      kailo_register_device: () => {
        throw "KAILO_NOT_SIGNED_IN";
      },
    });
    const host = await mount(invoke);
    expect(button(host, "Sign in")).toBeTruthy();
  });

  it("连接事实取不到或连接失败：不进入应用，可重试", async () => {
    let connectFails = true;
    const invoke = fakeInvoke({
      kailo_get_config: () => ({}),
      kailo_status: () => ({ configured: true, signedIn: true }),
      kailo_register_device: () => ({ status: 200, body: { pubkey: PUBKEY, state: "ACTIVE" } }),
      kailo_api: api({ "GET /api/v1/native/community": () => ({ status: 200, body: facts }) }),
    });
    const connect = vi.fn(async () => {
      if (connectFails) throw new Error("invalid relay");
    });
    const host = await mount(invoke, connect);
    expect(host.querySelector("[role=alert]")?.textContent).toContain("invalid relay");
    connectFails = false;
    await click(button(host, "Try again"));
    expect(host.querySelector("[data-testid=app]")).not.toBeNull();
  });

  it("注销经 kailo_sign_out，然后回到登录", async () => {
    const invoke = fakeInvoke({
      kailo_get_config: () => ({}),
      kailo_status: () => ({ configured: true, signedIn: true }),
      kailo_register_device: () => ({ status: 200, body: { pubkey: PUBKEY, state: "ACTIVE" } }),
      kailo_api: api({ "GET /api/v1/native/community": () => ({ status: 200, body: facts }) }),
      kailo_sign_out: () => null,
    });
    const host = await render(
      <NativeBootstrap invoke={invoke} connect={async () => {}} locale="en" recheckEveryMs={10}>
        {(s) => (
          <button type="button" onClick={() => void s.signOut()}>
            out
          </button>
        )}
      </NativeBootstrap>,
    );
    await settle();
    await click(button(host, "out"));
    expect(invoke).toHaveBeenCalledWith("kailo_sign_out", undefined);
    expect(button(host, "Sign in")).toBeTruthy();
  });
});
