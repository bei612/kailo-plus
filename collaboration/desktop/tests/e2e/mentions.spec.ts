import { expect, test, type Locator } from "@playwright/test";

import { truncateNpub } from "../../src/shared/lib/pubkey";
import { waitForAnimations } from "../helpers/animations";

import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const MOCK_VIEWER_PUBKEY = "deadbeef".repeat(8);

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach("outgoing-diagnostic", {
      body: JSON.stringify(
        await page.evaluate(() => ({
          events: window.__BUZZ_E2E_SIGNED_EVENTS__,
          commands: window.__BUZZ_E2E_COMMAND_LOG__,
        })),
      ),
      contentType: "application/json",
    });
  }
});
const ALLOWLIST_RELAY_AGENT_PUBKEY =
  "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const DELAYED_RELAY_AGENT_PUBKEY =
  "9999999999999999999999999999999999999999999999999999999999999999";
const PROFILE_ONLY_AGENT_PUBKEY =
  "8f83d6b7f3d74f7d933ae3a54dd8c6cc85c7f98e531c16e5a827b953441a8d67";
const ELROND_PUBKEY = "31".repeat(32);
const LEGOLAS_PUBKEY = "32".repeat(32);
const GIMLI_PUBKEY = "33".repeat(32);
const GANDALF_PUBKEY = "34".repeat(32);
const STANDARD_GROUPED_ARRIVAL_ACTOR = {
  pubkey: "10".repeat(32),
  displayName: "Alice Chen",
};
const STANDARD_GROUPED_ARRIVAL_TARGETS = [
  { pubkey: "11".repeat(32), displayName: "Erica Chapman" },
  { pubkey: "12".repeat(32), displayName: "Peter Griffin" },
  { pubkey: "13".repeat(32), displayName: "Marcia Thomas" },
  { pubkey: "14".repeat(32), displayName: "Jordan Lee" },
  { pubkey: "15".repeat(32), displayName: "Olivia Park" },
  { pubkey: "16".repeat(32), displayName: "Sam Rivera" },
];
const JOIN_COLLAPSE_PROFILES = [
  { pubkey: ELROND_PUBKEY, displayName: "Elrond" },
  { pubkey: LEGOLAS_PUBKEY, displayName: "Legolas" },
  { pubkey: GIMLI_PUBKEY, displayName: "Gimli" },
  { pubkey: GANDALF_PUBKEY, displayName: "Gandalf" },
];
const JOIN_COLLAPSE_CHANNEL_NAME = "random";
const SYSTEM_MESSAGE_KIND = 40099;
const JOIN_COLLAPSE_SPLIT_TEXTS = [
  "Elrond added by you",
  "Legolas added by Elrond, along with Gimli",
  "Gandalf added by you",
];
const JOIN_COLLAPSE_GROUPED_TEXT =
  "Elrond was added along with Legolas, Gimli, and Gandalf";
const JOIN_COLLAPSE_CAPTURE_WIDTH = 560;
const JOIN_COLLAPSE_CAPTURE_HEIGHT = 260;
const JOIN_COLLAPSE_CAPTURE_VERTICAL_PADDING = 24;

async function timelineChipLayout(chip: Locator) {
  return chip.evaluate((element) => {
    const paragraph = element.closest("p");
    if (!paragraph) throw new Error("Timeline chip is missing its paragraph");
    const chipBounds = element.getBoundingClientRect();
    const paragraphBounds = paragraph.getBoundingClientRect();
    const chipFragmentRects = Array.from(element.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .sort((a, b) => a.top - b.top);
    const chipStyle = getComputedStyle(element);
    return {
      boxDecorationBreak:
        chipStyle.getPropertyValue("box-decoration-break") ||
        chipStyle.getPropertyValue("-webkit-box-decoration-break"),
      chipHeight: chipBounds.height,
      chipLineHeight: Number.parseFloat(chipStyle.lineHeight),
      fragmentCount: chipFragmentRects.length,
      fragmentGap:
        chipFragmentRects.length > 1
          ? Math.round(chipFragmentRects[1].top - chipFragmentRects[0].bottom)
          : null,
      fragmentHeight:
        chipFragmentRects.length > 0
          ? Math.round(chipFragmentRects[0].height)
          : null,
      fragmentStep:
        chipFragmentRects.length > 1
          ? Math.round(chipFragmentRects[1].top - chipFragmentRects[0].top)
          : null,
      paragraphHeight: paragraphBounds.height,
      paragraphLineHeight: Number.parseFloat(
        getComputedStyle(paragraph).lineHeight,
      ),
    };
  });
}

/** Locator scoped to the mention autocomplete dropdown inside the composer. */
function autocomplete(page: import("@playwright/test").Page) {
  return page
    .getByTestId("message-composer")
    .getByTestId("mention-autocomplete");
}

async function readOutgoingMentionPubkeys(
  page: import("@playwright/test").Page,
  content: string,
) {
  return page.evaluate((expectedContent) => {
    const signedEvent = (
      window as Window & {
        __BUZZ_E2E_SIGNED_EVENTS__?: Array<{
          content?: string;
          tags?: string[][];
        }>;
      }
    ).__BUZZ_E2E_SIGNED_EVENTS__?.find(
      (event) => event.content === expectedContent,
    );
    if (signedEvent) {
      return (signedEvent.tags ?? [])
        .filter((tag) => tag[0] === "p" && tag[1])
        .map((tag) => tag[1]);
    }

    const entries =
      (
        window as Window & {
          __BUZZ_E2E_COMMAND_LOG__?: Array<{
            command: string;
            payload: unknown;
          }>;
        }
      ).__BUZZ_E2E_COMMAND_LOG__ ?? [];

    for (const entry of entries) {
      if (entry.command === "send_channel_message") {
        const payload = entry.payload as
          | { content?: string; mentionPubkeys?: string[] }
          | undefined;
        if (payload?.content === expectedContent) {
          return payload.mentionPubkeys ?? [];
        }
      }

      if (entry.command === "sign_event") {
        const unsignedEvent = entry.payload as
          | { content?: string; tags?: string[][] }
          | undefined;
        if (unsignedEvent?.content !== expectedContent) continue;
        return (unsignedEvent.tags ?? [])
          .filter((tag) => tag[0] === "p" && tag[1])
          .map((tag) => tag[1]);
      }

      if (entry.command !== "plugin:websocket|send") continue;
      const data = (
        entry.payload as { message?: { data?: string } } | undefined
      )?.message?.data;
      if (!data) continue;

      try {
        const frame = JSON.parse(data) as [
          string,
          { content?: string; tags?: string[][] },
        ];
        if (frame[0] !== "EVENT" || frame[1]?.content !== expectedContent) {
          continue;
        }
        return (frame[1].tags ?? [])
          .filter((tag) => tag[0] === "p" && tag[1])
          .map((tag) => tag[1]);
      } catch {}
    }

    return null;
  }, content);
}

async function emitMockMessage(
  page: import("@playwright/test").Page,
  channelName: string,
  content: string,
  options?: {
    kind?: number;
    mentionPubkeys?: string[];
    parentEventId?: string;
    pubkey?: string;
  },
) {
  const event = await page.evaluate(
    ({ ch, kind, mentionPubkeys, msg, parentEventId, pubkey }) => {
      return (
        window as Window & {
          __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
            channelName: string;
            content: string;
            kind?: number;
            mentionPubkeys?: string[];
            parentEventId?: string | null;
            pubkey?: string;
          }) => { id: string; created_at: number; pubkey: string };
        }
      ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: ch,
        content: msg,
        kind,
        mentionPubkeys,
        parentEventId: parentEventId ?? undefined,
        pubkey: pubkey ?? undefined,
      });
    },
    {
      ch: channelName,
      kind: options?.kind,
      mentionPubkeys: options?.mentionPubkeys,
      msg: content,
      parentEventId: options?.parentEventId ?? null,
      pubkey: options?.pubkey ?? TEST_IDENTITIES.alice.pubkey,
    },
  );
  if (!event) {
    throw new Error("Mock message emitter is not installed");
  }
  return event;
}

