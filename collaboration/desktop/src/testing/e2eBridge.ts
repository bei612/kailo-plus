import { hexToBytes } from "@noble/hashes/utils.js";
import { emit, listen } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { finalizeEvent } from "nostr-tools/pure";

import type {
  ObservedUnreadProjection,
  ObservedUnreadResponse,
} from "@/shared/api/tauriObservedUnread";
import type { UnreadCatchUpChannelResult } from "@/shared/api/tauriUnreadCatchUp";
import { relayClient } from "@/shared/api/relayClient";
import { activateRateLimit } from "@/shared/api/relayRateLimitGate";
import { mockSearchHitMatches } from "./e2eBridgeSearch.ts";
export { mockSearchHitMatches };
import type { ConnectionState } from "@/shared/api/relayClientShared";
import type { RelayEvent } from "@/shared/api/types";
import { getMarkdownParseCount } from "@/shared/ui/markdown/nodeCache";
import {
  KIND_CHANNEL_THREAD_SUMMARY,
  KIND_CHANNEL_WINDOW_BOUNDS,
  KIND_DM_VISIBILITY,
  KIND_SYSTEM_MESSAGE,
} from "@/shared/constants/kinds";
import {
  ensureRelayOriginFetch,
  resetMediaCaches,
} from "@/shared/lib/mediaUrl";
import {
  isValidLinkPreviewSnapshotCanonicalUrl,
  parseLinkPreviewSnapshots,
} from "@/shared/lib/linkPreviewSnapshot";

type TestIdentity = {
  privateKey: string;
  pubkey: string;
  username: string;
};

type MockSearchProfileSeed = {
  pubkey: string;
  displayName: string | null;
  avatarUrl?: string | null;
  nip05Handle?: string | null;
  about?: string | null;
  ownerPubkey?: string | null;
  isAgent?: boolean;
};

type E2eConfig = {
  mode?: "mock" | "relay";
  mock?: {
    /** Tauri window label exposed to the app. Defaults to the main window. */
    windowLabel?: string;
    channelMembersReadDelayMs?: number;
    channelsReadError?: string;
    /** Reject successive mock `get_channels` calls, then resume. */
    channelsReadErrors?: (string | null)[];
    channelsReadDelayMs?: number;
    /** Return not-modified for this many reads before resuming full payloads. */
    channelsNotModifiedResponses?: number;
    /** When true, a matching knownHash returns a not-modified channel payload. */
    honorChannelsKnownHash?: boolean;
    /** Number of seeded rows in the deep-history fixture. Defaults to 600. */
    deepHistoryMessageCount?: number;
    feedReadError?: string;
    /** Delay (ms) for `apply_workspace` so e2e tests can observe the
     *  connecting state. 0/undefined = instant. */
    applyCommunityDelayMs?: number;
    /** Reject `clear_pending_navigation_deep_links` with this message. */
    clearPendingNavigationDeepLinksError?: string;
    sendMessageDelayMs?: number;
    /** Hold the media proxy at port 0 until the E2E release seam is invoked. */
    mediaProxyInitiallyUnavailable?: boolean;
    /** Hold mock send live echoes until the E2E release seam is invoked. */
    deferSendMessageLiveEcho?: boolean;
    /** Close the first channel-window live REQ; its retry is accepted. */
    closeChannelLiveSubscriptionOnce?: boolean;
    /** Reject successive kind-9 sends with these messages, then resume. */
    sendMessageErrors?: string[];
    /** Delay (ms) after snapshotting a thread-replies page so E2E tests can
     *  deliver live reply/aux events while an older response is in flight. */
    threadRepliesDelayMs?: number;
    /** Hold every `get_thread_replies` response until
     *  `__BUZZ_E2E_RELEASE_THREAD_REPLIES__()` is called. Unlike
     *  `threadRepliesDelayMs` (a timer that self-heals inside Playwright's
     *  auto-retry window), this is a manual gate: the thread-aux backfill
     *  provably never lands until the test releases it, so a spec can assert
     *  the panel's head state before any backfill can heal it. */
    deferThreadReplies?: boolean;
    usersBatchDelayMs?: number;
    /** Delay (ms) applied to continuation channel-window requests so e2e
     *  tests can observe the in-flight prepend window. 0/undefined = instant. */
    channelWindowDelayMs?: number;
    /** Delay (ms) applied to newest-page channel-window requests. */
    channelHeadDelayMs?: number;
    profileReadDelayMs?: number;
    /** Hold `get_profile` responses until the E2E release seam is invoked. */
    deferProfileReads?: boolean;
    profileReadError?: string;
    /** Override whether get_profile reports a real kind:0 event. */
    profileHasEvent?: boolean;
    linkPreviewMetadata?: {
      title: string;
      siteName: string | null;
      description: string | null;
      imageDataUrl: string | null;
      imageDomain: string | null;
      imageFetchState?: "none" | "image" | "transient_failure" | "rejected";
      imageRetryAfterMs?: number | null;
      faviconDataUrl?: string | null;
    } | null;
    linkPreviewMetadataByHref?: Record<
      string,
      {
        title: string;
        siteName: string | null;
        description: string | null;
        imageDataUrl: string | null;
        imageDomain: string | null;
        imageFetchState?: "none" | "image" | "transient_failure" | "rejected";
        imageRetryAfterMs?: number | null;
        faviconDataUrl?: string | null;
      } | null
    >;
    linkPreviewMetadataDelayMs?: number;
    /** Hold metadata until the E2E release seam is invoked. */
    deferLinkPreviewMetadata?: boolean;
    /** Simulates native cold-cache startup work before the async response. */
    linkPreviewMetadataStartBlockMs?: number;
    /** Delays link-preview snapshot media uploads so specs can exercise the
     *  composer's settle-gated disabled state before the snapshot tag is ready. */
    linkPreviewUploadDelayMs?: number;
    /** Hold link-preview uploads before mock-native cancellation registration. */
    deferLinkPreviewUploadRegistration?: boolean;
    /** Substrings of `link-preview-*` upload filenames whose `upload_media_bytes`
     *  call should reject, so specs can drive a per-media snapshot upload failure
     *  (e.g. `["link-preview-image"]` fails only the thumbnail, favicon survives). */
    linkPreviewUploadErrorFilenames?: string[];
    searchProfiles?: MockSearchProfileSeed[];
    restartDelayMs?: number;
    /** Reject `plugin:opener|open_url` to exercise browser-return fallback UI. */
    openerError?: string;
    /** Reject successive mock WebSocket connect attempts, then resume. */
    websocketConnectErrors?: string[];
    /** Deliver AUTH synchronously, before the mock connect command resolves. */
    websocketAuthBeforeConnectResolves?: boolean;
    /** Stall the first AUTH signing command forever; later attempts complete. */
    stallFirstAuthSigning?: boolean;
    stallWebsocketSends?: boolean;
    userSearchDelayMs?: number;
    // Relay's NIP-11 `self` pubkey (hex) for `get_relay_self`. A DM whose peer
    // equals this is treated as a moderation DM (composer disabled). Absent →
    // fail open (no mod-DM detection), matching the Rust command's contract.
    relaySelf?: string | null;
    // Descriptors returned by the mocked `pick_and_upload_media` /
    // `upload_media_bytes` commands. Lets a spec drive the attachment flow
    // (e.g. a generic PDF) without a real upload pipeline. See
    // tests/helpers/bridge.ts:MockBridgeOptions.uploadDescriptors.
    uploadDelayMs?: number;
    /** Delay (ms) applied to `get_relay_self` so E2E tests can prove the
     *  fail-closed race: DMs are withheld while classification is unresolved. */
    relaySelfDelayMs?: number;
    uploadDescriptors?: RawBlobDescriptor[];
    // Event IDs that `get_event` should report as definitively not found.
    // Causes `useDraftRootStatus` to classify as `deleted`.
    deletedEventIds?: string[];
    pendingNavigationDeepLinks?: Array<{
      id: string;
      kind: "channel" | "message";
      channelId: string;
      messageId?: string | null;
      threadRootId?: string | null;
    }>;
    /** Reject one `get_identity` call after this many successful reads. */
    identityReadErrorAfter?: { message: string; successfulReads: number };
    // When true, `get_identity` returns `lost: true` until
    // `persist_current_identity` is called. Drives the device-key-lost screen.
    identityLost?: boolean;
    // When true, `get_identity` returns `locked: true`. Drives the
    // keyring-locked screen.
    identityLocked?: boolean;
    /** Platform commands (platform_*); see PlatformMockOptions. */
    platform?: PlatformMockOptions;
  };
  relayHttpUrl?: string;
  relayWsUrl?: string;
  identity?: TestIdentity;
};

type PlatformReply = { status: number; body: unknown };

/**
 * The Rust-side platform layer (desktop/src-tauri/src/platform) as the frontend sees
 * it: configuration, sign-in, device registration and `platform_api`. Defaults
 * describe a configured, signed-in device whose key is ACTIVE, so specs that
 * are not about the platform bootstrap boot straight into the community.
 */
type PlatformMockOptions = {
  /** `null` = not configured yet. */
  config?: {
    nativeApiUrl: string;
    oidcIssuer: string;
    oidcClientId: string;
  } | null;
  signedIn?: boolean;
  /** Rejection message for `platform_set_config` (Rust-side validation). */
  setConfigError?: string;
  /** `hold` keeps `platform_sign_in` pending until `platform_cancel_sign_in`. */
  signIn?: "succeed" | "hold" | { error: string };
  /** Successive `platform_register_device` outcomes; the last one repeats. */
  register?: Array<PlatformReply | { error: string }>;
  /** Successive states of this device in `GET /api/v1/identity/client-keys`. */
  deviceStates?: string[];
  /** Other devices of this person listed next to this one. */
  otherDevices?: Array<{ pubkey: string; state: string; createdAt: string }>;
  /** Reply to `GET /api/v1/native/community`; default points at the relay. */
  community?: PlatformReply;
  /** Reply to `DELETE /api/v1/identity/client-keys/{pubkey}`. */
  revoke?: PlatformReply;
  /**
   * What `platform_sign_out` reports about the server side (Core session
   * revocation, IdP refresh-token revocation). Defaults to both confirmed.
   */
  signOut?: { coreSessionRevoked: boolean; refreshTokenRevoked: boolean };
  workspaces?: Array<{ id: string; name: string; slug: string }>;
  members?: unknown[];
  audit?: unknown[];
  /**
   * Any other BFF route, keyed `"METHOD /api/v1/…"` (path as sent, i.e.
   * percent-encoded). Successive replies per route; the last one repeats.
   */
  routes?: Record<string, PlatformReply[]>;
};

type RawBlobDescriptor = {
  url: string;
  sha256: string;
  size: number;
  type: string;
  uploaded: number;
  dim?: string;
  blurhash?: string;
  thumb?: string;
  duration?: number;
  image?: string;
  filename?: string;
};

type RawProfile = {
  pubkey: string;
  display_name: string | null;
  /** Kind-0 `name` field, kept separate from `display_name` so mention
   * resolution can match either alias. */
  name?: string | null;
  avatar_url: string | null;
  about: string | null;
  nip05_handle: string | null;
  owner_pubkey: string | null;
  is_agent?: boolean;
  /** Mirrors the Rust `has_profile_event` flag: true when a real kind:0 event
   * backed this profile, false for the synthesized empty fallback. */
  has_profile_event: boolean;
};

type RawUserProfileSummary = {
  display_name: string | null;
  name?: string | null;
  avatar_url: string | null;
  nip05_handle: string | null;
  owner_pubkey: string | null;
  is_agent?: boolean;
};

type RawUsersBatchResponse = {
  profiles: Record<string, RawUserProfileSummary>;
  missing: string[];
};

type RawUserSearchResult = {
  pubkey: string;
  display_name: string | null;
  avatar_url: string | null;
  nip05_handle: string | null;
  owner_pubkey: string | null;
  is_agent?: boolean;
};

type RawSearchUsersResponse = {
  users: RawUserSearchResult[];
  next_cursor?: string | null;
};

type RawChannel = {
  id: string;
  name: string;
  channel_type: "stream" | "forum" | "dm";
  visibility: "open" | "private";
  description: string;
  topic: string | null;
  purpose: string | null;
  member_count: number;
  member_pubkeys: string[];
  last_message_at: string | null;
  archived_at: string | null;
  participants: string[];
  participant_pubkeys: string[];
  ttl_seconds: number | null;
  ttl_deadline: string | null;
};

type RawChannelWithMembership = RawChannel & {
  is_member: boolean;
};

type RawChannelDetail = RawChannel & {
  created_by: string;
  created_at: string;
  updated_at: string;
  topic_set_by: string | null;
  topic_set_at: string | null;
  purpose_set_by: string | null;
  purpose_set_at: string | null;
  topic_required: boolean;
  max_members: number | null;
  nip29_group_id: string | null;
};

type RawChannelMember = {
  pubkey: string;
  role: "owner" | "admin" | "member" | "guest" | "bot";
  is_agent?: boolean;
  joined_at: string;
  display_name: string | null;
};

type RawChannelMembersResponse = {
  members: RawChannelMember[];
  next_cursor: string | null;
};

type MockChannel = Omit<RawChannelDetail, "member_pubkeys"> & {
  members: RawChannelMember[];
};

type RawFeedItem = {
  id: string;
  kind: number;
  pubkey: string;
  content: string;
  created_at: number;
  channel_id: string | null;
  channel_name: string;
  // Mirrors native FeedItemInfo.channel_type (Option<String>): the Tauri
  // backend always emits the key, as `null` when unknown.
  channel_type?: string | null;
  tags: string[][];
  category: "mention";
};

type RawHomeFeedResponse = {
  feed: {
    mentions: RawFeedItem[];
  };
  meta: {
    since: number;
    total: number;
    generated_at: number;
  };
};

type RawSearchHit = {
  event_id: string;
  content: string;
  kind: number;
  pubkey: string;
  channel_id: string | null;
  channel_name: string | null;
  created_at: number;
  score: number;
};

type RawSearchResponse = {
  hits: RawSearchHit[];
  found: number;
};

type RawSendChannelMessageResponse = {
  event_id: string;
  parent_event_id: string | null;
  root_event_id: string | null;
  depth: number;
  created_at: number;
};

type WsHandler = (message: unknown) => void;
const GLOBAL_MOCK_SUBSCRIPTION = "*";

type MockSubscription = {
  channelIds: string[];
  kinds: number[] | null;
  /** `#p` values from the REQ filters, if any — lets specs assert an
   *  owner-scoped live subscription (e.g. the observer-archive `24200`
   *  reconciliation gate) independently of channel-scoped ones. */
  ownerPubkeys: string[];
};

type MockFilter = {
  "#a"?: string[];
  "#buzz-channel"?: string[];
  "#d"?: string[];
  "#e"?: string[];
  "#h"?: string[];
  "#p"?: string[];
  authors?: string[];
  ids?: string[];
  kinds?: number[];
  limit?: number;
  since?: number;
  until?: number;
};

type MockSocket = {
  handler: WsHandler;
  subscriptions: Map<string, MockSubscription>;
};

/**
 * Mirror the native clipboard command's dual-flavor write.
 *
 * `navigator.clipboard.writeText` can only carry the plain flavor, so specs
 * asserting on the identity sidecar read the captured payload instead. The
 * rich write is still attempted so real paste round-trips work.
 */
async function writeClipboardFlavors({
  html,
  text,
}: {
  html?: string;
  text: string;
}): Promise<void> {
  window.__BUZZ_E2E_LAST_CLIPBOARD__ = { html: html ?? null, text };
  if (
    html &&
    typeof ClipboardItem !== "undefined" &&
    navigator.clipboard?.write
  ) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return;
    } catch {
      // Fall back to the plain flavor; headless permissions vary by browser.
    }
  }
  await navigator.clipboard.writeText(text);
}

declare global {
  interface Window {
    __BUZZ_E2E__?: E2eConfig;
    /** Last payload written through the native clipboard command. */
    __BUZZ_E2E_LAST_CLIPBOARD__?: { html: string | null; text: string };
    __BUZZ_E2E_COMMANDS__?: string[];
    __BUZZ_E2E_COMMAND_PAYLOADS__?: Array<{
      command: string;
      payload: unknown;
    }>;
    __BUZZ_E2E_COMMAND_LOG__?: Array<{
      command: string;
      payload: unknown;
    }>;
    /** Release a mock media proxy held at port 0 and return its ready port. */
    __BUZZ_E2E_RELEASE_MEDIA_PROXY__?: () => number;
    /** Release mock send events that were stored but withheld from live subscribers. */
    __BUZZ_E2E_RELEASE_SEND_MESSAGE_LIVE_ECHO__?: () => number;
    __BUZZ_E2E_EMIT_MEDIA_UPLOAD_PHASE__?: (input: {
      id: string;
      phase: string;
    }) => Promise<void>;
    __BUZZ_E2E_EMIT_MEDIA_UPLOAD_PROGRESS__?: (input: {
      id: string;
      sent: number;
      total: number;
    }) => Promise<void>;
    __BUZZ_E2E_WEBVIEW_ZOOM__?: number;
    __BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?: (input: {
      channelName: string;
      kind?: number;
    }) => boolean;
    __BUZZ_E2E_HAS_MOCK_GLOBAL_KIND_SUBSCRIPTION__?: (kind: number) => boolean;
    __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
      channelName: string;
      content: string;
      parentEventId?: string | null;
      pubkey?: string;
      kind?: number;
      mentionPubkeys?: string[];
      extraTags?: string[][];
      createdAt?: number;
      /** Marks this test-only message as locally pending. */
      pending?: boolean;
      /** 64-hex id required for the event to be a valid reaction target. */
      id?: string;
    }) => RelayEvent;
    /** Prepend `count` synthetic older messages to a channel's mock store so
     *  an older-history fetch has something to paginate. Mirrors how the real
     *  relay backfills history. Returns the created events. */
    __BUZZ_E2E_PREPEND_MOCK_HISTORY__?: (input: {
      channelName: string;
      count: number;
      startIndex?: number;
      lineCount?: number;
      createdAtStart?: number;
      emit?: boolean;
    }) => RelayEvent[];
    __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: (
      command: string,
      payload?: Record<string, unknown>,
    ) => Promise<unknown>;
    __BUZZ_E2E_EMIT_TAURI_EVENT__?: (
      event: string,
      payload: unknown,
    ) => Promise<void>;
    __BUZZ_E2E_PUSH_MOCK_FEED_ITEM__?: (item: RawFeedItem) => RawFeedItem;
    /** Replace an existing feed item by id (or push if not found) and fire the updated event. */
    __BUZZ_E2E_REPLACE_MOCK_FEED_ITEM__?: (
      oldId: string,
      item: RawFeedItem,
    ) => RawFeedItem;
    __BUZZ_E2E_SIGNED_EVENTS__?: Array<{
      content: string;
      createdAt?: number;
      kind: number;
      tags: string[][];
    }>;
    __BUZZ_E2E_SET_RELAY_CONNECTION_STATE__?: (state: ConnectionState) => void;
    __BUZZ_E2E_GET_RELAY_CONNECTION_STATE__?: () => ConnectionState;
    /** Queue deterministic mock AUTH outcomes, consumed in order. */
    __BUZZ_E2E_QUEUE_AUTH_RESPONSES__?: (
      responses: Array<{ success: boolean; message: string }>,
    ) => void;
    /** Inject CLOSED into every active mock live subscription. */
    __BUZZ_E2E_CLOSE_LIVE_SUBSCRIPTIONS__?: (reason: string) => number;
    /** Queue CLOSED responses for channel history REQs. */
    __BUZZ_E2E_QUEUE_CHANNEL_HISTORY_CLOSES__?: (reasons: string[]) => void;
    __BUZZ_E2E_SET_STALL_WEBSOCKET_SENDS__?: (stall: boolean) => void;
    __BUZZ_E2E_OPEN_MOCK_WEBSOCKETS__?: () => number;
    __BUZZ_E2E_DISCONNECT_MOCK_WEBSOCKETS__?: () => number;
    __BUZZ_E2E_RESTART_MOCK_WEBSOCKETS__?: () => number;
    __BUZZ_E2E_SET_MOCK_WEBSOCKET_UNAVAILABLE__?: (
      unavailable: boolean,
    ) => void;
    __BUZZ_E2E_GET_WEBSOCKET_CONNECT_ATTEMPTS__?: () => number[];
    __BUZZ_E2E_ACTIVATE_RELAY_RATE_LIMIT__?: (seconds: number) => void;
    __BUZZ_E2E_RESET_WEBSOCKET_CONNECT_ATTEMPTS__?: () => void;
    __BUZZ_E2E_QUERY_CLIENT__?: {
      invalidateQueries: (filters: {
        queryKey: readonly unknown[];
        exact?: boolean;
      }) => unknown;
      getQueryState: (queryKey: readonly unknown[]) =>
        | {
            fetchStatus: "fetching" | "paused" | "idle";
            status: "pending" | "error" | "success";
          }
        | undefined;
    };
    __BUZZ_E2E_MD_PARSE_COUNT__?: () => number;
    /**
     * Invalidate the channels React Query cache so E2E tests can trigger a
     * re-fetch after calling archive_channel / update_channel via
     * __BUZZ_E2E_INVOKE_MOCK_COMMAND__. Call after the mutation to make the
     * updated channel state visible to subscribers.
     */
    __BUZZ_E2E_INVALIDATE_CHANNELS__?: () => Promise<void>;
    /**
     * Directly mutate a mock channel's properties without going through a
     * command handler.  Use for E2E regressions that need to change
     * channel_type or remove isMember in a single synchronous step, then
     * follow up with __BUZZ_E2E_INVALIDATE_CHANNELS__ to flush the cache.
     *
     * Only the listed fields are writeable; omitted fields are left unchanged.
     */
    __BUZZ_E2E_MUTATE_CHANNEL__?: (opts: {
      channelId: string;
      name?: string;
      channelType?: "stream" | "forum" | "dm";
      description?: string;
      removeMemberPubkey?: string;
    }) => void;
    /**
     * When set to an event ID string, `get_event` calls for that specific ID
     * are held in a queue and not resolved until `__BUZZ_E2E_RELEASE_GET_EVENT__()`
     * is called.  Calls for any other event ID proceed normally.  Used by the
     * cold-recovery race test to prove mid-flight feedItems updates do not
     * cancel the in-flight promise for the cold anchor specifically.
     * Set to undefined/null to disable deferral.
     */
    __BUZZ_E2E_DEFER_GET_EVENT__?: string | null;
    /** Flush all deferred `get_event` calls for the target ID.  Each queued
     *  request is resolved (or rejected) immediately.  Returns the number of
     *  requests released. */
    __BUZZ_E2E_RELEASE_GET_EVENT__?: () => number;
    /** Count of `get_event` invocations for the current defer-target ID since
     *  the last time `__BUZZ_E2E_DEFER_GET_EVENT__` was set. */
    __BUZZ_E2E_GET_EVENT_CALL_COUNT__?: number;
    /** Hold the next channel read until released. */
    __BUZZ_E2E_DEFER_NEXT_CHANNELS_READ__?: () => void;
    /** Disarm the latch and release the held channel read, if any. */
    __BUZZ_E2E_RELEASE_CHANNELS_READ__?: () => number;
    /** Number of channel reads currently held by the seam. */
    __BUZZ_E2E_CHANNELS_READ_PENDING__?: number;
    /** Release all link-preview metadata commands held by the mock bridge. */
    __BUZZ_E2E_RELEASE_LINK_PREVIEW_METADATA__?: () => number;
    /** Release link-preview uploads held before mock-native registration. */
    __BUZZ_E2E_RELEASE_LINK_PREVIEW_UPLOADS__?: () => number;
    /** Flush every `get_thread_replies` call held by `deferThreadReplies`.
     *  Returns the number of held requests released. */
    __BUZZ_E2E_RELEASE_THREAD_REPLIES__?: () => number;
    /** Number of `get_thread_replies` calls currently held by
     *  `deferThreadReplies`. */
    __BUZZ_E2E_THREAD_REPLIES_PENDING__?: () => number;
    /** Start or stop holding `get_users_batch` responses. Turning the hold off
     *  flushes everything held; either call returns the number released, so a
     *  spec can prove a relay identity lookup was genuinely pinned open. */
    __BUZZ_E2E_HOLD_USERS_BATCH__?: (hold: boolean) => number;
    /** Number of `get_users_batch` calls currently held. */
    __BUZZ_E2E_USERS_BATCH_PENDING__?: () => number;
    /** Release every `get_profile` response held by `deferProfileReads`. */
    __BUZZ_E2E_RELEASE_PROFILE_READS__?: () => number;
    /** Number of `get_profile` responses currently held. */
    __BUZZ_E2E_PROFILE_READS_PENDING__?: () => number;
    /** Uploads that passed mock-native registration and began relay work. */
    __BUZZ_E2E_LINK_PREVIEW_UPLOAD_STARTS__?: number;
    /** Hold renderer-owned media fetches until their cancellation command. */
    __BUZZ_E2E_HOLD_MEDIA_FETCHES__?: boolean;
    /** Exact active/peak native media-fetch ownership for scheduler tests. */
    __BUZZ_E2E_MEDIA_FETCH_STATE__?: { active: number; peak: number };
  }
}

