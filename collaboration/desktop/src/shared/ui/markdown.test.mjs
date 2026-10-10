import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { setLocale } from "@client-kit/platform/i18n";
import { createBffClient } from "@client-kit/platform/client";
import { PlatformProvider } from "@client-kit/platform/react/context";

const localeClient = createBffClient({
  async send() {
    assert.fail("Locale rendering must not send BFF requests");
  },
});

function withPlatformLocale(locale, run, deviceLocale = locale) {
  const originals = {
    window: globalThis.window,
    document: globalThis.document,
    Event: globalThis.Event,
  };
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://example.test",
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Event = dom.window.Event;
  try {
    setLocale(deviceLocale);
    return run((node) =>
      renderToStaticMarkup(
        React.createElement(PlatformProvider, { client: localeClient, locale }, node),
      ),
    );
  } finally {
    dom.window.close();
    Object.assign(globalThis, originals);
  }
}

// These are copied here to avoid importing from .ts files that depend on
// React (which isn't resolvable outside the bundler). Same pattern as
// useMediaUpload.test.mjs inlining shortHash.

function shallowArrayEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// Minimal React.isValidElement check — real React checks $$typeof
const REACT_ELEMENT_TYPE =
  Symbol.for("react.transitional.element") ?? Symbol.for("react.element");

function isValidElement(obj) {
  return (
    typeof obj === "object" &&
    obj !== null &&
    obj.$$typeof === REACT_ELEMENT_TYPE
  );
}

function fakeElement(type, props = {}) {
  return { $$typeof: REACT_ELEMENT_TYPE, type, props, key: null };
}

function isBlockMedia(child) {
  return isValidElement(child) && child.props?.["data-block-media"] != null;
}

function classifyChildren(childArray) {
  const imageChildren = childArray.filter(isBlockMedia);
  const nonImageChildren = childArray.filter(
    (child) =>
      !isBlockMedia(child) &&
      !(typeof child === "string" && child.trim() === "") &&
      !(
        isValidElement(child) &&
        (child.type === "br" || child.props?.node?.tagName === "br")
      ),
  );
  return { imageChildren, nonImageChildren };
}

function isImageOnlyParagraph(childArray) {
  const { imageChildren, nonImageChildren } = classifyChildren(childArray);
  return imageChildren.length >= 2 && nonImageChildren.length === 0;
}

function hasBlockMedia(childArray) {
  const { imageChildren, nonImageChildren } = classifyChildren(childArray);
  return imageChildren.length >= 1 && nonImageChildren.length === 0;
}

function isHastElement(node) {
  return node && node.type === "element";
}

function isHastText(node) {
  return node && node.type === "text";
}

function isHastImageOnlyParagraph(node) {
  if (!isHastElement(node) || node.tagName !== "p") return false;
  const meaningful = node.children.filter(
    (child) => !isIgnorableImageSeparator(child),
  );
  return (
    meaningful.length >= 1 &&
    meaningful.every((child) => isHastElement(child) && child.tagName === "img")
  );
}

function isIgnorableImageSeparator(node) {
  return (
    (isHastText(node) && node.value.trim() === "") ||
    (isHastElement(node) && node.tagName === "br")
  );
}

function splitTrailingImageRun(node) {
  if (!isHastElement(node) || node.tagName !== "p") return [node];

  let cursor = node.children.length - 1;
  const trailingImages = [];
  while (cursor >= 0) {
    const child = node.children[cursor];
    if (isHastElement(child) && child.tagName === "img") {
      trailingImages.unshift(child);
      cursor -= 1;
      continue;
    }
    if (isIgnorableImageSeparator(child)) {
      cursor -= 1;
      continue;
    }
    break;
  }

  if (trailingImages.length < 2 || cursor < 0) return [node];
  return [
    { ...node, children: node.children.slice(0, cursor + 1) },
    {
      type: "element",
      tagName: "p",
      properties: {},
      children: trailingImages,
    },
  ];
}

function rehypeImageGallery() {
  return (tree) => {
    const normalizedChildren = tree.children.flatMap(splitTrailingImageRun);
    const newChildren = [];
    let imageRun = [];

    function flushRun() {
      if (imageRun.length <= 1) {
        newChildren.push(...imageRun);
      } else {
        const allImages = [];
        for (const p of imageRun) {
          for (const child of p.children) {
            if (isHastElement(child) && child.tagName === "img") {
              allImages.push(child);
            }
          }
        }
        newChildren.push({
          type: "element",
          tagName: "p",
          properties: {},
          children: allImages,
        });
      }
      imageRun = [];
    }

    for (const child of normalizedChildren) {
      if (isHastImageOnlyParagraph(child)) {
        imageRun.push(child);
        continue;
      }
      flushRun();
      newChildren.push(child);
    }
    flushRun();

    tree.children = newChildren;
  };
}

