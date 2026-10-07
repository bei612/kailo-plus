import { StrictMode, act, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useHistoryShortcuts, useHomeShortcut } from "../src/react/use-navigation-shortcuts";
import { render } from "./render";

afterEach(() => vi.restoreAllMocks());

async function press(target: EventTarget, init: KeyboardEventInit, prevented = false) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  if (prevented) event.preventDefault();
  await act(async () => { target.dispatchEvent(event); });
  return event;
}

it.each(["MacIntel", "Win32", "Linux x86_64"])("keeps original Home and history chords in an editable composer on %s", async (platform) => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
  const home = vi.fn(), back = vi.fn(), forward = vi.fn();
  function Host() {
    useHomeShortcut({ disabled: false, onGoHome: home });
    useHistoryShortcuts({ goBack: back, goForward: forward });
    return <textarea />;
  }
  const host = await render(<StrictMode><Host /></StrictMode>);
  const field = host.querySelector("textarea")!;
  const mac = platform === "MacIntel";
  expect((await press(field, { key: "A", shiftKey: true, metaKey: mac, ctrlKey: !mac })).defaultPrevented).toBe(true);
  expect((await press(field, mac ? { key: "Dead", code: "BracketLeft", metaKey: true } : { key: "ArrowLeft", altKey: true })).defaultPrevented).toBe(true);
  expect((await press(field, mac ? { key: "]", metaKey: true } : { key: "ArrowRight", altKey: true })).defaultPrevented).toBe(true);
  expect(home).toHaveBeenCalledOnce();
  expect(back).toHaveBeenCalledOnce();
  expect(forward).toHaveBeenCalledOnce();
  // Ordinary select-all and line-start/line-end retain native text semantics.
  expect((await press(field, { key: "a", metaKey: mac, ctrlKey: !mac })).defaultPrevented).toBe(false);
  expect((await press(field, { key: "ArrowLeft", metaKey: true })).defaultPrevented).toBe(false);
  expect((await press(field, { key: "ArrowRight", metaKey: true })).defaultPrevented).toBe(false);
});

it("Home yields to foreground handlers, composition chords and repeated keys, and stops when settings are open", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  const home = vi.fn();
  let disable!: () => void;
  function Host() {
    const [disabled, setDisabled] = useState(false);
    disable = () => setDisabled(true);
    useHomeShortcut({ disabled, onGoHome: home });
    return null;
  }
  await render(<Host />);
  const chord = { key: "a", ctrlKey: true, shiftKey: true };
  await press(window, chord, true);
  for (const extra of [{ repeat: true }, { altKey: true }, { metaKey: true }]) {
    expect((await press(window, { ...chord, ...extra })).defaultPrevented).toBe(false);
  }
  await act(async () => disable());
  expect((await press(window, chord)).defaultPrevented).toBe(false);
  expect(home).not.toHaveBeenCalled();
});

it("uses current host callbacks and removes both listeners on unmount", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  const oldBack = vi.fn(), nextBack = vi.fn(), home = vi.fn();
  let update!: () => void, remove!: () => void;
  function Bindings({ next }: { next: boolean }) {
    useHistoryShortcuts({ goBack: next ? nextBack : oldBack, goForward: vi.fn() });
    useHomeShortcut({ disabled: false, onGoHome: home });
    return null;
  }
  function Host() {
    const [next, setNext] = useState(false), [mounted, setMounted] = useState(true);
    update = () => setNext(true); remove = () => setMounted(false);
    return mounted ? <Bindings next={next} /> : null;
  }
  await render(<Host />);
  await act(async () => update());
  await press(window, { key: "ArrowLeft", altKey: true });
  expect(nextBack).toHaveBeenCalledOnce(); expect(oldBack).not.toHaveBeenCalled();
  await act(async () => remove());
  expect((await press(window, { key: "ArrowLeft", altKey: true })).defaultPrevented).toBe(false);
  expect((await press(window, { key: "a", ctrlKey: true, shiftKey: true })).defaultPrevented).toBe(false);
  expect(home).not.toHaveBeenCalled();
});
