// 一次消息发布没有被 Relay 接受时的确定分类（apps/06 §4：结果不明不渲染为成功，
// 也不渲染为失败）。WebSocket 路径抛出下面的类型；REST 路径（Rust 的
// `send_channel_message`）返回 `relay.rs` 里固定前缀的错误串，由
// `classifyRelayPublishFailure` 归入同一组分类。
//
// 结果不明时 Relay 可能已经存储了事件。原样重发同一个已签名事件（同一 id）由 Relay
// 以 `duplicate:` 接受而不再存第二条（buzz-db `store/event.rs` 的
// `ON CONFLICT DO NOTHING`，主键含 id；buzz-relay `handlers/ingest.rs` 的
// `!was_inserted` 分支）；两条发送路径都按「内容 + 标签」指纹复用未确认的事件。

import { PublishRestrictionKind } from "@client-kit/contracts";
import type { PublishRestriction } from "@client-kit/platform/moderation";

/** Relay 以 OK false 明确拒绝：确定未存储。 */
export class RelayPublishRejectedError extends Error {
  readonly eventId: string;
  readonly relayMessage: string;
  constructor(eventId: string, relayMessage: string) {
    super(relayMessage || "Relay rejected the event.");
    this.name = "RelayPublishRejectedError";
    this.eventId = eventId;
    this.relayMessage = relayMessage;
  }
}

/** EVENT 没有离开本机：确定未发送。 */
export class RelayPublishNotSentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayPublishNotSentError";
  }
}

/** EVENT 已发出（或可能已发出）而没有 OK：不是成功，也不是失败。 */
export class RelayPublishUnknownError extends Error {
  readonly eventId: string;
  constructor(eventId: string, message: string) {
    super(message);
    this.name = "RelayPublishUnknownError";
    this.eventId = eventId;
  }
}

export type RelayPublishFailure =
  | { kind: "rejected" }
  | { kind: "rateLimited"; retryAfterSeconds: number | null }
  | { kind: "notSent" }
  | { kind: "outcomeUnknown" };

const RETRY_IN = /retry in (\d+)s/i;

function rateLimited(message: string): RelayPublishFailure {
  const match = RETRY_IN.exec(message);
  return {
    kind: "rateLimited",
    retryAfterSeconds: match ? Number(match[1]) : null,
  };
}

function errorText(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return null;
}

/**
 * 把一次发送失败归入确定的分类；不是 Relay 发布失败的错误返回 null（调用方按原样
 * 处理，例如社区切换导致的取消）。
 */
export function classifyRelayPublishFailure(
  error: unknown,
): RelayPublishFailure | null {
  if (error instanceof RelayPublishRejectedError) {
    return error.relayMessage.trim().toLowerCase().startsWith("rate-limited:")
      ? rateLimited(error.relayMessage)
      : { kind: "rejected" };
  }
  if (error instanceof RelayPublishNotSentError) return { kind: "notSent" };
  if (error instanceof RelayPublishUnknownError) {
    return { kind: "outcomeUnknown" };
  }

  // REST 路径：`src-tauri/src/relay/submit.rs` 与 `relay.rs` 的固定前缀
  const text = errorText(error)?.trim();
  if (!text) return null;
  if (
    text === "relay publish outcome unknown" ||
    text.startsWith("relay returned malformed response:")
  ) {
    return { kind: "outcomeUnknown" };
  }
  if (text.startsWith("relay rejected event:")) {
    const reason = text.slice("relay rejected event:".length).trim();
    return reason.toLowerCase().startsWith("rate-limited:")
      ? rateLimited(reason)
      : { kind: "rejected" };
  }
  if (text.startsWith("relay rate-limited:")) return rateLimited(text);
  if (
    text === "relay unreachable: could not connect to relay" ||
    text === "relay unreachable: relay host not found"
  ) {
    // 连接没有建立，请求不可能到达 Relay
    return { kind: "notSent" };
  }
  if (text.startsWith("relay unreachable:")) {
    // 超时、中途断开、被代理拦截：请求可能已到达 Relay
    return { kind: "outcomeUnknown" };
  }
  const status = /^relay returned (\d{3})\b/.exec(text);
  if (status) {
    const code = Number(status[1]);
    if (code >= 400 && code < 500) return { kind: "rejected" };
    return { kind: "outcomeUnknown" };
  }
  return null;
}

// Relay 社区限制拒绝原文（buzz-relay `handlers/ingest.rs` 写入闸）。BFF 对 Web 把同一原文映射为
// PUBLISH_REJECTED 的结构化 restriction（DD-125(2)、PublishRestriction 合同，
// core/crates/collab-bridge/src/moderation.rs::restriction_from_rejection）；原生端本机直连 Relay，
// 由这里按同一规则映射，供共享禁言横幅（client-kit react/moderation/timeoutStore）消费。
const TIMEOUT_PREFIX = "restricted: you are timed out until";
const BANNED_PREFIX = "blocked: you are banned";

/**
 * 本人这次写入被 Relay 以社区限制确定拒绝时的结构化限制；其他失败（含结果不明）返回
 * undefined。前缀决定类别，时刻只尽力解析：解析不出也仍是禁言（不带 until）。
 */
export function publishRestrictionFromRelayFailure(
  error: unknown,
): PublishRestriction | undefined {
  if (classifyRelayPublishFailure(error)?.kind !== "rejected") return undefined;
  const text =
    error instanceof RelayPublishRejectedError
      ? error.relayMessage
      : (errorText(error) ?? "");
  const at = text.indexOf(TIMEOUT_PREFIX);
  if (at !== -1) {
    const digits = /^\s*(\d+)/.exec(text.slice(at + TIMEOUT_PREFIX.length))?.[1];
    const seconds = digits === undefined ? Number.NaN : Number(digits);
    // 8.64e12 s is the last instant a JS Date can represent.
    return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 8_640_000_000_000
      ? {
          kind: PublishRestrictionKind.TimedOut,
          until: new Date(seconds * 1000).toISOString(),
        }
      : { kind: PublishRestrictionKind.TimedOut };
  }
  return text.includes(BANNED_PREFIX)
    ? { kind: PublishRestrictionKind.Banned }
    : undefined;
}

/** 同一作者对同一内容的「未确认」事件的索引键。 */
export function unconfirmedFingerprint(
  scope: string,
  kind: number,
  content: string,
  tags: string[][],
): string {
  return JSON.stringify([scope, kind, content, tags]);
}
