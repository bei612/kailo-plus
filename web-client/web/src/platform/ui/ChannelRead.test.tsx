// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { BffError, TransportError } from "@client-kit/platform/transport";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReadMarkRequest } from "@client-kit/contracts";
import type { StreamFrame, UserState } from "../bff-client";
import { ChannelPane } from "./ChannelPane";
import { platformQueries } from "./queries";
import { setLocale } from "@client-kit/platform/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({
  receive: null as null | ((frame: StreamFrame) => void),
  fetch: vi.fn(),
  mark: vi.fn(),
  notify: vi.fn(),
  publish: vi.fn(),
  members: vi.fn(),
  stream: vi.fn(),
  reason: (value: string) => value,
}));
vi.mock("@client-kit/platform/react/context", async (original) => ({
  ...await original<typeof import("@client-kit/platform/react/context")>(), useReasonText: () => state.reason,
  useLocale: () => "en", useT: () => state.reason,
}));
vi.mock("./BrowserNotifications", () => ({ useBrowserNotifications: () => ({ notify: state.notify, settings: { homeBadgeEnabled: true } }) }));
vi.mock("./useWorkspaceThread", () => ({ useWorkspaceThread: () => ({
  messages: threadMessages, denied: false, interrupted: false, refresh: vi.fn(),
  thread: {isSuccess: true, isPending: false, isError: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch: vi.fn()},
}) }));
vi.mock("@/platform/bff-client", async () => ({
  BffError: (await import("@client-kit/platform/transport")).BffError,
  bff: {
    members: () => state.members(),
    workspaces: async () => [],
    agentInstallations: async () => ({ installations: [] }),
    profile: async () => ({pubkey:"mine"}),
  },
  fetchUserState: () => state.fetch(),
  markRead: (request: ReadMarkRequest) => state.mark(request),
  publishMessage: (...args: unknown[]) => state.publish(...args),
  uploadMedia: vi.fn(),
  openStream: (_workspace: string, receive: (frame: StreamFrame) => void) => {
    state.stream(_workspace);
    state.receive = receive;
    return () => {};
  },
}));
vi.mock("@/features/chat/ui/MessageContent", () => ({ MessageContent: () => null }));
vi.mock("@/shared/i18n", () => ({ t: (key: string) => key, getLocale: () => "en" }));

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
let projection: UserState;
const event = (seconds: number) => ({
  id: `event-${seconds}`,
  kind: 9,
  pubkey: "other",
  created_at: seconds,
  tags: [["h", "channel-a"]],
  content: "",
});
const threadMessages = [{...event(10), createdAt: 10}];
async function flush() {
  // Exercise real React effects and Query's notification queue repeatedly.
  for (let i = 0; i < 20; i++)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
}
async function renderChannel(props: { archived?: boolean; metadataPending?: boolean } = {}) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TooltipProvider><ChannelPane workspaceId="workspace-a" myPrincipalId="human-a" {...props} /></TooltipProvider>
      </QueryClientProvider>,
    );
  });
}
async function open() {
  await renderChannel();
  await act(async () => {
    state.receive!({ type: "snapshot", events: [event(10)] });
    state.receive!({ type: "live" });
  });
  await flush();
}
function retry() {
  const button = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "platform.retry",
  );
  if (!button) throw new Error("Missing retry");
  return button;
}

it("applies a live same-author edit to one existing row without counting or notifying a new message", async () => {
  await open();
  state.notify.mockClear();
  const edited = {...event(11),kind:40003,content:"edited",tags:[["h","channel-a"],["e","event-10"]]};
  await act(async () => state.receive!({type:"event",event:edited}));
  await flush();
  expect(host.querySelectorAll('[data-testid="message-row"]')).toHaveLength(1);
  expect(host.querySelectorAll('[data-event-id="event-10"]')).toHaveLength(1);
  expect(host.querySelector('[data-event-id="event-11"]')).toBeNull();
  expect(state.notify).not.toHaveBeenCalled();
});

