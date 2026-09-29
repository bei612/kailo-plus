import { expect, test } from "@playwright/test";
import { TEST_IDENTITIES, installMockBridge } from "../helpers/bridge";

const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const CACHED_PROFILE_LABELS_TAG = "@cached-profile-labels";

type MockFeedWindow = Window & {
  __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
    channelName: string;
    content: string;
    createdAt?: number;
    id?: string;
    kind?: number;
    mentionPubkeys?: string[];
    parentEventId?: string;
    pubkey?: string;
  }) => {
    content: string;
    created_at: number;
    id: string;
    kind: number;
    pubkey: string;
    tags: string[][];
  };
  __BUZZ_E2E_SEED_ACTIVE_TURNS__?: (input: {
    agentPubkey: string;
    channelId: string;
    turnId: string;
    kind?: "turn_started" | "turn_completed";
  }) => void;
  __BUZZ_E2E_PUSH_MOCK_FEED_ITEM__?: (item: {
    category: "mention";
    channel_id: string | null;
    channel_name: string;
    channel_type?: string | null;
    content: string;
    created_at: number;
    id: string;
    kind: number;
    pubkey: string;
    tags: string[][];
  }) => unknown;
};

async function waitForMockLiveSubscription(
  page: import("@playwright/test").Page,
  channelName: string,
  kind?: number,
) {
  await expect
    .poll(async () => {
      return page.evaluate(
        ({ currentChannelName, kind }) => {
          return (
            (
              window as Window & {
                __BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?: (input: {
                  channelName: string;
                  kind?: number;
                }) => boolean;
              }
            ).__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
              channelName: currentChannelName,
              kind,
            }) ?? false
          );
        },
        { currentChannelName: channelName, kind },
      );
    })
    .toBe(true);
}

test.beforeEach(async ({ page }, testInfo) => {
  await installMockBridge(
    page,
    testInfo.tags.includes(CACHED_PROFILE_LABELS_TAG)
      ? { usersBatchDelayMs: 10_000 }
      : undefined,
  );
});

test("shows cached profile labels while relay profiles revalidate", {
  tag: CACHED_PROFILE_LABELS_TAG,
}, async ({ page }) => {
  await page.addInitScript(
    ({ alicePubkey }) => {
      window.localStorage.setItem(
        "buzz-user-labels.v1:ws://localhost:3000",
        JSON.stringify({
          version: 1,
          updatedAt: Date.now(),
          profiles: {
            [alicePubkey]: {
              displayName: "Cached Alice",
              name: "alice",
              nip05Handle: null,
            },
          },
        }),
      );
    },
    { alicePubkey: TEST_IDENTITIES.alice.pubkey },
  );

  await page.goto("/");
  await page.getByTestId("channel-general").click();

  const aliceMessage = page
    .getByTestId("message-row")
    .filter({ hasText: "Hey team — checking in." });
  await expect(aliceMessage.getByTestId("message-author")).toHaveText(
    "Cached Alice",
    { timeout: 1_000 },
  );
});

test("switch between streams", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  await page.getByTestId("channel-random").click();
  await expect(page.getByTestId("chat-title")).toHaveText("random");

  await page.getByTestId("channel-engineering").click();
  await expect(page.getByTestId("chat-title")).toHaveText("engineering");
});

test("channel with messages shows content", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await expect(page.getByTestId("message-channel-intro")).toBeVisible();
  await expect(
    page.getByTestId("channel-intro-action-create-channel"),
  ).toHaveCount(0);
  await expect(page.getByTestId("welcome-composer-guide-banner")).toHaveCount(
    0,
  );
  // `.first()`: backdated seeds can straddle midnight UTC and render two
  // dividers (Yesterday + Today); a bare locator fails Playwright strict mode.
  await expect(
    page.getByTestId("message-timeline-day-divider").first(),
  ).toBeVisible();
  await expect(page.getByTestId("message-timeline")).toContainText(
    "Welcome to general",
  );
});

