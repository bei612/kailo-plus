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
  members: vi.fn(),
  reason: (value: string) => value,
}));
vi.mock("@client-kit/platform/react/context", async (original) => ({
  ...await original<typeof import("@client-kit/platform/react/context")>(), useReasonText: () => state.reason,
}));
vi.mock("./BrowserNotifications", () => ({ useBrowserNotifications: () => ({ notify: state.notify, settings: { homeBadgeEnabled: true } }) }));
vi.mock("@/platform/bff-client", async () => ({
  BffError: (await import("@client-kit/platform/transport")).BffError,
  bff: {
    members: () => state.members(),
    workspaces: async () => [],
    agentInstallations: async () => ({ installations: [] }),
  },
  fetchUserState: () => state.fetch(),
  markRead: (request: ReadMarkRequest) => state.mark(request),
  publishMessage: vi.fn(),
  uploadMedia: vi.fn(),
  openStream: (_workspace: string, receive: (frame: StreamFrame) => void) => {
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
async function flush() {
  // Exercise real React effects and Query's notification queue repeatedly.
  for (let i = 0; i < 20; i++)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
}
async function open() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TooltipProvider><ChannelPane workspaceId="workspace-a" myPrincipalId="human-a" /></TooltipProvider>
      </QueryClientProvider>,
    );
  });
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
beforeEach(() => {
  setLocale("en");
  vi.useFakeTimers();
  vi.clearAllMocks();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  projection = { version: 3, readContexts: {}, workspacePreferences: {} };
  state.fetch.mockImplementation(async () => structuredClone(projection));
  state.members.mockResolvedValue([]);
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
