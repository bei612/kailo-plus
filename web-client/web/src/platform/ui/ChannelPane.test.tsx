import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StreamFrame } from "../bff-client";
import { ChannelPane } from "./ChannelPane";

const state = vi.hoisted(() => ({
  cursor: 0,
  values: [] as unknown[],
  effects: [] as (() => unknown)[],
  receive: null as null | ((frame: StreamFrame) => void),
  stop: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = state.cursor++;
    if (!(index in state.values))
      state.values[index] = typeof initial === "function" ? initial() : initial;
    return [
      state.values[index],
      (value: unknown) => {
        state.values[index] = typeof value === "function" ? value(state.values[index]) : value;
      },
    ];
  },
  useEffect: (effect: () => unknown) => {
    state.effects.push(effect);
  },
  useMemo: (compute: () => unknown) => compute(),
  useCallback: (callback: unknown) => callback,
  useRef: (current: unknown) => ({ current }),
}));
vi.mock("@client-kit/platform/react/context", () => ({
  useReasonText: () => (reason: string) => reason,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: string[] }) => ({
    isSuccess: true,
    data: options.queryKey.includes("members")
      ? []
      : { version: 0, readContexts: {}, workspacePreferences: {} },
  }),
  useInfiniteQuery: () => ({ data: { pages: [] }, isSuccess: true }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ isPending: false, mutate: vi.fn() }),
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

function render() {
  state.cursor = 0;
  state.effects = [];
  return renderToStaticMarkup(<ChannelPane workspaceId="workspace-a" myPrincipalId="human-a" />);
}

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  state.values = [];
  state.stop.mockClear();
  vi.stubGlobal("document", { visibilityState: "visible" });
  render();
  state.effects[0]();
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

it.each(["session-revoked", "scope-revoked", "identity-revoked"])(
  "removes message and write controls after %s and cannot be revived by a late frame",
  (reason) => {
    expect(render()).toContain("existing message");
    expect(render()).toContain('aria-label="platform.message"');
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
    const markup = render();
    expect(markup).not.toContain("existing message");
    expect(markup).not.toContain("late message");
    expect(markup).not.toContain('aria-label="platform.message"');
    expect(markup).not.toContain('data-testid="attach-input"');
    expect(markup).toContain(
      reason === "session-revoked" ? "SESSION_NOT_ACTIVE" : "PERMISSION_DENIED",
    );
    expect(markup).not.toContain("platform.stream.synced");
  },
);

it("keeps an uncertain connection distinct from a denial", () => {
  state.receive!({ type: "closed", reason: "readmission-unavailable" });
  const markup = render();
  expect(markup).toContain("platform.stream.reconnecting");
  expect(markup).toContain("existing message");
  expect(markup).toContain('aria-label="platform.message"');
  expect(markup).not.toContain("PERMISSION_DENIED");
});
