import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { TEST_IDENTITIES, installMockBridge } from "../helpers/bridge";

const DEFAULT_MOCK_PUBKEY = "deadbeef".repeat(8);
const SHOTS = "test-results/channel-row-decoration-pr";

async function waitForMockLiveSubscription(
  page: import("@playwright/test").Page,
  channelName: string,
  kind?: number,
) {
  await expect
    .poll(async () => {
      return page.evaluate(
        ({ currentChannelName, kind: k }) => {
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
              kind: k,
            }) ?? false
          );
        },
        { currentChannelName: channelName, kind },
      );
    })
    .toBe(true);
}

async function getBadgeState(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const w = window as Window & {
      __BUZZ_E2E_APP_BADGE_STATE__?: string;
      __BUZZ_E2E_APP_BADGE_COUNT__?: number;
    };
    return {
      state: w.__BUZZ_E2E_APP_BADGE_STATE__ ?? "none",
      count: w.__BUZZ_E2E_APP_BADGE_COUNT__ ?? 0,
    };
  });
}

async function waitForBadgeState(
  page: import("@playwright/test").Page,
  expected: { state: string; count?: number },
) {
  await expect
    .poll(async () => getBadgeState(page), { timeout: 5_000 })
    .toEqual(
      expect.objectContaining({
        state: expected.state,
        ...(expected.count !== undefined ? { count: expected.count } : {}),
      }),
    );
}

async function getSettledBadgeState(page: import("@playwright/test").Page) {
  // The mock bridge seeds a couple of unread items during app startup. Let
  // those settle before asserting deltas from newly emitted messages.
  await page.waitForTimeout(2000);
  return getBadgeState(page);
}

async function getSidebarHomeBadgeText(page: import("@playwright/test").Page) {
  return page
    .getByTestId("sidebar-home-count")
    .allTextContents()
    .then((texts) => texts[0] ?? null);
}

function withAdditionalBadgeCount(baseline: { count: number }, count: number) {
  return { state: "count", count: baseline.count + count };
}

function withDotOnlyBadge(baseline: { state: string; count: number }) {
  return baseline.count > 0 ? baseline : { state: "dot", count: 0 };
}

async function getUnreadPillComposition(
  pill: import("@playwright/test").Locator,
) {
  return pill.evaluate((element) => {
    const style = getComputedStyle(element);
    const icon = element.querySelector("svg")?.getBoundingClientRect();
    return {
      fontSize: style.fontSize,
      gap: style.gap,
      height: element.getBoundingClientRect().height,
      iconHeight: icon?.height,
      iconWidth: icon?.width,
      letterSpacing: style.letterSpacing,
      paddingBlock: `${style.paddingTop} ${style.paddingBottom}`,
      paddingInline: `${style.paddingLeft} ${style.paddingRight}`,
    };
  });
}

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

test("hovering a channel keeps its text color", async ({ page }) => {
  await page.goto("/");
  const channel = page.getByTestId("channel-engineering");
  const initialColor = await channel.evaluate(
    (element) => getComputedStyle(element).color,
  );

  await channel.hover();
  await expect(channel).toHaveCSS("color", initialColor);
});

test("offscreen unread counts destinations and promotes without incrementing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 360 });
  await page.goto("/");
  await page.getByTestId("channel-agents").click();
  await waitForMockLiveSubscription(page, "agents");
  await page.getByTestId("channel-general").click();

  const sidebarScroller = page
    .getByTestId("app-sidebar")
    .locator('[data-sidebar="content"]');
  await sidebarScroller.evaluate((element) => {
    const target = element.querySelector<HTMLElement>(
      '[data-testid="channel-agents"]',
    );
    if (!target) throw new Error("Could not find #agents in the sidebar");

    // Keep #agents (an ordinary stream channel, the first in the list) just
    // above the viewport so it is the next unread row. The first row is used
    // because it is the only one the short sidebar can scroll fully out.
    element.scrollTop +=
      target.getBoundingClientRect().bottom -
      element.getBoundingClientRect().top +
      1;
  });
  await expect(page.getByTestId("channel-agents")).not.toBeInViewport();

  await page.evaluate(
    ({ pubkey }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "agents",
        content: "A regular channel message",
        kind: 40002,
        pubkey,
      });
    },
    { pubkey: TEST_IDENTITIES.alice.pubkey },
  );

  const activityArrow = page.getByTestId("sidebar-more-unread-above");
  await expect(activityArrow).toBeVisible();
  await expect(activityArrow).toContainText("1 unread");
  await expect(activityArrow).not.toHaveClass(/bg-primary/);
  await expect(activityArrow).toHaveCSS("font-size", "12px");
  await waitForAnimations(page);
  await page.screenshot({
    path: `${SHOTS}/sidebar-unread-overflow-default.png`,
    clip: { x: 0, y: 0, width: 320, height: 360 },
  });

  const defaultComposition = await getUnreadPillComposition(activityArrow);

  await page.evaluate(
    ({ pubkey, mentionPubkey }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "agents",
        content: "A priority mention for @tyler",
        kind: 40002,
        pubkey,
        mentionPubkeys: [mentionPubkey],
      });
    },
    {
      pubkey: TEST_IDENTITIES.alice.pubkey,
      mentionPubkey: DEFAULT_MOCK_PUBKEY,
    },
  );

  // A second message in the same destination promotes the pill but does not
  // increase the number of places awaiting review.
  await expect(activityArrow).toContainText("1 unread");
  await expect(activityArrow).toHaveClass(/bg-primary/);
  await waitForAnimations(page);
  await page.screenshot({
    path: `${SHOTS}/sidebar-unread-overflow-primary.png`,
    clip: { x: 0, y: 0, width: 320, height: 360 },
  });
  const primaryComposition = await getUnreadPillComposition(activityArrow);
  expect(primaryComposition).toEqual(defaultComposition);

  await activityArrow.click();
  await expect(page.getByTestId("channel-agents")).toBeInViewport();
  await waitForAnimations(page);
  await page.screenshot({
    path: `${SHOTS}/sidebar-top-level-unread-arrow.png`,
    clip: { x: 0, y: 0, width: 320, height: 360 },
  });
});

