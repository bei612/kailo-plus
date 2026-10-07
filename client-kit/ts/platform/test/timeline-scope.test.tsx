import { startTransition, useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { MessageTimelineSurface } from "../src/react/messages/timeline/MessageTimelineSurface";
import type { TimelineMessage } from "../src/react/messages/types";
import { render, click } from "./render";

const messages: TimelineMessage[] = [{ id: "message", author: "Alice", time: "", createdAt: 1, depth: 0, body: "Body" }];

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
});

function StatefulHostList() {
  return <input data-testid="host-list-state" defaultValue="fresh" />;
}

function Harness() {
  const [channel, setChannel] = useState("first");
  const [name, setName] = useState("Original");
  return <>
    <button onClick={() => startTransition(() => setChannel("second"))}>Change channel</button>
    <button onClick={() => setName("Renamed")}>Rename channel</button>
    <MessageTimelineSurface channelId={channel} channelName={name} messages={messages}
      historyExhausted hasOlderMessages={false} renderList={() => <StatefulHostList />} />
  </>;
}

it("preserves the original channel-keyed list lifetime, including transition navigation", async () => {
  const host = await render(<Harness />);
  const initial = host.querySelector<HTMLInputElement>('[data-testid="host-list-state"]')!;
  expect(initial).not.toBeNull();
  initial.value = "previous channel virtualizer state";
  await click(host.querySelectorAll("button")[1]!);
  expect(host.querySelector('[data-testid="host-list-state"]')).toBe(initial);
  await click(host.querySelectorAll("button")[0]!);
  const next = host.querySelector<HTMLInputElement>('[data-testid="host-list-state"]')!;
  expect(next).not.toBe(initial);
  expect(next.value).toBe("fresh");
});
