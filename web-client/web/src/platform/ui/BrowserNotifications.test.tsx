// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BrowserNotificationsProvider, useBrowserNotifications } from "./BrowserNotifications";

const state = vi.hoisted(() => ({ sound: vi.fn(), profile: vi.fn() }));
vi.mock("../bff-client", () => ({ bff: { profile: () => state.profile() } }));
vi.mock("@client-kit/platform/react/notifications", async (original) => ({
  ...await original<typeof import("@client-kit/platform/react/notifications")>(), playNotificationSound: state.sound,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let current: ReturnType<typeof useBrowserNotifications>;
const deliveries: FakeNotification[] = [];
class FakeNotification {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  onclick: (() => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn(() => this.onclose?.());
  constructor(readonly title: string, readonly options: NotificationOptions) { deliveries.push(this); }
}
beforeEach(() => {
  localStorage.clear(); deliveries.length = 0; state.sound.mockReset();
  state.profile.mockResolvedValue({ pubkey: "own-key" });
  FakeNotification.permission = "granted";
  vi.stubGlobal("Notification", FakeNotification);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function mount() {
  function Consumer() { current = useBrowserNotifications(); return null; }
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root.render(<QueryClientProvider client={query}><BrowserNotificationsProvider principalId="principal"><Consumer /></BrowserNotificationsProvider></QueryClientProvider>); });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
}
it("uses actual permission, original slot settings, silent notification and selected sound; closes on identity host teardown", async () => {
  await mount();
  const open = vi.fn();
  const message = { eventId: "event", title: "Actor", body: "hello", slot: "mention" as const, onOpen: open };
  current!.notify(message);
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]?.options).toEqual({ body: "hello", silent: true, tag: "event" });
  expect(state.sound).toHaveBeenCalledWith("flutter");
  current!.notify(message);
  expect(deliveries).toHaveLength(1);
  await act(async () => { current!.setSlotAlertsEnabled("mention", false); });
  current!.notify({ ...message, eventId: "disabled-slot" });
  expect(deliveries).toHaveLength(1);
  await act(async () => { root.unmount(); });
  expect(deliveries[0]?.close).toHaveBeenCalledOnce();
  deliveries[0]?.onclick?.();
  expect(open).not.toHaveBeenCalled();
});
it("delivers DMs through the original independently persisted slot", async () => {
  await mount();
  const message = { eventId: "dm", title: "Alice", body: "hello", slot: "dm" as const, onOpen: vi.fn() };
  current!.notify(message);
  current!.notify(message);
  expect(deliveries).toHaveLength(1);
  await act(async () => { current!.setSlotAlertsEnabled("dm", false); });
  current!.notify({ ...message, eventId: "muted-dm" });
  expect(deliveries).toHaveLength(1);
  current!.notify({ ...message, eventId: "mention", slot: "mention" });
  expect(deliveries).toHaveLength(2);
});
it("does not alert while visible by default or when permission is no longer granted", async () => {
  await mount();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  const message = { eventId: "event", title: "Actor", body: "hello", slot: "mention" as const, onOpen: vi.fn() };
  current!.notify(message);
  expect(deliveries).toHaveLength(0);
  await act(async () => { current!.setNotifyWhileViewing(true); });
  current!.notify(message);
  expect(deliveries).toHaveLength(1);
  FakeNotification.permission = "denied";
  current!.notify({ ...message, eventId: "denied" });
  expect(deliveries).toHaveLength(1);
  expect(state.sound).toHaveBeenCalledTimes(1);
});
