import { useState } from "react";
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
    expect(host.querySelector('[data-testid="settings-panel-notifications"]')?.textContent).toBe(
      "notifications",
    );
    await click(button(host, "快捷键"));
    expect(host.querySelector('[data-testid="settings-panel-shortcuts"]')).not.toBeNull();
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
    expect(host.querySelector<HTMLInputElement>('input[value="system"]')?.checked).toBe(false);
    expect(host.textContent).toContain("此设备");
  });
  it("does not advertise Desktop commands when the host only supplies Web Enter", async () => {
    const host = await render(
      <ShortcutSettings
        locale="en"
        shortcuts={[{ id: "send-message", keys: "Enter", ...shortcutText("en", "send-message")! }]}
      />,
    );
    expect(host.querySelectorAll("kbd")).toHaveLength(1);
    expect(host.textContent).toContain("Enter");
    expect(host.textContent).not.toContain("Ctrl+K");
    expect(shortcutText("zh-CN", "format-bold")?.label).toBe("粗体");
    expect(shortcutText("en", "unregistered-command")).toBeNull();
  });
});
