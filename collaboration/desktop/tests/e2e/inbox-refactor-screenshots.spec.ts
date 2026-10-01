/**
 * Screenshots documenting the focused Inbox behavior for PR #2045.
 *
 * These replace the hand-generated shots posted earlier in that PR, which went
 * stale twice: once when the surface was briefly renamed to "Activity", and
 * again when the Projects filter landed. Keeping them in a spec means the next
 * round regenerates instead of drifting.
 *
 * Run: pnpm build:e2e && pnpm exec playwright test --project=smoke \
 *        tests/e2e/inbox-refactor-screenshots.spec.ts
 * Output: test-results/inbox-refactor/
 */
import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const SHOTS = "test-results/inbox-refactor";

test.describe("inbox refactor screenshots", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.error("CONSOLE ERROR:", msg.text().slice(0, 300));
      }
    });
  });

  test("02 — Inbox label, inbox icon, and overflow controls", async ({
    page,
  }) => {
    await installMockBridge(page, { mode: "mock" });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("home-inbox")).toBeVisible({
      timeout: 10_000,
    });

    // The sidebar must be in frame — the label is the point of this shot.
    const inboxButton = page
      .getByTestId("sidebar-primary-menu")
      .getByRole("button", { name: "Inbox", exact: true });
    await expect(inboxButton).toBeVisible();
    // Inbox is a destination, not a notification tray, so it carries the inbox
    // glyph rather than a bell. Asserted because nothing else pins the icon.
    await expect(inboxButton.locator("svg.lucide-inbox")).toHaveCount(1);

    await page.getByTestId("inbox-options-trigger").click();
    await expect(page.getByText("Show unread only")).toBeVisible();
    await expect(page.getByText("Mark all as read")).toBeVisible();
    await waitForAnimations(page);

    await page.screenshot({ path: `${SHOTS}/02-current-controls.png` });
  });
});