const DEFAULT_RELAY_HTTP_URL = "http://localhost:3000";
const DEFAULT_RELAY_WS_URL = "ws://localhost:3000";

// Deletion markers the relay attaches to a channel window as aux events.
const KIND_DELETION = 5; // NIP-09 deletion
const KIND_NIP29_DELETION = 9005;
const CHANNEL_WINDOW_AUX_KINDS = new Set([KIND_DELETION, KIND_NIP29_DELETION]);

// Fake media-proxy port the mock answers for `get_media_proxy_port`, so
// `rewriteRelayUrl()` produces a real `http://127.0.0.1:<port>/media/...` src
// in e2e (instead of the `buzz-media://` fallback). The reaction guard
// asserts against this exact port.
const MOCK_MEDIA_PROXY_PORT = 54321;
let mockMediaProxyPort = MOCK_MEDIA_PROXY_PORT;

// A reaction-target message seeded into `general` with a real 64-hex event id.
// The reaction guard reacts to THIS message: getReactionTargetId() only accepts
// a 64-hex `e` tag, and the other mock seeds (and user-sent messages) use short
// non-hex ids, so they can't be reaction targets. Content is distinctive so the
// test locates its row without relying on seed ordering.
const REACTION_TARGET_EVENT_ID = "d".repeat(64);
const REACTION_TARGET_CONTENT = "React to me with a custom emoji";
// System-message reaction target id (kind:40099 join event). Distinct 64-hex
// id so it is a valid reaction target and never collides with the regular
// REACTION_TARGET_EVENT_ID.
const SYSTEM_REACTION_TARGET_EVENT_ID = "e".repeat(64);
/** Stands in for `tauri.conf.json`'s version, which no mock IPC call can read. */
const MOCK_APP_VERSION = "0.0.0-e2e";
const DEFAULT_MOCK_IDENTITY = {
  pubkey: "deadbeef".repeat(8),
  display_name: "npub1mock...",
};
const DEFAULT_REAL_IDENTITY = {
  privateKey:
    "3dbaebadb5dfd777ff25149ee230d907a15a9e1294b40b830661e65bb42f6c03",
  pubkey: "e5ebc6cdb579be112e336cc319b5989b4bb6af11786ea90dbe52b5f08d741b34",
  username: "tyler",
} satisfies TestIdentity;

const ALICE_PUBKEY =
  "953d3363262e86b770419834c53d2446409db6d918a57f8f339d495d54ab001f";
const BOB_PUBKEY =
  "bb22a5299220cad76ffd46190ccbeede8ab5dc260faa28b6e5a2cb31b9aff260";
const CHARLIE_PUBKEY =
  "554cef57437abac34522ac2c9f0490d685b72c80478cf9f7ed6f9570ee8624ea";
const OUTSIDER_PUBKEY =
  "df8e91b86fda13a9a67896df77232f7bdab2ba9c3e165378e1ba3d24c13a328e";
// A non-member human whose display name has a space in it. Multi-word names are
// the case a plain-text copy cannot recover — "@John Smith" is indistinguishable
// from "@John" followed by a word — so the clipboard round-trip fixtures use it.
const MULTI_WORD_NON_MEMBER_PUBKEY =
  "7c1f2ad0b4e93856a1d0c2f4e6b8093a5d7f1c3e5a79b1d3f5072a4c6e80931b";
const PROFILE_ONLY_AGENT_PUBKEY =
  "8f83d6b7f3d74f7d933ae3a54dd8c6cc85c7f98e531c16e5a827b953441a8d67";
// A relay-classified bot agent whose declared NIP-OA owner is the mock viewer,
// but which is NOT locally managed. This is the fixture that exercises the
// sidebar's owner-gate path (`viewerIsOwner`), distinct from the local-managed
// path that `mira` (profile-only) and managed-agent fixtures cover.
const OWNED_RELAY_AGENT_PUBKEY =
  "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00";
const MOCK_IDENTITY_PUBKEY = DEFAULT_MOCK_IDENTITY.pubkey;
const STARTER_GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const STARTER_PROJECT_HOME_CHANNEL_ID = "cf63feec-21bb-5bf0-a2f8-0e4c3de8ec73";
const STARTER_WELCOME_CHANNEL_ID = "5f0b1b3c-2a37-5366-9b8c-31a4b21d8e77";
const STARTER_GENERAL_CHANNEL_NAME = "general";
const STARTER_WELCOME_CHANNEL_NAME = "welcome-everyone";

// Tracks whether `persist_current_identity` has cleared
// the lost flag set by `mock.identityLost`. Reset to false on each fresh page
// load (module re-evaluation), so tests start in a clean state.
let mockIdentityLostCleared = false;
let identityReadCount = 0;
let identityReadErrorConsumed = false;

// ── get_event defer/release seam ────────────────────────────────────────────
// When `window.__BUZZ_E2E_DEFER_GET_EVENT__` is set to a target event ID,
// `handleGetEvent` holds calls for that ID in this queue.  All other event IDs
// continue to resolve immediately.
// `window.__BUZZ_E2E_RELEASE_GET_EVENT__()` flushes the queue and returns the
// count of released requests, giving the race test a deterministic way to prove
// that a mid-flight feedItems update does NOT cancel the in-flight promise for
// the specific cold anchor under test.
type DeferredGetEvent = {
  resolve: (value: string) => void;
  reject: (reason: unknown) => void;
  run: () => Promise<string>;
};
let deferredGetEventQueue: DeferredGetEvent[] = [];
let deferredLinkPreviewMetadataQueue: Array<() => void> = [];
let deferredLinkPreviewUploadQueue: Array<() => void> = [];
let deferredThreadRepliesQueue: Array<() => void> = [];
type DeferredProfileRead = {
  reject: (reason: unknown) => void;
  resolve: (value: unknown) => void;
  run: () => Promise<unknown>;
};
let deferredProfileReadQueue: DeferredProfileRead[] = [];
let profileReadsReleased = false;
// ── get_users_batch hold seam ───────────────────────────────────────────────
// Toggled at runtime by `__BUZZ_E2E_HOLD_USERS_BATCH__(hold)` rather than fixed
// at boot by a mock-config flag, because a mention-identity spec needs both
// sides of the hold in one page: profiles resolved normally first (so one paste
// verifies instantly from local state), then the relay lookup pinned open (so a
// second paste of the same label is provably still deciding).
let holdUsersBatch = false;
let heldUsersBatchReleases: Array<() => void> = [];
let cancelledMediaUploadIds = new Set<string>();
let cancelledMediaFetchIds = new Set<string>();
let mockMediaFetchControllers = new Map<string, AbortController>();
let deferNextChannelsRead = false;
let deferredChannelsReadResolve: (() => void) | null = null;

const mockDisplayNames = new Map<string, string>([
  [MOCK_IDENTITY_PUBKEY, DEFAULT_MOCK_IDENTITY.display_name],
  [ALICE_PUBKEY, "alice"],
  [BOB_PUBKEY, "bob"],
  [CHARLIE_PUBKEY, "charlie"],
  [PROFILE_ONLY_AGENT_PUBKEY, "mira"],
  [OWNED_RELAY_AGENT_PUBKEY, "nadia"],
  [OUTSIDER_PUBKEY, "outsider"],
  [MULTI_WORD_NON_MEMBER_PUBKEY, "John Smith"],
  [DEFAULT_REAL_IDENTITY.pubkey, DEFAULT_REAL_IDENTITY.username],
]);
const mockAgentPubkeys = new Set([
  ALICE_PUBKEY,
  CHARLIE_PUBKEY,
  PROFILE_ONLY_AGENT_PUBKEY,
  OWNED_RELAY_AGENT_PUBKEY,
]);
// Kind-0 `name` aliases, distinct from the display name, for exercising the
// alias-tolerant mention resolution path (e.g. a message that says "@bobby"
// while bob's display name is "bob").
const mockKind0Names = new Map<string, string>([[BOB_PUBKEY, "bobby"]]);