test("shallowArrayEqual: identical references return true", () => {
  const arr = ["a", "b"];
  assert.equal(shallowArrayEqual(arr, arr), true);
});

test("shallowArrayEqual: equal arrays return true", () => {
  assert.equal(shallowArrayEqual(["a", "b"], ["a", "b"]), true);
});

test("shallowArrayEqual: different values return false", () => {
  assert.equal(shallowArrayEqual(["a", "b"], ["a", "c"]), false);
});

test("shallowArrayEqual: different lengths return false", () => {
  assert.equal(shallowArrayEqual(["a"], ["a", "b"]), false);
});

test("shallowArrayEqual: both undefined return true", () => {
  assert.equal(shallowArrayEqual(undefined, undefined), true);
});

test("shallowArrayEqual: one undefined returns false", () => {
  assert.equal(shallowArrayEqual(["a"], undefined), false);
  assert.equal(shallowArrayEqual(undefined, ["a"]), false);
});

test("shallowArrayEqual: empty arrays return true", () => {
  assert.equal(shallowArrayEqual([], []), true);
});

test("classifyChildren: elements with data-block-media are image children", () => {
  const children = [fakeElement("span", { "data-block-media": "" })];
  const { imageChildren, nonImageChildren } = classifyChildren(children);
  assert.equal(imageChildren.length, 1);
  assert.equal(nonImageChildren.length, 0);
});

test("classifyChildren: React component elements without data-block-media are non-image", () => {
  const LinkComponent = () => null;
  const children = [fakeElement(LinkComponent)];
  const { imageChildren, nonImageChildren } = classifyChildren(children);
  assert.equal(imageChildren.length, 0);
  assert.equal(nonImageChildren.length, 1);
});

test("classifyChildren: plain HTML elements are non-image children", () => {
  const children = [fakeElement("span")];
  const { imageChildren, nonImageChildren } = classifyChildren(children);
  assert.equal(imageChildren.length, 0);
  assert.equal(nonImageChildren.length, 1);
});

test("classifyChildren: text strings are non-image children", () => {
  const children = ["hello world"];
  const { imageChildren, nonImageChildren } = classifyChildren(children);
  assert.equal(imageChildren.length, 0);
  assert.equal(nonImageChildren.length, 1);
});

test("classifyChildren: whitespace-only strings are excluded from both", () => {
  const children = ["  ", "\n"];
  const { imageChildren, nonImageChildren } = classifyChildren(children);
  assert.equal(imageChildren.length, 0);
  assert.equal(nonImageChildren.length, 0);
});

test("classifyChildren: <br> elements are excluded from non-image", () => {
  const children = [fakeElement("br")];
  const { imageChildren, nonImageChildren } = classifyChildren(children);
  assert.equal(imageChildren.length, 0);
  assert.equal(nonImageChildren.length, 0);
});

test("classifyChildren: react-markdown break components are excluded", () => {
  const BreakComponent = () => null;
  const children = [
    fakeElement(BreakComponent, { node: { type: "element", tagName: "br" } }),
  ];
  const { imageChildren, nonImageChildren } = classifyChildren(children);
  assert.equal(imageChildren.length, 0);
  assert.equal(nonImageChildren.length, 0);
});

test("isImageOnlyParagraph: react-markdown breaks preserve image mosaics", () => {
  const BreakComponent = () => null;
  const media = { "data-block-media": "" };
  const customBreak = fakeElement(BreakComponent, {
    node: { type: "element", tagName: "br" },
  });
  const children = [
    fakeElement("span", media),
    customBreak,
    fakeElement("span", media),
    customBreak,
    fakeElement("span", media),
  ];
  assert.equal(isImageOnlyParagraph(children), true);
});

test("classifyChildren: mixed media, text, and br", () => {
  const children = [
    fakeElement("span", { "data-block-media": "" }),
    "some text",
    fakeElement("br"),
    fakeElement("span", { "data-block-media": "" }),
  ];
  const { imageChildren, nonImageChildren } = classifyChildren(children);
  assert.equal(imageChildren.length, 2);
  assert.equal(nonImageChildren.length, 1); // "some text"
});

test("classifyChildren: media with only whitespace and br between them", () => {
  const children = [
    fakeElement("span", { "data-block-media": "" }),
    "  ",
    fakeElement("br"),
    fakeElement("span", { "data-block-media": "" }),
  ];
  const { imageChildren, nonImageChildren } = classifyChildren(children);
  assert.equal(imageChildren.length, 2);
  assert.equal(nonImageChildren.length, 0);
});

test("isImageOnlyParagraph: two media with br returns true", () => {
  const media = { "data-block-media": "" };
  const children = [
    fakeElement("span", media),
    fakeElement("br"),
    fakeElement("span", media),
  ];
  assert.equal(isImageOnlyParagraph(children), true);
});

