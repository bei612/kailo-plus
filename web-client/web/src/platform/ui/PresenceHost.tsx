// DD-120 Web host for the shared presence/user-status surface (client-kit react/presence,
// react/user-status; fixed Buzz 779af8886caae1317b4de962082429867ab61503 AppShell wiring).
// Transport is the same-origin BFF: Core signs the person's own 20001/30315; the Browser holds
// no signer and opens no Relay connection. Admitted stream frames feed the shared caches.
import { useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PlatformSessionView } from "@client-kit/contracts";
import { useBffCustomEmojiPalette } from "@client-kit/platform/react/custom-emoji";
import {
  ingestPresenceStreamEvent,
  PresenceHostProvider,
  useSelfPresence,
  type PresenceHost,
} from "@client-kit/platform/react/presence";
import {
  bff,
  queryPresence,
  queryUserStatus,
  releasePresence,
  setIdentityStreamSink,
  updatePresence,
  updateUserStatus,
} from "@/platform/bff-client";

export function WebPresenceHost({ session, children }: { session: PlatformSessionView; children: ReactNode }) {
  const queryClient = useQueryClient();
  const customEmoji = useBffCustomEmojiPalette(bff);
  const host = useMemo<PresenceHost>(() => ({
    queryPresence, updatePresence, queryUserStatus, updateUserStatus, customEmoji,
  }), [customEmoji]);
  // Every open channel/conversation stream routes its 20001/30315 frames here.
  useEffect(() => setIdentityStreamSink((event) => {
    ingestPresenceStreamEvent(queryClient, event);
  }), [queryClient]);
  // The person's own Web key (the SERVER key Core signs the heartbeat with) for the session.
  const self = useQuery({
    queryKey: ["platform", "presence-self", session.platformSessionId, session.tenantPrincipalId],
    queryFn: () => bff.profile(), staleTime: Infinity, retry: false,
  });
  return <PresenceHostProvider host={host} selfPubkey={self.data?.pubkey}>
    <PresencePageLifecycle />
    {children}
  </PresenceHostProvider>;
}

/**
 * Browsers have no OS idle and no lifecycle hook beyond page events: leaving the page sends a
 * best-effort offline (the lease would otherwise lapse after three heartbeat windows), and a
 * page restored from the back/forward cache renews the current status at once.
 */
function PresencePageLifecycle() {
  const self = useSelfPresence();
  const currentStatus = self?.currentStatus;
  const resync = self?.resync;
  useEffect(() => {
    if (!currentStatus || !resync) return;
    const hide = () => { if (currentStatus !== "offline") releasePresence(); };
    const show = (event: PageTransitionEvent) => { if (event.persisted) resync(); };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => {
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
    };
  }, [currentStatus, resync]);
  return null;
}
