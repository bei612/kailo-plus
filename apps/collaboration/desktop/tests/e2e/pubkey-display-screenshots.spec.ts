import { expect, test } from "@playwright/test";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const SHOTS = "test-results/pubkey-display";

// Screenshot evidence for the pubkey-display work: the canonical profile
// surfaces, plus the new-DM recipient identity-hover states retained by it.

test("profile panel Public key row reveals its copy action on hover", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");

  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  const messageRow = page.getByTestId("message-row").first();
  await expect(messageRow).toBeVisible();
  await messageRow.locator("button").first().click();
  await expect(page.getByTestId("user-profile-panel")).toBeVisible();

  const pubkeyRow = page.getByTestId("user-profile-public-key");
  const copyIndicator = page.getByTestId("user-profile-public-key-copy-status");
  await expect(page.getByTestId("user-profile-copy-pubkey")).toBeVisible();
  await expect(copyIndicator).toHaveCSS("opacity", "0");
  await pubkeyRow.hover();
  await expect(copyIndicator).toHaveCSS("opacity", "1");
  await waitForAnimations(page);
  await page.screenshot({
    path: `${SHOTS}/profile-panel-pubkey-hover-copy.png`,
  });
});
