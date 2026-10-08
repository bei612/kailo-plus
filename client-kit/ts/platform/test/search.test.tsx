import { act, useState } from "react";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../src/i18n";
import { TopbarSearch, type TopbarSearchProps } from "../src/react/search/TopbarSearch";
import { getChannelScopeLabel } from "../src/react/search/SearchScopeControls";
import { buildSearchResultPreview } from "../src/react/search/searchMatch";
import type { SearchResultsReader } from "../src/react/search/reader";
import type { Channel, SearchHit, UserSearchResult } from "../src/react/search/types";
import type { SearchResult } from "../src/react/search/SearchResultItem";
import { click, render, settle } from "./render";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({
    matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(),
  })) });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
beforeEach(() => setLocale("en"));

const self = "a".repeat(64);
const personKey = "b".repeat(64);
const agentKey = "c".repeat(64);
function channel(id: string, channelType: Channel["channelType"]): Channel {
  return { id, channelType, name: id, visibility: "private", description: `${id} description`,
    topic: null, purpose: null, memberCount: 2, memberPubkeys: [self, personKey],
    lastMessageAt: null, archivedAt: null, participants: ["Me", "Person"],
    participantPubkeys: [self, personKey], isMember: true, ttlSeconds: null, ttlDeadline: null };
}
const channels = [channel("stream", "stream"), channel("forum", "forum"), channel("dm", "dm")];
const user: UserSearchResult = { pubkey: personKey, displayName: "Person", avatarUrl: null,
  nip05Handle: null, ownerPubkey: null, isAgent: false };
const agent: UserSearchResult = { ...user, pubkey: agentKey, displayName: "Agent", isAgent: true };
const hit: SearchHit = { eventId: "message", content: "actual search result", kind: 9,
  pubkey: personKey, channelId: "dm", channelName: "Raw DM", createdAt: 1, score: 1 };

function reader(results: SearchResult[], state: { stale?: boolean; error?: Error; loading?: boolean } = {}): SearchResultsReader {
  return function useResultFixtures(options) {
    const [query, setQuery] = useState("");
    return { channelLookup: new Map(options.channels.map((item) => [item.id, item])), query, setQuery,
      debouncedQuery: state.stale ? "old query" : query.trim(),
      isWaitingOnFromResolution: false, resultProfiles: { [personKey]: { displayName: "Person",
        avatarUrl: null, nip05Handle: null, ownerPubkey: null } }, results,
      searchQuery: { isLoading: state.loading ?? false, error: state.error ?? null },
      userSearchQuery: { isLoading: false }, fuzzyUserCandidatesQuery: { isLoading: false } };
  };
}

async function mount(props: Partial<TopbarSearchProps> = {}, results: SearchResult[] = [], state = {}) {
  const onOpenChannel = vi.fn(); const onOpenResult = vi.fn(); const onOpenUser = vi.fn();
  const host = await render(<TopbarSearch channels={channels} currentPubkey={self}
    useResults={reader(results, state)} onOpenChannel={onOpenChannel} onOpenResult={onOpenResult}
    onOpenUser={onOpenUser} {...props} />);
  await click(host.querySelector<HTMLButtonElement>('[data-testid="open-search"]')!);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 35)); });
  await settle();
  return { host, onOpenChannel, onOpenResult, onOpenUser };
}
async function typeQuery(query = "actual") {
  const input = document.querySelector<HTMLInputElement>('[data-testid="search-dialog-input"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
  return input;
}

it("restores the original six result sections from real result facts, preserving selected user navigation", async () => {
  const { onOpenUser } = await mount({ channelLabels: { dm: "Person" } }, [
    { kind: "message", hit }, { kind: "user", user: agent }, { kind: "user", user },
    { kind: "channel", channel: channels[2]! }, { kind: "channel", channel: channels[0]! },
    { kind: "action", action: { id: "browse-channels", title: "Browse channels" } },
  ]);
  await typeQuery();
  expect([...document.querySelectorAll("[data-search-section]")].map((el) => el.getAttribute("data-search-section")))
    .toEqual(["channels", "direct-messages", "people", "agents", "messages", "actions"]);
  expect(document.querySelector('[data-testid="search-result-channel-dm"]')?.textContent).toContain("Person");
  expect(document.querySelector('[data-testid="search-result-channel-dm"]')?.textContent).not.toContain("dm description");
  await click(document.querySelector<HTMLButtonElement>(`[data-testid="search-result-user-${personKey}"]`)!);
  expect(onOpenUser).toHaveBeenCalledExactlyOnceWith(user);
});

it("restores original message context without rendering a private DM as a public channel chip", async () => {
  const { onOpenResult } = await mount({ channelLabels: { forum: "Forum alias" } }, [
    { kind: "message", hit },
    { kind: "message", hit: { ...hit, eventId: "thread", channelId: "forum", channelName: "Raw forum", kind: 45003 } },
  ]);
  await typeQuery();
  const dm = document.querySelector('[data-testid="search-result-message"]')!;
  expect(dm.textContent).toContain("Direct message");
  expect(dm.querySelector("[data-channel-link]")).toBeNull();
  const thread = document.querySelector('[data-testid="search-result-thread"]')!;
  expect(thread.textContent).toContain("Thread in");
  expect(thread.querySelector("[data-channel-link]")?.textContent).toBe("#Forum alias");
  expect(thread.querySelector("mark")?.textContent).toBe("actual");
  await click(dm as HTMLButtonElement);
  expect(onOpenResult).toHaveBeenCalledExactlyOnceWith(hit, "actual");
});

it.each(["browse-channels", "create-channel", "create-agent"] as const)("restores %s only when its real host callback exists, after search exits", async (id) => {
  const action = vi.fn();
  const props = id === "browse-channels" ? { onBrowseChannels: action } : id === "create-channel"
    ? { onCreateChannel: action } : { onCreateAgent: action };
  await mount(props);
  expect(document.querySelectorAll('[data-testid^="search-result-action-"]')).toHaveLength(1);
  const row = document.querySelector<HTMLButtonElement>(`[data-testid="search-result-action-${id}"]`)!;
  expect(row.querySelector("svg")?.classList.contains(id === "browse-channels" ? "lucide-hash-search" : id === "create-channel" ? "lucide-plus" : "lucide-bot")).toBe(true);
  await click(row);
  expect(action).not.toHaveBeenCalled();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 190)); });
  expect(action).toHaveBeenCalledOnce();
  expect(document.querySelector('[data-testid="search-results"]')).toBeNull();
});