test("isImageOnlyParagraph: single media returns false (needs 2+)", () => {
  const children = [fakeElement("span", { "data-block-media": "" })];
  assert.equal(isImageOnlyParagraph(children), false);
});

test("isImageOnlyParagraph: media with text returns false", () => {
  const media = { "data-block-media": "" };
  const children = [
    fakeElement("span", media),
    "caption text",
    fakeElement("span", media),
  ];
  assert.equal(isImageOnlyParagraph(children), false);
});

test("isImageOnlyParagraph: no children returns false", () => {
  assert.equal(isImageOnlyParagraph([]), false);
});

test("isImageOnlyParagraph: three media returns true", () => {
  const media = { "data-block-media": "" };
  const children = [
    fakeElement("span", media),
    fakeElement("span", media),
    fakeElement("span", media),
  ];
  assert.equal(isImageOnlyParagraph(children), true);
});

test("isImageOnlyParagraph: plain HTML img tags without data-block-media are non-image", () => {
  const children = [fakeElement("img"), fakeElement("img")];
  assert.equal(isImageOnlyParagraph(children), false);
});

test("isImageOnlyParagraph: non-media component + media is not image-only", () => {
  const LinkComponent = () => null;
  const media = { "data-block-media": "" };
  const children = [
    fakeElement(LinkComponent),
    fakeElement("span", media),
    fakeElement("span", media),
  ];
  assert.equal(isImageOnlyParagraph(children), false);
});

test("hasBlockMedia: single media element returns true", () => {
  assert.equal(
    hasBlockMedia([fakeElement("span", { "data-block-media": "" })]),
    true,
  );
});

test("hasBlockMedia: two media returns true", () => {
  const media = { "data-block-media": "" };
  assert.equal(
    hasBlockMedia([fakeElement("span", media), fakeElement("span", media)]),
    true,
  );
});

test("hasBlockMedia: media with whitespace and br returns true", () => {
  assert.equal(
    hasBlockMedia([
      fakeElement("span", { "data-block-media": "" }),
      "  ",
      fakeElement("br"),
    ]),
    true,
  );
});

test("hasBlockMedia: no children returns false", () => {
  assert.equal(hasBlockMedia([]), false);
});

test("hasBlockMedia: text only returns false", () => {
  assert.equal(hasBlockMedia(["hello"]), false);
});

test("hasBlockMedia: media with text returns false", () => {
  assert.equal(
    hasBlockMedia([fakeElement("span", { "data-block-media": "" }), "caption"]),
    false,
  );
});

test("hasBlockMedia: plain HTML img without data-block-media returns false", () => {
  assert.equal(hasBlockMedia([fakeElement("img")]), false);
});

test("hasBlockMedia: React component without data-block-media returns false", () => {
  const LinkComponent = () => null;
  assert.equal(hasBlockMedia([fakeElement(LinkComponent)]), false);
});

function hastImg(src) {
  return { type: "element", tagName: "img", properties: { src }, children: [] };
}

function hastP(...children) {
  return { type: "element", tagName: "p", properties: {}, children };
}

function hastText(value) {
  return { type: "text", value };
}

test("rehypeImageGallery: merges two consecutive single-image paragraphs", () => {
  const tree = {
    type: "root",
    children: [hastP(hastImg("a.png")), hastP(hastImg("b.png"))],
  };
  rehypeImageGallery()(tree);
  assert.equal(tree.children.length, 1);
  assert.equal(tree.children[0].tagName, "p");
  assert.equal(tree.children[0].children.length, 2);
  assert.equal(tree.children[0].children[0].properties.src, "a.png");
  assert.equal(tree.children[0].children[1].properties.src, "b.png");
});

test("rehypeImageGallery: three consecutive images merge into one paragraph", () => {
  const tree = {
    type: "root",
    children: [
      hastP(hastImg("a.png")),
      hastP(hastImg("b.png")),
      hastP(hastImg("c.png")),
    ],
  };
  rehypeImageGallery()(tree);
  assert.equal(tree.children.length, 1);
  assert.equal(tree.children[0].children.length, 3);
});

test("rehypeImageGallery: single image paragraph is not grouped", () => {
  const tree = {
    type: "root",
    children: [hastP(hastImg("a.png"))],
  };
  rehypeImageGallery()(tree);
  assert.equal(tree.children.length, 1);
  // Still the original single-image paragraph
  assert.equal(tree.children[0].children.length, 1);
});

test("rehypeImageGallery: text paragraph breaks image run", () => {
  const tree = {
    type: "root",
    children: [
      hastP(hastImg("a.png")),
      hastP(hastText("hello")),
      hastP(hastImg("b.png")),
    ],
  };
  rehypeImageGallery()(tree);
  assert.equal(tree.children.length, 3);
  // Each stays separate — text paragraph broke the run
  assert.equal(tree.children[0].children[0].properties.src, "a.png");
  assert.equal(tree.children[1].children[0].value, "hello");
  assert.equal(tree.children[2].children[0].properties.src, "b.png");
});

