import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

async function dispatchWheelPrevented(
  page: import("@playwright/test").Page,
  selector: string,
  deltas: { deltaX?: number; deltaY?: number },
) {
  return page.evaluate(
    ({ selector, deltaX, deltaY }) => {
      const element = document.querySelector(selector);
      if (!element) {
        throw new Error(`Missing element for selector: ${selector}`);
      }

      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaX,
        deltaY,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    },
    { selector, deltaX: deltas.deltaX ?? 0, deltaY: deltas.deltaY ?? 0 },
  );
}

async function expectConversationOverflows(
  page: import("@playwright/test").Page,
) {
  const timeline = page.getByTestId("message-timeline");
  await expect(timeline).toBeVisible();
  await expect
    .poll(() =>
      timeline.evaluate(
        (element) => element.scrollHeight > element.clientHeight + 1,
      ),
    )
    .toBe(true);
}

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

test("locks viewport rubber-band outside conversation scrollers", async ({
  page,
}) => {
  await page.goto("/");
  // A channel whose history overflows the pane, so the conversation scroller
  // really is a scroll container under the pointer.
  await page.getByTestId("channel-deep-history").click();
  await expectConversationOverflows(page);

  await expect(
    dispatchWheelPrevented(page, '[data-testid="app-top-chrome"]', {
      deltaY: -120,
    }),
  ).resolves.toBe(true);
  await expect(
    dispatchWheelPrevented(page, '[data-testid="sidebar-pinned-header"]', {
      deltaY: -120,
    }),
  ).resolves.toBe(true);
  await expect(
    dispatchWheelPrevented(page, '[data-testid="app-sidebar-scroll-anchor"]', {
      deltaY: -120,
    }),
  ).resolves.toBe(true);
  await expect(
    dispatchWheelPrevented(page, '[data-testid="chat-title"]', {
      deltaY: -120,
    }),
  ).resolves.toBe(true);

  await expect(
    dispatchWheelPrevented(page, '[data-testid="message-timeline"]', {
      deltaY: -120,
    }),
  ).resolves.toBe(false);
});

test("locks horizontal viewport pan everywhere", async ({ page }) => {
  await page.goto("/");
  // A channel whose history overflows the pane, so the conversation scroller
  // really is a scroll container under the pointer.
  await page.getByTestId("channel-deep-history").click();
  await expectConversationOverflows(page);

  for (const deltaX of [-120, 120]) {
    await expect(
      dispatchWheelPrevented(page, '[data-testid="app-top-chrome"]', {
        deltaX,
      }),
    ).resolves.toBe(true);
    await expect(
      dispatchWheelPrevented(page, '[data-testid="sidebar-pinned-header"]', {
        deltaX,
      }),
    ).resolves.toBe(true);
    await expect(
      dispatchWheelPrevented(page, '[data-testid="chat-title"]', { deltaX }),
    ).resolves.toBe(true);

    // Unlike vertical, horizontal pans over the conversation pane are locked
    // too — there is no horizontal elastic affordance.
    await expect(
      dispatchWheelPrevented(page, '[data-testid="message-timeline"]', {
        deltaX,
      }),
    ).resolves.toBe(true);
  }

  // A predominantly vertical gesture with slight horizontal drift still
  // reaches the conversation scroller.
  await expect(
    dispatchWheelPrevented(page, '[data-testid="message-timeline"]', {
      deltaX: -10,
      deltaY: -120,
    }),
  ).resolves.toBe(false);
});
