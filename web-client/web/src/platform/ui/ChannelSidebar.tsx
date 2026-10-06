// Web adapter for the same Buzz channel groups/rows/context menus used by Desktop.
// Business preferences/read positions remain the existing Core user-state CAS authority.
import type { WorkspaceView } from "@client-kit/contracts";
import { inboxReply } from "@client-kit/platform/inbox";
import { useT } from "@client-kit/platform/react/context";
import { ChannelGroupSection, type SidebarChannel } from "@client-kit/platform/react/sidebar/channel-group";
import { ChannelContextMenuItems } from "@client-kit/platform/react/sidebar/channel-context-menu";
import { ChannelRow } from "@client-kit/platform/react/sidebar/channel-row";
import { sortChannelsForSidebar } from "@client-kit/platform/react/sidebar/channel-sort";
import { useChannelSortPreference } from "@client-kit/platform/react/sidebar/useChannelSortPreference";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { inboxReadContexts, type useInboxState } from "@client-kit/platform/react/use-inbox-state";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Hash } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { bff } from "@/platform/bff-client";
import { platformQueries } from "./queries";
import { Button } from "@/shared/ui/button";
import { inboxEvents } from "./InboxPane";

type Group = "starred" | "channels";

export function ChannelSidebar({ principalId, workspaces, selectedId, active, reads, preferencePending,
  onSelect, onCreate, onSetPreference,
}: {
  principalId: string;
  workspaces: WorkspaceView[];
  selectedId: string | null;
  active: boolean;
  reads: ReturnType<typeof useInboxState>;
  preferencePending: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onSetPreference: (id: string, next: { starred: boolean; muted: boolean }) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState<Record<Group, boolean>>({ starred: false, channels: false });
  // Tenant principal IDs already scope the Web host; no browser Relay identity is invented.
  const { sortModeFor, setSortModeFor } = useChannelSortPreference(principalId);
  const messages = useQuery({
    queryKey: ["platform", "sidebar-messages", principalId, ...workspaces.map((workspace) => workspace.id)],
    enabled: workspaces.length > 0,
    queryFn: async ({ signal }) => {
      const pages = new Map<string, ReturnType<typeof inboxEvents>>();
      for (const workspace of workspaces) {
        signal.throwIfAborted();
        const page = await bff.workspaceMessages(workspace.id);
        signal.throwIfAborted();
        pages.set(workspace.id, inboxEvents(page.events, workspace.id));
      }
      return pages;
    },
  });
  const preferences = reads.state?.workspacePreferences ?? {};
  const rows = workspaces.map((workspace) => {
    const events = messages.data?.get(workspace.id) ?? [];
    const latest = events.reduce<number | null>((at, event) => Math.max(at ?? event.createdAt, event.createdAt), null);
    return { ...workspace, lastMessageAt: latest === null ? null : new Date(latest * 1000).toISOString() };
  });
  const knownActivity = messages.isSuccess && reads.state !== null;
  const canWriteRead = knownActivity && !reads.pending && !reads.unknown && !preferencePending;
  const canWritePreference = reads.state !== null && !reads.pending && !reads.unknown && !preferencePending;
  const unread = new Set(knownActivity ? rows.filter((row) =>
    messages.data?.get(row.id)?.some((event) => event.createdAt > (reads.readAt(inboxReply(event.tags) ? `msg:${event.id}` : row.id) ?? -Infinity)),
  ).map((row) => row.id) : []);
  const mark = (ids: string[], read: boolean) => {
    if (!canWriteRead) return;
    void reads.write(inboxReadContexts(ids.flatMap((id) => messages.data?.get(id) ?? []), read))
      .then(() => queryClient.invalidateQueries({ queryKey: platformQueries.userState.queryKey }));
  };
  const updatePreference = (id: string, change: { starred?: boolean; muted?: boolean }) => {
    if (!canWritePreference) return;
    onSetPreference(id, { starred: preferences[id]?.starred ?? false, muted: preferences[id]?.muted ?? false, ...change });
  };
  const copy = (text: string, success: string) => {
    void Promise.resolve().then(() => navigator.clipboard.writeText(text))
      .then(() => toast.success(success), () => toast.error(t("platform.loadFailed")));
  };
  const group = (key: Group, items: SidebarChannel[]) => <ChannelGroupSection
    key={key} title={t(key === "starred" ? "sidebar.starred" : "sidebar.channels")}
    items={sortChannelsForSidebar(items, sortModeFor(key))}
    hasUnread={items.some((row) => unread.has(row.id))}
    isCollapsed={collapsed[key]} onToggleCollapsed={() => setCollapsed((old) => ({ ...old, [key]: !old[key] }))}
    listTestId={key === "starred" ? "starred-channel-list" : "channel-list"}
    actionsTestId={`${key}-section-actions`} sortMode={sortModeFor(key)}
    onSortModeChange={(value) => setSortModeFor(key, value)}
    onMarkAllRead={canWriteRead ? () => mark(items.map((row) => row.id), true) : undefined}
    onCreateChannel={key === "channels" ? onCreate : undefined} createChannelLabel={t("channel.create.title")}
    renderRow={(channel) => <ChannelRow channel={channel} isActive={active && selectedId === channel.id}
      hasUnread={unread.has(channel.id)} hasThreadUnread={unread.has(channel.id)}
      isMuted={preferences[channel.id]?.muted} onSelectChannel={onSelect}
      glyph={(className) => <Hash className={className} />} />}
    renderContextMenu={(channel) => <ChannelContextMenuItems channel={channel}
      hasUnread={unread.has(channel.id)} isMuted={preferences[channel.id]?.muted}
      isStarred={preferences[channel.id]?.starred} onCopy={copy}
      onMarkChannelRead={canWriteRead ? (id) => mark([id], true) : undefined}
      onMarkChannelUnread={canWriteRead ? (id) => mark([id], false) : undefined}
      onStarChannel={canWritePreference ? (id) => updatePreference(id, { starred: true }) : undefined}
      onUnstarChannel={canWritePreference ? (id) => updatePreference(id, { starred: false }) : undefined}
      onMuteChannel={canWritePreference ? (id) => updatePreference(id, { muted: true }) : undefined}
      onUnmuteChannel={canWritePreference ? (id) => updatePreference(id, { muted: false }) : undefined} />}
  />;
  const starred = rows.filter((row) => preferences[row.id]?.starred);
  return <TooltipProvider>
    {messages.isError || reads.failed ? <p role="alert" className="px-4 text-sm">
      {t("platform.loadFailed")} <Button size="sm" onClick={() => { void messages.refetch(); void reads.refresh(); }}>{t("platform.retry")}</Button>
    </p> : workspaces.length > 0 && (messages.isPending || reads.state === null) ? <p role="status" className="px-4 text-sm">{t("platform.loading")}</p> : null}
    {starred.length > 0 ? group("starred", starred) : null}
    {group("channels", rows.filter((row) => !preferences[row.id]?.starred))}
  </TooltipProvider>;
}
