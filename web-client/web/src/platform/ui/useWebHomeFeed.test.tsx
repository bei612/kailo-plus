// @vitest-environment jsdom
// Shell Home feed: badge kept on every view and background alerts by the original rules.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@client-kit/platform/i18n";
import type { BffClient } from "@client-kit/platform/client";
import type { ConversationVisibilityHost } from "@client-kit/platform/react/new-message";
import type { InboxSnapshot } from "./inbox-snapshot";
import type { Event } from "./inbox-events";
import { HOME_FEED_POLL_MS, homeFeedNotifications, useWebHomeFeed } from "./useWebHomeFeed";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Notify = { eventId: string; title: string; body: string; slot: string; onOpen: () => void };
const state = vi.hoisted(() => ({
  next: null as null | Omit<InboxSnapshot, "scope">,
  loads: 0,
  notify: vi.fn<(message: Notify) => void>(),
  // The shell's real inputs are module constants (bff, conversationVisibility) and a memoized
  // ProjectsHost; the doubles must be just as stable or every render would restart the feed.
  projectsHost: {},
}));
vi.mock("./inbox-snapshot", async (original) => ({
  ...await original<typeof import("./inbox-snapshot")>(),
  loadInboxSnapshot: async ({ scope }: { scope: object }) => {
    state.loads += 1;
    return state.next ? { ...state.next, scope } : null;
  },
}));
vi.mock("./ProjectsPane", () => ({ useProjectsHost: () => state.projectsHost }));
vi.mock("./BrowserNotifications", () => ({ useBrowserNotifications: () => ({ notify: state.notify }) }));

const own = "a".repeat(64), peer = "b".repeat(64), author = "c".repeat(64), root = "d".repeat(64);
const event = (id: string, channelId: string, nativeId: string, createdAt: number, extra: Partial<Event> = {}): Event => {
  const { tags = [], ...rest } = extra;
  return { id, pubkey: author, kind: 9, created_at: createdAt, createdAt, content: `${id} body`,
    tags: [["h", nativeId], ...tags], channelId, category: "activity", ...rest };
};
const dm = (id: string, at: number) => event(id, "dm-native", "dm-native", at, { pubkey: peer, channelType: "dm" });
const mention = (id: string, workspace: string, at: number) =>
  event(id, workspace, `native-${workspace}`, at, { category: "mention", tags: [["p", own]] });
const reply = (id: string, at: number) =>
  event(id, "w1", "native-w1", at, { tags: [["e", root, "", "root"], ["e", root, "", "reply"]] });
function snapshot({ mentions = [], activity = [], interest = [] }: { mentions?: Event[]; activity?: Event[]; interest?: string[] }): Omit<InboxSnapshot, "scope"> {
  return {
    mentions, activity, interestReplyIds: new Set(interest), projectItems: [],
    workspaces: [{ id: "w1", name: "general", isMember: true }, { id: "w2", name: "open", isMember: true }] as unknown as InboxSnapshot["workspaces"],
    channelIds: new Map([["w1", "native-w1"], ["w2", "native-w2"]]), forumChannels: new Set(),
    members: new Map([["w1", [{ principalId: "author", displayName: "Author", pubkeys: [author] }]]]) as unknown as InboxSnapshot["members"],
    agentPubkeys: new Set(),
    conversations: [{ id: "conversation", channelId: "dm-native", state: "ACTIVE", participantPrincipalIds: ["me", "peer"] }] as unknown as InboxSnapshot["conversations"],
    people: [{ principalId: "peer", displayName: "Peer", pubkeys: [peer] }] as unknown as InboxSnapshot["people"],
    hiddenDm: new Set(),
  };
}
const reads = (preferences: { workspace?: Record<string, { muted: boolean }>; conversation?: Record<string, { muted: boolean }> } = {}) => ({
  state: { version: 1, readContexts: {}, workspacePreferences: preferences.workspace ?? {}, conversationPreferences: preferences.conversation ?? {} },
  failed: false, unknown: false, readAt: () => null, visibleChannels: new Set(["w1", "w2", "dm-native"]),
}) as unknown as Parameters<typeof useWebHomeFeed>[0]["reads"];

const client = {} as BffClient;
const visibility = {} as ConversationVisibilityHost;
let host: HTMLDivElement;
let root_: Root;
let result: ReturnType<typeof useWebHomeFeed>;
const onOpen = vi.fn(async () => undefined);
function Probe({ positions, activeWorkspaceId = "w2" }: { positions: ReturnType<typeof reads>; activeWorkspaceId?: string }) {
  result = useWebHomeFeed({ client, visibility, principalId: "me",
    reads: positions, activeWorkspaceId, activeConversationChannelId: null, onOpen });
  return null;
}
async function poll() {
  await act(async () => { await vi.advanceTimersByTimeAsync(HOME_FEED_POLL_MS); });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setLocale("en");
  vi.useFakeTimers();
  state.next = null;
  state.loads = 0;
  state.notify.mockReset();
  onOpen.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root_ = createRoot(host);
});
afterEach(async () => {
  await act(async () => root_.unmount());
  host.remove();
  vi.useRealTimers();
});

it("classifies DMs, mentions and interest thread replies once, oldest first", () => {
  const items = homeFeedNotifications({ ...snapshot({
    mentions: [mention("m1", "w1", 3), { ...dm("dm-mention", 1), category: "mention" }],
    activity: [dm("d1", 2), reply("t1", 4), reply("other", 5), { ...dm("dm-mention", 1) }],
    interest: ["t1"],
  }), scope: {} });
  expect(items.map(({ event, source }) => [event.id, source])).toEqual([
    ["dm-mention", "dm"], ["d1", "dm"], ["m1", "mention"], ["t1", "thread_reply"],
  ]);
});

it("keeps the Home badge across views and alerts only items that arrive after the first feed", async () => {
  state.next = snapshot({ activity: [dm("d1", 1)] });
  const positions = reads();
  await act(async () => root_.render(<Probe positions={positions} />));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(state.loads).toBe(1);
  expect(result.unreadCount).toBe(1);
  // Original first-load rule: what is already there is seen, not alerted.
  expect(state.notify).not.toHaveBeenCalled();

  state.next = snapshot({
    activity: [dm("d1", 1), dm("d2", 6), reply("t1", 7)], interest: ["t1"],
    mentions: [mention("m1", "w1", 5), mention("open-scope", "w2", 8)],
  });
  await poll();
  expect(state.loads).toBe(2);
  expect(state.notify.mock.calls.map(([message]) => [message.eventId, message.slot])).toEqual([
    ["m1", "mention"], ["d2", "dm"], ["t1", "thread_reply"],
  ]);
  expect(state.notify.mock.calls[1]![0].title).toBe("Peer");
  state.notify.mock.calls[0]![0].onOpen();
  expect(onOpen).toHaveBeenCalledWith("native-w1", { eventId: "m1", threadRootId: null });

  // The same feed again alerts nothing new.
  await poll();
  expect(state.notify).toHaveBeenCalledTimes(3);
});

it("honors mute for DMs and thread replies but still alerts mentions", async () => {
  state.next = snapshot({});
  const positions = reads({ workspace: { w1: { muted: true } }, conversation: { conversation: { muted: true } } });
  await act(async () => root_.render(<Probe positions={positions} activeWorkspaceId="none" />));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  state.next = snapshot({ activity: [dm("d1", 2), reply("t1", 3)], interest: ["t1"], mentions: [mention("m1", "w1", 4)] });
  await poll();
  expect(state.notify.mock.calls.map(([message]) => message.eventId)).toEqual(["m1"]);
});
