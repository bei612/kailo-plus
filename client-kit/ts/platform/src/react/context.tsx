// 平台页的宿主注入点：宿主给出 BFF 客户端（其传输决定了这是 Web 还是 Desktop）与
// 当前语言。页面只从这里取依赖，不 import 任一宿主的模块。

import { createContext, Fragment, type ReactNode, useCallback, useContext, useState, useSyncExternalStore } from "react";
import type { BffClient } from "../client";
import type { ReasonCode } from "@client-kit/contracts";
import type { WriteFailure } from "../transport";
import {
  type PlatformLocale,
  type PlatformMessageKey,
  reasonMessages,
  getLocale,
  subscribeLocale,
  defaultPlatformLocale,
  translate,
} from "../i18n";

type Platform = { client: BffClient; locale: PlatformLocale; authenticateNativePage?: (bindingId: string) => Promise<void>; reauthenticateTopLevel?: () => void; documentTheme?: "LIGHT" | "DARK"; currentPrincipalId?: string; copyText?: (text: string) => Promise<void>; openExternalUrl?: (url: string) => void };

const PlatformContext = createContext<Platform | null>(null);

export function PlatformProvider({
  client,
  locale,
  children,
  authenticateNativePage,
  reauthenticateTopLevel,
  documentTheme,
  currentPrincipalId,
  copyText,
  openExternalUrl,
}: {
  client: BffClient;
  /** Device preference; absent preference defaults to Chinese. */
  locale?: PlatformLocale;
  children: ReactNode;
  authenticateNativePage?: (bindingId: string) => Promise<void>;
  /**
   * DD-133: an embedded component lost its silent IdP session. The host signs
   * the user in again at the top level and returns to the current route.
   */
  reauthenticateTopLevel?: () => void;
  /** Only the Web host opts in. Desktop GAP-DSK-EDITOR-01 and Mobile stay closed. */
  documentTheme?: "LIGHT" | "DARK";
  /** Authenticated BFF session fact; never inferred from a display key. */
  currentPrincipalId?: string;
  /** Native uses its original system clipboard; Web retains browser policy. */
  copyText?: (text: string) => Promise<void>;
  /**
   * DD-149(6): opens a third-party authorization page. Desktop hands it to the system browser;
   * absent, the Web default opens a popup without an opener reference.
   */
  openExternalUrl?: (url: string) => void;
}) {
  const deviceLocale = useDeviceLocale();
  // A replacement client is a new authenticated transport scope. Reset its
  // consumers together: read snapshots, frozen writes and late receipts must
  // never migrate to another identity. Locale changes preserve the same scope.
  const [scope, setScope] = useState({ client, currentPrincipalId, generation: 0 });
  if (scope.client !== client || scope.currentPrincipalId !== currentPrincipalId)
    setScope({ client, currentPrincipalId, generation: scope.generation + 1 });
  return (
    <PlatformContext.Provider value={{ client, locale: locale ?? deviceLocale, authenticateNativePage, reauthenticateTopLevel, documentTheme, currentPrincipalId, copyText, openExternalUrl }}>
      <Fragment key={scope.generation}>{children}</Fragment>
    </PlatformContext.Provider>
  );
}

export function useDeviceLocale(): PlatformLocale {
  return useSyncExternalStore(subscribeLocale, getLocale, () => defaultPlatformLocale);
}

function usePlatform(): Platform {
  const platform = useContext(PlatformContext);
  if (!platform) throw new Error("平台页必须渲染在 PlatformProvider 之内");
  return platform;
}

export function useBffClient(): BffClient {
  return usePlatform().client;
}

/** The platform client when this tree has one; shared surfaces that also render without a session use it. */
export function useOptionalBffClient(): BffClient | null {
  return useContext(PlatformContext)?.client ?? null;
}

/** Whether this tree has a platform session; shared surfaces omit platform-only actions without one. */
export function useHasPlatform(): boolean {
  return useContext(PlatformContext) !== null;
}

export function useNativeAuthenticationHost() { return usePlatform().authenticateNativePage; }

export function useTopLevelReauthentication() { return usePlatform().reauthenticateTopLevel; }

export function useDocumentTheme() { return usePlatform().documentTheme; }

export function useCurrentPrincipalId() { return usePlatform().currentPrincipalId; }

export function useClipboardWrite() {
  const { copyText } = usePlatform();
  return useCallback((text: string) => copyText ? copyText(text) : navigator.clipboard.writeText(text), [copyText]);
}

/** DD-149(6): the host's external-page opener (Web popup by default). */
export function useOpenExternalUrl() {
  const { openExternalUrl } = usePlatform();
  return useCallback((url: string) => {
    if (openExternalUrl) openExternalUrl(url);
    else window.open(url, "_blank", "popup,noopener,noreferrer");
  }, [openExternalUrl]);
}

export function useLocale(): PlatformLocale {
  return usePlatform().locale;
}

export type Translate = (
  key: PlatformMessageKey,
  variables?: Record<string, string | number>,
) => string;

/** Original Buzz primitives also render outside management pages. */
export function useUiLocale(): PlatformLocale {
  const platform = useContext(PlatformContext);
  const deviceLocale = useDeviceLocale();
  return platform?.locale ?? deviceLocale;
}

export function useUiT(): Translate {
  const locale = useUiLocale();
  return useCallback((key, variables) => translate(locale, key, variables), [locale]);
}

export function useT(): Translate {
  const locale = useLocale();
  return useCallback((key, variables) => translate(locale, key, variables), [locale]);
}

/**
 * reason code 的界面文案：正文只显示本地化说明，原因码不进入可见文本（apps/06 §4）；
 * 没有映射的码显示通用说明，不回退为原始码。排障用的码由调用方放在 data-reason-code 上。
 */
function reasonTextFor(locale: PlatformLocale, code: ReasonCode | string): string {
  const message = (reasonMessages as Readonly<Record<string, { readonly en: string; readonly "zh-CN": string } | undefined>>)[code];
  return message?.[locale] ?? translate(locale, "platform.reasonUnknown");
}

export function useReasonText(): (code: ReasonCode) => string {
  const locale = useLocale();
  return useCallback((code) => reasonTextFor(locale, code), [locale]);
}

/** 确定被拒的写动作的说明：有 reason code 就用它，否则只有状态码或原话。 */
export function useFailureText(): (failure: WriteFailure & { kind: "rejected" }) => string {
  const reasonText = useReasonText();
  return useCallback(
    (failure) => (failure.reason ? reasonText(failure.reason) : failure.detail),
    [reasonText],
  );
}