async function waitForMockLiveSubscription(
  page: import("@playwright/test").Page,
  channelName: string,
  kind?: number,
) {
  await expect
    .poll(async () => {
      return page.evaluate(
        ({ currentChannelName, kind: expectedKind }) => {
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
              kind: expectedKind,
            }) ?? false
          );
        },
        { currentChannelName: channelName, kind },
      );
    })
    .toBe(true);
}

// The channel timeline renders off a `useDeferredValue` snapshot that lags the
// latest `messages` by a commit; the list wrapper carries
// `data-render-pending="true"` while that commit is in flight and drops the
// attribute once it settles. Poll for its absence before asserting on
// freshly-sent content so the assertion does not race the deferred commit.
async function waitForTimelineSettled(page: import("@playwright/test").Page) {
  await expect(page.locator("[data-render-pending]")).toHaveCount(0);
}

function normalizeVisibleText(text: string) {
  return text.replace(/\s+,/g, ",").replace(/\s+/g, " ").trim();
}

function findDuplicateFixturePubkeys(
  profiles: Array<{ pubkey: string; displayName: string }>,
) {
  const namesByPubkey = new Map<string, string[]>();

  for (const profile of profiles) {
    const names = namesByPubkey.get(profile.pubkey) ?? [];
    names.push(profile.displayName);
    namesByPubkey.set(profile.pubkey, names);
  }

  return [...namesByPubkey.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([pubkey, displayNames]) => ({ pubkey, displayNames }));
}

async function collectJoinCollapseRows(page: import("@playwright/test").Page) {
  const rows = page.getByTestId("system-message-row").filter({
    hasText: /Elrond|Legolas|Gimli|Gandalf/,
  });
  const texts: string[] = [];
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    texts.push(normalizeVisibleText(await rows.nth(index).innerText()));
  }
  return { rows, texts };
}

async function maybeCaptureJoinCollapseTimeline(
  page: import("@playwright/test").Page,
) {
  const capturePath = process.env.JOIN_COLLAPSE_CAPTURE_PATH;
  if (!capturePath) return;
  await waitForAnimations(page);
  const timeline = page.getByTestId("message-timeline");
  const timelineBox = await timeline.boundingBox();
  const { rows } = await collectJoinCollapseRows(page);
  const rowBoxes = await Promise.all(
    Array.from({ length: await rows.count() }, (_, index) =>
      rows.nth(index).boundingBox(),
    ),
  );
  const visibleRowBoxes = rowBoxes.filter(
    (box): box is NonNullable<typeof box> => box !== null,
  );
  if (!timelineBox || visibleRowBoxes.length === 0) {
    throw new Error("Join-collapse screenshot target is not visible");
  }
  const minRowY = Math.min(...visibleRowBoxes.map((box) => box.y));
  const maxRowY = Math.max(...visibleRowBoxes.map((box) => box.y + box.height));
  const minRowX = Math.min(...visibleRowBoxes.map((box) => box.x));
  const maxRowX = Math.max(...visibleRowBoxes.map((box) => box.x + box.width));
  const desiredTop = minRowY - JOIN_COLLAPSE_CAPTURE_VERTICAL_PADDING;
  const desiredBottom = maxRowY + JOIN_COLLAPSE_CAPTURE_VERTICAL_PADDING;
  const desiredCenter = (desiredTop + desiredBottom) / 2;
  const desiredHorizontalCenter = (minRowX + maxRowX) / 2;
  const viewportHeight = page.viewportSize()?.height ?? 720;
  const clip = {
    x: Math.max(
      Math.round(timelineBox.x),
      Math.min(
        Math.round(desiredHorizontalCenter - JOIN_COLLAPSE_CAPTURE_WIDTH / 2),
        Math.round(
          timelineBox.x + timelineBox.width - JOIN_COLLAPSE_CAPTURE_WIDTH,
        ),
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        Math.round(desiredCenter - JOIN_COLLAPSE_CAPTURE_HEIGHT / 2),
        viewportHeight - JOIN_COLLAPSE_CAPTURE_HEIGHT,
      ),
    ),
    width: JOIN_COLLAPSE_CAPTURE_WIDTH,
    height: JOIN_COLLAPSE_CAPTURE_HEIGHT,
  };
  await page.screenshot({ path: capturePath, clip });
  console.log(`JOIN_COLLAPSE_CAPTURE_PATH=${capturePath}`);
}

async function expectAgentProfileActionsHidden(
  profilePopover: import("@playwright/test").Locator,
  pubkey: string,
) {
  await expect(
    profilePopover.getByTestId(`user-profile-popover-message-${pubkey}`),
  ).toHaveCount(0);
  await expect(
    profilePopover.getByTestId(`user-profile-popover-wave-${pubkey}`),
  ).toHaveCount(0);
  await expect(
    profilePopover.getByTestId(`user-profile-popover-huddle-${pubkey}`),
  ).toHaveCount(0);
}

