// Shell-level Home feed for the Web host: the Home badge and background system notifications
// for every admitted channel and DM, not only the open one (REQ-24, DD-74, SS-WEB-RELAY).
//
// Buzz 779af8886caae1317b4de962082429867ab61503:
// - features/home/hooks.ts polls the Home feed every 30 s while connected; AppShell keeps the
//   Home badge from it on every view (features/notifications/hooks.ts useHomeFeedNotificationState).
// - features/notifications/use-feed-desktop-notifications.ts marks the first feed as seen without
//   alerting and then alerts each new item once; app/useAppShellDesktopNotifications.ts adds DM
//   and thread-reply alerts, gated by the notification settings (BrowserNotifications).
// The Web browser has no Relay subscription (DD-39): it re-reads the same admitted Inbox snapshot
// InboxPane uses, on the original 30 s cadence and on window focus. The open channel or DM keeps
// its own live alerts (ChannelPane); this host leaves that scope to it.
import { inboxReadContext, inboxThread } from "@client-kit/platform/inbox";
import type { BffClient } from "@client-kit/platform/client";
import type { ConversationVisibilityHost } from "@client-kit/platform/react/new-message";
import { formatMessageNotification, type MessageNotificationSource } from "@client-kit/platform/react/notifications";
import type { useInboxState } from "@client-kit/platform/react/use-inbox-state";
import { useEffect, useMemo, useRef, useState } from "react";
import { useBrowserNotifications } from "./BrowserNotifications";
import { inboxReadItem, inboxRows, inboxUnreadRowCount, loadInboxSnapshot, type InboxEvent, type InboxSnapshot } from "./inbox-snapshot";
import type { Event } from "./inbox-events";
import { useProjectsHost } from "./ProjectsPane";

/** Original HOME_FEED_POLL_INTERVAL_MS (features/home/hooks.ts). */
export const HOME_FEED_POLL_MS = 30_000;

export type HomeFeedNotification = { event: Event; source: MessageNotificationSource };

/**
 * The items of one snapshot that may alert, by the original rules: every DM message from someone
 * else (the DM path also owns DM mentions), @mentions in channels and forums, and channel thread
 * replies in threads the person authored, replied in or was mentioned in. Owned-Agent activity
 * and Project work items stay Inbox rows only. Oldest first, as the original feed alerts.
 */
export function homeFeedNotifications(snapshot: InboxSnapshot): HomeFeedNotification[] {
  const byId = new Map<string, HomeFeedNotification>();
  const channelEvent = (event: InboxEvent): event is Event => event.channelId !== null && "content" in event;
  for (const event of snapshot.activity) {
    if (channelEvent(event) && event.channelType === "dm") byId.set(event.id, { event, source: "dm" });
  }
  for (const event of snapshot.mentions) {
    if (!channelEvent(event) || byId.has(event.id)) continue;
    byId.set(event.id, { event, source: event.channelType === "dm" ? "dm" : "mention" });
  }
  for (const event of snapshot.activity) {
    if (channelEvent(event) && !byId.has(event.id) && snapshot.interestReplyIds.has(event.id))
      byId.set(event.id, { event, source: "thread_reply" });
  }
  return [...byId.values()].sort((left, right) => left.event.createdAt - right.event.createdAt);
}

type Reads = ReturnType<typeof useInboxState>;

