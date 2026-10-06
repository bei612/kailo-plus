import { act, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { ChannelGroupSection } from "../src/react/sidebar/channel-group";
import { ChannelRow } from "../src/react/sidebar/channel-row";
import { ChannelContextMenuItems } from "../src/react/sidebar/channel-context-menu";
import { sortChannelsForSidebar } from "../src/react/sidebar/channel-sort";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import { click, render, settle } from "./render";

const client = createBffClient({ send: async () => { throw new Error("Presentation must not request its own authority"); } });
const channel = { id: "workspace-one", name: "General", lastMessageAt: null };

describe("shared original Buzz sidebar presentation", () => {
  it("preserves selection, unread, mute, collapse and channel creation callbacks", async () => {
    const select = vi.fn();
    const create = vi.fn();
    function Group() {
      const [collapsed, setCollapsed] = useState(false);
      return <ChannelGroupSection title="Channels" items={[channel]} hasUnread isCollapsed={collapsed}
        onToggleCollapsed={() => setCollapsed(!collapsed)} listTestId="channel-list" actionsTestId="channel-actions"
        sortMode="alpha" onSortModeChange={() => {}} onCreateChannel={create} createChannelLabel="Create channel"
        renderContextMenu={() => <ChannelContextMenuItems channel={channel} hasUnread onCopy={() => {}} />}
        renderRow={(row) => <ChannelRow channel={row} isActive hasUnread hasThreadUnread isMuted
          glyph={() => <span>#</span>} onSelectChannel={select} />} />;
    }
    const host = await render(<PlatformProvider client={client} locale="en"><TooltipProvider><Group /></TooltipProvider></PlatformProvider>);
    const row = host.querySelector<HTMLButtonElement>("[data-channel-id=workspace-one]")!;
    expect(row.dataset.active).toBe("true");
    expect(row.className).toContain("font-bold");
    expect(row.querySelector("[data-testid=channel-unread-dot-General]")).not.toBeNull();
    expect(row.querySelector("svg.lucide-bell-off")).not.toBeNull();
    await click(row);
    expect(select).toHaveBeenCalledWith(channel.id);
    await click(host.querySelector<HTMLButtonElement>("[data-testid=create-channel]")!);
    expect(create).toHaveBeenCalledTimes(1);
    await click(host.querySelector<HTMLButtonElement>("[data-testid=channel-list-section-label]")!);
    expect(host.querySelector("[data-channel-id]")).toBeNull();
    expect(host.querySelector("[data-testid=channel-list-section-label]")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps context-menu read/star/mute actions delegated to the host", async () => {
    const markRead = vi.fn();
    const star = vi.fn();
    const mute = vi.fn();
    const host = await render(<PlatformProvider client={client} locale="en"><TooltipProvider>
      <ChannelGroupSection title="Channels" items={[channel]} hasUnread isCollapsed={false}
        onToggleCollapsed={() => {}} listTestId="context-channel-list" actionsTestId="context-channel-actions"
        sortMode="alpha" onSortModeChange={() => {}}
        renderRow={() => <button>Open context</button>}
        renderContextMenu={() => <ChannelContextMenuItems channel={channel} hasUnread onCopy={() => {}}
          onMarkChannelRead={markRead} onMarkChannelUnread={() => {}}
          onStarChannel={star} onUnstarChannel={() => {}} onMuteChannel={mute} onUnmuteChannel={() => {}} />} />
    </TooltipProvider></PlatformProvider>);
    async function choose(label: string) {
      await act(async () => host.querySelector("li")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 1, clientY: 1 })));
      const item = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((node) => node.textContent === label)!;
      expect(item).toBeDefined();
      await click(item);
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      await settle();
    }
    await choose("Mark as read");
    expect(markRead).toHaveBeenCalledWith(channel.id, null);
    await choose("Star channel");
    expect(star).toHaveBeenCalledWith(channel.id);
    await choose("Mute channel");
    expect(mute).toHaveBeenCalledWith(channel.id);
  });

  it("keeps original alpha/recent ordering stable and does not mutate host rows", () => {
    const rows = [{ id: "b", name: "Beta", lastMessageAt: "2026-01-01T00:00:00Z" },
      { id: "a", name: "Alpha", lastMessageAt: "2026-01-02T00:00:00Z" },
      { id: "c", name: "Quiet", lastMessageAt: null }];
    expect(sortChannelsForSidebar(rows, "alpha").map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(sortChannelsForSidebar(rows, "recent").map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(rows.map((row) => row.id)).toEqual(["b", "a", "c"]);
  });
});
