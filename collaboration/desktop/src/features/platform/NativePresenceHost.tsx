// DD-120 on the native host (05 `collab.presence`: Desktop holds its CLIENT key and talks to
// the Relay directly, DD-75). The presence and user-status surfaces are the shared client-kit
// bodies the Web host mounts (fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/presence, desktop/src/features/user-status); only the transport is
// this host's, and it is the original one:
// - presence: the Relay's own kind:20001 snapshot over the HTTP bridge (get_presence), the
//   device-signed 20001 heartbeat over this session's NIP-42 connection, and live 20001 frames
//   for the authors currently on screen (the original presence subscription);
// - user status: the person's own NIP-38 kind 30315 (`d=general`, optional `emoji` and
//   `expiration`), signed with the device key; reads take the latest verified event per
//   requested author, and live 30315 frames feed the same caches.
// The Relay is the admission point for every read and write (SS-BUZ-GOVERNANCE); nothing here
// is a second presence or status authority.
import * as React from "react";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { verifyEvent } from "nostr-tools/pure";
import {
  WebPresenceStatus,
  type WebPresencePage,
  type WebUserStatusPage,
  type WebUserStatusUpdateRequest,
  type WebUserStatusView,
} from "@client-kit/contracts";
import {
  ingestPresenceStreamEvent,
  PresenceHostProvider,
  type PresenceHost,
  type PresenceStatus,
} from "@client-kit/platform/react/presence";
import { TransportError } from "@client-kit/platform/transport";
import { useCustomEmojiPalette } from "@/features/messages/lib/useCustomEmojiPalette";
import { useNativeSession } from "@/features/platform/activeCommunity";
import { relayClient } from "@/shared/api/relayClient";
import { classifyRelayPublishFailure } from "@/shared/api/relayPublishOutcome";
import { signRelayEvent } from "@/shared/api/tauri";
import { getPresence } from "@/shared/api/tauriProfiles";
import { getOsIdleSeconds } from "@/shared/api/osIdle";
import type { RelayEvent } from "@/shared/api/types";

export const KIND_PRESENCE = 20001;
export const KIND_USER_STATUS = 30315;
const STATUS_D_TAG = "general";
/** Live 20001 authors per subscription; beyond it the 60 s snapshot poll is the backstop. */
export const LIVE_PRESENCE_AUTHOR_LIMIT = 500;

const HEX_PUBKEY = /^[0-9a-f]{64}$/;

function normalizedPubkeys(pubkeys: readonly string[]): string[] {
  return [...new Set(pubkeys.map((pubkey) => pubkey.trim().toLowerCase()))]
    .filter((pubkey) => HEX_PUBKEY.test(pubkey))
    .sort();
}

const PRESENCE_STATUSES: Record<string, WebPresenceStatus> = {
  online: WebPresenceStatus.Online,
  away: WebPresenceStatus.Away,
  offline: WebPresenceStatus.Offline,
};

/** The snapshot for the requested pubkeys only; a pubkey without a fact stays absent. */
export function presencePageFromSnapshot(
  snapshot: Readonly<Record<string, string>>,
  requested: readonly string[],
): WebPresencePage {
  const wanted = new Set(normalizedPubkeys(requested));
  const presences: WebPresencePage["presences"] = [];
  for (const [pubkey, status] of Object.entries(snapshot)) {
    const normalized = pubkey.toLowerCase();
    const known = PRESENCE_STATUSES[status];
    if (wanted.has(normalized) && known !== undefined) {
      presences.push({ pubkey: normalized, status: known });
    }
  }
  return { presences };
}

function tagValue(event: RelayEvent, name: string): string | undefined {
  const tag = event.tags.find((entry) => entry[0] === name && entry.length >= 2);
  return tag?.[1];
}

/** NIP-01 replaceable order: newer `created_at` wins; in the same second the smaller ID. */
function replaces(candidate: RelayEvent, current: RelayEvent): boolean {
  return candidate.created_at > current.created_at
    || (candidate.created_at === current.created_at && candidate.id < current.id);
}

