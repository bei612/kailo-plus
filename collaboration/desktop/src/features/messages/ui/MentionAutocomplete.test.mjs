import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});

before(() => {
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  Object.assign(globalThis, {
    CustomEvent: dom.window.CustomEvent,
    document: dom.window.document,
    Element: dom.window.Element,
    Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    Node: dom.window.Node,
    ResizeObserver: class {
      disconnect() {}
      observe() {}
      unobserve() {}
    },
    window: dom.window,
  });
});
before(async () => {
  const {setLocale} = await import("@client-kit/platform/i18n");
  setLocale("en");
});

afterEach(async () => {
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});

after(() => dom.window.close());

test("clicking outside dismisses the tray without intercepting its trigger", async () => {
  const React = await import("react");
  const { fireEvent, render } = await import("@testing-library/react");
  const { MentionAutocomplete } = await import("./MentionAutocomplete.tsx");
  const suggestion = { pubkey: "ada-pubkey", displayName: "Ada" };
  let dismissCount = 0;
  const view = render(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(
        "form",
        null,
        React.createElement(
          "button",
          { "data-mention-picker-trigger": "", type: "button" },
          "@",
        ),
        React.createElement(MentionAutocomplete, {
          suggestions: [suggestion],
          selectedIndex: 0,
          onDismiss: () => {
            dismissCount += 1;
          },
          onSelect: () => {},
        }),
      ),
      React.createElement("button", { type: "button" }, "Outside"),
      React.createElement(
        "form",
        null,
        React.createElement(
          "button",
          { "data-mention-picker-trigger": "", type: "button" },
          "Other @",
        ),
      ),
    ),
  );

  fireEvent.pointerDown(view.getByRole("button", { name: "Mention Ada" }));
  assert.equal(dismissCount, 0);

  fireEvent.pointerDown(view.getByRole("button", { name: "@" }));
  assert.equal(dismissCount, 0);

  fireEvent.pointerDown(view.getByTestId("mention-autocomplete-layer"));
  assert.equal(dismissCount, 1);

  fireEvent.pointerDown(view.getByRole("button", { name: "Outside" }));
  assert.equal(dismissCount, 2);

  fireEvent.pointerDown(view.getByRole("button", { name: "Other @" }));
  assert.equal(dismissCount, 3);
});

test("collision npubs sit inline with role metadata", async () => {
  const React = await import("react");
  const { render } = await import("@testing-library/react");
  const { MentionAutocomplete } = await import("./MentionAutocomplete.tsx");
  const suggestions = [
    { pubkey: "a".repeat(64), displayName: "Same Name", role: "admin" },
    { pubkey: "b".repeat(64), displayName: "Same Name", role: "admin" },
  ];
  const view = render(
    React.createElement(MentionAutocomplete, {
      suggestions,
      selectedIndex: 0,
      onSelect: () => {},
    }),
  );

  const collisionNpubs = view.getAllByTestId("mention-collision-npub");
  assert.equal(collisionNpubs.length, 2);
  for (const npub of collisionNpubs) {
    const metadata = npub.parentElement;
    assert.match(metadata?.textContent ?? "", /adminnpub1/);
    assert.match(npub.className, /(?:^|\s)-translate-y-0\.5(?:\s|$)/);
    assert.match(metadata?.className ?? "", /(?:^|\s)min-h-3\.5(?:\s|$)/);
  }
});

test("does not intercept Tab from the editor", async () => {
  const React = await import("react");
  const { fireEvent, render } = await import("@testing-library/react");
  const { MentionAutocomplete } = await import("./MentionAutocomplete.tsx");
  const suggestions = [
    { pubkey: "ada", displayName: "Ada" },
    { pubkey: "bea", displayName: "Bea" },
  ];
  const view = render(
    React.createElement(
      "form",
      null,
      React.createElement("input", { "aria-label": "Message" }),
      React.createElement(MentionAutocomplete, {
        suggestions,
        selectedIndex: 1,
        onSelect: () => {},
      }),
    ),
  );

  const input = view.getByRole("textbox", { name: "Message" });
  input.focus();
  const wasNotCancelled = fireEvent.keyDown(input, { key: "Tab" });

  assert.equal(wasNotCancelled, true);
  assert.equal(document.activeElement, input);
});

test("restores original Agent row, pin toggle and Options without inventing management provenance", async () => {
  const React = await import("react");
  const {act, fireEvent, render} = await import("@testing-library/react");
  const {TooltipProvider} = await import("@client-kit/platform/react/sidebar/tooltip");
  const {MentionAutocomplete} = await import("./MentionAutocomplete.tsx");
  const agent = {pubkey:"b".repeat(64),displayName:"Planner",isAgent:true};
  const toggles = [], selections = [], preferences = [];
  const view = render(React.createElement(TooltipProvider,null,React.createElement(MentionAutocomplete,{
    suggestions:[agent],selectedIndex:0,composerOwnsFocus:true,onSelect:value=>selections.push(value),
    lockedAgentPubkeys:new Set(),onToggleAlwaysAddressAgent:value=>toggles.push(value),
    keepMentionedAgentsPinned:false,onKeepMentionedAgentsPinnedChange:value=>preferences.push(value),
  })));
  assert.equal(view.getAllByTestId("mention-agent-icon").length,1);
  assert.equal(view.queryByText(/Managed by/),null);
  fireEvent.mouseDown(view.getByRole("button",{name:"Mention Planner"}));
  assert.deepEqual(selections,[agent]);
  fireEvent.click(view.getByTestId(`mention-always-address-${agent.pubkey}`));
  assert.deepEqual(toggles,[agent]);
  fireEvent.click(view.getByTestId("mention-keep-agents-pinned-toggle"));
  assert.deepEqual(preferences,[true]);
  assert.match(view.getByTestId("mention-options-settings").className,/w-80 max-w-full/);
  const {setLocale} = await import("@client-kit/platform/i18n");
  await act(async () => setLocale("zh-CN"));
  assert.ok(view.getByRole("button",{name:"提及 Planner"}));
  assert.ok(view.getByText("自动提及 Agent"));
  await act(async () => setLocale("en"));
});
