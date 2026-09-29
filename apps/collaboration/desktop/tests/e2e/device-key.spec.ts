import { expect, type Page, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// The device key is generated and kept by the Rust side (OS keyring); the
// frontend never imports, exports or backs it up (DD-79). These specs
// cover the only three states that stop the app before the platform bootstrap.

async function commands(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (
      (
        window as Window & {
          __BUZZ_E2E_COMMAND_PAYLOADS__?: Array<{ command: string }>;
        }
      ).__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []
    ).map((entry) => entry.command),
  );
}

test("normal launch uses the persisted device key and goes straight to the community", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");

  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  const invoked = await commands(page);
  expect(invoked).toContain("get_identity");
  expect(invoked).not.toContain("persist_current_identity");
  // No key material ever crosses into the webview.
  for (const command of invoked) {
    expect(command).not.toMatch(/nsec|backup|import_identity/);
  }
});

test("a lost device key offers a new key, then requires a relaunch", async ({
  page,
}) => {
  await installMockBridge(page, { identityLost: true });
  await page.goto("/");

  await expect(page.getByTestId("device-key-lost")).toBeVisible();
  await expect(page.getByTestId("platform-bootstrap")).toHaveCount(0);
  await page.getByTestId("use-new-device-key").click();

  await expect(page.getByTestId("relaunch-required")).toBeVisible();
  expect(await commands(page)).toContain("persist_current_identity");
  // Registration waits for the relaunch: nothing reached the platform yet.
  expect(await commands(page)).not.toContain("platform_register_device");
});

test("a locked keyring only offers a relaunch", async ({ page }) => {
  await installMockBridge(page, { identityLocked: true });
  await page.goto("/");

  await expect(page.getByTestId("keyring-locked")).toBeVisible();
  await expect(page.getByTestId("platform-bootstrap")).toHaveCount(0);
  await expect(page.getByRole("button")).toHaveCount(1);
  await page.getByTestId("relaunch-app").click();

  await expect
    .poll(async () => (await commands(page)).includes("plugin:process|restart"))
    .toBe(true);
});
