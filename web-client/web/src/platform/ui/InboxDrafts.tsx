import { ChannelType, ItemState, WebMessageType, type ConversationView, type ConversationParticipant, type WorkspaceView } from "@client-kit/contracts";
import { useBffClient, useT } from "@client-kit/platform/react/context";
import { useConversations, useConversationVisibilityHost } from "@client-kit/platform/react/new-message";
import { DraftDetailSurface, DraftListSurface, type DraftListEntry, type DraftSurfaceItem } from "@client-kit/platform/react/draft-surfaces";
import { initDraftStore, getActiveDraftEntries, useDraftsSnapshot, deleteDraftEntry, loadDraftEntry } from "@client-kit/platform/react/composer/features/messages/lib/useDrafts";
import { formatItemTimestamp } from "@client-kit/platform/react/messages/datetime";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { InboxNavigationTarget } from "@client-kit/platform/react/new-message";
import type { PlatformDraftNavigation } from "@/app/platform-navigation";
import { MessageContent } from "@/features/chat/ui/MessageContent";
import { formatDmParticipantDisplayName } from "@client-kit/platform/react/conversations/dm-participant-display";

/** Existing Web composer namespaces, resolved against the stored destination (never inferred from a secret or a fallback scope). */
export function draftMessageTarget(entry: DraftListEntry): { messageType: WebMessageType; parentEventId?: string; threadRootId?: string; editEventId?: string } | null {
  const scope = entry.draft.channelId;
  if (entry.key === scope) return { messageType: WebMessageType.Stream };
  if (entry.key.startsWith(`edit:${scope}:`)) {
    const editEventId = entry.key.slice(`edit:${scope}:`.length);
    return /^[0-9a-f]{64}$/.test(editEventId) ? {messageType: WebMessageType.Stream, editEventId} : null;
  }
  for (const [prefix, messageType] of [[`thread:${scope}:`, WebMessageType.Stream], [`forum:${scope}:`, WebMessageType.ForumComment]] as const) {
    if (!entry.key.startsWith(prefix)) continue;
    const parent = entry.key.slice(prefix.length);
    if (messageType === WebMessageType.Stream && /^[0-9a-f]{64}:[0-9a-f]{64}$/.test(parent)) {
      const [threadRootId, parentEventId] = parent.split(":");
      return { messageType, threadRootId, parentEventId };
    }
    if (messageType === WebMessageType.ForumComment && parent === "post") return { messageType: WebMessageType.ForumPost };
    return /^[0-9a-f]{64}$/.test(parent) ? { messageType, parentEventId: parent } : null;
  }
  return null;
}

export function useInboxDrafts(principalId: string) {
  const [readyIdentity, setReadyIdentity] = useState<string | null>(null);
  useDraftsSnapshot();
  useEffect(() => { initDraftStore(principalId, window.location.origin); setReadyIdentity(principalId); }, [principalId]);
  const entries = readyIdentity === principalId ? getActiveDraftEntries().filter((entry) => entry.draft.content.trim() || entry.draft.pendingImeta.length) : [];
  return { entries, remove: (key: string) => { if (readyIdentity === principalId && !loadDraftEntry(key)?.sendIntent) deleteDraftEntry(key); } };
}

type Destination = { kind: "workspace"; workspace: WorkspaceView } | { kind: "conversation"; conversation: ConversationView };

