import assert from "node:assert/strict";
import test from "node:test";

import {
  gifAttachment,
  isRegisteredGifOrigin,
  klipyCustomerId,
  klipyGifFilename,
  normalizeRelayGifs,
} from "./api.ts";
import { buildOutgoingMessage } from "../messages/lib/imetaMediaMarkdown.ts";

const ORIGINS = ["https://static.klipy.com"];

function asset(url, width = 200, height = 100, size = 1234) {
  return { url, width, height, size };
}

function page(items) {
  return { result: true, data: { data: items } };
}

function klipyItem(overrides = {}) {
  return {
    id: 1,
    slug: "happy-cat",
    title: "  Happy cat  ",
    type: "gif",
    file: {
      md: { gif: asset("https://static.klipy.com/md.gif", 400, 300, 9000) },
      sm: {
        webp: asset("https://static.klipy.com/sm.webp", 200, 150, 800),
        jpg: asset("https://static.klipy.com/sm.jpg", 200, 150, 500),
      },
    },
    ...overrides,
  };
}

test("normalizeRelayGifs keeps the original asset preference", () => {
  assert.deepEqual(normalizeRelayGifs(page([klipyItem()]), ORIGINS), [{
    slug: "happy-cat",
    title: "Happy cat",
    url: "https://static.klipy.com/md.gif",
    width: 400,
    height: 300,
    size: 9000,
    previewUrl: "https://static.klipy.com/sm.webp",
    previewWidth: 200,
    previewHeight: 150,
    posterUrl: "https://static.klipy.com/sm.jpg",
  }]);
});

test("normalizeRelayGifs falls back to hd/sm/xs originals and the original as preview", () => {
  const [gif] = normalizeRelayGifs(page([klipyItem({
    title: "",
    file: { xs: { gif: asset("https://static.klipy.com/xs.gif", 50, 40, 70) } },
  })]), ORIGINS);
  assert.equal(gif.url, "https://static.klipy.com/xs.gif");
  assert.equal(gif.previewUrl, "https://static.klipy.com/xs.gif");
  assert.equal(gif.title, "GIF");
  assert.equal("posterUrl" in gif, false);
});

test("normalizeRelayGifs skips non-gif, slug-less, file-less and incomplete items", () => {
  const items = [
    klipyItem({ type: "ad" }),
    klipyItem({ slug: "" }),
    klipyItem({ file: undefined }),
    klipyItem({ file: { md: { gif: { url: "https://static.klipy.com/md.gif", width: 1, height: 1 } } } }),
  ];
  assert.deepEqual(normalizeRelayGifs(page(items), ORIGINS), []);
});

test("normalizeRelayGifs drops results outside the registered origins", () => {
  const foreignOriginal = klipyItem({
    file: { md: { gif: asset("https://evil.example/md.gif") }, sm: { webp: asset("https://static.klipy.com/sm.webp") } },
  });
  const foreignPreview = klipyItem({
    file: { md: { gif: asset("https://static.klipy.com/md.gif") }, sm: { webp: asset("https://evil.example/sm.webp") } },
  });
  const httpOriginal = klipyItem({ file: { md: { gif: asset("http://static.klipy.com/md.gif") } } });
  assert.deepEqual(normalizeRelayGifs(page([foreignOriginal, foreignPreview, httpOriginal]), ORIGINS), []);
  assert.deepEqual(normalizeRelayGifs(page([klipyItem()]), []), []);
});

test("normalizeRelayGifs removes an unregistered poster but keeps the GIF", () => {
  const [gif] = normalizeRelayGifs(page([klipyItem({
    file: {
      md: { gif: asset("https://static.klipy.com/md.gif") },
      sm: { jpg: asset("https://evil.example/sm.jpg") },
    },
  })]), ORIGINS);
  assert.equal(gif.url, "https://static.klipy.com/md.gif");
  assert.equal("posterUrl" in gif, false);
});

test("normalizeRelayGifs tolerates a malformed page", () => {
  assert.deepEqual(normalizeRelayGifs(undefined, ORIGINS), []);
  assert.deepEqual(normalizeRelayGifs({ result: true }, ORIGINS), []);
  assert.deepEqual(normalizeRelayGifs({ data: { data: "x" } }, ORIGINS), []);
});

test("isRegisteredGifOrigin requires https, no credentials and a registered origin", () => {
  assert.equal(isRegisteredGifOrigin("https://static.klipy.com/a.gif", ORIGINS), true);
  assert.equal(isRegisteredGifOrigin("https://user:pw@static.klipy.com/a.gif", ORIGINS), false);
  assert.equal(isRegisteredGifOrigin("https://static.klipy.com:8443/a.gif", ORIGINS), false);
  assert.equal(isRegisteredGifOrigin("not a url", ORIGINS), false);
});

test("a chosen GIF is a body line without imeta", () => {
  const [gif] = normalizeRelayGifs(page([klipyItem()]), ORIGINS);
  const attachment = gifAttachment(gif);
  assert.equal(attachment.sha256, "");
  assert.equal(attachment.filename, "happy-cat.gif");
  assert.equal(attachment.dim, "400x300");
  assert.deepEqual(buildOutgoingMessage("hi", [attachment]), {
    content: "hi\n![image](https://static.klipy.com/md.gif)",
    mediaTags: undefined,
  });
});

test("klipyGifFilename follows the original slug sanitizer", () => {
  assert.equal(klipyGifFilename("Happy Cat!!"), "happy-cat.gif");
  assert.equal(klipyGifFilename("***"), "klipy-gif.gif");
});

test("klipyCustomerId is a stored random UUID per relay", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
  const first = klipyCustomerId("wss://a.example", storage);
  assert.match(first, /^[0-9a-f-]{36}$/);
  assert.equal(klipyCustomerId("wss://a.example", storage), first);
  assert.notEqual(klipyCustomerId("wss://b.example", storage), first);
  assert.equal(values.get("buzz:klipy-customer-id:v1:wss://a.example"), first);
  const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => {} };
  assert.match(klipyCustomerId("wss://a.example", broken), /^[0-9a-f-]{36}$/);
});