test("regular message bolds inactive channel without numeric badge", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForMockLiveSubscription(page, "random");
  const baselineBadge = await getSettledBadgeState(page);

  await page.evaluate(
    ({ pubkey }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "random",
        content: "Regular message, no mention",
        kind: 40002,
        pubkey,
      });
    },
    { pubkey: TEST_IDENTITIES.alice.pubkey },
  );

  const unreadChannel = page.getByTestId("channel-random");
  await expect(unreadChannel).toHaveCSS("font-weight", "700");
  await expect(unreadChannel.locator("[data-sidebar-row-label]")).toHaveCSS(
    "opacity",
    "1",
  );
  await expect(page.getByTestId("channel-unread-random")).toHaveCount(0);
  await expect(page.getByTestId("channel-unread-dot-random")).toHaveCount(0);
  await waitForBadgeState(page, withDotOnlyBadge(baselineBadge));

  await page.getByTestId("channel-random").click();
  await expect(page.getByTestId("channel-random")).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(page.getByTestId("channel-random")).toHaveCSS(
    "font-weight",
    "400",
  );
});

test("top-level @mention bolds its channel without a trailing numeral", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForMockLiveSubscription(page, "random");
  const baselineBadge = await getSettledBadgeState(page);

  await page.evaluate(
    ({ pubkey, mentionPubkey }) => {
      for (const content of [
        "Hey @tyler check this out",
        "One more for @tyler",
      ]) {
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "random",
          content,
          kind: 40002,
          pubkey,
          mentionPubkeys: [mentionPubkey],
        });
      }
    },
    {
      pubkey: TEST_IDENTITIES.alice.pubkey,
      mentionPubkey: DEFAULT_MOCK_PUBKEY,
    },
  );

  await expect(page.getByTestId("channel-random")).toHaveCSS(
    "font-weight",
    "700",
  );
  await expect(page.getByTestId("channel-unread-random")).toHaveCount(0);
  await expect(page.getByTestId("channel-unread-dot-random")).toHaveCount(0);
  await waitForBadgeState(page, withAdditionalBadgeCount(baselineBadge, 2));
});

test("@mention inside a thread bolds the room and keeps hover-to-preview", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForMockLiveSubscription(page, "random");

  const rootEventId = await page.evaluate(() => {
    const root = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelName: "random",
      content: "Thread root from someone else",
      kind: 40002,
      pubkey: "deadbeef".repeat(8),
    });
    return root?.id;
  });

  await page.evaluate(
    ({ parentEventId, pubkey, mentionPubkey }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "random",
        content: "In-thread ping for @tyler",
        kind: 40002,
        parentEventId,
        pubkey,
        mentionPubkeys: [mentionPubkey],
      });
    },
    {
      parentEventId: rootEventId,
      pubkey: TEST_IDENTITIES.alice.pubkey,
      mentionPubkey: DEFAULT_MOCK_PUBKEY,
    },
  );

  await expect(page.getByTestId("channel-random")).toHaveCSS(
    "font-weight",
    "700",
  );
  await expect(page.getByTestId("channel-unread-random")).toHaveCount(0);
  await expect(page.getByTestId("channel-unread-dot-random")).toBeVisible();

  // Hover-to-preview is owned by the thread dot, not a trailing numeral.
  await page.getByTestId("channel-random").hover();
  const popover = page.getByTestId("channel-activity-popover-random");
  await expect(popover).toBeVisible();
  await expect(
    popover.getByTestId(`channel-activity-item-${rootEventId}`),
  ).toBeVisible();
  await expect(popover).toContainText("In-thread ping for");
});