/**
 * The latest verified 30315 `d=general` per requested author (the same reading rule the BFF
 * applies for the Web, core platform-core user_status.rs): any row that is not an intact
 * status of a requested author fails the whole read rather than yielding a partial answer;
 * cleared (no text, no emoji) and expired statuses are omitted.
 */
export function userStatusPageFromEvents(
  events: readonly RelayEvent[],
  requested: readonly string[],
  nowSeconds: number,
  verify: (event: RelayEvent) => boolean = (event) => verifyEvent(event),
): WebUserStatusPage {
  const authors = new Set(normalizedPubkeys(requested));
  const latest = new Map<string, RelayEvent>();
  for (const event of events) {
    const author = event.pubkey.toLowerCase();
    const valid = event.kind === KIND_USER_STATUS && authors.has(author)
      && tagValue(event, "d") === STATUS_D_TAG && verify(event);
    if (!valid) throw new TransportError("Invalid user status response");
    const current = latest.get(author);
    if (!current || replaces(event, current)) latest.set(author, event);
  }
  const statuses: WebUserStatusView[] = [];
  for (const [author, event] of latest) {
    const emoji = tagValue(event, "emoji") || undefined;
    const expiration = Number.parseInt(tagValue(event, "expiration") ?? "", 10);
    const expiresAt = Number.isSafeInteger(expiration) && expiration >= 0 ? expiration : undefined;
    if ((expiresAt !== undefined && expiresAt <= nowSeconds) || (event.content === "" && emoji === undefined)) {
      continue;
    }
    statuses.push({
      pubkey: author,
      text: event.content,
      ...(emoji !== undefined ? { emoji } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      eventId: event.id,
      createdAt: event.created_at,
    });
  }
  return { statuses };
}

/** Original publishUserStatus tag order: `d=general`, then optional `emoji` and `expiration`. */
export function userStatusTags(request: WebUserStatusUpdateRequest): string[][] {
  const tags: string[][] = [["d", STATUS_D_TAG]];
  if (request.emoji) tags.push(["emoji", request.emoji]);
  if (request.expiresAt !== undefined) tags.push(["expiration", String(request.expiresAt)]);
  return tags;
}

type PublishEvent = (event: RelayEvent, timeoutMessage: string, sendErrorMessage: string) => Promise<unknown>;

/**
 * The native presence transport. `publish` and `sign` default to this session's Relay client
 * and the device signer; an UNKNOWN status publication keeps its signed event under the
 * caller's key so a retry re-sends that same event (the Relay accepts it as a duplicate)
 * instead of signing another one.
 */
export function createNativePresenceTransport({
  readSnapshot = getPresence,
  fetchEvents = (filter) => relayClient.fetchEvents(filter),
  sign = signRelayEvent,
  publish = (event, timeoutMessage, sendErrorMessage) => relayClient.publishEvent(event, timeoutMessage, sendErrorMessage),
  now = () => Date.now(),
}: {
  readSnapshot?: (pubkeys: string[]) => Promise<Record<string, string>>;
  fetchEvents?: (filter: Parameters<typeof relayClient.fetchEvents>[0]) => Promise<RelayEvent[]>;
  sign?: typeof signRelayEvent;
  publish?: PublishEvent;
  now?: () => number;
} = {}): Omit<PresenceHost, "customEmoji"> {
  const statusIntents = new Map<string, RelayEvent>();
  return {
    queryPresence: async (pubkeys) => {
      const requested = normalizedPubkeys(pubkeys);
      if (requested.length === 0) return { presences: [] };
      return presencePageFromSnapshot(await readSnapshot(requested), requested);
    },
    updatePresence: async (status: PresenceStatus) => {
      // Ephemeral and latest-wins: never reconciled by event ID; the next heartbeat replaces it.
      const event = await sign({ kind: KIND_PRESENCE, content: status, tags: [] });
      await publish(event, "Timed out while updating presence.", "Failed to update presence.");
    },
    queryUserStatus: async (pubkeys) => {
      const authors = normalizedPubkeys(pubkeys);
      if (authors.length === 0) return { statuses: [] };
      const events = await fetchEvents({
        kinds: [KIND_USER_STATUS], authors, "#d": [STATUS_D_TAG], limit: authors.length,
      });
      return userStatusPageFromEvents(events, authors, Math.floor(now() / 1_000));
    },
    updateUserStatus: async (request, idempotencyKey) => {
      const event = statusIntents.get(idempotencyKey)
        ?? await sign({ kind: KIND_USER_STATUS, content: request.text, tags: userStatusTags(request) });
      statusIntents.set(idempotencyKey, event);
      try {
        await publish(event, "Timed out publishing user status", "Failed to publish user status");
      } catch (error) {
        if (classifyRelayPublishFailure(error)?.kind === "outcomeUnknown") {
          throw new TransportError("User status publication outcome unknown");
        }
        statusIntents.delete(idempotencyKey);
        throw error;
      }
      statusIntents.delete(idempotencyKey);
      return { eventId: event.id, createdAt: event.created_at };
    },
  };
}

/** Authors of every presence lookup currently cached (the original presence reconciler input). */
export function presenceQueryAuthors(queryClient: Pick<QueryClient, "getQueryCache">): string[] {
  const authors = new Set<string>();
  for (const query of queryClient.getQueryCache().findAll({ queryKey: ["presence"] })) {
    for (const part of query.queryKey.slice(1)) {
      if (typeof part === "string" && HEX_PUBKEY.test(part)) authors.add(part);
    }
  }
  return [...authors].sort();
}

function ingestVerified(queryClient: QueryClient, event: RelayEvent) {
  // Native WS data is untrusted before signature validation.
  try { if (!verifyEvent(event)) return; } catch { return; }
  ingestPresenceStreamEvent(queryClient, event);
}

/** Live 30315 frames for everyone and live 20001 frames for the authors on screen. */
function useNativePresenceLiveFrames(queryClient: QueryClient) {
  React.useEffect(() => {
    let disposed = false;
    let dispose: (() => Promise<void>) | undefined;
    relayClient.subscribeLive({ kinds: [KIND_USER_STATUS], "#d": [STATUS_D_TAG], limit: 0 },
      (event) => { if (!disposed) ingestVerified(queryClient, event); })
      .then((close) => { if (disposed) void close(); else dispose = close; })
      .catch(() => { /* The 120 s status poll stays the backstop. */ });
    return () => { disposed = true; if (dispose) void dispose(); };
  }, [queryClient]);

  const [authorKey, setAuthorKey] = React.useState("");
  React.useEffect(() => {
    const update = () => setAuthorKey(presenceQueryAuthors(queryClient).join(","));
    update();
    return queryClient.getQueryCache().subscribe(update);
  }, [queryClient]);
  React.useEffect(() => {
    const authors = authorKey ? authorKey.split(",") : [];
    if (authors.length === 0 || authors.length > LIVE_PRESENCE_AUTHOR_LIMIT) return;
    let disposed = false;
    let dispose: (() => Promise<void>) | undefined;
    relayClient.subscribeLive({ kinds: [KIND_PRESENCE], authors, limit: 0 },
      (event) => { if (!disposed) ingestVerified(queryClient, event); })
      .then((close) => { if (disposed) void close(); else dispose = close; })
      .catch(() => { /* The 60 s snapshot poll stays the backstop. */ });
    return () => { disposed = true; if (dispose) void dispose(); };
  }, [queryClient, authorKey]);
}

/** Mount once per native session, inside the community QueryClientProvider. */
export function NativePresenceHost({ children }: { children: React.ReactNode }) {
  const session = useNativeSession();
  const queryClient = useQueryClient();
  const customEmoji = useCustomEmojiPalette();
  const transport = React.useMemo(() => createNativePresenceTransport(), [session.devicePubkey, session.facts.relayUrl]);
  // DD-125(5): OS-wide idle is the authoritative automatic-away signal, as in the original.
  const host = React.useMemo<PresenceHost>(() => ({ ...transport, customEmoji, osIdleSeconds: getOsIdleSeconds }),
    [transport, customEmoji]);
  useNativePresenceLiveFrames(queryClient);
  // The heartbeat/idle session runs for this device's own key (DD-77: one key per device).
  return <PresenceHostProvider host={host} selfPubkey={session.devicePubkey.toLowerCase()}>{children}</PresenceHostProvider>;
}
