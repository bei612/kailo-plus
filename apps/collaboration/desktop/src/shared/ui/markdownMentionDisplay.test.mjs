import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { truncateNpub } from "../lib/pubkey.ts";
import { createMarkdownComponents } from "./markdown.tsx";
import { renderCachedMarkdown } from "./markdown/nodeCache.ts";
import { MarkdownRuntimeContext } from "./markdown/runtimeContext.ts";

const KEY = `150b20bd${"a".repeat(52)}15dc`;

test("rendered mention abbreviates a bound key without changing its metadata", () => {
  const label = `Scout (${KEY}) 2`;
  const name = label.toLowerCase();
  const html = renderToStaticMarkup(
    React.createElement(
      MarkdownRuntimeContext.Provider,
      {
        value: {
          channels: [],
          mentionPubkeysByName: { [name]: KEY },
        },
      },
      renderCachedMarkdown({
        content: `Ask @${label}`,
        mentionNames: [label],
        components: createMarkdownComponents(false, false),
        variant: "compact-mention",
      }),
    ),
  );
  assert.equal(
    html.replace(/<[^>]+>/g, ""),
    `Ask Scout (${truncateNpub(KEY)}) 2`,
  );
  assert.ok(html.includes(`data-mention-label="${label}"`));
  assert.ok(html.includes(`data-mention-pubkey="${KEY}"`));
  assert.ok(html.includes(`title="${label}"`));
  assert.ok(html.includes(`aria-label="${label}"`));
  assert.match(html, /inline-chip-leading-fragment[^>]*inline-chip-icon-human/);
});

test("an unresolved qualified mention stays literal rather than claiming an abbreviated identity", () => {
  const label = `Scout (${KEY})`;
  const html = renderToStaticMarkup(
    React.createElement(
      MarkdownRuntimeContext.Provider,
      {
        value: { channels: [], mentionPubkeysByName: {} },
      },
      renderCachedMarkdown({
        content: `Ask @${label}`,
        mentionNames: [label],
        components: createMarkdownComponents(false, false),
        variant: "unresolved-compact-mention",
      }),
    ),
  );
  assert.ok(html.includes(`@${label}`));
  assert.doesNotMatch(html, /data-mention=/);
});
