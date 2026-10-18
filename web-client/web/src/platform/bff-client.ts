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
  ProjectsPublishRequest,
  ProjectsGitQueryRequest,
  ProjectsGitQueryResponse,
  ProjectsGitRefRequest,
  ProjectsGitRefResponse,
  ProjectsGitMergeRequest,
  ProjectsGitMergeResponse,
  WebSearchQuery,
  WebPublishTopicRequest,
  WebPresencePage,
  WebPresenceQueryRequest,
  WebPresenceUpdateRequest,
  WebUserStatusPage,
  WebUserStatusQueryRequest,
  WebUserStatusUpdateRequest,
  AgentMentionOutcomePage,
  AgentMentionOutcomeQueryRequest,
  WebTypingRequest,
} from "@client-kit/contracts";
import { AgentMentionOutcomeState, ReasonCode, WebPresenceStatus } from "@client-kit/contracts";
import { KIND_PRESENCE_UPDATE, KIND_USER_STATUS } from "@client-kit/platform/react/thread/kinds";
import type { SearchMessagesResponse } from "@client-kit/platform/react/search/types";
import { getThreadReference } from "@client-kit/platform/react/messages/threading";
import { createBffClient } from "@client-kit/platform/client";
import { hiddenConversationChannels, type ConversationVisibilityHost } from "@client-kit/platform/react/new-message";
import { newIdempotencyKey } from "@client-kit/platform/governance";
import { BffError, SessionEndedError, TransportError } from "@client-kit/platform/transport";
import { type BffRequest, unwrap } from "@client-kit/platform/transport";
import { createFetchTransport, isSettledRead, SETTLED_READ_MS } from "@client-kit/platform/web-fetch";

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
  settleMs: SETTLED_READ_MS,
  settled: isSettledRead,
});

export const bff = createBffClient(transport);

/** DD-120 BFF routes; each path is named only here so it aligns with Core in one place. */
export const PRESENCE_PATH = "/api/v1/presence";
export const PRESENCE_QUERY_PATH = "/api/v1/presence/query";
export const USER_STATUS_PATH = "/api/v1/user-status";
export const USER_STATUS_QUERY_PATH = "/api/v1/user-status/query";

type PresenceChoice = "online" | "away" | "offline";
const PRESENCE_WIRE = {
  online: WebPresenceStatus.Online,
  away: WebPresenceStatus.Away,
  offline: WebPresenceStatus.Offline,
} as const satisfies Record<PresenceChoice, WebPresenceStatus>;

/** DD-120 (3): the Relay-signed 20001 snapshot facts for exactly these pubkeys. */
export async function queryPresence(pubkeys: string[]): Promise<WebPresencePage> {
  const page = await call<WebPresencePage>({ method: "POST", path: PRESENCE_QUERY_PATH,
    body: { pubkeys } satisfies WebPresenceQueryRequest });
  if (!page || !Array.isArray(page.presences)) throw new TransportError("Invalid presence response");
  return page;
}

/**
 * DD-120 (1)/(2): the person's own heartbeat or manual choice. Core signs the 20001 over the
 * existing session connection; latest wins, a timeout is not success and is never re-signed —
 * the next heartbeat supersedes it. offline releases the presence lease.
 */
export async function updatePresence(status: PresenceChoice): Promise<void> {
  await call<unknown>({ method: "PUT", path: PRESENCE_PATH,
    body: { status: PRESENCE_WIRE[status] } satisfies WebPresenceUpdateRequest });
}

/** Best-effort offline as the page goes away; `keepalive` lets it outlive the document. */
export function releasePresence(): void {
  void transport.exchange(PRESENCE_PATH, {
    method: "PUT", keepalive: true, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: WebPresenceStatus.Offline } satisfies WebPresenceUpdateRequest),
  }).catch(() => undefined);
}

/**
 * DD-120 (1): the original 20002 typing indicator. Core signs it over the person's existing
 * session connection; latest wins and nothing is re-signed, so callers ignore failures. Without
 * a thread it is the main-channel shape; inside a thread the typed thread-head reference becomes
 * the original e root/reply tags (buildThreadReferenceTags) — the browser never sends raw tags.
 */
