import { StrictMode, act, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useSettingsShortcuts } from "../src/react/use-settings-shortcuts";
import { SettingsPage } from "../src/react/settings";
import { SidebarProvider } from "../src/react/sidebar/sidebar";
import { useUiLocale } from "../src/react/context";
import { setLocale } from "../src/i18n";
import { hasActiveEscapeSurface } from "../src/react/messages/thread/escapeSurfaces";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../src/react/composer/shared/ui/dialog";
import { click, render } from "./render";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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

it("returns through the original shared button or Escape without remounting a pending settings intent", async () => {
  setLocale("zh-CN");
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true }));
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  function Host() {
    const locale = useUiLocale();
    const [open, setOpen] = useState(true);
    useSettingsShortcuts({ open, onOpenSettings: () => setOpen(true), onClose: () => setOpen(false) });
    return <SidebarProvider><span data-testid="current-page">{open ? "settings" : "original-conversation"}</span>
      <div hidden={!open}><SettingsPage active={open} locale={locale} section="profile" onSelect={() => {}} onClose={() => setOpen(false)}>
        <input aria-label="Pending intent" defaultValue="same-idempotency-key" disabled />
      </SettingsPage></div></SidebarProvider>;
  }
  const host = await render(<StrictMode><Host /></StrictMode>);
  const pending = host.querySelector<HTMLInputElement>("input")!;
  expect(hasActiveEscapeSurface()).toBe(true);
  expect(host.querySelector('[data-testid="settings-back-to-app"]')!.textContent).toBe("返回应用");
  await click(host.querySelector<HTMLElement>('[data-testid="settings-back-to-app"]')!);
  expect(host.querySelector('[data-testid="current-page"]')!.textContent).toBe("original-conversation");
  expect(hasActiveEscapeSurface()).toBe(false);
  expect((await press({ key: "Escape" })).defaultPrevented).toBe(false);
  await press({ ctrlKey: true });
  await act(async () => setLocale("en"));
  expect(host.querySelector('[data-testid="settings-back-to-app"]')!.textContent).toBe("Back to app");
  expect((await press({ key: "Escape" })).defaultPrevented).toBe(true);
  expect(host.querySelector('[data-testid="current-page"]')!.textContent).toBe("original-conversation");
  expect(host.querySelector("input")).toBe(pending);
  expect(pending.value).toBe("same-idempotency-key");
  expect(pending.disabled).toBe(true);
});

it("lets the original foreground dialog consume Escape before closing settings", async () => {
  const closeSettings = vi.fn();
  function Host() {
    const [dialog, setDialog] = useState(true);
    useSettingsShortcuts({ open: true, onOpenSettings: vi.fn(), onClose: closeSettings });
    return <Dialog open={dialog} onOpenChange={setDialog}>
      <DialogContent>
        <DialogTitle>Original settings dialog</DialogTitle><DialogDescription>Nested foreground surface</DialogDescription>
        <input aria-label="Nested field" />
      </DialogContent>
    </Dialog>;
  }
  await render(<Host />);
  const field = document.querySelector<HTMLInputElement>('[aria-label="Nested field"]')!;
  expect(field).not.toBeNull();
  await act(async () => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(closeSettings).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await press({ key: "Escape" });
  expect(closeSettings).toHaveBeenCalledOnce();
});

it("keeps settings open when an inner pending control refuses Escape", async () => {
  const close = vi.fn();
  function Host() {
    useSettingsShortcuts({ open: true, onOpenSettings: vi.fn(), onClose: close });
    return <input aria-label="Uncertain edit" onKeyDown={(event) => { if (event.key === "Escape") event.preventDefault(); }} />;
  }
  const host = await render(<Host />);
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  await act(async () => host.querySelector("input")!.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(close).not.toHaveBeenCalled();
});