test("rehypeImageGallery: ignores whitespace and br in image paragraphs", () => {
  const br = { type: "element", tagName: "br", properties: {}, children: [] };
  const tree = {
    type: "root",
    children: [
      hastP(hastImg("a.png"), hastText("  "), br),
      hastP(hastImg("b.png")),
    ],
  };
  rehypeImageGallery()(tree);
  assert.equal(tree.children.length, 1);
  assert.equal(tree.children[0].children.length, 2);
});

test("rehypeImageGallery: mixed content paragraph is not image-only", () => {
  const tree = {
    type: "root",
    children: [
      hastP(hastImg("a.png")),
      hastP(hastText("Look: "), hastImg("b.png")),
      hastP(hastImg("c.png")),
    ],
  };
  rehypeImageGallery()(tree);
  // Middle paragraph has text, so it breaks the run
  assert.equal(tree.children.length, 3);
});

test("rehypeImageGallery: splits composer text from trailing image bundle", () => {
  const br = { type: "element", tagName: "br", properties: {}, children: [] };
  const tree = {
    type: "root",
    children: [
      hastP(
        hastText("gallery bundle"),
        br,
        hastImg("a.png"),
        br,
        hastImg("b.png"),
        br,
        hastImg("c.png"),
      ),
    ],
  };

  rehypeImageGallery()(tree);

  assert.equal(tree.children.length, 2);
  assert.equal(tree.children[0].children[0].value, "gallery bundle");
  assert.deepEqual(
    tree.children[1].children.map((child) => child.properties.src),
    ["a.png", "b.png", "c.png"],
  );
});

test("rehypeImageGallery: leaves a single trailing image in the text flow", () => {
  const br = { type: "element", tagName: "br", properties: {}, children: [] };
  const paragraph = hastP(hastText("caption"), br, hastImg("a.png"));
  const tree = { type: "root", children: [paragraph] };

  rehypeImageGallery()(tree);

  assert.equal(tree.children.length, 1);
  assert.equal(tree.children[0], paragraph);
});

// Regression test: react-markdown's `defaultUrlTransform` strips unknown
// schemes (returns `""`) before our `a` component override can see them,
// which would break copy → paste → click for `buzz://message?…` links and
// `buzz://pr|issue|repo?…` entity links end-to-end. We pass a custom
// `urlTransform` (`buzzDeepLinkUrlTransform`) that preserves valid Buzz
// deep links and delegates everything else to `defaultUrlTransform`.
//
// This test renders real `<ReactMarkdown>` with the production transform
// and asserts the link href survives to the rendered DOM. Mirrors the
// `markdown.tsx` source — keep in sync if either changes.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";

import remarkSpoilers from "../lib/remarkSpoilers.ts";
import { buzzDeepLinkUrlTransform } from "./markdown/utils.ts";

const _OWNER_HEX =
  "71d67180ba17e749ee825fc8819c9c6ee7003617e1c126504f9b658070ab9224";
const EVENT_HEX =
  "c3b589fa5713ba25bad6dc095e2de00a4ac8f50050fdea00fc6444e603be1dd1";

function renderMarkdown(content) {
  return renderToStaticMarkup(
    React.createElement(
      ReactMarkdown,
      { urlTransform: buzzDeepLinkUrlTransform },
      content,
    ),
  );
}

test("messageLinkUrlTransform: preserves buzz://message href", () => {
  const html = renderMarkdown(
    "Click [here](buzz://message?channel=abc&id=xyz)",
  );
  // HTML-encoded `&` in attributes is fine — the browser decodes back to `&`.
  assert.match(html, /href="buzz:\/\/message\?channel=abc&(?:amp;)?id=xyz"/);
});

test("messageLinkUrlTransform: preserves buzz://message autolink href", () => {
  const html = renderMarkdown("<buzz://message?channel=abc&id=xyz>");
  assert.match(html, /href="buzz:\/\/message\?channel=abc&(?:amp;)?id=xyz"/);
});

test("messageLinkUrlTransform: preserves buzz://message href with thread", () => {
  const html = renderMarkdown(
    "[link](buzz://message?channel=c1&id=m1&thread=t1)",
  );
  assert.match(html, /href="buzz:\/\/message\?[^"]*thread=t1"/);
});

test("messageLinkUrlTransform: preserves buzz://channel href", () => {
  const html = renderMarkdown(
    "Click [here](buzz://channel/580ca78b-9dae-46f3-8854-bd671853ba32)",
  );
  assert.match(
    html,
    /href="buzz:\/\/channel\/580ca78b-9dae-46f3-8854-bd671853ba32"/,
  );
});