test("relay-only shared agents emit an outbound mention tag when selected", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  const input = page.getByTestId("message-input");
  await input.fill("Ask @alice");

  const aliceRow = autocomplete(page).locator("button", { hasText: "alice" });
  await expect(aliceRow).toBeVisible();
  await aliceRow.click();
  await page.keyboard.type("please reply");

  const content = "Ask @alice please reply";
  await expect(input).toHaveText(content);
  await page.getByTestId("send-message").click();

  await expect
    .poll(() => readOutgoingMentionPubkeys(page, content))
    .toContain(TEST_IDENTITIES.alice.pubkey);
});

// The three tests below pin the code-context gate on the Space commit. They
// key off casing, because a commit rewrites the draft to the candidate's
// canonical display name: a surviving "@ALICE" means the typed text was left
// alone. Chip decorations are deliberately not asserted — they already render
// over known names inside code, which is a separate pre-existing gap.
test("Space inside a code block leaves an exact agent name literal", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  const input = page.getByTestId("message-input");
  await input.click();
  await page.keyboard.type("```");
  await page.keyboard.press("Enter");
  await expect(input.locator("pre")).toBeVisible();

  await page.keyboard.type("deploy @ALICE");
  await page.keyboard.press(" ");
  await page.keyboard.type("now");

  await expect(input.locator("pre")).toHaveText("deploy @ALICE now");

  await page.getByTestId("send-message").click();
  await expect
    .poll(() => readOutgoingMentionPubkeys(page, "```\ndeploy @ALICE now\n```"))
    .toEqual([]);
});

test("Space inside an inline code span leaves an exact agent name literal", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  const input = page.getByTestId("message-input");
  await input.click();
  // The closing backtick turns the span into a code mark, which drops the
  // backticks from the text the mention pipeline reads.
  await page.keyboard.type("run `@ALICE`");
  await expect(input.locator("code")).toHaveText("@ALICE");

  await page.keyboard.press(" ");
  await page.keyboard.type("now");

  await expect(input.locator("code")).toHaveText("@ALICE");
  await expect(input).toHaveText("run @ALICE now");

  await page.getByTestId("send-message").click();
  await expect
    .poll(() => readOutgoingMentionPubkeys(page, "run `@ALICE` now"))
    .toEqual([]);
});

test("Space still resolves an exact agent name typed after a code span", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  const input = page.getByTestId("message-input");
  await input.click();
  await page.keyboard.type("run `deploy` @ALICE");
  await page.keyboard.press(" ");
  await page.keyboard.type("now");

  const content = "run `deploy` @alice now";
  await expect(input).toHaveText("run deploy @alice now");

  await page.getByTestId("send-message").click();
  await expect
    .poll(() => readOutgoingMentionPubkeys(page, content))
    .toContain(TEST_IDENTITIES.alice.pubkey);
});

test("autocomplete filters member suggestions as user types", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  const input = page.getByTestId("message-input");
  await input.fill("@ali");

  const dropdown = autocomplete(page);
  await expect(dropdown.getByText("alice")).toBeVisible();
  await expect(dropdown.getByText("bob")).not.toBeVisible();
});

test("selecting a person mention inserts @Name into input", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("buzz-theme", "buzz-dark");
  });
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  const input = page.getByTestId("message-input");
  const dropdown = autocomplete(page);
  for (let attempt = 0; attempt < 5; attempt++) {
    await input.fill("Hey @bo");
    await dropdown.getByText("bob").click();
    await page.keyboard.type("hello");
    await expect(input).toHaveText("Hey @bob hello");
  }
  const mentionChip = input.locator(".human-mention-highlight", {
    hasText: "bob",
  });
  await expect(mentionChip).toBeVisible();
  await expect(mentionChip).toHaveText("bob");
  await expect(mentionChip).not.toHaveClass(/agent-mention-highlight/);
  await expect(mentionChip).toHaveCSS("display", "inline");
  await expect(
    input.locator(".mention-prefix-hidden", { hasText: "@" }),
  ).toHaveCount(1);
  const iconMask = await mentionChip.evaluate((element) =>
    getComputedStyle(element, "::before").getPropertyValue(
      "-webkit-mask-image",
    ),
  );
  expect(iconMask).toContain("data:image/svg+xml");
  expect(
    await mentionChip.evaluate(
      (element) => getComputedStyle(element, "::before").display,
    ),
  ).toBe("inline-block");
  await expect(
    input.locator(".mention-prefix-hidden", { hasText: "@" }),
  ).toHaveCSS("opacity", "0");
  await expect(mentionChip).toHaveCSS("line-height", "18px");
  const scrollViewport = page.getByTestId("message-input-scroll");
  const paintedBounds = await mentionChip.evaluate((element) => {
    const chip = element.getBoundingClientRect();
    const viewport = element
      .closest("[data-testid='message-input-scroll']")
      ?.getBoundingClientRect();
    if (!viewport)
      throw new Error("Mention chip is missing its scroll viewport");
    return {
      chipTop: chip.top,
      chipBottom: chip.bottom,
      viewportTop: viewport.top,
      viewportBottom: viewport.bottom,
    };
  });
  expect(paintedBounds.chipTop).toBeGreaterThanOrEqual(
    paintedBounds.viewportTop,
  );
  expect(paintedBounds.chipBottom).toBeLessThanOrEqual(
    paintedBounds.viewportBottom,
  );
  const humanIconTranslateY = await mentionChip.evaluate(
    (element) =>
      new DOMMatrix(getComputedStyle(element, "::before").transform).m42,
  );
  const channelIconTranslateY = await input.evaluate((composer) => {
    const probe = document.createElement("span");
    probe.className =
      "mention-chip inline-chip-with-icon inline-chip-icon-channel";
    composer.append(probe);
    const translateY = new DOMMatrix(
      getComputedStyle(probe, "::before").transform,
    ).m42;
    probe.remove();
    return translateY;
  });
  expect(humanIconTranslateY - channelIconTranslateY).toBeCloseTo(1);

  await input.fill("@bo");
  await dropdown.getByText("bob").click();
  await input.press("Shift+Enter");
  await page.keyboard.type("@bo");
  await dropdown.getByText("bob").click();
  await input.press("Shift+Enter");
  await page.keyboard.type("@bo");
  await dropdown.getByText("bob").click();
  const multilineChips = input.locator(".human-mention-highlight");
  await expect(multilineChips).toHaveCount(3);
  const multilinePaintBounds = await multilineChips.evaluateAll((elements) => {
    const viewport = elements[0]
      ?.closest("[data-testid='message-input-scroll']")
      ?.getBoundingClientRect();
    if (!viewport) {
      throw new Error("Mention chips are missing their scroll viewport");
    }
    return elements.map((element) => {
      const chip = element.getBoundingClientRect();
      return {
        chipTop: chip.top,
        chipBottom: chip.bottom,
        viewportTop: viewport.top,
        viewportBottom: viewport.bottom,
      };
    });
  });
  for (const bounds of multilinePaintBounds) {
    expect(bounds.chipTop).toBeGreaterThanOrEqual(bounds.viewportTop);
    expect(bounds.chipBottom).toBeLessThanOrEqual(bounds.viewportBottom);
  }

  await scrollViewport.evaluate((element) => {
    element.style.width = "8rem";
  });
  await input.fill("A deliberately long prefix that forces @bo");
  await dropdown.getByText("bob").click();
  const wrappedChip = input.locator(".human-mention-highlight", {
    hasText: "bob",
  });
  const wrappedPaintBounds = await wrappedChip.evaluate((element) => {
    const chip = element.getBoundingClientRect();
    const viewport = element
      .closest("[data-testid='message-input-scroll']")
      ?.getBoundingClientRect();
    if (!viewport)
      throw new Error("Mention chip is missing its scroll viewport");
    return {
      chipTop: chip.top,
      chipBottom: chip.bottom,
      viewportTop: viewport.top,
      viewportBottom: viewport.bottom,
    };
  });
  expect(wrappedPaintBounds.chipTop).toBeGreaterThanOrEqual(
    wrappedPaintBounds.viewportTop,
  );
  expect(wrappedPaintBounds.chipBottom).toBeLessThanOrEqual(
    wrappedPaintBounds.viewportBottom,
  );
  await expect(input).toHaveCSS("height", /^(?!20px$)/);
  await scrollViewport.evaluate((element) => {
    element.style.removeProperty("width");
  });

  await waitForAnimations(page);
  await page.getByTestId("message-composer").screenshot({
    path: "test-results/inline-chip-polish/composer-after.png",
  });
});

