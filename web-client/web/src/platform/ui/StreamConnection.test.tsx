// @vitest-environment jsdom
// Original relay connection card state machine over the aggregated BFF stream state (REQ-24).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@client-kit/platform/i18n";
import type { RelayConnectionCardState } from "@client-kit/platform/react/sidebar/relay-connection-overlay";
import { useStreamConnectionCard } from "./StreamConnection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const store = vi.hoisted(() => ({
  state: "idle" as string,
  listeners: new Set<() => void>(),
  reconnect: vi.fn<() => Promise<boolean>>(),
}));
vi.mock("../bff-client", () => ({
  streamConnectionState: () => store.state,
  subscribeStreamConnection: (listener: () => void) => {
    store.listeners.add(listener);
    return () => { store.listeners.delete(listener); };
  },
  reconnectStreams: () => store.reconnect(),
}));

let host: HTMLDivElement;
let root: Root;
let card: RelayConnectionCardState;
function Probe() {
  card = useStreamConnectionCard();
  return null;
}
async function connection(state: string) {
  await act(async () => {
    store.state = state;
    for (const listener of [...store.listeners]) listener();
  });
}
async function elapse(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  setLocale("en");
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  store.state = "idle";
  store.listeners.clear();
  store.reconnect.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Probe />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it("shows the card only for an outage that outlasts the original 2 s and confirms recovery for 6 s", async () => {
  await connection("connected");
  expect(card.showSidebarRelayConnectionCard).toBe(false);
  await connection("reconnecting");
  await elapse(1_999);
  expect(card.showSidebarRelayConnectionCard).toBe(false);
  // A hand-over shorter than the delay never flashes the card.
  await connection("connected");
  await elapse(2_000);
  expect(card.showSidebarRelayConnectionCard).toBe(false);

  await connection("reconnecting");
  await elapse(2_000);
  expect(card.showSidebarRelayConnectionCard).toBe(true);
  expect(card.isRelayConnectionSuccess).toBe(false);
  await connection("connected");
  expect(card.showSidebarRelayConnectionCard).toBe(true);
  expect(card.isRelayConnectionSuccess).toBe(true);
  await elapse(6_000);
  expect(card.showSidebarRelayConnectionCard).toBe(false);
});

it("keeps a dismissal until the next outage", async () => {
  await connection("disconnected");
  expect(card.showSidebarRelayConnectionCard).toBe(true);
  await act(async () => card.onDismissRelayConnectionCard());
  expect(card.showSidebarRelayConnectionCard).toBe(false);
  await connection("connected");
  expect(card.showSidebarRelayConnectionCard).toBe(false);
  await connection("disconnected");
  expect(card.showSidebarRelayConnectionCard).toBe(true);
});

it("retries the streams once per click, shows pending and confirms an actual reconnection", async () => {
  await connection("disconnected");
  let finish!: (connected: boolean) => void;
  store.reconnect.mockImplementation(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  await act(async () => { card.onReconnectRelay(); card.onReconnectRelay(); });
  expect(store.reconnect).toHaveBeenCalledOnce();
  expect(card.isRelayReconnectPending).toBe(true);
  await connection("connected");
  await act(async () => { finish(true); await vi.advanceTimersByTimeAsync(0); });
  expect(card.isRelayReconnectPending).toBe(false);
  expect(card.isRelayConnectionSuccess).toBe(true);
  expect(card.showSidebarRelayConnectionCard).toBe(true);

  // A failed attempt only ends the pending state; the outage card stays.
  await connection("disconnected");
  store.reconnect.mockResolvedValue(false);
  await act(async () => { card.onReconnectRelay(); await vi.advanceTimersByTimeAsync(0); });
  expect(card.isRelayReconnectPending).toBe(false);
  expect(card.isRelayConnectionSuccess).toBe(false);
  expect(card.showSidebarRelayConnectionCard).toBe(true);
});
