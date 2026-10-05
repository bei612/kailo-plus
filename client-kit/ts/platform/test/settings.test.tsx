import { useState } from "react";
import { act } from "react";
import { ConversationDisplaySettings } from "../src/react/conversation-display-settings";
import { ProminentActiveTabSetting } from "../src/react/prominent-active-tab-setting";
import {
  PROMINENT_ACTIVE_TAB_STORAGE_KEY,
  useProminentActiveTab,
} from "../src/theme/prominent-active-tab";
import {
  FONT_SIZE_STORAGE_KEY,
  getFontSize,
  initializeFontSizePreference,
  previewFontSize,
  setFontSize,
} from "../src/fontSizePreference";
import {
  CONVERSATION_DENSITY_STORAGE_KEY,
  getConversationDensity,
  initializeConversationDensityPreference,
  setConversationDensity,
} from "../src/conversationDensityPreference";
import { describe, expect, it, vi } from "vitest";
import {
  SettingsPage,
  ShortcutSettings,
  ThemeModeControl,
  shortcutText,
  type SettingsSection,
} from "../src/react/settings";
import type { PlatformThemeMode } from "../src/i18n";
import { button, click, render } from "./render";

describe("shared Buzz settings presentation", () => {
  it("preserves the original high-contrast navigation preference across Buzz theme changes", async () => {
    localStorage.clear();
    let preference: ReturnType<typeof useProminentActiveTab>;
    let changeTheme: (buzz: boolean) => void;
    function Host() {
      const [buzz, setBuzz] = useState(true);
      changeTheme = setBuzz;
      preference = useProminentActiveTab(buzz);
      return <ProminentActiveTabSetting locale="zh-CN" {...preference} />;
    }
    const host = await render(<Host />);
    const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(host.textContent).toContain("突出显示当前导航");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(document.documentElement.hasAttribute("data-prominent-active-tab")).toBe(false);
    await click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(localStorage.getItem(PROMINENT_ACTIVE_TAB_STORAGE_KEY)).toBe("true");
    expect(document.documentElement.hasAttribute("data-prominent-active-tab")).toBe(true);
    await act(async () => changeTheme(false));
    expect(document.documentElement.hasAttribute("data-prominent-active-tab")).toBe(false);
    expect(localStorage.getItem(PROMINENT_ACTIVE_TAB_STORAGE_KEY)).toBe("true");
    await act(async () => changeTheme(true));
    expect(document.documentElement.hasAttribute("data-prominent-active-tab")).toBe(true);
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "QuotaExceededError");
    });
    try {
      expect(() => preference.setProminentActiveTab(false)).toThrow("Storage unavailable");
      expect(toggle.getAttribute("aria-checked")).toBe("true");
      expect(document.documentElement.hasAttribute("data-prominent-active-tab")).toBe(true);
    } finally { write.mockRestore(); }
    await click(toggle);
    expect(localStorage.getItem(PROMINENT_ACTIVE_TAB_STORAGE_KEY)).toBe("false");
    expect(document.documentElement.hasAttribute("data-prominent-active-tab")).toBe(false);
  });
  it.each([null, "unknown", "false", "true"])("reads original saved prominent-tab value %s", async (stored) => {
    localStorage.clear();
    if (stored !== null) localStorage.setItem(PROMINENT_ACTIVE_TAB_STORAGE_KEY, stored);
    function Host() {
      const preference = useProminentActiveTab(true);
      return <ProminentActiveTabSetting locale="en" {...preference} />;
    }
    const host = await render(<Host />);
    expect(host.querySelector('[role="switch"]')!.getAttribute("aria-checked")).toBe(String(stored === "true"));
    expect(document.documentElement.hasAttribute("data-prominent-active-tab")).toBe(stored === "true");
  });
  it("previews pointer scrubbing without saving and restores one transition duration on cancel", async () => {
    localStorage.clear();
    initializeFontSizePreference();
    initializeConversationDensityPreference();
    const host = await render(<ConversationDisplaySettings locale="en" />);
    const control = host.querySelector<HTMLFieldSetElement>('[data-testid="font-size-control"]')!;
    const indicator = host.querySelector<HTMLElement>('[data-testid="font-size-control-indicator"]')!;
    let captured: number | null = null;
    Object.defineProperties(control, {
      setPointerCapture: { value: (id: number) => { captured = id; } },
      hasPointerCapture: { value: (id: number) => captured === id },
      releasePointerCapture: { value: () => { captured = null; } },
    });
    vi.spyOn(control, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 300, 32));
    async function pointer(type: string, clientX: number) {
      await act(async () => {
        const event = new MouseEvent(type, { bubbles: true, button: 0, clientX });
        Object.defineProperty(event, "pointerId", { value: 1 });
        control.dispatchEvent(event);
      });
    }
    expect(indicator.classList.contains("duration-200")).toBe(true);
    expect(indicator.classList.contains("duration-0")).toBe(false);
    await pointer("pointerdown", 150);
    await pointer("pointermove", 250);
    expect(indicator.classList.contains("duration-0")).toBe(true);
    expect(indicator.classList.contains("duration-200")).toBe(false);
    expect(document.documentElement.getAttribute("data-font-size")).toBe("larger");
    expect(indicator.style.transform).toBe("translateX(200%)");
    expect(getFontSize()).toBe("default");
    expect(localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBeNull();
    await pointer("pointercancel", 250);
    expect(captured).toBeNull();
    expect(indicator.classList.contains("duration-200")).toBe(true);
    expect(indicator.classList.contains("duration-0")).toBe(false);
    expect(indicator.style.transform).toBe("translateX(100%)");
    expect(document.documentElement.getAttribute("data-font-size")).toBe("default");
    expect(localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBeNull();
  });
  it("applies and restores the original device font/density preferences from the shared controls", async () => {
    localStorage.clear();
    initializeFontSizePreference();
    initializeConversationDensityPreference();
    const host = await render(<ConversationDisplaySettings locale="zh-CN" />);
    expect(host.textContent).toContain("字号");
    await click(button(host, "较大"));
    await click(button(host, "宽松"));
    expect(document.documentElement.getAttribute("data-font-size")).toBe(
      "larger",
    );
    expect(
      document.documentElement.getAttribute("data-conversation-density"),
    ).toBe("spacious");
    expect(localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBe("larger");
    expect(localStorage.getItem(CONVERSATION_DENSITY_STORAGE_KEY)).toBe(
      "spacious",
    );
    await act(async () => {
      setFontSize("smaller");
      setConversationDensity("compact");
      localStorage.setItem(FONT_SIZE_STORAGE_KEY, "larger");
      localStorage.setItem(CONVERSATION_DENSITY_STORAGE_KEY, "spacious");
      initializeFontSizePreference();
      initializeConversationDensityPreference();
    });
    expect(button(host, "较大").getAttribute("aria-pressed")).toBe("true");
    expect(button(host, "宽松").getAttribute("aria-pressed")).toBe("true");
    expect(
      host.querySelector('[data-testid="conversation-preview-content"]'),
    ).not.toBeNull();
  });
  it("synchronizes storage changes, rejects unknown choices and keeps previews transient", async () => {
    initializeFontSizePreference();
    initializeConversationDensityPreference();
    const host = await render(<ConversationDisplaySettings locale="en" />);
    await act(async () => {
      setFontSize("default");
      previewFontSize("larger");
    });
    expect(getFontSize()).toBe("default");
    expect(localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBe("default");
    expect(document.documentElement.getAttribute("data-font-size")).toBe(
      "larger",
    );
    previewFontSize(null);
    expect(document.documentElement.getAttribute("data-font-size")).toBe(
      "default",
    );
    await act(async () => {
      localStorage.setItem(FONT_SIZE_STORAGE_KEY, "unknown");
      localStorage.setItem(CONVERSATION_DENSITY_STORAGE_KEY, "unknown");
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(getFontSize()).toBe("default");
    expect(getConversationDensity()).toBe("comfortable");
    expect(button(host, "Default").getAttribute("aria-pressed")).toBe("true");
    expect(button(host, "Comfy").getAttribute("aria-pressed")).toBe("true");
  });
  it("keeps the live settings effective when device storage is unavailable", async () => {
    const host = await render(<ConversationDisplaySettings locale="en" />);
    const denied = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    try {
      await click(button(host, "Smaller"));
      await click(button(host, "Compact"));
      expect(document.documentElement.getAttribute("data-font-size")).toBe(
        "smaller",
      );
      expect(
        document.documentElement.getAttribute("data-conversation-density"),
      ).toBe("compact");
    } finally {
      denied.mockRestore();
    }
  });
  it("selects only the three existing sections without generating unsupported controls", async () => {
    function Host() {
      const [section, setSection] = useState<SettingsSection>("appearance");
      return (
        <SettingsPage locale="zh-CN" section={section} onSelect={setSection}>
          {section}
        </SettingsPage>
      );
    }
    const host = await render(<Host />);
    await click(button(host, "通知"));
    expect(
      host.querySelector('[data-testid="settings-panel-notifications"]')
        ?.textContent,
    ).toBe("notifications");
    await click(button(host, "快捷键"));
    expect(
      host.querySelector('[data-testid="settings-panel-shortcuts"]'),
    ).not.toBeNull();
    expect(host.querySelectorAll("nav button")).toHaveLength(3);
    expect(host.textContent).not.toMatch(/provider|私钥|配对|语言/);
  });
  it("uses the host's live theme state and only changes its existing preference consumer", async () => {
    const changed = vi.fn();
    function Host() {
      const [mode, setMode] = useState<PlatformThemeMode>("system");
      return (
        <ThemeModeControl
          locale="zh-CN"
          value={mode}
          onChange={(value) => {
            changed(value);
            setMode(value);
          }}
        />
      );
    }
    const host = await render(<Host />);
    const dark = host.querySelector<HTMLInputElement>('input[value="dark"]')!;
    await click(dark);
    expect(changed).toHaveBeenCalledExactlyOnceWith("dark");
    expect(dark.checked).toBe(true);
    expect(
      host.querySelector<HTMLInputElement>('input[value="system"]')?.checked,
    ).toBe(false);
    expect(host.textContent).toContain("此设备");
  });
  it("does not advertise Desktop commands when the host only supplies Web Enter", async () => {
    const host = await render(
      <ShortcutSettings
        locale="en"
        shortcuts={[
          {
            id: "send-message",
            keys: "Enter",
            ...shortcutText("en", "send-message")!,
          },
        ]}
      />,
    );
    expect(host.querySelectorAll("kbd")).toHaveLength(1);
    expect(host.textContent).toContain("Enter");
    expect(host.textContent).not.toContain("Ctrl+K");
    expect(shortcutText("zh-CN", "format-bold")?.label).toBe("粗体");
    expect(shortcutText("en", "unregistered-command")).toBeNull();
  });
});
