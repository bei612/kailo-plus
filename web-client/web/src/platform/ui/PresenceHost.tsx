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

const TAB_KEY_PREFIX = "kailo-presence-tab:";
const TAB_BEAT_MS = 20_000;
const TAB_ALIVE_MS = 45_000;

function otherTabAlive(own: string, now: number): boolean {
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(TAB_KEY_PREFIX) || key === own) continue;
      const beat = Number(localStorage.getItem(key));
      if (Number.isFinite(beat) && now - beat < TAB_ALIVE_MS) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Browsers have no OS idle and no lifecycle hook beyond page events. Like the original, where
 * presence clears only when the person's last connection closes, leaving the last open page
 * sends a best-effort offline (the lease would otherwise lapse after three heartbeat windows);
 * closing one of several open pages leaves presence to the remaining ones. A page restored from
 * the back/forward cache renews the current status at once.
 */
function PresencePageLifecycle() {
  const self = useSelfPresence();
  const currentStatus = self?.currentStatus;
  const resync = self?.resync;
  useEffect(() => {
    if (!currentStatus || !resync) return;
    const own = `${TAB_KEY_PREFIX}${crypto.randomUUID()}`;
    const beat = () => {
      try { localStorage.setItem(own, String(Date.now())); } catch { /* storage unavailable */ }
    };
    const forget = () => {
      try { localStorage.removeItem(own); } catch { /* storage unavailable */ }
    };
    beat();
    const timer = window.setInterval(beat, TAB_BEAT_MS);
    const hide = () => {
      forget();
      if (currentStatus !== "offline" && !otherTabAlive(own, Date.now())) releasePresence();
    };
    const show = (event: PageTransitionEvent) => {
      beat();
      if (event.persisted) resync();
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => {
      window.clearInterval(timer);
      forget();
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
    };
  }, [currentStatus, resync]);
  return null;
}
