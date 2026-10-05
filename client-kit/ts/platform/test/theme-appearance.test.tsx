import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeSettingsControls } from "../src/react/theme-settings-controls";
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