function isoMinutesAgo(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function cloneMembers(members: RawChannelMember[]): RawChannelMember[] {
  return members.map((member) => ({ ...member }));
}

function toRawChannel(
  channel: MockChannel,
  config?: E2eConfig,
): RawChannelWithMembership {
  const currentPubkey = getMockMemberPubkey(config).toLowerCase();

  return {
    id: channel.id,
    name: channel.name,
    channel_type: channel.channel_type,
    visibility: channel.visibility,
    description: channel.description,
    topic: channel.topic,
    purpose: channel.purpose,
    member_count: channel.member_count,
    member_pubkeys: channel.members.map((member) => member.pubkey),
    last_message_at: channel.last_message_at,
    archived_at: channel.archived_at,
    participants: [...channel.participants],
    participant_pubkeys: [...channel.participant_pubkeys],
    ttl_seconds: channel.ttl_seconds ?? null,
    ttl_deadline: channel.ttl_deadline ?? null,
    is_member: channel.members.some(
      (member) => member.pubkey.toLowerCase() === currentPubkey,
    ),
  };
}

function toRawChannelDetail(
  channel: MockChannel,
  config?: E2eConfig,
): RawChannelDetail {
  return {
    ...toRawChannel(channel, config),
    created_by: channel.created_by,
    created_at: channel.created_at,
    updated_at: channel.updated_at,
    topic_set_by: channel.topic_set_by,
    topic_set_at: channel.topic_set_at,
    purpose_set_by: channel.purpose_set_by,
    purpose_set_at: channel.purpose_set_at,
    topic_required: channel.topic_required,
    max_members: channel.max_members,
    nip29_group_id: channel.nip29_group_id,
  };
}

function createMockMember(
  pubkey: string,
  role: RawChannelMember["role"],
  joinedMinutesAgo: number,
): RawChannelMember {
  return {
    pubkey,
    role,
    is_agent: role === "bot" || mockAgentPubkeys.has(pubkey),
    joined_at: isoMinutesAgo(joinedMinutesAgo),
    display_name: mockDisplayNames.get(pubkey) ?? null,
  };
}

function createMockChannel(
  seed: Omit<
    MockChannel,
    | "created_at"
    | "member_count"
    | "members"
    | "updated_at"
    | "participant_pubkeys"
    | "participants"
    | "ttl_seconds"
    | "ttl_deadline"
  > & {
    created_minutes_ago: number;
    members: RawChannelMember[];
    participant_pubkeys?: string[];
    participants?: string[];
    ttl_seconds?: number | null;
    ttl_deadline?: string | null;
    updated_minutes_ago?: number;
  },
): MockChannel {
  return {
    ...seed,
    created_at: isoMinutesAgo(seed.created_minutes_ago),
    member_count: seed.members.length,
    members: cloneMembers(seed.members),
    participant_pubkeys: [...(seed.participant_pubkeys ?? [])],
    participants: [...(seed.participants ?? [])],
    ttl_seconds: seed.ttl_seconds ?? null,
    ttl_deadline: seed.ttl_deadline ?? null,
    updated_at: isoMinutesAgo(
      seed.updated_minutes_ago ?? seed.created_minutes_ago,
    ),
  };
}

function syncMockChannel(channel: MockChannel) {
  channel.member_count = channel.members.length;

  if (channel.channel_type !== "dm") {
    return;
  }

  channel.participant_pubkeys = channel.members.map((member) => member.pubkey);
  channel.participants = channel.members.map(
    (member) => member.display_name ?? member.pubkey.slice(0, 8),
  );
}

function touchMockChannel(channel: MockChannel) {
  channel.updated_at = new Date().toISOString();
}

function getMockIdentity() {
  return {
    pubkey: MOCK_IDENTITY_PUBKEY,
    displayName: DEFAULT_MOCK_IDENTITY.display_name,
  };
}

function cloneProfile(profile: RawProfile): RawProfile {
  return { ...profile };
}

function seedMockSearchProfiles(config?: E2eConfig) {
  for (const seed of config?.mock?.searchProfiles ?? []) {
    const pubkey = seed.pubkey.toLowerCase();
    const profile = {
      pubkey,
      display_name: seed.displayName,
      avatar_url: seed.avatarUrl ?? null,
      about: seed.about ?? null,
      nip05_handle: seed.nip05Handle ?? null,
      owner_pubkey: seed.ownerPubkey ?? null,
      is_agent: seed.isAgent ?? false,
      has_profile_event: true,
    };
    mockProfiles.set(pubkey, profile);
    applyMockDisplayName(pubkey, seed.displayName);
    if (seed.isAgent) {
      mockAgentPubkeys.add(pubkey);
    }
  }
}

function getMockProfileByPubkey(pubkey: string): RawProfile | null {
  const normalizedPubkey = pubkey.toLowerCase();
  const existing = mockProfiles.get(normalizedPubkey);
  if (existing) {
    return existing;
  }

  if (!mockDisplayNames.has(normalizedPubkey)) {
    return null;
  }

  return {
    pubkey: normalizedPubkey,
    display_name: mockDisplayNames.get(normalizedPubkey) ?? null,
    name: mockKind0Names.get(normalizedPubkey) ?? null,
    avatar_url: null,
    about: null,
    nip05_handle: null,
    owner_pubkey: null,
    is_agent: mockAgentPubkeys.has(normalizedPubkey),
    has_profile_event: true,
  };
}

function listMockProfiles(): RawProfile[] {
  const pubkeys = new Set<string>([
    ...mockProfiles.keys(),
    ...mockDisplayNames.keys(),
    DEFAULT_REAL_IDENTITY.pubkey,
  ]);

  return [...pubkeys]
    .map((pubkey) => getMockProfileByPubkey(pubkey))
    .filter((profile): profile is RawProfile => profile !== null);
}

function listMockChannels(config?: E2eConfig): RawChannelWithMembership[] {
  return mockChannels.map((channel) => toRawChannel(channel, config));
}

function getMockChannel(channelId: string): MockChannel {
  const channel = mockChannels.find((candidate) => candidate.id === channelId);
  if (!channel) {
    throw new Error(`Channel ${channelId} not found.`);
  }

  return channel;
}

function getMockMemberPubkey(config: E2eConfig | undefined): string {
  return getActiveIdentity(config)?.pubkey ?? getMockIdentity().pubkey;
}

function getMockMemberDisplayName(config: E2eConfig | undefined): string {
  return getActiveIdentity(config)?.username ?? getMockIdentity().displayName;
}

const mockChannels: MockChannel[] = [
  createMockChannel({
    id: STARTER_GENERAL_CHANNEL_ID,
    name: STARTER_GENERAL_CHANNEL_NAME,
    channel_type: "stream",
    visibility: "open",
    description: "General discussion for everyone",
    topic: "Company-wide updates",
    purpose: "Coordinate day-to-day work and unblock the team.",
    last_message_at: isoMinutesAgo(5),
    archived_at: null,
    created_by: MOCK_IDENTITY_PUBKEY,
    topic_set_by: MOCK_IDENTITY_PUBKEY,
    topic_set_at: isoMinutesAgo(90),
    purpose_set_by: MOCK_IDENTITY_PUBKEY,
    purpose_set_at: isoMinutesAgo(80),
    topic_required: false,
    max_members: null,
    nip29_group_id: null,
    created_minutes_ago: 1440,
    updated_minutes_ago: 5,
    members: [
      createMockMember(MOCK_IDENTITY_PUBKEY, "owner", 1440),
      createMockMember(ALICE_PUBKEY, "admin", 1200),
      createMockMember(BOB_PUBKEY, "member", 960),
      createMockMember(PROFILE_ONLY_AGENT_PUBKEY, "member", 840),
    ],
  }),
  createMockChannel({
    id: STARTER_PROJECT_HOME_CHANNEL_ID,
    name: "buzz",
    channel_type: "stream",
    visibility: "open",
    description: "Project home for the Buzz community platform.",
    topic: null,
    purpose: null,
    last_message_at: null,
    archived_at: null,
    created_by: MOCK_IDENTITY_PUBKEY,
    topic_set_by: null,
    topic_set_at: null,
    purpose_set_by: null,
    purpose_set_at: null,
    topic_required: false,
    max_members: null,
    nip29_group_id: null,
    created_minutes_ago: 1440,
    updated_minutes_ago: 1440,
    members: [createMockMember(MOCK_IDENTITY_PUBKEY, "owner", 1440)],
  }),
  createMockChannel({
    id: STARTER_WELCOME_CHANNEL_ID,
    name: STARTER_WELCOME_CHANNEL_NAME,
    channel_type: "stream",
    visibility: "open",
    description: "Say hi, ask a question, or share what brought you here.",
    topic: null,
    purpose: null,
    last_message_at: null,
    archived_at: null,
    created_by: MOCK_IDENTITY_PUBKEY,
    topic_set_by: null,
    topic_set_at: null,
    purpose_set_by: null,
    purpose_set_at: null,
    topic_required: false,
    max_members: null,
    nip29_group_id: null,
    created_minutes_ago: 1440,
    updated_minutes_ago: 1440,
    members: [createMockMember(MOCK_IDENTITY_PUBKEY, "owner", 1440)],
  }),
  createMockChannel({
    id: "9dae0116-799b-5071-a0a8-fdd30a91a35d",
    name: "random",
    channel_type: "stream",
    visibility: "open",
    description: "Off-topic, fun stuff",
    topic: null,
    purpose: null,
    last_message_at: null,
    archived_at: null,
    created_by: ALICE_PUBKEY,
    topic_set_by: null,
    topic_set_at: null,
    purpose_set_by: null,
    purpose_set_at: null,
    topic_required: false,
    max_members: null,
    nip29_group_id: null,
    created_minutes_ago: 1400,
    updated_minutes_ago: 1400,
    members: [
      createMockMember(ALICE_PUBKEY, "owner", 1400),
      createMockMember(MOCK_IDENTITY_PUBKEY, "member", 1300),
      createMockMember(BOB_PUBKEY, "member", 1000),
    ],
  }),
  // Reproduces the all-replies-window regression (NIP-RS Fix A): a busy
  // single-thread channel whose top-level root has scrolled past the history
  // limit. `last_message_at` is a far-future timestamp standing in for the
  // backend's reply-inclusive MAX(created_at) — it is NEWER than any top-level
  // message the window can load, so falling back to it would advance the
  // channel marker past unread replies. Seeded as its own channel so existing
  // channels' unread state is undisturbed.
  createMockChannel({
    id: "fa11bac0-0000-4000-8000-000000000012",
    name: "all-replies",
    channel_type: "stream",
    visibility: "open",
    description: "Single-thread channel with the root past the history limit",
    topic: null,
    purpose: null,
    last_message_at: new Date("2999-01-01T00:00:00.000Z").toISOString(),
    archived_at: null,
    created_by: ALICE_PUBKEY,
    topic_set_by: null,
    topic_set_at: null,
    purpose_set_by: null,
    purpose_set_at: null,
    topic_required: false,
    max_members: null,
    nip29_group_id: null,
    created_minutes_ago: 1400,
    updated_minutes_ago: 1400,
    members: [
      createMockMember(ALICE_PUBKEY, "owner", 1400),
      createMockMember(MOCK_IDENTITY_PUBKEY, "member", 1300),
    ],
  }),
  createMockChannel({
    id: "b5e2f8a1-3c44-5912-9e67-4a8d1f2b3c4e",
    name: "design",
    channel_type: "stream",
    visibility: "open",
    description: "Design system and UX discussions with engineering partners",
    topic: null,
    purpose: null,
    last_message_at: isoMinutesAgo(120),
    archived_at: null,
    created_by: ALICE_PUBKEY,
    topic_set_by: null,
    topic_set_at: null,
    purpose_set_by: null,
    purpose_set_at: null,
    topic_required: false,
    max_members: null,
    nip29_group_id: null,
    created_minutes_ago: 1350,
    updated_minutes_ago: 120,
    members: [
      createMockMember(ALICE_PUBKEY, "owner", 1350),
      createMockMember(BOB_PUBKEY, "member", 1100),
    ],
  }),
  createMockChannel({
    id: "c6f3a9b2-4d55-5a23-bf78-5b9e2g3c5d6f",
    name: "sales",
    channel_type: "stream",
    visibility: "open",
    description: "Sales team coordination and pipeline updates",
    topic: "Q1 targets",
    purpose: null,
    last_message_at: isoMinutesAgo(30),
    archived_at: null,
    created_by: BOB_PUBKEY,
    topic_set_by: BOB_PUBKEY,
    topic_set_at: isoMinutesAgo(200),
    purpose_set_by: null,
    purpose_set_at: null,
    topic_required: false,
    max_members: null,
    nip29_group_id: null,
    created_minutes_ago: 1300,
    updated_minutes_ago: 30,
    members: [
      createMockMember(BOB_PUBKEY, "owner", 1300),
      createMockMember(CHARLIE_PUBKEY, "member", 900),
    ],
  }),
  createMockChannel({
    id: "1c7e1c02-87bb-5e88-b2da-5a7a9432d0c9",
    name: "engineering",
    channel_type: "stream",
    visibility: "open",
    description: "Engineering discussions",
    topic: "Desktop release train",
    purpose: "Track implementation details and release readiness.",
    last_message_at: isoMinutesAgo(42),
    archived_at: null,
    created_by: ALICE_PUBKEY,
    topic_set_by: ALICE_PUBKEY,
    topic_set_at: isoMinutesAgo(120),
    purpose_set_by: ALICE_PUBKEY,
    purpose_set_at: isoMinutesAgo(130),
    topic_required: false,
    max_members: null,
    nip29_group_id: null,
    created_minutes_ago: 1320,
    updated_minutes_ago: 42,
    members: [
      createMockMember(ALICE_PUBKEY, "owner", 1320),
      createMockMember(MOCK_IDENTITY_PUBKEY, "member", 1180),
      createMockMember(BOB_PUBKEY, "member", 900),
    ],
  }),
  createMockChannel({
    id: "94a444a4-c0a3-5966-ab05-530c6ddc2301",
    name: "agents",
    channel_type: "stream",
    visibility: "open",
    description: "AI agent testing and collaboration",
    topic: "Coordination board",
    purpose: "Track agent work and relay activity.",
    last_message_at: isoMinutesAgo(15),
    archived_at: null,
    created_by: MOCK_IDENTITY_PUBKEY,
    topic_set_by: MOCK_IDENTITY_PUBKEY,
    topic_set_at: isoMinutesAgo(60),
    purpose_set_by: MOCK_IDENTITY_PUBKEY,
    purpose_set_at: isoMinutesAgo(65),
    topic_required: false,
    max_members: null,
    nip29_group_id: null,
    created_minutes_ago: 1000,
    updated_minutes_ago: 15,
    members: [
      createMockMember(MOCK_IDENTITY_PUBKEY, "owner", 1000),
      createMockMember(CHARLIE_PUBKEY, "bot", 800),
      createMockMember(OWNED_RELAY_AGENT_PUBKEY, "member", 600),
    ],
  }),
  createMockChannel({
    id: "3c2d9f0a-1b44-5e77-9a21-6f8b0c4d2e91",
    name: "secret-projects",
    channel_type: "stream",
    visibility: "private",
    description: "Private project room",
    topic: "Skunkworks",
    purpose: "Coordinate confidential project work.",
    last_message_at: null,
    archived_at: null,
    created_by: ALICE_PUBKEY,
    topic_set_by: ALICE_PUBKEY,
    topic_set_at: isoMinutesAgo(120),
    purpose_set_by: ALICE_PUBKEY,
    purpose_set_at: isoMinutesAgo(130),
    topic_required: false,
    max_members: null,
    nip29_group_id: null,
    created_minutes_ago: 600,
    updated_minutes_ago: 120,
    members: [
      createMockMember(ALICE_PUBKEY, "owner", 600),
      createMockMember(MOCK_IDENTITY_PUBKEY, "member", 540),
    ],
  }),
  createMockChannel({
    id: "f48efb06-0c93-5025-aac9-2e646bb6bfa8",
    name: "alice-tyler",
    channel_type: "dm",
    visibility: "private",
    description: "DM between alice and tyler",
    topic: null,
    purpose: null,
    last_message_at: null,
    archived_at: null,
    created_by: ALICE_PUBKEY,
    topic_set_by: null,
    topic_set_at: null,
    purpose_set_by: null,
    purpose_set_at: null,
    topic_required: false,
    max_members: 2,
    nip29_group_id: null,
    created_minutes_ago: 720,
    updated_minutes_ago: 720,
    participants: ["alice", "tyler"],
    participant_pubkeys: [ALICE_PUBKEY, MOCK_IDENTITY_PUBKEY],
    members: [
      createMockMember(ALICE_PUBKEY, "member", 720),
      createMockMember(MOCK_IDENTITY_PUBKEY, "member", 720),
    ],
  }),
  createMockChannel({
    id: "7eb9f239-9393-50b0-bd76-d85eef0511c7",
    name: "bob-tyler",
    channel_type: "dm",
    visibility: "private",
    description: "DM between bob and tyler",
    topic: null,
    purpose: null,
    last_message_at: null,
    archived_at: null,
    created_by: BOB_PUBKEY,
    topic_set_by: null,
    topic_set_at: null,
    purpose_set_by: null,
    purpose_set_at: null,
    topic_required: false,
    max_members: 2,
    nip29_group_id: null,
    created_minutes_ago: 700,
    updated_minutes_ago: 700,
    participants: ["bob", "tyler"],
    participant_pubkeys: [BOB_PUBKEY, MOCK_IDENTITY_PUBKEY],
    members: [
      createMockMember(BOB_PUBKEY, "member", 700),
      createMockMember(MOCK_IDENTITY_PUBKEY, "member", 700),
    ],
  }),
  // Generic-named DM — name is "DM" so resolveChannelDisplayLabel must resolve
  // the participant display name instead of returning the raw channel name.
  // Used by agent-snapshot-send.spec.ts to prove picker/search/memgate/done
  // all use the same resolved label from useUsersBatchQuery.
  createMockChannel({
    id: "d1ec7000-d000-4000-8000-000000000001",
    name: "DM",
    channel_type: "dm",
    visibility: "private",
    description: "Generic-named DM with charlie",
    topic: null,
    purpose: null,
    last_message_at: null,
    archived_at: null,
    created_by: CHARLIE_PUBKEY,
    topic_set_by: null,
    topic_set_at: null,
    purpose_set_by: null,
    purpose_set_at: null,
    topic_required: false,
    max_members: 2,
    nip29_group_id: null,
    created_minutes_ago: 680,
    updated_minutes_ago: 680,
    participants: ["charlie", "tyler"],
    participant_pubkeys: [CHARLIE_PUBKEY, MOCK_IDENTITY_PUBKEY],
    members: [
      createMockMember(CHARLIE_PUBKEY, "member", 680),
      createMockMember(MOCK_IDENTITY_PUBKEY, "member", 680),
    ],
  }),
  // Generic-named Group DM — name "Group DM (3)" so resolveChannelDisplayLabel
  // must resolve all OTHER participants' display names (bob, charlie).
  // Used by agent-snapshot-send.spec.ts group-DM label test.
  // NOTE: participants are BOB + CHARLIE (not ALICE, which conflicts with
  // ANALYST_PUBKEY in managed-agent tests).
  createMockChannel({
    id: "d1ec7000-d000-4000-8000-000000000003",
    name: "Group DM (3)",
    channel_type: "dm",
    visibility: "private",
    description: "Generic-named group DM with bob and charlie",
    topic: null,
    purpose: null,
    last_message_at: null,
    archived_at: null,
    created_by: BOB_PUBKEY,
    topic_set_by: null,
    topic_set_at: null,
    purpose_set_by: null,
    purpose_set_at: null,
    topic_required: false,
    max_members: 3,
    nip29_group_id: null,
    created_minutes_ago: 660,
    updated_minutes_ago: 660,
    participants: ["bob", "charlie", "tyler"],
    participant_pubkeys: [BOB_PUBKEY, CHARLIE_PUBKEY, MOCK_IDENTITY_PUBKEY],
    members: [
      createMockMember(BOB_PUBKEY, "member", 660),
      createMockMember(CHARLIE_PUBKEY, "member", 660),
      createMockMember(MOCK_IDENTITY_PUBKEY, "member", 660),
    ],
  }),
  // Deep history channel for the load-older-under-virtualization E2E. Seeded
  // with more messages than CHANNEL_HISTORY_LIMIT (300) so the initial load
  // windows to the newest page and a `fetchOlder` (until-cursor) prepend has
  // genuinely older rows to add — exercising the scroll-restore anchor under
  // virtualization. Its own channel so existing channels' row-index and unread
  // assertions stay undisturbed.
  createMockChannel({
    id: "feedf00d-0000-4000-8000-000000000007",
    name: "deep-history",
    channel_type: "stream",
    visibility: "open",
    description: "Channel with paginated history for load-older tests",
    topic: null,
    purpose: null,
    last_message_at: isoMinutesAgo(1),
    archived_at: null,
    created_by: ALICE_PUBKEY,
    topic_set_by: null,
    topic_set_at: null,
    purpose_set_by: null,
    purpose_set_at: null,
    topic_required: false,
    max_members: null,
    nip29_group_id: null,
    created_minutes_ago: 2000,
    updated_minutes_ago: 1,
    members: [
      createMockMember(ALICE_PUBKEY, "owner", 2000),
      createMockMember(MOCK_IDENTITY_PUBKEY, "member", 1900),
    ],
  }),
];

const mockMessages = new Map<string, RelayEvent[]>();
const deferredSendMessageLiveEchoes: Array<{
  channelId: string;
  event: RelayEvent;
}> = [];
const mockSockets = new Map<number, MockSocket>();
const mockAuthResponses: Array<{ success: boolean; message: string }> = [];
const mockChannelHistoryCloses: string[] = [];
let mockWebsocketUnavailable = false;
const relayWebsocketConnectAttemptStarts: number[] = [];
let mockAuthSigningAttempts = 0;
let mockWebsocketSendMutexWedged = false;
let mockClosedChannelLiveSubscription = false;
const realSockets = new Map<number, WebSocket>();

type MockObservedUnreadScope = {
  generation: string;
  revision: number;
  lastSequence: number;
  migrationComplete: boolean;
  events: Map<
    string,
    {
      channelId: string;
      id: string;
      createdAt: number;
      rootId: string | null;
      highPriority: boolean;
      countsTowardBadge: boolean;
      countsTowardAppBadge: boolean;
    }
  >;
  channelLatest: Map<string, number>;
  markers: Map<string, number>;
};

const mockObservedUnreadScopes = new Map<string, MockObservedUnreadScope>();

function mockObservedUnreadScopeKey(scope: {
  pubkey: string;
  relayUrl: string;
}) {
  return `${scope.pubkey.trim().toLowerCase()}:${scope.relayUrl
    .trim()
    .replace(/\/+$/, "")}`;
}

function getMockObservedUnreadScope(scope: {
  pubkey: string;
  relayUrl: string;
}) {
  const key = mockObservedUnreadScopeKey(scope);
  const existing = mockObservedUnreadScopes.get(key);
  if (existing) return existing;
  const created: MockObservedUnreadScope = {
    generation: "e2e",
    revision: 0,
    lastSequence: 0,
    migrationComplete: false,
    events: new Map(),
    channelLatest: new Map(),
    markers: new Map(),
  };
  mockObservedUnreadScopes.set(key, created);
  return created;
}

function mockObservedUnreadProjections(
  scope: MockObservedUnreadScope,
): ObservedUnreadProjection[] {
  const channels = new Map<string, ObservedUnreadProjection>();
  for (const [channelId, latest] of scope.channelLatest) {
    channels.set(channelId, {
      channelId,
      latest,
      count: 0,
      badgeCount: 0,
      appBadgeCount: 0,
      topLevelUnread: false,
      highPriorityCount: 0,
    });
  }
  for (const event of scope.events.values()) {
    let readAt = Math.max(
      scope.markers.get(event.channelId) ?? 0,
      scope.markers.get(`msg:${event.id}`) ?? 0,
    );
    if (event.rootId) {
      readAt = Math.max(
        readAt,
        scope.markers.get(`thread:${event.rootId}`) ?? 0,
      );
    }
    if (event.createdAt <= readAt) continue;
    const projection = channels.get(event.channelId) ?? {
      channelId: event.channelId,
      latest: 0,
      count: 0,
      badgeCount: 0,
      appBadgeCount: 0,
      topLevelUnread: false,
      highPriorityCount: 0,
    };
    projection.latest = Math.max(projection.latest, event.createdAt);
    projection.count += 1;
    projection.badgeCount += event.countsTowardBadge ? 1 : 0;
    projection.appBadgeCount += event.countsTowardAppBadge ? 1 : 0;
    projection.topLevelUnread ||= event.rootId === null;
    projection.highPriorityCount += event.highPriority ? 1 : 0;
    channels.set(event.channelId, projection);
  }
  return [...channels.values()].sort((left, right) =>
    left.channelId.localeCompare(right.channelId),
  );
}

function resetMockObservedUnread() {
  mockObservedUnreadScopes.clear();
}
const openedExternalUrls: string[] = [];

const mockProfiles = new Map<string, RawProfile>([
  [
    MOCK_IDENTITY_PUBKEY,
    {
      pubkey: MOCK_IDENTITY_PUBKEY,
      display_name: DEFAULT_MOCK_IDENTITY.display_name,
      avatar_url: null,
      about: null,
      nip05_handle: null,
      owner_pubkey: null,
      is_agent: false,
      has_profile_event: true,
    },
  ],
  // alice, bob, and charlie are intentionally NOT seeded here — they are
  // covered by mockDisplayNames + mockAgentPubkeys and synthesised on demand
  // by getMockProfileByPubkey. Static seeds would cause ensureMockProfile to
  // return has_profile_event:true when alice/bob/charlie are used as the
  // active first-run identity, incorrectly skipping onboarding page 1.
  [
    PROFILE_ONLY_AGENT_PUBKEY,
    {
      pubkey: PROFILE_ONLY_AGENT_PUBKEY,
      display_name: "mira",
      avatar_url: null,
      about: null,
      nip05_handle: null,
      owner_pubkey: MOCK_IDENTITY_PUBKEY,
      is_agent: true,
      has_profile_event: true,
    },
  ],
  [
    OWNED_RELAY_AGENT_PUBKEY,
    {
      pubkey: OWNED_RELAY_AGENT_PUBKEY,
      display_name: "nadia",
      avatar_url: null,
      about: null,
      nip05_handle: null,
      owner_pubkey: MOCK_IDENTITY_PUBKEY,
      is_agent: true,
      has_profile_event: true,
    },
  ],
]);
const mockFeedMentionOverrides: RawFeedItem[] = [];

let installed = false;
let nextSocketId = 1;

function getConfig(): E2eConfig | undefined {
  return window.__BUZZ_E2E__;
}

function isRelayMode(config: E2eConfig | undefined): boolean {
  return config?.mode === "relay";
}

function getRelayHttpUrl(config: E2eConfig | undefined): string {
  return config?.relayHttpUrl ?? DEFAULT_RELAY_HTTP_URL;
}

function getRelayWsUrl(config: E2eConfig | undefined): string {
  return config?.relayWsUrl ?? DEFAULT_RELAY_WS_URL;
}

/**
 * Mirror of the backend's `assert_expected_relay_scope`: a caller-captured
 * tenant scope must still match the active community when the command runs.
 * The mock's "active relay" is the active community's relayUrl in
 * localStorage (specs switch communities by rewriting it), falling back to
 * the configured mock relay. Lets specs drive the mid-flight community
 * switch with `openDmDelayMs` / `sendMessageDelayMs` and prove the send
 * fails closed.
 */
function assertExpectedRelayScope(
  expectedRelayUrl: string | null | undefined,
  config: E2eConfig | undefined,
): void {
  const expected = expectedRelayUrl?.trim();
  if (!expected) return;
  let active: string | null = null;
  try {
    const activeId = window.localStorage.getItem("buzz-active-community-id");
    const communities = JSON.parse(
      window.localStorage.getItem("buzz-communities") ?? "[]",
    ) as { id: string; relayUrl: string }[];
    active =
      communities.find((community) => community.id === activeId)?.relayUrl ??
      null;
  } catch {
    active = null;
  }
  if (
    normalizeMockRelayUrl(active ?? getRelayWsUrl(config)) !==
    normalizeMockRelayUrl(expected)
  ) {
    throw new Error(
      "active community changed before the message was submitted; not sent",
    );
  }
}

/** Same ws(s) normalization the app applies to community relay URLs. */
function normalizeMockRelayUrl(url: string): string {
  if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
    return `wss://${url}`;
  }
  return url;
}

/**
 * Mirror of the backend's `assert_expected_signer`: a caller-captured signer
 * identity must still match the active identity when the command runs. The
 * real backend reads relay and keys under separate locks, so the signer scope
 * is asserted independently of the relay scope.
 */
function assertExpectedSigner(
  expectedSignerPubkey: string | null | undefined,
  config: E2eConfig | undefined,
): void {
  const expected = expectedSignerPubkey?.trim();
  if (!expected) return;
  const active = getMockMemberPubkey(config);
  if (expected.toLowerCase() !== active.toLowerCase()) {
    throw new Error(
      "active identity changed before the message was submitted; not sent",
    );
  }
}

function getIdentity(config: E2eConfig | undefined): TestIdentity | undefined {
  if (!isRelayMode(config)) {
    return undefined;
  }

  return config?.identity ?? DEFAULT_REAL_IDENTITY;
}

function getActiveIdentity(config: E2eConfig | undefined) {
  return getIdentity(config);
}

function ensureMockProfile(config: E2eConfig | undefined): RawProfile {
  const pubkey = getMockMemberPubkey(config);
  const existing = mockProfiles.get(pubkey);
  if (existing) {
    return existing;
  }

  const displayName = getMockMemberDisplayName(config);
  const profile = {
    pubkey,
    display_name: displayName,
    avatar_url: null,
    about: null,
    nip05_handle: null,
    owner_pubkey: null,
    // Synthesised fallback: no kind:0 event exists on the relay for this
    // identity. Always false regardless of display name so the onboarding
    // gate cannot mistake a blank first-run identity for a returning user.
    has_profile_event: false,
  };
  mockProfiles.set(pubkey, profile);
  return profile;
}

function applyMockDisplayName(pubkey: string, displayName: string | null) {
  if (displayName) {
    mockDisplayNames.set(pubkey, displayName);
  } else {
    mockDisplayNames.delete(pubkey);
  }

  for (const channel of mockChannels) {
    for (const member of channel.members) {
      if (member.pubkey === pubkey) {
        member.display_name = displayName;
      }
    }
    syncMockChannel(channel);
  }
}

function resolveHandler(handler: unknown): WsHandler {
  const deliver = resolveRawHandler(handler);
  // The native plugin coalesces inbound frames and always delivers an array
  // (native_websocket.rs `FrameBatch::flush`). Emitting bare frames here would
  // green the e2e suites against a transport shape production no longer sends.
  return (message) => deliver([message]);
}

function resolveRawHandler(handler: unknown): WsHandler {
  if (typeof handler === "function") {
    return handler as WsHandler;
  }

  if (
    typeof handler === "object" &&
    handler !== null &&
    "onmessage" in handler &&
    typeof handler.onmessage === "function"
  ) {
    return handler.onmessage as WsHandler;
  }

  throw new Error("Invalid websocket message handler.");
}

function sendWsText(handler: WsHandler, payload: unknown[]) {
  handler({
    type: "Text",
    data: JSON.stringify(payload),
  });
}

function sendWsClose(handler: WsHandler, code?: number, reason?: string) {
  handler({
    type: "Close",
    data: code === undefined ? undefined : { code, reason: reason ?? "" },
  });
}

function getChannelIdFromTags(tags: string[][]): string | undefined {
  return tags.find((tag) => tag[0] === "h")?.[1];
}

function getThreadReferenceFromTags(tags: string[][]) {
  const eventTags = tags.filter(
    (tag) => tag[0] === "e" && typeof tag[1] === "string",
  );

  if (eventTags.length === 0) {
    return {
      parentEventId: null,
      rootEventId: null,
    };
  }

  const rootTag = eventTags.find((tag) => tag[3] === "root");
  const replyTag =
    [...eventTags].reverse().find((tag) => tag[3] === "reply") ?? null;

  if (!replyTag) {
    return {
      parentEventId: null,
      rootEventId: null,
    };
  }

  return {
    parentEventId: replyTag[1] ?? null,
    rootEventId: rootTag?.[1] ?? replyTag[1] ?? null,
  };
}

/**
 * A reply broadcast to the channel timeline carries the exact tag
 * `["broadcast", "1"]` (NIP-CW §Top-level Classification).
 */
function isMockBroadcastReply(tags: string[][]): boolean {
  return tags.some((tag) => tag[0] === "broadcast" && tag[1] === "1");
}

/**
 * Mirror the relay's channel-window row set (buzz-db `thread.rs`, NIP-CW
 * §Top-level Classification): an event is a timeline row iff its depth is 0
 * (no reply marker → `rootEventId === null`) OR its depth is 1 (its parent is
 * the thread root) AND it is broadcast. Depth ≥ 2 replies never surface on the
 * timeline. A bare-`rootEventId === null` predicate silently dropped broadcast
 * depth-1 replies the real relay serves.
 */
function isMockTopLevelRow(event: RelayEvent): boolean {
  const { parentEventId, rootEventId } = getThreadReferenceFromTags(event.tags);
  if (rootEventId === null) {
    return true;
  }
  const isDepthOne = parentEventId !== null && parentEventId === rootEventId;
  return isDepthOne && isMockBroadcastReply(event.tags);
}

function appendMentionTags(
  tags: string[][],
  mentionPubkeys: string[] | undefined,
  selfPubkey: string,
) {
  const selfLower = selfPubkey.toLowerCase();
  const seen = new Set<string>([selfLower]);
  for (const pk of mentionPubkeys ?? []) {
    const lower = pk.toLowerCase();
    if (seen.has(lower)) {
      continue;
    }
    seen.add(lower);
    tags.push(["p", lower]);
  }
}

function buildTopLevelMessageTags(
  channelId: string,
  mentionPubkeys: string[] | undefined,
  selfPubkey: string,
) {
  const tags: string[][] = [["h", channelId]];
  appendMentionTags(tags, mentionPubkeys, selfPubkey);
  return tags;
}

function buildReplyMessageTags(
  channelId: string,
  authorPubkey: string,
  parentEventId: string,
  rootEventId: string,
  mentionPubkeys: string[] | undefined,
) {
  // Preserve the reply tag ordering that the desktop message hooks already
  // expect locally: author p, h, mention ps, then thread e-tags.
  const tags: string[][] = [
    ["p", authorPubkey],
    ["h", channelId],
  ];
  appendMentionTags(tags, mentionPubkeys, authorPubkey);

  if (parentEventId === rootEventId) {
    tags.push(["e", rootEventId, "", "reply"]);
    return tags;
  }

  tags.push(["e", rootEventId, "", "root"]);
  tags.push(["e", parentEventId, "", "reply"]);
  return tags;
}

