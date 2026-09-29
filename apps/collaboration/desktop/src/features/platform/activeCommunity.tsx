// 本次登录所连的 Community（Kailo DD-75）。
//
// 桌面端只连一个 Community：它由 Kailo 按登录者所在的 Tenant 给出（`GET
// /api/v1/native/community`），不由用户添加、切换或离开。连接事实与会话只在引导
// 完成后存在，因此这里的值在 Provider 之内总是确定的。
import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { NativeSession } from "@client-kit/platform/react/NativeBootstrap";

export type Community = {
  /** Community host（Relay 按连接的 Host 绑定 Community） */
  id: string;
  name: string;
  relayUrl: string;
};

type ActiveCommunity = { community: Community; session: NativeSession };

const ActiveCommunityContext = createContext<ActiveCommunity | null>(null);

function communityFromSession(session: NativeSession): Community {
  return {
    id: session.facts.communityHost,
    name: session.facts.communityHost,
    relayUrl: session.facts.relayUrl,
  };
}

export function ActiveCommunityProvider({
  session,
  children,
}: {
  session: NativeSession;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ community: communityFromSession(session), session }),
    [session],
  );
  return (
    <ActiveCommunityContext.Provider value={value}>
      {children}
    </ActiveCommunityContext.Provider>
  );
}

function useActive(): ActiveCommunity {
  const value = useContext(ActiveCommunityContext);
  if (!value) {
    throw new Error("useActiveCommunity must be used within the Kailo session");
  }
  return value;
}

export function useActiveCommunity(): Community {
  return useActive().community;
}

export function useKailoSession(): NativeSession {
  return useActive().session;
}
