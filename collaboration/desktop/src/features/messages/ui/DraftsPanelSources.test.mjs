import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://client.invalid" });
before(() => {
  Object.assign(globalThis, {
    document: dom.window.document, Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
    getComputedStyle: dom.window.getComputedStyle,
    MutationObserver: dom.window.MutationObserver, window: dom.window,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true,
  });
  dom.window.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}});
  dom.window.requestAnimationFrame = () => 0;
});
afterEach(async () => {
  const { cleanup } = await import("@testing-library/react");
  const { clearAllDrafts } = await import("./../lib/useDrafts.ts");
  cleanup(); clearAllDrafts(); dom.window.localStorage.clear();
});
after(() => dom.window.close());

for (const locale of ["en", "zh-CN"]) {
  test(`native draft sources consume the original identity and participant-profile queries (${locale})`, async () => {
    const { createElement, act } = await import("react");
    const { render, waitFor } = await import("@testing-library/react");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { PlatformProvider } = await import("@client-kit/platform/react/context");
    const { DraftListSurface, DraftDetailSurface } = await import("@client-kit/platform/react/draft-surfaces");
    const { TooltipProvider } = await import("@/shared/ui/tooltip");
    const { setLocale } = await import("@client-kit/platform/i18n");
    const { ActiveCommunityProvider } = await import("@/features/platform/activeCommunity");
    const { useDraftViewItems, toDraftSurfaceItem } = await import("./DraftsPanel.tsx");
    const { initDraftStore, saveDraftEntry } = await import("../lib/useDrafts.ts");
    setLocale(locale);
    const self = "a".repeat(64), peerKeys = ["b", "c", "d", "e", "f"].map(char => char.repeat(64));
    const channel = {
      id: "private-draft-channel", name: "DM", channelType: "dm", visibility: "private",
      description: "", topic: null, purpose: null, memberCount: 6,
      memberPubkeys: [self, ...peerKeys], lastMessageAt: null, archivedAt: null,
      participants: ["Me", "Old first", "Old second", "Old third", "Old fourth", "Old duplicate"],
      participantPubkeys: [self.toUpperCase(), ...peerKeys], isMember: true,
      ttlSeconds: null, ttlDeadline: null,
    };
    const unrelated = {...channel, id: "unrelated-channel", participantPubkeys: ["1".repeat(64)]};
    const profiles = Object.fromEntries([self, ...peerKeys].map((key, index) => [key, {
      displayName: ["Me", "First", "Second", "Third", "Fourth", "Fourth"][index],
      avatarUrl: null, nip05Handle: null, ownerPubkey: null,
    }]));
    const cache = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0, staleTime: Infinity}}});
    cache.setQueryData(["identity"], {pubkey: self});
    cache.setQueryData(["channels"], [channel, unrelated]);
    cache.setQueryData(["platform", "workspace-visibility", self], []);
    const profileKey = ["users-batch", ...[self, ...peerKeys].sort()];
    cache.setQueryData(profileKey, {profiles, missing: []});
    initDraftStore(self, "https://relay.invalid");
    saveDraftEntry(channel.id, {content: "retained draft", channelId: channel.id, createdAt: "2026-10-08T00:00:00Z", updatedAt: "2026-10-08T00:00:00Z", selectionStart: 0, selectionEnd: 0, pendingImeta: [], spoileredAttachmentUrls: [], status: "active"});
    function Consumer() {
      const items = useDraftViewItems(true).map(toDraftSurfaceItem);
      const props = {onOpen() {}, onSend() {}, onDelete() {}, renderPreview: draft => createElement("span", null, draft.content)};
      return createElement("section", null,
        createElement(DraftListSurface, {...props, items, selectedKey: channel.id, onSelect() {}}),
        createElement(DraftDetailSurface, {...props, item: items[0] ?? null}),
      );
    }
    let view;
    try {
      view = render(createElement(PlatformProvider, {client: {}, locale},
        createElement(ActiveCommunityProvider, {session: {facts: {communityHost: "relay.invalid", relayUrl: "https://relay.invalid"}}},
          createElement(QueryClientProvider, {client: cache}, createElement(TooltipProvider, null, createElement(Consumer))))));
      const expected = locale === "en" ? "First, Second, Third, +1 more" : "First, Second, Third, +1 人";
      assert.equal(view.container.querySelector('[data-testid="home-inbox-draft-detail"] h2')?.textContent, expected);
      assert.ok(view.container.querySelector('[data-testid="home-inbox-drafts-list"]')?.textContent.includes(expected));
      assert.equal(cache.getQueryCache().find({queryKey: profileKey, exact: true})?.getObserversCount(), 1);
      assert.equal(cache.getQueryCache().findAll({queryKey: ["users-batch"]}).length, 1);
      await act(async () => cache.setQueryData(profileKey, {profiles: {...profiles, [peerKeys[0]]: {...profiles[peerKeys[0]], displayName: "Updated"}}, missing: []}));
      await waitFor(() => assert.equal(view.container.querySelector('[data-testid="home-inbox-draft-detail"] h2')?.textContent, expected.replace("First", "Updated")));
      await act(async () => cache.setQueryData(["channels"], [{...channel, name: "Authored group title"}]));
      await waitFor(() => assert.equal(view.container.querySelector('[data-testid="home-inbox-draft-detail"] h2')?.textContent, "Authored group title"));
    } finally {view?.unmount(); cache.clear();}
  });
}