export function typingPath(scope: { workspaceId?: string; conversationId?: string }): string | null {
  if (scope.conversationId) return `/api/v1/conversations/${encodeURIComponent(scope.conversationId)}/typing`;
  if (scope.workspaceId) return `/api/v1/workspaces/${encodeURIComponent(scope.workspaceId)}/typing`;
  return null;
}

export async function publishTyping(scope: { workspaceId?: string; conversationId?: string },
  thread?: { parentEventId: string; rootEventId?: string | null }): Promise<void> {
  const path = typingPath(scope);
  if (!path) return;
  const body: WebTypingRequest | undefined = thread ? { parentEventId: thread.parentEventId,
    ...(thread.rootEventId && thread.rootEventId !== thread.parentEventId ? { rootEventId: thread.rootEventId } : {}) } : undefined;
  await call<unknown>({ method: "POST", path, ...(body ? { body } : {}) });
}

/** DD-120 (4): the latest verified `d=general` 30315 per pubkey; a cleared status is omitted. */
export async function queryUserStatus(pubkeys: string[]): Promise<WebUserStatusPage> {
  const page = await call<WebUserStatusPage>({ method: "POST", path: USER_STATUS_QUERY_PATH,
    body: { pubkeys } satisfies WebUserStatusQueryRequest });
  if (!page || !Array.isArray(page.statuses)) throw new TransportError("Invalid user status response");
  return page;
}

/**
 * DD-120 (4) under DD-81: Core publishes the person's own 30315 with their SERVER key. The
 * intent's Idempotency-Key is resent unchanged after an UNKNOWN outcome and Core reconciles it,
 * never re-signs. A 2xx without an event receipt is unknown.
 */
export async function updateUserStatus(request: WebUserStatusUpdateRequest, idempotencyKey: string): Promise<{eventId:string;createdAt?:number}> {
  const receipt = unwrap<{eventId?: unknown; createdAt?: unknown}>({ method: "PUT", path: USER_STATUS_PATH },
    await transport.exchange(USER_STATUS_PATH, {
      method: "PUT", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(request satisfies WebUserStatusUpdateRequest),
    }));
  if (!receipt || typeof receipt.eventId !== "string" || !receipt.eventId) throw new TransportError("User status publication outcome unknown");
  return { eventId: receipt.eventId,
    ...(typeof receipt.createdAt === "number" && Number.isSafeInteger(receipt.createdAt) ? { createdAt: receipt.createdAt } : {}) };
}

/**
 * DD-120 (3): admitted channel/conversation streams also carry member-signed 20001 and 30315
 * without an `h` tag. They are identity facts for the presence host, never timeline rows,
 * notifications or a reason to drop shared reads, so openStream routes them here only.
 */
const identityStreamKinds: ReadonlySet<number> = new Set([KIND_PRESENCE_UPDATE, KIND_USER_STATUS]);
let identityStreamSink: ((event: BuzzEvent) => void) | null = null;
export function setIdentityStreamSink(sink: (event: BuzzEvent) => void): () => void {
  identityStreamSink = sink;
  return () => { if (identityStreamSink === sink) identityStreamSink = null; };
}
function isIdentityStreamEvent(event: unknown): event is BuzzEvent {
  return Boolean(event) && typeof event === "object" && identityStreamKinds.has((event as BuzzEvent).kind);
}

/** Original Relay FTS relevance order; the browser never constructs a Relay filter. */
async function admittedSearchEvents(request: WebSearchQuery): Promise<{event: BuzzEvent; channelId: string}[]> {
  const page = await call<{events: BuzzEvent[]}>({method:"POST",path:"/api/v1/search/messages",body:request});
  if (!Array.isArray(page.events)) throw new TransportError("Invalid search response");
  const rows = page.events.map((event) => {
    if (!event || !/^[0-9a-f]{64}$/.test(event.id) || !/^[0-9a-f]{64}$/.test(event.pubkey)
      || ![9,40002,45001,45003].includes(event.kind) || typeof event.content !== "string"
      || !Number.isSafeInteger(event.created_at) || event.created_at < 0 || !Array.isArray(event.tags)
      || event.tags.some(tag => !Array.isArray(tag) || tag.some(value => typeof value !== "string")))
      throw new TransportError("Invalid search event");
    const channels = event.tags.filter(tag => tag[0] === "h");
    const channelId = channels.length === 1 ? channels[0]?.[1] : undefined;
    if (!channelId) throw new TransportError("Invalid search channel");
    return {event, channelId};
  });
  if (new Set(rows.map(({event}) => event.id)).size !== rows.length) throw new TransportError("Duplicate search event");
  return rows;
}

