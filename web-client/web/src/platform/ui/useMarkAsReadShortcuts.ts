// Web host adapter for Buzz's shared original Escape / Shift+Escape handlers.
// Core remains the only read-position CAS writer; Relay windows supply the time.
import { PlatformSessionAccessMode, type PlatformSessionView } from "@client-kit/contracts";
import type { BffClient } from "@client-kit/platform/client";
import { loadInboxConversations } from "@client-kit/platform/react/new-message";
import type { useInboxState } from "@client-kit/platform/react/use-inbox-state";
import { useMarkAsReadShortcuts } from "@client-kit/platform/react/use-mark-as-read-shortcuts";
import { useEffect, useMemo, useRef } from "react";
import { inboxWindowEvents } from "./inbox-events";

type Target = { workspaceId: string } | { conversationId: string };

export async function loadReadShortcutContexts(client: BffClient, session: PlatformSessionView,
  target: Target | null, isCurrent: () => boolean) {
  if (session.accessMode !== PlatformSessionAccessMode.Full ||
      [session.tenantId, session.tenantPrincipalId, session.platformSessionId].some(value => typeof value !== "string" || !value))
    throw new Error("Read shortcut identity unavailable");
  const check = () => { if (!isCurrent()) throw new Error("Read shortcut view changed"); };
  const checkSession = async () => {
    check();
    const actual = await client.session();
    check();
    if (actual.accessMode !== PlatformSessionAccessMode.Full || actual.tenantId !== session.tenantId ||
        actual.tenantPrincipalId !== session.tenantPrincipalId || actual.platformSessionId !== session.platformSessionId)
      throw new Error("Read shortcut identity changed");
  };
  await checkSession();
  const workspaces = (await client.workspaces()).filter(row => row.isMember === true);
  check();
  const conversations = await loadInboxConversations(client, isCurrent);
  check();
  if (conversations.some(row => !row.participantPrincipalIds.includes(session.tenantPrincipalId)))
    throw new Error("Read shortcut Conversation not admitted");
  const selectedWorkspaces = workspaces.filter(row => !target || "workspaceId" in target && row.id === target.workspaceId);
  const selectedConversations = conversations.filter(row => !target || "conversationId" in target && row.id === target.conversationId);
  if (target && selectedWorkspaces.length + selectedConversations.length !== 1)
    throw new Error("Read shortcut target not admitted");
  const contexts = new Map<string, number>();
  const bindings = new Map<string, string>();
  const observe = (channelId: string, events: ReturnType<typeof inboxWindowEvents>) => {
    for (const event of events) contexts.set(channelId, Math.max(contexts.get(channelId) ?? event.createdAt, event.createdAt));
  };
  for (const workspace of selectedWorkspaces) {
    const channel = await client.workspaceChannel(workspace.id);
    check();
    // A forum root window does not prove the newest reply across all roots.
    // Until its activity source is wired, refuse the whole operation before CAS.
    if (channel.channelType !== "stream" || typeof channel.channelId !== "string" || !channel.channelId)
      throw new Error("Read shortcut channel activity unavailable");
    bindings.set(workspace.id, channel.channelId);
    const page = await client.workspaceMessages(workspace.id);
    check();
    observe(channel.channelId, inboxWindowEvents(page.events, channel.channelId));
  }
  for (const conversation of selectedConversations) {
    const page = await client.conversationMessages(conversation.id);
    check();
    observe(conversation.channelId, inboxWindowEvents(page.events, conversation.channelId));
  }
  const currentWorkspaces = await client.workspaces();
  check();
  for (const workspace of selectedWorkspaces) {
    if (!currentWorkspaces.some(row => row.id === workspace.id && row.isMember === true))
      throw new Error("Read shortcut Workspace admission changed");
    if ((await client.workspaceChannel(workspace.id)).channelId !== bindings.get(workspace.id))
      throw new Error("Read shortcut channel binding changed");
    check();
  }
  const currentConversations = await loadInboxConversations(client, isCurrent);
  check();
  if (selectedConversations.some(previous => !currentConversations.some(row => row.id === previous.id &&
      row.channelId === previous.channelId && row.participantPrincipalIds.length === previous.participantPrincipalIds.length &&
      row.participantPrincipalIds.every(id => previous.participantPrincipalIds.includes(id)))))
    throw new Error("Read shortcut Conversation admission changed");
  await checkSession();
  return [...contexts].map(([key, seconds]) => ({ key, seconds }));
}

export function useWebMarkAsReadShortcuts({ client, session, reads, workspaceId, conversationId, disabled, onError }: {
  client: BffClient; session: PlatformSessionView; reads: ReturnType<typeof useInboxState>;
  workspaceId: string | null; conversationId: string | null; disabled: boolean; onError: () => void;
}) {
  const owner = useMemo(() => ({ active: true, pending: false }),
    [client, session.tenantId, session.tenantPrincipalId, session.platformSessionId, workspaceId, conversationId, disabled]);
  const latest = useRef({ owner, reads, disabled, onError });
  latest.current = { owner, reads, disabled, onError };
  useEffect(() => { owner.active = true; return () => { owner.active = false; }; }, [owner]);
  const admitted = () => owner.active && latest.current.owner === owner && !latest.current.disabled &&
    latest.current.reads.state !== null && !latest.current.reads.failed && !latest.current.reads.pending && !latest.current.reads.unknown;
  const mark = async (target: Target | null) => {
    if (!admitted() || owner.pending) return;
    owner.pending = true;
    try {
      const contexts = await loadReadShortcutContexts(client, session, target, admitted);
      if (!admitted()) return;
      const newer = contexts.filter(context => context.seconds > (latest.current.reads.readAt(context.key) ?? -Infinity));
      if (newer.length) await latest.current.reads.write(newer);
    } catch {
      if (owner.active && latest.current.owner === owner) latest.current.onError();
    } finally { owner.pending = false; }
  };
  useMarkAsReadShortcuts({
    activeChannelId: workspaceId ?? conversationId, activeChannelLastMessageAt: null,
    selectedView: !disabled && (workspaceId || conversationId) ? "channel" : "other",
    markChannelRead: () => { void mark(workspaceId ? { workspaceId } : conversationId ? { conversationId } : null); },
    markAllChannelsRead: () => { void mark(null); },
  });
}