it("keeps snapshot and delayed history chronological, deduplicated and stable within one second", async () => {
  await renderChannel();
  const early = event(10);
  const sameSecond = { ...event(20), id: "event-20-a" };
  const latest = { ...event(20), id: "event-20-z" };
  await act(async () => {
    state.receive!({ type: "snapshot", events: [latest, sameSecond, latest] });
    state.receive!({ type: "event", event: early });
    state.receive!({ type: "event", event: sameSecond });
    state.receive!({ type: "live" });
  });
  await flush();
  expect([...host.querySelectorAll("[data-event-id]")].map((row) => row.getAttribute("data-event-id")))
    .toEqual([early.id, sameSecond.id, latest.id]);
  expect(state.mark.mock.calls[0]?.[0].lastReadAt).toBe(new Date(20_000).toISOString());
  expect(state.notify).not.toHaveBeenCalled();
  await act(async () => state.receive!({ type: "event", event: { ...event(15), id: "late-arrival" } }));
  await flush();
  expect([...host.querySelectorAll("[data-event-id]")].map((row) => row.getAttribute("data-event-id")))
    .toEqual([early.id, "late-arrival", sameSecond.id, latest.id]);
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  setLocale("en");
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  projection = { version: 3, readContexts: {}, workspacePreferences: {} };
  state.fetch.mockImplementation(async () => structuredClone(projection));
  state.members.mockResolvedValue([]);
  state.publish.mockResolvedValue({ eventId: "published-event", operationId: "operation" });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  vi.useRealTimers();
});

it("notifies only a new admitted live mention, never a snapshot, duplicate, disconnected replay or revoked stream", async () => {
  state.members.mockResolvedValue([{ principalId: "human-a", displayName: "Me", pubkeys: ["mine"] }]);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  await open();
  const mention = (seconds: number) => ({ ...event(seconds), tags: [["h", "channel-a"], ["p", "mine"]] });
  await act(async () => { state.receive!({ type: "snapshot", events: [mention(20)] }); state.receive!({ type: "live" }); });
  expect(state.notify).not.toHaveBeenCalled();
  await act(async () => state.receive!({ type: "event", event: mention(30) }));
  expect(state.notify).toHaveBeenCalledTimes(1);
  expect(state.notify.mock.calls[0]?.[0]).toMatchObject({ eventId: "event-30", slot: "mention" });
  await act(async () => {
    state.receive!({ type: "event", event: mention(30) });
    state.receive!({ type: "interrupted" });
    state.receive!({ type: "event", event: mention(40) });
    state.receive!({ type: "live" });
    state.receive!({ type: "event", event: mention(40) });
    state.receive!({ type: "closed", reason: "scope-revoked" });
    state.receive!({ type: "event", event: mention(50) });
  });
  expect(state.notify).toHaveBeenCalledTimes(1);
});

it.each([new TransportError("lost ACK"), new BffError(403, "denied")])(
  "does not turn failed read marking into a mutation/readback loop: %s",
  async (error) => {
    state.mark.mockRejectedValue(error);
    await open();
    expect(state.mark).toHaveBeenCalledTimes(1);
    expect(
      client.getQueryData<UserState>(platformQueries.userState.queryKey)?.readContexts,
    ).toEqual({});
    expect(host.textContent).toContain(
      error instanceof TransportError ? "inbox.readUnknown" : "inbox.readUnavailable",
    );
    await act(async () => {
      state.receive!({ type: "event", event: event(20) });
      state.receive!({ type: "interrupted" });
      state.receive!({ type: "live" });
    });
    await flush();
    expect(state.mark).toHaveBeenCalledTimes(1);
  },
);

it("mounts the original rich composer in a real channel DOM and removes it on revocation", async () => {
  state.mark.mockRejectedValue(new BffError(403, "denied"));
  await open();
  expect(host.querySelector('[data-testid="message-input"]')?.getAttribute("contenteditable")).toBe("true");
  expect(host.querySelector('[aria-label="Toggle formatting"]')).not.toBeNull();
  await act(async () => state.receive!({ type: "closed", reason: "scope-revoked" }));
  expect(host.querySelector('[data-testid="message-composer"]')).toBeNull();
});