function getMockMessageStore(channelId: string): RelayEvent[] {
  const existing = mockMessages.get(channelId);
  if (existing) {
    return existing;
  }

  const seeded: RelayEvent[] =
    channelId === "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50"
      ? [
          {
            id: "mock-general-welcome",
            pubkey: DEFAULT_MOCK_IDENTITY.pubkey,
            created_at: Math.floor(Date.now() / 1000) - 120,
            kind: 9,
            tags: [["h", channelId]],
            content: "Welcome to #general",
            sig: "mocksig".repeat(20).slice(0, 128),
          },
          // Alice authored — gives e2e specs a non-self profile pane to open
          // by clicking the second message-row's author button. Used by
          // tests/e2e/identity-archive.spec.ts to exercise the admin / OA /
          // none-of-the-above branches of the NIP-IA gate. Both seeds are
          // backdated (welcome at -120s, Alice at -60s) so user-sent messages
          // in other specs always land after both — preserving
          // `message-row.first()` = welcome and `.last()` = sent.
          {
            id: "mock-general-alice",
            pubkey: ALICE_PUBKEY,
            created_at: Math.floor(Date.now() / 1000) - 60,
            kind: 9,
            tags: [["h", channelId]],
            content: "Hey team — checking in.",
            sig: "mocksig".repeat(20).slice(0, 128),
          },
          // Reaction-target seed for the custom-emoji reaction guard. Real
          // 64-hex id so getReactionTargetId() accepts it as a reaction target
          // (the short-id seeds above can't be reacted to). Backdated after the
          // other seeds, so it stays at row index >= 2 and never displaces
          // first()=welcome / nth(1)=alice that other specs rely on.
          {
            id: REACTION_TARGET_EVENT_ID,
            pubkey: ALICE_PUBKEY,
            created_at: Math.floor(Date.now() / 1000) - 45,
            kind: 9,
            tags: [["h", channelId]],
            content: REACTION_TARGET_CONTENT,
            sig: "mocksig".repeat(20).slice(0, 128),
          },
          // System-message reaction target. A kind:40099 join event renders via
          // SystemMessageRow (testid `system-message-row`, NOT `message-row`),
          // so it never displaces the `message-row` index assertions other
          // specs rely on. Real 64-hex id so getReactionTargetId() accepts it
          // as a reaction target — this is the surface the original "react to a
          // system message" bug lived on. Backdated like the other seeds.
          {
            id: SYSTEM_REACTION_TARGET_EVENT_ID,
            pubkey: ALICE_PUBKEY,
            created_at: Math.floor(Date.now() / 1000) - 30,
            kind: KIND_SYSTEM_MESSAGE,
            tags: [["h", channelId]],
            content: JSON.stringify({
              type: "member_joined",
              actor: ALICE_PUBKEY,
              target: ALICE_PUBKEY,
            }),
            sig: "mocksig".repeat(20).slice(0, 128),
          },
        ]
      : channelId === "94a444a4-c0a3-5966-ab05-530c6ddc2301"
        ? [
            // Charlie is a `bot` member of #agents (see channel seed), so this
            // message renders with role="bot" — the surface whose avatar opens
            // a managed-agent profile panel / hover popover with active-turn
            // badges. #agents has no message-row index assertions, so seeding
            // here is safe for existing specs.
            {
              id: "mock-agents-charlie",
              pubkey: CHARLIE_PUBKEY,
              created_at: Math.floor(Date.now() / 1000) - 90,
              kind: 9,
              tags: [["h", channelId]],
              content: "Indexing the channel catalog now.",
              sig: "mocksig".repeat(20).slice(0, 128),
            },
            // Owned remote relay agent: declared-owned by the mock viewer,
            // present in the relay registry, but NOT locally managed. This
            // keeps the profile Runtime-tab owner gate honest.
            {
              id: "mock-agents-owned-relay-nadia",
              pubkey: OWNED_RELAY_AGENT_PUBKEY,
              created_at: Math.floor(Date.now() / 1000) - 85,
              kind: 9,
              tags: [["h", channelId]],
              content: "Indexing remotely for my owner.",
              sig: "mocksig".repeat(20).slice(0, 128),
            },
          ]
        : channelId === "feedf00d-0000-4000-8000-000000000007"
          ? (() => {
              const count = getConfig()?.mock?.deepHistoryMessageCount ?? 600;
              return Array.from({ length: count }, (_, index) => ({
                id: `mock-deep-history-${index}`,
                pubkey: index % 2 === 0 ? ALICE_PUBKEY : MOCK_IDENTITY_PUBKEY,
                created_at:
                  Math.floor(Date.now() / 1000) - (count - index) * 60,
                kind: 9,
                tags: [["h", channelId]],
                content:
                  count > 600
                    ? `Deep history message #${index}\n${"variable wrapped history ".repeat((index % 12) + 1)}`
                    : `Deep history message #${index}`,
                sig: "mocksig".repeat(20).slice(0, 128),
              }));
            })()
          : [];

  mockMessages.set(channelId, seeded);
  return seeded;
}

function prependMockHistory(input: {
  channelName: string;
  count: number;
  startIndex?: number;
  lineCount?: number;
  createdAtStart?: number;
  emit?: boolean;
}) {
  const channel = mockChannels.find(
    (candidate) => candidate.name === input.channelName,
  );
  if (!channel) {
    throw new Error(`Unknown mock channel: ${input.channelName}`);
  }

  const store = getMockMessageStore(channel.id);
  const earliestCreatedAt = store.reduce(
    (earliest, event) => Math.min(earliest, event.created_at),
    Math.floor(Date.now() / 1000),
  );
  const createdAtStart =
    input.createdAtStart ?? earliestCreatedAt - input.count - 1;
  const startIndex = input.startIndex ?? 0;
  const lineCount = input.lineCount ?? 1;

  const events = Array.from({ length: input.count }, (_, offset) => {
    const index = startIndex + offset;
    const body = Array.from(
      { length: lineCount },
      (_unused, lineIndex) => `mock older ${index} line ${lineIndex + 1}`,
    ).join("\n");

    return createMockEvent(
      9,
      body,
      [["h", channel.id]],
      ALICE_PUBKEY,
      createdAtStart + offset,
      `mock-older-${channel.name}-${index}`.replace(/[^a-zA-Z0-9]/g, ""),
    );
  });

  store.unshift(...events);
  store.sort((left, right) => left.created_at - right.created_at);

  if (input.emit) {
    for (const event of events) {
      emitMockLiveEvent(channel.id, event);
    }
  }

  return events;
}

function emitMockHistory(
  socket: MockSocket,
  subId: string,
  channelIds: string[],
  filter: MockFilter,
) {
  const events = channelIds
    .flatMap((channelId) => getMockMessageStore(channelId))
    .filter((event) => {
      if (filter.kinds && !filter.kinds.includes(event.kind)) {
        return false;
      }
      if (filter.since !== undefined && event.created_at < filter.since) {
        return false;
      }
      if (filter.until !== undefined && event.created_at > filter.until) {
        return false;
      }
      return true;
    })
    // Relay order is `created_at DESC, id ASC` — match it (both the WS history
    // page and the `get_channel_messages_before` keyset are backed by that one
    // order in production, so the mock must be self-consistent too, else a
    // same-second slice returned here won't line up with the keyset's tiebreak
    // and the dense-second escape hatch can't prove completeness). Bare `until`
    // still can't advance past a second denser than one page; the composite
    // keyset is the escape hatch.
    .sort(
      (left, right) =>
        right.created_at - left.created_at || left.id.localeCompare(right.id),
    )
    .slice(0, filter.limit ?? 50)
    .sort(
      (left, right) =>
        left.created_at - right.created_at || left.id.localeCompare(right.id),
    );

  const emit = () => {
    for (const event of events) {
      sendWsText(socket.handler, ["EVENT", subId, event]);
    }
    sendWsText(socket.handler, ["EOSE", subId]);
  };

  emit();
}

function emitMockLiveEvent(channelId: string, event: RelayEvent) {
  for (const socket of mockSockets.values()) {
    for (const [subId, subscription] of socket.subscriptions) {
      if (
        (subscription.channelIds.includes(channelId) ||
          subscription.channelIds.includes(GLOBAL_MOCK_SUBSCRIPTION)) &&
        (!subscription.kinds || subscription.kinds.includes(event.kind))
      ) {
        sendWsText(socket.handler, ["EVENT", subId, event]);
      }
    }
  }
}

function emitOrDeferMockSendMessageLiveEcho(
  channelId: string,
  event: RelayEvent,
  config: E2eConfig | undefined,
) {
  if (config?.mock?.deferSendMessageLiveEcho) {
    deferredSendMessageLiveEchoes.push({ channelId, event });
    return;
  }
  emitMockLiveEvent(channelId, event);
}

function hasMockLiveSubscription(channelId: string, kind?: number) {
  for (const socket of mockSockets.values()) {
    for (const subscription of socket.subscriptions.values()) {
      if (
        (subscription.channelIds.includes(channelId) ||
          subscription.channelIds.includes(GLOBAL_MOCK_SUBSCRIPTION)) &&
        (kind === undefined ||
          !subscription.kinds ||
          subscription.kinds.includes(kind))
      ) {
        return true;
      }
    }
  }

  return false;
}

function recordMockMessage(channelId: string, event: RelayEvent) {
  const history = getMockMessageStore(channelId);
  history.push(event);

  const channel = mockChannels.find((candidate) => candidate.id === channelId);
  if (!channel) {
    return;
  }

  channel.last_message_at = new Date(event.created_at * 1_000).toISOString();
  touchMockChannel(channel);
}

// Mocked Rust-side pending deep-link queue (see desktop/src-tauri/src/deep_link.rs).
const PLATFORM_MOCK_CONFIG = {
  nativeApiUrl: "https://platform.e2e.test:8091",
  oidcIssuer: "https://idp.e2e.test/realms/platform",
  oidcClientId: "platform-native",
};

const platformMock = {
  config: null as PlatformMockOptions["config"],
  signedIn: false,
  pendingSignIn: null as ((error?: string) => void) | null,
  registerCalls: 0,
  deviceStateReads: 0,
  revokedPubkeys: new Set<string>(),
  routeCalls: new Map<string, number>(),
};

function resetPlatformMock(config: E2eConfig | null) {
  const options = config?.mock?.platform;
  platformMock.config =
    options?.config === undefined ? PLATFORM_MOCK_CONFIG : options.config;
  platformMock.signedIn = options?.signedIn ?? true;
  platformMock.pendingSignIn = null;
  platformMock.registerCalls = 0;
  platformMock.deviceStateReads = 0;
  platformMock.revokedPubkeys = new Set();
  platformMock.routeCalls = new Map();
}

function platformError(status: number, reason: string): PlatformReply {
  return { status, body: { class: "PRECONDITION", reason } };
}

function handlePlatformApi(
  request: { method: string; path: string },
  config: E2eConfig | undefined,
  devicePubkey: string,
): PlatformReply {
  if (!platformMock.signedIn) {
    throw "PLATFORM_NOT_SIGNED_IN";
  }
  const options = config?.mock?.platform;
  const key = `${request.method} ${request.path}`;
  if (key === "GET /api/v1/native/community") {
    return (
      options?.community ?? {
        status: 200,
        body: {
          communityHost: new URL(getRelayWsUrl(config)).host,
          relayUrl: getRelayWsUrl(config),
        },
      }
    );
  }
  if (key === "GET /api/v1/identity/client-keys") {
    const states = options?.deviceStates ?? ["ACTIVE"];
    const state =
      states[Math.min(platformMock.deviceStateReads, states.length - 1)];
    platformMock.deviceStateReads += 1;
    const devices = [
      { pubkey: devicePubkey, state, createdAt: new Date().toISOString() },
      ...(options?.otherDevices ?? []),
    ];
    return {
      status: 200,
      body: devices.filter((d) => !platformMock.revokedPubkeys.has(d.pubkey)),
    };
  }
  const revoke = request.path.match(/^\/api\/v1\/identity\/client-keys\/(.+)$/);
  if (request.method === "DELETE" && revoke) {
    const pubkey = decodeURIComponent(revoke[1] ?? "");
    const reply = options?.revoke ?? {
      status: 202,
      body: { pubkey, state: "REVOKING", workflowId: `wf-${pubkey}` },
    };
    if (reply.status < 300) platformMock.revokedPubkeys.add(pubkey);
    return reply;
  }
  if (key === "GET /api/v1/workspaces") {
    return {
      status: 200,
      body: options?.workspaces ?? [
        { id: "e2e-workspace", name: "E2E Workspace", slug: "e2e" },
      ],
    };
  }
  if (
    request.method === "GET" &&
    /^\/api\/v1\/workspaces\/[^/]+\/members$/.test(request.path)
  ) {
    return {
      status: 200,
      body: options?.members ?? [
        {
          principalId: "principal-self",
          displayName: "E2E Member",
          state: "ACTIVE",
          pubkeys: [devicePubkey],
        },
      ],
    };
  }
  if (key === "GET /api/v1/audit") {
    return { status: 200, body: options?.audit ?? [] };
  }
  if (key === "POST /api/v1/logout") {
    return { status: 200, body: { revoked: true } };
  }
  const replies = options?.routes?.[key];
  if (replies?.length) {
    const calls = platformMock.routeCalls.get(key) ?? 0;
    platformMock.routeCalls.set(key, calls + 1);
    return replies[Math.min(calls, replies.length - 1)] as PlatformReply;
  }
  // 缺省的核验用户不是 Tenant admin：邀请列表与 BFF 一样回 403
  if (key === "GET /api/v1/invitations") {
    return {
      status: 403,
      body: { class: "DENIED", reason: "PERMISSION_DENIED" },
    };
  }
  return platformError(404, "E2E_UNMOCKED_ROUTE");
}

async function handlePlatformCommand(
  command: string,
  payload: unknown,
  config: E2eConfig | undefined,
  devicePubkey: string,
): Promise<unknown> {
  const options = config?.mock?.platform;
  switch (command) {
    case "platform_get_config":
      return platformMock.config;
    case "platform_set_config": {
      if (options?.setConfigError) throw options.setConfigError;
      platformMock.config = (
        payload as { config: typeof PLATFORM_MOCK_CONFIG }
      ).config;
      return null;
    }
    case "platform_status":
      return {
        configured: platformMock.config !== null,
        signedIn: platformMock.signedIn,
      };
    case "platform_sign_in": {
      const mode = options?.signIn ?? "succeed";
      if (mode === "hold") {
        await new Promise<void>((resolve, reject) => {
          platformMock.pendingSignIn = (error) =>
            error ? reject(error) : resolve();
        });
      } else if (typeof mode === "object") {
        throw mode.error;
      }
      platformMock.signedIn = true;
      return null;
    }
    case "platform_cancel_sign_in":
      platformMock.pendingSignIn?.("登录已取消");
      platformMock.pendingSignIn = null;
      return null;
    case "platform_sign_out":
      platformMock.signedIn = false;
      return (
        options?.signOut ?? {
          coreSessionRevoked: true,
          refreshTokenRevoked: true,
        }
      );
    case "platform_register_device": {
      if (!platformMock.signedIn) throw "PLATFORM_NOT_SIGNED_IN";
      const replies = options?.register ?? [
        { status: 200, body: { pubkey: devicePubkey, state: "ACTIVE" } },
      ];
      const reply =
        replies[Math.min(platformMock.registerCalls, replies.length - 1)];
      platformMock.registerCalls += 1;
      if (!reply) throw "E2E: no register reply";
      if ("error" in reply) throw reply.error;
      return reply;
    }
    case "platform_api":
      return handlePlatformApi(
        payload as { method: string; path: string },
        config,
        devicePubkey,
      );
  }
  throw new Error(`E2E: unhandled platform command ${command}`);
}

let mockPendingNavigationDeepLinks: Array<{
  id: string;
  kind: "channel" | "message";
  channelId: string;
  messageId: string | null;
  threadRootId: string | null;
}> = [];

function resetMockPendingNavigationDeepLinks(config: E2eConfig | null) {
  mockPendingNavigationDeepLinks = (
    config?.mock?.pendingNavigationDeepLinks ?? []
  ).map((pending) => ({
    ...pending,
    messageId: pending.messageId ?? null,
    threadRootId: pending.threadRootId ?? null,
  }));
}

function emitMockChannelMessage(
  channelId: string,
  content: string,
  parentEventId?: string | null,
  pubkey?: string,
  kind?: number,
  mentionPubkeys?: string[],
  extraTags?: string[][],
  createdAt?: number,
  pending?: boolean,
  id?: string,
) {
  const eventKind = kind ?? 9;
  if (!parentEventId) {
    const tags = buildTopLevelMessageTags(
      channelId,
      mentionPubkeys,
      pubkey ?? DEFAULT_MOCK_IDENTITY.pubkey,
    );
    if (extraTags) tags.push(...extraTags);
    const event = createMockEvent(
      eventKind,
      content,
      tags,
      pubkey,
      createdAt,
      id,
    );
    if (pending) event.pending = true;
    recordMockMessage(channelId, event);
    emitMockLiveEvent(channelId, event);
    return event;
  }

  const history = getMockMessageStore(channelId);
  const parentEvent =
    history.find((event) => event.id === parentEventId) ?? null;
  const parentThread = parentEvent
    ? getThreadReferenceFromTags(parentEvent.tags)
    : {
        parentEventId: null,
        rootEventId: null,
      };
  const rootEventId = parentThread.rootEventId ?? parentEventId;
  const authorPubkey = pubkey ?? DEFAULT_MOCK_IDENTITY.pubkey;
  const tags = buildReplyMessageTags(
    channelId,
    authorPubkey,
    parentEventId,
    rootEventId,
    mentionPubkeys,
  );
  if (extraTags) tags.push(...extraTags);
  const event = createMockEvent(
    eventKind,
    content,
    tags,
    authorPubkey,
    createdAt,
    id,
  );
  if (pending) event.pending = true;
  recordMockMessage(channelId, event);
  emitMockLiveEvent(channelId, event);
  return event;
}

type RawThreadCursor = {
  created_at: number;
  event_id: string;
};

type RawThreadRepliesResponse = {
  events: RelayEvent[];
  next_cursor: RawThreadCursor | null;
};

/**
 * Mirror of the desktop `get_thread_replies` command: return the full reply
 * subtree under a root, chronological (oldest first), excluding the root itself,
 * with gap-free `(created_at, event_id)` keyset paging.
 *
 * The event-id tiebreak is load-bearing — same-second replies must all page
 * through even when they cross a page boundary. This lets a Playwright spec
 * assert the paged union equals the whole subtree, matching the relay contract.
 */
async function handleGetThreadReplies(
  args: {
    rootEventId: string;
    channelId?: string | null;
    limit?: number | null;
    depthLimit?: number | null;
    cursor?: RawThreadCursor | null;
  },
  config: E2eConfig | undefined,
): Promise<RawThreadRepliesResponse> {
  const cap = Math.min(args.limit ?? 200, 500);
  const filter: MockFilter & Record<string, unknown> = {
    "#e": [args.rootEventId],
    depth_limit: args.depthLimit ?? 64,
    kinds: [...TIMELINE_KINDS],
    limit: cap,
  };
  if (args.channelId) {
    filter["#h"] = [args.channelId];
  }
  if (args.cursor) {
    filter.thread_cursor = args.cursor.created_at;
    filter.thread_cursor_id = args.cursor.event_id;
  }
  const identity = getIdentity(config);

  let subtree: RelayEvent[];
  if (!identity) {
    // Mock store: walk the reply forest transitively from the root so nested
    // replies (reply-to-a-reply) are included, matching thread_metadata depth.
    const events = args.channelId
      ? getMockMessageStore(args.channelId)
      : Array.from(mockMessages.values()).flat();
    const byId = new Map(events.map((event) => [event.id, event]));
    const root = byId.get(args.rootEventId);
    const collected: RelayEvent[] = [];
    const included = new Set<string>();
    if (!root) {
      subtree = collected;
    } else {
      const frontier = new Set<string>([root.id]);
      for (;;) {
        let added = false;
        for (const event of events) {
          if (included.has(event.id)) {
            continue;
          }
          const ref = getThreadReferenceFromTags(event.tags);
          if (!ref.parentEventId || !frontier.has(ref.parentEventId)) {
            continue;
          }
          included.add(event.id);
          collected.push(event);
          frontier.add(event.id);
          added = true;
        }
        if (!added) {
          break;
        }
      }
      subtree = collected;
    }
  } else {
    // Config mode: exercise the real bridge thread path over /query.
    const events = await relayQuery(config, [filter]);
    const nextCursor =
      events.length >= cap
        ? {
            created_at: events[events.length - 1].created_at,
            event_id: events[events.length - 1].id,
          }
        : null;
    return { events, next_cursor: nextCursor };
  }

  // Mock mode paging: sort by the composite key, then slice strictly after the
  // cursor so same-second ties can never be skipped across a page boundary.
  subtree.sort(
    (left, right) =>
      left.created_at - right.created_at || left.id.localeCompare(right.id),
  );
  let start = 0;
  if (args.cursor) {
    const cursor = args.cursor;
    start = subtree.findIndex(
      (event) =>
        event.created_at > cursor.created_at ||
        (event.created_at === cursor.created_at &&
          event.id.localeCompare(cursor.event_id) > 0),
    );
    if (start < 0) {
      start = subtree.length;
    }
  }
  const page = subtree.slice(start, start + cap);
  const nextCursor =
    page.length >= cap && start + cap < subtree.length
      ? {
          created_at: page[page.length - 1].created_at,
          event_id: page[page.length - 1].id,
        }
      : null;
  const delayMs = config?.mock?.threadRepliesDelayMs ?? 0;
  if (delayMs > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, delayMs));
  }
  if (config?.mock?.deferThreadReplies) {
    await new Promise<void>((resolve) => {
      deferredThreadRepliesQueue.push(resolve);
    });
  }

  return { events: page, next_cursor: nextCursor };
}

const TIMELINE_KINDS = new Set([9, 40002, 40099]);

type RawChannelMessagesPageResponse = {
  events: RelayEvent[];
  next_cursor: RawThreadCursor | null;
};

/**
 * Mirror of the desktop `get_channel_messages_before` command: return one
 * keyset page of *top-level* channel history strictly older than a composite
 * `(before, before_id)` cursor, newest first (relay order `created_at DESC,
 * id ASC`).
 *
 * This is the dense-second escape hatch — the id tiebreak is load-bearing so a
 * single `created_at` second denser than one WS page can still be paged
 * through: within a tied second the relay advances via `id > before_id`. Lets a
 * Playwright spec assert the keyset union reaches every top-level message even
 * when a second holds more than one page.
 */
async function handleGetChannelMessagesBefore(
  args: {
    channelId: string;
    before: number;
    beforeId?: string | null;
    limit?: number | null;
  },
  config: E2eConfig | undefined,
): Promise<RawChannelMessagesPageResponse> {
  const cap = Math.min(args.limit ?? 200, 500);
  const identity = getIdentity(config);

  let events: RelayEvent[];
  if (!identity) {
    // Mock store: top-level timeline events for this channel.
    events = getMockMessageStore(args.channelId).filter((event) => {
      if (!TIMELINE_KINDS.has(event.kind)) {
        return false;
      }
      return isMockTopLevelRow(event);
    });
  } else {
    // Config mode: exercise the real bridge keyset over /query.
    const filter: Record<string, unknown> = {
      "#h": [args.channelId],
      kinds: [...TIMELINE_KINDS],
      until: args.before,
      limit: cap,
    };
    if (args.beforeId) {
      filter.before_id = args.beforeId;
    }
    const page = await relayQuery(config, [filter]);
    const nextCursor =
      page.length >= cap
        ? {
            created_at: page[page.length - 1].created_at,
            event_id: page[page.length - 1].id,
          }
        : null;
    return { events: page, next_cursor: nextCursor };
  }

  // Mock mode paging: relay order (created_at DESC, id ASC), then take the
  // slice strictly older than the composite cursor. Strictly-older means
  // `created_at < before OR (created_at === before AND id > before_id)` — the
  // id tiebreak walks *forward* through a tied second under ASC id order.
  events.sort(
    (left, right) =>
      right.created_at - left.created_at || left.id.localeCompare(right.id),
  );
  const before = args.before;
  const beforeId = args.beforeId ?? null;
  const older = events.filter((event) => {
    if (event.created_at < before) {
      return true;
    }
    if (event.created_at === before && beforeId !== null) {
      return event.id.localeCompare(beforeId) > 0;
    }
    return false;
  });
  const page = older.slice(0, cap);
  const nextCursor =
    page.length >= cap
      ? {
          created_at: page[page.length - 1].created_at,
          event_id: page[page.length - 1].id,
        }
      : null;

  return { events: page, next_cursor: nextCursor };
}

