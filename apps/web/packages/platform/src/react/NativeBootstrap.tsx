// 原生端（Desktop）进入 Kailo 的引导（DD-75/78/79）。
//
// 未配置 → 填写部署事实（原生入口、IdP issuer、client id；不预填、不猜）→ 以系统
// 浏览器登录（可取消）→ 以本机设备私钥登记公钥，等到 ACTIVE → 取 Community 连接
// 事实 → 交给宿主连 Relay。每一步都只有三种结论：确定成功、确定被拒、结果不明；
// 结果不明永远不渲染成成功或失败，只给出「重新确认」。
//
// 令牌与私钥都不经过这里：命令由 Rust 侧执行（native.ts）。

import {
  BuzzIdentityState,
  type ClientKeyStatus,
  type NativeCommunityFacts,
  ReasonCode,
} from "@kailo/contracts";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type BffClient, createBffClient } from "../client";
import type { PlatformLocale } from "../i18n";
import {
  createInvokeTransport,
  createNativeHost,
  type Invoke,
  type NativeConfig,
} from "../native";
import { BffError, isOutcomeUnknown, SessionEndedError, unwrap } from "../transport";
import { PlatformProvider, type Translate, useT } from "./context";
import { Button, Notice } from "./ui";

/** 引导完成后交给宿主的事实。 */
export type NativeSession = {
  facts: NativeCommunityFacts;
  /** 本机设备公钥（hex），取自登记回应 */
  devicePubkey: string;
  client: BffClient;
  /** 注销：撤销平台会话并丢弃本机令牌，回到登录 */
  signOut: () => Promise<void>;
};

