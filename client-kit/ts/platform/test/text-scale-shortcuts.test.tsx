import { StrictMode, act, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTextScaleShortcuts } from "../src/react/use-text-scale-shortcuts";
import { render } from "./render";

function Host() { useTextScaleShortcuts(); return null; }
async function press(input: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { cancelable: true, ...input });
  await act(async () => window.dispatchEvent(event));
  return event;
}
beforeEach(() => {
  localStorage.removeItem("buzz:text-scale");
  document.documentElement.style.fontSize = "";
});
afterEach(() => vi.restoreAllMocks());

it.each(["MacIntel", "Win32", "Linux x86_64"])("restores original %s zoom, reset and single StrictMode handler", async (platform) => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
  const modifier = platform === "MacIntel" ? { metaKey: true } : { ctrlKey: true };
  await render(<StrictMode><Host /></StrictMode>);
  expect((await press({ key: "+", ...modifier })).defaultPrevented).toBe(true);
  expect(document.documentElement.style.fontSize).toBe("17.6px");
  expect(localStorage.getItem("buzz:text-scale")).toBe("1.1");
  await press({ key: "-", ...modifier });
  expect(document.documentElement.style.fontSize).toBe("");
  expect(localStorage.getItem("buzz:text-scale")).toBeNull();
  await press({ code: "NumpadAdd", ...modifier });
  await press({ key: "0", ...modifier });
  expect(document.documentElement.style.fontSize).toBe("");
  expect(localStorage.getItem("buzz:text-scale")).toBeNull();
});

it.each([["5", "24px"], ["0.1", "12px"], ["invalid", ""], ["1.2", "19.2px"]])("normalizes the original stored scale %s without touching font-size preference", async (stored, expected) => {
  localStorage.setItem("buzz:text-scale", stored);
  localStorage.setItem("buzz.appearance.fontSize", "larger");
  await render(<Host />);
  expect(document.documentElement.style.fontSize).toBe(expected);
  expect(localStorage.getItem("buzz.appearance.fontSize")).toBe("larger");
});

it("keeps original bounds and excludes unrelated keys/modifiers", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  await render(<Host />);
  for (let count = 0; count < 12; count++) await press({ key: "+", ctrlKey: true });
  expect(document.documentElement.style.fontSize).toBe("24px");
  for (let count = 0; count < 12; count++) await press({ key: "-", ctrlKey: true });
  expect(document.documentElement.style.fontSize).toBe("12px");
  for (const input of [
    { key: "+" }, { key: "+", metaKey: true },
    { key: "+", ctrlKey: true, altKey: true },
    { key: "+", ctrlKey: true, metaKey: true },
    { key: "-", ctrlKey: true, shiftKey: true },
    { key: "a", ctrlKey: true },
  ]) expect((await press(input)).defaultPrevented).toBe(false);
  expect(document.documentElement.style.fontSize).toBe("12px");
});

it("consumes storage changes and removes both listeners on unmount", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  let changeVisibility: (visible: boolean) => void;
  function Shell() {
    const [visible, setVisible] = useState(true);
    changeVisibility = setVisible;
    return visible ? <Host /> : null;
  }
  await render(<Shell />);
  localStorage.setItem("buzz:text-scale", "1.3");
  await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: "buzz:text-scale" })));
  expect(document.documentElement.style.fontSize).toBe("20.8px");
  await press({ key: "-", ctrlKey: true });
  expect(document.documentElement.style.fontSize).toBe("19.2px");
  await act(async () => changeVisibility(false));
  expect((await press({ key: "+", ctrlKey: true })).defaultPrevented).toBe(false);
  localStorage.removeItem("buzz:text-scale");
  await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: null })));
  expect(document.documentElement.style.fontSize).toBe("19.2px");
});