/** The same admitted search events, for consumers that re-validate exact channel membership. */
export async function searchMessageEvents(request: WebSearchQuery): Promise<BuzzEvent[]> {
  return (await admittedSearchEvents(request)).map(({event}) => event);
}

export async function searchMessages(request: WebSearchQuery): Promise<SearchMessagesResponse> {
  const rows = await admittedSearchEvents(request);
  const total = rows.length;
  const hits = rows.map(({event, channelId},index) => ({eventId:event.id,content:event.content,kind:event.kind,pubkey:event.pubkey,
    channelId,channelName:null,createdAt:event.created_at,
    score:total <= 1 ? 1 : 1 - index / total,threadRootId:getThreadReference(event.tags).rootId}));
  return {hits,found:hits.length};
}

export async function queryProjects(request:ProjectsQueryRequest):Promise<import("@client-kit/platform/react/projects").ProjectsPage>{
  return call({method:"POST",path:"/api/v1/projects/query",body:request});
}

/** DD-118 typed Projects Git read; the Browser names only the 30617 coordinate, ref and path. */
export async function queryProjectsGit(request:ProjectsGitQueryRequest):Promise<ProjectsGitQueryResponse>{
  return call({method:"POST",path:"/api/v1/projects/git/query",body:request});
}

/**
 * DD-118 branch create/delete: the person's own SERVER identity pushes through BFF. The intent's
 * Idempotency-Key is resent unchanged after an UNKNOWN outcome; BFF reconciles it from info/refs.
 */
export async function refProjectsGit(request:ProjectsGitRefRequest,idempotencyKey:string):Promise<ProjectsGitRefResponse>{
  const path="/api/v1/projects/git/ref";
  const result=unwrap<ProjectsGitRefResponse>({method:"POST",path},await transport.exchange(path,{
    method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":idempotencyKey},body:JSON.stringify(request),
  }));
  if(!result||typeof result.branch!=="string"||typeof result.commit!=="string")throw new TransportError("Repository ref outcome unknown");
  return result;
}

/**
 * DD-118 review merge: only the repository coordinate owner's own SERVER identity merges and pushes
 * through BFF, which then publishes the owner-signed 1631. The intent's Idempotency-Key is resent
 * unchanged after an UNKNOWN outcome; BFF reconciles the push from info/refs.
 */
export async function mergeProjectsGit(request:ProjectsGitMergeRequest,idempotencyKey:string):Promise<ProjectsGitMergeResponse>{
  const path="/api/v1/projects/git/merge";
  const result=unwrap<ProjectsGitMergeResponse>({method:"POST",path},await transport.exchange(path,{
    method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":idempotencyKey},body:JSON.stringify(request),
  }));
  if(!result||typeof result.mergeCommit!=="string")throw new TransportError("Repository merge outcome unknown");
  return result;
}

