import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const SIDEBAR_WIDTH_STORAGE_KEY = "buzz-sidebar-width";
const DEFAULT_SIDEBAR_WIDTH = 300;

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

async function sidebarWidth(page: Page) {
  return page.getByTestId("app-sidebar").evaluate((element) => {
    return Math.round(element.getBoundingClientRect().width);
  });
}

async function storedSidebarWidth(page: Page) {
  return page.evaluate(
    (key) => localStorage.getItem(key),
    SIDEBAR_WIDTH_STORAGE_KEY,
  );
}

async function loadTheme(page: Page, theme: string) {
  await page.addInitScript((selectedTheme) => {
    window.localStorage.setItem("buzz-theme", selectedTheme);
  }, theme);
  await installMockBridge(page);
  await page.goto("/");
}

// Regression guard for the "Leave channel" lockup: with two bundled copies of
// @radix-ui/react-dismissable-layer, opening a modal AlertDialog from a modal
// Radix ContextMenu left `pointer-events: none` stuck on <body> after the
// dialog closed, freezing the whole app. Fixed by the pnpm override in
// pnpm-workspace.yaml deduplicating the layer. This asserts the app is still
// interactive.
async function expectAppClickable(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => getComputedStyle(document.body).pointerEvents),
    )
    .not.toBe("none");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
}

async function dragSidebarRail(page: Page, deltaX: number) {
  const sidebarRail = page.locator('[data-sidebar="rail"]');
  await expect(sidebarRail).toBeVisible();
  await expect(sidebarRail).toBeEnabled();

  const box = await sidebarRail.boundingBox();
  expect(box).not.toBeNull();

  if (!box) return;

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY, { steps: 8 });
  await page.mouse.up();
}

test("leaving a channel from the context menu never freezes the app", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();

  // Cancel path: dialog opens from the context menu, then is dismissed.
  await page.getByTestId("channel-random").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Leave channel" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expectAppClickable(page);

  // Confirm path: same overlay lifecycle, plus the leave mutation.
  await page.getByTestId("channel-random").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Leave channel" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Leave" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expectAppClickable(page);
});

test("channel context menu only shows owner actions to the owner", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByTestId("channel-general").click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Archive channel" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Delete channel" }),
  ).toBeVisible();
  const lifecycleOrder = (
    await page.getByRole("menuitem").allTextContents()
  ).filter((label) =>
    ["Leave channel", "Archive channel", "Delete channel"].includes(label),
  );
  expect(lifecycleOrder).toEqual([
    "Leave channel",
    "Archive channel",
    "Delete channel",
  ]);
  await page.keyboard.press("Escape");

  await page.getByTestId("channel-random").click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Leave channel" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Loading channel actions..." }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Archive channel" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Delete channel" }),
  ).toHaveCount(0);
});

test("channel context menu explains when owner actions are loading", async ({
  page,
}) => {
  await installMockBridge(page, { channelMembersReadDelayMs: 500 });
  await page.goto("/");

  await page.getByTestId("channel-general").click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Loading channel actions..." }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Archive channel" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Loading channel actions..." }),
  ).toHaveCount(0);
});

test("channel owner can archive from the context menu", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("channel-general").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Archive channel" }).click();

  await expect(page.getByTestId("stream-list")).not.toContainText("general");
});

test("channel owner can delete from the context menu", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();

  await page.getByTestId("channel-general").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete channel" }).click();
  await expect(
    page.getByTestId("channel-delete-confirmation-dialog"),
  ).toBeVisible();
  await page.getByTestId("channel-delete-confirm").click();

  await expect(page.getByTestId("home-inbox-list")).toBeVisible();
  await expect(page.getByTestId("stream-list")).not.toContainText("general");
});

