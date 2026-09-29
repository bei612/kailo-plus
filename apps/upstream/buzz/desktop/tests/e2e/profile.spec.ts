import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { openSettings } from "../helpers/settings";

async function expectHomeView(page: import("@playwright/test").Page) {
  await expect(page.getByTestId("home-inbox-list")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

test("notification settings drive the Inbox badge and desktop alerts", async ({
  page,
}) => {
  async function getAppBadgeCount() {
    return page.evaluate(() => {
      const win = window as Window & {
        __BUZZ_E2E_APP_BADGE_COUNT__?: number;
      };

      return win.__BUZZ_E2E_APP_BADGE_COUNT__ ?? 0;
    });
  }

  await page.goto("/");
  await expect(page.getByTestId("sidebar-home-count")).toHaveCount(0);

  await openSettings(page, "notifications");
  await expect(page.getByTestId("settings-notifications")).toBeVisible();
  await expect(page.getByTestId("notifications-desktop-state")).toContainText(
    "On",
  );

  await page.getByTestId("settings-back-to-app").click();
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  // The dock badge sums unreadChannelIds.size + homeBadgeCount. Seeded test
  // channels may start with unreads, so capture the baseline after navigating
  // to general (which marks it read) but before injecting the mock mention.
  const baseline = await getAppBadgeCount();

  await page.evaluate(() => {
    const win = window as Window & {
      __BUZZ_E2E_PUSH_MOCK_FEED_ITEM__?: (item: {
        category: "mention";
        channel_id: string | null;
        channel_name: string;
        content: string;
        created_at: number;
        id: string;
        kind: number;
        pubkey: string;
        tags: string[][];
      }) => unknown;
    };

    win.__BUZZ_E2E_PUSH_MOCK_FEED_ITEM__?.({
      category: "mention",
      channel_id: "1c7e1c02-87bb-5e88-b2da-5a7a9432d0c9",
      channel_name: "engineering",
      content: "Please review the rollout checklist.",
      created_at: Math.floor(Date.now() / 1000) + 5,
      id: `mock-feed-notification-${Date.now()}`,
      kind: 9,
      pubkey:
        "bb22a5299220cad76ffd46190ccbeede8ab5dc260faa28b6e5a2cb31b9aff260",
      tags: [
        ["e", "1c7e1c02-87bb-5e88-b2da-5a7a9432d0c9"],
        [
          "p",
          "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        ],
      ],
    });
  });

  await expect(page.getByTestId("sidebar-home-count")).toHaveText("1");
  await expect.poll(getAppBadgeCount).toBe(baseline + 1);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const win = window as Window & {
          __BUZZ_E2E_NOTIFICATIONS__?: Array<{
            body: string | null;
            title: string;
          }>;
        };

        return win.__BUZZ_E2E_NOTIFICATIONS__?.length ?? 0;
      }),
    )
    .toBe(1);

  const notifications = await page.evaluate(() => {
    const win = window as Window & {
      __BUZZ_E2E_NOTIFICATIONS__?: Array<{
        body: string | null;
        title: string;
      }>;
    };

    return win.__BUZZ_E2E_NOTIFICATIONS__ ?? [];
  });

  expect(notifications).toEqual([
    {
      body: "Please review the rollout checklist.",
      title: "bob mentioned you in #engineering",
    },
  ]);

  const clickedNotification = await page.evaluate(() => {
    const win = window as Window & {
      __BUZZ_E2E_CLICK_NOTIFICATION__?: (index: number) => boolean;
    };

    return win.__BUZZ_E2E_CLICK_NOTIFICATION__?.(0) ?? false;
  });
  expect(clickedNotification).toBe(true);

  await expect(page.getByTestId("chat-title")).toHaveText("engineering");
  await expect(page.getByTestId("message-timeline")).toContainText(
    "Please review the rollout checklist.",
  );

  await openSettings(page, "notifications");
  await page.getByTestId("notifications-home-badge-toggle").click();
  await page.getByTestId("settings-back-to-app").click();
  await expect(page.getByTestId("chat-title")).toHaveText("engineering");
  await expect(page.getByTestId("sidebar-home-count")).toHaveCount(0);
  await expect.poll(getAppBadgeCount).toBe(baseline);

  await openSettings(page, "notifications");
  await page.getByTestId("notifications-home-badge-toggle").click();
  await page.getByTestId("settings-back-to-app").click();
  await expect(page.getByTestId("sidebar-home-count")).toHaveText("1");
  await expect.poll(getAppBadgeCount).toBe(baseline + 1);

  await page
    .getByTestId("app-sidebar")
    .getByRole("button", { name: "Inbox" })
    .click();
  await expectHomeView(page);
  await expect(page.getByTestId("sidebar-home-count")).toHaveCount(0);
  await expect.poll(getAppBadgeCount).toBe(baseline);
});

