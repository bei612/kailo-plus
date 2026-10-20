import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});
const originalConsoleError = console.error;

before(() => {
  Object.assign(globalThis, {
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    window: dom.window,
  });
  dom.window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
});

afterEach(async () => {
  const { cleanup } = await import("@testing-library/react");
  cleanup();
  console.error = originalConsoleError;
});

after(() => dom.window.close());

test("ThemeProvider renders defaults when localStorage reads are denied", async () => {
  const deniedStorage = {
    getItem() {
      throw new dom.window.DOMException("private diagnostic", "SecurityError");
    },
    setItem() {
      throw new dom.window.DOMException("private diagnostic", "SecurityError");
    },
    removeItem() {
      throw new dom.window.DOMException("private diagnostic", "SecurityError");
    },
  };
  Object.defineProperty(dom.window, "localStorage", {
    configurable: true,
    value: deniedStorage,
  });

  const { createElement } = await import("react");
  const { render, screen } = await import("@testing-library/react");
  const { ThemeProvider } = await import("@/shared/theme/ThemeProvider");

  render(
    createElement(
      ThemeProvider,
      { defaultTheme: "buzz" },
      createElement("p", null, "Buzz is visible"),
    ),
  );

  assert.ok(screen.getByText("Buzz is visible"));
});

test("root boundary shows recovery UI without exposing error details", async () => {
  const diagnostic = "/Users/alice/private/session-token";
  console.error = () => {};

  const { createElement } = await import("react");
  const { render, screen } = await import("@testing-library/react");
  // The Desktop host mounts the shared boundary (same body as the Web host).
  const { RootErrorBoundary } = await import(
    "@client-kit/platform/react/root-error-boundary"
  );
  const { translateCurrent } = await import("@client-kit/platform/i18n");
  function ThrowingProvider() {
    throw new Error(diagnostic);
  }

  render(
    createElement(RootErrorBoundary, null, createElement(ThrowingProvider)),
  );

  // Storage is denied above, so the copy falls back to the default locale.
  assert.ok(screen.getByTestId("root-error-boundary"));
  assert.ok(screen.getByText(translateCurrent("platform.rootError.title")));
  assert.ok(
    screen.getByText(translateCurrent("platform.rootError.description")),
  );
  assert.ok(
    screen.getByRole("button", {
      name: translateCurrent("platform.rootError.reload"),
    }),
  );
  assert.equal(document.body.textContent.includes(diagnostic), false);
});

test("Desktop entry mounts the shared root boundary, not a host copy", async () => {
  const { existsSync, readFileSync } = await import("node:fs");
  const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
  assert.match(
    main,
    /import \{ RootErrorBoundary \} from "@client-kit\/platform\/react\/root-error-boundary";/,
  );
  assert.equal(
    existsSync(new URL("./RootErrorBoundary.tsx", import.meta.url)),
    false,
  );
});
