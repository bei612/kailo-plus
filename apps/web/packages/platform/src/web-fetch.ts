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
};

export type FetchTransportOptions = {
  /**
   * 网关会话已不在。浏览器只能经一次顶层导航重新登录：fetch 跟随到 IdP 的重定向
   * 只会得到一个看不出原因的 CORS 错误。
   */
  onSessionEnded: () => void;
  /** 测试替身用；缺省即全局 fetch。 */
  fetch?: typeof fetch;
};

export function createFetchTransport(options: FetchTransportOptions): FetchTransport {
  const exchange = async (path: string, init: RequestInit): Promise<BffReply> => {
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

  return {
    exchange,
    send: (request: BffRequest) =>
      exchange(request.path, {
        method: request.method,
        ...(request.body === undefined
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(request.body),
            }),
      }),
  };
}