type Step =
  | { kind: "loading" }
  | { kind: "loadFailed"; message: string }
  | { kind: "config"; initial: NativeConfig | null; rejected?: string }
  | { kind: "signIn"; failed?: string }
  | { kind: "signingIn" }
  | { kind: "registering" }
  | { kind: "devicePending"; pubkey: string; state: string }
  | { kind: "deviceUnknown"; operationId?: string }
  | { kind: "deviceRejected"; reason: string; revoked: boolean }
  | { kind: "community"; pubkey: string }
  | { kind: "communityFailed"; pubkey: string; reason?: string }
  | { kind: "connecting"; pubkey: string; facts: NativeCommunityFacts }
  | { kind: "connectFailed"; pubkey: string; facts: NativeCommunityFacts; message: string }
  | { kind: "ready"; pubkey: string; facts: NativeCommunityFacts };

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function NativeBootstrap({
  invoke,
  connect,
  recheckEveryMs,
  locale,
  children,
}: {
  invoke: Invoke;
  /** 用连接事实连 Relay（宿主既有的连接路径）；失败以 reject 表示 */
  connect: (facts: NativeCommunityFacts) => Promise<void>;
  /** 设备投影进行中时重新确认的间隔；只决定刷新节奏，不构成期限 */
  recheckEveryMs: number;
  locale?: PlatformLocale;
  children: (session: NativeSession) => ReactNode;
}) {
  const [step, setStep] = useState<Step>({ kind: "loading" });
  // 登录被取消后，那次 signIn 的 reject 不是失败，不显示
  const cancelled = useRef(false);
  // 宿主每次渲染都可能给出新的 connect；引导流程不因此重来
  const connectRef = useRef(connect);
  connectRef.current = connect;

  const onSessionEnded = useCallback(() => setStep({ kind: "signIn" }), []);
  const { host, client } = useMemo(() => {
    const options = { onSessionEnded };
    return {
      host: createNativeHost(invoke, options),
      client: createBffClient(createInvokeTransport(invoke, options)),
    };
  }, [invoke, onSessionEnded]);

  const fetchCommunity = useCallback(
    async (pubkey: string) => {
      setStep({ kind: "community", pubkey });
      let facts: NativeCommunityFacts;
      try {
        facts = await client.nativeCommunity();
      } catch (e) {
        if (e instanceof SessionEndedError) return;
        setStep({
          kind: "communityFailed",
          pubkey,
          reason: e instanceof BffError ? (e.reason ?? String(e.status)) : undefined,
        });
        return;
      }
      setStep({ kind: "connecting", pubkey, facts });
      try {
        await connectRef.current(facts);
        setStep({ kind: "ready", pubkey, facts });
      } catch (e) {
        setStep({ kind: "connectFailed", pubkey, facts, message: message(e) });
      }
    },
    [client],
  );

  const register = useCallback(async () => {
    setStep({ kind: "registering" });
    let status: ClientKeyStatus;
    try {
      status = unwrap<ClientKeyStatus>(
        { method: "POST", path: "/api/v1/identity/client-keys" },
        await host.registerDevice(),
      );
    } catch (e) {
      if (e instanceof SessionEndedError) return;
      if (isOutcomeUnknown(e)) {
        setStep({
          kind: "deviceUnknown",
          operationId: e instanceof BffError ? e.operationId : undefined,
        });
        return;
      }
      const reason = e instanceof BffError ? (e.reason ?? String(e.status)) : message(e);
      setStep({
        kind: "deviceRejected",
        reason,
        // 已撤销的公钥再次登记：撤销的身份不复活（native-identity.md）
        revoked: e instanceof BffError && e.reason === ReasonCode.ClientKeyAlreadyBound,
      });
      return;
    }
    if (status.state === BuzzIdentityState.Active) {
      await fetchCommunity(status.pubkey);
    } else if (
      status.state === BuzzIdentityState.Revoked ||
      status.state === BuzzIdentityState.Revoking
    ) {
      setStep({ kind: "deviceRejected", reason: status.state, revoked: true });
    } else {
      setStep({ kind: "devicePending", pubkey: status.pubkey, state: status.state });
    }
  }, [host, fetchCommunity]);

  // 投影进行中：按列表确认本机公钥的状态，直到 ACTIVE。读不到不是失败，下一轮再读。
  const recheck = useCallback(
    async (pubkey: string) => {
      try {
        const keys = await client.clientKeys();
        const mine = keys.find((k) => k.pubkey === pubkey);
        if (mine?.state === BuzzIdentityState.Active) await fetchCommunity(pubkey);
        else if (mine?.state === BuzzIdentityState.Revoking)
          setStep({ kind: "deviceRejected", reason: mine.state, revoked: true });
        else if (mine) setStep({ kind: "devicePending", pubkey, state: mine.state });
      } catch (e) {
        // 读不到只说明这一轮没有答案：保持「处理中」，下一轮再读
        if (!(e instanceof SessionEndedError))
          setStep((s) => (s.kind === "devicePending" ? { ...s } : s));
      }
    },
    [client, fetchCommunity],
  );

  const start = useCallback(async () => {
    setStep({ kind: "loading" });
    try {
      const [config, status] = await Promise.all([host.getConfig(), host.status()]);
      if (!config) setStep({ kind: "config", initial: null });
      else if (!status.signedIn) setStep({ kind: "signIn" });
      else await register();
    } catch (e) {
      setStep({ kind: "loadFailed", message: message(e) });
    }
  }, [host, register]);

  useEffect(() => {
    void start();
  }, [start]);

  useEffect(() => {
    if (step.kind !== "devicePending") return;
    const timer = setTimeout(() => void recheck(step.pubkey), recheckEveryMs);
    return () => clearTimeout(timer);
  }, [step, recheck, recheckEveryMs]);

  const signIn = async () => {
    cancelled.current = false;
    setStep({ kind: "signingIn" });
    try {
      await host.signIn();
    } catch (e) {
      setStep(cancelled.current ? { kind: "signIn" } : { kind: "signIn", failed: message(e) });
      return;
    }
    await register();
  };

  const cancelSignIn = async () => {
    cancelled.current = true;
    await host.cancelSignIn();
  };

  const signOut = useCallback(async () => {
    try {
      await host.signOut();
    } catch (e) {
      // 本机令牌没能丢弃：不能显示成已退出
      setStep({ kind: "loadFailed", message: message(e) });
      return;
    }
    setStep({ kind: "signIn" });
  }, [host]);

  const saveConfig = async (config: NativeConfig) => {
    try {
      await host.setConfig(config);
    } catch (e) {
      setStep({ kind: "config", initial: config, rejected: message(e) });
      return;
    }
    const status = await host.status().catch(() => null);
    if (status?.signedIn) await register();
    else setStep({ kind: "signIn" });
  };

  const editConfig = async () => {
    const initial = await host.getConfig().catch(() => null);
    setStep({ kind: "config", initial });
  };

  // 同一次连接只给出同一个会话对象：宿主可以放心以它为依赖
  const ready = step.kind === "ready" ? step : null;
  const session = useMemo<NativeSession | null>(
    () => (ready ? { facts: ready.facts, devicePubkey: ready.pubkey, client, signOut } : null),
    [ready, client, signOut],
  );

  return (
    <PlatformProvider client={client} locale={locale}>
      {session ? (
        children(session)
      ) : (
        <Screen>
          <StepView
            step={step}
            actions={{
              retryLoad: () => void start(),
              saveConfig,
              editConfig: () => void editConfig(),
              signIn: () => void signIn(),
              cancelSignIn: () => void cancelSignIn(),
              signOut: () => void signOut(),
              register: () => void register(),
              recheck,
              fetchCommunity: (pubkey) => void fetchCommunity(pubkey),
            }}
          />
        </Screen>
      )}
    </PlatformProvider>
  );
}

type Actions = {
  retryLoad: () => void;
  saveConfig: (config: NativeConfig) => Promise<void>;
  editConfig: () => void;
  signIn: () => void;
  cancelSignIn: () => void;
  signOut: () => void;
  register: () => void;
  recheck: (pubkey: string) => Promise<void>;
  fetchCommunity: (pubkey: string) => void;
};

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
      <div className="flex w-full max-w-md flex-col gap-4" data-testid="kailo-bootstrap">
        {children}
      </div>
    </div>
  );
}

function Title({ children }: { children: ReactNode }) {
  return <h1 className="text-lg font-semibold">{children}</h1>;
}

