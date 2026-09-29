// 平台 BFF 传输（DD-39、SS-WEB-RELAY）。
//
// Browser 只发类型化的语义命令。它不接收 Relay URL、不接收 Nostr 私钥，
// 不生成 NIP-42/NIP-98/NIP-44，也不提交 raw signed event 或任意 Relay filter。
// 身份由 AgentGateway 验证后投影给 BFF，浏览器这一侧没有任何可自报的身份字段。
//
// 与 Desktop 共用的部分——传输接缝、错误解读、会话/成员/审计/设备端点——在平台
// 的共用包里（@client-kit/platform，构建时放入源树，ADR-09），这里只接上 Web 的同源
// fetch 传输，并补上只有 Web 才有的调用：频道流、经 BFF 代签的发布与媒体、已读与
// Workspace 偏好、网关退出。

import type {
  ReadMarkRequest,
  UserStateVersion,
  WorkspacePreferenceRequest,
} from "@client-kit/contracts";
import { createBffClient } from "@client-kit/platform/client";
import { type BffRequest, unwrap } from "@client-kit/platform/transport";
import { createFetchTransport } from "@client-kit/platform/web-fetch";

export { BffError } from "@client-kit/platform/transport";

/**
 * 网关会话已不在：浏览器只能经一次顶层导航重新登录，由网关带去 IdP。
 */
const transport = createFetchTransport({
  onSessionEnded: () => window.location.assign(window.location.href),
});

export const bff = createBffClient(transport);

async function call<T>(request: BffRequest): Promise<T> {
  return unwrap<T>(request, await transport.send(request));
}

export type BuzzEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
};

export type UserState = {
  /** `updatedAt` 由 Core 用库时钟写入。 */
  workspacePreferences: Record<string, { starred: boolean; muted: boolean; updatedAt?: string }>;
  /** context key（Channel ID 等）→ 已读到的时刻，RFC 3339 UTC。三端读写同一个值。 */
  readContexts: Record<string, string>;
  version: number;
};

/** 一份已上传的媒体（Blossom descriptor）。发消息时原样带回，由 Core 生成 imeta。 */
export type MediaDescriptor = { url: string; sha256: string; size: number; type: string };

/**
 * 退出。顺序固定：先让 Core 撤销会话并关闭流，再让网关清 cookie。网关的 logout
 * 是短路的，请求到不了后端（SF-AGW-21），反过来做 Core 就再也无从得知。
 *
 * Core 那一步失败也继续清网关：留着网关会话等于退出没有发生。
 *
 * 网关那一步用 fetch 而不是表单提交：表单提交之后的整条重定向链都受页面 CSP
 * 的 form-action 约束，而这条链最终会落到 IdP 的来源上。清完 cookie 再做一次
 * 普通的顶层导航，由网关带去重新登录。
 */
export async function signOut(): Promise<void> {
  await bff.logout().catch(() => undefined);
  await fetch("/logout", { method: "POST", credentials: "same-origin", redirect: "manual" });
  window.location.assign(import.meta.env.BASE_URL);
}

/**
 * 发布一条消息。只给正文——身份、签名、频道归属都由 BFF 决定。`idempotencyKey`
 * 标识「这一次发送意图」：结果不明之后重发必须带同一个键，BFF 据此回答原操作的
 * 结论而不是再发一条（DD-81）。
 */
export async function publishMessage(
  workspaceId: string,
  content: string,
  attachments: readonly MediaDescriptor[],
  idempotencyKey: string,
): Promise<{ eventId: string; operationId: string }> {
  const path = `/api/v1/workspaces/${workspaceId}/messages`;
  return unwrap(
    { method: "POST", path },
    await transport.exchange(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ content, attachments }),
    }),
  );
}

export function fetchUserState(): Promise<UserState> {
  return call<UserState>({ method: "GET", path: "/api/v1/user-state" });
}

export function setWorkspacePreference(
  workspaceId: string,
  preference: WorkspacePreferenceRequest,
): Promise<UserStateVersion> {
  return call({
    method: "PUT",
    path: `/api/v1/user-state/workspaces/${workspaceId}`,
    body: preference,
  });
}

