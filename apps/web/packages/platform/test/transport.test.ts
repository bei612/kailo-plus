// 两个传输实现：Web 同源 fetch、Desktop 经 kailo_api。两者对同一次调用必须给出同一
// 解读（错误体、会话结束、没有回应），差别只在请求怎么送出去。

import { ErrorClass, ReasonCode } from "@kailo/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { createInvokeTransport, createNativeHost } from "../src/native";
import {
  BffError,
  isOutcomeUnknown,
  SessionEndedError,
  TransportError,
} from "../src/transport";
import { createFetchTransport } from "../src/web-fetch";

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("web-fetch", () => {
  it("同源、带 cookie、不跟随重定向；有正文才带 JSON 头", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(200, { revoked: true }));
    const client = createBffClient(createFetchTransport({ fetch, onSessionEnded: () => {} }));
    await client.logout();
    await client.workspaces();
    expect(fetch).toHaveBeenNthCalledWith(1, "/api/v1/logout", {
      method: "POST",
      credentials: "same-origin",
      redirect: "manual",
    });
    expect(fetch.mock.calls[1]?.[0]).toBe("/api/v1/workspaces");
  });

  it("401 与 opaqueredirect 都是会话结束：先通知宿主再抛出", async () => {
    for (const response of [
      json(401, undefined),
      Object.defineProperty(new Response(null, { status: 200 }), "type", {
        value: "opaqueredirect",
      }),
    ]) {
      const onSessionEnded = vi.fn();
      const client = createBffClient(
        createFetchTransport({ fetch: async () => response, onSessionEnded }),
      );
      await expect(client.session()).rejects.toBeInstanceOf(SessionEndedError);
      expect(onSessionEnded).toHaveBeenCalledOnce();
    }
  });

  it("错误体原样进入 BffError；没有错误体时不猜分类", async () => {
    const body = { class: ErrorClass.Unknown, reason: ReasonCode.DependencyUnavailable, operationId: "op-1" };
    const client = createBffClient(
      createFetchTransport({ fetch: async () => json(503, body), onSessionEnded: () => {} }),
    );
    const e = await client.revokeClientKey("ab").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(BffError);
    expect(e).toMatchObject({ status: 503, errorClass: "UNKNOWN", operationId: "op-1" });
    expect(isOutcomeUnknown(e)).toBe(true);

    const bare = createBffClient(
      createFetchTransport({
        fetch: async () => new Response("<html>", { status: 502 }),
        onSessionEnded: () => {},
      }),
    );
    const f = await bare.revokeClientKey("ab").catch((x: unknown) => x);
    expect(f).toMatchObject({ status: 502, errorClass: undefined });
    expect(isOutcomeUnknown(f)).toBe(false);
  });

  it("没有回应即结果不明", async () => {
    const client = createBffClient(
      createFetchTransport({
        fetch: async () => {
          throw new TypeError("network");
        },
        onSessionEnded: () => {},
      }),
    );
    const e = await client.revokeClientKey("ab").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TransportError);
    expect(isOutcomeUnknown(e)).toBe(true);
  });
});

describe("desktop-invoke", () => {
  it("每个请求都经 kailo_api 交给 Rust 侧，前端不直连 BFF", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const invoke = vi.fn(async () => ({ status: 202, body: { pubkey: "ab", state: "REVOKING" } }));
    const client = createBffClient(createInvokeTransport(invoke, { onSessionEnded: () => {} }));
    await expect(client.revokeClientKey("ab")).resolves.toEqual({ pubkey: "ab", state: "REVOKING" });
    await client.nativeCommunity();
    expect(invoke).toHaveBeenNthCalledWith(1, "kailo_api", {
      method: "DELETE",
      path: "/api/v1/identity/client-keys/ab",
      body: null,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "kailo_api", {
      method: "GET",
      path: "/api/v1/native/community",
      body: null,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("Rust 侧回应里的错误体与 Web 同样解读", async () => {
    const invoke = async () => ({
      status: 409,
      body: { class: ErrorClass.Conflict, reason: ReasonCode.ClientKeyAlreadyBound },
    });
    const client = createBffClient(createInvokeTransport(invoke, { onSessionEnded: () => {} }));
    const e = await client.revokeClientKey("ab").catch((x: unknown) => x);
    expect(e).toMatchObject({ status: 409, reason: "CLIENT_KEY_ALREADY_BOUND" });
    expect(isOutcomeUnknown(e)).toBe(false);
  });

  it("KAILO_NOT_SIGNED_IN 是会话结束；其余命令失败是没有回应", async () => {
    const onSessionEnded = vi.fn();
    const signedOut = createBffClient(
      createInvokeTransport(
        async () => {
          throw "KAILO_NOT_SIGNED_IN";
        },
        { onSessionEnded },
      ),
    );
    await expect(signedOut.session()).rejects.toBeInstanceOf(SessionEndedError);
    expect(onSessionEnded).toHaveBeenCalledOnce();

    const unreachable = createBffClient(
      createInvokeTransport(
        async () => {
          throw "Kailo 服务不可达：connection refused";
        },
        { onSessionEnded },
      ),
    );
    const e = await unreachable.revokeClientKey("ab").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TransportError);
    expect(isOutcomeUnknown(e)).toBe(true);
    expect(onSessionEnded).toHaveBeenCalledOnce();
  });

  it("原生命令名与参数只在这里写一次", async () => {
    const invoke = vi.fn(async (command: string) =>
      command === "kailo_register_device" ? { status: 202, body: null } : null,
    );
    const host = createNativeHost(invoke, { onSessionEnded: () => {} });
    const config = { nativeApiUrl: "https://k.example", oidcIssuer: "https://i.example", oidcClientId: "c" };
    await host.setConfig(config);
    await expect(host.registerDevice()).resolves.toEqual({ status: 202, body: undefined });
    await host.cancelSignIn();
    expect(invoke.mock.calls).toEqual([
      ["kailo_set_config", { config }],
      ["kailo_register_device", undefined],
      ["kailo_cancel_sign_in", undefined],
    ]);
  });
});