test("messageLinkUrlTransform: rejects malformed buzz://channel href", () => {
  const html = renderMarkdown(
    "Click [here](buzz://channel/580ca78b-9dae-46f3-8854-bd671853ba32?extra=true)",
  );
  assert.match(html, /href=""/);
});

test("messageLinkUrlTransform: still strips javascript: scheme", () => {
  const html = renderMarkdown("[xss](javascript:alert(1))");
  // defaultUrlTransform replaces unsafe schemes with the empty string.
  assert.match(html, /href=""/);
  assert.doesNotMatch(html, /javascript:/);
});

test("messageLinkUrlTransform: passes http(s) through unchanged", () => {
  const html = renderMarkdown("[ext](https://example.com/path)");
  assert.match(html, /href="https:\/\/example\.com\/path"/);
});

test("messageLinkUrlTransform: preserves legacy buzz://message href", () => {
  const html = renderMarkdown(
    "Click [here](buzz://message?channel=abc&id=xyz)",
  );
  assert.match(html, /href="buzz:\/\/message\?channel=abc&(?:amp;)?id=xyz"/);
});

test("messageLinkUrlTransform: leaves non-entity buzz:// schemes to default", () => {
  // `buzz://connect?relay=…` is handled by a different code path (Tauri
  // single-instance). The markdown renderer should let it pass through
  // defaultUrlTransform (which strips it) since it's not clickable in-app.
  const html = renderMarkdown(
    "[connect](buzz://connect?relay=wss://relay.example)",
  );
  assert.match(html, /href=""/);
});

test("remarkSpoilers: block delimiter spoilers expose a block prop to React", () => {
  let spoilerProps;
  renderToStaticMarkup(
    React.createElement(
      ReactMarkdown,
      {
        components: {
          spoiler: (props) => {
            spoilerProps = props;
            return React.createElement("div", null, props.children);
          },
        },
        remarkPlugins: [remarkSpoilers],
      },
      "||\n\nsecret\n\n||",
    ),
  );

  assert.equal(spoilerProps?.["data-block-spoiler"], "");
});

// `remark-gfm`'s autolinker only covers http(s)://, so bare `buzz://message`
// URLs in plain text never reach any rendering path without this plugin.
// The plugin emits a custom `message-link` HAST element which markdown.tsx
// renders as an inline pill. Tests operate on the mdast tree directly —
// the rendering side is a plain React component covered by app-level use.

import remarkMessageLinks from "../../features/messages/lib/remarkMessageLinks.ts";
import { createMarkdownComponents } from "../ui/markdown.tsx";
import { renderCachedMarkdown } from "../ui/markdown/nodeCache.ts";
import { MarkdownRuntimeContext } from "../ui/markdown/runtimeContext.ts";

function runPlugin(tree) {
  remarkMessageLinks()(tree);
  return tree;
}

function paragraph(...children) {
  return { type: "root", children: [{ type: "paragraph", children }] };
}

function text(value) {
  return { type: "text", value };
}

test("remarkMessageLinks: bare buzz://message URL is replaced", () => {
  const tree = runPlugin(paragraph(text("buzz://message?channel=c&id=m")));
  const para = tree.children[0];
  assert.equal(para.children.length, 1);
  assert.equal(para.children[0].type, "message-link");
  assert.equal(para.children[0].value, "buzz://message?channel=c&id=m");
  assert.equal(para.children[0].data.hName, "message-link");
});

test("remarkMessageLinks: legacy bare buzz://message URL is replaced", () => {
  const tree = runPlugin(paragraph(text("buzz://message?channel=c&id=m")));
  const para = tree.children[0];
  assert.equal(para.children.length, 1);
  assert.equal(para.children[0].type, "message-link");
  assert.equal(para.children[0].value, "buzz://message?channel=c&id=m");
});

test("remarkMessageLinks: mid-sentence URL splits surrounding text", () => {
  const tree = runPlugin(
    paragraph(text("see buzz://message?channel=c&id=m here")),
  );
  const kids = tree.children[0].children;
  assert.equal(kids.length, 3);
  assert.equal(kids[0].type, "text");
  assert.equal(kids[0].value, "see ");
  assert.equal(kids[1].type, "message-link");
  assert.equal(kids[2].type, "text");
  assert.equal(kids[2].value, " here");
});

test("remarkMessageLinks: two URLs in one text node both replaced", () => {
  const tree = runPlugin(
    paragraph(
      text(
        "first buzz://message?channel=a&id=1 then buzz://message?channel=b&id=2 done",
      ),
    ),
  );
  const kids = tree.children[0].children;
  const links = kids.filter((c) => c.type === "message-link");
  assert.equal(links.length, 2);
  assert.equal(links[0].value, "buzz://message?channel=a&id=1");
  assert.equal(links[1].value, "buzz://message?channel=b&id=2");
});

