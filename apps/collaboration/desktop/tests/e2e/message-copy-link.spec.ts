import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";

const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

async function latestClipboardWrite(page: Page) {
  return page.evaluate(() =>
    (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).findLast(
      ({ command }) => command === "copy_text_to_clipboard",
    ),
  );
}

test.beforeEach(async ({ baseURL, page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: baseURL,
  });
  await installMockBridge(page);
});

test("message action rail copies the same canonical thread link as More", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await expect
    .poll(() =>
      page.evaluate(
        () => typeof window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__ === "function",
      ),
    )
    .toBe(true);

  const { replyId, rootId } = await page.evaluate(() => {
    const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
    if (!emit) throw new Error("Mock message emitter is unavailable.");
    const root = emit({
      channelName: "general",
      content: "Copy-link regression root",
      id: "a".repeat(64),
    });
    const reply = emit({
      channelName: "general",
      content: "Copy-link regression reply",
      id: "b".repeat(64),
      parentEventId: root.id,
    });
    return { replyId: reply.id, rootId: root.id };
  });

  await page
    .locator(
      `[data-testid="message-thread-summary"][data-thread-head-id="${rootId}"]`,
    )
    .click();
  const threadPanel = page.getByTestId("message-thread-panel");
  const replyRow = threadPanel.locator(`[data-message-id="${replyId}"]`);
  await expect(replyRow).toContainText("Copy-link regression reply");
  await replyRow.hover();

  const actionBar = replyRow.getByTestId(`message-action-bar-${replyId}`);
  const orderedActionNames = await actionBar
    .getByRole("button")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label")),
    );
  // Kailo 一期原生端只发 kind 9：反应（及其分隔线）已随之移除，动作栏只剩
  // 回复、复制链接与更多。
  expect(orderedActionNames).toEqual(["Reply", "Copy link", "More actions"]);

  const copyLink = actionBar.getByTestId(`copy-link-message-${replyId}`);
  await expect(copyLink).toHaveAccessibleName("Copy link");
  await copyLink.hover();
  await expect(page.getByRole("tooltip", { name: "Copy link" })).toBeVisible();

  const expectedLink = `buzz://message?channel=${GENERAL_CHANNEL_ID}&id=${replyId}&thread=${rootId}`;
  await copyLink.click();
  await expect
    .poll(async () => (await latestClipboardWrite(page))?.payload.text)
    .toBe(expectedLink);
  await expect(
    page.locator("[data-sonner-toast]").filter({
      hasText: "Link copied to clipboard",
    }),
  ).toBeVisible();

  await actionBar.getByTestId(`more-actions-${replyId}`).click();
  await page.getByTestId(`copy-message-link-${replyId}`).click();
  await expect
    .poll(async () => {
      const writes = (await page.evaluate(() =>
        (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).filter(
          ({ command }) => command === "copy_text_to_clipboard",
        ),
      )) as Array<{ payload: unknown }>;
      return writes.map(({ payload }) => payload);
    })
    .toEqual([{ text: expectedLink }, { text: expectedLink }]);

  const [barBox, panelBox] = await Promise.all([
    actionBar.boundingBox(),
    threadPanel.boundingBox(),
  ]);
  expect(barBox).not.toBeNull();
  expect(panelBox).not.toBeNull();
  if (!barBox || !panelBox) throw new Error("Message action bounds missing.");
  expect(barBox.x).toBeGreaterThanOrEqual(panelBox.x);
  expect(barBox.x + barBox.width).toBeLessThanOrEqual(
    panelBox.x + panelBox.width,
  );
});
