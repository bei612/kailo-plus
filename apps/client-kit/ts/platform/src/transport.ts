// BFF 管理平面的传输接缝（ADR-09）。
//
// Kailo 自有的 TypeScript 只有一份，Web 与 Desktop 只在「一次请求怎么送到 BFF」上
// 不同：Web 同源 fetch、会话由网关 cookie 承载（web-fetch.ts）；Desktop 经 Tauri 的
// `kailo_api` 命令、令牌只在 Rust 侧（native.ts）。两个都是真实实现，因此这里只定义
// 两者共同的最小形状，其余（错误解读、各端点的路径与类型）都在 client.ts 里只写一次。

import { type ErrorBody, ErrorClass } from "@kailo/contracts";

export type BffMethod = "GET" | "POST" | "PUT" | "DELETE";

/** 一次管理平面请求。`path` 必须在 `/api/v1/` 下；正文是 JSON。 */
export type BffRequest = { method: BffMethod; path: string; body?: unknown };

/** BFF 的回应：状态码与已解析的正文（没有正文或不是 JSON 时为 `undefined`）。 */
export type BffReply = { status: number; body: unknown };

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
  constructor(status: number, message: string, body?: Partial<ErrorBody>) {
    super(message);
    this.name = "BffError";
    this.status = status;
    this.errorClass = body?.class;
    this.reason = body?.reason;
    this.operationId = body?.operationId;
  }
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
