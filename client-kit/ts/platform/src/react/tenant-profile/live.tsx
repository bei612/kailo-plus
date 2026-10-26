// DD-158 / V-SCN-261: the existing BFF profile read also supports a bounded
// afterVersion watch. Hints carry no profile data; every answer is re-admitted.
import { createContext, type ReactNode, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { PlatformSessionView, TenantProfileView } from "@client-kit/contracts";
import type { BffClient } from "../../client";
import { BffError, SessionEndedError, TransportError, rateLimitRetryMs } from "../../transport";
import { useDocumentVisible } from "../projects/useProjectAppFocus";

export const TenantDisplayProfileContext = createContext<TenantProfileView | undefined>(undefined);

/** One active read per consumer; disposed identities cannot accept late answers. */
export function watchTenantProfile(client: BffClient, receive: (profile: TenantProfileView) => void) {
  let disposed = false, reading = false;
  let version: number | undefined, retryMillis: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = async () => {
    if (disposed || reading) return;
    reading = true;
    try {
      const profile = await client.tenantProfile(version);
      if (disposed) return;
      if (!profile || typeof profile.name !== "string" || !profile.name.trim()
        || !Number.isSafeInteger(profile.version) || profile.version < 1
        || (profile.icon !== undefined && typeof profile.icon !== "string")
        || (version !== undefined && profile.version < version)) throw new TransportError("Invalid Tenant profile");
      const retry = profile.refreshAfterMillis;
      if (retry !== undefined && (!Number.isSafeInteger(retry) || retry < 1 || retry > 0x7fffffff))
        throw new TransportError("Invalid Tenant profile watch interval");
      // Older Core versions have no watch capability. Keep their snapshot and
      // wait for an explicit foreground/online refresh, without inventing a poll.
      retryMillis = Number.isSafeInteger(retry) && retry! > 0 && retry! <= 0x7fffffff ? retry : undefined;
      if (version !== profile.version) receive(profile);
      version = profile.version;
      if (retryMillis !== undefined) timer = setTimeout(() => void read(), 0);
    } catch (error) {
      if (disposed || error instanceof SessionEndedError
        || (error instanceof BffError && [401, 403].includes(error.status))) return;
      const wait = rateLimitRetryMs(error) ?? retryMillis;
      if (wait !== undefined) timer = setTimeout(() => void read(), wait);
    } finally { reading = false; }
  };
  const online = () => { if (!reading) { clearTimeout(timer); void read(); } };
  window.addEventListener("online", online);
  void read();
  return () => { disposed = true; clearTimeout(timer); window.removeEventListener("online", online); };
}

export function TenantProfileLive({ client, principalId, onProfile, children }: {
  client: BffClient; principalId: string; onProfile?: (profile: TenantProfileView) => void; children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [profile, setProfile] = useState<TenantProfileView>();
  const callback = useRef(onProfile); callback.current = onProfile;
  const visible = useDocumentVisible();
  useEffect(() => {
    if (!visible) return;
    return watchTenantProfile(client, next => {
      setProfile(next);
      // Desktop owns a query cache; Web owns its root session state. Both keep
      // the same identity/session facts and update only the display name.
      queryClient.setQueriesData<PlatformSessionView>({ queryKey: ["platform", "session"] }, old =>
        old?.tenantPrincipalId === principalId ? { ...old, tenantName: next.name } : old);
      callback.current?.(next);
    });
  }, [client, principalId, queryClient, visible]);
  return <TenantDisplayProfileContext.Provider value={profile}>{children}</TenantDisplayProfileContext.Provider>;
}