test("remarkMessageLinks: trailing sentence punctuation stays outside URL", () => {
  for (const punctuation of [".", ",", ";", ":", "!", "?"]) {
    const tree = runPlugin(
      paragraph(text(`see buzz://message?channel=c&id=m${punctuation}`)),
    );
    const kids = tree.children[0].children;

    assert.equal(kids.length, 3, punctuation);
    assert.equal(kids[0].value, "see ", punctuation);
    assert.equal(kids[1].type, "message-link", punctuation);
    assert.equal(kids[1].value, "buzz://message?channel=c&id=m", punctuation);
    assert.equal(kids[2].type, "text", punctuation);
    assert.equal(kids[2].value, punctuation, punctuation);
  }
});

test("remarkMessageLinks: URL inside parens keeps closing paren outside", () => {
  const tree = runPlugin(
    paragraph(text("see (buzz://message?channel=c&id=m) for details")),
  );
  const kids = tree.children[0].children;

  assert.equal(kids.length, 3);
  assert.equal(kids[0].value, "see (");
  assert.equal(kids[1].type, "message-link");
  assert.equal(kids[1].value, "buzz://message?channel=c&id=m");
  assert.equal(kids[2].type, "text");
  assert.equal(kids[2].value, ") for details");
});

test("remarkMessageLinks: URL without trailing punctuation matches end-to-end", () => {
  const value = "buzz://message?channel=c&id=m";
  const tree = runPlugin(paragraph(text(value)));
  const kids = tree.children[0].children;

  assert.equal(kids.length, 1);
  assert.equal(kids[0].type, "message-link");
  assert.equal(kids[0].value, value);
});

test("remarkMessageLinks: non-message buzz:// URLs are not matched", () => {
  const original = "buzz://connect?relay=wss://x.example";
  const tree = runPlugin(paragraph(text(original)));
  const kids = tree.children[0].children;
  assert.equal(kids.length, 1);
  assert.equal(kids[0].type, "text");
  assert.equal(kids[0].value, original);
});

test("remarkMessageLinks: text inside inlineCode is left alone", () => {
  // The shared factory's tree walker descends into all non-text nodes; an
  // `inlineCode` node has its URL stored in `value` (not children), so the
  // plugin can't reach it. Guard against a future regression where someone
  // turns `inlineCode` into a children-bearing node.
  const tree = {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [
          { type: "inlineCode", value: "buzz://message?channel=c&id=m" },
        ],
      },
    ],
  };
  runPlugin(tree);
  const kids = tree.children[0].children;
  assert.equal(kids.length, 1);
  assert.equal(kids[0].type, "inlineCode");
  assert.equal(kids[0].value, "buzz://message?channel=c&id=m");
});

// the single production copy of the prose-suppression branch, exported from
// through a minimal stub so a revert that changes its behavior is caught
// at unit-test time.
//
// (The full `Markdown` component cannot be rendered in this environment:
// emoji-mart JSON imports crash the module loader before React runs.)

const _AGENT_PUBKEY =
  "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
const HUMAN_PUBKEY =
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

function _nudgeBody(agentPubkey) {
  return [
    "**Fizz** needs configuration before it can respond:",
    "- set `ANTHROPIC_API_KEY` in Edit Agent → Environment variables",
    "",
    "Open Edit Agent in the Buzz app to set these.",
    "",
    "```buzz:config-nudge",
    JSON.stringify({
      agent_name: "Fizz",
      agent_pubkey: agentPubkey,
      requirements: [{ surface: "env_key", key: "ANTHROPIC_API_KEY" }],
    }),
    "```",
  ].join("\n");
}

// Minimal wrapper that calls the real production functions from
// any Tauri or context dependencies.
test("inline message chips omit fetched metadata and the event hash", () => {
  const channelId = "580ca78b-9dae-46f3-8854-bd671853ba32";
  const markdown = renderCachedMarkdown({
    components: createMarkdownComponents(true, false),
    content: `buzz://message?channel=${channelId}&id=${EVENT_HEX}`,
    variant: "inline-message-chip-metadata-test",
  });
  // A readable channel is the case that used to swap the chip label from the
  // truncated event hash to the fetched snippet once metadata resolved.
  const html = renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      React.createElement(
        MarkdownRuntimeContext.Provider,
        {
          value: {
            channels: [
              {
                id: channelId,
                isMember: true,
                name: "engineering",
                visibility: "open",
              },
            ],
            onOpenChannel: () => {},
            onOpenEntityLink: () => {},
            onOpenMessageLink: () => {},
            relayOrigin: null,
          },
        },
        markdown,
      ),
    ),
  );

  const visibleText = html.replace(/<[^>]+>/g, "");
  assert.equal((html.match(/data-message-link=""/g) ?? []).length, 1);
  assert.equal(visibleText.trim(), "engineering");
  assert.doesNotMatch(visibleText, /c3b589fa/);
  assert.doesNotMatch(visibleText, /·/);
});