test("channel date divider keeps the date sticky while the separator rule scrolls", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByTestId("channel-engineering").click();
  await expect(page.getByTestId("chat-title")).toHaveText("engineering");
  await waitForMockLiveSubscription(page, "engineering");

  await page.evaluate(() => {
    const firstDay = 1_700_000_000;
    for (let day = 0; day < 2; day += 1) {
      for (let index = 0; index < 14; index += 1) {
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "engineering",
          content: `date handoff day ${day + 1} row ${index + 1}\nsecond line for scroll height`,
          createdAt: firstDay + day * 86_400 + index,
          pubkey:
            "953d3363262e86b770419834c53d2446409db6d918a57f8f339d495d54ab001f",
        });
      }
    }
  });

  await expect(page.getByTestId("message-timeline-day-group")).toHaveCount(2);
  await expect(page.getByTestId("message-timeline-day-divider")).toHaveCount(2);

  const timeline = page.getByTestId("message-timeline");
  await timeline.evaluate((element) => {
    element.scrollTop = element.scrollHeight * 0.2;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  const [headerBox, stickyPillBox] = await Promise.all([
    page.getByTestId("chat-header").boundingBox(),
    page
      .getByTestId("message-timeline-sticky-day-divider-content")
      .locator("p")
      .first()
      .boundingBox(),
  ]);
  if (!headerBox || !stickyPillBox) {
    throw new Error("missing channel header or sticky day divider");
  }
  expect(
    Math.abs(stickyPillBox.y - (headerBox.y + headerBox.height) - 8),
  ).toBeLessThanOrEqual(1);
  await expect(
    page.getByTestId("message-timeline-sticky-day-divider"),
  ).toHaveCSS("opacity", "1");
  await expect(
    page.getByTestId("message-timeline-day-divider").last().locator("p"),
  ).toHaveCSS("visibility", "visible");

  const metrics = await timeline.evaluate((element) => {
    const pinnedDivider = element.parentElement?.querySelector<HTMLElement>(
      '[data-testid="message-timeline-sticky-day-divider"]',
    );
    const pinnedPill = pinnedDivider?.querySelector<HTMLElement>(
      '[data-testid="message-timeline-sticky-day-divider-content"] p',
    );
    if (!pinnedDivider || !pinnedPill) {
      throw new Error("missing sticky day divider");
    }

    return {
      dividerPillBackground: getComputedStyle(pinnedPill).backgroundColor,
      dividerPillShadow: getComputedStyle(pinnedPill).boxShadow,
      dividerZIndex: getComputedStyle(pinnedDivider).zIndex,
    };
  });

  expect(Number.parseInt(metrics.dividerZIndex, 10)).toBeGreaterThan(10);
  await expect(
    page.getByTestId("message-timeline-sticky-day-divider"),
  ).toHaveCSS("overflow", "visible");

  const dividerAlignment = await timeline.evaluate((element) => {
    const group = [
      ...element.querySelectorAll<HTMLElement>(
        '[data-testid="message-timeline-day-group"]',
      ),
    ].find((candidate) => {
      const pill = candidate.querySelector<HTMLElement>("p");
      return pill && getComputedStyle(pill).visibility === "visible";
    });
    const pill = group?.querySelector<HTMLElement>("p");
    if (!group || !pill) throw new Error("missing visible day divider");

    const rule = getComputedStyle(group, "::before");
    const groupBox = group.getBoundingClientRect();
    const pillBox = pill.getBoundingClientRect();
    return {
      chipCenter: pillBox.top + pillBox.height / 2,
      ruleCenter:
        groupBox.top +
        Number.parseFloat(rule.top) +
        Number.parseFloat(rule.height) / 2,
    };
  });
  expect(
    Math.abs(dividerAlignment.chipCenter - dividerAlignment.ruleCenter),
  ).toBeLessThanOrEqual(0.5);
  await expect
    .poll(async () => {
      const headerZIndex = await page
        .getByTestId("chat-header")
        .evaluate(
          (element) =>
            getComputedStyle(element.parentElement ?? element).zIndex,
        );
      return Number.parseInt(headerZIndex, 10);
    })
    .toBeGreaterThan(Number.parseInt(metrics.dividerZIndex, 10));
  await expect
    .poll(async () => {
      const sharedBackdropZIndex = await page
        .getByTestId("channel-shared-header-backdrop")
        .evaluate((element) => getComputedStyle(element).zIndex);
      return Number.parseInt(sharedBackdropZIndex, 10);
    })
    .toBeGreaterThan(Number.parseInt(metrics.dividerZIndex, 10));
  const composerOverlay = page.getByTestId("channel-composer-overlay");
  await expect(composerOverlay).toBeVisible();
  await expect(composerOverlay).toHaveCSS("backdrop-filter", "none");
  await expect(composerOverlay).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(composerOverlay.getByTestId("message-composer")).toHaveCSS(
    "backdrop-filter",
    "none",
  );
  await expect(
    composerOverlay.getByTestId("composer-dock-backdrop").locator("div"),
  ).not.toHaveCSS("backdrop-filter", "none");
  const composerRailMask = composerOverlay.getByTestId(
    "composer-dock-rail-mask",
  );
  await expect(composerRailMask).toHaveCSS("backdrop-filter", "none");
  await expect(composerRailMask).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect
    .poll(async () => {
      const composerOverlayZIndex = await page
        .getByTestId("channel-composer-overlay")
        .evaluate((element) => getComputedStyle(element).zIndex);
      return Number.parseInt(composerOverlayZIndex, 10);
    })
    .toBeGreaterThan(Number.parseInt(metrics.dividerZIndex, 10));
  expect(metrics.dividerPillBackground).not.toBe("rgba(0, 0, 0, 0)");
  expect(metrics.dividerPillBackground).not.toBe("transparent");
  expect(metrics.dividerPillShadow).toBe("none");
});