export function useWebHomeFeed({ client, visibility, principalId, reads, activeWorkspaceId, activeConversationChannelId, onOpen }: {
  /**
   * The shell's BFF client and DM visibility host, the same ones InboxPane reads through. Both
   * (like the identity) define the feed's scope: a new object starts a new feed, with a new
   * first-feed-seen pass, so hosts pass stable instances.
   */
  client: BffClient;
  visibility: ConversationVisibilityHost;
  principalId: string;
  reads: Reads;
  /** The open channel's Workspace ID; its live stream already alerts. */
  activeWorkspaceId: string | null;
  /** The open DM's native channel ID; its live stream already alerts. */
  activeConversationChannelId: string | null;
  onOpen: (channelId: string, target: { eventId: string; threadRootId: string | null }) => Promise<void>;
}): { unreadCount: number | null } {
  const projectsHost = useProjectsHost(principalId);
  const notifications = useBrowserNotifications();
  const scope = useMemo(() => ({}), [client, principalId]);
  const [snapshot, setSnapshot] = useState<InboxSnapshot | null>(null);
  const generation = useRef(0);
  const loading = useRef(false);
  const read = useRef<AbortController | null>(null);

  useEffect(() => {
    // A new identity never shows or alerts from the previous one's snapshot.
    setSnapshot(null);
    let stopped = false;
    const load = async () => {
      if (stopped || loading.current) return;
      loading.current = true;
      const epoch = ++generation.current;
      read.current?.abort();
      const controller = new AbortController();
      read.current = controller;
      try {
        const next = await loadInboxSnapshot({ client, principalId, visibility, projectsHost, scope,
          isCurrent: () => !stopped && epoch === generation.current, signal: controller.signal });
        if (next && !stopped && epoch === generation.current) setSnapshot(next);
      } catch {
        // Keep the last admitted snapshot; the next poll or focus reads again.
      } finally {
        if (epoch === generation.current) loading.current = false;
      }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, HOME_FEED_POLL_MS);
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      generation.current += 1;
      loading.current = false;
      read.current?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [client, principalId, visibility, projectsHost, scope]);

  const readsReady = reads.state !== null && !reads.failed && !reads.unknown;
  const current = snapshot?.scope === scope ? snapshot : null;
  // The badge keeps its last known value while user-state re-reads (focus refresh), instead of
  // flickering to nothing; it is cleared only with the identity.
  const lastCount = useRef<{ scope: object; count: number } | null>(null);
  const { readAt, visibleChannels } = reads;
  const unreadCount = useMemo(() => {
    if (!current || !readsReady) return null;
    try {
      const positions = { readAt, visibleChannels };
      return inboxUnreadRowCount(current, inboxRows(current, positions), positions);
    } catch {
      return null;
    }
  }, [current, readsReady, readAt, visibleChannels]);
  if (unreadCount !== null) lastCount.current = { scope, count: unreadCount };

  const seen = useRef<{ scope: object; ids: Set<string> } | null>(null);
  // Latest inputs for the alert pass; it runs only when a new snapshot (or read state) lands.
  const latest = useRef({ notifications, reads, activeWorkspaceId, activeConversationChannelId, onOpen });
  latest.current = { notifications, reads, activeWorkspaceId, activeConversationChannelId, onOpen };
  useEffect(() => {
    if (!current || !readsReady) return;
    const { notifications, reads, activeWorkspaceId, activeConversationChannelId, onOpen } = latest.current;
    const candidates = homeFeedNotifications(current);
    const previous = seen.current?.scope === scope ? seen.current.ids : null;
    // Original first-load rule: everything already in the feed is seen, not alerted.
    seen.current = { scope, ids: new Set(candidates.map(({ event }) => event.id)) };
    const state = reads.state;
    if (!previous || !notifications || !state) return;
    for (const { event, source } of candidates) {
      if (previous.has(event.id)) continue;
      let readAt: number | null;
      try {
        readAt = reads.readAt(inboxReadContext(inboxReadItem(current, event))!);
      } catch {
        continue;
      }
      if (event.createdAt <= (readAt ?? 0)) continue; // Already read on another device.
      const conversation = source === "dm" ? current.conversations.find((item) => item.channelId === event.channelId) : undefined;
      if (conversation ? event.channelId === activeConversationChannelId : event.channelId === activeWorkspaceId) continue;
      // Mentions alert even in a muted channel; DMs and thread replies honor mute, as in the open pane.
      const muted = conversation
        ? state.conversationPreferences?.[conversation.id]?.muted === true
        : state.workspacePreferences[event.channelId]?.muted === true;
      if (muted && source !== "mention") continue;
      const people = conversation
        ? current.people.filter((person) => conversation.participantPrincipalIds.includes(person.principalId))
        : current.members.get(event.channelId) ?? [];
      const senderName = people.find((person) => person.pubkeys.includes(event.pubkey))?.displayName;
      const channelName = conversation ? null : current.workspaces.find((workspace) => workspace.id === event.channelId)?.name;
      const nativeChannelId = conversation ? conversation.channelId : current.channelIds.get(event.channelId);
      if (!nativeChannelId) continue;
      const message = formatMessageNotification({ source, senderName, channelName, content: event.content });
      notifications.notify({ eventId: event.id, ...message, slot: source,
        onOpen: () => { void onOpen(nativeChannelId, { eventId: event.id, threadRootId: inboxThread(event.tags).rootId }).catch(() => undefined); } });
    }
  }, [current, readsReady, scope]);

  return { unreadCount: unreadCount ?? (lastCount.current?.scope === scope ? lastCount.current.count : null) };
}
