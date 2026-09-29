import { expect, test, type Locator, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const THEMES = ["buzz", "catppuccin-mocha"] as const;

async function seedTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.addInitScript((value) => {
    window.localStorage.setItem("buzz-theme", value);
  }, theme);
}

async function expectMutedSupportingText(
  trigger: Locator,
  expectedText: string | RegExp,
) {
  await trigger.hover();
  const footer = trigger
    .page()
    .getByRole("tooltip")
    .locator('[data-buzz-tooltip-metadata-type=""]');
  await expect(footer).toHaveText(expectedText);
  await expect(footer).toHaveClass(/text-secondary-foreground\/80/);
  await expect(footer).not.toHaveClass(/text-primary-foreground/);
}

for (const theme of THEMES) {
  test(`link tooltip supporting text uses the muted secondary foreground — ${theme}`, async ({
    page,
  }) => {
    await seedTheme(page, theme);
    await installMockBridge(page);
    await page.goto("/");
    await page.getByTestId("channel-general").click();
    const channelId = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
    const links = [
      `buzz://channel/${channelId}`,
      `buzz://message?channel=${channelId}&id=mock-general-welcome`,
    ].join(" ");
    const composer = page.getByTestId("message-input");
    await composer.evaluate((element, text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData,
        }),
      );
    }, links);

    const composerChips = composer.locator('[data-composer-buzz-link=""]');
    await expect(composerChips).toHaveCount(2);
    await page.getByTestId("send-message").click();

    const row = page.getByTestId("message-row").last();
    await expect(row).toBeVisible();
    await expectMutedSupportingText(
      row.getByRole("button", { name: "Open channel general" }),
      /Public channel · Active (just now|\d+[mhdw] ago)/,
    );
    await page.mouse.move(0, 0);
    await expectMutedSupportingText(
      row.getByRole("button", { name: "Open message in channel general" }),
      /#general · .+ · (just now|\d+[mhdw] ago)/,
    );
  });
}
