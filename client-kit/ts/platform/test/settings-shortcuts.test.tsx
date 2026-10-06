import { StrictMode, act, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useSettingsShortcuts } from "../src/react/use-settings-shortcuts";
import { render } from "./render";

afterEach(() => vi.restoreAllMocks());

async function press(init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { key: ",", cancelable: true, ...init });
  await act(async () => { window.dispatchEvent(event); });
  return event;
}

it.each(["MacIntel", "Win32", "Linux x86_64"])("retains original %s modifier and toggles once in StrictMode", async (platform) => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
  function Host() {
    const [open, setOpen] = useState(false);
    useSettingsShortcuts({ open, onOpenSettings: () => setOpen(true), onClose: () => setOpen(false) });
    return <span>{String(open)}</span>;
  }
  const host = await render(<StrictMode><Host /></StrictMode>);
  const modifier = platform === "MacIntel" ? { metaKey: true } : { ctrlKey: true };
  expect((await press(modifier)).defaultPrevented).toBe(true);
  expect(host.textContent).toBe("true");
  await press({ ...modifier, key: "<", code: "Comma" });
  expect(host.textContent).toBe("false");
});

it.each([
  { metaKey: true },
  { ctrlKey: true, metaKey: true },
  { ctrlKey: true, altKey: true },
  { ctrlKey: true, shiftKey: true },
  { ctrlKey: true, key: "a" },
  {},
])("leaves unrelated keyboard input unchanged: %j", async (input) => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  const open = vi.fn();
  function Host() {
    useSettingsShortcuts({ open: false, onOpenSettings: open, onClose: vi.fn() });
    return null;
  }
  await render(<Host />);
  expect((await press(input)).defaultPrevented).toBe(false);
  expect(open).not.toHaveBeenCalled();
});

it("removes its listener when the host is disabled or unmounted", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  const open = vi.fn();
  let enable: (next: boolean) => void;
  function Host() {
    const [enabled, setEnabled] = useState(true);
    enable = setEnabled;
    useSettingsShortcuts({ open: enabled ? false : undefined, onOpenSettings: open, onClose: vi.fn() });
    return null;
  }
  await render(<Host />);
  await act(async () => enable(false));
  expect((await press({ metaKey: true })).defaultPrevented).toBe(false);
  expect(open).not.toHaveBeenCalled();
});