function getEventTargets(event: RelayEvent) {
  return event.tags.flatMap((tag) =>
    tag[0] === "e" && typeof tag[1] === "string" ? [tag[1]] : [],
  );
}

function buildMockChannelWindowAux(
  events: RelayEvent[],
  rows: RelayEvent[],
): RelayEvent[] {
  const rowIds = new Set(rows.map((row) => row.id));
  return events.filter(
    (event) =>
      CHANNEL_WINDOW_AUX_KINDS.has(event.kind) &&
      getEventTargets(event).some((target) => rowIds.has(target)),
  );
}

function buildMockChannelThreadSummary(
  channelId: string,
  root: RelayEvent,
  events: RelayEvent[],
): RelayEvent | null {
  const replies = events.filter((event) => {
    const thread = getThreadReferenceFromTags(event.tags);
    return thread.rootEventId === root.id;
  });
  if (replies.length === 0) return null;

  const directReplies = replies.filter(
    (event) => getThreadReferenceFromTags(event.tags).parentEventId === root.id,
  );
  const participants = [
    ...new Set(
      replies
        .sort(
          (left, right) =>
            right.created_at - left.created_at ||
            left.id.localeCompare(right.id),
        )
        .map((event) => event.pubkey),
    ),
  ].slice(0, 10);
  const lastReplyAt = Math.max(...replies.map((event) => event.created_at));
  return {
    id: `mock-window-summary-${root.id}`,
    pubkey: DEFAULT_MOCK_IDENTITY.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: KIND_CHANNEL_THREAD_SUMMARY,
    tags: [
      ["e", root.id],
      ["d", root.id],
      ["h", channelId],
    ],
    content: JSON.stringify({
      reply_count: directReplies.length,
      descendant_count: replies.length,
      last_reply_at: lastReplyAt,
      participants,
    }),
    sig: "mocksig".repeat(20).slice(0, 128),
  };
}

/**
 * Build the single kind-39006 bounds event a channel window response must carry.
 * The `d` tag key must match `expectedBoundsKey` in channelWindowResponse.ts:
 * `<channel>:head` at the frontier, else `<channel>:<created_at>:<event_id>` of
 * the request cursor (lower-cased). `has_more`/`next_cursor` must agree — the
 * parser rejects a bounds event where they disagree.
 */
function buildMockChannelWindowBounds(
  args: {
    channelId: string;
    cursor?: { created_at: number; event_id: string } | null;
  },
  hasMore: boolean,
  nextCursor: { created_at: number; id: string } | null,
): RelayEvent {
  const suffix = args.cursor
    ? `${args.cursor.created_at}:${args.cursor.event_id.toLowerCase()}`
    : "head";
  const boundsKey = `${args.channelId.toLowerCase()}:${suffix}`;
  return {
    id: `mock-window-bounds-${boundsKey}`,
    pubkey: DEFAULT_MOCK_IDENTITY.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: KIND_CHANNEL_WINDOW_BOUNDS,
    tags: [["d", boundsKey]],
    content: JSON.stringify({ has_more: hasMore, next_cursor: nextCursor }),
    sig: "mocksig".repeat(20).slice(0, 128),
  };
}

/**
 * one server-assembled channel window over the `/query` bridge. Emits the flat
 * event array the relay assembles — top-level rows (newest first), then the aux
 * closure, then relay-signed `39005` summaries and exactly one `39006` bounds
 * event carrying `has_more` + `next_cursor`. The client derives its cursor and
 * exhaustion solely from `39006`, never from the rows, so this handler returns
 * the raw array unchanged.
 *
 * This is the window read-model surface the overhaul introduced; without it the
 * relay-mode bridge has no handler and the timeline renders empty.
 */
async function handleGetChannelReconnectRepair(
  args: {
    channelId: string;
    since: number;
    limit: number;
    until?: number | null;
    beforeId?: string | null;
  },
  config: E2eConfig | undefined,
): Promise<RelayEvent[]> {
  const kinds = new Set([5, 9, 9005, 40002, 40003, 40099]);
  const filter: Record<string, unknown> = {
    "#h": [args.channelId],
    kinds: [...kinds],
    since: args.since,
    limit: args.limit,
  };
  if (args.until != null) filter.until = args.until;
  if (args.beforeId != null) filter.before_id = args.beforeId;

  if (getIdentity(config)) return relayQuery(config, [filter]);
  return getMockMessageStore(args.channelId)
    .filter(
      (event) =>
        kinds.has(event.kind) &&
        event.created_at >= args.since &&
        (args.until == null ||
          event.created_at < args.until ||
          (event.created_at === args.until &&
            (args.beforeId == null || event.id > args.beforeId))),
    )
    .sort(
      (left, right) =>
        right.created_at - left.created_at || left.id.localeCompare(right.id),
    )
    .slice(0, args.limit);
}

async function handleGetChannelWindow(
  args: {
    channelId: string;
    limitRows?: number | null;
    cursor?: { created_at: number; event_id: string } | null;
  },
  config: E2eConfig | undefined,
): Promise<RelayEvent[]> {
  const execute = async () => {
    const cap = Math.min(args.limitRows ?? 50, 200);
    const identity = getIdentity(config);

    if (!identity) {
      // Mock store: server-assembled channel window over the mock event store,
      // mirroring the relay path's shape so callers (parseChannelWindowResponse)
      // parse both modes identically. Top-level timeline rows in relay order,
      // then exactly one kind-39006 bounds event.
      const events = getMockMessageStore(args.channelId);
      const candidates = events
        .filter(
          (event) => TIMELINE_KINDS.has(event.kind) && isMockTopLevelRow(event),
        )
        .sort(
          (left, right) =>
            right.created_at - left.created_at ||
            left.id.localeCompare(right.id),
        );
      // Honor the composite (until, before_id) cursor exactly like the relay's
      // keyset: keep only rows strictly older than the cursor under the
      // (created_at DESC, id ASC) order — older created_at, or the same second
      // with a strictly greater id.
      const cursor = args.cursor;
      const afterCursor = cursor
        ? candidates.filter(
            (event) =>
              event.created_at < cursor.created_at ||
              (event.created_at === cursor.created_at &&
                event.id > cursor.event_id),
          )
        : candidates;
      const rows = afterCursor.slice(0, cap);
      // Exhaustion probe mirrors the relay's limit+1: more rows past the cursor
      // than the page cap means another page exists. next_cursor is the last
      // retained row.
      const hasMore = afterCursor.length > cap;
      const lastRow = rows[rows.length - 1];
      const nextCursor =
        hasMore && lastRow
          ? { created_at: lastRow.created_at, id: lastRow.id }
          : null;
      const aux = buildMockChannelWindowAux(events, rows);
      const summaries = rows.flatMap((row) => {
        const summary = buildMockChannelThreadSummary(
          args.channelId,
          row,
          events,
        );
        return summary ? [summary] : [];
      });
      return [
        ...rows,
        ...aux,
        ...summaries,
        buildMockChannelWindowBounds(args, hasMore, nextCursor),
      ];
    }

    // Relay mode: mirror build_channel_window_filter exactly — top-level dispatch
    // with summaries + aux, composite (until, before_id) cursor (both or neither).
    const filter: Record<string, unknown> = {
      "#h": [args.channelId],
      kinds: [...TIMELINE_KINDS],
      limit: cap,
      top_level: true,
      include_summaries: true,
      include_aux: true,
    };
    if (args.cursor) {
      filter.until = args.cursor.created_at;
      filter.before_id = args.cursor.event_id;
    }
    return relayQuery(config, [filter]);
  };

  const probe = window as unknown as {
    __CHANNEL_WINDOW_FETCH_COUNT__?: number;
    __CHANNEL_WINDOW_INFLIGHT__?: number;
    __CHANNEL_WINDOW_INFLIGHT_PEAK__?: number;
  };
  if (args.cursor !== null) {
    probe.__CHANNEL_WINDOW_FETCH_COUNT__ =
      (probe.__CHANNEL_WINDOW_FETCH_COUNT__ ?? 0) + 1;
  }

  const delayMs =
    args.cursor === null
      ? (getConfig()?.mock?.channelHeadDelayMs ?? 0)
      : (getConfig()?.mock?.channelWindowDelayMs ?? 0);
  if (delayMs <= 0) {
    return execute();
  }

  probe.__CHANNEL_WINDOW_INFLIGHT__ =
    (probe.__CHANNEL_WINDOW_INFLIGHT__ ?? 0) + 1;
  probe.__CHANNEL_WINDOW_INFLIGHT_PEAK__ = Math.max(
    probe.__CHANNEL_WINDOW_INFLIGHT_PEAK__ ?? 0,
    probe.__CHANNEL_WINDOW_INFLIGHT__,
  );
  await new Promise((resolve) => window.setTimeout(resolve, delayMs));
  try {
    return await execute();
  } finally {
    probe.__CHANNEL_WINDOW_INFLIGHT__ =
      (probe.__CHANNEL_WINDOW_INFLIGHT__ ?? 1) - 1;
  }
}

function mockEventId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function createMockEvent(
  kind: number,
  content: string,
  tags: string[][],
  pubkey = DEFAULT_MOCK_IDENTITY.pubkey,
  createdAt = Math.floor(Date.now() / 1000),
  // 64 hex chars like a real event id — share-link builders reject shorter
  // ids, so copy-link buttons only render with full-length ids.
  id = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, ""),
): RelayEvent {
  return {
    id,
    pubkey,
    created_at: createdAt,
    kind,
    tags,
    content,
    sig: "mocksig".repeat(20).slice(0, 128),
  };
}

async function signWithIdentity(
  identity: TestIdentity,
  template: {
    kind: number;
    content: string;
    createdAt?: number;
    tags: string[][];
  },
) {
  const secretKey = hexToBytes(identity.privateKey);

  return finalizeEvent(
    {
      kind: template.kind,
      content: template.content,
      tags: template.tags,
      created_at: template.createdAt ?? Math.floor(Date.now() / 1000),
    },
    secretKey,
  );
}

async function assertOk(response: Response) {
  if (response.ok) {
    return;
  }

  const body = await response.text();
  throw new Error(body || `Request failed with ${response.status}`);
}

function getRelayIdentity(config: E2eConfig | undefined): TestIdentity {
  const identity = getIdentity(config);
  if (!identity) {
    throw new Error("Relay identity required.");
  }

  return identity;
}

async function relayJsonRequest<T>(
  config: E2eConfig | undefined,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const identity = getRelayIdentity(config);
  const headers = new Headers(init.headers);

  headers.set("X-Pubkey", identity.pubkey);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${getRelayHttpUrl(config)}${path}`, {
    ...init,
    headers,
  });
  await assertOk(response);
  return response.json() as Promise<T>;
}

/**
 * Query the relay via POST /query (pure Nostr HTTP bridge).
 * Returns an array of raw Nostr events matching the filters.
 */
async function relayQuery(
  config: E2eConfig | undefined,
  filters: Array<Record<string, unknown>>,
): Promise<RelayEvent[]> {
  const identity = getRelayIdentity(config);

  const response = await fetch(`${getRelayHttpUrl(config)}/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Pubkey": identity.pubkey,
    },
    body: JSON.stringify(filters),
  });
  await assertOk(response);
  return response.json() as Promise<RelayEvent[]>;
}

async function submitSignedEvent(
  config: E2eConfig | undefined,
  template: { kind: number; content: string; tags: string[][] },
): Promise<{ event_id: string; accepted: boolean; message: string }> {
  const identity = getRelayIdentity(config);
  const signed = await signWithIdentity(identity, template);
  return relayJsonRequest(config, "/events", {
    method: "POST",
    body: JSON.stringify(signed),
  });
}

/** Build the channel-id → last-message-at map from the returned channel list. */
function buildLastMessages(
  channels: Array<{ id: string; last_message_at: string | null }>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const ch of channels) {
    if (ch.last_message_at !== null) {
      map[ch.id] = ch.last_message_at;
    }
  }
  return map;
}

/**
 * Mirrors the real backend split: `get_channels` (member-only) drops
 * non-member open channels, while `get_open_channel_directory` keeps the
 * discovery superset. Filtering on `is_member` lets specs assert the poll no
 * longer leaks the whole relay's open channels into the member list.
 */
function scopeChannelsForMembership<T extends { is_member: boolean }>(
  channels: T[],
  scope: "member-only" | "open-directory",
): T[] {
  return scope === "open-directory"
    ? channels
    : channels.filter((channel) => channel.is_member);
}

async function handleGetChannels(
  payload: unknown,
  config: E2eConfig | undefined,
  scope: "member-only" | "open-directory" = "member-only",
) {
  const channelsReadDelayMs = config?.mock?.channelsReadDelayMs ?? 0;
  if (channelsReadDelayMs > 0) {
    await new Promise((resolve) =>
      window.setTimeout(resolve, channelsReadDelayMs),
    );
  }

  const channelsReadError =
    config?.mock?.channelsReadErrors?.shift() ??
    config?.mock?.channelsReadError;
  if (channelsReadError) {
    throw new Error(channelsReadError);
  }

  const identity = getIdentity(config);
  if (!identity) {
    // The hash is constant ("mock-hash") and full lists remain the default:
    // mock channel data mutates during tests while the hash does not. Focused
    // snapshot specs can opt into the not-modified branch explicitly.
    const channels = scopeChannelsForMembership(
      listMockChannels(config),
      scope,
    );
    const hash = "mock-hash";
    const knownHash = (payload as { knownHash?: unknown } | null)?.knownHash;
    const forcedNotModified =
      (config?.mock?.channelsNotModifiedResponses ?? 0) > 0;
    if (forcedNotModified && config?.mock) {
      config.mock.channelsNotModifiedResponses =
        (config.mock.channelsNotModifiedResponses ?? 1) - 1;
    }
    return {
      hash,
      channels:
        forcedNotModified ||
        (config?.mock?.honorChannelsKnownHash && knownHash === hash)
          ? null
          : channels,
      last_messages: buildLastMessages(channels),
    };
  }

  // Pure Nostr: query kind:39002 (membership) for our pubkey, extract channel
  // UUIDs from d-tags, then query kind:39000 (metadata) for those channels.
  const memberEvents = await relayQuery(config, [
    { kinds: [39002], "#p": [identity.pubkey], limit: 1000 },
  ]);

  const channelIds = [
    ...new Set(
      memberEvents.flatMap((ev) =>
        (ev.tags ?? [])
          .filter((t: string[]) => t[0] === "d")
          .map((t: string[]) => t[1]),
      ),
    ),
  ];

  // Also fetch ALL open channel metadata (for channel browser — shows joinable channels)
  const allMetaEvents = await relayQuery(config, [
    { kinds: [39000], limit: 200 },
  ]);

  // Merge: use all metadata events, mark membership
  const memberSet = new Set(channelIds);
  const metaEvents = allMetaEvents;

  // NIP-DV: query the viewer's latest DM visibility snapshot (kind:30622).
  // The snapshot is `#p`-gated to its owner, so we query by `#p`=my pubkey.
  // Its `h` tags are the DM channel ids to hide from the sidebar.
  const visibilityEvents = await relayQuery(config, [
    { kinds: [KIND_DM_VISIBILITY], "#p": [identity.pubkey], limit: 1 },
  ]);
  const latestVisibility = visibilityEvents.reduce<RelayEvent | null>(
    (latest, ev) =>
      !latest || ev.created_at > latest.created_at ? ev : latest,
    null,
  );
  const hiddenDms = new Set(
    ((latestVisibility?.tags ?? []) as string[][])
      .filter((t) => t[0] === "h")
      .map((t) => t[1]),
  );

  // Convert kind:39000 events to the RawChannel shape the frontend expects.
  const channels = metaEvents
    .map((ev) => {
      const tags = (ev.tags ?? []) as string[][];
      const getTag = (name: string) =>
        tags.find((t) => t[0] === name)?.[1] ?? null;
      const channelId = getTag("d") ?? "";
      const channelType = getTag("t") ?? "stream";
      const isPrivate = tags.some((t) => t[0] === "private");
      const isArchived = tags.some(
        (t) => t[0] === "archived" && t[1] === "true",
      );

      // Get participant pubkeys from the membership event for this channel
      const memberEvent = memberEvents.find((me) =>
        (me.tags ?? []).some(
          (t: string[]) => t[0] === "d" && t[1] === channelId,
        ),
      );
      const pTags = memberEvent
        ? ((memberEvent.tags ?? []) as string[][])
            .filter((t) => t[0] === "p")
            .map((t) => t[1])
        : [];

      return {
        id: channelId,
        name: getTag("name") ?? "",
        description: getTag("about") ?? "",
        channel_type: channelType as "stream" | "forum" | "dm",
        visibility: (isPrivate ? "private" : "open") as "open" | "private",
        topic: getTag("topic") ?? null,
        purpose: getTag("purpose") ?? null,
        member_count: pTags.length,
        last_message_at: null,
        archived_at: isArchived ? new Date().toISOString() : null,
        participants: pTags,
        participant_pubkeys: pTags,
        ttl_seconds: getTag("ttl") ? Number(getTag("ttl")) : null,
        ttl_deadline: getTag("ttl_deadline") ?? null,
        is_member: memberSet.has(channelId),
      };
    })
    .filter((c) => c.channel_type !== "dm" || !hiddenDms.has(c.id));

  const scopedChannels = scopeChannelsForMembership(channels, scope);

  return {
    hash: "mock-hash",
    channels: scopedChannels,
    last_messages: buildLastMessages(scopedChannels),
  };
}

async function runGetProfile(config: E2eConfig | undefined) {
  const identity = getIdentity(config);
  const profileReadDelayMs = config?.mock?.profileReadDelayMs ?? 0;
  if (profileReadDelayMs > 0) {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, profileReadDelayMs);
    });
  }

  const forcedHasProfileEvent = config?.mock?.profileHasEvent;
  if (forcedHasProfileEvent !== undefined) {
    return {
      ...cloneProfile(ensureMockProfile(config)),
      has_profile_event: forcedHasProfileEvent,
    };
  }
  if (!identity) {
    const profileReadError = config?.mock?.profileReadError;
    if (profileReadError) {
      throw new Error(profileReadError);
    }

    return cloneProfile(ensureMockProfile(config));
  }

  // Pure Nostr: query kind:0 (profile metadata) for our pubkey.
  const events = await relayQuery(config, [
    { kinds: [0], authors: [identity.pubkey], limit: 1 },
  ]);
  if (events.length === 0) {
    return {
      pubkey: identity.pubkey,
      display_name: null,
      about: null,
      avatar_url: null,
      nip05_handle: null,
      owner_pubkey: null,
      has_profile_event: false,
    };
  }
  const content = JSON.parse(events[0].content ?? "{}");
  return {
    pubkey: identity.pubkey,
    display_name: content.display_name ?? content.name ?? null,
    about: content.about ?? null,
    avatar_url: content.picture ?? null,
    nip05_handle: content.nip05 ?? null,
    owner_pubkey: null,
    has_profile_event: true,
  };
}

async function handleGetProfile(config: E2eConfig | undefined) {
  if (!config?.mock?.deferProfileReads || profileReadsReleased) {
    return runGetProfile(config);
  }

  return new Promise<unknown>((resolve, reject) => {
    deferredProfileReadQueue.push({
      resolve,
      reject,
      run: () => runGetProfile(config),
    });
  });
}

async function handleGetUserProfile(
  args: {
    pubkey?: string;
  },
  config: E2eConfig | undefined,
) {
  const identity = getIdentity(config);
  if (!identity) {
    const pubkey = (args.pubkey ?? getMockMemberPubkey(config)).toLowerCase();
    const profile = getMockProfileByPubkey(pubkey);
    if (!profile) {
      throw new Error(`User ${pubkey} not found.`);
    }

    return cloneProfile(profile);
  }

  const targetPubkey = args.pubkey ?? identity.pubkey;
  const events = await relayQuery(config, [
    { kinds: [0], authors: [targetPubkey], limit: 1 },
  ]);
  if (events.length === 0) {
    return {
      pubkey: targetPubkey,
      display_name: null,
      about: null,
      avatar_url: null,
      nip05_handle: null,
      owner_pubkey: null,
      has_profile_event: false,
    };
  }
  const content = JSON.parse(events[0].content ?? "{}");
  return {
    pubkey: targetPubkey,
    display_name: content.display_name ?? content.name ?? null,
    about: content.about ?? null,
    avatar_url: content.picture ?? null,
    nip05_handle: content.nip05 ?? null,
    owner_pubkey: null,
    has_profile_event: true,
  };
}

async function handleGetUsersBatch(
  args: {
    pubkeys: string[];
  },
  config: E2eConfig | undefined,
) {
  const usersBatchDelayMs = config?.mock?.usersBatchDelayMs ?? 0;
  if (usersBatchDelayMs > 0) {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, usersBatchDelayMs);
    });
  }
  if (holdUsersBatch) {
    await new Promise<void>((resolve) => {
      heldUsersBatchReleases.push(resolve);
    });
  }

  const identity = getIdentity(config);
  if (!identity) {
    const profiles: RawUsersBatchResponse["profiles"] = {};
    const missing: string[] = [];

    for (const pubkey of args.pubkeys) {
      const normalizedPubkey = pubkey.toLowerCase();
      const profile = getMockProfileByPubkey(normalizedPubkey);

      if (!profile) {
        missing.push(pubkey);
        continue;
      }

      profiles[normalizedPubkey] = {
        display_name: profile.display_name,
        name: profile.name ?? null,
        avatar_url: profile.avatar_url,
        nip05_handle: profile.nip05_handle,
        owner_pubkey: profile.owner_pubkey,
        is_agent: profile.is_agent ?? false,
      };
    }

    return {
      profiles,
      missing,
    };
  }

  const events = await relayQuery(config, [
    { kinds: [0], authors: args.pubkeys, limit: args.pubkeys.length },
  ]);
  const profiles: RawUsersBatchResponse["profiles"] = {};
  const found = new Set<string>();
  for (const ev of events) {
    const pk = ev.pubkey?.toLowerCase() ?? "";
    found.add(pk);
    const content = JSON.parse(ev.content ?? "{}");
    profiles[pk] = {
      display_name: content.display_name ?? content.name ?? null,
      name: content.name ?? null,
      avatar_url: content.picture ?? null,
      nip05_handle: content.nip05 ?? null,
      owner_pubkey:
        ((ev.tags ?? []) as string[][]).find(
          (tag) => Array.isArray(tag) && tag[0] === "auth" && tag.length === 4,
        )?.[1] ?? null,
      is_agent: Array.isArray(ev.tags)
        ? ev.tags.some(
            (tag) =>
              Array.isArray(tag) && tag[0] === "auth" && tag.length === 4,
          )
        : false,
    };
  }
  for (const pubkey of args.pubkeys) {
    const normalizedPubkey = pubkey.toLowerCase();
    if (found.has(normalizedPubkey)) {
      continue;
    }

    const profile = getMockProfileByPubkey(normalizedPubkey);
    if (!profile) {
      continue;
    }

    found.add(normalizedPubkey);
    profiles[normalizedPubkey] = {
      display_name: profile.display_name,
      name: profile.name ?? null,
      avatar_url: profile.avatar_url,
      nip05_handle: profile.nip05_handle,
      owner_pubkey: profile.owner_pubkey,
      is_agent: profile.is_agent ?? false,
    };
  }
  const missing = args.pubkeys.filter((p) => !found.has(p.toLowerCase()));
  return { profiles, missing };
}