it("refreshes signed metadata only on closure and keeps archive transitions on the original stream lifecycle", async () => {
  state.mark.mockResolvedValue({ version: 4 });
  await open();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await act(async () => state.receive!({ type: "event", event: event(20) }));
  await flush();
  expect(invalidate.mock.calls.some(([options]) => options?.queryKey?.[1] === "channel-descriptor")).toBe(false);
  expect(state.stream).toHaveBeenCalledTimes(1);
  await act(async () => state.receive!({ type: "closed", reason: "restricted: channel access revoked" }));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["platform", "channel-descriptor", "human-a", "workspace-a"] });
  await renderChannel({ archived: true });
  await flush();
  expect(host.textContent).toContain("channel.archived");
  expect(host.querySelector('[data-testid="message-input"]')?.getAttribute("contenteditable")).toBe("false");
  expect(state.stream).toHaveBeenCalledTimes(1);
  await renderChannel({ archived: false });
  await flush();
  expect(state.stream).toHaveBeenCalledTimes(2);
});

it("retains an UNKNOWN send key while native metadata is unavailable or archived", async () => {
  state.mark.mockResolvedValue({ version: 4 });
  state.publish.mockResolvedValue({ operationId: "unknown-operation" });
  await open();
  await act(async () => {
    const input = host.querySelector<HTMLElement>('[data-testid="message-input"]')!;
    const paragraph = document.createElement("p"); paragraph.textContent = "pending message";
    input.replaceChildren(paragraph);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "pending message" }));
  });
  await flush();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="send-message"]')!.click());
  await flush();
  expect(state.publish).toHaveBeenCalledTimes(1);
  const input = host.querySelector('[data-testid="message-input"]');
  for (const props of [{ metadataPending: true }, { archived: true }]) {
    await renderChannel(props);
    await flush();
    expect(host.querySelector('[data-testid="message-input"]')).toBe(input);
    expect(host.querySelector<HTMLButtonElement>('[data-testid="send-message"]')?.disabled).toBe(true);
    expect(state.publish).toHaveBeenCalledTimes(1);
  }
  await renderChannel();
  await flush();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="send-message"]')!.click());
  await flush();
  expect(state.publish).toHaveBeenCalledTimes(2);
  expect(state.publish.mock.calls[1]).toEqual(state.publish.mock.calls[0]);
});

it("the original Reply action sends to the exact event and cancellation restores the channel draft", async () => {
  state.mark.mockRejectedValue(new BffError(403, "denied"));
  state.members.mockResolvedValue([{principalId: "human-a", displayName: "Alice", pubkeys: ["mine"], state: "ACTIVE"}]);
  await open();
  const type = async (value: string) => {
    await act(async () => {
      const input = host.querySelector<HTMLElement>('[data-testid="message-thread-panel"] [data-testid="message-input"]')!;
      const paragraph = document.createElement("p"); paragraph.textContent = value;
      input.replaceChildren(paragraph);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    });
    await flush();
  };
  await act(async () => {
    const input = host.querySelector<HTMLElement>('[data-testid="message-input"]')!;
    const paragraph = document.createElement("p"); paragraph.textContent = "channel draft";
    input.replaceChildren(paragraph);
    input.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText", data: "channel draft"}));
  });
  await flush();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="reply-message-event-10"]')!.click());
  await flush();
  expect(host.querySelector('[data-testid="message-thread-panel"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="message-thread-panel"] [data-testid="message-input"]')?.textContent).not.toContain("channel draft");
  await type("actual reply");
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="message-thread-panel"] [data-testid="send-message"]')!.click());
  await flush();
  expect(state.publish).toHaveBeenCalledTimes(1);
  expect(state.publish.mock.calls[0]).toEqual(["workspace-a", "actual reply", [], expect.any(String), [], { messageType: "STREAM", parentEventId: "event-10" }]);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close panel"]')!.click());
  await flush();
  expect(host.querySelector('[data-testid="message-thread-panel"]')).toBeNull();
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("channel draft");
});

