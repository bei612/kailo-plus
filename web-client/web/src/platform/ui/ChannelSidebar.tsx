// Web adapter for the same Buzz channel groups/rows/context menus used by Desktop.
// Business preferences/read positions remain the existing Core user-state CAS authority.
import { ChannelType, WebMessageType, type WorkspaceView } from "@client-kit/contracts";
import { useT } from "@client-kit/platform/react/context";
import { ChannelGroupSection, type SidebarChannel } from "@client-kit/platform/react/sidebar/channel-group";
import { ChannelContextMenuItems } from "@client-kit/platform/react/sidebar/channel-context-menu";
import { ChannelRow } from "@client-kit/platform/react/sidebar/channel-row";
import { sortChannelsForSidebar } from "@client-kit/platform/react/sidebar/channel-sort";
import { useChannelSortPreference } from "@client-kit/platform/react/sidebar/useChannelSortPreference";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { inboxReadContexts, type useInboxState } from "@client-kit/platform/react/use-inbox-state";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChannelGlyph } from "@client-kit/platform/react/channel-glyph";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { bff } from "@/platform/bff-client";
import { platformQueries } from "./queries";
import { Button } from "@/shared/ui/button";
import { inboxWindowEvents } from "./inbox-events";
import { FeatureGate } from "@client-kit/platform/react/features";

type Group = "starred" | "channels" | "forums";