it("does not create original action entries without an available host consumer", async () => {
  await mount();
  expect(document.querySelector('[data-testid^="search-result-action-"]')).toBeNull();
});

it("uses original DM scope labels, including participant fallback, and removes scope with Backspace", async () => {
  expect(getChannelScopeLabel(channels[2]!, undefined, self)).toBe("Person");
  expect(getChannelScopeLabel(channels[2]!, { dm: "Resolved person" }, self)).toBe("Resolved person");
  expect(getChannelScopeLabel(channels[0]!, { stream: "Alias" }, self)).toBe("#Alias");
  await mount({ currentChannelId: "dm", channelLabels: { dm: "Resolved person" } });
  const control = document.querySelector<HTMLButtonElement>('[data-testid="search-current-channel-control"]')!;
  expect(control.textContent).toContain("Search conversation with Resolved person");
  expect(control.textContent).toContain("Search messages in this conversation.");
  await click(control);
  expect(document.querySelector('[data-testid="search-channel-scope-chip"]')?.textContent).toBe("Resolved person");
  await act(async () => document.querySelector<HTMLInputElement>('[data-testid="search-dialog-input"]')!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true })));
  expect(document.querySelector('[data-testid="search-channel-scope-chip"]')).toBeNull();
});

it("retains original icon trigger and recent activity type ranking, with no archived or unauthorized stream suggestion", async () => {
  const forbidden = { ...channel("forbidden", "stream"), isMember: false };
  const archived = { ...channel("archived", "dm"), archivedAt: "2026-01-01" };
  const { host } = await mount({ variant: "icon", className: "host-slot", suggestionChannels: [...channels, forbidden, archived] });
  expect(host.querySelector('[data-testid="open-search"] kbd')).toBeNull();
  expect(host.querySelector(".host-slot")).not.toBeNull();
  expect([...document.querySelectorAll('[data-testid^="search-result-channel-"]')].map((el) => el.getAttribute("data-testid")))
    .toEqual(["search-result-channel-dm", "search-result-channel-stream", "search-result-channel-forum"]);
});

it.each(["en", "zh-CN"] as const)("covers the original search presentation in %s", async (locale) => {
  setLocale(locale);
  const { host } = await mount({ onBrowseChannels: vi.fn(), onCreateChannel: vi.fn(), currentChannelId: "dm" });
  expect(host.querySelector('[data-testid="open-search"]')?.getAttribute("aria-label"))
    .toBe(locale === "en" ? "Search everything" : "搜索全部");
  expect(document.querySelector('[data-testid="search-result-action-browse-channels"]')?.textContent)
    .toBe(locale === "en" ? "Browse channels" : "浏览频道");
  expect(document.querySelector('[data-testid="search-result-action-create-channel"]')?.textContent)
    .toBe(locale === "en" ? "Create a new channel" : "创建新频道");
  expect(document.querySelector('[data-testid="search-current-channel-control"]')?.textContent)
    .toContain(locale === "en" ? "Search conversation with " : "搜索与此成员的对话：");
  expect(buildSearchResultPreview("", "")).toBe(locale === "en" ? "No message body." : "没有消息正文。");
});

it("does not pair a stale result with newly typed query highlighting or render stale success", async () => {
  await mount({}, [{ kind: "message", hit }], { stale: true });
  await typeQuery();
  expect(document.querySelector('[data-testid="search-result-message"]')).toBeNull();
  expect(document.querySelector('[data-testid="search-results-loading"]')).not.toBeNull();
});

it("updates original action and grouped-result copy when language changes without remounting the search host", async () => {
  await mount({ onBrowseChannels: vi.fn() }, [{ kind: "user", user: agent }]);
  expect(document.querySelector('[data-testid="search-result-action-browse-channels"]')?.textContent).toBe("Browse channels");
  await act(async () => setLocale("zh-CN"));
  expect(document.querySelector('[data-testid="search-result-action-browse-channels"]')?.textContent).toBe("浏览频道");
  await typeQuery();
  expect(document.querySelector('[data-search-section="agents"]')?.textContent).toContain("Agent");
  await act(async () => setLocale("en"));
  expect(document.querySelector('[data-search-section="agents"]')?.textContent).toContain("Agents");
});