async function handleSearchUsers(
  args: {
    query: string;
    limit?: number;
    cursor?: string | null;
  },
  config: E2eConfig | undefined,
) {
  const userSearchDelayMs = config?.mock?.userSearchDelayMs ?? 0;
  if (userSearchDelayMs > 0) {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, userSearchDelayMs);
    });
  }

  const identity = getIdentity(config);
  if (!identity) {
    const normalizedQuery = args.query.trim().toLowerCase();

    const limit = args.limit ?? 8;
    const page = Math.max(Number(args.cursor ?? 1) || 1, 1);
    const allResults = listMockProfiles()
      .filter((profile) => {
        if (normalizedQuery.length === 0) {
          return true;
        }

        const displayName = profile.display_name?.toLowerCase() ?? "";
        const nip05Handle = profile.nip05_handle?.toLowerCase() ?? "";
        const pubkey = profile.pubkey.toLowerCase();
        return (
          displayName.includes(normalizedQuery) ||
          nip05Handle.includes(normalizedQuery) ||
          pubkey.includes(normalizedQuery)
        );
      })
      .sort((left, right) => {
        const leftName = left.display_name ?? left.nip05_handle ?? left.pubkey;
        const rightName =
          right.display_name ?? right.nip05_handle ?? right.pubkey;
        return leftName.localeCompare(rightName);
      });
    const results = allResults
      .slice((page - 1) * limit, page * limit)
      .map((profile) => ({
        pubkey: profile.pubkey,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
        nip05_handle: profile.nip05_handle,
        owner_pubkey: profile.owner_pubkey,
        is_agent: profile.is_agent ?? false,
      }));

    return {
      users: results,
      next_cursor: page * limit < allResults.length ? String(page + 1) : null,
    } satisfies RawSearchUsersResponse;
  }

  // NIP-50 search on kind:0 profiles
  const limit = args.limit ?? 8;
  const normalizedQuery = args.query.trim();
  const page = Math.max(Number(args.cursor ?? 1) || 1, 1);
  const filter =
    normalizedQuery.length === 0
      ? { kinds: [0], limit, page }
      : { kinds: [0], search: args.query, limit, page };
  const events = await relayQuery(config, [filter]);
  const users = events.map((ev) => {
    const content = JSON.parse(ev.content ?? "{}");
    return {
      pubkey: ev.pubkey ?? "",
      display_name: content.display_name ?? content.name ?? null,
      avatar_url: content.picture ?? null,
      nip05_handle: content.nip05 ?? null,
      owner_pubkey:
        ((ev.tags ?? []) as string[][]).find(
          (tag) => Array.isArray(tag) && tag[0] === "auth" && tag.length === 4,
        )?.[1] ?? null,
      is_agent: Array.isArray(ev.tags)
        ? ev.tags.some(
            (tag) =>
              Array.isArray(tag) && tag[0] === "auth" && tag.length === 4,
          )
        : false,
    };
  });
  return {
    users,
    next_cursor: users.length >= limit ? String(page + 1) : null,
  };
}

async function handleGetChannelDetails(
  args: { channelId: string },
  config: E2eConfig | undefined,
) {
  const identity = getIdentity(config);
  if (!identity) {
    return toRawChannelDetail(getMockChannel(args.channelId), config);
  }

  const metaEvents = await relayQuery(config, [
    { kinds: [39000], "#d": [args.channelId], limit: 1 },
  ]);
  const ev = metaEvents[0];
  const evTags = (ev?.tags ?? []) as string[][];
  const getTag = (name: string) =>
    evTags.find((t) => t[0] === name)?.[1] ?? null;

  // Get members for member_count
  const memberEvents = await relayQuery(config, [
    { kinds: [39002], "#d": [args.channelId], limit: 1 },
  ]);
  const memberTags = ((memberEvents[0]?.tags ?? []) as string[][]).filter(
    (t) => t[0] === "p",
  );

  return {
    id: args.channelId,
    name: getTag("name") ?? "",
    description: getTag("about") ?? null,
    channel_type: getTag("t") ?? "stream",
    visibility: evTags.some((t) => t[0] === "private") ? "private" : "open",
    topic: getTag("topic") ?? null,
    purpose: getTag("purpose") ?? null,
    member_count: memberTags.length,
    role: "member",
    archived_at: evTags.some((t) => t[0] === "archived" && t[1] === "true")
      ? new Date().toISOString()
      : null,
    ttl_seconds: getTag("ttl") ? Number(getTag("ttl")) : null,
    ttl_deadline: getTag("ttl_deadline") ?? null,
    created_at: ev?.created_at
      ? new Date(ev.created_at * 1000).toISOString()
      : new Date().toISOString(),
  };
}

async function handleGetChannelMembers(
  args: { channelId: string },
  config: E2eConfig | undefined,
): Promise<RawChannelMembersResponse> {
  const delayMs = config?.mock?.channelMembersReadDelayMs ?? 0;
  if (delayMs > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, delayMs));
  }

  const identity = getIdentity(config);
  if (!identity) {
    const channel = getMockChannel(args.channelId);
    return {
      members: cloneMembers(channel.members),
      next_cursor: null,
    };
  }

  const memberEvents = await relayQuery(config, [
    { kinds: [39002], "#d": [args.channelId], limit: 1 },
  ]);
  const memberTags = ((memberEvents[0]?.tags ?? []) as string[][]).filter(
    (t) => t[0] === "p",
  );
  const members = memberTags.map((t) => ({
    pubkey: t[1],
    role: (t[3] ?? t[2] ?? "member") as
      | "owner"
      | "admin"
      | "member"
      | "guest"
      | "bot",
    is_agent: (t[3] ?? t[2]) === "bot",
    display_name: null,
    avatar_url: null,
    joined_at: new Date().toISOString(),
  }));
  return { members, next_cursor: null };
}

async function handleRestart(config: E2eConfig | undefined) {
  const delayMs = config?.mock?.restartDelayMs ?? 0;

  if (delayMs > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, delayMs));
  }

  return null;
}

async function handleGetFeed(
  args: {
    since?: number;
    limit?: number;
  },
  config: E2eConfig | undefined,
): Promise<RawHomeFeedResponse> {
  const feedReadError = config?.mock?.feedReadError;
  if (feedReadError) {
    throw new Error(feedReadError);
  }

  const identity = getIdentity(config);
  if (!identity) {
    const now = Math.floor(Date.now() / 1000);
    const limit = args.limit ?? 50;
    const currentPubkey = getMockMemberPubkey(config).toLowerCase();
    const defaultMentions: RawFeedItem[] =
      currentPubkey === ALICE_PUBKEY
        ? [
            {
              id: "mock-feed-alice-mention",
              kind: 9,
              pubkey: BOB_PUBKEY,
              content: "Alice, can you sanity-check the new design mocks?",
              created_at: now - 90,
              channel_id: "b5e2f8a1-3c44-5912-9e67-4a8d1f2b3c4e",
              channel_name: "design",
              tags: [
                ["e", "b5e2f8a1-3c44-5912-9e67-4a8d1f2b3c4e"],
                ["p", ALICE_PUBKEY],
              ],
              category: "mention" as const,
            },
          ]
        : currentPubkey === DEFAULT_REAL_IDENTITY.pubkey.toLowerCase()
          ? [
              {
                id: "mock-feed-tyler-mention",
                kind: 9,
                pubkey: ALICE_PUBKEY,
                content: "Tyler, can you review the DM onboarding copy?",
                created_at: now - 90,
                channel_id: "f48efb06-0c93-5025-aac9-2e646bb6bfa8",
                channel_name: "alice-tyler",
                tags: [
                  ["e", "f48efb06-0c93-5025-aac9-2e646bb6bfa8"],
                  ["p", DEFAULT_REAL_IDENTITY.pubkey],
                ],
                category: "mention" as const,
              },
            ]
          : [
              {
                id: "mock-feed-mention",
                kind: 9,
                pubkey: ALICE_PUBKEY,
                content: "Please review the release checklist.",
                created_at: now - 90,
                channel_id: "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
                channel_name: "general",
                tags: [
                  ["e", "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50"],
                  ["p", currentPubkey],
                ],
                category: "mention" as const,
              },
            ];
    const mentions = [...mockFeedMentionOverrides, ...defaultMentions]
      .sort((left, right) => right.created_at - left.created_at)
      .slice(0, limit);

    return {
      feed: { mentions },
      meta: {
        since: args.since ?? now - 7 * 24 * 60 * 60,
        total: mentions.length,
        generated_at: now,
      },
    };
  }

  // The feed is the identity's @-mentions in channel messages.
  const limit = args.limit ?? 50;
  const mentionEvents = await relayQuery(config, [
    {
      kinds: [9, 40002],
      "#p": [identity.pubkey],
      limit,
    },
  ]);

  // Look up channel names for feed items
  const channelIdsInFeed = [
    ...new Set(
      mentionEvents
        .map(
          (ev) =>
            ((ev.tags ?? []) as string[][]).find((t) => t[0] === "h")?.[1],
        )
        .filter(Boolean) as string[],
    ),
  ];
  const channelNameMap = new Map<string, string>();
  if (channelIdsInFeed.length > 0) {
    const metaEvents = await relayQuery(config, [
      {
        kinds: [39000],
        "#d": channelIdsInFeed,
        limit: channelIdsInFeed.length,
      },
    ]);
    for (const me of metaEvents) {
      const d = ((me.tags ?? []) as string[][]).find((t) => t[0] === "d")?.[1];
      const name = ((me.tags ?? []) as string[][]).find(
        (t) => t[0] === "name",
      )?.[1];
      if (d && name) channelNameMap.set(d, name);
    }
  }

  const items = mentionEvents.map((ev) => {
    const chId =
      ((ev.tags ?? []) as string[][]).find((t) => t[0] === "h")?.[1] ?? null;
    return {
      id: ev.id ?? "",
      pubkey: ev.pubkey ?? "",
      content: ev.content ?? "",
      created_at: ev.created_at ?? 0,
      kind: ev.kind ?? 9,
      tags: (ev.tags ?? []) as string[][],
      channel_id: chId,
      channel_name: chId ? (channelNameMap.get(chId) ?? "") : "",
      // Native-shaped: get_feed emits channel_type: null (Option<String>),
      // never omits the key. Keeping the bridge faithful here is what lets
      // the DM dedupe e2e catch null-vs-undefined regressions at the API
      // conversion seam.
      channel_type: null,
      category: "mention" as const,
    };
  });
  return {
    feed: { mentions: items },
    meta: {
      since: Math.floor(Date.now() / 1000) - 7 * 86400,
      total: items.length,
      generated_at: Math.floor(Date.now() / 1000),
    },
  };
}

async function handleSearchMessages(
  args: {
    q: string;
    limit?: number;
    channelId?: string;
    authors?: string[];
    since?: number;
    until?: number;
  },
  config: E2eConfig | undefined,
): Promise<RawSearchResponse> {
  const identity = getIdentity(config);
  if (!identity) {
    const query = args.q.trim().toLowerCase();
    const limit = args.limit ?? 20;
    const now = Math.floor(Date.now() / 1000);

    const mockHits: RawSearchHit[] = [
      {
        event_id: "mock-general-welcome",
        content: "Welcome to #general",
        kind: 9,
        pubkey: DEFAULT_MOCK_IDENTITY.pubkey,
        channel_id: "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
        channel_name: "general",
        created_at: now - 60,
        score: 8.5,
      },
      {
        event_id: "mock-engineering-shipped",
        content: "Engineering shipped the desktop build.",
        kind: 9,
        pubkey:
          "bb22a5299220cad76ffd46190ccbeede8ab5dc260faa28b6e5a2cb31b9aff260",
        channel_id: "1c7e1c02-87bb-5e88-b2da-5a7a9432d0c9",
        channel_name: "engineering",
        created_at: now - 42 * 60,
        score: 7.2,
      },
      {
        event_id: "mock-design-critique",
        content: "Design critique notes for the browse flow.",
        kind: 9,
        pubkey:
          "953d3363262e86b770419834c53d2446409db6d918a57f8f339d495d54ab001f",
        channel_id: "b5e2f8a1-3c44-5912-9e67-4a8d1f2b3c4e",
        channel_name: "design",
        created_at: now - 75 * 60,
        score: 6.6,
      },
    ];
    for (const [channelId, events] of mockMessages) {
      const channel = mockChannels.find(
        (candidate) => candidate.id === channelId,
      );
      for (const event of events) {
        mockHits.push({
          event_id: event.id,
          content: event.content,
          kind: event.kind,
          pubkey: event.pubkey,
          channel_id: channelId,
          channel_name: channel?.name ?? null,
          created_at: event.created_at,
          score: 1,
        });
      }
    }

    const authorSet = args.authors?.length
      ? new Set(args.authors.map((author) => author.toLowerCase()))
      : null;

    const hits = mockHits
      .filter((hit) =>
        mockSearchHitMatches(hit, {
          query,
          channelId: args.channelId,
          authorSet,
          since: args.since,
          until: args.until,
        }),
      )
      .slice(0, limit);

    return {
      hits,
      found: hits.length,
    };
  }

  // NIP-50 search via POST /query — forward operator pushdown fields.
  const limit = args.limit ?? 20;
  const filter: Record<string, unknown> = {
    kinds: [9, 40002],
    search: args.q,
    limit,
  };
  if (args.channelId) {
    filter["#h"] = [args.channelId];
  }
  if (args.authors?.length) {
    filter.authors = args.authors;
  }
  if (args.since != null) {
    filter.since = args.since;
  }
  if (args.until != null) {
    filter.until = args.until;
  }
  const events = await relayQuery(config, [filter]);
  const hits = events.map((ev) => ({
    event_id: ev.id ?? "",
    pubkey: ev.pubkey ?? "",
    content: ev.content ?? "",
    created_at: ev.created_at ?? 0,
    kind: ev.kind ?? 9,
    tags: ev.tags ?? [],
    sig: ev.sig ?? "",
    channel_id:
      ((ev.tags ?? []) as string[][]).find((t) => t[0] === "h")?.[1] ?? null,
    channel_name: null,
    score: 1.0,
  }));
  return { hits, found: hits.length };
}

/**
 * Descriptors returned by the mocked upload commands. A spec can override via
 * `MockBridgeOptions.uploadDescriptors`; otherwise we return a single generic
 * PDF so the file-attachment flow (chip → send → FileCard) can be exercised
 * out of the box.
 */
async function resolveMockUploadDescriptors(
  config: E2eConfig | undefined,
): Promise<RawBlobDescriptor[]> {
  const delayMs = config?.mock?.uploadDelayMs ?? 0;
  if (delayMs > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, delayMs));
  }

  const configured = config?.mock?.uploadDescriptors;
  // `undefined` means "not configured" → default PDF. An explicit `[]` is a
  // valid override (e.g. modelling a picker cancel / no-files-selected), so it
  // must pass through rather than fall back to the default.
  if (configured !== undefined) return configured;
  return [
    {
      url: `https://mock.relay/media/${"a".repeat(64)}.pdf`,
      sha256: "a".repeat(64),
      size: 12345,
      type: "application/pdf",
      uploaded: Math.floor(Date.now() / 1000),
      filename: "quarterly-report.pdf",
    },
  ];
}

async function resolveMockUploadDescriptorForBytes(
  args: { data: number[] | Uint8Array; filename?: string | null },
  config: E2eConfig | undefined,
): Promise<RawBlobDescriptor> {
  const uploadDelayMs = config?.mock?.linkPreviewUploadDelayMs ?? 0;
  if (args.filename?.startsWith("link-preview-")) {
    if (uploadDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, uploadDelayMs));
    }
    const errorFilenames = config?.mock?.linkPreviewUploadErrorFilenames;
    if (errorFilenames?.some((needle) => args.filename?.includes(needle))) {
      throw new Error(`mock upload failed for ${args.filename}`);
    }
  }
  const configured = config?.mock?.uploadDescriptors;
  if (configured !== undefined) {
    const descriptors = await resolveMockUploadDescriptors(config);
    const descriptor = descriptors[0];
    if (!descriptor) throw new Error("mock upload returned no descriptor");
    return descriptor;
  }

  const bytes = Uint8Array.from(args.data);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  const filename = args.filename ?? "upload.bin";
  const normalizedFilename = filename.toLowerCase();
  const isAgentJson = normalizedFilename.endsWith(".agent.json");
  const extension = isAgentJson
    ? "json"
    : normalizedFilename.endsWith(".png")
      ? "png"
      : normalizedFilename.endsWith(".jpg") ||
          normalizedFilename.endsWith(".jpeg")
        ? "jpg"
        : normalizedFilename.endsWith(".gif")
          ? "gif"
          : normalizedFilename.endsWith(".webp")
            ? "webp"
            : "bin";
  const type = isAgentJson
    ? "application/json"
    : extension === "bin"
      ? "application/octet-stream"
      : `image/${extension === "jpg" ? "jpeg" : extension}`;
  return {
    url: `${getRelayHttpUrl(config)}/media/${sha256}.${extension}`,
    sha256,
    size: bytes.length,
    type,
    uploaded: Math.floor(Date.now() / 1000),
    filename,
  };
}

async function handleSendChannelMessage(
  args: {
    channelId: string;
    content: string;
    parentEventId?: string | null;
    rootEventId?: string | null;
    mentionPubkeys?: string[];
    mediaTags?: string[][] | null;
    emojiTags?: string[][] | null;
    mentionTags?: string[][] | null;
    linkPreviewTags?: string[][] | null;
    sentFromThreadTag?: string[] | null;
    suppressLinkPreviews?: boolean;
    expectedRelayUrl?: string | null;
    expectedSignerPubkey?: string | null;
  },
  config: E2eConfig | undefined,
): Promise<RawSendChannelMessageResponse> {
  const sendMessageDelayMs = config?.mock?.sendMessageDelayMs ?? 0;
  if (sendMessageDelayMs > 0) {
    await new Promise((resolve) =>
      window.setTimeout(resolve, sendMessageDelayMs),
    );
  }
  // After the injected delay, like the real command's post-await check: a
  // caller-captured tenant scope and signer identity must still match the
  // active community/identity.
  assertExpectedRelayScope(args.expectedRelayUrl, config);
  assertExpectedSigner(args.expectedSignerPubkey, config);

  // Mirror the WebSocket send path's failure injection so specs that route
  // the first message through the acknowledged HTTP transport still exercise
  // `sendMessageErrors`. The real command rejects on a relay `OK false`, which
  // surfaces to callers as a thrown error carrying the relay reason.
  const sendMessageError = config?.mock?.sendMessageErrors?.shift();
  if (sendMessageError) {
    throw new Error(sendMessageError);
  }

  // NIP-92 imeta attachments. The real relay echoes these back on the stored
  // event; mirror that here so attachment renderers (FileCard, images, video)
  // have the imeta tags they key on. `null`/empty → no extra tags.
  const mediaTags = args.mediaTags ?? [];
  // NIP-30 custom-emoji tags ride their own validated arg server-side; the
  // relay echoes them back on the stored event too, so mirror that here so the
  // emoji renderer keeps resolving `:shortcode:` after the round-trip.
  const emojiTags = args.emojiTags ?? [];
  // Reference-only mentions are already part of the outbound event. Preserve
  // them in the mock event too so local echoes match the complete sent tag set.
  const mentionTags = args.mentionTags ?? [];
  // Sender-authored link preview snapshots are independently validated by the
  // real command and echoed on the stored event. Preserve them in the mock so
  // E2E recipient rendering exercises the same authored-snapshot path.
  const linkPreviewTags = args.linkPreviewTags ?? [];
  if (linkPreviewTags.length > 0) {
    const suppression = linkPreviewTags.some(
      (tag) =>
        tag.length === 2 && tag[0] === "link-preview" && tag[1] === "none",
    );
    const snapshots = linkPreviewTags.filter(
      (tag) => tag[0] === "link-preview" && tag[1] === "snapshot",
    );
    const validSnapshots = parseLinkPreviewSnapshots(
      snapshots,
      args.content,
      new URL(getRelayHttpUrl(config)).origin,
    );
    if (
      (suppression && linkPreviewTags.length !== 1) ||
      (!suppression &&
        (snapshots.length !== linkPreviewTags.length ||
          validSnapshots.length !== snapshots.length ||
          snapshots.some(
            (tag) => !isValidLinkPreviewSnapshotCanonicalUrl(tag[3] ?? ""),
          )))
    ) {
      throw new Error("invalid link-preview snapshot tag");
    }
  }
  // All independently validated kinds end up on the stored event's tag set,
  // just like the real relay.
  const extraTags = [
    ...mediaTags,
    ...emojiTags,
    ...mentionTags,
    ...linkPreviewTags,
    ...(args.sentFromThreadTag ? [args.sentFromThreadTag] : []),
    ...(args.suppressLinkPreviews ? [["link-preview", "none"]] : []),
  ];
  const identity = getIdentity(config);
  if (!identity) {
    const createdAt = Math.floor(Date.now() / 1000);
    const mockPubkey = getMockMemberPubkey(config);

    if (!args.parentEventId) {
      const event = createMockEvent(9, args.content, [
        ...buildTopLevelMessageTags(
          args.channelId,
          args.mentionPubkeys,
          mockPubkey,
        ),
        ...extraTags,
      ]);
      recordMockMessage(args.channelId, event);
      emitOrDeferMockSendMessageLiveEcho(args.channelId, event, config);

      return {
        event_id: event.id,
        parent_event_id: null,
        root_event_id: null,
        depth: 0,
        created_at: createdAt,
      };
    }

    const history = getMockMessageStore(args.channelId);
    const parentEvent = history.find(
      (event) => event.id === args.parentEventId,
    );
    const parentThread = parentEvent
      ? getThreadReferenceFromTags(parentEvent.tags)
      : {
          parentEventId: null,
          rootEventId: null,
        };
    const rootEventId =
      args.rootEventId ?? parentThread.rootEventId ?? args.parentEventId;
    const depth = parentEvent
      ? (() => {
          let currentEvent: RelayEvent | undefined = parentEvent;
          let nextDepth = 1;

          while (currentEvent) {
            const reference = getThreadReferenceFromTags(currentEvent.tags);
            if (!reference.parentEventId) {
              return nextDepth;
            }

            nextDepth += 1;
            currentEvent = history.find(
              (event) => event.id === reference.parentEventId,
            );
          }

          return nextDepth;
        })()
      : 1;

    const event: RelayEvent = {
      id: mockEventId(),
      pubkey: mockPubkey,
      created_at: createdAt,
      kind: 9,
      tags: [
        ...buildReplyMessageTags(
          args.channelId,
          mockPubkey,
          args.parentEventId,
          rootEventId,
          args.mentionPubkeys,
        ),
        ...extraTags,
      ],
      content: args.content.trim(),
      sig: "mocksig".repeat(20).slice(0, 128),
    };

    recordMockMessage(args.channelId, event);
    emitOrDeferMockSendMessageLiveEcho(args.channelId, event, config);

    return {
      event_id: event.id,
      parent_event_id: args.parentEventId,
      root_event_id: rootEventId,
      depth,
      created_at: createdAt,
    };
  }

  const relayIdentity = getRelayIdentity(config);
  const tags = args.parentEventId
    ? buildReplyMessageTags(
        args.channelId,
        relayIdentity.pubkey,
        args.parentEventId,
        args.rootEventId ?? args.parentEventId,
        args.mentionPubkeys,
      )
    : buildTopLevelMessageTags(
        args.channelId,
        args.mentionPubkeys,
        relayIdentity.pubkey,
      );

  const result = await submitSignedEvent(config, {
    kind: 9,
    content: args.content.trim(),
    tags: [...tags, ...extraTags],
  });

  return {
    event_id: result.event_id,
    parent_event_id: args.parentEventId ?? null,
    root_event_id: args.rootEventId ?? args.parentEventId ?? null,
    depth: args.parentEventId
      ? args.rootEventId && args.rootEventId !== args.parentEventId
        ? 2
        : 1
      : 0,
    created_at: Math.floor(Date.now() / 1000),
  };
}

