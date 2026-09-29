import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  MoreUnreadButton,
  unreadAccessibleLabel,
} from "./MoreUnreadButton.tsx";

describe("MoreUnreadButton model", () => {
  it("announces the unread count and scroll direction", () => {
    assert.equal(
      unreadAccessibleLabel({ count: 2, position: "bottom" }),
      "2 unread below",
    );
    assert.equal(
      unreadAccessibleLabel({ count: 1, label: "1 unread", position: "top" }),
      "1 unread above",
    );
  });

  it("renders a truncating pill with the unread label", () => {
    const markup = renderToStaticMarkup(
      MoreUnreadButton({
        count: 5,
        emphasis: "primary",
        onClick() {},
        position: "bottom",
        testId: "more-unread",
      }),
    );

    assert.match(markup, /class="[^"]*overflow-hidden[^"]*"/);
    assert.match(markup, /<span class="min-w-0 truncate">5 unread<\/span>/);
    assert.match(markup, /aria-label="5 unread below"/);
  });
});