test("interested thread reply shows the channel preview dot without incrementing Inbox", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForMockLiveSubscription(page, "random");
  const baselineBadge = await getSettledBadgeState(page);
  const baselineHomeBadge = await getSidebarHomeBadgeText(page);

  const rootEventId = await page.evaluate(() => {
    const root = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelName: "random",
      content: "Conversation I started",
      kind: 40002,
      pubkey: "deadbeef".repeat(8),
    });
    return root?.id;
  });

  await page.evaluate(
    ({ parentEventId, pubkey }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "random",
        content: "Thread reply to a followed conversation",
        kind: 40002,
        parentEventId,
        pubkey,
      });
    },
    { parentEventId: rootEventId, pubkey: TEST_IDENTITIES.alice.pubkey },
  );

  await expect(page.getByTestId("channel-unread-random")).toHaveCount(0);
  await expect(page.getByTestId("channel-unread-dot-random")).toBeVisible();
  await expect
    .poll(() => getSidebarHomeBadgeText(page))
    .toBe(baselineHomeBadge);
  await waitForBadgeState(page, baselineBadge);
});

test("broadcast reply bolds its channel without a trailing numeral", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForMockLiveSubscription(page, "random");
  const baselineBadge = await getSettledBadgeState(page);

  await page.evaluate(
    ({ pubkey }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "random",
        content: "Broadcast reply to the channel",
        kind: 40002,
        pubkey,
        extraTags: [
          ["broadcast", "1"],
          ["e", "some-root-event-id"],
        ],
      });
    },
    { pubkey: TEST_IDENTITIES.alice.pubkey },
  );

  await expect(page.getByTestId("channel-random")).toHaveCSS(
    "font-weight",
    "700",
  );
  await expect(page.getByTestId("channel-unread-random")).toHaveCount(0);
  await waitForBadgeState(page, withAdditionalBadgeCount(baselineBadge, 1));
});

test("mark-as-read via context menu clears channel unread indicator", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForMockLiveSubscription(page, "random");

  // Wait for catch-up to settle, then record baseline badge state
  // (other mock channels may have pre-existing unreads from seeded history)
  await page.waitForTimeout(2000);
  const baselineBadge = await getBadgeState(page);

  await page.evaluate(
    ({ pubkey }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "random",
        content: "Message to be marked read",
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

  await page.getByTestId("channel-random").click({ button: "right" });
  await page.getByText("Mark as read").click();

  await expect(page.getByTestId("channel-random")).not.toHaveCSS(
    "font-weight",
    "700",
  );
  await expect(page.getByTestId("channel-unread-random")).toHaveCount(0);
  await waitForBadgeState(page, baselineBadge);
});

test("mark-as-unread via context menu bolds the channel", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  await expect(page.getByTestId("channel-unread-random")).toHaveCount(0);
  const baselineBadge = await getSettledBadgeState(page);

  await page.getByTestId("channel-random").click({ button: "right" });
  await page.getByText("Mark unread").click();

  await expect(page.getByTestId("channel-random")).toHaveCSS(
    "font-weight",
    "700",
  );
  await expect(page.getByTestId("channel-unread-random")).toHaveCount(0);
  await expect(page.getByTestId("channel-unread-dot-random")).toHaveCount(0);
  await waitForBadgeState(page, withAdditionalBadgeCount(baselineBadge, 1));
});

test("marking a message unread bolds its channel after leaving", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("channel-random").click();
  await expect(page.getByTestId("chat-title")).toHaveText("random");
  await waitForMockLiveSubscription(page, "random");

  const message = await page.evaluate(
    ({ pubkey }) =>
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "random",
        content: "Keep this channel message unread",
        kind: 40002,
        pubkey,
      }),
    { pubkey: TEST_IDENTITIES.alice.pubkey },
  );
  if (!message) {
    throw new Error("Mock message emitter is unavailable");
  }

  const messageRow = page
    .getByTestId("message-row")
    .filter({ hasText: "Keep this channel message unread" });
  await expect(messageRow).toBeVisible();
  await messageRow.hover();
  await page.getByTestId(`more-actions-${message.id}`).click();
  const toggle = page.getByTestId(`mark-read-toggle-${message.id}`);
  await expect(toggle).toHaveText("Mark unread");
  await toggle.click();

  await expect(page.getByTestId("channel-random")).toHaveCSS(
    "font-weight",
    "700",
  );
  await waitForAnimations(page);
  await page.screenshot({
    path: `${SHOTS}/sidebar-active-manual-unread.png`,
    clip: { x: 0, y: 0, width: 320, height: 720 },
  });

  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("channel-random")).toHaveCSS(
    "font-weight",
    "700",
  );
  await expect(page.getByTestId("channel-unread-dot-random")).toHaveCount(0);
});