test("sidebar shows unread indicator for newly active channels", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByTestId("channel-unread-random")).toHaveCount(0);
  await waitForMockLiveSubscription(page, "random");

  // The unread tracker ignores the current user's own messages, so emit as
  // alice — simulating a real "another user posted while I was elsewhere".
  await page.evaluate(
    ({ pubkey }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "random",
        content: "Unread update for #random",
        kind: 40002,
        pubkey,
      });
    },
    { pubkey: TEST_IDENTITIES.alice.pubkey },
  );

  await expect(page.getByTestId("channel-random")).toHaveCSS(
    "font-weight",
    "700",
  );
  await expect(page.getByTestId("channel-unread-random")).toHaveCount(0);

  await page.getByTestId("channel-random").click();
  await expect(page.getByTestId("chat-title")).toHaveText("random");
  await expect(page.getByTestId("message-timeline")).toContainText(
    "Unread update for random",
  );
  await expect(page.getByTestId("channel-unread-random")).toHaveCount(0);
});

async function seedHomeInboxMention(
  page: import("@playwright/test").Page,
  itemId: string,
  tags?: string[][],
  { navigate = true }: { navigate?: boolean } = {},
) {
  if (navigate) {
    await page.goto("/");
  }
  await expect(page.getByTestId("home-inbox-list")).toBeVisible();
  await page.waitForFunction(
    () =>
      typeof (window as MockFeedWindow).__BUZZ_E2E_PUSH_MOCK_FEED_ITEM__ ===
      "function",
  );

  await page.evaluate(
    ({
      channelId,
      createdAt,
      currentPubkey,
      itemId: id,
      senderPubkey,
      tags: seededTags,
    }) => {
      const pushFeedItem = (window as MockFeedWindow)
        .__BUZZ_E2E_PUSH_MOCK_FEED_ITEM__;
      if (!pushFeedItem) {
        throw new Error("Mock feed injection helper is not installed.");
      }

      pushFeedItem({
        id,
        kind: 9,
        pubkey: senderPubkey,
        content: "Please review the home panel routing.",
        created_at: createdAt,
        channel_id: channelId,
        channel_name: "general",
        tags: seededTags ?? [
          ["e", channelId],
          ["p", currentPubkey],
        ],
        category: "mention",
      });
    },
    {
      channelId: GENERAL_CHANNEL_ID,
      createdAt: Math.floor(Date.now() / 1000),
      currentPubkey: TEST_IDENTITIES.tyler.pubkey,
      itemId,
      senderPubkey: TEST_IDENTITIES.alice.pubkey,
      tags,
    },
  );

  await page.getByTestId(`home-inbox-item-${itemId}`).click();
}

test("Inbox detail title and source action navigate to the conversation", async ({
  page,
}) => {
  await seedHomeInboxMention(page, "mock-feed-home-channel-navigate");

  const detail = page.getByTestId("home-inbox-detail");
  await expect(detail.getByRole("heading")).toHaveText("Message in #general");
  await expect(
    detail.getByRole("button", { name: "Open in channel" }),
  ).toBeVisible();
  await detail.getByTestId("home-inbox-context-title").click();

  await expect(page).toHaveURL(
    new RegExp(`#/channels/${GENERAL_CHANNEL_ID}\\?`),
  );
  await expect(page).toHaveURL(/messageId=mock-feed-home-channel-navigate/);
  await expect(page).not.toHaveURL(/threadRootId=/);
  await expect(page.getByTestId("message-timeline")).toBeVisible();
  await expect(page.getByTestId("home-inbox-list")).toHaveCount(0);
});

test("home inbox thread reply mention carries threadRootId to the channel", async ({
  page,
}) => {
  const rootEventId = "mock-feed-home-thread-root";
  await seedHomeInboxMention(page, "mock-feed-home-thread-navigate", [
    ["e", rootEventId, "", "root"],
    ["e", "mock-feed-home-thread-parent", "", "reply"],
    ["p", TEST_IDENTITIES.tyler.pubkey],
  ]);

  const detail = page.getByTestId("home-inbox-detail");
  await expect(detail.getByRole("heading")).toHaveText("Thread in #general");
  await expect(detail.getByTestId("message-unread-divider")).toBeVisible();
  await detail.getByRole("button", { name: "Open full thread" }).click();

  await expect(page).toHaveURL(
    new RegExp(`#/channels/${GENERAL_CHANNEL_ID}\\?`),
  );
  await expect(page).toHaveURL(/messageId=mock-feed-home-thread-navigate/);
  await expect(page).toHaveURL(new RegExp(`threadRootId=${rootEventId}`));
  await expect(page.getByTestId("message-timeline")).toBeVisible();
  await expect(page.getByTestId("home-inbox-list")).toHaveCount(0);
});
