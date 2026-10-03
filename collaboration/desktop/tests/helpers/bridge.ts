import type { Page } from "@playwright/test";

export const TEST_IDENTITIES = {
  tyler: {
    privateKey:
      "3dbaebadb5dfd777ff25149ee230d907a15a9e1294b40b830661e65bb42f6c03",
    pubkey: "e5ebc6cdb579be112e336cc319b5989b4bb6af11786ea90dbe52b5f08d741b34",
    username: "tyler",
  },
  alice: {
    privateKey:
      "3fa69cbac1dcb9b7b6ac83117c74bd23bb1e717fe8fc7cfda67b47bb4323383d",
    pubkey: "953d3363262e86b770419834c53d2446409db6d918a57f8f339d495d54ab001f",
    username: "alice",
  },
  bob: {
    privateKey:
      "7667ae87cbc50ac0b2251b115c9c51aca7e2da65301b28ecf82f4e4c5260a6bb",
    pubkey: "bb22a5299220cad76ffd46190ccbeede8ab5dc260faa28b6e5a2cb31b9aff260",
    username: "bob",
  },
  charlie: {
    privateKey:
      "813fc3bb90587a82b2bfee9b833503e7686c7480681850b3d789c6987e997fc8",
    pubkey: "554cef57437abac34522ac2c9f0490d685b72c80478cf9f7ed6f9570ee8624ea",
    username: "charlie",
  },
  outsider: {
    privateKey:
      "91bd673543195c0c78fc74a881545dcc8cd6ea6d0f9f8efb3225d58c4bc70dad",
    pubkey: "df8e91b86fda13a9a67896df77232f7bdab2ba9c3e165378e1ba3d24c13a328e",
    username: "outsider",
  },
} as const;

type BridgeMode = "mock" | "relay";

type MockSearchProfileSeed = {
  pubkey: string;
  displayName: string | null;
  avatarUrl?: string | null;
  nip05Handle?: string | null;
  about?: string | null;
  ownerPubkey?: string | null;
  isAgent?: boolean;
};

export type MockEngramEntry = {
  slug: string;
  body: string;
  eventId: string;
  createdAt: number;
  outgoingRefs: string[];
};

type MockBridgeOptions = {
  /** Tauri window label exposed to the app. Defaults to the main window. */
  windowLabel?: string;
  /** Relay NIP-11 identity used to sign authoritative repository state. */
  relaySelf?: string | null;
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
  /** Delay (ms) for `apply_workspace`; see e2eBridge mock config. */
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
   * deliver live reply/aux events while an older response is in flight. */
  threadRepliesDelayMs?: number;
  /** Hold every `get_thread_replies` response until
   * `__BUZZ_E2E_RELEASE_THREAD_REPLIES__()` is called — a manual gate the test
   * releases explicitly, so the thread-aux backfill provably cannot land (and
   * heal a stale head) before assertions run. See e2eBridge mock config. */
  deferThreadReplies?: boolean;
  usersBatchDelayMs?: number;
  /** Delay (ms) for older-history fetches; see e2eBridge mock config. */
  channelWindowDelayMs?: number;
  /** Delay (ms) for newest-page fetches; see e2eBridge mock config. */
  channelHeadDelayMs?: number;
  profileReadDelayMs?: number;
  /** Hold `get_profile` responses until `__BUZZ_E2E_RELEASE_PROFILE_READS__()`. */
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
  /** Simulates native cold-cache startup work before the async response. */
  linkPreviewMetadataStartBlockMs?: number;
  /** Delays link-preview snapshot media uploads so specs can drive an in-flight
   *  snapshot upload. See e2eBridge mock.linkPreviewUploadDelayMs. */
  linkPreviewUploadDelayMs?: number;
  /** Substrings of `link-preview-*` upload filenames whose upload should reject,
   *  so specs can drive a per-media snapshot upload failure. See e2eBridge
   *  mock.linkPreviewUploadErrorFilenames. */
  linkPreviewUploadErrorFilenames?: string[];
  searchProfiles?: MockSearchProfileSeed[];
  /** Reject browser opener calls to exercise manual pairing fallback UI. */
  openerError?: string;
  /** Reject successive mock WebSocket connect attempts, then resume. */
  websocketConnectErrors?: string[];
  /** Deliver AUTH synchronously, before the mock connect command resolves. */
  websocketAuthBeforeConnectResolves?: boolean;
  /** Stall the first AUTH signing command forever; later attempts complete. */
  stallFirstAuthSigning?: boolean;
  stallWebsocketSends?: boolean;
  userSearchDelayMs?: number;
  /**
   * Descriptors returned by the mocked `pick_and_upload_media` /
   * `upload_media_bytes` commands. When omitted, the bridge returns a single
   * generic PDF so the file-attachment flow can be exercised by default. An
   * explicit `[]` is honoured (models a picker cancel / no files selected).
   */
  uploadDelayMs?: number;
  /** Delay (ms) applied to `get_relay_self` so E2E tests can prove the
   *  fail-closed race: DMs are withheld while classification is unresolved. */
  relaySelfDelayMs?: number;
  uploadDescriptors?: {
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
  }[];
  /**
   * Event IDs that `get_event` should report as definitively not found.
   * Causes `useDraftRootStatus` to map the draft to `deleted` state so specs
   * can exercise the "Thread deleted" label / disabled-send path.
   */
  deletedEventIds?: string[];
  /** Reject one identity read after the configured number of successful reads. */
  identityReadErrorAfter?: { message: string; successfulReads: number };
  /**
   * When true, `get_identity` returns `lost: true` until
   * `persist_current_identity` is invoked. Drives the device-key-lost screen.
   */
  identityLost?: boolean;
  /** When true, `get_identity` returns `locked: true` (keyring-locked screen). */
  identityLocked?: boolean;
  /**
   * The Rust-side platform layer (platform_* commands). Omitted = a configured,
   * signed-in device whose key is ACTIVE; see PlatformMockOptions in
   * src/testing/e2eBridge.ts.
   */
  platform?: PlatformMockOptions;
  /** Pending channel/message links that arrived before AppShell mounted. */
  pendingNavigationDeepLinks?: Array<{
    id: string;
    kind: "channel" | "message";
    channelId: string;
    messageId?: string | null;
    threadRootId?: string | null;
  }>;
};

