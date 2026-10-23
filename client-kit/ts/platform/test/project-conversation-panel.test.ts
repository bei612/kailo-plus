// Buzz 779af8886caae1317b4de962082429867ab61503 DiscussionChannels.tsx::openDiscussionHit order.
import { describe, expect, it, vi } from "vitest";
import { openDiscussionHit } from "../src/react/projects/ProjectConversationPanelContext";
import type { SearchHit } from "../src/react/search/types";

const hit = (kind: number): SearchHit => ({ eventId: "e", content: "", kind, pubkey: "p", channelId: "c", channelName: "general", createdAt: 1, score: 1 });

describe("original Discussed-in navigation inside project detail", () => {
  it("opens the conversation panel for a channel message hit", async () => {
    const panel = { openConversation: vi.fn() }, openChannel = vi.fn(), openHit = vi.fn();
    await openDiscussionHit({ channelId: "c", latestHit: hit(9), panel, openChannel, openHit });
    expect(panel.openConversation).toHaveBeenCalledWith(hit(9));
    expect(openHit).not.toHaveBeenCalled(); expect(openChannel).not.toHaveBeenCalled();
  });
  it("keeps message-link navigation for forum posts/comments and outside project detail", async () => {
    const panel = { openConversation: vi.fn() }, openChannel = vi.fn(), openHit = vi.fn();
    await openDiscussionHit({ channelId: "c", latestHit: hit(45001), panel, openChannel, openHit });
    await openDiscussionHit({ channelId: "c", latestHit: hit(45003), panel, openChannel, openHit });
    await openDiscussionHit({ channelId: "c", latestHit: hit(9), panel: null, openChannel, openHit });
    expect(openHit).toHaveBeenCalledTimes(3);
    expect(panel.openConversation).not.toHaveBeenCalled();
  });
  it("opens the channel when there is no hit", async () => {
    const openChannel = vi.fn(), openHit = vi.fn();
    await openDiscussionHit({ channelId: "c", latestHit: undefined, panel: { openConversation: vi.fn() }, openChannel, openHit });
    expect(openChannel).toHaveBeenCalledWith("c");
  });
});
