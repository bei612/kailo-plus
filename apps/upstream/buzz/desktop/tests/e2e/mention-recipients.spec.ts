import { expect, test, type Page } from "@playwright/test";
import { truncateNpub } from "../../src/shared/lib/pubkey";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const FIRST = TEST_IDENTITIES.alice.pubkey;
const SECOND = TEST_IDENTITIES.bob.pubkey;

async function install(page: Page) {
  await installMockBridge(page, {
    searchProfiles: [FIRST, SECOND].map((pubkey) => ({
      pubkey,
      displayName: "Scout",
    })),
  });
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
}

async function recipients(page: Page, content: string) {
  return page.evaluate((content) => {
    const signed = (window.__BUZZ_E2E_SIGNED_EVENTS__ ?? [])
      .filter((event) => event.content === content)
      .map((event) =>
        event.tags.filter((tag) => tag[0] === "p").map((tag) => tag[1]),
      );
    if (signed.length > 0) return signed;
    // Thread sends use native IPC in the mock bridge, not signed capture.
    return (window.__BUZZ_E2E_COMMAND_LOG__ ?? [])
      .filter((call) => call.command === "send_channel_message")
      .map(
        (call) =>
          call.payload as { content?: string; mentionPubkeys?: string[] },
      )
      .filter((payload) => payload.content === content)
      .map((payload) => payload.mentionPubkeys ?? []);
  }, content);
}

test("two selected same-name members send both exact identities", async ({
  page,
}) => {
  await install(page);
  const input = page.getByTestId("message-input");
  await input.fill("@Scout");
  await page.getByTestId(`mention-suggestion-${FIRST}`).click();
  await page.keyboard.type("and @Scout");
  await page.getByTestId(`mention-suggestion-${SECOND}`).click();
  await page.keyboard.type("hello");
  const content = `@Scout and @Scout (${SECOND}) hello`;
  await expect(input).toHaveText(content);
  await page.getByTestId("send-message").click();
  await expect.poll(() => recipients(page, content)).toEqual([[FIRST, SECOND]]);
});

for (const mismatchedKey of [false, true]) {
  test(`qualified chip copy/paste ${mismatchedKey ? "rejects a mismatched key" : "preserves its exact recipient"}`, async ({
    page,
  }) => {
    await install(page);
    const input = page.getByTestId("message-input");
    await input.fill("@Scout");
    await page.getByTestId(`mention-suggestion-${FIRST}`).click();
    await page.keyboard.type("and @Scout");
    await page.getByTestId(`mention-suggestion-${SECOND}`).click();
    await page.keyboard.type("qualified clipboard roundtrip");
    await page.getByTestId("send-message").click();
    const chip = page
      .getByTestId("message-row")
      .filter({ hasText: "qualified clipboard roundtrip" })
      .locator(`[data-mention-pubkey="${SECOND}"]`);
    await expect(chip).toHaveText(`Scout (${truncateNpub(SECOND)})`);
    const flavors = await chip.evaluate((element) => {
      const range = document.createRange();
      range.selectNode(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const clipboardData = new DataTransfer();
      const event = new ClipboardEvent("copy", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      });
      element.dispatchEvent(event);
      return {
        handled: event.defaultPrevented,
        text: clipboardData.getData("text/plain"),
        html: clipboardData.getData("text/html"),
      };
    });
    expect(flavors.handled).toBe(true);
    expect(flavors.text.trim()).toBe(`@Scout (${SECOND})`);
    expect(flavors.html).toContain(`data-mention-pubkey="${SECOND}"`);
    if (mismatchedKey) {
      // Both keys have the trusted alias Scout; the qualifier must ALSO agree.
      flavors.html = flavors.html.replace(
        `data-mention-pubkey="${SECOND}"`,
        `data-mention-pubkey="${FIRST}"`,
      );
    }
    // Remount to discard source-composer selections. A channel (not a DM)
    // also avoids an automatic conversation p tag masking a lost mention.
    await page.reload();
    await page.getByTestId("channel-general").click();
    await expect(page.getByTestId("chat-title")).toHaveText("general");
    await input.focus();
    await input.evaluate((element, { text, html }) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      clipboardData.setData("text/html", html);
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData,
        }),
      );
    }, flavors);
    await expect(input).toHaveText(flavors.text);
    await page.getByTestId("send-message").click();
    await expect
      .poll(() => recipients(page, flavors.text.trim()))
      .toEqual([mismatchedKey ? [] : [SECOND]]);
  });
}

