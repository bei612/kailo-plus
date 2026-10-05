// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BffError, TransportError } from "@client-kit/platform/transport";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReadMarkRequest } from "@client-kit/contracts";
import type { StreamFrame, UserState } from "../bff-client";
import { ChannelPane } from "./ChannelPane";
import { platformQueries } from "./queries";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({
  receive: null as null | ((frame: StreamFrame) => void),
  fetch: vi.fn(),
  mark: vi.fn(),
  reason: (value: string) => value,
}));
vi.mock("@client-kit/platform/react/context", () => ({ useReasonText: () => state.reason }));
vi.mock("@/platform/bff-client", async () => ({
  BffError: (await import("@client-kit/platform/transport")).BffError,
  bff: {
    members: async () => [],
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
        <ChannelPane workspaceId="workspace-a" myPrincipalId="human-a" />
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
  vi.useFakeTimers();
  vi.clearAllMocks();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  projection = { version: 3, readContexts: {}, workspacePreferences: {} };
  state.fetch.mockImplementation(async () => structuredClone(projection));
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