type BridgeOptions = {
  mode: BridgeMode;
  mock?: MockBridgeOptions;
  relayHttpUrl?: string;
  relayWsUrl?: string;
  user?: keyof typeof TEST_IDENTITIES;
};

type PlatformReply = { status: number; body: unknown };

export type PlatformMockOptions = {
  /** `null` = not configured yet. */
  config?: {
    nativeApiUrl: string;
    oidcIssuer: string;
    oidcClientId: string;
  } | null;
  signedIn?: boolean;
  setConfigError?: string;
  /** `hold` keeps `platform_sign_in` pending until cancelled. */
  signIn?: "succeed" | "hold" | { error: string };
  /** Successive `platform_register_device` outcomes; the last one repeats. */
  register?: Array<PlatformReply | { error: string }>;
  /** Successive states of this device in the client-keys list. */
  deviceStates?: string[];
  otherDevices?: Array<{ pubkey: string; state: string; createdAt: string }>;
  community?: PlatformReply;
  revoke?: PlatformReply;
  /** What `platform_sign_out` reports about the server side. */
  signOut?: { coreSessionRevoked: boolean; refreshTokenRevoked: boolean };
  workspaces?: Array<{ id: string; name: string; slug: string }>;
  members?: unknown[];
  audit?: unknown[];
  /** Any other BFF route, keyed `"METHOD /api/v1/…"`; the last reply repeats. */
  routes?: Record<string, PlatformReply[]>;
};

// The relay HTTP/WS URLs follow BUZZ_E2E_RELAY_URL (same env var seed.ts reads),
// so a suite pointed at an isolated relay (e.g. the read-model harness on :3030)
// uses it without per-spec wiring. Falls back to the shared dev relay when unset.
const DEFAULT_RELAY_HTTP_URL =
  process.env.BUZZ_E2E_RELAY_URL ?? "http://localhost:3000";
const DEFAULT_RELAY_WS_URL = DEFAULT_RELAY_HTTP_URL.replace(/^http/, "ws");