test("immediate ArrowLeft after a person mention is not bounced past the trailing space", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  const input = page.getByTestId("message-input");
  await input.fill("Hey @bo");
  await autocomplete(page).getByText("bob").click();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("x");
  const text = (await input.innerText()).replace(/\s+$/, "");
  expect(text).toBe("Hey @bobx");
  expect(text).not.toMatch(/@bob x/);
});

test("clicking a person mention chip edge is not treated as after the trailing space", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  const input = page.getByTestId("message-input");
  await input.fill("Hey @bo");
  await autocomplete(page).getByText("bob").click();
  const chip = input.locator(".human-mention-highlight", { hasText: "bob" });
  await expect(chip).toBeVisible();
  const box = await chip.boundingBox();
  expect(box).toBeTruthy();
  await chip.click({
    position: {
      x: Math.max((box?.width ?? 1) - 2, 0),
      y: (box?.height ?? 2) / 2,
    },
  });
  await page.keyboard.type("x");
  const text = (await input.innerText()).replace(/\s+$/, "");
  expect(text).toBe("Hey @bobx");
  expect(text).not.toMatch(/@bob x/);
});

test("typing a mention before existing text does not interleave spaces", async ({
  page,
}) => {
  // Regression (the reported repro): with a draft already written, place the
  // caret earlier in the message, type a partial mention, pick a suggestion,
  // then keep typing. Caret correction used to fire on every document change
  // and walk the caret across the mention's trailing space, so each keystroke
  // pushed a space further into the rest of the draft.
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  const input = page.getByTestId("message-input");
  await input.fill("hello world");

  // Click between "hello" and " world", then open autocomplete there.
  await input.focus();
  for (let i = 0; i < " world".length; i++) {
    await page.keyboard.press("ArrowLeft");
  }
  await page.keyboard.type(" @bo");
  await autocomplete(page).getByText("bob").click();
  await page.keyboard.type("abc");

  await expect(input).toHaveText("hello @bob abc world");
});

test("typing an unregistered @token before existing text is left alone", async ({
  page,
}) => {
  // The trailing-space scan is purely textual, so it also fired for tokens
  // that were never registered as mentions.
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  const input = page.getByTestId("message-input");
  await input.fill("hello world");
  await input.focus();
  for (let i = 0; i < " world".length; i++) {
    await page.keyboard.press("ArrowLeft");
  }
  await page.keyboard.type(" @zzq");

  await expect(input).toHaveText("hello @zzq world");
});

test("wrapped channel references keep the icon on the first composer line", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  const input = page.getByTestId("message-input");
  await page.getByTestId("message-input-scroll").evaluate((element) => {
    element.style.width = "74px";
  });
  await input.fill("#all-replies");

  const channelChip = input.locator(".inline-chip-icon-channel", {
    hasText: "all-replies",
  });
  await expect(channelChip).toBeVisible();
  // CSSOM exposes pseudo-element styles but not their rendered box.
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send("DOM.getDocument", {
    depth: -1,
    pierce: true,
  });
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: ".rich-text-composer .inline-chip-icon-channel",
  });
  const { node } = await cdp.send("DOM.describeNode", { nodeId, depth: 1 });
  const before = node.pseudoElements?.find(
    (pseudo) => pseudo.pseudoType === "before",
  );
  if (!before) {
    throw new Error("Channel chip is missing its generated icon");
  }
  const iconBox = await cdp.send("DOM.getBoxModel", { nodeId: before.nodeId });
  const iconTop = iconBox.model.border[1];
  await cdp.detach();
  const geometry = await channelChip.evaluate((element) => {
    const textNode = element.firstChild;
    if (!(textNode instanceof Text)) {
      throw new Error("Channel chip is missing its decorated text node");
    }
    const textRange = document.createRange();
    textRange.selectNodeContents(textNode);
    const rects = (source: DOMRectList) =>
      Array.from(source, (rect) => ({
        left: rect.left,
        top: rect.top,
      }));
    const iconStyle = getComputedStyle(element, "::before");
    const tokenProbe = document.createElement("span");
    tokenProbe.style.cssText =
      "position:fixed;width:var(--inline-chip-padding-inline)";
    element.append(tokenProbe);
    const tokenPadding = tokenProbe.getBoundingClientRect().width;
    tokenProbe.remove();
    return {
      chipRects: rects(element.getClientRects()),
      iconPosition: iconStyle.position,
      iconTransform: iconStyle.transform,
      tokenPadding,
      textRects: rects(textRange.getClientRects()),
    };
  });
  expect(geometry.chipRects).toHaveLength(2);
  expect(geometry.textRects).toHaveLength(2);
  expect(geometry.iconPosition).toBe("static");
  expect(geometry.iconTransform).toBe("none");
  expect(
    geometry.textRects[0].left - geometry.chipRects[0].left,
  ).toBeGreaterThan(geometry.tokenPadding);
  expect(geometry.textRects[1].left - geometry.chipRects[1].left).toBeCloseTo(
    geometry.tokenPadding,
    0,
  );
  expect(iconTop - geometry.textRects[0].top).toBeCloseTo(2.5, 0);
});