test("supports webview zoom keyboard shortcuts", async ({ page }) => {
  await page.goto("/");
  await expectHomeView(page);

  const getTextScaleState = () =>
    page.evaluate(() => ({
      rootFontSize: getComputedStyle(document.documentElement).fontSize,
      storedScale: localStorage.getItem("buzz:text-scale"),
      webviewZoom: (window as Window & { __BUZZ_E2E_WEBVIEW_ZOOM__?: number })
        .__BUZZ_E2E_WEBVIEW_ZOOM__,
    }));
  const dispatchPrimaryShortcut = (
    key: string,
    code: string,
    shiftKey = false,
  ) =>
    page.evaluate(
      ({ code, key, shiftKey }) => {
        const isMac = /mac|iphone|ipad|ipod/i.test(navigator.platform);
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            code,
            ctrlKey: !isMac,
            key,
            metaKey: isMac,
            shiftKey,
          }),
        );
      },
      { code, key, shiftKey },
    );

  await dispatchPrimaryShortcut("+", "Equal", true);

  await expect.poll(getTextScaleState).toEqual({
    rootFontSize: "17.6px",
    storedScale: "1.1",
    webviewZoom: 1,
  });

  await dispatchPrimaryShortcut("-", "Minus");

  await expect.poll(getTextScaleState).toEqual({
    rootFontSize: "16px",
    storedScale: null,
    webviewZoom: 1,
  });

  await dispatchPrimaryShortcut("+", "Equal", true);
  await dispatchPrimaryShortcut("+", "Equal", true);

  await expect.poll(getTextScaleState).toEqual({
    rootFontSize: "19.2px",
    storedScale: "1.2",
    webviewZoom: 1,
  });

  await dispatchPrimaryShortcut("0", "Digit0");

  await expect.poll(getTextScaleState).toEqual({
    rootFontSize: "16px",
    storedScale: null,
    webviewZoom: 1,
  });
});

test("settings subtitles share the Appearance secondary color", async ({
  page,
}) => {
  await page.goto("/");
  await openSettings(page, "appearance");

  const appearancePanel = page.getByTestId("settings-panel-appearance");
  const secondaryColor = await appearancePanel
    .locator("[data-settings-subcopy]")
    .first()
    .evaluate((element) => getComputedStyle(element).color);

  for (const section of [
    "profile",
    "appearance",
    "notifications",
    "voice",
    "shortcuts",
    "custom-emoji",
    "local-archive",
    "channel-templates",
    "hosted-communities",
    "agents",
    "compute",
    "experimental",
    "mobile",
    "updates",
  ]) {
    await page.getByTestId(`settings-nav-${section}`).click();
    const subtitles = page
      .getByTestId(`settings-panel-${section}`)
      .locator("[data-settings-subcopy]");
    await expect(subtitles.first()).toBeVisible();
    const colors = await subtitles.evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).color),
    );
    expect(new Set(colors), `${section} subtitle colors`).toEqual(
      new Set([secondaryColor]),
    );
  }
});