for (const theme of ["buzz", "github-light", "catppuccin-mocha"]) {
  test(`uses the continuous sidebar surface in ${theme}`, async ({ page }) => {
    await loadTheme(page, theme);

    const pinnedHeader = page.getByTestId("sidebar-pinned-header");
    const footer = page.locator(
      '[data-testid="app-sidebar"] [data-sidebar="footer"]',
    );
    const channelContent = page.getByTestId("sidebar-channel-content");
    await expect(pinnedHeader).toBeVisible();
    await expect(footer).toBeVisible();
    await expect(channelContent).toBeVisible();

    const chromeStyles = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>(
        '[data-testid="app-sidebar"] [data-testid="sidebar-pinned-header"]',
      );
      const footerElement = document.querySelector<HTMLElement>(
        '[data-testid="app-sidebar"] [data-sidebar="footer"]',
      );
      const channelElement = document.querySelector<HTMLElement>(
        '[data-testid="sidebar-channel-content"]',
      );

      if (!header || !footerElement || !channelElement) {
        throw new Error("Expected sidebar chrome elements to be rendered");
      }

      const headerBefore = getComputedStyle(header, "::before");
      const headerStyle = getComputedStyle(header);
      const footerStyle = getComputedStyle(footerElement);
      const footerBefore = getComputedStyle(footerElement, "::before");
      const channelBefore = getComputedStyle(channelElement, "::before");
      const channelAfter = getComputedStyle(channelElement, "::after");

      return {
        channelAfterBackground: channelAfter.backgroundImage,
        channelBeforeBackground: channelBefore.backgroundImage,
        footerBackground: footerStyle.backgroundImage,
        footerBackgroundColor: footerStyle.backgroundColor,
        footerBeforeBackground: footerBefore.backgroundImage,
        footerBeforeContent: footerBefore.content,
        footerBoxShadow: footerStyle.boxShadow,
        footerIsolation: footerStyle.isolation,
        footerMarginTop: Number.parseFloat(footerStyle.marginTop),
        footerZIndex: footerStyle.zIndex,
        headerBackground: headerStyle.backgroundImage,
        headerBackgroundColor: headerStyle.backgroundColor,
        headerBeforeBackground: headerBefore.backgroundImage,
        headerBeforeContent: headerBefore.content,
        headerBoxShadow: headerStyle.boxShadow,
        headerIsolation: headerStyle.isolation,
        headerMarginBottom: Number.parseFloat(headerStyle.marginBottom),
        headerZIndex: headerStyle.zIndex,
      };
    });

    expect(chromeStyles.headerBackground).toBe("none");
    expect(chromeStyles.headerBackgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(chromeStyles.headerBeforeBackground).toBe("none");
    expect(chromeStyles.headerBeforeContent).toBe("none");
    expect(chromeStyles.headerBoxShadow).toBe("none");
    expect(chromeStyles.headerIsolation).toBe("auto");
    expect(chromeStyles.headerMarginBottom).toBe(0);
    expect(chromeStyles.headerZIndex).toBe("auto");
    expect(chromeStyles.footerBackground).toBe("none");
    expect(chromeStyles.footerBackgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(chromeStyles.footerBeforeBackground).toBe("none");
    expect(chromeStyles.footerBeforeContent).toBe("none");
    expect(chromeStyles.footerBoxShadow).toBe("none");
    expect(chromeStyles.footerIsolation).toBe("auto");
    expect(chromeStyles.footerMarginTop).toBe(0);
    expect(chromeStyles.footerZIndex).toBe("auto");
    expect(chromeStyles.channelBeforeBackground).toBe("none");
    expect(chromeStyles.channelAfterBackground).toBe("none");
  });
}

test("aligns the sidebar search with the channel title outside the Buzz theme", async ({
  page,
}) => {
  await loadTheme(page, "github-light");
  await page.getByTestId("channel-general").click();

  const root = page.locator("html");
  const search = page.getByTestId("open-search");
  const channelTitle = page.getByTestId("chat-title");
  await expect(root).not.toHaveAttribute("data-buzz-sidebar", "");
  await expect(search).toBeVisible();
  await expect(channelTitle).toHaveText("general");

  const [searchBox, channelTitleBox] = await Promise.all([
    search.boundingBox(),
    channelTitle.boundingBox(),
  ]);
  expect(searchBox).not.toBeNull();
  expect(channelTitleBox).not.toBeNull();

  if (!searchBox || !channelTitleBox) return;

  const searchCenter = searchBox.y + searchBox.height / 2;
  const channelTitleCenter = channelTitleBox.y + channelTitleBox.height / 2;
  expect(Math.abs(searchCenter - channelTitleCenter)).toBeLessThanOrEqual(2);
});

test("keeps only search pinned while primary navigation scrolls", async ({
  page,
}) => {
  await loadTheme(page, "github-light");

  const search = page.getByTestId("open-search");
  const primaryMenu = page.getByTestId("sidebar-primary-menu");
  const sidebarScroller = page.locator(".buzz-sidebar-scrollbar");
  const [initialSearchBox, initialMenuBox] = await Promise.all([
    search.boundingBox(),
    primaryMenu.boundingBox(),
  ]);
  expect(initialSearchBox).not.toBeNull();
  expect(initialMenuBox).not.toBeNull();

  const scrollTop = await sidebarScroller.evaluate((element) => {
    element.scrollTop = Math.min(
      120,
      Math.max(0, element.scrollHeight - element.clientHeight),
    );
    return element.scrollTop;
  });
  expect(scrollTop).toBeGreaterThan(0);
  await expect
    .poll(() =>
      sidebarScroller.evaluate((element) => Math.round(element.scrollTop)),
    )
    .toBe(Math.round(scrollTop));

  const [scrolledSearchBox, scrolledMenuBox] = await Promise.all([
    search.boundingBox(),
    primaryMenu.boundingBox(),
  ]);
  expect(scrolledSearchBox).not.toBeNull();
  expect(scrolledMenuBox).not.toBeNull();
  expect(
    Math.abs((scrolledSearchBox?.y ?? 0) - (initialSearchBox?.y ?? 0)),
  ).toBeLessThanOrEqual(1);
  expect(scrolledMenuBox?.y ?? 0).toBeLessThan(initialMenuBox?.y ?? 0);
});

