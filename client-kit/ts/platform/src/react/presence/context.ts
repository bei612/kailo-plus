// Kailo DD-120 seam for the fixed Buzz 779af8886caae1317b4de962082429867ab61503 presence and
// user-status features (desktop/src/features/presence, desktop/src/features/user-status).
// The original reads relayClient directly; here the host injects the BFF transport, the way
// typingState.ts receives admitted live events. The Browser never holds a signer or a Relay
// connection: Core signs 20001/30315 with the person's own SERVER key (DD-120 (1), (4)).
import * as React from "react";
import type {
  WebPresencePage,
  WebUserStatusPage,
  WebUserStatusUpdateRequest,
} from "@client-kit/contracts";
import type { CustomEmoji } from "../custom-emoji/emoji";
import type { PresenceStatus } from "./lib/presence";

/** A 2xx publication of the person's own 30315; `createdAt` when the host reports it. */
export type UserStatusReceipt = { eventId: string; createdAt?: number };

export type PresenceHost = {
  /** POST presence query: Relay-signed 20001 snapshot facts for these pubkeys only. */
  queryPresence: (pubkeys: string[]) => Promise<WebPresencePage>;
  /** PUT own heartbeat/manual choice; latest wins, never reconciled by event ID. */
  updatePresence: (status: PresenceStatus) => Promise<void>;
  /** POST user-status query: latest verified 30315 per pubkey; cleared ones are omitted. */
  queryUserStatus: (pubkeys: string[]) => Promise<WebUserStatusPage>;
  /** PUT own 30315 under DD-81: an UNKNOWN outcome is resent with the same key, never re-signed. */
  updateUserStatus: (
    request: WebUserStatusUpdateRequest,
    idempotencyKey: string,
  ) => Promise<UserStatusReceipt>;
  /** The admitted community custom emoji used to render a `:shortcode:` status emoji. */
  customEmoji?: readonly CustomEmoji[];
};

export type PresenceSession = {
  currentStatus: PresenceStatus;
  isLoading: boolean;
  isPending: boolean;
  error: Error | null;
  setStatus: (status: PresenceStatus) => Promise<void>;
  /** Re-send the current status now (e.g. a page restored from the back/forward cache). */
  resync: () => void;
};

export const PresenceHostContext = React.createContext<PresenceHost | null>(null);
export const SelfPresenceContext = React.createContext<PresenceSession | null>(null);

/** The injected transport, or null when the surface runs without presence (no faked facts). */
export function usePresenceHost(): PresenceHost | null {
  return React.useContext(PresenceHostContext);
}

/** The signed-in person's own presence session, once the host knows their pubkey. */
export function useSelfPresence(): PresenceSession | null {
  return React.useContext(SelfPresenceContext);
}
