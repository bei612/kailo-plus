// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import { ChannelSidebar } from "./ChannelSidebar";

const snapshot = vi.hoisted(() => ({ failed: false }));
vi.mock("@client-kit/platform/react/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ isSuccess: !snapshot.failed, isError: snapshot.failed, data: new Map([
    ["one", [{ id: "one-event", channelId: "one", createdAt: 30, tags: [] }]],
    ["two", [{ id: "two-event", channelId: "two", createdAt: 10, tags: [] }]],
  ]) }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@client-kit/platform/react/sidebar/channel-group", () => ({
  ChannelGroupSection: ({ title, items, renderRow, renderContextMenu }: {
    title: string; items: { id: string }[]; renderRow: (row: { id: string }) => ReactNode; renderContextMenu: (row: { id: string }) => ReactNode;
  }) => <section data-group={title}>{items.map((row) => <div key={row.id}>{renderRow(row)}{renderContextMenu(row)}</div>)}</section>,
}));
vi.mock("@client-kit/platform/react/sidebar/channel-row", () => ({
  ChannelRow: ({ channel, isActive, hasUnread }: { channel: { id: string }; isActive: boolean; hasUnread: boolean }) =>
    <button data-id={channel.id} data-active={isActive} data-unread={hasUnread} />,
}));
vi.mock("@client-kit/platform/react/sidebar/channel-context-menu", () => ({
  ChannelContextMenuItems: ({ channel, onMarkChannelRead, onStarChannel }: {
    channel: { id: string }; onMarkChannelRead?: unknown; onStarChannel?: unknown;
  }) => <span data-menu={channel.id} data-read-enabled={Boolean(onMarkChannelRead)} data-star-enabled={Boolean(onStarChannel)} />,
}));
vi.mock("@client-kit/platform/react/sidebar/useChannelSortPreference", () => ({ useChannelSortPreference: () => ({ sortModeFor: () => "alpha", setSortModeFor: vi.fn() }) }));
vi.mock("@client-kit/platform/react/sidebar/tooltip", () => ({ TooltipProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("./InboxPane", () => ({ inboxEvents: vi.fn() }));
vi.mock("@/platform/bff-client", () => ({ bff: {}, fetchUserState: vi.fn() }));

const reads: ComponentProps<typeof ChannelSidebar>["reads"] = {
  state: { version: 3, readContexts: {}, workspacePreferences: { one: { starred: true, muted: false } } },
  failed: false, unknown: false, pending: false, refresh: vi.fn(), write: vi.fn(), readAt: () => 20, visibleChannels: new Set(["one", "two"]),
};
function markup(overrides: Partial<typeof reads> = {}) {
  return renderToStaticMarkup(<ChannelSidebar principalId="me" workspaces={[{ id: "one", name: "One", slug: "one" }, { id: "two", name: "Two", slug: "two" }]}
    selectedId="two" active reads={{ ...reads, ...overrides }} preferencePending={false}
    onSelect={vi.fn()} onCreate={vi.fn()} onSetPreference={vi.fn()} />);
}
it("projects admitted workspaces into the original starred/channel groups with canonical read positions", () => {
  snapshot.failed = false;
  const html = markup();
  expect(html).toContain('data-group="sidebar.starred"');
  expect(html).toContain('data-id="one" data-active="false" data-unread="true"');
  expect(html).toContain('data-id="two" data-active="true" data-unread="false"');
  expect(html).toContain('data-read-enabled="true" data-star-enabled="true"');
});
it("does not expose read/preference writes while the authoritative CAS outcome is unknown", () => {
  snapshot.failed = false;
  const html = markup({ unknown: true });
  expect(html).not.toContain('data-read-enabled="true"');
  expect(html).not.toContain('data-star-enabled="true"');
});
it("renders a failed activity observation as an error, not a confirmed read state", () => {
  snapshot.failed = true;
  const html = markup();
  expect(html).toContain('role="alert"');
  expect(html).not.toContain('data-read-enabled="true"');
  snapshot.failed = false;
});