it("a reply without confirmed evidence stays UNKNOWN and keeps its original intent across target switches", async () => {
  state.mark.mockRejectedValue(new BffError(403, "denied"));
  state.publish.mockResolvedValue({ operationId: "operation" });
  state.members.mockResolvedValue([{principalId: "human-a", displayName: "Alice", pubkeys: ["mine"], state: "ACTIVE"}]);
  await open();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="reply-message-event-10"]')!.click());
  await flush();
  await act(async () => {
    const input = host.querySelector<HTMLElement>('[data-testid="message-thread-panel"] [data-testid="message-input"]')!;
    const paragraph = document.createElement("p"); paragraph.textContent = "retained reply";
    input.replaceChildren(paragraph);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "retained reply" }));
  });
  await flush();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="message-thread-panel"] [data-testid="send-message"]')!.click());
  await flush();
  expect(host.textContent).toContain("platform.sendUnknown");
  const key = state.publish.mock.calls[0]?.[3];
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close panel"]')!.click());
  await flush();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="reply-message-event-10"]')!.click());
  await flush();
  expect(state.publish).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[data-testid="message-thread-panel"] [data-testid="message-input"]')?.textContent).toBe("retained reply");
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="message-thread-panel"] [data-testid="send-message"]')!.click());
  await flush();
  expect(state.publish.mock.calls[1]?.[3]).toBe(key);
  expect(state.publish.mock.calls[1]?.[5]).toEqual({ messageType: "STREAM", parentEventId: "event-10" });
});

it("renders real stream events through the original shared message row and groups adjacent authors", async () => {
  state.mark.mockImplementation(async () => ({ version: 4 }));
  await open();
  await act(async () => state.receive!({ type: "event", event: event(20) }));
  await flush();
  expect(host.querySelectorAll('[data-testid="message-row"]')).toHaveLength(2);
  expect(host.querySelectorAll('[data-testid="message-avatar"]')).toHaveLength(1);
  expect(host.querySelectorAll('[data-testid="message-author"]')).toHaveLength(1);
  expect(host.querySelectorAll('[data-testid="message-timestamp"]')).toHaveLength(2);
  expect(host.querySelectorAll('[data-testid="message-timeline-day-divider"]')).toHaveLength(1);
  expect(host.querySelector('[data-testid="copy-link-message-event-20"]')).not.toBeNull();
  await act(async () => state.receive!({ type: "closed", reason: "scope-revoked" }));
  await flush();
  expect(host.querySelectorAll('[data-testid="message-row"]')).toHaveLength(0);
});

it("explicit recovery reads first and retries only the frozen request, not a newer event", async () => {
  state.mark.mockRejectedValue(new TransportError("lost ACK"));
  await open();
  const original = state.mark.mock.calls[0][0];
  await act(async () => {
    state.receive!({ type: "event", event: event(20) });
  });
  let release!: (value: UserState) => void;
  state.fetch.mockImplementationOnce(
    () =>
      new Promise<UserState>((resolve) => {
        release = resolve;
      }),
  );
  await act(async () => {
    retry().click();
    retry().click();
  });
  expect(retry().disabled).toBe(true);
  expect(state.mark).toHaveBeenCalledTimes(1);
  await act(async () => release(structuredClone(projection)));
  await flush();
  expect(state.mark).toHaveBeenCalledTimes(2);
  expect(state.mark.mock.calls[1][0]).toEqual(original);
  expect(original.lastReadAt).toBe(new Date(10_000).toISOString());
});

it("a real CAS conflict can resume after higher-version readback without a retry storm", async () => {
  state.mark.mockImplementation(async (request: ReadMarkRequest) => {
    if (request.version === 3) {
      projection.version = 4;
      throw new BffError(409, "conflict");
    }
    projection = {
      ...projection,
      version: request.version + 1,
      readContexts: { [request.contextKey]: request.lastReadAt },
    };
    return { version: projection.version };
  });
  await open();
  expect(state.mark.mock.calls.map((call) => call[0].version)).toEqual([3, 4]);
  expect(client.getQueryData<UserState>(platformQueries.userState.queryKey)?.version).toBe(5);
  await flush();
  expect(state.mark).toHaveBeenCalledTimes(2);
});

it("failed readback or revoked scope cannot turn explicit retry into a write", async () => {
  state.mark.mockRejectedValue(new TransportError("lost ACK"));
  await open();
  state.fetch.mockRejectedValueOnce(new TransportError("read unavailable"));
  await act(async () => retry().click());
  await flush();
  expect(state.mark).toHaveBeenCalledTimes(1);
  let release!: (value: UserState) => void;
  state.fetch.mockImplementationOnce(
    () =>
      new Promise<UserState>((resolve) => {
        release = resolve;
      }),
  );
  await act(async () => retry().click());
  await act(async () => state.receive!({ type: "closed", reason: "scope-revoked" }));
  await act(async () => release(structuredClone(projection)));
  await flush();
  expect(state.mark).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("PERMISSION_DENIED");
});
