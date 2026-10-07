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
  WebMessageAttachment,
  WebPublishMessageRequest,
  PulseQueryRequest,
  PulsePublishRequest,
  ProjectsQueryRequest,
} from "@client-kit/contracts";
import { createBffClient } from "@client-kit/platform/client";
import { hiddenConversationChannels, type ConversationVisibilityHost } from "@client-kit/platform/react/new-message";
import { newIdempotencyKey } from "@client-kit/platform/governance";
import { BffError, SessionEndedError, TransportError } from "@client-kit/platform/transport";
import { type BffRequest, unwrap } from "@client-kit/platform/transport";
import { createFetchTransport } from "@client-kit/platform/web-fetch";

export { BffError } from "@client-kit/platform/transport";

/**
 * 网关会话已不在：浏览器只能经一次顶层导航重新登录，由网关带去 IdP。
 */
let returningToLogin = false;
const transport = createFetchTransport({
  onSessionEnded: () => {
    if (returningToLogin) return;
    returningToLogin = true;
    window.location.assign(window.location.href);
  },
});

export const bff = createBffClient(transport);

export async function queryProjects(request:ProjectsQueryRequest):Promise<import("@client-kit/platform/react/projects").ProjectsPage>{
  return call({method:"POST",path:"/api/v1/projects/query",body:request});
}

export async function queryPulse(request: PulseQueryRequest): Promise<{events:BuzzEvent[];mediaPaths:Record<string,string>}> {
  const page = await call<{events: BuzzEvent[];mediaPaths:Record<string,string>}>({method: "POST", path: "/api/v1/pulse/query", body: request});
  if (!Array.isArray(page.events)) throw new TransportError("Invalid Pulse response");
  return page;
}
export async function publishPulse(request: PulsePublishRequest, idempotencyKey: string): Promise<{eventId:string;operationId:string}> {
  const path = "/api/v1/pulse/publish";
  return unwrap({method:"POST",path}, await transport.exchange(path, {method:"POST",
    headers:{"Content-Type":"application/json","Idempotency-Key":idempotencyKey}, body:JSON.stringify(request)}));
}
export async function publishMessageReaction(workspaceId: string, conversationId: string | undefined,
  request: PulsePublishRequest, idempotencyKey: string): Promise<{eventId:string;operationId:string}> {
  const path = conversationId
    ? `/api/v1/conversations/${encodeURIComponent(conversationId)}/reactions`
    : `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/reactions`;
  const receipt = unwrap<{eventId:string;operationId:string}>({method:"POST",path}, await transport.exchange(path, {
    method:"POST", headers:{"Content-Type":"application/json","Idempotency-Key":idempotencyKey}, body:JSON.stringify(request),
  }));
  if (!receipt?.eventId || !receipt.operationId) throw new TransportError("Reaction has no confirmed receipt.");
  return receipt;
}
export async function uploadPulseMedia(file: File): Promise<MediaDescriptor> {
  const path = "/api/v1/pulse/media";
  return unwrap({method:"POST",path}, await transport.exchange(path, {method:"POST",
    headers:{"Content-Type":file.type || "application/octet-stream"},body:file}));
}
export function pulseMediaUrl(hash: string): string { return `/api/v1/pulse/media/${encodeURIComponent(hash)}`; }

export const conversationVisibility: ConversationVisibilityHost = {
  read: async (conversation) => {
    const page = await call<{events: unknown}>({method: "GET", path: `/api/v1/conversations/${encodeURIComponent(conversation.id)}/visibility`});
    return hiddenConversationChannels(page.events);
  },
  prepare: async (conversation, hidden) => {
    const path = `/api/v1/conversations/${encodeURIComponent(conversation.id)}/${hidden ? "hide" : "reopen"}`;
    const key = newIdempotencyKey();
    return async () => {
      const receipt = unwrap<{eventId: string; operationId: string}>({method: "POST", path}, await transport.exchange(path, {
        method: "POST", headers: {"Idempotency-Key": key},
      }));
      if (!receipt?.eventId || !receipt.operationId) throw new TransportError("Invalid DM publication receipt");
    };
  },
};

export async function publishConversationMessage(conversationId: string, content: string,
  attachments: readonly MediaDescriptor[], idempotencyKey: string, editEventId?: string): Promise<{ eventId: string; operationId: string }> {
  const path = `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`;
  return unwrap({ method: "POST", path }, await transport.exchange(path, {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ content, attachments: [...attachments], mentionInstallationIds: [], editEventId } satisfies WebPublishMessageRequest),
  }));
}
export async function uploadConversationMedia(conversationId: string, file: File): Promise<MediaDescriptor> {
  const path = `/api/v1/conversations/${encodeURIComponent(conversationId)}/media`;
  return unwrap({ method: "POST", path }, await transport.exchange(path, {
    method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file,
  }));
}

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
  conversationPreferences?: Record<string, { starred: boolean; muted: boolean; updatedAt?: string }>;
  /** context key（Channel ID 等）→ 已读到的时刻，RFC 3339 UTC。三端读写同一个值。 */
  readContexts: Record<string, string>;
  version: number;
};

/** 一份已上传的媒体（Blossom descriptor）。发消息时原样带回，由 Core 生成 imeta。 */
export type MediaDescriptor = WebMessageAttachment;

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
  mentionInstallationIds: string[] = [],
  intent?: Pick<WebPublishMessageRequest, "messageType" | "parentEventId" | "editEventId">,
): Promise<{ eventId: string; operationId: string }> {
  const path = `/api/v1/workspaces/${workspaceId}/messages`;
  return unwrap(
    { method: "POST", path },
    await transport.exchange(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ content, attachments: [...attachments], mentionInstallationIds, ...intent } satisfies WebPublishMessageRequest),
    }),
  );
}

