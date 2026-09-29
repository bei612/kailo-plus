// 平台页的宿主注入点：宿主给出 BFF 客户端（其传输决定了这是 Web 还是 Desktop）与
// 当前语言。页面只从这里取依赖，不 import 任一宿主的模块。

import { createContext, type ReactNode, useCallback, useContext } from "react";
import type { BffClient } from "../client";
import type { ReasonCode } from "@kailo/contracts";
import type { WriteFailure } from "../transport";
import {
  enumLabel,
  type PlatformLocale,
  type PlatformMessageKey,
  reasonMessages,
  resolveLocale,
  translate,
} from "../i18n";

type Platform = { client: BffClient; locale: PlatformLocale };

const PlatformContext = createContext<Platform | null>(null);

export function PlatformProvider({
  client,
  locale,
  children,
}: {
  client: BffClient;
  /** 缺省按浏览器/系统语言 */
  locale?: PlatformLocale;
  children: ReactNode;
}) {
  return (
    <PlatformContext.Provider value={{ client, locale: locale ?? resolveLocale() }}>
      {children}
    </PlatformContext.Provider>
  );
}

function usePlatform(): Platform {
  const platform = useContext(PlatformContext);
  if (!platform) throw new Error("平台页必须渲染在 PlatformProvider 之内");
  return platform;
}

export function useBffClient(): BffClient {
  return usePlatform().client;
}

export function useLocale(): PlatformLocale {
  return usePlatform().locale;
}

export type Translate = (
  key: PlatformMessageKey,
  variables?: Record<string, string | number>,
) => string;

export function useT(): Translate {
  const locale = useLocale();
  return useCallback((key, variables) => translate(locale, key, variables), [locale]);
}

/** reason code 的界面文案：说明加稳定 code，两者同时显示（apps/06 §4）。 */
export function useReasonText(): (code: ReasonCode) => string {
  const locale = useLocale();
  return useCallback(
    (code) =>
      translate(locale, "platform.reasonWithCode", {
        text: enumLabel(locale, reasonMessages, code),
        code,
      }),
    [locale],
  );
}

/** 确定被拒的写动作的说明：有 reason code 就用它，否则只有状态码或原话。 */
export function useFailureText(): (failure: WriteFailure & { kind: "rejected" }) => string {
  const reasonText = useReasonText();
  return useCallback(
    (failure) => (failure.reason ? reasonText(failure.reason) : failure.detail),
    [reasonText],
  );
}