async function handleGetEvent(
  args: {
    eventId: string;
  },
  config: E2eConfig | undefined,
) {
  // Defer/release seam: when __BUZZ_E2E_DEFER_GET_EVENT__ is set to this
  // event's ID, hold this call in the queue until __BUZZ_E2E_RELEASE_GET_EVENT__()
  // is called.  Only the target ID is deferred; all other IDs resolve normally.
  // This keeps ancestor-lookup and context loads from being stalled or counted.
  if (
    window.__BUZZ_E2E_DEFER_GET_EVENT__ &&
    window.__BUZZ_E2E_DEFER_GET_EVENT__ === args.eventId
  ) {
    // Increment the count only for calls that are actually deferred.
    window.__BUZZ_E2E_GET_EVENT_CALL_COUNT__ =
      (window.__BUZZ_E2E_GET_EVENT_CALL_COUNT__ ?? 0) + 1;
    return new Promise<string>((resolve, reject) => {
      deferredGetEventQueue.push({
        resolve,
        reject,
        run: () => resolveGetEvent(args, config),
      });
    });
  }

  return resolveGetEvent(args, config);
}

async function resolveGetEvent(
  args: {
    eventId: string;
  },
  config: E2eConfig | undefined,
) {
  // Allow test specs to mark specific event IDs as definitively deleted.
  if (config?.mock?.deletedEventIds?.includes(args.eventId)) {
    throw new Error("event not found");
  }
  const identity = getIdentity(config);
  if (!identity) {
    const knownEvents: RelayEvent[] = [
      ...Array.from(mockMessages.values()).flat(),
      {
        id: "mock-engineering-shipped",
        pubkey:
          "bb22a5299220cad76ffd46190ccbeede8ab5dc260faa28b6e5a2cb31b9aff260",
        created_at: Math.floor(Date.now() / 1000) - 42 * 60,
        kind: 9,
        tags: [["h", "1c7e1c02-87bb-5e88-b2da-5a7a9432d0c9"]],
        content: "Engineering shipped the desktop build.",
        sig: "mocksig".repeat(20).slice(0, 128),
      },
      {
        id: "mock-design-critique",
        pubkey:
          "953d3363262e86b770419834c53d2446409db6d918a57f8f339d495d54ab001f",
        created_at: Math.floor(Date.now() / 1000) - 75 * 60,
        kind: 9,
        tags: [["h", "b5e2f8a1-3c44-5912-9e67-4a8d1f2b3c4e"]],
        content: "Design critique notes for the browse flow.",
        sig: "mocksig".repeat(20).slice(0, 128),
      },
    ];
    const event = knownEvents.find((item) => item.id === args.eventId);
    if (!event) {
      throw new Error(`Event not found: ${args.eventId}`);
    }

    return JSON.stringify(event);
  }

  // Query single event by ID via POST /query
  const events = await relayQuery(config, [{ ids: [args.eventId], limit: 1 }]);
  if (events.length === 0) {
    throw new Error(`Event not found: ${args.eventId}`);
  }
  return JSON.stringify(events[0]);
}

async function connectRealSocket(args: { url?: string; onMessage: unknown }) {
  relayWebsocketConnectAttemptStarts.push(Date.now());
  const wsId = nextSocketId++;
  const ws = new WebSocket(args.url ?? DEFAULT_RELAY_WS_URL);
  const handler = resolveHandler(args.onMessage);

  realSockets.set(wsId, ws);
  ws.addEventListener("message", (event) => {
    handler({
      type: "Text",
      data: event.data,
    });
  });
  ws.addEventListener("close", () => {
    sendWsClose(handler);
    realSockets.delete(wsId);
  });
  ws.addEventListener("error", () => {
    handler({
      type: "Error",
    });
  });

  return await new Promise<number>((resolve) => {
    ws.addEventListener("open", () => resolve(wsId), { once: true });
    ws.addEventListener("error", () => resolve(wsId), { once: true });
  });
}

async function connectMockSocket(args: { onMessage: unknown }) {
  relayWebsocketConnectAttemptStarts.push(Date.now());
  if (mockWebsocketUnavailable) {
    throw new Error("mock relay unavailable");
  }
  const connectError = getConfig()?.mock?.websocketConnectErrors?.shift();
  if (connectError) {
    throw new Error(connectError);
  }

  if (mockWebsocketSendMutexWedged) {
    return new Promise<number>(() => {});
  }

  const wsId = nextSocketId++;
  const handler = resolveHandler(args.onMessage);

  mockSockets.set(wsId, {
    handler,
    subscriptions: new Map(),
  });

  if (getConfig()?.mock?.websocketAuthBeforeConnectResolves) {
    sendWsText(handler, ["AUTH", `mock-challenge-${wsId}`]);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
  } else {
    window.setTimeout(() => {
      sendWsText(handler, ["AUTH", `mock-challenge-${wsId}`]);
    }, 0);
  }

  return wsId;
}

async function sendToRealSocket(args: {
  id: number;
  message?: {
    type: "Text" | "Close";
    data?: string;
  };
}) {
  const socket = realSockets.get(args.id);
  if (!socket) {
    return;
  }

  if (args.message?.type === "Close") {
    socket.close();
    return;
  }

  if (args.message?.type === "Text") {
    socket.send(args.message.data ?? "");
  }
}

function sendToMockSocket(args: {
  id: number;
  message?: {
    type: "Text" | "Close";
    data?: string;
  };
}) {
  const socket = mockSockets.get(args.id);
  if (
    getConfig()?.mock?.stallWebsocketSends &&
    args.message?.type !== "Close"
  ) {
    mockWebsocketSendMutexWedged = true;
    return new Promise<void>(() => {});
  }

  if (!socket || !args.message) {
    return;
  }

  if (args.message.type === "Close") {
    mockSockets.delete(args.id);
    sendWsClose(socket.handler);
    return;
  }

  if (args.message.type !== "Text" || !args.message.data) {
    return;
  }

  const [type, ...rest] = JSON.parse(args.message.data) as [
    string,
    ...unknown[],
  ];

  if (type === "AUTH") {
    const event = rest[0] as RelayEvent;
    const response = mockAuthResponses.shift() ?? {
      success: true,
      message: "",
    };
    sendWsText(socket.handler, [
      "OK",
      event.id,
      response.success,
      response.message,
    ]);
    return;
  }

  if (type === "REQ") {
    const subId = rest[0] as string;
    const filters = rest.slice(1) as MockFilter[];

    if (subId.startsWith("live-")) {
      // Collect channel IDs from all filters in the REQ
      const channelIds = new Set<string>();
      const kinds = new Set<number>();
      const ownerPubkeys = new Set<string>();
      for (const f of filters) {
        for (const channelId of f["#h"] ?? []) channelIds.add(channelId);
        for (const kind of f.kinds ?? []) {
          kinds.add(kind);
        }
        for (const p of f["#p"] ?? []) {
          ownerPubkeys.add(p);
        }
      }
      const onlyChannelId =
        channelIds.size === 1
          ? (channelIds.values().next().value as string)
          : undefined;
      if (
        getConfig()?.mock?.closeChannelLiveSubscriptionOnce &&
        !mockClosedChannelLiveSubscription &&
        onlyChannelId &&
        kinds.has(KIND_CHANNEL_THREAD_SUMMARY)
      ) {
        mockClosedChannelLiveSubscription = true;
        sendWsText(socket.handler, ["CLOSED", subId, "rate-limited"]);
        return;
      }
      socket.subscriptions.set(subId, {
        channelIds:
          channelIds.size > 0 ? [...channelIds] : [GLOBAL_MOCK_SUBSCRIPTION],
        kinds: kinds.size > 0 ? [...kinds] : null,
        ownerPubkeys: [...ownerPubkeys],
      });
      sendWsText(socket.handler, ["EOSE", subId]);
      return;
    }

    const filter = rest[1] as MockFilter;
    const channelIds = filter["#h"] ?? [];
    if (channelIds.length > 0 && subId.startsWith("history-")) {
      const closeReason = mockChannelHistoryCloses.shift();
      if (closeReason) {
        sendWsText(socket.handler, ["CLOSED", subId, closeReason]);
        return;
      }
    }
    if (channelIds.length === 0) {
      // Aux-backfill filters (reactions/deletions) are `#e`-keyed with no
      // channel tag — serve them across all channel stores like the relay.
      const referencedIds = filter["#e"];
      if (referencedIds && referencedIds.length > 0) {
        const targets = new Set(referencedIds);
        for (const events of mockMessages.values()) {
          for (const event of events) {
            if (filter.kinds && !filter.kinds.includes(event.kind)) {
              continue;
            }
            if (
              event.tags.some(
                (tag) => tag[0] === "e" && tag[1] && targets.has(tag[1]),
              )
            ) {
              sendWsText(socket.handler, ["EVENT", subId, event]);
            }
          }
        }
      }
      sendWsText(socket.handler, ["EOSE", subId]);
      return;
    }

    emitMockHistory(socket, subId, channelIds, filter);
    return;
  }

  if (type === "CLOSE") {
    const subId = rest[0] as string;
    socket.subscriptions.delete(subId);
    return;
  }

  if (type === "EVENT") {
    const event = rest[0] as RelayEvent;
    const channelId = getChannelIdFromTags(event.tags);
    if (!channelId) {
      sendWsText(socket.handler, [
        "OK",
        event.id,
        false,
        "Missing channel tag.",
      ]);
      return;
    }

    const sendMessageError =
      event.kind === 9 ? getConfig()?.mock?.sendMessageErrors?.shift() : null;
    if (sendMessageError) {
      sendWsText(socket.handler, ["OK", event.id, false, sendMessageError]);
      return;
    }

    recordMockMessage(channelId, event);
    emitMockLiveEvent(channelId, event);
    sendWsText(socket.handler, ["OK", event.id, true, ""]);
  }
}

function disconnectMockSocket(id: number) {
  const socket = mockSockets.get(id);
  if (!socket) {
    return;
  }

  mockSockets.delete(id);
  sendWsClose(socket.handler);
}