function Detail({ children, alert }: { children: ReactNode; alert?: boolean }) {
  return (
    <p className={`text-sm ${alert ? "text-destructive" : "text-muted-foreground"}`} role={alert ? "alert" : undefined}>
      {children}
    </p>
  );
}

function StepView({ step, actions }: { step: Step; actions: Actions }) {
  const t = useT();
  switch (step.kind) {
    case "loading":
    case "ready":
      return <Notice role="status">{t("platform.loading")}</Notice>;
    case "loadFailed":
      return (
        <>
          <Detail alert>{step.message}</Detail>
          <Button onClick={actions.retryLoad}>{t("platform.retry")}</Button>
        </>
      );
    case "config":
      return <ConfigForm initial={step.initial} rejected={step.rejected} onSave={actions.saveConfig} />;
    case "signIn":
      return (
        <>
          <Title>{t("native.signIn.title")}</Title>
          <Detail>{t("native.signIn.explain")}</Detail>
          {step.failed ? <Detail alert>{t("native.signIn.failed", { message: step.failed })}</Detail> : null}
          <Button onClick={actions.signIn}>{t("native.signIn.start")}</Button>
          <Button onClick={actions.editConfig}>{t("native.config.edit")}</Button>
        </>
      );
    case "signingIn":
      return (
        <>
          <Title>{t("native.signIn.title")}</Title>
          <Detail>{t("native.signIn.waiting")}</Detail>
          <Button onClick={actions.cancelSignIn}>{t("native.signIn.cancel")}</Button>
        </>
      );
    case "registering":
      return <Notice role="status">{t("native.device.registering")}</Notice>;
    case "devicePending":
      return (
        <>
          <Detail>{t("native.device.pending", { state: step.state })}</Detail>
          <Button onClick={() => void actions.recheck(step.pubkey)}>{t("native.device.check")}</Button>
        </>
      );
    case "deviceUnknown":
      return (
        <>
          <Detail>
            {t("native.device.unknown", {
              operation: step.operationId ? ` (${step.operationId})` : "",
            })}
          </Detail>
          {/* 登记是幂等的：同一设备重复登记只会回答它现在的状态 */}
          <Button onClick={actions.register}>{t("native.device.check")}</Button>
        </>
      );
    case "deviceRejected":
      return (
        <>
          <Detail alert>
            {step.revoked
              ? t("native.device.revoked")
              : t("native.device.rejected", { reason: step.reason })}
          </Detail>
          <Button onClick={actions.signOut}>{t("platform.signOut")}</Button>
        </>
      );
    case "community":
    case "connecting":
      return <Notice role="status">{t("native.community.loading")}</Notice>;
    case "communityFailed":
      return (
        <>
          <Detail alert>
            {t("native.community.failed", { reason: step.reason ? ` (${step.reason})` : "" })}
          </Detail>
          <Button onClick={() => actions.fetchCommunity(step.pubkey)}>{t("platform.retry")}</Button>
          <Button onClick={actions.signOut}>{t("platform.signOut")}</Button>
        </>
      );
    case "connectFailed":
      return (
        <>
          <Detail alert>{t("native.connect.failed", { message: step.message })}</Detail>
          <Button onClick={() => actions.fetchCommunity(step.pubkey)}>{t("platform.retry")}</Button>
          <Button onClick={actions.signOut}>{t("platform.signOut")}</Button>
        </>
      );
  }
}

const fields = [
  ["nativeApiUrl", "native.config.nativeApiUrl", "url"],
  ["oidcIssuer", "native.config.oidcIssuer", "url"],
  ["oidcClientId", "native.config.oidcClientId", "text"],
] as const;

function ConfigForm({
  initial,
  rejected,
  onSave,
}: {
  initial: NativeConfig | null;
  rejected?: string;
  onSave: (config: NativeConfig) => Promise<void>;
}) {
  const t: Translate = useT();
  const [values, setValues] = useState<NativeConfig>(
    initial ?? { nativeApiUrl: "", oidcIssuer: "", oidcClientId: "" },
  );
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onSave({
      nativeApiUrl: values.nativeApiUrl.trim(),
      oidcIssuer: values.oidcIssuer.trim(),
      oidcClientId: values.oidcClientId.trim(),
    });
    setSaving(false);
  };
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
      <Title>{t("native.config.title")}</Title>
      <Detail>{t("native.config.explain")}</Detail>
      {fields.map(([name, label, type]) => (
        <label key={name} className="flex flex-col gap-1 text-sm">
          <span>{t(label)}</span>
          <input
            className="h-9 rounded-md border border-input bg-transparent px-2"
            name={name}
            required
            type={type}
            value={values[name]}
            onChange={(e) => setValues({ ...values, [name]: e.target.value })}
          />
        </label>
      ))}
      {rejected ? <Detail alert>{t("native.config.rejected", { message: rejected })}</Detail> : null}
      <Button disabled={saving} type="submit">
        {saving ? t("native.config.saving") : t("native.config.save")}
      </Button>
    </form>
  );
}