export function InboxDrafts({ principalId, workspaces, participants, entries, selectedKey, onSelect, onDelete, showList, showDetail, onBack, renderList, onOpen }: {
  principalId: string; workspaces: WorkspaceView[]; entries: DraftListEntry[]; selectedKey: string | null;
  onSelect: (key: string | null) => void; onDelete: (key: string) => void; showList: boolean; showDetail: boolean; onBack?: () => void;
  participants: ConversationParticipant[]; renderList: (list: ReactNode) => ReactNode;
  onOpen: (channelId: string, target?: InboxNavigationTarget, draft?: PlatformDraftNavigation & {conversation?: ConversationView}) => void | Promise<void>;
}) {
  const t = useT(); const client = useBffClient(); const conversations = useConversations();
  const visibility = useConversationVisibilityHost();
  const destination = (entry: DraftListEntry): Destination | null => {
    const target = draftMessageTarget(entry);
    if (!target) return null;
    const workspace = workspaces.find((item) => item.id === entry.draft.channelId);
    // Original Inbox replies persist the native channel as their draft scope;
    // ordinary Web DM composers persist the admitted Conversation binding ID.
    const matches = !conversations.error && !conversations.loading ? conversations.items.filter((item) =>
      (target.parentEventId ? item.channelId : item.id) === entry.draft.channelId &&
      item.state === ItemState.Active && item.participantPrincipalIds.includes(principalId)) : [];
    if (matches.length + Number(Boolean(workspace)) !== 1) return null;
    return workspace ? { kind: "workspace", workspace } : { kind: "conversation", conversation: matches[0]! };
  };
  const items: DraftSurfaceItem[] = entries.map((entry) => {
    const target = destination(entry); const supported = draftMessageTarget(entry) !== null;
    const createdAt = Date.parse(entry.draft.createdAt);
    const dmLabels = target?.kind === "conversation" ? [...new Set(target.conversation.participantPrincipalIds.filter((id) => id !== principalId).map(id => participants.find(person => person.principalId === id)?.displayName || id))] : [];
    return { entry, channelLabel: target?.kind === "workspace" ? `#${target.workspace.name}` : target?.kind === "conversation" ? formatDmParticipantDisplayName(dmLabels.map(displayName => ({ displayName })), t) : t("drafts.unknownChannel"),
      createdAt: Number.isFinite(createdAt) ? formatItemTimestamp(createdAt / 1000, { withTime: true }) : t("platform.time.unavailable"), isPrivate: target?.kind === "conversation", isOrphaned: false,
      canOpen: target !== null && supported, canSend: target !== null && supported };
  });
  const selected = items.find((item) => item.entry.key === selectedKey) ?? null;
  const open = async (entry: DraftListEntry, send: boolean) => {
    const resolved = destination(entry); const target = draftMessageTarget(entry);
    if (!resolved || !target) return;
    try {
      if (resolved.kind === "conversation") {
        if (!visibility || (await visibility.read(resolved.conversation)).has(resolved.conversation.channelId)) throw new Error("Conversation unavailable");
      } else {
        const channel = await client.workspaceChannel(resolved.workspace.id);
        if (channel.archived || (channel.channelType === ChannelType.Forum ? target.messageType === WebMessageType.Stream : target.messageType !== WebMessageType.Stream)) throw new Error("Draft destination unavailable");
      }
      const channelId = resolved.kind === "conversation" ? resolved.conversation.channelId : resolved.workspace.id;
      const message = target.parentEventId ? {channelId, messageId:target.parentEventId, threadRootId:target.threadRootId ?? target.parentEventId,
        ...(resolved.kind === "conversation" ? {conversation:resolved.conversation} : {})} : undefined;
      await onOpen(channelId, message, {key:entry.key, send, editEventId:target.editEventId,
        ...(resolved.kind === "conversation" ? {conversation:resolved.conversation} : {})});
    } catch { toast.error(t("drafts.noChannel")); }
  };
  const preview = (draft: DraftListEntry["draft"], className: string) => {
    const entry = entries.find(item => item.draft === draft);
    const target = entry ? destination(entry) : null;
    return <div className={className}>{draft.content.trim()
      ? <MessageContent content={draft.content} workspaceId={draft.channelId} conversationId={target?.kind === "conversation" ? target.conversation.id : undefined} />
      : t("drafts.attachments", { count: draft.pendingImeta.length })}</div>;
  };
  return <>{showList ? renderList(<DraftListSurface items={items} selectedKey={selectedKey} onSelect={onSelect} onOpen={(entry) => open(entry, false)} onSend={(entry) => open(entry, true)} onDelete={onDelete} renderPreview={preview} />) : null}
    {showDetail ? <DraftDetailSurface item={selected} onBack={onBack} onOpen={(entry) => {void open(entry, false);}} onSend={(entry) => {void open(entry, true);}} onDelete={onDelete} renderPreview={preview} /> : null}
  </>;
}
