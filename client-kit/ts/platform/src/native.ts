// Desktop 端：经 Tauri 命令进入 Rust 侧的平台层（DD-75/78/79、ADR-09）。
//
// 令牌只在 Rust 侧：前端既看不到访问令牌也看不到刷新令牌，只能让 `platform_api` 代发
// `/api/v1/` 下的请求，拿回状态码与正文。设备私钥同样不出 Rust——持钥证明由
// `platform_register_device` 在那一侧签名。这里不直连 BFF：出现一个 fetch 就等于令牌
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

/** Rust 侧 `platform_api` 在需要重新登录时给出的错误（刷新令牌被拒、已注销）。 */
const NOT_SIGNED_IN = "PLATFORM_NOT_SIGNED_IN";

/**
 * 本机保存的部署事实（Rust 侧 `PlatformConfig`，应用配置目录的 `platform.json`）。它因
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
  /** 本机持有访问或刷新凭据；是否仍被接受，要到下一次调用才知道 */
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

type SessionObserver = {
  onSessionEnded: () => void;
  /** 引导流程的本机代际，不是身份或服务端授权事实。 */
  sessionGeneration?: () => number;
};

function sessionEndHandler(options: SessionObserver): () => void {
  const generation = options.sessionGeneration?.();
  return () => {
    if (options.sessionGeneration?.() === generation) options.onSessionEnded();
  };
}

export function createInvokeTransport(
  invoke: Invoke,
  options: SessionObserver,
): BffTransport {
  return {
    async send(request: BffRequest) {
      const onSessionEnded = sessionEndHandler(options);
      try {
        return toReply(
          await invoke("platform_api", {
            method: request.method,
            path: request.path,
            body: request.body ?? null,
          }),
        );
      } catch (e) {
        throw failure(e, onSessionEnded);
      }
    },
  };
}

/**
 * 注销的服务器侧结果（Tauri 进程内命令 `platform_sign_out` 的返回值，不属于 BFF 契约）。
 * 命令成功返回时本机凭据已清除；两项都为 true 才算服务器确认了登录已结束。
 */
export type NativeSignOutReport = {
  /** Core 的 `POST /api/v1/logout` 返回 200，且 revoked 为布尔值（含幂等 false） */
  coreSessionRevoked: boolean;
  /** IdP 的 RFC 7009 令牌撤销返回 200 */
  refreshTokenRevoked: boolean;
};

/** fail closed：返回值不是对象、或任一字段不是布尔值，一律按服务器未确认处理。 */
export function signOutReport(value: unknown): NativeSignOutReport {
  const report = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    coreSessionRevoked: report.coreSessionRevoked === true,
    refreshTokenRevoked: report.refreshTokenRevoked === true,
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
  /** 丢弃本机令牌，并撤销 Core 的 PlatformSession 与 IdP 刷新令牌；返回服务器侧结果 */
  signOut(): Promise<NativeSignOutReport>;
  /** 以本机设备私钥签持钥证明并提交登记；回应原样给出 */
  registerDevice(): Promise<BffReply>;
};

export function createNativeHost(
  invoke: Invoke,
  options: SessionObserver,
): NativeHost {
  const run = async <T>(command: string, args?: Record<string, unknown>) => {
    const onSessionEnded = sessionEndHandler(options);
    try {
      return (await invoke(command, args)) as T;
    } catch (e) {
      throw failure(e, onSessionEnded);
    }
  };
  return {
    getConfig: () => run<NativeConfig | null>("platform_get_config"),
    setConfig: (config) => run<void>("platform_set_config", { config }),
    status: () => run<NativeStatus>("platform_status"),
    signIn: () => run<void>("platform_sign_in"),
    cancelSignIn: () => run<void>("platform_cancel_sign_in"),
    signOut: async () => signOutReport(await run<unknown>("platform_sign_out")),
    registerDevice: async () => toReply(await run<ApiResponse>("platform_register_device")),
  };
}