export async function queryReminders():Promise<{pubkey:string;reminders:import("@client-kit/contracts").ReminderView[]}> {
  return call({method:"GET",path:"/api/v1/reminders"});
}
export async function reminderSource(request:import("@client-kit/contracts").ReminderSourceRequest):Promise<{event:BuzzEvent}> {
  return call({method:"POST",path:"/api/v1/reminders/source",body:request});
}
export async function publishReminder(request:import("@client-kit/contracts").ReminderPublishRequest,idempotencyKey:string):Promise<{eventId:string;operationId:string}> {
  const path="/api/v1/reminders/publish";
  const receipt=unwrap<{eventId:string;operationId:string}>({method:"POST",path},await transport.exchange(path,{
    method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":idempotencyKey},body:JSON.stringify(request)}));
  if(!receipt?.eventId||!receipt.operationId)throw new TransportError("Reminder publication outcome unknown");
  return receipt;
}

/** DD-121 route; the one place the Web path is named, so it aligns with BFF here. */
export function agentMentionOutcomesPath(workspaceId: string): string {
  return `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/agent-mentions/query`;
}

/** contracts/api/agent_mention_outcome_query_request.schema.json `eventIds.maxItems`. */
export const AGENT_MENTION_OUTCOME_QUERY_LIMIT = 50;

const OUTCOME_STATES: ReadonlySet<string> = new Set(Object.values(AgentMentionOutcomeState));
const REASON_CODES: ReadonlySet<string> = new Set(Object.values(ReasonCode));

/**
 * DD-121 (1): read-only `agent.invoke` outcomes of the caller's own messages in this Workspace.
 * Only rows for the requested event IDs are accepted; a malformed page is never rendered.
 */
export async function queryAgentMentionOutcomes(workspaceId: string, eventIds: readonly string[]): Promise<AgentMentionOutcomePage> {
  const requested = [...new Set(eventIds)];
  if (requested.length === 0 || requested.length > AGENT_MENTION_OUTCOME_QUERY_LIMIT || !requested.every((id) => /^[0-9a-f]{64}$/.test(id)))
    throw new TransportError("Invalid agent mention outcome request");
  const page = await call<AgentMentionOutcomePage>({ method: "POST", path: agentMentionOutcomesPath(workspaceId),
    body: { eventIds: requested } satisfies AgentMentionOutcomeQueryRequest });
  const asked = new Set(requested);
  if (!page || !Array.isArray(page.outcomes) || !page.outcomes.every((row) => row && typeof row === "object"
    && typeof row.eventId === "string" && asked.has(row.eventId)
    && typeof row.installationId === "string" && row.installationId !== ""
    && OUTCOME_STATES.has(row.state)
    && (row.reasonCode === undefined || REASON_CODES.has(row.reasonCode))
    && (row.replyEventId === undefined || typeof row.replyEventId === "string")))
    throw new TransportError("Invalid agent mention outcome response");
  return page;
}

/** DD-119 member topic route; the one place the Web path is named, so it aligns with BFF here. */
export function channelTopicPath(workspaceId: string): string {
  return `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/channel/topic`;
}

/**
 * DD-119 (9), V-SCN-99: the member's own SERVER identity publishes the strict h+topic 9002
 * through BFF. Only the topic is sent; the intent's Idempotency-Key is resent unchanged after an
 * UNKNOWN outcome and BFF reconciles it, never re-signs. A 2xx without a receipt is unknown.
 */
export async function publishChannelTopic(workspaceId: string, request: WebPublishTopicRequest, idempotencyKey: string): Promise<{eventId:string;operationId:string}> {
  const path = channelTopicPath(workspaceId);
  const receipt = unwrap<{eventId:string;operationId:string}>({method:"POST",path}, await transport.exchange(path, {
    method:"POST", headers:{"Content-Type":"application/json","Idempotency-Key":idempotencyKey},
    body:JSON.stringify({topic:request.topic} satisfies WebPublishTopicRequest),
  }));
  if (!receipt?.eventId || !receipt.operationId) throw new TransportError("Topic publication outcome unknown");
  return receipt;
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
export async function publishProject(request: ProjectsPublishRequest, idempotencyKey: string): Promise<{eventId:string;operationId:string}> {
  const path="/api/v1/projects/publish";
  const receipt=unwrap<{eventId:string;operationId:string}>({method:"POST",path},await transport.exchange(path,{
    method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":idempotencyKey},body:JSON.stringify(request),
  }));
  if(!receipt?.eventId||!receipt.operationId)throw new TransportError("Project publication outcome unknown");
  return receipt;
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
  attachments: readonly MediaDescriptor[], idempotencyKey: string, editEventId?: string, parentEventId?: string, mentionPubkeys?: string[]): Promise<{ eventId: string; operationId: string }> {
  const path = `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`;
  return unwrap({ method: "POST", path }, await transport.exchange(path, {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ content, attachments: [...attachments], mentionInstallationIds: [], editEventId, parentEventId, mentionPubkeys } satisfies WebPublishMessageRequest),
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
  /** Present on signed Relay events; absence never permits delegated authorship. */
  sig?: string;
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
/** Sign-out never waits on a best-effort presence release longer than this. */
const SIGN_OUT_PRESENCE_WAIT_MS = 1_000;
export async function signOut(): Promise<void> {
  // DD-120 (2): others see offline at once; Core still closes the connection on logout.
  await Promise.race([updatePresence("offline").catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, SIGN_OUT_PRESENCE_WAIT_MS))]);
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
  intent?: Pick<WebPublishMessageRequest, "messageType" | "parentEventId" | "editEventId" | "mentionPubkeys">,
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
export async function deleteMessage(workspaceId: string, eventId: string, messageType: WebPublishMessageRequest["messageType"], conversationId?: string): Promise<{eventId:string;operationId:string}> {
  if (!/^[0-9a-f]{64}$/.test(eventId)) throw new Error("Invalid deletion target");
  const id = eventId.slice(0, 32);
  const key = `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
  const path = conversationId ? `/api/v1/conversations/${conversationId}/messages/delete` : `/api/v1/workspaces/${workspaceId}/messages/delete`;
  const receipt = unwrap<{eventId:string;operationId:string}>({ method:"POST", path }, await transport.exchange(path, {
    method:"POST", headers:{"Content-Type":"application/json","Idempotency-Key":key},
    body:JSON.stringify({content:"",attachments:[],mentionInstallationIds:[],messageType,deleteEventId:eventId} satisfies WebPublishMessageRequest),
  }));
  if (!receipt?.eventId || !receipt.operationId) throw new TransportError("Deletion has no confirmed receipt.");
  return receipt;
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
 * Buzz 779af8886caae1317b4de962082429867ab61503 shared/api/relayClientShared.ts ConnectionState,
 * without the native-only `stalled`: the Web connection is the set of open BFF streams
 * (SS-WEB-RELAY), never a browser Relay socket. `idle` means no stream is open.
 */
export type StreamConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected";
type StreamConnection = { state: Exclude<StreamConnectionState, "idle">; reconnect: () => Promise<void> };
const streamConnections = new Set<StreamConnection>();
const streamConnectionListeners = new Set<() => void>();
let streamConnectionSnapshot: StreamConnectionState = "idle";
function aggregateStreamConnection(): StreamConnectionState {
  if (streamConnections.size === 0) return "idle";
  const states = new Set([...streamConnections].map((connection) => connection.state));
  // The worst open stream decides: one unreachable scope is an unreachable connection.
  for (const state of ["disconnected", "reconnecting", "connecting"] as const) if (states.has(state)) return state;
  return "connected";
}
function publishStreamConnection() {
  const next = aggregateStreamConnection();
  if (next === streamConnectionSnapshot) return;
  streamConnectionSnapshot = next;
  for (const listener of [...streamConnectionListeners]) listener();
}
/** The aggregated BFF stream connection state (useSyncExternalStore snapshot). */
export function streamConnectionState(): StreamConnectionState {
  return streamConnectionSnapshot;
}
export function subscribeStreamConnection(listener: () => void): () => void {
  streamConnectionListeners.add(listener);
  return () => { streamConnectionListeners.delete(listener); };
}
/**
 * Original useReconnectRelay: retry every open stream now instead of waiting for its server retry
 * interval. Each stream still probes the session first; revoked streams never reopen. Resolves
 * once every attempt settled, with whether the aggregate is connected again.
 */
export async function reconnectStreams(): Promise<boolean> {
  await Promise.all([...streamConnections].map((connection) => connection.reconnect()));
  return streamConnectionSnapshot === "connected";
}

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
  let connectedOnce = false;
  // A user-requested reconnect skips the server retry wait once, after the same session probe.
  let reconnectNow = false;
  let recovering = false;
  // Callers of a requested reconnect wait until this attempt connects, ends or falls back to the
  // server retry interval.
  let attemptWaiters: (() => void)[] = [];
  const settleAttempt = () => {
    const waiters = attemptWaiters;
    attemptWaiters = [];
    for (const resolve of waiters) resolve();
  };
  const connection: StreamConnection = { state: "connecting", reconnect: () => {
    if (stopped || connection.state === "connected") return Promise.resolve();
    const settled = new Promise<void>((resolve) => { attemptWaiters.push(resolve); });
    if (!recovering && connection.state !== "connecting") {
      clearTimeout(reopen);
      reopen = undefined;
      reconnectNow = true;
      void recover();
    }
    return settled;
  } };
  const setConnection = (state: StreamConnection["state"]) => {
    connection.state = state;
    publishStreamConnection();
    if (state === "connected" || state === "disconnected") settleAttempt();
  };
  // A revocation or ended session is not a connectivity problem: it leaves the aggregate.
  const leaveConnection = () => {
    streamConnections.delete(connection);
    publishStreamConnection();
    settleAttempt();
  };
  streamConnections.add(connection);
  publishStreamConnection();

  const recover = async () => {
    recovering = true;
    try {
      // EventSource cannot expose an HTTP status or stop a cross-origin
      // redirect itself. Probe through the existing manual-redirect transport
      // before permitting another subscription or top-level login.
      transport.invalidateReads();
      await bff.session();
    } catch (error) {
      recovering = false;
      reconnectNow = false;
      if (stopped) return;
      if (error instanceof SessionEndedError ||
        (error instanceof BffError && (error.status === 401 || error.status === 403))) {
        stopped = true;
        leaveConnection();
        onFrame({ type: "ended" });
        return;
      }
      if (retryMillis !== undefined) {
        reopen = setTimeout(() => { void recover(); }, retryMillis);
        settleAttempt();
      } else {
        setConnection("disconnected");
        onFrame({ type: "ended" });
      }
      return;
    }
    recovering = false;
    if (stopped) return;
    const immediate = reconnectNow;
    reconnectNow = false;
    if (immediate) open();
    else if (retryMillis !== undefined) {
      reopen = setTimeout(open, retryMillis);
      settleAttempt();
    } else {
      setConnection("disconnected");
      onFrame({ type: "ended" });
    }
  };

  const open = () => {
    if (stopped) return;
    clearTimeout(reopen);
    reopen = undefined;
    setConnection(connectedOnce ? "reconnecting" : "connecting");
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
      const parsed = JSON.parse((e as MessageEvent<string>).data) as unknown;
      const events = Array.isArray(parsed) ? parsed : [];
      for (const event of events) if (isIdentityStreamEvent(event)) identityStreamSink?.(event);
      onFrame({
        type: "snapshot",
        events: (Array.isArray(parsed) ? events.filter((event) => !isIdentityStreamEvent(event)) : parsed) as BuzzEvent[],
      });
    });
    es.addEventListener("event", (e) => {
      if (stopped || source !== es) return;
      const event = JSON.parse((e as MessageEvent<string>).data) as BuzzEvent;
      if (isIdentityStreamEvent(event)) {
        identityStreamSink?.(event);
        return;
      }
      // A live change (or a closed/interrupted stream) ends every shared settled read; the
      // initial snapshot is the same state the shared reads already describe.
      transport.invalidateReads();
      onFrame({ type: "event", event });
    });
    es.addEventListener("live", () => {
      if (stopped || source !== es) return;
      connectedOnce = true;
      setConnection("connected");
      onFrame({ type: "live" });
    });
    es.addEventListener("closed", (e) => {
      if (stopped || source !== es) return;
      transport.invalidateReads();
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
        leaveConnection();
      }
      onFrame({ type: "closed", reason });
    });
    es.addEventListener("error", () => {
      if (stopped || source !== es) return;
      transport.invalidateReads();
      // Even CONNECTING would otherwise retry without observing an expired
      // browser session, repeatedly creating OIDC transactions on HTTP origins.
      es.close();
      source = undefined;
      clearTimeout(reopen);
      setConnection(connectedOnce ? "reconnecting" : "connecting");
      onFrame({ type: "interrupted" });
      void recover();
    });
  };

  open();
  return () => {
    stopped = true;
    clearTimeout(reopen);
    source?.close();
    leaveConnection();
  };
}