test("channel references keep caret movement through the channel name", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  const input = page.getByTestId("message-input");
  await input.fill("#general");

  const channelChip = input.locator(".inline-chip-icon-channel", {
    hasText: "general",
  });
  await expect(channelChip).toBeVisible();
  await expect(channelChip).toHaveText("general");
  await expect(
    input.locator(".mention-prefix-hidden", { hasText: "#" }),
  ).toHaveCount(1);
  const iconMask = await channelChip.evaluate((element) =>
    getComputedStyle(element, "::before").getPropertyValue(
      "-webkit-mask-image",
    ),
  );
  expect(iconMask).toContain("data:image/svg+xml");
  expect(
    await channelChip.evaluate(
      (element) => getComputedStyle(element, "::before").display,
    ),
  ).toBe("inline-block");
  await expect(
    input.locator(".mention-prefix-hidden", { hasText: "#" }),
  ).toHaveCSS("opacity", "0");

  await input.focus();
  await input.press("ArrowLeft");
  await input.press("ArrowLeft");
  await input.press("ArrowLeft");
  await page.keyboard.type("X");

  await expect(input).toHaveText("#geneXral");
});

test("other-owned agents without a shared channel are hidden from mentions", async ({
  page,
}) => {
  await installMockBridge(page, {
    searchProfiles: [
      {
        pubkey: PROFILE_ONLY_AGENT_PUBKEY,
        displayName: "mira",
        ownerPubkey: TEST_IDENTITIES.outsider.pubkey,
        isAgent: true,
      },
    ],
    userSearchDelayMs: 1_000,
  });
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  const input = page.getByTestId("message-input");
  await input.fill("@mira");

  const dropdown = autocomplete(page);
  await expect(dropdown).not.toBeVisible();
  await expect(input.locator(".mention-chip")).toHaveCount(0);
});

test("stale channel-member agents absent from managed and relay directories stay hidden", async ({
  page,
}) => {
  await installMockBridge(page, { userSearchDelayMs: 1_000 });
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  const input = page.getByTestId("message-input");
  await input.fill("@mira");

  await expect(autocomplete(page)).toHaveCount(0);
});

test("relay-only allowlisted agents stay hidden outside their channel", async ({
  page,
}) => {
  await installMockBridge(page, {
    relayAgents: [
      {
        pubkey: ALLOWLIST_RELAY_AGENT_PUBKEY,
        name: "quinn",
        respondTo: "allowlist",
        respondToAllowlist: [MOCK_VIEWER_PUBKEY],
        channelNames: ["agents"],
      },
    ],
  });
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  await page.getByTestId("message-input").fill("@quinn");

  await expect(autocomplete(page)).toHaveCount(0);
});

test("relay-only excluded agents stay hidden from channel mentions", async ({
  page,
}) => {
  await installMockBridge(page, {
    relayAgents: [
      {
        pubkey: ALLOWLIST_RELAY_AGENT_PUBKEY,
        name: "quinn",
        respondTo: "allowlist",
        respondToAllowlist: [TEST_IDENTITIES.outsider.pubkey],
        channelNames: ["general"],
      },
    ],
  });
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  await page.getByTestId("message-input").fill("@quinn");

  await expect(autocomplete(page)).toHaveCount(0);
});

test("groups contiguous arrival activity with hidden names in the standard tooltip", async ({
  page,
}) => {
  const actor = STANDARD_GROUPED_ARRIVAL_ACTOR;
  const targets = STANDARD_GROUPED_ARRIVAL_TARGETS;
  await installMockBridge(page, {
    searchProfiles: [actor, ...targets],
  });
  await page.goto("/");
  await page.getByTestId("channel-random").click();
  await expect(page.getByTestId("chat-title")).toHaveText("random");
  await waitForMockLiveSubscription(page, "random", SYSTEM_MESSAGE_KIND);

  await page.evaluate(
    ({ actorPubkey, addedTargets, kind }) => {
      const createdAt = Math.floor(Date.now() / 1_000);
      for (const [index, target] of addedTargets.entries()) {
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "random",
          content: JSON.stringify({
            type: "member_joined",
            actor: actorPubkey,
            target: target.pubkey,
          }),
          createdAt: createdAt + index,
          kind,
        });
      }
    },
    {
      actorPubkey: actor.pubkey,
      addedTargets: targets,
      kind: SYSTEM_MESSAGE_KIND,
    },
  );
  await waitForTimelineSettled(page);

  const groupedRow = page
    .getByTestId("system-message-row")
    .filter({ hasText: "added by Alice Chen, along with" });
  for (const visibleName of [
    "Erica Chapman",
    "Peter Griffin",
    "Marcia Thomas",
  ]) {
    await expect(groupedRow).toContainText(visibleName);
  }
  await expect(
    groupedRow.locator("p").filter({ hasText: "added by Alice Chen" }),
  ).toContainText(
    "Erica Chapman added by Alice Chen, along with Peter Griffin, Marcia Thomas, Jordan Lee, and 2 others",
  );
  const avatarStack = groupedRow.getByTestId("system-message-avatar-stack");
  await expect(avatarStack).toHaveCount(1);
  await expect(avatarStack.getByTestId("system-message-avatar")).toHaveCount(5);
  await expect(
    groupedRow.locator("p").filter({ hasText: "added by Alice Chen" }),
  ).toHaveCSS("text-align", "left");
  await expect(groupedRow.locator("[data-mention]")).toHaveCount(0);

  const visibleName = groupedRow.getByText("Peter Griffin", { exact: true });
  await expect(visibleName).toHaveCSS("text-decoration-line", "none");
  await visibleName.hover();
  await expect(visibleName).toHaveCSS("text-decoration-line", "underline");

  const othersTrigger = groupedRow.getByRole("button", { name: "2 others" });
  // Park the pointer off-target first: the previous hover leaves the mouse at a
  // fixed viewport point, and any later reflow (new rows, scroll-to-bottom, a
  // different text wrap) can slide this button under it. Without this the
  // assertion measures where the mouse happens to be, not the resting style.
  await page.mouse.move(0, 0);
  await expect(othersTrigger).toHaveCSS("text-decoration-line", "none");
  await othersTrigger.hover();
  await expect(othersTrigger).toHaveCSS("text-decoration-line", "underline");

  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("Olivia Park");
  await expect(tooltip).toContainText("Sam Rivera");

  await expect(avatarStack.locator("..")).toHaveCSS("align-items", "center");
});