for (const locale of ["zh-CN", "en"]) {
  test(`authored Buzz permalink labels remain ordinary links (${locale})`, () =>
    withPlatformLocale(locale, (renderWithLocale) => {
      const channelId = "580ca78b-9dae-46f3-8854-bd671853ba32";
      const links = [
        `[the message](buzz://message?channel=${channelId}&id=${EVENT_HEX})`,
        `[the compatibility message](buzz://channel/${channelId}/${EVENT_HEX})`,
        `[**design discussion**](buzz://channel/${channelId})`,
      ];
      const markdown = renderCachedMarkdown({
        components: createMarkdownComponents(true, false),
        content: links.join(" "),
        variant: `authored-buzz-link-integration-test-${locale}`,
      });
      const html = renderWithLocale(
        React.createElement(
          QueryClientProvider,
          { client: new QueryClient() },
          React.createElement(
            MarkdownRuntimeContext.Provider,
            {
              value: {
                channels: [{ id: channelId, name: "engineering" }],
                onOpenChannel: () => {},
                onOpenEntityLink: () => {},
                onOpenMessageLink: () => {},
                relayOrigin: null,
              },
            },
            markdown,
          ),
        ),
      );

      assert.equal((html.match(/data-buzz-link=""/g) ?? []).length, 0);
      assert.match(html, />the message</);
      assert.match(html, />the compatibility message</);
      assert.match(
        html,
        locale === "en"
          ? /aria-label="Open message: the compatibility message"/
          : /aria-label="打开消息：the compatibility message"/,
      );
      assert.match(html, />design discussion</);
      assert.match(
        html,
        locale === "en"
          ? /aria-label="Open channel: design discussion"/
          : /aria-label="打开频道：design discussion"/,
      );
      assert.doesNotMatch(html, /\[object Object\]/);
      assert.equal((html.match(/underline-offset-4/g) ?? []).length, 3);
    }, locale === "en" ? "zh-CN" : "en"));

  test(`generic audio attachments render outside paragraph markup (${locale})`, () =>
    withPlatformLocale(locale, (renderWithLocale) => {
      const href = "https://relay.example/media/meeting.mp3";
      const markdown = renderCachedMarkdown({
        components: createMarkdownComponents(true, false),
        content: `[meeting.mp3](${href})`,
        variant: `generic-audio-block-integration-test-${locale}`,
      });
      const html = renderWithLocale(
        React.createElement(
          MarkdownRuntimeContext.Provider,
          {
            value: {
              channels: [],
              imetaByUrl: new Map([
                [
                  href,
                  {
                    duration: 42,
                    filename: "meeting.mp3",
                    m: "audio/mpeg",
                  },
                ],
              ]),
              onOpenChannel: () => {},
              onOpenEntityLink: () => {},
              onOpenMessageLink: () => {},
              relayOrigin: "https://relay.example",
            },
          },
          markdown,
        ),
      );

      assert.match(html, /data-testid="audio-message-attachment"/);
      assert.match(
        html,
        locale === "en"
          ? /aria-label="Download meeting.mp3"/
          : /aria-label="下载meeting.mp3"/,
      );
      assert.doesNotMatch(html, /<p[^>]*>\s*<div/);
    }));
}