export async function installBridge(page: Page, options: BridgeOptions) {
  const identity =
    options.mode === "relay"
      ? TEST_IDENTITIES[options.user ?? "tyler"]
      : undefined;

  await page.addInitScript(
    ({ identity: bridgeIdentity, mock, mode, relayHttpUrl, relayWsUrl }) => {
      const notificationLog: Array<{
        body: string | null;
        title: string;
      }> = [];
      const notificationInstances: MockNotification[] = [];

      class MockNotification extends EventTarget {
        static permission: NotificationPermission = "granted";

        static async requestPermission(): Promise<NotificationPermission> {
          return MockNotification.permission;
        }

        body: string | null;
        onclick: ((event: Event) => void) | null = null;
        title: string;

        constructor(title: string, options?: NotificationOptions) {
          super();
          this.title = title;
          this.body = options?.body ?? null;
          notificationInstances.push(this);
          notificationLog.push({
            body: this.body,
            title: this.title,
          });
        }

        close() {}
      }

      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: MockNotification,
        writable: true,
      });

      const testWindow = window as Window & {
        __BUZZ_E2E__?: Record<string, unknown>;
        __BUZZ_E2E_APP_BADGE_COUNT__?: number;
        __BUZZ_E2E_APP_BADGE_STATE__?: string;
        __BUZZ_E2E_CLICK_NOTIFICATION__?: (index: number) => boolean;
        __BUZZ_E2E_NOTIFICATIONS__?: Array<{
          body: string | null;
          title: string;
        }>;
      };
      const currentConfig = testWindow.__BUZZ_E2E__ ?? {};

      testWindow.__BUZZ_E2E__ = {
        ...currentConfig,
        identity: bridgeIdentity ?? currentConfig.identity,
        mock,
        mode,
        relayHttpUrl: relayHttpUrl ?? currentConfig.relayHttpUrl,
        relayWsUrl: relayWsUrl ?? currentConfig.relayWsUrl,
      };
      testWindow.__BUZZ_E2E_APP_BADGE_COUNT__ = 0;
      testWindow.__BUZZ_E2E_APP_BADGE_STATE__ = "none";
      testWindow.__BUZZ_E2E_CLICK_NOTIFICATION__ = (index: number) => {
        const notification = notificationInstances[index];
        if (!notification) {
          return false;
        }

        const event = new Event("click");
        notification.dispatchEvent(event);
        notification.onclick?.(event);
        return true;
      };
      testWindow.__BUZZ_E2E_NOTIFICATIONS__ = notificationLog;
    },
    {
      identity,
      mock: options.mock,
      mode: options.mode,
      relayHttpUrl: options.relayHttpUrl,
      relayWsUrl: options.relayWsUrl,
    },
  );
}

export async function installMockBridge(
  page: Page,
  mock?: MockBridgeOptions,
  options?: {
    relayWsUrl?: string;
  },
) {
  await installBridge(page, {
    mode: "mock",
    mock,
    relayWsUrl: options?.relayWsUrl,
  });
}

export async function installRelayBridge(
  page: Page,
  user: keyof typeof TEST_IDENTITIES = "tyler",
) {
  await installBridge(page, {
    mode: "relay",
    user,
    // Thread BUZZ_E2E_RELAY_URL into BOTH transports. The app defaults these to
    // :3000 in relay mode; without explicit wiring HTTP queries (channel list,
    // feed) miss an isolated relay and surface as "Failed to fetch".
    relayHttpUrl: DEFAULT_RELAY_HTTP_URL,
    relayWsUrl: DEFAULT_RELAY_WS_URL,
  });
}

// The sidebar no longer renders a "browse channels" icon button; the channel
// browser is opened via the primary-modifier + Shift + O keyboard shortcut.
export async function openChannelBrowser(page: Page) {
  await page.getByTestId("app-sidebar").waitFor({ state: "visible" });
  const isMacBrowser = await page.evaluate(() =>
    /mac|iphone|ipad|ipod/i.test(navigator.platform),
  );
  await page.evaluate((isMac) => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: !isMac,
        key: "O",
        metaKey: isMac,
        shiftKey: true,
      }),
    );
  }, isMacBrowser);
}

// The Channels section "+" now opens the unified Add-channel browser, so the
// standalone create dialog is reached via the primary-modifier + Shift + N
// keyboard shortcut (the "New channel" menu item was removed as redundant).
export async function openCreateChannelDialog(page: Page) {
  await page.getByTestId("app-sidebar").waitFor({ state: "visible" });
  const isMacBrowser = await page.evaluate(() =>
    /mac|iphone|ipad|ipod/i.test(navigator.platform),
  );
  await page.evaluate((isMac) => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: !isMac,
        key: "N",
        metaKey: isMac,
        shiftKey: true,
      }),
    );
  }, isMacBrowser);
  await page.getByTestId("create-channel-dialog").waitFor();
}
