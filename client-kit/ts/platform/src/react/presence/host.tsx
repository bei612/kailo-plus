// Kailo DD-120 mount for the fixed Buzz 779af8886caae1317b4de962082429867ab61503 features that
// the original mounts in desktop/src/app/AppShell.tsx (usePresenceSession, useUserStatusSubscription)
// and desktop/src/app/routes/root.tsx (UserStatusLookupProvider). The host supplies the transport,
// the signed-in person's pubkey and admitted stream frames (ingestPresenceStreamEvent).
import type * as React from "react";
import type { QueryClient } from "@tanstack/react-query";

import { KIND_PRESENCE_UPDATE, KIND_USER_STATUS } from "../messages/thread/kinds";
import { applyUserStatusEventToQueries, useUserStatusExpiry } from "../user-status/hooks";
import { UserStatusLookupProvider } from "../user-status/UserStatusLookupContext";
import {
  type PresenceHost,
  PresenceHostContext,
  SelfPresenceContext,
} from "./context";
import { applyLivePresenceEvent, usePresenceSession } from "./hooks";

/**
 * A live identity fact from an admitted channel/conversation stream (DD-120 (3)): a
 * member-signed 20001 or 30315 without an `h` tag. Returns whether it was consumed;
 * such frames never become timeline rows, notifications or retained IDs.
 */
export function ingestPresenceStreamEvent(
  queryClient: Pick<QueryClient, "setQueriesData" | "getQueriesData" | "setQueryData">,
  event: { id: string; pubkey: string; kind: number; created_at: number; content: string; tags: string[][] },
): boolean {
  if (!/^[0-9a-f]{64}$/i.test(event.pubkey) || typeof event.content !== "string") return false;
  if (!Array.isArray(event.tags) || event.tags.some((tag) => tag[0] === "h")) return false;
  if (event.kind === KIND_PRESENCE_UPDATE) return applyLivePresenceEvent(queryClient, event);
  if (event.kind === KIND_USER_STATUS) {
    if (!/^[0-9a-f]{64}$/i.test(event.id) || !Number.isSafeInteger(event.created_at)) return false;
    return applyUserStatusEventToQueries(queryClient, event);
  }
  return false;
}

function SelfPresence({ pubkey, children }: { pubkey: string; children: React.ReactNode }) {
  const session = usePresenceSession(pubkey);
  return (
    <SelfPresenceContext.Provider value={pubkey ? session : null}>
      {children}
    </SelfPresenceContext.Provider>
  );
}

function UserStatusExpiry() {
  useUserStatusExpiry();
  return null;
}

/**
 * Mount once per authenticated scope, inside the host's QueryClientProvider. `selfPubkey`
 * starts the original heartbeat/idle session for the signed-in person (omit it to read
 * others' presence only).
 */
export function PresenceHostProvider({
  host,
  selfPubkey,
  children,
}: {
  host: PresenceHost;
  selfPubkey?: string;
  children: React.ReactNode;
}) {
  return (
    <PresenceHostContext.Provider value={host}>
      <UserStatusExpiry />
      <SelfPresence pubkey={selfPubkey ?? ""}>
        <UserStatusLookupProvider>{children}</UserStatusLookupProvider>
      </SelfPresence>
    </PresenceHostContext.Provider>
  );
}
