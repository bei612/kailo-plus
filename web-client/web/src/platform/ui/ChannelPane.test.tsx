// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StreamFrame } from "../bff-client";
import { ChannelPane } from "./ChannelPane";

// Isolate the stream lifecycle from the rich editor. Original Tiptap is mounted
// by Composer/ChannelRead tests; the channel and original message rows mount here.
vi.mock("@tiptap/react", async (original) => ({
  ...(await original<typeof import("@tiptap/react")>()), useEditor: () => null,
}));

const state = vi.hoisted(() => ({
  receive: null as null | ((frame: StreamFrame) => void),
  stop: vi.fn(),
  reason: (reason: string) => reason,
  members: { isSuccess: true, data: [] },
  userState: { isSuccess: true, data: { version: 0, readContexts: {}, workspacePreferences: {} } },
  infinite: { data: { pages: [] }, isSuccess: true },
  queryClient: { invalidateQueries: vi.fn() },
  mutation: { isPending: false, mutate: vi.fn() },
}));
vi.mock("@client-kit/platform/react/context", () => ({
  useReasonText: () => state.reason,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: string[] }) => options.queryKey.includes("members") ? state.members : state.userState,
  useInfiniteQuery: () => state.infinite,
  useQueryClient: () => state.queryClient,
  useMutation: () => state.mutation,
}));
vi.mock("@/platform/bff-client", () => ({
  bff: { members: vi.fn(), workspaces: vi.fn() },
  BffError: class extends Error {},
  fetchUserState: vi.fn(),
  markRead: vi.fn(),
  publishMessage: vi.fn(),
  uploadMedia: vi.fn(),
  openStream: (_workspace: string, receive: (frame: StreamFrame) => void) => {
    state.receive = receive;
    return state.stop;
  },
}));
vi.mock("@/features/chat/ui/MessageContent", () => ({
  MessageContent: ({ content }: { content: string }) => <span>{content}</span>,
}));
vi.mock("@/shared/i18n", () => ({ t: (key: string) => key }));
vi.mock("@/shared/lib/relative-time", () => ({ relativeTime: () => "now" }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
function render() { return host.innerHTML; }
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
beforeEach(async () => {
  state.stop.mockClear();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<TooltipProvider><ChannelPane workspaceId="workspace-a" myPrincipalId="human-a" /></TooltipProvider>); });
  await act(async () => {
  state.receive!({
    type: "snapshot",
    events: [
      {
        id: "event-a",
        pubkey: "author-a",
        kind: 9,
        created_at: 1,
        tags: [],
        content: "existing message",
      },
    ],
  });
  state.receive!({ type: "live" });
  });
});

it.each(["session-revoked", "scope-revoked", "identity-revoked"])(
  "removes message and write controls after %s and cannot be revived by a late frame",
  async (reason) => {
    expect(render()).toContain("existing message");
    expect(render()).toContain('data-testid="message-composer"');
    await act(async () => {
    state.receive!({ type: "closed", reason });
    state.receive!({ type: "live" });
    state.receive!({
      type: "snapshot",
      events: [
        {
          id: "late",
          pubkey: "author-a",
          kind: 9,
          created_at: 2,
          tags: [],
          content: "late message",
        },
      ],
    });
    });
    const markup = render();
    expect(markup).not.toContain("existing message");
    expect(markup).not.toContain("late message");
    expect(markup).not.toContain('data-testid="message-composer"');
    expect(markup).not.toContain('data-testid="attach-input"');
    expect(markup).toContain(
      reason === "session-revoked" ? "SESSION_NOT_ACTIVE" : "PERMISSION_DENIED",
    );
    expect(markup).not.toContain("platform.stream.synced");
  },
);

it("keeps an uncertain connection distinct from a denial", async () => {
  await act(async () => state.receive!({ type: "closed", reason: "readmission-unavailable" }));
  const markup = render();
  expect(markup).toContain("platform.stream.reconnecting");
  expect(markup).toContain("existing message");
  expect(markup).toContain('data-testid="message-composer"');
  expect(markup).not.toContain("PERMISSION_DENIED");
});
