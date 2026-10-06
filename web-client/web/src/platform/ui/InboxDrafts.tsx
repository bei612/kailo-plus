import { ChannelType, ItemState, WebMessageType, type ConversationView, type WorkspaceView, type WorkspaceMemberView } from "@client-kit/contracts";
import { useBffClient, useT } from "@client-kit/platform/react/context";
import { useConversations } from "@client-kit/platform/react/new-message";
import { DraftDetailSurface, DraftListSurface, type DraftListEntry, type DraftSurfaceItem } from "@client-kit/platform/react/draft-surfaces";
import { initDraftStore, getActiveDraftEntries, useDraftsSnapshot, deleteDraftEntry, loadDraftEntry } from "@client-kit/platform/react/composer/features/messages/lib/useDrafts";
import { InboxDetailHeader } from "@client-kit/platform/react/inbox-surface";
import { formatItemTimestamp } from "@client-kit/platform/react/messages/datetime";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { MessageContent } from "@/features/chat/ui/MessageContent";
import { ChannelPane } from "./ChannelPane";
import { InboxThreadPane } from "./InboxThreadPane";
import { ForumPane } from "./ForumPane";

/** Existing Web composer namespaces, resolved against the stored destination (never inferred from a secret or a fallback scope). */
export function draftMessageTarget(entry: DraftListEntry): { messageType: WebMessageType; parentEventId?: string } | null {
  const scope = entry.draft.channelId;
  if (entry.key === scope) return { messageType: WebMessageType.Stream };
  for (const [prefix, messageType] of [[`thread:${scope}:`, WebMessageType.Stream], [`forum:${scope}:`, WebMessageType.ForumComment]] as const) {
    if (!entry.key.startsWith(prefix)) continue;
    const parent = entry.key.slice(prefix.length);
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

export function InboxDrafts({ principalId, workspaces, members, entries, selectedKey, onSelect, onDelete, showList, showDetail, onBack, header }: {
  principalId: string; workspaces: WorkspaceView[]; entries: DraftListEntry[]; selectedKey: string | null;
  onSelect: (key: string | null) => void; onDelete: (key: string) => void; showList: boolean; showDetail: boolean; onBack?: () => void;
  members: Map<string, WorkspaceMemberView[]>; header: ReactNode;
}) {
  const t = useT(); const conversations = useConversations();
  const [editing, setEditing] = useState<{ key: string; send: boolean } | null>(null);
  const destination = (entry: DraftListEntry): Destination | null => {
    const workspace = workspaces.find((item) => item.id === entry.draft.channelId);
    if (workspace) return { kind: "workspace", workspace };
    const conversation = !conversations.error && !conversations.loading ? conversations.items.find((item) => item.id === entry.draft.channelId && item.state === ItemState.Active && item.participantPrincipalIds.includes(principalId)) : undefined;
    return conversation ? { kind: "conversation", conversation } : null;
  };
  const items: DraftSurfaceItem[] = entries.map((entry) => {
    const target = destination(entry); const supported = draftMessageTarget(entry) !== null;
    const createdAt = Date.parse(entry.draft.createdAt);
    return { entry, channelLabel: target?.kind === "workspace" ? `#${target.workspace.name}` : target?.kind === "conversation" ? target.conversation.participantPrincipalIds.filter((id) => id !== principalId).join(", ") : t("drafts.unknownChannel"),
      createdAt: Number.isFinite(createdAt) ? formatItemTimestamp(createdAt / 1000, { withTime: true }) : t("platform.time.unavailable"), isPrivate: target?.kind === "conversation", isOrphaned: false,
      canOpen: target !== null && supported, canSend: target !== null && supported };
  });
  const selected = items.find((item) => item.entry.key === selectedKey) ?? null;
  const opened = selected && editing?.key === selected.entry.key ? selected : null;
  const open = (entry: DraftListEntry, send: boolean) => { onSelect(entry.key); setEditing({ key: entry.key, send }); };
  const preview = (draft: DraftListEntry["draft"], className: string) => <div className={className}>{draft.content.trim()
    ? <MessageContent content={draft.content} workspaceId={draft.channelId} conversationId={conversations.items.some((item) => item.id === draft.channelId) ? draft.channelId : undefined} />
    : t("drafts.attachments", { count: draft.pendingImeta.length })}</div>;
  return <>{showList ? <section className="relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-background/60">{header}<div className="min-h-0 flex-1 overflow-y-auto"><DraftListSurface items={items} selectedKey={selectedKey} onSelect={(key) => { setEditing(null); onSelect(key); }} onOpen={(entry) => open(entry, false)} onSend={(entry) => open(entry, true)} onDelete={onDelete} renderPreview={preview} /></div></section> : null}
    {showDetail ? opened ? <DraftEditor key={`${principalId}:${opened.entry.key}`} principalId={principalId} item={opened} destination={destination(opened.entry)}
      members={members.get(opened.entry.draft.channelId) ?? []} autoSend={editing?.send ?? false} onBack={() => setEditing(null)} /> : <DraftDetailSurface item={selected} onBack={onBack} onOpen={(entry) => open(entry, false)} onSend={(entry) => open(entry, true)} onDelete={onDelete} renderPreview={preview} /> : null}
  </>;
}

function DraftEditor({ principalId, item, destination, members, autoSend, onBack }: { principalId: string; item: DraftSurfaceItem; destination: Destination | null; members: WorkspaceMemberView[]; autoSend: boolean; onBack: () => void }) {
  const client = useBffClient(); const t = useT(); const { entry } = item;
  const target = draftMessageTarget(entry);
  const isDm = destination?.kind === "conversation";
  const channel = useQuery({ queryKey: ["platform", "draft-channel", principalId, entry.draft.channelId], enabled: destination?.kind === "workspace",
    queryFn: () => client.workspaceChannel(entry.draft.channelId) });
  const valid = destination !== null && target !== null && (isDm ? target.messageType === WebMessageType.Stream && !target.parentEventId
    : !channel.isError && channel.isSuccess && !channel.data.archived && (channel.data.channelType === ChannelType.Forum ? target.messageType !== WebMessageType.Stream : target.messageType === WebMessageType.Stream));
  if (!valid || !target || !destination) return <section><InboxDetailHeader title={item.channelLabel} openLabel={t("drafts.open")} onBack={onBack} /><p role="status" className="p-5">{destination?.kind === "workspace" && channel.isPending ? t("platform.loading") : t("drafts.noChannel")}</p></section>;
  const autoSendDraftKey = autoSend ? entry.key : undefined;
  if (target.parentEventId && target.messageType === WebMessageType.Stream) return <InboxThreadPane principalId={principalId} workspaceId={entry.draft.channelId}
    rootId={target.parentEventId} selectedEventId={target.parentEventId} channelName={item.channelLabel} members={members} onBack={onBack} onOpen={onBack} autoSendDraftKey={autoSendDraftKey} />;
  return <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background/60"><InboxDetailHeader title={item.channelLabel} openLabel={t("drafts.open")} onBack={onBack} />
    {destination.kind === "conversation" ? <ChannelPane workspaceId={destination.conversation.id} conversation={destination.conversation} myPrincipalId={principalId} autoSendDraftKey={autoSendDraftKey} />
      : channel.data?.channelType === ChannelType.Forum ? <ForumPane workspaceId={entry.draft.channelId} channelId={channel.data.channelId} archived={channel.data.archived} myPrincipalId={principalId}
          restoreDraftKey={entry.key} autoSendDraftKey={autoSendDraftKey} />
        : <ChannelPane workspaceId={entry.draft.channelId} myPrincipalId={principalId} autoSendDraftKey={autoSendDraftKey} />}
  </section>;
}