export function maybeInstallE2eTauriMocks() {
  if (installed) {
    return;
  }

  const config = getConfig();
  if (!config) {
    return;
  }

  mockClosedChannelLiveSubscription = false;
  mockWebsocketUnavailable = false;
  mockAuthResponses.length = 0;
  mockChannelHistoryCloses.length = 0;
  relayWebsocketConnectAttemptStarts.length = 0;
  mockAuthSigningAttempts = 0;
  deferredSendMessageLiveEchoes.length = 0;
  deferredLinkPreviewMetadataQueue = [];
  deferredLinkPreviewUploadQueue = [];
  deferredThreadRepliesQueue = [];
  deferredProfileReadQueue = [];
  profileReadsReleased = false;
  holdUsersBatch = false;
  heldUsersBatchReleases = [];
  cancelledMediaUploadIds = new Set<string>();
  for (const controller of mockMediaFetchControllers.values()) {
    controller.abort();
  }
  cancelledMediaFetchIds = new Set<string>();
  mockMediaFetchControllers = new Map<string, AbortController>();
  window.__BUZZ_E2E_LINK_PREVIEW_UPLOAD_STARTS__ = 0;
  window.__BUZZ_E2E_MEDIA_FETCH_STATE__ = { active: 0, peak: 0 };
  window.__BUZZ_E2E_RELEASE_LINK_PREVIEW_METADATA__ = () => {
    const queued = deferredLinkPreviewMetadataQueue.splice(0);
    for (const release of queued) release();
    return queued.length;
  };
  window.__BUZZ_E2E_RELEASE_LINK_PREVIEW_UPLOADS__ = () => {
    const queued = deferredLinkPreviewUploadQueue.splice(0);
    for (const release of queued) release();
    return queued.length;
  };
  window.__BUZZ_E2E_RELEASE_THREAD_REPLIES__ = () => {
    const queued = deferredThreadRepliesQueue.splice(0);
    for (const release of queued) release();
    return queued.length;
  };
  window.__BUZZ_E2E_THREAD_REPLIES_PENDING__ = () =>
    deferredThreadRepliesQueue.length;
  window.__BUZZ_E2E_RELEASE_PROFILE_READS__ = () => {
    profileReadsReleased = true;
    const queued = deferredProfileReadQueue.splice(0);
    for (const deferred of queued) {
      void deferred.run().then(deferred.resolve, deferred.reject);
    }
    return queued.length;
  };
  window.__BUZZ_E2E_PROFILE_READS_PENDING__ = () =>
    deferredProfileReadQueue.length;
  window.__BUZZ_E2E_HOLD_USERS_BATCH__ = (hold: boolean) => {
    holdUsersBatch = hold;
    // Releasing on the way out of the hold, not on the way in, is what lets a
    // spec keep one lookup pinned while another resolves from local state.
    const queued = hold ? [] : heldUsersBatchReleases.splice(0);
    for (const release of queued) release();
    return queued.length;
  };
  window.__BUZZ_E2E_USERS_BATCH_PENDING__ = () => heldUsersBatchReleases.length;
  seedMockSearchProfiles(config);
  resetMockObservedUnread();
  resetPlatformMock(config);
  resetMockPendingNavigationDeepLinks(config);
  mockWebsocketSendMutexWedged = false;
  if (config.mock?.windowLabel) {
    (window as Window & { isTauri?: boolean }).isTauri = true;
  }
  mockWindows(config.mock?.windowLabel ?? "main");
  window.__BUZZ_E2E_COMMANDS__ = [];
  window.__BUZZ_E2E_COMMAND_PAYLOADS__ = [];
  window.__BUZZ_E2E_COMMAND_LOG__ = [];
  mockMediaProxyPort = config.mock?.mediaProxyInitiallyUnavailable
    ? 0
    : MOCK_MEDIA_PROXY_PORT;
  window.__BUZZ_E2E_RELEASE_MEDIA_PROXY__ = () => {
    mockMediaProxyPort = MOCK_MEDIA_PROXY_PORT;
    resetMediaCaches();
    ensureRelayOriginFetch();
    return mockMediaProxyPort;
  };
  window.__BUZZ_E2E_SIGNED_EVENTS__ = [];
  window.__BUZZ_E2E_WEBVIEW_ZOOM__ = 1;
  window.__BUZZ_E2E_EMIT_MEDIA_UPLOAD_PHASE__ = async (input) => {
    await emit("media-upload-phase", input);
  };
  window.__BUZZ_E2E_EMIT_MEDIA_UPLOAD_PROGRESS__ = async (input) => {
    await emit("media-upload-progress", input);
  };
  window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__ = ({
    channelName,
    content,
    parentEventId,
    pubkey,
    kind,
    mentionPubkeys,
    extraTags,
    createdAt,
    pending,
    id,
  }) => {
    const channel = mockChannels.find(
      (candidate) => candidate.name === channelName,
    );
    if (!channel) {
      throw new Error(`Mock channel ${channelName} not found.`);
    }

    return emitMockChannelMessage(
      channel.id,
      content,
      parentEventId,
      pubkey,
      kind,
      mentionPubkeys,
      extraTags,
      createdAt,
      pending,
      id,
    );
  };
  window.__BUZZ_E2E_PREPEND_MOCK_HISTORY__ = prependMockHistory;
  window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__ = ({ channelName, kind }) => {
    const channel = mockChannels.find(
      (candidate) => candidate.name === channelName,
    );
    if (!channel) {
      throw new Error(`Mock channel ${channelName} not found.`);
    }

    return hasMockLiveSubscription(channel.id, kind);
  };
  window.__BUZZ_E2E_HAS_MOCK_GLOBAL_KIND_SUBSCRIPTION__ = (kind) =>
    hasMockLiveSubscription(GLOBAL_MOCK_SUBSCRIPTION, kind);
  window.__BUZZ_E2E_PUSH_MOCK_FEED_ITEM__ = (item) => {
    mockFeedMentionOverrides.unshift(item);
    window.dispatchEvent(new CustomEvent("buzz:e2e-home-feed-updated"));
    return item;
  };
  window.__BUZZ_E2E_REPLACE_MOCK_FEED_ITEM__ = (oldId, item) => {
    const idx = mockFeedMentionOverrides.findIndex((r) => r.id === oldId);
    if (idx !== -1) mockFeedMentionOverrides.splice(idx, 1);
    mockFeedMentionOverrides.unshift(item);
    window.dispatchEvent(new CustomEvent("buzz:e2e-home-feed-updated"));
    return item;
  };
  window.__BUZZ_E2E_MD_PARSE_COUNT__ = getMarkdownParseCount;
  window.__BUZZ_E2E_INVALIDATE_CHANNELS__ = async () => {
    await window.__BUZZ_E2E_QUERY_CLIENT__?.invalidateQueries({
      queryKey: ["channels"],
    });
  };
  window.__BUZZ_E2E_MUTATE_CHANNEL__ = ({
    channelId,
    name,
    channelType,
    description,
    removeMemberPubkey,
  }) => {
    const channel = mockChannels.find((ch) => ch.id === channelId);
    if (!channel) return;
    if (name !== undefined) {
      channel.name = name;
    }
    if (channelType !== undefined) {
      channel.channel_type = channelType;
    }
    if (description !== undefined) {
      channel.description = description;
    }
    if (removeMemberPubkey !== undefined) {
      channel.members = channel.members.filter(
        (m) => m.pubkey !== removeMemberPubkey,
      );
      syncMockChannel(channel);
    }
    touchMockChannel(channel);
  };
  // get_event defer/release seam — reset counter and queue on each install.
  window.__BUZZ_E2E_GET_EVENT_CALL_COUNT__ = 0;
  window.__BUZZ_E2E_DEFER_GET_EVENT__ = null;
  deferredGetEventQueue = [];
  deferNextChannelsRead = false;
  deferredChannelsReadResolve = null;
  window.__BUZZ_E2E_CHANNELS_READ_PENDING__ = 0;
  window.__BUZZ_E2E_DEFER_NEXT_CHANNELS_READ__ = () => {
    if (deferredChannelsReadResolve) {
      throw new Error("a channel read is already deferred");
    }
    deferNextChannelsRead = true;
  };
  window.__BUZZ_E2E_RELEASE_CHANNELS_READ__ = () => {
    deferNextChannelsRead = false;
    const resolve = deferredChannelsReadResolve;
    deferredChannelsReadResolve = null;
    window.__BUZZ_E2E_CHANNELS_READ_PENDING__ = 0;
    resolve?.();
    return resolve ? 1 : 0;
  };
  window.__BUZZ_E2E_RELEASE_GET_EVENT__ = () => {
    const queued = deferredGetEventQueue.splice(0);
    for (const entry of queued) {
      entry.run().then(entry.resolve, entry.reject);
    }
    // Disable deferral and reset counter after release so the seam is inert
    // for the remainder of the test (no stray defers from context loads).
    window.__BUZZ_E2E_DEFER_GET_EVENT__ = null;
    window.__BUZZ_E2E_GET_EVENT_CALL_COUNT__ = 0;
    return queued.length;
  };
  window.__BUZZ_E2E_SET_RELAY_CONNECTION_STATE__ = (state) => {
    // Directly emit a connection state change on the relay client singleton,
    // for tests that need to drive degraded relay UI without waiting for the
    // real auth-timeout + reconnect-debounce cycle (~10 s). Reaches the
    // TS-private emitter via a cast so the production class carries no
    // test-only seam.
    (
      relayClient as unknown as {
        connectionStateEmitter: { set: (s: ConnectionState) => void };
      }
    ).connectionStateEmitter.set(state);
  };
  window.__BUZZ_E2E_GET_RELAY_CONNECTION_STATE__ = () =>
    relayClient.getConnectionState();
  window.__BUZZ_E2E_QUEUE_AUTH_RESPONSES__ = (responses) => {
    mockAuthResponses.push(...responses);
  };
  window.__BUZZ_E2E_QUEUE_CHANNEL_HISTORY_CLOSES__ = (reasons) => {
    mockChannelHistoryCloses.push(...reasons);
  };
  window.__BUZZ_E2E_CLOSE_LIVE_SUBSCRIPTIONS__ = (reason) => {
    let closed = 0;
    for (const socket of mockSockets.values()) {
      for (const subId of [...socket.subscriptions.keys()]) {
        sendWsText(socket.handler, ["CLOSED", subId, reason]);
        socket.subscriptions.delete(subId);
        closed += 1;
      }
    }
    return closed;
  };

  window.__BUZZ_E2E_SET_STALL_WEBSOCKET_SENDS__ = (stall) => {
    const config = getConfig();
    if (!config?.mock) return;
    config.mock.stallWebsocketSends = stall;
    if (!stall) mockWebsocketSendMutexWedged = false;
  };
  window.__BUZZ_E2E_OPEN_MOCK_WEBSOCKETS__ = () => mockSockets.size;
  window.__BUZZ_E2E_DISCONNECT_MOCK_WEBSOCKETS__ = () => {
    const socketIds = [...mockSockets.keys()];
    for (const socketId of socketIds) disconnectMockSocket(socketId);
    return socketIds.length;
  };
  window.__BUZZ_E2E_RESTART_MOCK_WEBSOCKETS__ = () => {
    const sockets = [...mockSockets.values()];
    mockSockets.clear();
    for (const socket of sockets) {
      sendWsClose(socket.handler, 1012, "relay restarting");
    }
    return sockets.length;
  };
  window.__BUZZ_E2E_SET_MOCK_WEBSOCKET_UNAVAILABLE__ = (unavailable) => {
    mockWebsocketUnavailable = unavailable;
    if (unavailable) relayWebsocketConnectAttemptStarts.length = 0;
  };
  window.__BUZZ_E2E_GET_WEBSOCKET_CONNECT_ATTEMPTS__ = () => [
    ...relayWebsocketConnectAttemptStarts,
  ];
  window.__BUZZ_E2E_ACTIVATE_RELAY_RATE_LIMIT__ = (seconds) => {
    activateRateLimit(seconds);
  };
  window.__BUZZ_E2E_RESET_WEBSOCKET_CONNECT_ATTEMPTS__ = () => {
    relayWebsocketConnectAttemptStarts.length = 0;
  };
  window.__BUZZ_E2E_RELEASE_SEND_MESSAGE_LIVE_ECHO__ = () => {
    const queued = deferredSendMessageLiveEchoes.splice(0);
    for (const { channelId, event } of queued) {
      emitMockLiveEvent(channelId, event);
    }
    return queued.length;
  };
  const handleMockCommand = async (
    command: string,
    payload: unknown,
  ): Promise<unknown> => {
    const activeConfig = getConfig();
    const identity = getActiveIdentity(activeConfig);
    window.__BUZZ_E2E_COMMANDS__?.push(command);
    const loggedPayload = (() => {
      if (payload instanceof Uint8Array) {
        return { rawByteLength: payload.byteLength };
      }
      try {
        return JSON.parse(JSON.stringify(payload ?? null));
      } catch {
        return null;
      }
    })();
    window.__BUZZ_E2E_COMMAND_PAYLOADS__?.push({
      command,
      payload: loggedPayload,
    });
    window.__BUZZ_E2E_COMMAND_LOG__?.push({ command, payload });

    if (command.startsWith("platform_")) {
      return handlePlatformCommand(
        command,
        payload,
        activeConfig,
        identity?.pubkey ?? DEFAULT_MOCK_IDENTITY.pubkey,
      );
    }

    switch (command) {
      case "get_identity": {
        const identityReadError = activeConfig?.mock?.identityReadErrorAfter;
        if (
          identityReadError &&
          !identityReadErrorConsumed &&
          identityReadCount >= identityReadError.successfulReads
        ) {
          identityReadErrorConsumed = true;
          throw new Error(identityReadError.message);
        }
        identityReadCount += 1;
        const isLost =
          !mockIdentityLostCleared && activeConfig?.mock?.identityLost === true;
        const isLocked = activeConfig?.mock?.identityLocked === true;
        if (identity) {
          return {
            pubkey: identity.pubkey,
            display_name: identity.username,
            lost: false,
            locked: false,
          };
        }

        return { ...DEFAULT_MOCK_IDENTITY, lost: isLost, locked: isLocked };
      }
      case "persist_current_identity": {
        // Persist the ephemeral key: clears only the lost flag. Production
        // rejects persist_current_identity when the keyring is locked.
        mockIdentityLostCleared = true;
        const currentPubkey = identity?.pubkey ?? DEFAULT_MOCK_IDENTITY.pubkey;
        const currentDisplayName =
          identity?.username ?? DEFAULT_MOCK_IDENTITY.display_name;
        return {
          pubkey: currentPubkey,
          display_name: currentDisplayName,
          lost: false,
          locked: false,
        };
      }
      case "fetch_link_preview_metadata": {
        if (activeConfig?.mock?.deferLinkPreviewMetadata) {
          await new Promise<void>((resolve) => {
            deferredLinkPreviewMetadataQueue.push(resolve);
          });
        }
        const startBlockMs =
          activeConfig?.mock?.linkPreviewMetadataStartBlockMs ?? 0;
        if (startBlockMs > 0) {
          const stopAt = performance.now() + startBlockMs;
          while (performance.now() < stopAt) {
            // Deliberately block to model uncached native command startup.
          }
        }
        const delayMs = activeConfig?.mock?.linkPreviewMetadataDelayMs ?? 0;
        if (delayMs > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        }
        const href = (payload as { href?: string }).href;
        const metadataByHref = activeConfig?.mock?.linkPreviewMetadataByHref;
        if (href && metadataByHref && Object.hasOwn(metadataByHref, href)) {
          return metadataByHref[href];
        }
        return activeConfig?.mock?.linkPreviewMetadata ?? null;
      }
      case "apply_workspace": {
        const applyDelayMs = activeConfig?.mock?.applyCommunityDelayMs ?? 0;
        if (applyDelayMs > 0) {
          return new Promise((resolve) =>
            window.setTimeout(resolve, applyDelayMs),
          );
        }
        return;
      }
      case "get_profile":
        return handleGetProfile(activeConfig);
      case "get_user_profile":
        return handleGetUserProfile(
          (payload as Parameters<typeof handleGetUserProfile>[0]) ?? {},
          activeConfig,
        );
      case "get_users_batch":
        return handleGetUsersBatch(
          payload as Parameters<typeof handleGetUsersBatch>[0],
          activeConfig,
        );
      case "search_users":
        return handleSearchUsers(
          payload as Parameters<typeof handleSearchUsers>[0],
          activeConfig,
        );
      case "get_relay_ws_url":
        return getRelayWsUrl(activeConfig);
      case "clear_pending_navigation_deep_links":
        if (activeConfig?.mock?.clearPendingNavigationDeepLinksError) {
          throw new Error(
            activeConfig.mock.clearPendingNavigationDeepLinksError,
          );
        }
        mockPendingNavigationDeepLinks.length = 0;
        return;
      case "take_pending_navigation_deep_link":
        return mockPendingNavigationDeepLinks[0] ?? null;
      case "acknowledge_pending_navigation_deep_link": {
        const { id } = payload as { id: string };
        if (mockPendingNavigationDeepLinks[0]?.id !== id) return false;
        mockPendingNavigationDeepLinks.shift();
        return true;
      }
      case "get_relay_http_url":
        return getRelayHttpUrl(activeConfig);
      case "get_channels": {
        // Claim the one-shot before starting the read, then hold only that
        // invocation's completion. Later reads pass through and cannot join it.
        const deferred = deferNextChannelsRead;
        deferNextChannelsRead = false;
        const channels = handleGetChannels(payload, activeConfig);
        if (deferred) {
          await new Promise<void>((resolve) => {
            deferredChannelsReadResolve = resolve;
            window.__BUZZ_E2E_CHANNELS_READ_PENDING__ = 1;
          });
        }
        return channels;
      }
      case "get_feed":
        return handleGetFeed(
          (payload as Parameters<typeof handleGetFeed>[0]) ?? {},
          activeConfig,
        );
      case "get_channel_details":
        return handleGetChannelDetails(
          payload as Parameters<typeof handleGetChannelDetails>[0],
          activeConfig,
        );
      case "get_channel_members":
        return handleGetChannelMembers(
          payload as Parameters<typeof handleGetChannelMembers>[0],
          activeConfig,
        );
      case "search_messages":
        return handleSearchMessages(
          payload as Parameters<typeof handleSearchMessages>[0],
          activeConfig,
        );
      case "get_thread_replies":
        return handleGetThreadReplies(
          payload as Parameters<typeof handleGetThreadReplies>[0],
          activeConfig,
        );
      case "get_channel_messages_before":
        return handleGetChannelMessagesBefore(
          payload as Parameters<typeof handleGetChannelMessagesBefore>[0],
          activeConfig,
        );
      case "get_channel_reconnect_repair":
        return handleGetChannelReconnectRepair(
          payload as Parameters<typeof handleGetChannelReconnectRepair>[0],
          activeConfig,
        );
      case "get_channel_window":
        return handleGetChannelWindow(
          payload as Parameters<typeof handleGetChannelWindow>[0],
          activeConfig,
        );
      case "send_channel_message":
        return handleSendChannelMessage(
          payload as Parameters<typeof handleSendChannelMessage>[0],
          activeConfig,
        );
      case "get_media_proxy_port":
        return mockMediaProxyPort;
      case "pick_and_upload_media":
        return await resolveMockUploadDescriptors(activeConfig);
      case "upload_media_bytes": {
        const input = payload as {
          data: number[];
          filename?: string | null;
          progressId?: string | null;
        };
        if (
          activeConfig?.mock?.deferLinkPreviewUploadRegistration &&
          input.filename?.startsWith("link-preview-")
        ) {
          await new Promise<void>((resolve) => {
            deferredLinkPreviewUploadQueue.push(resolve);
          });
        }
        if (input.progressId && cancelledMediaUploadIds.has(input.progressId)) {
          throw new Error("upload cancelled");
        }
        if (input.filename?.startsWith("link-preview-")) {
          window.__BUZZ_E2E_LINK_PREVIEW_UPLOAD_STARTS__ =
            (window.__BUZZ_E2E_LINK_PREVIEW_UPLOAD_STARTS__ ?? 0) + 1;
        }
        return resolveMockUploadDescriptorForBytes(input, activeConfig);
      }
      case "cancel_media_upload": {
        const progressId = (payload as { progressId?: string }).progressId;
        if (progressId) cancelledMediaUploadIds.add(progressId);
        return null;
      }
      case "release_media_upload": {
        const progressId = (payload as { progressId?: string }).progressId;
        if (progressId) cancelledMediaUploadIds.delete(progressId);
        return null;
      }
      case "upload_media_bytes_raw":
        return resolveMockUploadDescriptorForBytes(
          {
            data: payload as Uint8Array,
          },
          activeConfig,
        );
      case "fetch_media_bytes": {
        // The real command fetches relay media through Rust reqwest and
        // replies with raw bytes (`tauri::ipc::Response` → ArrayBuffer). In
        // E2E the browser fetch suffices — specs serve the URL via page.route.
        const input = payload as { requestId?: string; url: string };
        const requestId = input.requestId ?? crypto.randomUUID();
        const controller = new AbortController();
        mockMediaFetchControllers.set(requestId, controller);
        if (cancelledMediaFetchIds.has(requestId)) controller.abort();
        if (!window.__BUZZ_E2E_MEDIA_FETCH_STATE__) {
          window.__BUZZ_E2E_MEDIA_FETCH_STATE__ = { active: 0, peak: 0 };
        }
        const stats = window.__BUZZ_E2E_MEDIA_FETCH_STATE__;
        stats.active += 1;
        stats.peak = Math.max(stats.peak, stats.active);
        try {
          if (window.__BUZZ_E2E_HOLD_MEDIA_FETCHES__) {
            await new Promise<never>((_resolve, reject) => {
              const rejectCancelled = () =>
                reject(new DOMException("fetch cancelled", "AbortError"));
              if (controller.signal.aborted) {
                rejectCancelled();
                return;
              }
              controller.signal.addEventListener("abort", rejectCancelled, {
                once: true,
              });
            });
          }
          const response = await fetch(input.url, {
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
          return await response.arrayBuffer();
        } finally {
          stats.active -= 1;
          mockMediaFetchControllers.delete(requestId);
        }
      }
      case "cancel_media_fetch": {
        const requestId = (payload as { requestId?: string }).requestId;
        if (requestId) {
          cancelledMediaFetchIds.add(requestId);
          mockMediaFetchControllers.get(requestId)?.abort();
        }
        return null;
      }
      case "release_media_fetch": {
        const requestId = (payload as { requestId?: string }).requestId;
        if (requestId) {
          cancelledMediaFetchIds.delete(requestId);
          mockMediaFetchControllers.delete(requestId);
        }
        return null;
      }
      case "download_image":
      case "download_file":
        // The save dialog can't run headlessly; report a successful save so the
        // FileCard / image-menu click handlers resolve. Specs assert the
        // command was invoked via `__BUZZ_E2E_COMMANDS__`, not the dialog.
        return true;
      case "copy_image_to_clipboard":
        return;
      case "copy_text_to_clipboard":
        await writeClipboardFlavors(payload as { html?: string; text: string });
        return;
      case "read_clipboard_text":
        return navigator.clipboard.readText();
      case "get_event":
        return handleGetEvent(
          payload as Parameters<typeof handleGetEvent>[0],
          activeConfig,
        );
      case "get_events":
        return Promise.all(
          (payload as { eventIds: string[] }).eventIds.map(
            async (eventId) =>
              JSON.parse(
                await handleGetEvent({ eventId }, activeConfig),
              ) as RelayEvent,
          ),
        );
      case "sign_event":
        window.__BUZZ_E2E_SIGNED_EVENTS__?.push({
          content: (payload as { content: string }).content,
          createdAt: (payload as { createdAt?: number }).createdAt,
          kind: (payload as { kind: number }).kind,
          tags: (payload as { tags: string[][] }).tags,
        });
        if (identity) {
          return JSON.stringify(
            await signWithIdentity(identity, {
              kind: (payload as { kind: number }).kind,
              content: (payload as { content: string }).content,
              createdAt: (payload as { createdAt?: number }).createdAt,
              tags: (payload as { tags: string[][] }).tags,
            }),
          );
        }

        return JSON.stringify(
          createMockEvent(
            (payload as { kind: number }).kind,
            (payload as { content: string }).content,
            (payload as { tags: string[][] }).tags,
            DEFAULT_MOCK_IDENTITY.pubkey,
            (payload as { createdAt?: number }).createdAt,
          ),
        );
      case "create_auth_event":
        mockAuthSigningAttempts++;
        if (
          getConfig()?.mock?.stallFirstAuthSigning &&
          mockAuthSigningAttempts === 1
        ) {
          return new Promise<string>(() => {});
        }
        if (identity) {
          return JSON.stringify(
            await signWithIdentity(identity, {
              kind: 22242,
              content: "",
              tags: [
                ["relay", (payload as { relayUrl: string }).relayUrl],
                ["challenge", (payload as { challenge: string }).challenge],
              ],
            }),
          );
        }

        return JSON.stringify(
          createMockEvent(22242, "", [
            ["relay", (payload as { relayUrl: string }).relayUrl],
            ["challenge", (payload as { challenge: string }).challenge],
          ]),
        );
      case "plugin:websocket|connect":
        if (isRelayMode(activeConfig)) {
          return connectRealSocket(
            payload as Parameters<typeof connectRealSocket>[0],
          );
        }

        return connectMockSocket(
          payload as Parameters<typeof connectMockSocket>[0],
        );
      case "plugin:websocket|disconnect": {
        const { id } = payload as { id: number };
        if (isRelayMode(activeConfig)) {
          realSockets.get(id)?.close();
          realSockets.delete(id);
        } else {
          const socket = mockSockets.get(id);
          mockSockets.delete(id);
          if (socket) sendWsClose(socket.handler);
        }
        return null;
      }
      case "plugin:websocket|disconnect_all":
        for (const socket of realSockets.values()) socket.close();
        realSockets.clear();
        for (const socket of mockSockets.values()) sendWsClose(socket.handler);
        mockSockets.clear();
        mockWebsocketSendMutexWedged = false;
        return null;
      case "plugin:websocket|send":
        if (isRelayMode(activeConfig)) {
          return sendToRealSocket(
            payload as Parameters<typeof sendToRealSocket>[0],
          );
        }

        return sendToMockSocket(
          payload as Parameters<typeof sendToMockSocket>[0],
        );
      case "plugin:opener|open_url":
        if (activeConfig?.mock?.openerError) {
          throw new Error(activeConfig.mock.openerError);
        }
        openedExternalUrls.push(String((payload as { url: string | URL }).url));
        return null;
      case "get_e2e_opened_external_urls":
        return [...openedExternalUrls];
      case "clear_e2e_opened_external_urls":
        openedExternalUrls.length = 0;
        return null;
      case "plugin:window|show":
      case "plugin:window|unminimize":
      case "plugin:window|set_focus":
      case "plugin:window|set_badge_count":
      case "plugin:window|set_badge_label":
        return null;
      case "relay_reconnect_hook":
        return null;
      case "relay_reconnect_hook_configured":
        return false;
      case "plugin:resources|close":
        return null;
      case "plugin:process|restart":
        return handleRestart(activeConfig);
      case "plugin:webview|set_webview_zoom":
        window.__BUZZ_E2E_WEBVIEW_ZOOM__ = (payload as { value: number }).value;
        return;
      case "get_relay_self":
        if ((activeConfig?.mock?.relaySelfDelayMs ?? 0) > 0) {
          await new Promise((resolve) =>
            window.setTimeout(
              resolve,
              activeConfig?.mock?.relaySelfDelayMs ?? 0,
            ),
          );
        }
        return activeConfig?.mock?.relaySelf ?? null;
      case "channel_head_cache_load": {
        const args = payload as {
          scope: { pubkey: string; relayUrl: string };
          limit: number;
        };
        const key = `buzz-e2e-channel-head:${args.scope.pubkey.toLowerCase()}:${args.scope.relayUrl.toLowerCase().replace(/\/$/, "")}`;
        const entries = JSON.parse(
          window.localStorage.getItem(key) ?? "[]",
        ) as Array<{
          channelId: string;
          events: RelayEvent[];
          savedAt: number;
          lastVisitedAt: number;
        }>;
        return entries
          .sort((left, right) => right.lastVisitedAt - left.lastVisitedAt)
          .slice(0, args.limit);
      }
      case "channel_head_cache_store": {
        const args = payload as {
          scope: { pubkey: string; relayUrl: string };
          channelId: string;
          events: RelayEvent[];
        };
        const key = `buzz-e2e-channel-head:${args.scope.pubkey.toLowerCase()}:${args.scope.relayUrl.toLowerCase().replace(/\/$/, "")}`;
        const entries = JSON.parse(
          window.localStorage.getItem(key) ?? "[]",
        ) as Array<{
          channelId: string;
          events: RelayEvent[];
          savedAt: number;
          lastVisitedAt: number;
        }>;
        const now = Math.floor(Date.now() / 1000);
        const next = entries
          .filter((entry) => entry.channelId !== args.channelId)
          .concat({
            channelId: args.channelId,
            events: args.events,
            savedAt: now,
            lastVisitedAt: now,
          })
          .sort((left, right) => right.lastVisitedAt - left.lastVisitedAt)
          .slice(0, 32);
        window.localStorage.setItem(key, JSON.stringify(next));
        return null;
      }
      case "channel_head_cache_clear": {
        const args = payload as { scope: { pubkey: string; relayUrl: string } };
        const key = `buzz-e2e-channel-head:${args.scope.pubkey.toLowerCase()}:${args.scope.relayUrl.toLowerCase().replace(/\/$/, "")}`;
        window.localStorage.removeItem(key);
        return null;
      }
      case "observed_unread_open_scope": {
        const request = payload as {
          request: {
            scope: { pubkey: string; relayUrl: string };
            legacyPayload?: {
              eventsByChannel?: Record<
                string,
                Array<{
                  id: string;
                  createdAt: number;
                  rootId?: string | null;
                  highPriority: boolean;
                  countsTowardBadge: boolean;
                  countsTowardAppBadge: boolean;
                }>
              >;
            };
          };
        };
        const scope = getMockObservedUnreadScope(request.request.scope);
        if (!scope.migrationComplete) {
          for (const [channelId, events] of Object.entries(
            request.request.legacyPayload?.eventsByChannel ?? {},
          )) {
            for (const event of events) {
              if (!scope.events.has(event.id)) {
                scope.events.set(event.id, {
                  channelId,
                  ...event,
                  rootId: event.rootId ?? null,
                });
              }
            }
          }
          scope.migrationComplete = true;
        }
        return {
          kind: "snapshot",
          scope: request.request.scope,
          generation: scope.generation,
          revision: scope.revision,
          lastAckedSequence: scope.lastSequence,
          migrationComplete: scope.migrationComplete,
          membershipSeeded: true,
          channels: mockObservedUnreadProjections(scope),
        } satisfies ObservedUnreadResponse;
      }
      case "observed_unread_ingest": {
        const { request } = payload as {
          request: {
            scope: { pubkey: string; relayUrl: string };
            sequence: number;
            baseRevision: number;
            events: Array<{
              channelId: string;
              id: string;
              createdAt: number;
              rootId: string | null;
              highPriority: boolean;
              countsTowardBadge: boolean;
              countsTowardAppBadge: boolean;
            }>;
            channelLatest: Array<{ channelId: string; createdAt: number }>;
            markers: Array<{ contextId: string; readAt: number | null }>;
            membership: Array<{
              kind: string;
              value: string;
              present: boolean;
            }>;
            clearChannels: string[];
            clearAll: boolean;
          };
        };
        const scope = getMockObservedUnreadScope(request.scope);
        const before = new Map(
          mockObservedUnreadProjections(scope).map((item) => [
            item.channelId,
            item,
          ]),
        );
        if (request.clearAll) {
          scope.events.clear();
          scope.channelLatest.clear();
        }
        for (const channelId of request.clearChannels) {
          scope.channelLatest.delete(channelId);
          for (const [id, event] of scope.events) {
            if (event.channelId === channelId) scope.events.delete(id);
          }
        }
        for (const latest of request.channelLatest ?? []) {
          scope.channelLatest.set(
            latest.channelId,
            Math.max(
              scope.channelLatest.get(latest.channelId) ?? 0,
              latest.createdAt,
            ),
          );
        }
        for (const event of request.events ?? []) {
          if (!scope.events.has(event.id)) scope.events.set(event.id, event);
        }
        for (const marker of request.markers ?? []) {
          if (marker.readAt === null) scope.markers.delete(marker.contextId);
          else
            scope.markers.set(
              marker.contextId,
              Math.max(scope.markers.get(marker.contextId) ?? 0, marker.readAt),
            );
        }
        const after = mockObservedUnreadProjections(scope);
        const afterIds = new Set(after.map((item) => item.channelId));
        const baseRevision = scope.revision;
        scope.revision += 1;
        scope.lastSequence = request.sequence;
        return {
          kind: "delta",
          scope: request.scope,
          generation: scope.generation,
          baseRevision,
          revision: scope.revision,
          ackedSequence: request.sequence,
          upserts: after.filter(
            (item) =>
              JSON.stringify(before.get(item.channelId)) !==
              JSON.stringify(item),
          ),
          removed: [...before.keys()].filter((id) => !afterIds.has(id)),
        } satisfies ObservedUnreadResponse;
      }
      case "unread_catch_up": {
        const request = payload as {
          request: {
            channels: Array<{ id: string }>;
            selfPubkey: string;
          };
        };
        const results: UnreadCatchUpChannelResult[] =
          request.request.channels.map((channel) => ({
            status: "success",
            channelId: channel.id,
            observedEvents: [],
            maxTrigger: 0,
            activityRows: [],
            discovered: {
              participated: [],
              authored: getMockMessageStore(channel.id)
                .filter(
                  (event) =>
                    event.pubkey === request.request.selfPubkey &&
                    getThreadReferenceFromTags(event.tags).parentEventId ===
                      null,
                )
                .map((event) => event.id),
              mentioned: [],
            },
          }));
        // Keep this mock aligned with the complete Rust serde shape pinned by
        // `serialized_response_matches_the_typescript_contract`.
        return { channels: results };
      }
      case "set_window_vibrancy":
        return null;
      case "plugin:window|is_fullscreen":
        return false;
      // Settings reads the app version through the app plugin. Without this the
      // bridge throws an unhandled page error on every Settings render, which
      // shows up as noise in unrelated specs.
      case "plugin:app|version":
        return MOCK_APP_VERSION;
      default:
        throw new Error(`Unsupported mocked Tauri command: ${command}`);
    }
  };
  window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__ = (command, payload) =>
    handleMockCommand(command, payload ?? null);
  window.__BUZZ_E2E_EMIT_TAURI_EVENT__ = (event, payload) =>
    emit(event, payload);
  mockIPC(handleMockCommand, { shouldMockEvents: true });
  const tauriInternals = (
    window as typeof window & {
      __TAURI_INTERNALS__: {
        listen?: (
          event: string,
          callback: () => void,
        ) => Promise<() => Promise<void>>;
      };
    }
  ).__TAURI_INTERNALS__;
  // Page-evaluated E2E specs use this surface; delegate to Tauri's mocked channel
  // so their listeners observe the same events emitted by application test seams.
  tauriInternals.listen = async (event, callback) => {
    const unlisten = await listen(event, () => callback());
    return async () => unlisten();
  };

  installed = true;
}
