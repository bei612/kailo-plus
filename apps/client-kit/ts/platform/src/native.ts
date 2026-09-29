// Desktop 端：经 Tauri 命令进入 Rust 侧的 Kailo 层（DD-75/78/79、ADR-09）。
//
// 令牌只在 Rust 侧：前端既看不到访问令牌也看不到刷新令牌，只能让 `kailo_api` 代发
// `/api/v1/` 下的请求，拿回状态码与正文。设备私钥同样不出 Rust——持钥证明由
// `kailo_register_device` 在那一侧签名。这里不直连 BFF：出现一个 fetch 就等于令牌
// 必须交到前端手里。
//
// 本模块不依赖 `@tauri-apps/api`：宿主把自己的 `invoke` 传进来，命令名与参数只在
// 这里写一次。

import {
  type BffReply,
  type BffRequest,
  type BffTransport,
  SessionEndedError,
  TransportError,
} from "./transport";

export type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

/** Rust 侧 `kailo_api` 在需要重新登录时给出的错误（刷新令牌被拒、已注销）。 */
const NOT_SIGNED_IN = "KAILO_NOT_SIGNED_IN";

/**
 * 本机保存的部署事实（Rust 侧 `KailoConfig`，应用配置目录的 `kailo.json`）。它因
 * 部署而异，由用户填写或管理员预置；缺任一项即未配置，不回退到任何默认地址。
 */
export type NativeConfig = {
  /** 网关原生入口的根地址 */
  nativeApiUrl: string;
  /** IdP 的 issuer */
  oidcIssuer: string;
  /** 在 IdP 登记的原生端公开客户端 */
  oidcClientId: string;
};

export type NativeStatus = {
  configured: boolean;
  /** 本机存有刷新令牌；它是否仍被 IdP 接受，要到下一次调用才知道 */
  signedIn: boolean;
};

/** Rust 侧 `ApiResponse`：没有正文时为 null。 */
type ApiResponse = { status: number; body: unknown };

function toReply(raw: unknown): BffReply {
  const r = raw as ApiResponse;
  return { status: r.status, body: r.body ?? undefined };
}

/**
 * 命令失败的解读：需要重新登录的交给宿主；其余都是没有得到 BFF 回应（服务不可达、
 * 本机配置缺失等），对写动作而言结果不明。
 */
function failure(error: unknown, onSessionEnded: () => void): Error {
  if (error === NOT_SIGNED_IN) {
    onSessionEnded();
    return new SessionEndedError();
  }
  return new TransportError(typeof error === "string" ? error : String(error));
}

export function createInvokeTransport(
  invoke: Invoke,
  options: { onSessionEnded: () => void },
): BffTransport {
  return {
    async send(request: BffRequest) {
      try {
        return toReply(
          await invoke("kailo_api", {
            method: request.method,
            path: request.path,
            body: request.body ?? null,
          }),
        );
      } catch (e) {
        throw failure(e, options.onSessionEnded);
      }
    },
  };
}

/** 登录引导用到的全部原生命令。 */
export type NativeHost = {
  getConfig(): Promise<NativeConfig | null>;
  /** Rust 侧校验；不合法时以说明原因的消息拒绝 */
  setConfig(config: NativeConfig): Promise<void>;
  status(): Promise<NativeStatus>;
  /** RFC 8252：打开系统浏览器并等待回环回调；可被 cancelSignIn 取消 */
  signIn(): Promise<void>;
  cancelSignIn(): Promise<void>;
  /** 先撤销 Core 的 PlatformSession，再丢弃本机令牌 */
  signOut(): Promise<void>;
  /** 以本机设备私钥签持钥证明并提交登记；回应原样给出 */
  registerDevice(): Promise<BffReply>;
};

export function createNativeHost(
  invoke: Invoke,
  options: { onSessionEnded: () => void },
): NativeHost {
  const run = async <T>(command: string, args?: Record<string, unknown>) => {
    try {
      return (await invoke(command, args)) as T;
    } catch (e) {
      throw failure(e, options.onSessionEnded);
    }
  };
  return {
    getConfig: () => run<NativeConfig | null>("kailo_get_config"),
    setConfig: (config) => run<void>("kailo_set_config", { config }),
    status: () => run<NativeStatus>("kailo_status"),
    signIn: () => run<void>("kailo_sign_in"),
    cancelSignIn: () => run<void>("kailo_cancel_sign_in"),
    signOut: () => run<void>("kailo_sign_out"),
    registerDevice: async () => toReply(await run<ApiResponse>("kailo_register_device")),
  };
}