test("keeps deterministic grouped-arrival fixture pubkeys unique", () => {
  expect(
    findDuplicateFixturePubkeys([
      STANDARD_GROUPED_ARRIVAL_ACTOR,
      ...STANDARD_GROUPED_ARRIVAL_TARGETS,
      ...JOIN_COLLAPSE_PROFILES,
    ]),
  ).toEqual([]);
});

test("collapses contiguous mixed join arrivals into one actor-neutral cohort", async ({
  page,
}) => {
  await installMockBridge(page, {
    searchProfiles: JOIN_COLLAPSE_PROFILES,
  });
  await page.goto("/");
  await page.getByTestId("channel-random").click();
  await expect(page.getByTestId("chat-title")).toHaveText(
    JOIN_COLLAPSE_CHANNEL_NAME,
  );
  await waitForMockLiveSubscription(
    page,
    JOIN_COLLAPSE_CHANNEL_NAME,
    SYSTEM_MESSAGE_KIND,
  );

  await page.evaluate(
    ({ channelName, currentUser, elrond, legolas, gimli, gandalf, kind }) => {
      const createdAt = Math.floor(Date.now() / 1_000);
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName,
        content: JSON.stringify({
          type: "member_joined",
          actor: currentUser,
          target: elrond,
        }),
        createdAt,
        kind,
        pubkey: currentUser,
      });
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName,
        content: JSON.stringify({
          type: "member_joined",
          actor: elrond,
          target: legolas,
        }),
        createdAt: createdAt + 1,
        kind,
        pubkey: elrond,
      });
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName,
        content: JSON.stringify({
          type: "member_joined",
          actor: elrond,
          target: gimli,
        }),
        createdAt: createdAt + 2,
        kind,
        pubkey: elrond,
      });
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName,
        content: JSON.stringify({
          type: "member_joined",
          actor: currentUser,
          target: gandalf,
        }),
        createdAt: createdAt + 3,
        kind,
        pubkey: currentUser,
      });
    },
    {
      channelName: JOIN_COLLAPSE_CHANNEL_NAME,
      currentUser: MOCK_VIEWER_PUBKEY,
      elrond: ELROND_PUBKEY,
      legolas: LEGOLAS_PUBKEY,
      gimli: GIMLI_PUBKEY,
      gandalf: GANDALF_PUBKEY,
      kind: SYSTEM_MESSAGE_KIND,
    },
  );
  await waitForTimelineSettled(page);
  await page.getByTestId("message-timeline").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await waitForAnimations(page);

  const { rows, texts } = await collectJoinCollapseRows(page);
  console.log(`JOIN_COLLAPSE_VISIBLE_TEXTS=${JSON.stringify(texts)}`);
  if (process.env.JOIN_COLLAPSE_EXPECT_SPLIT === "1") {
    expect(texts).toEqual(JOIN_COLLAPSE_SPLIT_TEXTS);
  }
  await maybeCaptureJoinCollapseTimeline(page);

  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(JOIN_COLLAPSE_GROUPED_TEXT);
});

test("system agent activity avatar stack is decorative", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("channel-random").click();
  await expect(page.getByTestId("chat-title")).toHaveText("random");
  await waitForMockLiveSubscription(page, "random", SYSTEM_MESSAGE_KIND);

  await page.evaluate(
    ({ kind, targetPubkey }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "random",
        content: JSON.stringify({
          type: "member_joined",
          actor: targetPubkey,
          target: targetPubkey,
        }),
        kind,
      });
    },
    {
      kind: SYSTEM_MESSAGE_KIND,
      targetPubkey: PROFILE_ONLY_AGENT_PUBKEY,
    },
  );
  await waitForTimelineSettled(page);

  const joinedRow = page
    .getByTestId("system-message-row")
    .filter({ has: page.getByText("mira", { exact: true }) });
  const avatarStack = joinedRow.getByTestId("system-message-avatar-stack");
  await expect(avatarStack.getByTestId("system-message-avatar")).toHaveCount(1);
  await expect(avatarStack.locator("button")).toHaveCount(0);
});

test("membership activity folds a member joining then leaving", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("channel-random").click();
  await expect(page.getByTestId("chat-title")).toHaveText("random");
  await waitForMockLiveSubscription(page, "random", SYSTEM_MESSAGE_KIND);

  await page.evaluate(
    ({ alicePubkey, kind }) => {
      const createdAt = Math.floor(Date.now() / 1_000);
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "random",
        content: JSON.stringify({
          type: "member_joined",
          actor: alicePubkey,
          target: alicePubkey,
        }),
        createdAt,
        kind,
      });
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "random",
        content: JSON.stringify({ type: "member_left", actor: alicePubkey }),
        createdAt: createdAt + 1,
        kind,
      });
    },
    { alicePubkey: TEST_IDENTITIES.alice.pubkey, kind: SYSTEM_MESSAGE_KIND },
  );
  await waitForTimelineSettled(page);
  const lifecycleRow = page
    .getByTestId("system-message-row")
    .filter({ hasText: "alice" })
    .filter({ hasText: "joined, then left the channel" });
  await expect(lifecycleRow).toBeVisible();
  await expect(lifecycleRow.getByTestId("system-message-avatar")).toHaveCount(
    1,
  );
});