test("Native markdown keeps the original image trigger through the shared viewer and native media actions", () => {
  const href = "https://relay.example/media/poster.png";
  const markdown = renderCachedMarkdown({
    components: createMarkdownComponents(true, false),
    content: `![poster](${href})\n![second](${href})\n![third](${href})`,
    variant: "shared-native-image-lightbox-consumer",
  });
  const html = renderToStaticMarkup(
    React.createElement(
      MarkdownRuntimeContext.Provider,
      {
        value: {
          channels: [],
          imetaByUrl: new Map([[href, { m: "image/png", dim: "1080x1920" }]]),
          onOpenChannel() {},
          onOpenEntityLink() {},
          onOpenMessageLink() {},
          relayOrigin: "https://relay.example",
        },
      },
      markdown,
    ),
  );
  assert.match(html, /data-testid="message-image-lightbox-trigger"/);
  assert.match(html, /data-image-lightbox-trigger=""/);
  assert.match(html, /data-progressive-image-frame=""/);
  assert.match(html, /rounded-2xl/);
  assert.match(html, /width:144px/);
  assert.match(html, /aria-label="缩放图片：poster"/);
  assert.match(
    html,
    /data-image-lightbox-src="https:\/\/relay.example\/media\/poster.png"/,
  );
  assert.doesNotMatch(html, /\/api\/v1\//);
  assert.match(html, /data-image-mosaic-count="3"/);
  assert.match(html, /h-80 grid-rows-2/);
  assert.match(html, /data-block-media=""/);
});

test("bare Buzz permalinks shorten unavailable channel identifiers", () => {
  const channelId = "580ca78b-9dae-46f3-8854-bd671853ba32";
  const markdown = renderCachedMarkdown({
    components: createMarkdownComponents(true, false),
    content: [
      `buzz://message?channel=${channelId}&id=${EVENT_HEX}`,
      `buzz://channel/${channelId}`,
    ].join(" "),
    variant: "unknown-channel-buzz-link-integration-test",
  });
  const html = renderToStaticMarkup(
    React.createElement(
      MarkdownRuntimeContext.Provider,
      {
        value: {
          channels: [],
          onOpenChannel: () => {},
          onOpenEntityLink: () => {},
          onOpenMessageLink: () => {},
          relayOrigin: null,
        },
      },
      markdown,
    ),
  );

  assert.equal(
    (html.match(/inline-chip-leading-fragment[^>]*>580ca<\/span>78b/g) ?? [])
      .length,
    2,
  );
  assert.doesNotMatch(html, /#channel/);
});

test("channel references replace the authored hash with the channel icon", () => {
  const channelId = "580ca78b-9dae-46f3-8854-bd671853ba32";
  const markdown = renderCachedMarkdown({
    channelNames: ["engineering"],
    components: createMarkdownComponents(true, false),
    content: "See #engineering",
    variant: "channel-reference-icon-integration-test",
  });
  const html = renderToStaticMarkup(
    React.createElement(
      MarkdownRuntimeContext.Provider,
      {
        value: {
          channels: [{ id: channelId, name: "engineering" }],
          onOpenChannel: () => {},
          onOpenEntityLink: () => {},
          onOpenMessageLink: () => {},
          relayOrigin: null,
        },
      },
      markdown,
    ),
  );

  assert.match(html, /inline-chip-icon-channel/);
  assert.match(html, /wrapping-inline-chip/);
  assert.match(html, /inline-chip-leading-fragment[^>]*>engin</);
  assert.match(html.replace(/<[^>]+>/g, ""), /engineering/);
  assert.doesNotMatch(html, />#engineering</);
});

test("resolved human mentions replace the authored at-sign with the shared icon", () => {
  const markdown = renderCachedMarkdown({
    components: createMarkdownComponents(false, false),
    content: "Ask @alice",
    mentionNames: ["alice"],
    variant: "human-mention-icon-integration-test",
  });
  const html = renderToStaticMarkup(
    React.createElement(
      MarkdownRuntimeContext.Provider,
      {
        value: {
          channels: [],
          mentionPubkeysByName: { alice: HUMAN_PUBKEY },
          onOpenChannel: () => {},
          onOpenEntityLink: () => {},
          onOpenMessageLink: () => {},
          relayOrigin: null,
        },
      },
      markdown,
    ),
  );

  assert.match(html, /data-mention=""/);
  assert.match(html, /wrapping-inline-chip/);
  assert.match(
    html,
    /inline-chip-leading-fragment[^>]*inline-chip-icon-human[^>]*>alice<\/span>/,
  );
  assert.match(html, /aria-label="alice"/);
  assert.doesNotMatch(html, /aria-hidden="true"[^>]*>alice</);
  assert.match(html, />alice</);
  assert.doesNotMatch(html, />@alice</);
});

test("ambiguous longer aliases stay literal rather than rendering a shorter tagged chip", async () => {
  const { resolveMentionProps } = await import("../lib/resolveMentionNames.ts");
  const a = "a".repeat(64),
    b = "b".repeat(64),
    c = "c".repeat(64);
  for (const includeShorter of [false, true]) {
    const content = `@Scout Jones hello${includeShorter ? " @Scout!" : ""}`;
    const props = resolveMentionProps(
      [
        ["p", a],
        ["p", b],
        ["p", c],
      ],
      {
        [a]: { displayName: "Scout" },
        [b]: { displayName: "Scout Jones" },
        [c]: { displayName: "Scout Jones" },
      },
      content,
    );
    const markdown = renderCachedMarkdown({
      components: createMarkdownComponents(false, false),
      content,
      mentionNames: props.mentionNames,
      variant: "ambiguous-prefix-test",
    });
    const html = renderToStaticMarkup(
      React.createElement(
        MarkdownRuntimeContext.Provider,
        {
          value: {
            channels: [],
            mentionPubkeysByName: props.mentionPubkeysByName,
            onOpenChannel() {},
            onOpenEntityLink() {},
            onOpenMessageLink() {},
            relayOrigin: null,
          },
        },
        markdown,
      ),
    );
    assert.match(html, /@Scout Jones hello/);
    assert.equal(
      (html.match(/data-mention=""/g) ?? []).length,
      includeShorter ? 1 : 0,
    );
  }
});
