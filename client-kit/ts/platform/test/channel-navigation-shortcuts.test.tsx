import { StrictMode, act, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import type { BffRequest } from "../src/transport";
import { PlatformProvider } from "../src/react/context";
import { CreateChannelDialog } from "../src/react/create-channel-dialog";
import { ChannelBrowser } from "../src/react/channel-browser";
import { useChannelNavigationShortcuts } from "../src/react/use-channel-navigation-shortcuts";
import { shortcutText } from "../src/react/settings";
import { button, click, render, settle, type } from "./render";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function press(init: KeyboardEventInit, prevented = false) {
  const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, shiftKey: true, cancelable: true, ...init });
  if (prevented) event.preventDefault();
  await act(async () => window.dispatchEvent(event));
  return event;
}

it.each(["MacIntel", "Win32", "Linux x86_64"])("restores the original three %s commands once in StrictMode", async (platform) => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
  const browse = vi.fn(), create = vi.fn(), message = vi.fn();
  function Host() {
    useChannelNavigationShortcuts({ disabled: false, onBrowseChannels: browse, onCreateChannel: create, onNewMessage: message });
    return null;
  }
  await render(<StrictMode><Host /></StrictMode>);
  const modifier = { metaKey: platform === "MacIntel", ctrlKey: platform !== "MacIntel" };
  for (const key of ["K", "N", "O"]) expect((await press({ ...modifier, key })).defaultPrevented).toBe(true);
  expect(message).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledOnce();
  expect(browse).toHaveBeenCalledOnce();
});

it.each([
  { shiftKey: false }, { altKey: true }, { repeat: true },
  { metaKey: true }, { ctrlKey: false }, { key: "q" },
])("leaves competing keyboard input unchanged: %j", async (input) => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  const action = vi.fn();
  function Host() {
    useChannelNavigationShortcuts({ disabled: false, onBrowseChannels: action, onCreateChannel: action, onNewMessage: action });
    return null;
  }
  await render(<Host />);
  expect((await press(input)).defaultPrevented).toBe(false);
  expect(action).not.toHaveBeenCalled();
});

it("yields to a foreground handler, removes disabled listeners and cleans up on unmount", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  const action = vi.fn();
  let disable!: () => void, unmount!: () => void;
  function Shortcuts() {
    const [disabled, setDisabled] = useState(false);
    disable = () => setDisabled(true);
    useChannelNavigationShortcuts({ disabled, onBrowseChannels: action, onCreateChannel: action, onNewMessage: action });
    return null;
  }
  function Host() {
    const [mounted, setMounted] = useState(true);
    unmount = () => setMounted(false);
    return mounted ? <Shortcuts /> : null;
  }
  await render(<Host />);
  await press({}, true);
  expect(action).not.toHaveBeenCalled();
  await act(async () => disable());
  expect((await press({})).defaultPrevented).toBe(false);
  await act(async () => unmount());
  await press({});
  expect(action).not.toHaveBeenCalled();
});

it.each([true, false])("opens the real creation dialog without bypassing create admission (allowed=%s)", async (allowed) => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  const send = vi.fn(async (request: BffRequest) => request.method === "POST"
    ? { status: 202, body: { operationId: "create-operation", actionExecutionId: "create-execution", actionKey: "workspace.create", gateState: "ALLOWED", dispatchState: "DISPATCHED" } }
    : { status: 200, body: { workspaces: [], ...(allowed ? { createActionKey: "workspace.create" } : {}) } });
  const client = createBffClient({ send });
  function Host() {
    const [open, setOpen] = useState(false);
    useChannelNavigationShortcuts({ disabled: false, onBrowseChannels: vi.fn(), onCreateChannel: () => setOpen(true), onNewMessage: vi.fn() });
    return <CreateChannelDialog open={open} onOpenChange={setOpen} />;
  }
  await render(<PlatformProvider client={client} locale="en"><Host /></PlatformProvider>);
  await press({ key: "n" });
  await settle();
  const dialog = document.querySelector<HTMLElement>("[data-testid=create-channel-dialog]")!;
  expect(dialog).not.toBeNull();
  expect(send.mock.calls.filter(([r]) => r.method === "POST")).toHaveLength(0);
  if (allowed) {
    await type(dialog.querySelector<HTMLInputElement>("input")!, "Release planning");
    await click(button(dialog, "Create channel"));
    expect(send.mock.calls.filter(([r]) => r.method === "POST")).toHaveLength(1);
    expect(send.mock.calls.find(([r]) => r.method === "POST")?.[0]).toMatchObject({ path: "/api/v1/actions", body: { actionKey: "workspace.create", name: "Release planning" } });
    expect(dialog.textContent).toContain("create-execution");
    expect(dialog.textContent).not.toContain("Channel created");
  } else {
    expect(dialog.querySelector<HTMLInputElement>("input")?.disabled).toBe(true);
    expect(button(dialog, "Create channel").disabled).toBe(true);
    await click(button(dialog, "Create channel"));
    expect(send.mock.calls.filter(([r]) => r.method === "POST")).toHaveLength(0);
  }
});

it("opens the original channel browser and reads the admitted directory, without joining on a keypress", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const send = vi.fn(async (request: BffRequest) => ({ status: 200, body: request.path.startsWith("/api/v1/discoverable-workspaces") ? { items: [] } : { workspaces: [] } }));
  const client = createBffClient({ send });
  function Host() {
    const [open, setOpen] = useState(false);
    useChannelNavigationShortcuts({ disabled: false, onBrowseChannels: () => setOpen(true), onCreateChannel: vi.fn(), onNewMessage: vi.fn() });
    return <ChannelBrowser open={open} onOpenChange={setOpen} onSelect={vi.fn()} />;
  }
  await render(<PlatformProvider client={client} locale="en"><Host /></PlatformProvider>);
  await press({ key: "o" });
  await settle();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(send.mock.calls.some(([r]) => r.path.startsWith("/api/v1/discoverable-workspaces"))).toBe(true);
  expect(send.mock.calls.filter(([r]) => r.method === "POST")).toHaveLength(0);
});

it("keeps original English shortcut descriptions and complete Chinese translations", () => {
  expect(shortcutText("en", "browse-channels")).toEqual({ label: "Browse channels", description: "Open the channel browser" });
  expect(shortcutText("en", "browse-dms")).toEqual({ label: "New direct message", description: "Open the new message composer" });
  expect(shortcutText("en", "new-channel")).toEqual({ label: "New channel", description: "Open the create channel dialog" });
  for (const key of ["browse-channels", "browse-dms", "new-channel"]) expect(shortcutText("zh-CN", key)?.label).toMatch(/[\u4e00-\u9fff]/);
});