test("membership activity folds duplicate self-joins then leaving into one row", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("channel-random").click();
  await expect(page.getByTestId("chat-title")).toHaveText("random");
  await waitForMockLiveSubscription(page, "random", SYSTEM_MESSAGE_KIND);

  // The relay re-emits `member_joined` on each PUT_USER, so a member can arrive
  // twice before leaving. Both arrivals group with the departure; describing
  // only a 2-event pair dropped the departure and left the member rendered as
  // still present.
  await page.evaluate(
    ({ alicePubkey, kind }) => {
      const createdAt = Math.floor(Date.now() / 1_000);
      const join = {
        type: "member_joined",
        actor: alicePubkey,
        target: alicePubkey,
      };
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "random",
        content: JSON.stringify(join),
        createdAt,
        kind,
      });
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "random",
        content: JSON.stringify(join),
        createdAt: createdAt + 1,
        kind,
      });
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "random",
        content: JSON.stringify({ type: "member_left", actor: alicePubkey }),
        createdAt: createdAt + 2,
        kind,
      });
    },
    { alicePubkey: TEST_IDENTITIES.alice.pubkey, kind: SYSTEM_MESSAGE_KIND },
  );
  await waitForTimelineSettled(page);

  const aliceRows = page
    .getByTestId("system-message-row")
    .filter({ hasText: "alice" });
  await expect(aliceRows).toHaveCount(1);
  await expect(aliceRows).toHaveText(/joined, then left the channel/);
  await expect(aliceRows.getByTestId("system-message-avatar")).toHaveCount(1);
});

test("profile-only agent author hides actions without agent access", async ({
  page,
}) => {
  await installMockBridge(page, {
    searchProfiles: [
      {
        pubkey: PROFILE_ONLY_AGENT_PUBKEY,
        displayName: "mira",
        isAgent: true,
      },
    ],
  });
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForMockLiveSubscription(page, "general");

  await emitMockMessage(page, "general", "Mira status update.", {
    pubkey: PROFILE_ONLY_AGENT_PUBKEY,
  });
  await waitForTimelineSettled(page);

  const messageRow = page
    .getByTestId("message-row")
    .filter({ hasText: "Mira status update." })
    .first();
  await messageRow.locator("button").first().hover();

  const profilePopover = page.locator(
    '[data-testid="user-profile-popover"][data-state="open"]',
  );
  await expect(profilePopover).toBeVisible();
  await expectAgentProfileActionsHidden(
    profilePopover,
    PROFILE_ONLY_AGENT_PUBKEY,
  );
});

test("system member-joined rows render the joined person as a plain profile name", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForMockLiveSubscription(page, "general", SYSTEM_MESSAGE_KIND);

  await page.evaluate(
    ({ kind, pubkey }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: JSON.stringify({
          type: "member_joined",
          actor: pubkey,
          target: pubkey,
        }),
        kind,
      });
    },
    { kind: SYSTEM_MESSAGE_KIND, pubkey: TEST_IDENTITIES.bob.pubkey },
  );
  await waitForTimelineSettled(page);

  const joinedRow = page
    .getByTestId("system-message-row")
    .filter({ has: page.getByText("bob", { exact: true }) });
  const joinedPersonName = joinedRow.getByText("bob", { exact: true });

  await expect(joinedPersonName).toBeVisible();
  await expect(joinedPersonName).not.toHaveAttribute("data-mention");
});

test("mention button opens autocomplete and inserts a selected member", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  const input = page.getByTestId("message-input");
  await input.fill("Hey ");
  await page.getByTestId("message-insert-mention").click();

  const dropdown = autocomplete(page);
  await expect(dropdown).toBeVisible();
  await dropdown.getByText("bob").click();

  await expect(input).toHaveText("Hey @bob ");
});

test("inserting a mention preserves Shift+Enter newlines (regression: bug #2)", async ({
  page,
}) => {
  // Before PR #618, mention insertion round-tripped through
  // `setContent(markdown)`, which collapsed every Shift+Enter hard
  // break to a single space. After the fix, autocomplete uses a
  // native ProseMirror `tr.insertText` transaction and the line
  // breaks survive.
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  const input = page.getByTestId("message-input");
  await input.click();
  await page.keyboard.type("line one");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("line two @bo");

  const dropdown = autocomplete(page);
  await expect(dropdown.getByText("bob")).toBeVisible();
  await dropdown.getByText("bob").click();

  // Both lines must still be present, separated by a real line break
  // (rendered as a `<br>` by Tiptap; the projection sees `\n`).
  await expect(input).toHaveText(/line one[\s\S]*line two @bob/);
  await expect(input.locator("br")).toHaveCount(1);
});

test("keyboard navigation selects mention with Enter", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  const input = page.getByTestId("message-input");
  await input.fill("@bo");

  const dropdown = autocomplete(page);
  await expect(dropdown.getByText("bob")).toBeVisible();

  // Press Enter to select the first (and only) suggestion
  await input.press("Enter");

  // Should insert @bob and NOT send the message
  await expect(input).toHaveText("@bob ");
});

test("Escape dismisses autocomplete dropdown", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  const input = page.getByTestId("message-input");
  await input.fill("@");

  const dropdown = autocomplete(page);
  await expect(dropdown).toBeVisible();

  await input.press("Escape");

  await expect(dropdown).not.toBeVisible();
});

test("mention text is highlighted in sent messages", async ({ page }) => {
  const suffix = ` check this out ${Date.now()}`;

  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  const input = page.getByTestId("message-input");
  await input.fill("Hey @bo");
  await autocomplete(page).getByText("bob").click();
  await expect(input).toHaveText("Hey @bob ");
  await page.keyboard.type(suffix);
  await page.getByTestId("send-message").click();

  await waitForTimelineSettled(page);

  const mentionChip = page
    .getByTestId("message-row")
    .last()
    .locator("[data-mention].mention-chip", { hasText: "bob" });
  await expect(mentionChip).toBeVisible();
  await expect(mentionChip).toHaveText("bob");
  await expect(mentionChip).toHaveClass(/inline-chip-icon-human/);
  await expect(mentionChip).toHaveClass(/wrapping-inline-chip/);

  const timelineLayout = await timelineChipLayout(mentionChip);
  expect(timelineLayout).toMatchObject({
    boxDecorationBreak: "clone",
    chipHeight: 17,
    chipLineHeight: 18,
    fragmentCount: 1,
    fragmentGap: null,
    fragmentHeight: 17,
    fragmentStep: null,
    paragraphHeight: 20,
    paragraphLineHeight: 20,
  });
});