export function markRead(mark: ReadMarkRequest): Promise<UserStateVersion> {
  return call({ method: "PUT", path: "/api/v1/user-state/read", body: mark });
}

/** 上传一份媒体。签名由 BFF 以本人身份代做，Browser 不接触 Relay。 */
export async function uploadMedia(workspaceId: string, file: File): Promise<MediaDescriptor> {
  const path = `/api/v1/workspaces/${workspaceId}/media`;
  return unwrap(
    { method: "POST", path },
    await transport.exchange(path, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    }),
  );
}

/** 取一份媒体的可渲染地址。它仍然经 BFF，不指向 Relay。 */
export function mediaUrl(workspaceId: string, sha256: string): string {
  return `/api/v1/workspaces/${workspaceId}/media/${sha256}`;
}

/**
 * 一条流上的帧。
 *
 * `interrupted` 与 `ended` 来自连接本身而不是服务端的事件：前者是浏览器正在
 * 按服务端给的间隔重连，后者是再也连不上了（例如重连时已被拒绝）。两者都不是
 * 「已同步」——状态只在收到 `live` 时才显示为同步。
 */
export type StreamFrame =
  | { type: "snapshot"; events: BuzzEvent[] }
  | { type: "event"; event: BuzzEvent }
  | { type: "live" }
  | { type: "closed"; reason: string }
  | { type: "interrupted" }
  | { type: "ended" };

/**
 * 打开一条 Workspace 事件流。
 *
 * 续流用 SSE 自带的协议：服务端把 generation 作为事件 id、把重连间隔作为
 * retry 下发，EventSource 断线后按该间隔自动重连，并把 id 放进 Last-Event-ID
 * 带回。对不上时服务端重发 snapshot，而不是从某个猜测的位置接着读。
 *
 * EventSource 只在网络错误时自动重连：重连请求得到 HTTP 错误（BFF 重启期间
 * 网关回 503）时它永久关闭。此时按服务端 `retry` 帧给出的同一间隔重新打开，
 * 重开即重取 snapshot。从未收到过间隔（第一次连接就失败）时不自定时长，
 * 如实显示已断开。
 *
 * 唯一需要主动停下的是 `session-revoked`：那是确定的撤销，再连只会被拒。
 * 其余关闭原因（包括 `readmission-unavailable`）都是结果不明，交给重连。
 */
export function openStream(workspaceId: string, onFrame: (frame: StreamFrame) => void): () => void {
  let source: EventSource | undefined;
  let retryMillis: number | undefined;
  let reopen: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const open = () => {
    const es = new EventSource(`/api/v1/workspaces/${workspaceId}/stream`);
    source = es;
    es.addEventListener("retry", (e) => {
      const ms = Number((e as MessageEvent<string>).data);
      if (Number.isFinite(ms) && ms > 0) retryMillis = ms;
    });
    es.addEventListener("snapshot", (e) =>
      onFrame({
        type: "snapshot",
        events: JSON.parse((e as MessageEvent<string>).data) as BuzzEvent[],
      }),
    );
    es.addEventListener("event", (e) =>
      onFrame({
        type: "event",
        event: JSON.parse((e as MessageEvent<string>).data) as BuzzEvent,
      }),
    );
    es.addEventListener("live", () => onFrame({ type: "live" }));
    es.addEventListener("closed", (e) => {
      const reason = (e as MessageEvent<string>).data;
      onFrame({ type: "closed", reason });
      if (reason === "session-revoked") {
        stopped = true;
        es.close();
      }
    });
    es.addEventListener("error", () => {
      if (es.readyState !== EventSource.CLOSED) {
        onFrame({ type: "interrupted" });
        return;
      }
      if (stopped || retryMillis === undefined) {
        onFrame({ type: "ended" });
        return;
      }
      onFrame({ type: "interrupted" });
      reopen = setTimeout(open, retryMillis);
    });
  };

  open();
  return () => {
    stopped = true;
    clearTimeout(reopen);
    source?.close();
  };
}
