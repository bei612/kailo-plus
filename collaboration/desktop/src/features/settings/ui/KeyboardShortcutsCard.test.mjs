import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KEYBOARD_SHORTCUTS } from "@/shared/lib/keyboard-shortcuts";
import { KeyboardShortcutsCard } from "./KeyboardShortcutsCard";

for (const platform of ["Win32", "MacIntel"]) {
  test(`shared shortcuts retain every registered Desktop command on ${platform}`, () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true, value: { platform, languages: ["zh-CN"] },
    });
    try {
      const markup = renderToStaticMarkup(createElement(KeyboardShortcutsCard));
      assert.equal((markup.match(/data-shortcut=/g) ?? []).length, KEYBOARD_SHORTCUTS.length);
      for (const command of KEYBOARD_SHORTCUTS) {
        assert.ok(markup.includes(`aria-label="${platform === "Win32" ? command.keysWindows : command.keys}"`));
      }
      assert.ok(markup.includes("快捷键"));
      assert.ok(markup.includes("粗体"));
      assert.ok(!markup.includes("Open the search dialog"));
    } finally {
      if (original) Object.defineProperty(globalThis, "navigator", original);
      else delete globalThis.navigator;
    }
  });
}
