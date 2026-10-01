// 邀请兑换页的 Web 外壳（DD-83）。页面本身是共用平台包里的 InvitationRedeemPage。
//
// 凭据的纪律：只从 URL fragment 读一次（fragment 不随请求发往网关或 BFF，也不进 Referer），
// 读完立即用 replaceState 清掉，之后只在组件内存里；不写日志、不进任何存储、不进请求 URL。
// 兑换时它只出现在 POST 的请求体里。

import { PlatformProvider } from "@client-kit/platform/react/context";
import { InvitationRedeemPage } from "@client-kit/platform/react/invitations";
import { useState } from "react";
import { bff } from "@/platform/bff-client";
import { getLocale } from "@/shared/i18n";

function takeCredential(): string | null {
  const credential = window.location.hash.slice(1);
  if (!credential) return null;
  window.history.replaceState(
    window.history.state,
    "",
    window.location.pathname + window.location.search,
  );
  return credential;
}

export function InvitePage() {
  const [credential] = useState(takeCredential);
  return (
    <PlatformProvider client={bff} locale={getLocale()}>
      <InvitationRedeemPage
        credential={credential}
        onContinue={() => window.location.assign(import.meta.env.BASE_URL)}
      />
    </PlatformProvider>
  );
}
