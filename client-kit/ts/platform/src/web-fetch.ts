// Web 端传输：同源 fetch，会话由网关 cookie 承载（DD-39、SS-WEB-RELAY）。
//
// 页面由同一个网关入口提供，BFF 在其后，因此这里不配置任何主机名——出现一个可
// 配置的 API 地址，就等于给「连到别处去」留了口子。浏览器侧不持有任何令牌。

import {
  type BffReply,
  type BffRequest,
  type BffTransport,
  SessionEndedError,
  TransportError,
} from "./transport";

export type FetchTransport = BffTransport & {
  /**
   * 以任意 fetch 选项发一次请求，回应按同一规则解读。只有 Web 需要的请求（二进制
   * 媒体上传、带 Idempotency-Key 的发布）经它发出；它们在 Desktop 上不经 BFF。
   */
  exchange(path: string, init: RequestInit): Promise<BffReply>;
  /** 丢弃所有共享读取（收到流事件、流中断或任何写入时）。 */
  invalidateReads(): void;
};

/** Read-only POST queries: they neither write nor invalidate shared reads. */
const READ_POSTS = /^\/api\/v1\/(?:(?:workspaces|conversations)\/[^/]+\/messages\/author-profiles|workspace-activity|inbox\/mentions|search\/messages|projects\/query|reminders\/source|pulse\/query)$/;

/** Cold-start settle window: the shell, sidebars, Inbox and panes read these within ~0.4 s. */
export const SETTLED_READ_MS = 2_000;

/** Identity/directory reads and first message windows that several mounts read back to back.
 * Paged or anchored message reads (any query string) are never shared. */
export function isSettledRead(path: string): boolean {
  return /^\/api\/v1\/(?:session|conversations|conversation-participants|application-bindings)(?:\?|$)/.test(path)
    || /^\/api\/v1\/(?:conversations|workspaces)\/[^/?]+\/messages$/.test(path);
}

export type FetchTransportOptions = {
  /**
   * 网关会话已不在。浏览器只能经一次顶层导航重新登录：fetch 跟随到 IdP 的重定向
   * 只会得到一个看不出原因的 CORS 错误。
   */
  onSessionEnded: () => void;
  /** 测试替身用；缺省即全局 fetch。 */
  fetch?: typeof fetch;
  /** A successful read of a `settled` path answers identical reads for this many ms, unless a
   * write, stream frame or interruption invalidated it first. Omitted: only in-flight sharing. */
  settleMs?: number;
  settled?: (path: string) => boolean;
};

export function createFetchTransport(options: FetchTransportOptions): FetchTransport {
  // Same-session read coalescing: concurrent identical GETs (the shell, sidebar, Inbox and
  // panes all read user-state/profile/session on mount) share one network read, and each
  // caller gets its own copy of the body. Any write clears the table first, so a read issued
  // after a write is never answered by a request that started before it.
  // A settled path additionally keeps its successful answer for `settleMs`: the original
  // client serves these from its query cache and live subscription; here any write, stream
  // frame or interruption drops them, so a shared answer is never older than the last change
  // this page could have observed.
  const reads = new Map<string, Promise<BffReply>>();
  const settledReads = new Map<string, { at: number; reply: BffReply }>();
  let generation = 0;
  const invalidateReads = () => { generation += 1; reads.clear(); settledReads.clear(); };
  const copy = (reply: BffReply): BffReply =>
    ({ status: reply.status, body: reply.body === undefined ? undefined : structuredClone(reply.body) });
  const coalesced = async (path: string, init: RequestInit, fresh = false): Promise<BffReply> => {
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET" || init.body !== undefined) {
      if (!(method === "POST" && READ_POSTS.test(path))) invalidateReads();
      return send(path, init);
    }
    const settle = options.settleMs !== undefined && options.settleMs > 0 && options.settled?.(path) === true;
    const hit = settle && !fresh ? settledReads.get(path) : undefined;
    if (hit && Date.now() - hit.at < options.settleMs!) return copy(hit.reply);
    // A fresh read is a security re-check: it neither joins an in-flight read nor answers others.
    let read = fresh ? undefined : reads.get(path);
    if (!read) {
      read = send(path, init);
      const current = read, started = generation, at = Date.now();
      if (!fresh) reads.set(path, current);
      void current.then((reply) => {
        if (settle && !fresh && started === generation && reply.status >= 200 && reply.status < 300) settledReads.set(path, { at, reply });
      }, () => undefined).finally(() => { if (reads.get(path) === current) reads.delete(path); });
    }
    return copy(await read);
  };
  const send = async (path: string, init: RequestInit): Promise<BffReply> => {
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(path, {
        ...init,
        // 会话由网关 cookie 承载，必须随请求发出
        credentials: "same-origin",
        redirect: "manual",
      });
    } catch (e) {
      throw new TransportError(`${init.method ?? "GET"} ${path}：${String(e)}`);
    }
    // 两种信号都要认：HTTPS 下网关按 Sec-Fetch-Mode 识别出 fetch，回 401；明文 HTTP
    // 下浏览器不发 Fetch Metadata，网关把请求当成导航，回 302 去 IdP，在
    // `redirect: "manual"` 下表现为 opaqueredirect。
    if (response.type === "opaqueredirect" || response.status === 401) {
      options.onSessionEnded();
      throw new SessionEndedError();
    }
    // 错误体只有分类、reason code 与 operationId；取不到就当没有
    const body =
      response.status === 204 ? undefined : await response.json().catch(() => undefined);
    return { status: response.status, body };
  };

  const exchange = coalesced;
  return {
    exchange,
    invalidateReads,
    send: (request: BffRequest) =>
      coalesced(request.path, {
        method: request.method,
        ...(request.body === undefined
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(request.body),
            }),
      }, request.fresh === true),
  };
}