export function ChannelSidebar({ principalId, workspaces, selectedId, active, reads, preferencePending,
  onSelect, onCreate, onCreateForum, onSetPreference, onActivity, onUnreadChange,
}: {
  principalId: string;
  workspaces: WorkspaceView[];
  selectedId: string | null;
  active: boolean;
  reads: ReturnType<typeof useInboxState>;
  preferencePending: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onCreateForum: () => void;
  onSetPreference: (id: string, next: { starred: boolean; muted: boolean }) => void;
  onActivity?: (activity: ReadonlyMap<string, string | null>) => void;
  onUnreadChange?: (unread: ReadonlySet<string>) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState<Record<Group, boolean>>({ starred: false, channels: false, forums: false });
  // Tenant principal IDs already scope the Web host; no browser Relay identity is invented.
  const { sortModeFor, setSortModeFor } = useChannelSortPreference(principalId);
  const joined = workspaces.filter((workspace) => workspace.isMember === true);
  const messages = useQuery({
    queryKey: ["platform", "sidebar-messages", principalId, ...joined.map((workspace) => workspace.id)],
    enabled: joined.length > 0,
    queryFn: async ({ signal }) => {
      const pages = new Map<string, { channelId: string; channelType: ChannelType; events: ReturnType<typeof inboxWindowEvents> }>();
      for (const workspace of joined) {
        signal.throwIfAborted();
        const channel = await bff.workspaceChannel(workspace.id);
        signal.throwIfAborted();
        if (channel.channelType !== ChannelType.Stream && channel.channelType !== ChannelType.Forum) throw new Error("Invalid channel type");
        const forumPosts = channel.channelType === ChannelType.Forum;
        const page = await bff.workspaceMessages(workspace.id, { messageType: forumPosts ? WebMessageType.ForumPost : WebMessageType.Stream });
        signal.throwIfAborted();
        pages.set(workspace.id, { channelId: channel.channelId, channelType: channel.channelType, events: inboxWindowEvents(page.events, channel.channelId, forumPosts) });
      }
      return pages;
    },
  });
  const preferences = reads.state?.workspacePreferences ?? {};
  const activity = useMemo(() => new Map([...(!messages.isError ? messages.data ?? [] : [])].map(([id, { events }]) => {
    const latest = events.reduce<number | null>((at, event) => Math.max(at ?? event.createdAt, event.createdAt), null);
    return [id, latest === null ? null : new Date(latest * 1000).toISOString()] as const;
  })), [messages.data, messages.isError]);
  useEffect(() => { onActivity?.(activity); }, [activity, onActivity]);
  const rows = workspaces.map((workspace) => {
    const events = workspace.isMember === true ? messages.data?.get(workspace.id)?.events ?? [] : [];
    const latest = events.reduce<number | null>((at, event) => Math.max(at ?? event.createdAt, event.createdAt), null);
    return { ...workspace,
      channelType: !messages.isError && workspace.isMember === true ? messages.data?.get(workspace.id)?.channelType : undefined,
      lastMessageAt: latest === null ? null : new Date(latest * 1000).toISOString() };
  });
  const knownActivity = messages.isSuccess && !messages.isFetching && reads.state !== null;
  const canWriteRead = knownActivity && !reads.pending && !reads.unknown && !preferencePending;
  const canWritePreference = reads.state !== null && !reads.pending && !reads.unknown && !preferencePending;
  const unread = useMemo(() => new Set(knownActivity ? workspaces.filter((row) =>
    row.isMember === true && messages.data?.get(row.id)?.events.some((event) => event.createdAt > (reads.eventReadAt(event) ?? -Infinity)),
  ).map((row) => row.id) : []), [knownActivity, workspaces, messages.data, reads.eventReadAt]);
  useEffect(() => { onUnreadChange?.(unread); }, [unread, onUnreadChange]);
  const mark = (ids: string[], read: boolean) => {
    if (!canWriteRead) return;
    void reads.write(inboxReadContexts(ids.flatMap((id) => messages.data?.get(id)?.events ?? []), read))
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
  const group = (key: Group, items: (SidebarChannel & { channelType?: ChannelType })[]) => <ChannelGroupSection
    key={key} title={t(key === "starred" ? "sidebar.starred" : key === "forums" ? "sidebar.forums" : "sidebar.channels")}
    items={sortChannelsForSidebar(items, sortModeFor(key))}
    hasUnread={items.some((row) => unread.has(row.id))}
    isCollapsed={collapsed[key]} onToggleCollapsed={() => setCollapsed((old) => ({ ...old, [key]: !old[key] }))}
    listTestId={key === "starred" ? "starred-channel-list" : key === "forums" ? "forum-list" : "channel-list"}
    actionsTestId={`${key}-section-actions`} sortMode={sortModeFor(key)}
    onSortModeChange={(value) => setSortModeFor(key, value)}
    onMarkAllRead={canWriteRead ? () => mark(items.map((row) => row.id), true) : undefined}
    onCreateChannel={key === "channels" ? onCreate : key === "forums" ? onCreateForum : undefined}
    createChannelLabel={t(key === "forums" ? "sidebar.newForum" : "channel.browser.title")}
    createTestId={key === "forums" ? "create-forum" : "create-channel"}
    renderRow={(channel) => <ChannelRow channel={channel} isActive={active && selectedId === channel.id}
      hasUnread={unread.has(channel.id)} hasThreadUnread={unread.has(channel.id)}
      isMuted={preferences[channel.id]?.muted} onSelectChannel={onSelect}
      glyph={(className) => <ChannelGlyph className={className} channel={{ channelType: channel.channelType, visibility: workspaces.find((workspace) => workspace.id === channel.id)?.visibility }} />} />}
    renderContextMenu={(channel) => <ChannelContextMenuItems channel={channel}
      copyChannelId={messages.isSuccess && !messages.isFetching && joined.some((row) => row.id === channel.id)
        ? messages.data?.get(channel.id)?.channelId ?? null : null}
      hasUnread={unread.has(channel.id)} isMuted={preferences[channel.id]?.muted}
      isStarred={preferences[channel.id]?.starred} onCopy={copy}
      onMarkChannelRead={canWriteRead && joined.some((row) => row.id === channel.id) ? (id) => mark([id], true) : undefined}
      onMarkChannelUnread={canWriteRead && joined.some((row) => row.id === channel.id) ? (id) => mark([id], false) : undefined}
      onStarChannel={key !== "forums" && canWritePreference ? (id) => updatePreference(id, { starred: true }) : undefined}
      onUnstarChannel={key !== "forums" && canWritePreference ? (id) => updatePreference(id, { starred: false }) : undefined}
      onMuteChannel={canWritePreference ? (id) => updatePreference(id, { muted: true }) : undefined}
      onUnmuteChannel={canWritePreference ? (id) => updatePreference(id, { muted: false }) : undefined} />}
  />;
  const streamRows = rows.filter((row) => row.channelType === "stream" || (row.isMember !== true && row.channelType === undefined));
  const starred = streamRows.filter((row) => preferences[row.id]?.starred);
  return <TooltipProvider>
    {messages.isError || reads.failed ? <p role="alert" className="px-4 text-sm">
      {t("platform.loadFailed")} <Button size="sm" onClick={() => { void messages.refetch(); void reads.refresh(); }}>{t("platform.retry")}</Button>
    </p> : joined.length > 0 && (messages.isPending || reads.state === null) ? <p role="status" className="px-4 text-sm">{t("platform.loading")}</p> : null}
    {starred.length > 0 ? group("starred", starred) : null}
    {group("channels", streamRows.filter((row) => !preferences[row.id]?.starred))}
    <FeatureGate feature="forum">{group("forums", rows.filter((row) => row.channelType === "forum"))}</FeatureGate>
  </TooltipProvider>;
}
