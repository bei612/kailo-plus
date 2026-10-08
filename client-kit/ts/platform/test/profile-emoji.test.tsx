import { act, StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import data from "@emoji-mart/data";
import en from "@emoji-mart/data/i18n/en.json";
import EmojiPicker from "../src/react/profile/buzz/shared/ui/emoji-picker";
import { AvatarHostProvider } from "../src/react/profile/avatar-host";
import { AvatarCustomColorPanel } from "../src/react/profile/buzz/features/profile/ui/AvatarCustomColorPanel";
import { button, click, render, settle } from "./render";

// jsdom has no layout observer. Only that browser boundary is replaced; the
// real Emoji Mart element, Preact UI and unregister path execute unchanged.
const observers: { disconnect: ReturnType<typeof vi.fn> }[] = [];
beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal("IntersectionObserver", class {
    disconnect = vi.fn();
    constructor() { observers.push(this); }
    observe() {}
    unobserve() {}
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("original Emoji Mart wrapper on the actual React 19 host", () => {
  it.each(["en", "zh-CN"] as const)("uses the original custom-colour commit control with %s text", async (locale) => {
    const commit = vi.fn();
    const host = await render(<AvatarHostProvider value={{locale, rewriteMediaUrl: url => url}}>
      <AvatarCustomColorPanel visible hue={0} saturation={0} value={0} colorDraft="#000000"
        onHueChange={vi.fn()} onSaturationValueChange={vi.fn()} onCommit={commit} testIdPrefix="avatar" />
    </AvatarHostProvider>);
    const control = button(host, locale === "en" ? "Use color" : "使用此颜色");
    expect(control.getAttribute("data-testid")).toBe("avatar-custom-color-done");
    await click(control);
    expect(commit).toHaveBeenCalledOnce();
  });
  it("mounts one native picker across StrictMode and unregisters it on host unmount", async () => {
    let toggle!: (value: boolean) => void;
    function Host() {
      const [shown, setShown] = useState(true);
      toggle = setShown;
      return shown ? <EmojiPicker data={data} i18n={en} theme="light" dynamicWidth={false} autoFocus={false} /> : null;
    }
    const host = await render(<StrictMode><Host /></StrictMode>);
    await settle();
    expect(host.querySelectorAll("em-emoji-picker")).toHaveLength(1);
    const original = host.querySelector("em-emoji-picker")!;
    expect(original.shadowRoot).not.toBeNull();
    expect(original.shadowRoot!.querySelector("button")).not.toBeNull();
    const mountedObservers = [...observers];
    expect(mountedObservers.length).toBeGreaterThan(0);
    await act(async () => toggle(false));
    await settle();
    expect(host.querySelector("em-emoji-picker")).toBeNull();
    // This field is set by Emoji Mart's real disconnectedCallback, not our
    // wrapper. It proves the underlying custom element received cleanup.
    expect(Reflect.get(original, "disconnected")).toBe(true);
    for (const observer of mountedObservers) expect(observer.disconnect).toHaveBeenCalled();
    await act(async () => toggle(true));
    await settle();
    expect(host.querySelectorAll("em-emoji-picker")).toHaveLength(1);
    expect(host.querySelector("em-emoji-picker")).not.toBe(original);
  });
});