/** An immutable event has one author-deletion intent, including after a remount.
 * Its signed event digest supplies the UUID-sized opaque key; Core freezes the
 * full target and scope, so a collision is rejected, never applied elsewhere.
 * No browser key, content store or second mutation ledger is introduced. */
export async function deleteMessage(workspaceId: string, eventId: string, messageType: WebPublishMessageRequest["messageType"]): Promise<{eventId:string;operationId:string}> {
  if (!/^[0-9a-f]{64}$/.test(eventId)) throw new Error("Invalid deletion target");
  const id = eventId.slice(0, 32);
  const key = `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
  const path = `/api/v1/workspaces/${workspaceId}/messages/delete`;
  return unwrap({ method:"POST", path }, await transport.exchange(path, {
    method:"POST", headers:{"Content-Type":"application/json","Idempotency-Key":key},
    body:JSON.stringify({content:"",attachments:[],mentionInstallationIds:[],messageType,deleteEventId:eventId} satisfies WebPublishMessageRequest),
  }));
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

/** Own community profile media, with the same actor-signed Blossom consumer. */
export async function uploadProfileAvatar(bytes: number[], expectedPubkey: string): Promise<MediaDescriptor> {
  const path = "/api/v1/profile/media";
  return unwrap({ method: "POST", path }, await transport.exchange(path, {
    method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Profile-Pubkey": expectedPubkey }, body: new Uint8Array(bytes),
  }));
}

/** 取一份媒体的可渲染地址。它仍然经 BFF，不指向 Relay。 */
export function mediaUrl(workspaceId: string, sha256: string, conversationId?: string): string {
  return conversationId
    ? `/api/v1/conversations/${encodeURIComponent(conversationId)}/media/${sha256}`
    : `/api/v1/workspaces/${workspaceId}/media/${sha256}`;
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
 * 服务端把 generation 作为事件 id、把重连间隔作为 retry 下发。断线后先关闭
 * 原 EventSource，确认当前会话仍有效，才按该间隔重新订阅并取得 fresh snapshot。
 *
 * 会话探测也无法到达后端时仍使用同一 retry 间隔，不再打开未经确认的流。
 * 从未收到过间隔（第一次连接就失败）时不自定时长，如实显示已断开。
 *
 * `session-revoked`、`scope-revoked` 与 `identity-revoked` 是确定的拒绝，必须
 * 主动停下；其余关闭原因（包括 `readmission-unavailable`）仍交给重连。
 */
export function openStream(workspaceId: string, onFrame: (frame: StreamFrame) => void, conversationId?: string): () => void {
  let source: EventSource | undefined;
  let retryMillis: number | undefined;
  let reopen: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const recover = async () => {
    try {
      // EventSource cannot expose an HTTP status or stop a cross-origin
      // redirect itself. Probe through the existing manual-redirect transport
      // before permitting another subscription or top-level login.
      await bff.session();
    } catch (error) {
      if (stopped) return;
      if (error instanceof SessionEndedError ||
        (error instanceof BffError && (error.status === 401 || error.status === 403))) {
        stopped = true;
        onFrame({ type: "ended" });
        return;
      }
      if (retryMillis !== undefined) reopen = setTimeout(() => { void recover(); }, retryMillis);
      else onFrame({ type: "ended" });
      return;
    }
    if (stopped) return;
    if (retryMillis !== undefined) reopen = setTimeout(open, retryMillis);
    else onFrame({ type: "ended" });
  };

  const open = () => {
    if (stopped) return;
    clearTimeout(reopen);
    reopen = undefined;
    const es = new EventSource(conversationId
      ? `/api/v1/conversations/${encodeURIComponent(conversationId)}/stream`
      : `/api/v1/workspaces/${workspaceId}/stream`);
    source = es;
    es.addEventListener("retry", (e) => {
      if (stopped || source !== es) return;
      const ms = Number((e as MessageEvent<string>).data);
      if (Number.isFinite(ms) && ms > 0) retryMillis = ms;
    });
    es.addEventListener("snapshot", (e) => {
      if (stopped || source !== es) return;
      onFrame({
        type: "snapshot",
        events: JSON.parse((e as MessageEvent<string>).data) as BuzzEvent[],
      });
    });
    es.addEventListener("event", (e) => {
      if (stopped || source !== es) return;
      onFrame({
        type: "event",
        event: JSON.parse((e as MessageEvent<string>).data) as BuzzEvent,
      });
    });
    es.addEventListener("live", () => {
      if (stopped || source !== es) return;
      onFrame({ type: "live" });
    });
    es.addEventListener("closed", (e) => {
      if (stopped || source !== es) return;
      const reason = (e as MessageEvent<string>).data;
      if (
        reason === "session-revoked" ||
        reason === "scope-revoked" ||
        reason === "identity-revoked"
      ) {
        stopped = true;
        clearTimeout(reopen);
        reopen = undefined;
        es.close();
      }
      onFrame({ type: "closed", reason });
    });
    es.addEventListener("error", () => {
      if (stopped || source !== es) return;
      // Even CONNECTING would otherwise retry without observing an expired
      // browser session, repeatedly creating OIDC transactions on HTTP origins.
      es.close();
      source = undefined;
      clearTimeout(reopen);
      onFrame({ type: "interrupted" });
      void recover();
    });
  };

  open();
  return () => {
    stopped = true;
    clearTimeout(reopen);
    source?.close();
  };
}
