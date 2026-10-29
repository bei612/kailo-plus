// DD-158 / V-SCN-261: the existing BFF profile read also supports a bounded
// afterVersion watch. Hints carry no profile data; every answer is re-admitted.
// Original desktop/src/features/communities/communityIconCache.ts and
// desktop/src/features/communities/useCommunityIcons.ts: the community name/icon every surface shows
// comes from this one admitted Tenant profile read instead of a per-relay icon cache.
import { createContext, type ReactNode, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { PlatformSessionView, TenantProfileView } from "@client-kit/contracts";
import type { BffClient } from "../../client";
import { BffError, SessionEndedError, TransportError, queryRetryDelay, rateLimitRetryMs } from "../../transport";
import { useDocumentVisible } from "../projects/useProjectAppFocus";

export const TenantDisplayProfileContext = createContext<TenantProfileView | null | undefined>(undefined);

/** One active read per consumer; disposed identities cannot accept late answers. */
export function watchTenantProfile(client: BffClient, receive: (profile: TenantProfileView) => void, retire?: () => void) {
  let disposed = false, closed = false, reading = false, onlinePending = false, failures = 0;
  let version: number | undefined, retryMillis: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = async () => {
    if (disposed || closed || reading) return;
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
      failures = 0;
      if (retryMillis !== undefined) timer = setTimeout(() => void read(), 0);
    } catch (error) {
      if (disposed) return;
      if (error instanceof SessionEndedError || (error instanceof BffError && [401, 403].includes(error.status))) {
        closed = true; retire?.(); return;
      }
      // Before the first valid response there is no server retry fact. Reuse
      // the existing shared query backoff; a later valid response replaces it.
      const wait = rateLimitRetryMs(error) ?? retryMillis ?? queryRetryDelay(failures++, error);
      timer = setTimeout(() => void read(), wait);
    } finally {
      reading = false;
      if (onlinePending && !disposed && !closed) {
        onlinePending = false; clearTimeout(timer); void read();
      }
    }
  };
  const online = () => { if (reading) onlinePending = true; else { clearTimeout(timer); void read(); } };
  window.addEventListener("online", online);
  void read();
  return () => { disposed = true; clearTimeout(timer); window.removeEventListener("online", online); };
}

export function TenantProfileLive({ client, principalId, onProfile, children }: {
  client: BffClient; principalId: string; onProfile?: (profile: TenantProfileView | null) => void; children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [profile, setProfile] = useState<TenantProfileView | null>();
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
    }, () => {
      setProfile(null);
      queryClient.setQueriesData<PlatformSessionView>({ queryKey: ["platform", "session"] }, old =>
        old?.tenantPrincipalId === principalId ? { ...old, tenantName: undefined } : old);
      callback.current?.(null);
    });
  }, [client, principalId, queryClient, visible]);
  return <TenantDisplayProfileContext.Provider value={profile}>{children}</TenantDisplayProfileContext.Provider>;
}