test("scales the sidebar backward while its chrome closes", async ({
  page,
}) => {
  await page.goto("/");

  const sidebar = page.getByTestId("app-sidebar");
  const sidebarSurface = sidebar.locator("[data-sidebar-transition-content]");
  await expect(sidebarSurface).toHaveCSS("opacity", "1");
  await expect(sidebarSurface).toHaveCSS("scale", "none");

  await page.getByRole("button", { name: "Toggle Sidebar" }).click();

  await expect(sidebarSurface).toHaveCSS("opacity", "0");
  await expect(sidebar).toHaveCSS("pointer-events", "none");
  await expect(sidebar).toHaveCSS("overflow", "visible");
  await expect(sidebar.locator(':scope > [data-sidebar="sidebar"]')).toHaveCSS(
    "background-color",
    await sidebarSurface.evaluate((element) => {
      const sidebarElement = element.closest('[data-sidebar="sidebar"]');
      if (!(sidebarElement instanceof HTMLElement)) return "";
      return getComputedStyle(sidebarElement).backgroundColor;
    }),
  );
  await expect(sidebarSurface).toHaveCSS("scale", "0.95");
  await expect(sidebarSurface).toHaveCSS("translate", "24px");
  const transformOrigin = await sidebarSurface.evaluate(
    (element) => getComputedStyle(element).transformOrigin,
  );
  const [originX, originY] = transformOrigin.split(" ").map(Number.parseFloat);
  const surfaceWidth = await sidebarSurface.evaluate(
    (element) => element.clientWidth,
  );
  expect(Math.abs(originX - surfaceWidth / 2)).toBeLessThan(0.5);
  expect(originY).toBe(0);
  await expect(sidebarSurface).toHaveCSS(
    "transition-property",
    "opacity, scale, translate",
  );
  await expect(sidebarSurface).toHaveCSS("transition-duration", "0.2s");
  await expect(sidebarSurface).toHaveCSS(
    "transition-timing-function",
    "linear",
  );

  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await expect(sidebarSurface).toHaveCSS("opacity", "1");
  await expect(sidebar).toHaveCSS("pointer-events", "auto");
  await expect(sidebarSurface).toHaveCSS("scale", "none");
});

test("disables the sidebar collapse transition for reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const sidebarSurface = page
    .getByTestId("app-sidebar")
    .locator("[data-sidebar-transition-content]");
  await expect(sidebarSurface).toHaveCSS("transition-duration", "0s");

  await page.getByRole("button", { name: "Toggle Sidebar" }).click();

  await expect(sidebarSurface).toHaveCSS("opacity", "0");
  await expect(sidebarSurface).toHaveCSS("scale", "0.95");
  await expect(sidebarSurface).toHaveCSS("translate", "24px");
  await expect(sidebarSurface).toHaveCSS("transition-duration", "0s");
});

test("sidebar rail resizes without toggling the sidebar", async ({ page }) => {
  await page.goto("/");
  const rail = page.getByRole("button", { name: "Resize sidebar" });
  await rail.click();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();

  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await expect(rail).toBeHidden();
});

test("resizes, persists, and snaps to the default sidebar width", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();

  await expect.poll(() => sidebarWidth(page)).toBe(DEFAULT_SIDEBAR_WIDTH);
  await expect.poll(() => storedSidebarWidth(page)).toBeNull();

  await dragSidebarRail(page, 64);

  await expect.poll(() => sidebarWidth(page)).toBe(364);
  await expect.poll(() => storedSidebarWidth(page)).toBe("364");

  await page.reload();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect.poll(() => sidebarWidth(page)).toBe(364);

  await dragSidebarRail(page, -60);

  await expect.poll(() => sidebarWidth(page)).toBe(DEFAULT_SIDEBAR_WIDTH);
  await expect
    .poll(() => storedSidebarWidth(page))
    .toBe(String(DEFAULT_SIDEBAR_WIDTH));
});