for (const partial of [false, true]) {
  test(`matching abbreviated keys ${partial ? "do not bind a partial copy" : "retain separate exact recipients through copy and paste"}`, async ({
    page,
  }) => {
    const keys = ["a", "b"].map((middle) => `150b20bd${middle.repeat(52)}15dc`);
    await installMockBridge(page, {
      searchProfiles: keys.map((pubkey) => ({ pubkey, displayName: "Scout" })),
    });
    await page.goto("/");
    await page.getByTestId("channel-general").click();
    await page.waitForFunction(() =>
      window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
        channelName: "general",
      }),
    );
    await page.evaluate((keys) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: `@Scout (${keys[0]}) and @Scout (${keys[1]}) compact collision`,
        mentionPubkeys: keys,
      });
    }, keys);
    const row = page
      .getByTestId("message-row")
      .filter({ hasText: "compact collision" });
    for (const key of keys) {
      const chip = row.locator(`[data-mention-pubkey="${key}"]`);
      await expect(chip).toHaveText(`Scout (${truncateNpub(key)})`);
      await expect(chip).toHaveAttribute("title", `Scout (${key})`);
      const flavors = await chip.evaluate((element, partial) => {
        const range = document.createRange();
        range.selectNode(element);
        if (partial) {
          const leadingText = document
            .createTreeWalker(element, NodeFilter.SHOW_TEXT)
            .nextNode();
          if (!leadingText) throw new Error("Missing mention text");
          range.setStart(leadingText, 0);
          range.setEnd(leadingText, 5);
        }
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        const clipboardData = new DataTransfer();
        const event = new ClipboardEvent("copy", {
          bubbles: true,
          cancelable: true,
          clipboardData,
        });
        element.dispatchEvent(event);
        // Model the browser's default HTML serialization if our handler declines.
        const fallback = document.createElement("div");
        fallback.append(range.cloneContents());
        return {
          handled: event.defaultPrevented,
          text: event.defaultPrevented
            ? clipboardData.getData("text/plain")
            : (selection?.toString() ?? ""),
          html: event.defaultPrevented
            ? clipboardData.getData("text/html")
            : fallback.innerHTML,
        };
      }, partial);
      expect(flavors.handled).toBe(!partial);
      expect(flavors.text.trim()).toBe(partial ? "Scout" : `@Scout (${key})`);
      const input = page.getByTestId("message-input");
      await input.focus();
      await input.evaluate((element, flavors) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData("text/plain", flavors.text);
        clipboardData.setData("text/html", flavors.html);
        element.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData,
          }),
        );
      }, flavors);
      const marker = ` copied-${keys.indexOf(key)}`;
      await page.keyboard.type(marker);
      const content = `${flavors.text}${marker}`;
      await expect(input).toHaveText(content);
      await page.getByTestId("send-message").click();
      // Chromium can preserve the typed separator as NBSP after a rich paste.
      // Assert the full literal body and exact tags, tolerating only that space.
      await expect
        .poll(() =>
          page.evaluate(
            (marker) =>
              (window.__BUZZ_E2E_SIGNED_EVENTS__ ?? [])
                .filter(
                  (event) =>
                    event.kind === 9 && event.content.endsWith(marker.trim()),
                )
                .map((event) => ({
                  content: event.content.replace(/\u00a0/g, " ").trim(),
                  keys: event.tags
                    .filter((tag) => tag[0] === "p")
                    .map((tag) => tag[1]),
                })),
            marker,
          ),
        )
        .toEqual([{ content: content.trim(), keys: partial ? [] : [key] }]);
    }
  });
}