test("qualified mentions wrap without changing message line rhythm", async ({
  page,
}) => {
  const pubkey = TEST_IDENTITIES.bob.pubkey;
  const qualifiedLabel = `bob (${pubkey})`;

  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForMockLiveSubscription(page, "general");
  await emitMockMessage(page, "general", `@${qualifiedLabel}`, {
    mentionPubkeys: [pubkey],
  });
  await waitForTimelineSettled(page);

  const row = page.getByTestId("message-row").filter({ hasText: "bob" }).last();
  await row.evaluate((element) => {
    const prose = element.querySelector<HTMLElement>(".message-markdown");
    if (!prose)
      throw new Error("Qualified mention is missing its prose wrapper");
    prose.style.width = "8rem";
  });
  const mentionChip = row.locator("[data-mention]", { hasText: "bob" });
  await expect(mentionChip).toHaveText(/bob \(npub1hv3…tpuc\)/);
  await expect(mentionChip).toHaveClass(/wrapping-inline-chip/);

  const layout = await timelineChipLayout(mentionChip);
  expect(layout.boxDecorationBreak).toBe("clone");
  expect(layout.chipLineHeight).toBe(18);
  expect(layout.fragmentCount).toBe(2);
  expect(layout.fragmentHeight).toBe(17);
  expect(layout.fragmentGap).toBeGreaterThanOrEqual(1);
  expect(layout.fragmentStep).toBe(20);
  expect(layout.paragraphLineHeight).toBe(20);
  expect(layout.chipHeight).toBeLessThanOrEqual(
    layout.fragmentCount * layout.paragraphLineHeight,
  );

  const trigger = mentionChip.locator("xpath=..");
  await expect(trigger).toHaveCSS("display", "inline");
  await expect(trigger).toHaveAttribute("role", "button");
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await expect(page.getByTestId("user-profile-panel")).toBeVisible();
});

test("clicking author name opens user profile panel", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  // The seed message in general is from the mock identity (npub1mock...)
  const firstMessage = page.getByTestId("message-row").first();
  const authorButton = firstMessage.locator("button", {
    hasText: "npub1mock...",
  });
  await authorButton.click();

  // Click now opens the full profile panel instead of the popover
  const panel = page.getByTestId("user-profile-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(truncateNpub(MOCK_VIEWER_PUBKEY));
  await expect(panel).not.toContainText("deadbeefdeadbeef");
});

test("hovering avatar opens popover, clicking opens profile panel", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");

  const firstMessage = page.getByTestId("message-row").first();
  const avatarButton = firstMessage.locator("button").first();

  // Hover should open the popover
  await avatarButton.hover();
  const profilePopover = page.locator(
    '[data-testid="user-profile-popover"][data-state="open"]',
  );
  await expect(profilePopover).toBeVisible();

  // Click should close the popover and open the profile panel
  await avatarButton.click();
  await expect(profilePopover).toHaveCount(0);
  await expect(page.getByTestId("user-profile-panel")).toBeVisible();
});

test("clicking a mention chip in the timeline opens the profile panel", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForMockLiveSubscription(page, "general");

  await emitMockMessage(page, "general", "Ping @bob about the launch", {
    mentionPubkeys: [TEST_IDENTITIES.bob.pubkey],
  });
  await waitForTimelineSettled(page);

  const mentionChip = page
    .getByTestId("message-row")
    .filter({ hasText: "Ping bob about the launch" })
    .locator("[data-mention]", { hasText: "bob" });
  await expect(mentionChip).toBeVisible();
  await mentionChip.click();

  const panel = page.getByTestId("user-profile-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("bob");
});

test("mention text matching the kind-0 name alias resolves and opens the profile panel", async ({
  page,
}) => {
  // bob's mock profile has display_name "bob" and kind-0 name "bobby". A
  // message that says "@bobby" (how agents/CLI resolve mentions at send time)
  // must still render a clickable chip bound to bob's pubkey.
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForMockLiveSubscription(page, "general");

  await emitMockMessage(page, "general", "Ask @bobby to review the doc", {
    mentionPubkeys: [TEST_IDENTITIES.bob.pubkey],
  });
  await waitForTimelineSettled(page);

  const mentionChip = page
    .getByTestId("message-row")
    .filter({ hasText: "Ask bobby to review the doc" })
    .locator("[data-mention]", { hasText: "bobby" });
  await expect(mentionChip).toBeVisible();
  await mentionChip.click();

  const panel = page.getByTestId("user-profile-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("bob");
});

test("human profile popover does not show an owner", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForMockLiveSubscription(page, "general");

  await emitMockMessage(page, "general", "Bob checking in.", {
    pubkey: TEST_IDENTITIES.bob.pubkey,
  });
  await waitForTimelineSettled(page);

  const bobMessage = page
    .getByTestId("message-row")
    .filter({ hasText: "Bob checking in." })
    .first();
  await bobMessage.locator("button").first().hover();

  const profilePopover = page.locator(
    '[data-testid="user-profile-popover"][data-state="open"]',
  );
  await expect(profilePopover).toBeVisible();
  await expect(
    profilePopover.locator('[data-testid^="user-profile-popover-owner-"]'),
  ).toHaveCount(0);
});

test("delayed inaccessible agent profile keeps all actions hidden", async ({
  page,
}) => {
  await installMockBridge(page, {
    agentListDelayMs: 5_000,
    relayAgents: [
      {
        pubkey: DELAYED_RELAY_AGENT_PUBKEY,
        name: "orbit",
        channelNames: ["general"],
      },
    ],
    searchProfiles: [
      {
        pubkey: DELAYED_RELAY_AGENT_PUBKEY,
        displayName: "orbit",
      },
    ],
  });

  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForMockLiveSubscription(page, "general");

  await emitMockMessage(page, "general", "Orbit checking in.", {
    pubkey: DELAYED_RELAY_AGENT_PUBKEY,
  });
  await waitForTimelineSettled(page);

  const orbitMessage = page
    .getByTestId("message-row")
    .filter({ hasText: "Orbit checking in." })
    .first();
  await orbitMessage.locator("button").first().hover();

  const profilePopover = page.locator(
    '[data-testid="user-profile-popover"][data-state="open"]',
  );
  await expect(profilePopover).toBeVisible();
  await expect(
    profilePopover.getByTestId(
      `user-profile-popover-message-${DELAYED_RELAY_AGENT_PUBKEY}`,
    ),
  ).toHaveCount(0);
  await expect(
    profilePopover.getByTestId(
      `user-profile-popover-wave-${DELAYED_RELAY_AGENT_PUBKEY}`,
    ),
  ).toHaveCount(0);
  await expect(
    profilePopover.getByTestId(
      `user-profile-popover-huddle-${DELAYED_RELAY_AGENT_PUBKEY}`,
    ),
  ).toHaveCount(0);
});
