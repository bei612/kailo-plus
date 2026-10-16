// @vitest-environment jsdom
// The original useTypingBroadcast throttle over the DD-120 BFF typing route (V-SCN-104).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { typingPath } from "@/platform/bff-client";
import { useTypingBroadcast } from "./useTypingBroadcast";

let root: Root;
let host: HTMLDivElement;
let notify: () => void = () => {};
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function Probe({ scope, send }: { scope: string | null; send: () => Promise<void> }) {
  notify = useTypingBroadcast(scope, send);
  return null;
}

it("sends at most once every 3 seconds per scope and resets when the scope changes", async () => {
  const send = vi.fn(async () => {});
  await act(async () => root.render(<Probe scope="workspace:a" send={send} />));
  notify(); notify();
  await act(async () => {});
  expect(send).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(3_000);
  notify();
  await act(async () => {});
  expect(send).toHaveBeenCalledTimes(2);
  await act(async () => root.render(<Probe scope="workspace:b" send={send} />));
  notify();
  await act(async () => {});
  expect(send).toHaveBeenCalledTimes(3);
});

it("ignores failures and sends nothing without a scope", async () => {
  const failing = vi.fn(() => { throw new Error("transport gone"); });
  await act(async () => root.render(<Probe scope="workspace:a" send={failing} />));
  expect(() => notify()).not.toThrow();
  await act(async () => {});
  expect(failing).toHaveBeenCalledTimes(1);
  const send = vi.fn(async () => {});
  await act(async () => root.render(<Probe scope={null} send={send} />));
  notify();
  await act(async () => {});
  expect(send).not.toHaveBeenCalled();
});

it("routes workspace and conversation typing to their BFF paths", () => {
  expect(typingPath({ workspaceId: "w 1" })).toBe("/api/v1/workspaces/w%201/typing");
  expect(typingPath({ conversationId: "c1", workspaceId: "w1" })).toBe("/api/v1/conversations/c1/typing");
  expect(typingPath({})).toBeNull();
});
