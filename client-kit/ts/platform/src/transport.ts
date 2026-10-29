// BFF 管理平面的传输接缝（ADR-09）。
//
// 平台自有的 TypeScript 只有一份，Web 与 Desktop 只在「一次请求怎么送到 BFF」上
// 不同：Web 同源 fetch、会话由网关 cookie 承载（web-fetch.ts）；Desktop 经 Tauri 的
// `platform_api` 命令、令牌只在 Rust 侧（native.ts）。两个都是真实实现，因此这里只定义
// 两者共同的最小形状，其余（错误解读、各端点的路径与类型）都在 client.ts 里只写一次。

import { type ErrorBody, ErrorClass, ReasonCode } from "@client-kit/contracts";

export type BffMethod = "GET" | "POST" | "PUT" | "DELETE";

/** 一次管理平面请求。`path` 必须在 `/api/v1/` 下；正文是 JSON。 */
export type BffRequest = {
  method: BffMethod; path: string; body?: unknown;
  /** Security re-check: the transport must send a new request, never a shared or settled answer. */
  fresh?: boolean;
  /**
   * DD-81 publication intent, sent as the `Idempotency-Key` header: a retry after an unknown
   * outcome carries the same key so Core answers the original attempt. The only extra header
   * a request may carry; Desktop's Rust `platform_api` refuses any other.
   */
  idempotencyKey?: string;
};

/**
 * BFF 的回应：状态码与已解析的正文（没有正文或不是 JSON 时为 `undefined`）。
 * `retryAfterSeconds` 取自 `Retry-After`（DD-156(3)：BFF 的 429 总带它）；没有时缺省。
 */
export type BffReply = { status: number; body: unknown; retryAfterSeconds?: number };

export interface BffTransport {
  send(request: BffRequest): Promise<BffReply>;
}

/**
 * 后端拒绝一次调用。`status` 保留原值；`errorClass`、`reason`、`operationId`
 * 取自统一错误体（contracts 的 ErrorBody），没有错误体时缺省——不从状态码猜分类。
 *
 * `errorClass === "UNKNOWN"` 是外部副作用结果不明：界面不得把它渲染成成功或
 * 失败，只能显示待确认并给出 operationId 作为查证入口。
 */
export class BffError extends Error {
  readonly status: number;
  readonly errorClass?: ErrorBody["class"];
  readonly reason?: ErrorBody["reason"];
  readonly operationId?: string;
  /** DD-125(2)：PUBLISH_REJECTED 因社区禁言/封禁时的结构化限制（原禁言横幅的唯一来源）。 */
  readonly restriction?: ErrorBody["restriction"];
  /** DD-156(3)：限流回应的 `Retry-After` 秒数；回应没有带时缺省。 */
  readonly retryAfterSeconds?: number;
  constructor(status: number, message: string, body?: Partial<ErrorBody>, retryAfterSeconds?: number) {
    super(message);
    this.name = "BffError";
    this.status = status;
    this.errorClass = body?.class;
    this.reason = body?.reason;
    this.operationId = body?.operationId;
    this.restriction = body?.restriction;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * DD-156(3)：`LIMIT`/`RATE_LIMITED`（或没有错误体的 429）是确定未处理，不是结果不明。
 * 只读读取据此按 `Retry-After` 自动重读；写动作不自动重放。
 */
export function isRateLimited(error: unknown): error is BffError {
  return error instanceof BffError && (
    error.status === 429
    || (error.errorClass === ErrorClass.Limit && error.reason === ReasonCode.RateLimited)
  );
}

/** 限流错误给出的等待毫秒数；不是限流或没有 `Retry-After` 时为 `undefined`。 */
export function rateLimitRetryMs(error: unknown): number | undefined {
  if (!isRateLimited(error) || error.retryAfterSeconds === undefined) return undefined;
  return Math.max(0, error.retryAfterSeconds) * 1_000;
}

/** DD-156(3)：查询缓存对限流读取的自动重读上限；其他失败维持原先的 1 次。 */
export const RATE_LIMITED_QUERY_RETRIES = 3;

/** react-query `retry`：限流按次数上限重读，其他失败只重试 1 次（原默认）。 */
export function queryRetry(failureCount: number, error: unknown): boolean {
  return failureCount < (isRateLimited(error) ? RATE_LIMITED_QUERY_RETRIES : 1);
}

/** react-query `retryDelay`：限流等 `Retry-After`（没带时 1 秒），其他失败沿用原默认退避。 */
export function queryRetryDelay(failureCount: number, error: unknown): number {
  if (isRateLimited(error)) return rateLimitRetryMs(error) ?? 1_000;
  return Math.min(1_000 * 2 ** failureCount, 30_000);
}

/**
 * 这一端已没有可用的平台会话（Web：网关会话结束；Desktop：刷新令牌被拒或已注销）。
 * 传输先通知宿主回到登录，再抛出它，调用方不必各自识别。
 */
export class SessionEndedError extends Error {
  constructor() {
    super("平台会话已结束，需要重新登录");
    this.name = "SessionEndedError";
  }
}

/**
 * 请求没有得到 BFF 的回应（网络、进程或宿主层失败）。这不是「被拒绝」：请求
 * 可能已经到达并生效，写动作因此属于结果不明。
 */
export class TransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransportError";
  }
}

function errorBody(body: unknown): Partial<ErrorBody> | undefined {
  return body !== null && typeof body === "object" ? (body as Partial<ErrorBody>) : undefined;
}

/** 非 2xx 即抛 BffError；2xx 返回正文。回应的形状由调用处以 contracts 类型声明。 */
export function unwrap<T>(request: BffRequest, reply: BffReply): T {
  if (reply.status < 200 || reply.status >= 300) {
    throw new BffError(
      reply.status,
      `${request.method} ${request.path} → ${reply.status}`,
      errorBody(reply.body),
      reply.retryAfterSeconds,
    );
  }
  return reply.body as T;
}

/**
 * 一次写动作的结论是否不明：没有回应，或回应明确说「UNKNOWN」。两者都不得渲染成
 * 成功或失败。
 */
export function isOutcomeUnknown(error: unknown): boolean {
  return (
    error instanceof TransportError ||
    (error instanceof BffError && error.errorClass === ErrorClass.Unknown)
  );
}

/**
 * 一次失败写动作的结论：结果不明（带 operationId 作查证入口），或确定被拒（带
 * reason code；没有错误体时只有状态码，不从状态码猜 reason）。
 */
export type WriteFailure =
  | { kind: "unknown"; operationId?: string }
  | { kind: "rejected"; reason?: ErrorBody["reason"]; detail: string };

export function writeFailure(error: unknown): WriteFailure {
  if (isOutcomeUnknown(error))
    return { kind: "unknown", operationId: error instanceof BffError ? error.operationId : undefined };
  if (error instanceof BffError)
    return { kind: "rejected", reason: error.reason, detail: String(error.status) };
  return { kind: "rejected", detail: String(error) };
}
