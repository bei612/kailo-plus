// 两个传输实现：Web 同源 fetch、Desktop 经 platform_api。两者对同一次调用必须给出同一
// 解读（错误体、会话结束、没有回应），差别只在请求怎么送出去。

import { ErrorClass, ReasonCode, WebMessageType } from "@client-kit/contracts";
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

it("message authors use the typed batch transport for workspace, DM and a singleton caller", async () => {
  const eventId="a".repeat(64), secondId="c".repeat(64);
  const profile={pubkey:"b".repeat(64),avatarMediaPaths:{}};
  const send=vi.fn(async(request:{body?:unknown})=>({status:200,body:{profiles:Object.fromEntries((request.body as {eventIds:string[]}).eventIds.map(id=>[id,profile]))}}));
  const client=createBffClient({send});
  await client.messageAuthorProfiles("workspace",{eventIds:[eventId,secondId]});
  await client.conversationMessageAuthorProfiles("private",{eventIds:[eventId]});
  expect(await client.messageAuthorProfile("workspace",eventId)).toEqual(profile);
  expect(send.mock.calls.map(([request])=>request)).toEqual([
    {method:"POST",path:"/api/v1/workspaces/workspace/messages/author-profiles",body:{eventIds:[eventId,secondId]}},
    {method:"POST",path:"/api/v1/conversations/private/messages/author-profiles",body:{eventIds:[eventId]}},
    {method:"POST",path:"/api/v1/workspaces/workspace/messages/author-profiles",body:{eventIds:[eventId]}},
  ]);
  send.mockResolvedValue({status:200,body:{profiles:{}}});
  await expect(client.messageAuthorProfile("workspace",eventId)).rejects.toThrow();
});

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

  it("同一会话并发的相同 GET 共用一次读取，每个调用方拿到自己的副本；写入后重新读取", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetch = vi.fn<typeof globalThis.fetch>(async (path) => {
      await gate;
      return json(200, path === "/api/v1/user-state" ? { version: 1, readContexts: {} } : { revoked: true });
    });
    const client = createBffClient(createFetchTransport({ fetch, onSessionEnded: () => {} }));
    const reads = [client.collaborationUserState(), client.collaborationUserState(), client.collaborationUserState()];
    release();
    const [first, second] = await Promise.all(reads);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    await client.logout();
    await client.collaborationUserState();
    expect(fetch.mock.calls.map(([path]) => path)).toEqual(["/api/v1/user-state", "/api/v1/logout", "/api/v1/user-state"]);
  });

  it("资料读取按原版窗口同会话缓存：自己 30 秒、同一 pubkey 60 秒；资料写入或治理动作后重新读取", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => json(200, { pubkey: "b".repeat(64), avatarMediaPaths: {} }));
      const client = createBffClient(createFetchTransport({ fetch, onSessionEnded: () => {} }));
      const own = await client.profile();
      (own as { displayName?: string }).displayName = "caller mutation";
      await client.profile();
      await client.memberProfile("w", "p", "b".repeat(64));
      await client.memberProfile("w", "p", "b".repeat(64));
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(await client.profile()).not.toHaveProperty("displayName");
      vi.setSystemTime(Date.now() + 30_000);
      await client.profile();
      await client.memberProfile("w", "p", "b".repeat(64));
      expect(fetch).toHaveBeenCalledTimes(3);
      await client.updateProfile({ displayName: "new" } as Parameters<typeof client.updateProfile>[0]);
      await client.profile();
      await client.memberProfile("w", "p", "b".repeat(64));
      expect(fetch).toHaveBeenCalledTimes(6);
    } finally { vi.useRealTimers(); }
  });

  it("冷启动读次数上限：挂载时的重复读合并，所有频道窗口一次批量读取", async () => {
    // The live cold start (2026-10-15, 14 joined channels) issued profile x5, user-state x5,
    // custom-emoji x2 and two Relay reads per channel. The same burst must stay under the cap.
    const COLD_START_READ_CAP = 4;
    const fetch = vi.fn<typeof globalThis.fetch>(async (path, init) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (path === "/api/v1/workspace-activity") {
        const { items } = JSON.parse(String(init?.body)) as { items: { workspaceId: string }[] };
        return json(200, { items: items.map(({ workspaceId }) => ({ workspaceId, channelId: `c-${workspaceId}`, events: [] })) });
      }
      return json(200, path === "/api/v1/user-state" ? { version: 1, readContexts: {} } : { pubkey: "b".repeat(64), avatarMediaPaths: {} });
    });
    const client = createBffClient(createFetchTransport({ fetch, onSessionEnded: () => {} }));
    const channels = Array.from({ length: 14 }, (_, index) => ({ workspaceId: `w${index}`, messageType: WebMessageType.Stream }));
    await Promise.all([
      ...Array.from({ length: 5 }, () => client.profile()),
      ...Array.from({ length: 5 }, () => client.collaborationUserState()),
      ...Array.from({ length: 2 }, () => client.customEmoji()),
      client.workspaceActivity({ items: channels }),
    ]);
    await client.profile();
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(COLD_START_READ_CAP);
    expect(fetch.mock.calls.filter(([path]) => path === "/api/v1/workspace-activity")).toHaveLength(1);
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
  it("每个请求都经 platform_api 交给 Rust 侧，前端不直连 BFF", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const invoke = vi.fn(async () => ({ status: 202, body: { pubkey: "ab", state: "REVOKING" } }));
    const client = createBffClient(createInvokeTransport(invoke, { onSessionEnded: () => {} }));
    await expect(client.revokeClientKey("ab")).resolves.toEqual({ pubkey: "ab", state: "REVOKING" });
    await client.nativeCommunity();
    expect(invoke).toHaveBeenNthCalledWith(1, "platform_api", {
      method: "DELETE",
      path: "/api/v1/identity/client-keys/ab",
      body: null,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "platform_api", {
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

  it("PLATFORM_NOT_SIGNED_IN 是会话结束；其余命令失败是没有回应", async () => {
    const onSessionEnded = vi.fn();
    const signedOut = createBffClient(
      createInvokeTransport(
        async () => {
          throw "PLATFORM_NOT_SIGNED_IN";
        },
        { onSessionEnded },
      ),
    );
    await expect(signedOut.session()).rejects.toBeInstanceOf(SessionEndedError);
    expect(onSessionEnded).toHaveBeenCalledOnce();

    const unreachable = createBffClient(
      createInvokeTransport(
        async () => {
          throw "平台服务不可达：connection refused";
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
      command === "platform_register_device" ? { status: 202, body: null } : null,
    );
    const host = createNativeHost(invoke, { onSessionEnded: () => {} });
    const config = { nativeApiUrl: "https://k.example", oidcIssuer: "https://i.example", oidcClientId: "c" };
    await host.setConfig(config);
    await expect(host.registerDevice()).resolves.toEqual({ status: 202, body: undefined });
    await host.cancelSignIn();
    await host.authenticateNativePage("binding-fixture");
    expect(invoke.mock.calls).toEqual([
      ["platform_set_config", { config }],
      ["platform_register_device", undefined],
      ["platform_cancel_sign_in", undefined],
      ["platform_authenticate_native_page", { bindingId: "binding-fixture" }],
    ]);
  });
});
