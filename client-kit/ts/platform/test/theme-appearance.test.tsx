import { act, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeSettingsControls } from "../src/react/theme-settings-controls";
import { AppearanceSettings } from "../src/react/appearance-settings";
import { GlassBackgroundSetting } from "../src/react/glass-background-setting";
import { AvatarFramingSlider } from "../src/react/profile/buzz/features/profile/ui/AnimatedAvatarControls";
import { AvatarHostProvider } from "../src/react/profile/avatar-host";
import { DEFAULT_GLASS_OPACITY, GLASS_OPACITY_MAX, GLASS_OPACITY_MIN } from "../src/theme/glass-preference";
import { setLocale } from "../src/i18n";
import {
  migrateWebThemePreference,
  useAppearance,
  type Appearance,
} from "../src/theme/use-appearance";
import * as themes from "../src/theme/theme-loader";
import { click, render } from "./render";

let dark = false;
let listeners: Set<(event: MediaQueryListEvent) => void>;
beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  document.documentElement.className = "";
  dark = false;
  listeners = new Set();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() { return query.includes("prefers-reduced-motion") || dark; },
    media: query,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    addListener: () => {}, removeListener: () => {},
  }));
});

describe("original Buzz appearance in both hosts", () => {
  it("renders the complete original Appearance composition and its unsupported native control in Web", async () => {
    setLocale("en");
    function Host() {
      const appearance = useAppearance();
      return <AppearanceSettings name="Kailo" appearance={appearance} />;
    }
    const host = await render(<Host />);
    expect(host.querySelector('[data-testid="settings-theme"]')?.className).toContain("overflow-y-auto");
    const theme = host.querySelector('[data-testid="appearance-theme-card"]')!;
    expect(theme.querySelector('[data-testid="theme-style-trigger"]')).not.toBeNull();
    expect(theme.querySelector('[data-testid="glass-background-row"]')?.textContent).toContain("Available in the macOS desktop app.");
    const glass = theme.querySelector<HTMLButtonElement>('[data-testid="glass-background-toggle"]')!;
    expect(glass.disabled).toBe(true);
    await click(glass);
    expect(host.querySelector('[data-testid="glass-opacity-row"]')).toBeNull();
    const preferences = host.querySelector('[data-testid="appearance-preferences-card"]')!;
    expect(preferences.querySelector('[data-testid="conversation-display-group"]')).not.toBeNull();
    expect(preferences.querySelector('[data-testid="link-preview-style-control"]')).not.toBeNull();
    expect(preferences.querySelector('[data-testid="thread-layout-control"]')).not.toBeNull();
    await act(async () => setLocale("zh-CN"));
    expect(theme.querySelector('[data-testid="glass-background-row"]')?.textContent).toContain("仅适用于 macOS 桌面应用。");
    expect(glass.disabled).toBe(true);
  });

  it("uses the original compact slider callbacks, bounds, reset and haptics for native glass", async () => {
    setLocale("en");
    const haptic = vi.fn();
    const setOpacity = vi.fn();
    const setEnabled = vi.fn();
    function Host() {
      const [enabled, updateEnabled] = useState(false);
      const [opacity, updateOpacity] = useState(DEFAULT_GLASS_OPACITY);
      return <GlassBackgroundSetting performDefaultHaptic={haptic} glass={{
        glassBackgroundSupported: true, glassBackground: enabled, glassOpacity: opacity,
        setGlassBackground: value => { setEnabled(value); updateEnabled(value); },
        setGlassOpacity: value => { setOpacity(value); updateOpacity(value); },
      }} />;
    }
    const host = await render(<Host />);
    expect(host.querySelector('[data-testid="glass-opacity-slider"]')).toBeNull();
    await click(host.querySelector<HTMLElement>('[data-testid="glass-background-toggle"]')!);
    expect(setEnabled).toHaveBeenLastCalledWith(true);
    const slider = host.querySelector<HTMLElement>('[data-testid="glass-opacity-slider"]')!;
    expect(slider.className).toContain("buzz-avatar-framing-slider--compact");
    expect(slider.getAttribute("data-handle-visible")).toBe("true");
    await act(async () => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true })));
    expect(setOpacity).toHaveBeenLastCalledWith(DEFAULT_GLASS_OPACITY + 10);
    expect(haptic).toHaveBeenCalledOnce();
    await act(async () => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(slider.getAttribute("aria-valuenow")).toBe(String(GLASS_OPACITY_MIN));
    await act(async () => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(slider.getAttribute("aria-valuenow")).toBe(String(GLASS_OPACITY_MAX));
    await click(host.querySelector<HTMLElement>('[data-testid="glass-opacity-reset"]')!);
    expect(setOpacity).toHaveBeenLastCalledWith(DEFAULT_GLASS_OPACITY);
    expect(slider.getAttribute("aria-valuenow")).toBe(String(DEFAULT_GLASS_OPACITY));
    await click(host.querySelector<HTMLElement>('[data-testid="glass-background-toggle"]')!);
    expect(setEnabled).toHaveBeenLastCalledWith(false);
  });

  it("retains the original Linux exclusion and avatar slider host instead of creating a second slider", async () => {
    const hidden = await render(<GlassBackgroundSetting hidden />);
    expect(hidden.querySelector('[data-testid="glass-background-row"]')).toBeNull();
    const haptic = vi.fn();
    const change = vi.fn();
    const host = await render(<AvatarHostProvider value={{ locale: "en", performDefaultHaptic: haptic,
      rewriteMediaUrl: value => value, uploadMediaBytes: vi.fn() }}>
      <AvatarFramingSlider max={100} min={0} value={50} resetValue={50} onChange={change}
        onReset={vi.fn()} resetTestId="avatar-reset" testId="avatar-slider" />
    </AvatarHostProvider>);
    const slider = host.querySelector<HTMLElement>('[data-testid="avatar-slider"]')!;
    expect(slider.getAttribute("aria-label")).toBe("Avatar size");
    await act(async () => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true })));
    expect(change).toHaveBeenCalledWith(60);
    expect(haptic).toHaveBeenCalledOnce();
  });
  it("selects real paired themes and accents through the shared original controls", async () => {
    let appearance!: Appearance;
    function Host() {
      appearance = useAppearance();
      return <ThemeSettingsControls locale="zh-CN" name="Kailo" appearance={appearance} />;
    }
    const host = await render(<Host />);
    await vi.waitFor(() => expect(appearance.isLoading).toBe(false));
    await click(host.querySelector<HTMLButtonElement>('[data-testid="theme-style-trigger"]')!);
    await click(host.querySelector<HTMLButtonElement>('[data-testid="theme-pair-github-light"]')!);
    await vi.waitFor(() => expect(appearance.themeName).toBe("github-light"));
    await vi.waitFor(() => expect(appearance.isLoading).toBe(false));
    expect(localStorage.getItem("buzz-theme")).toBe("github-light");
    expect(localStorage.getItem("buzz-follow-system")).toBe("true");
    const lightBackground = document.documentElement.style.getPropertyValue("--background");
    expect(lightBackground).not.toBe("");
    await click(host.querySelector<HTMLButtonElement>('[data-testid="accent-color-red"]')!);
    expect(localStorage.getItem("buzz-accent-color")).toBe("#ef4444");
    expect(document.documentElement.style.getPropertyValue("--primary")).not.toBe(document.documentElement.style.getPropertyValue("--foreground"));
    await click(host.querySelector<HTMLInputElement>('[data-testid="appearance-mode-dark"]')!);
    await vi.waitFor(() => expect(appearance.isLoading).toBe(false));
    expect(appearance.themeName).toBe("github-dark");
    expect(localStorage.getItem("buzz-follow-system")).toBe("false");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--background")).not.toBe(lightBackground);
    await act(async () => appearance.setTheme("buzz-dark"));
    await vi.waitFor(() => expect(appearance.isLoading).toBe(false));
    expect(host.querySelector('[data-testid="accent-color-options"]')).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe(document.documentElement.style.getPropertyValue("--foreground"));
    expect(localStorage.getItem("buzz-accent-color")).toBe("#ef4444");
    await act(async () => appearance.setTheme("github-dark"));
    await vi.waitFor(() => expect(appearance.isLoading).toBe(false));
    expect(host.querySelector('[data-testid="accent-color-red"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(document.documentElement.style.getPropertyValue("--primary")).not.toBe(document.documentElement.style.getPropertyValue("--foreground"));
  });

  it("resolves the stored pair on OS changes without rewriting the selected style", async () => {
    localStorage.setItem("buzz-theme", "github-light");
    localStorage.setItem("buzz-follow-system", "true");
    let appearance!: Appearance;
    function Host() { appearance = useAppearance(); return null; }
    await render(<Host />);
    await vi.waitFor(() => expect(appearance.isLoading).toBe(false));
    await act(async () => {
      dark = true;
      const event = { matches: true } as MediaQueryListEvent;
      for (const listener of listeners) listener(event);
    });
    await vi.waitFor(() => expect(appearance.isLoading).toBe(false));
    expect(appearance.themeName).toBe("github-dark");
    expect(localStorage.getItem("buzz-theme")).toBe("github-light");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it.each(["light", "dark", "system"])("migrates Web %s once to the original preference keys", (mode) => {
    localStorage.setItem("buzz-web-theme", mode);
    migrateWebThemePreference();
    expect(localStorage.getItem("buzz-theme")).toBe(mode === "dark" ? "buzz-dark" : "buzz");
    expect(localStorage.getItem("buzz-follow-system")).toBe(String(mode === "system"));
    expect(localStorage.getItem("buzz-web-theme")).toBeNull();
  });

  it("preserves a Desktop selection and keeps the old Web key on failed migration", () => {
    localStorage.setItem("buzz-theme", "github-dark");
    localStorage.setItem("buzz-web-theme", "light");
    migrateWebThemePreference();
    expect(localStorage.getItem("buzz-theme")).toBe("github-dark");
    localStorage.removeItem("buzz-theme");
    const original = Storage.prototype.setItem;
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === "buzz-theme") throw new DOMException("Full", "QuotaExceededError");
      original.call(this, key, value);
    });
    migrateWebThemePreference();
    expect(localStorage.getItem("buzz-web-theme")).toBe("light");
    expect(localStorage.getItem("buzz-follow-system")).toBeNull();
    write.mockRestore();
    migrateWebThemePreference();
    expect(localStorage.getItem("buzz-web-theme")).toBeNull();
    expect(localStorage.getItem("buzz-theme")).toBe("buzz");
  });

  it("does not let a late original theme load repaint a newer selection", async () => {
    const original = themes.loadThemeData;
    let release!: (value: Awaited<ReturnType<typeof original>>) => void;
    const stale = new Promise<Awaited<ReturnType<typeof original>>>((resolve) => { release = resolve; });
    const loader = vi.spyOn(themes, "loadThemeData").mockImplementation((name) => name === "buzz" ? stale : original(name));
    let appearance!: Appearance;
    function Host() { appearance = useAppearance(); return null; }
    try {
      await render(<Host />);
      await act(async () => { appearance.setFollowSystem(false); appearance.setTheme("github-dark"); });
      await vi.waitFor(() => expect(appearance.isLoading).toBe(false));
      const background = document.documentElement.style.getPropertyValue("--background");
      await act(async () => release(await original("buzz")));
      expect(appearance.themeName).toBe("github-dark");
      expect(document.documentElement.style.getPropertyValue("--background")).toBe(background);
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    } finally { loader.mockRestore(); }
  });
});
