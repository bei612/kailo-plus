// Web transport adapter only: aggregation and rows are the same TS used by Buzz Desktop Home.
import {
  inboxReadContext,
  inboxThread,
  inboxScopeKey,
  matchesInbox,
  getInboxTypeLabel,
  feedPreview,
} from "@client-kit/platform/inbox";
import { truncatePubkey } from "@client-kit/platform/format";
import { formatItemTimestamp } from "@client-kit/platform/react/messages/datetime";
import { useBffClient, useLocale, useT } from "@client-kit/platform/react/context";
import { BffError } from "@client-kit/platform/transport";
import { useHiddenDmInboxNavigation, useConversationVisibilityHost, type InboxNavigationTarget } from "@client-kit/platform/react/new-message";
import { toast } from "sonner";
import { InboxView, useInboxViewState, type InboxViewStatus } from "@client-kit/platform/react/inbox-view";
import { useNeedsActionSource } from "@client-kit/platform/react/inbox/needs-action";
import { getInboxVideoReviewCommentRootId } from "@client-kit/platform/react/video-review";
import { HomeLoadingState, InboxEmptyDetail, useInboxDraftSelection, type InboxFilter } from "@client-kit/platform/react/inbox-surface";
import { AUXILIARY_PANEL_DEFAULT_WIDTH_PX } from "@client-kit/platform/react/thread";
import { InboxThreadPane } from "./InboxThreadPane";
import { InboxDrafts, useInboxDrafts } from "./InboxDrafts";
import type { PlatformDraftNavigation } from "@/app/platform-navigation";
import { inboxReadContexts, useInboxState } from "@client-kit/platform/react/use-inbox-state";
import { useInboxSelectionAnchor } from "@client-kit/platform/react/use-inbox-selection-anchor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hex, inboxEvents } from "./inbox-events";
import { inboxRows, loadInboxSnapshot, type InboxEvent, type InboxSnapshot } from "./inbox-snapshot";
export { inboxEvents } from "./inbox-events";
import { MessageContent } from "@/features/chat/ui/MessageContent";
import { MessageAuthorAvatar, MessageAuthorIdentity, MessageAuthorProfile, useMessageAuthorProfiles, type MessageAuthor } from "./MessageAuthorProfile";
import {resolveProjectInboxWorkItem,projectWorkItemTarget,ProjectInboxDetail,type ProjectWorkItemTarget} from "@client-kit/platform/react/projects";
import {useProjectsHost} from "./ProjectsPane";
import {PulsePane} from "./PulsePane";
import {UserAvatar} from "@client-kit/platform/react/messages";
type Snapshot = InboxSnapshot;

export function InboxPane({
  principalId,
  onOpen,
  onUnreadCount,
  onStartDm,
  onOpenProject,
  selectedItemId,
  onSelectedItemIdChange,
}: {
  principalId: string;
  onOpen: (channelId: string, target?: InboxNavigationTarget, draft?: PlatformDraftNavigation & {conversation?: import("@client-kit/contracts").ConversationView}) => void | Promise<void>;
  onUnreadCount?: (count: number | null) => void;
  onStartDm?: (pubkey: string) => void;
  onOpenProject?: (projectId:string,target:ProjectWorkItemTarget)=>void;
  selectedItemId?: string | null;
  onSelectedItemIdChange?: (id: string | null) => void;
}) {
  const client = useBffClient();
  const selectionScope = useMemo(() => ({}), [client, principalId]);
  const projectsHost=useProjectsHost(principalId);
  const t = useT();
  const locale = useLocale();
  const reads = useInboxState(client);
  // DD-125(5): Needs action reads the caller's Temporal approvals, never Buzz workflow events.
  const needsAction = useNeedsActionSource({ client, scopeKey: principalId });
  const visibility = useConversationVisibilityHost();
  const hiddenDm = useHiddenDmInboxNavigation({ scopeKey: principalId, conversations: reads.conversations,
    onOpenContext: target => onOpen(target.channelId, target), onError: message => toast.error(message) });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [localSelectedItemId, setLocalSelectedItemId] = useState<string | null>(null);
  const [publicationSelection, setPublicationSelection] = useState<{principalId: string; event: InboxEvent} | null>(null);
  const publicationAnchor = publicationSelection?.principalId === principalId ? publicationSelection.event : undefined;
  // Shared original Inbox page state. An unsent publication's owner anchor is
  // held in place of the URL item without rewriting the URL.
  const view = useInboxViewState({
    itemId: selectedItemId === undefined ? localSelectedItemId : selectedItemId,
    setItemId: useCallback((id: string | null) => { setLocalSelectedItemId(id); onSelectedItemIdChange?.(id); }, [onSelectedItemIdChange]),
    heldItemId: publicationAnchor?.id ?? null,
  });
  const { filter, selectedEventId } = view;
  const effectiveSelectedItemId = view.explicitSelectedItemId;
  const [profileTarget, setProfileTarget] = useState<MessageAuthor | null>(null);
  const [profileWidth, setProfileWidth] = useState(AUXILIARY_PANEL_DEFAULT_WIDTH_PX);
  const closeAuthorScope = useCallback((workspaceId: string) => {
    setProfileTarget((target) => target?.workspaceId === workspaceId ? null : target);
  }, []);
  const drafts = useInboxDrafts(principalId);
  useEffect(() => { view.setAutoSelectedEventId(null); setLocalSelectedItemId(null); setPublicationSelection(null); view.setSelectedDraftKey(null); setProfileTarget(null); }, [principalId]);
  const generation = useRef(0);
  const projectRead = useRef<AbortController | null>(null);
  // DD-125(1): Core thread follows join and mutes leave the original interest roots; the
  // snapshot is rebuilt only when that preference content changes.
  const threadPreferences = useRef(reads.state?.threadPreferences);
  threadPreferences.current = reads.state?.threadPreferences;
  const threadPreferenceSignature = useMemo(() => JSON.stringify(reads.state?.threadPreferences ?? null),
    [reads.state?.threadPreferences]);
  const load = useCallback(async () => {
    const epoch = ++generation.current;
    projectRead.current?.abort();
    const controller = new AbortController();
    projectRead.current = controller;
    setSnapshot(null);
    setFailed(false);
    try {
      const next = await loadInboxSnapshot({ client, principalId, visibility, projectsHost, scope: selectionScope,
        isCurrent: () => epoch === generation.current, signal: controller.signal,
        threadPreferences: threadPreferences.current });
      if (next && epoch === generation.current) setSnapshot(next);
    } catch {
      if (epoch === generation.current) setFailed(true);
    }
  }, [client, principalId, visibility,projectsHost,selectionScope,threadPreferenceSignature]);
  useEffect(() => {
    void load();
    const refresh = () => {
      void load();
    };
    window.addEventListener("focus", refresh);
    return () => {
      generation.current += 1;
      projectRead.current?.abort();
      window.removeEventListener("focus", refresh);
    };
  }, [load]);
  const readItem = useCallback((event: InboxEvent) => {
    if(event.channelId===null) return event;
    const channelId = event.channelType === "dm" ? event.channelId : snapshot?.channelIds.get(event.channelId);
    if (!channelId) throw new Error("Unverifiable Inbox read context binding");
    return { ...event, channelId };
  }, [snapshot]);
  const rows = useMemo(
    () =>
      snapshot?.scope === selectionScope
        ? inboxRows(snapshot, { readAt: reads.readAt, visibleChannels: reads.visibleChannels })
        : [],
    [snapshot, selectionScope, reads.readAt, reads.visibleChannels],
  );
  const refresh = () => {
    void load();
    void reads.refresh();
    needsAction.refresh();
  };
  const messagesMode = view.isMessagesMode;
  const anchorFeedItems = useMemo(() => rows.flatMap(row => row.items), [rows]);
  const visibleAnchor = (event: InboxEvent | undefined) => event?.channelId != null && reads.visibleChannels.has(event.channelId) &&
    (snapshot?.workspaces.some(workspace => workspace.id === event.channelId) || snapshot?.conversations.some(conversation => conversation.channelId === event.channelId && conversation.participantPrincipalIds.includes(principalId)))
    ? event : undefined;
  const heldAnchor = visibleAnchor(publicationAnchor);
  // Host adapter: only freshly enumerated admitted scopes, never a browser
  // Relay query. The shared hook owns attempts, latch and late-result rejection.
  const recoverAnchor = async (id: string, signal: AbortSignal): Promise<InboxEvent | null> => {
    signal.throwIfAborted();
    if (!snapshot || snapshot.scope !== selectionScope || !hex.test(id)) throw new Error("Invalid Inbox anchor scope");
    const scopes = [
      ...snapshot.workspaces.map(workspace => ({workspaceId: workspace.id, channelId: snapshot.channelIds.get(workspace.id), conversationId: undefined as string | undefined})),
      ...snapshot.conversations.map(conversation => ({workspaceId: conversation.channelId, channelId: conversation.channelId, conversationId: conversation.id})),
    ];
    for (const scope of scopes) {
      signal.throwIfAborted();
      if (!scope.channelId) throw new Error("Unverifiable Inbox channel binding");
      try {
        const page = scope.conversationId
          ? await client.conversationMessages(scope.conversationId, {anchorEventId: id})
          : await client.workspaceMessages(scope.workspaceId, {anchorEventId: id});
        signal.throwIfAborted();
        if (!Array.isArray(page.events)) throw new Error("Invalid admitted Inbox anchor page");
        const events = page.events.flatMap(value => {
          if (!value || ![9, 40002, 45001, 45003].includes(value.kind)) throw new Error("Invalid Inbox anchor kind");
          return inboxEvents([value], scope.channelId!, value.kind).map(event => ({...event,
            ...([45001,45003].includes(event.kind) ? {channelType: "forum"} : {})}));
        });
        const found = events.find(event => event.id === id);
        if (!found) throw new Error("Missing admitted Inbox anchor");
        return {...found, channelId: scope.workspaceId, ...(scope.conversationId ? {channelType: "dm"} : snapshot.forumChannels.has(scope.workspaceId) ? {channelType: "forum"} : {})};
      } catch (error) {
        // Only a plain scope-local 404 permits the next admitted scope.
        if (!(error instanceof BffError) || error.status !== 404 || error.errorClass) throw error;
      }
    }
    return null;
  };
  const {activeLatchedItem, coldResolutionPending, coldResolutionFailed} = useInboxSelectionAnchor({
    feedItems: anchorFeedItems, selectedEventId, scopeKey: selectionScope, recoveryKey: snapshot,
    membershipKey: [...reads.visibleChannels].sort().join(","),
    ready: Boolean(snapshot && snapshot.scope === selectionScope) && !failed && !reads.failed && !reads.unknown,
    coldEnabled: messagesMode && effectiveSelectedItemId !== null && !heldAnchor,
    isRetainedVisible: event => Boolean(visibleAnchor(event)), recover: recoverAnchor,
  });
  const resolvedAnchor = heldAnchor ?? activeLatchedItem;
  const anchor = messagesMode ? resolvedAnchor : undefined;
  const selected = anchor ? inboxScopeKey(anchor) : null;
  const coldPending = messagesMode && !resolvedAnchor && coldResolutionPending;
  // Original Home count includes needs_action items until they are marked done locally.
  const undoneApprovals = needsAction.status === "ready" ? needsAction.items.filter(item => !needsAction.isDone(item)).length : 0;
  useEffect(() => {
    onUnreadCount?.(failed || reads.failed || reads.unknown || !snapshot || !reads.state ? null : rows.filter((row) =>
      row.items.some((event) => event.createdAt > (reads.readAt(inboxReadContext(readItem(event))!) ?? 0))).length + undoneApprovals);
  }, [onUnreadCount, failed, reads.failed, reads.unknown, snapshot, reads.state, rows, reads.readAt, readItem, undoneApprovals]);
  useEffect(() => () => onUnreadCount?.(null), [onUnreadCount]);
  const viewRows = useMemo(() => rows.map(row => ({...row, id: row.item.id, groupItems: row.items, conversationId: row.scopeKey})), [rows]);
  type ViewRow = typeof viewRows[number];
  const isRead = useCallback((row: ViewRow) => row.items.every((event) => event.createdAt <= (reads.readAt(inboxReadContext(readItem(event))!) ?? 0)),
    [reads.readAt, readItem]);
  const matchesFilter = useCallback((row: ViewRow, next: InboxFilter) =>
    matchesInbox({ categories: row.categories, groupItems: row.items, item: row.item }, next, snapshot?.agentPubkeys), [snapshot]);
  const ready = !failed && !reads.failed && !reads.unknown && Boolean(snapshot && snapshot.scope === selectionScope && reads.state);
  const authorProfiles=useMessageAuthorProfiles(viewRows.filter(row => matchesFilter(row, filter)).flatMap(({item})=>{
    if(item.channelId===null)return [];
    const conversation=snapshot?.conversations.find(value=>value.channelId===item.channelId);
    return [{principalId,workspaceId:item.channelId,eventId:item.id,pubkey:item.pubkey,...(conversation?{conversationId:conversation.id}:{})}];
  }),ready&&!["drafts","reminders"].includes(filter));
  useInboxDraftSelection({ items: drafts.entries.map(entry => ({ entry })), selectedKey: view.selectedDraftKey, setSelectedKey: view.setSelectedDraftKey,
    autoSelect: filter === "drafts", selectionEnabled: filter === "drafts", viewportWidthPx: view.widthPx, isNarrowHomeViewport: view.isNarrow });
  const status: InboxViewStatus = failed || reads.failed || reads.unknown
    ? { kind: "unavailable", message: t(reads.unknown ? "inbox.readUnknown" : "platform.loadFailed"), onRetry: refresh }
    : ready ? { kind: "ready" } : { kind: "loading" };
  const chosen = anchor ? {scopeKey: inboxScopeKey(anchor), item: anchor} : undefined;
  const chosenProject=snapshot&&chosen&&chosen.item.channelId===null?resolveProjectInboxWorkItem(snapshot.projectItems,chosen.item):undefined;
  const authorTarget = snapshot && profileTarget?.principalId === principalId && reads.visibleChannels.has(profileTarget.workspaceId) &&
    (snapshot.workspaces.some((workspace) => workspace.id === profileTarget.workspaceId) || snapshot.conversations.some(item => item.channelId === profileTarget.workspaceId && item.id === profileTarget.conversationId)) ? profileTarget : null;
  const openItem = (event: InboxEvent) => { if(event.channelId!==null)void hiddenDm.openContext({channelId:event.channelId,messageId:event.id,threadRootId:inboxThread(event.tags).rootId}); };
  const draftsPart = (part: "list" | "detail", onBack?: () => void) => snapshot ? <InboxDrafts key={`${principalId}:${part}`} principalId={principalId}
    workspaces={snapshot.workspaces} participants={snapshot.people} entries={drafts.entries}
    selectedKey={view.selectedDraftKey} onSelect={view.setSelectedDraftKey} onDelete={drafts.remove}
    showList={part === "list"} showDetail={part === "detail"} renderList={list => list} onOpen={onOpen} onBack={onBack} /> : null;
  return <InboxView state={view} status={status} items={viewRows} matchesFilter={matchesFilter} isRead={isRead}
    selectedConversationId={selected} coldResolutionPending={coldPending}
    onFilterChanged={() => setProfileTarget(null)}
    needsAction={needsAction}
    onRowSelected={() => setProfileTarget(null)}
    list={{
      activeDraftCount: drafts.entries.length,
      draftList: draftsPart("list"),
      readPending: reads.pending,
      onMarkRead: row => reads.write(inboxReadContexts(row.items.map(readItem), true)),
      onMarkUnread: row => reads.write(inboxReadContexts(row.items.map(readItem), false)),
      onMarkAllRead: unread => reads.write(inboxReadContexts(unread.flatMap(row => row.items.map(readItem)), true)),
      onOpen: row => openItem(row.item),
      sourceChannelId: row => row.item.tags.find(tag => tag[0] === "h")?.[1] ?? null,
      reopenState: row => ({pending: Boolean(row.item.channelId && hiddenDm.isReopenPending(row.item.channelId)),
        error: Boolean(row.item.channelId && hiddenDm.isReopenErrored(row.item.channelId)),
        unknown: Boolean(row.item.channelId && hiddenDm.isReopenUnknown(row.item.channelId))}),
      presentation: row => {
        const item = row.item;
        if (item.channelId === null || !snapshot) {
          const sender = truncatePubkey(item.pubkey);
          const label = getInboxTypeLabel({item, groupItems: row.items, senderLabel: sender, channelLabel: null}, locale);
          return {senderLabel: sender, timestamp: formatItemTimestamp(row.latestActivityAt), unreadCount: row.unreadCount,
            label: label.text, channel: null,
            sender: <span className="block max-w-full truncate rounded text-sm font-semibold leading-4 text-foreground">{sender}</span>,
            avatar: <UserAvatar avatarUrl={null} className="h-9 w-9" displayName={sender} size="md" shape="circle" />,
            preview: <MessageContent className="inbox-preview-markdown text-inherit" interactive={false} content={feedPreview(item, locale)} mediaTags={item.tags} />};
        }
        const conversation = snapshot.conversations.find(value => value.channelId === item.channelId);
        const member = (conversation ? snapshot.people.filter(person => conversation.participantPrincipalIds.includes(person.principalId)) : snapshot.members.get(item.channelId))?.find(candidate => candidate.pubkeys.includes(item.pubkey));
        const sender = member?.displayName || truncatePubkey(item.pubkey);
        const label = getInboxTypeLabel({item, groupItems: row.items, senderLabel: sender,
          channelLabel: snapshot.workspaces.find(workspace => workspace.id === item.channelId)?.name ?? null}, locale);
        const isSenderAgent = snapshot.agentPubkeys.has(item.pubkey);
        const target = {principalId, workspaceId: item.channelId, eventId: item.id, pubkey: item.pubkey, ...(conversation ? {conversationId: conversation.id} : {})};
        return {senderLabel: sender, timestamp: formatItemTimestamp(row.latestActivityAt), unreadCount: row.unreadCount,
          label: label.text, channel: label.channelLabel,
          sender: <MessageAuthorIdentity target={target} triggerElement="span" triggerClassName="min-w-0 max-w-full" onOpen={() => setProfileTarget(target)}><span className="block max-w-full truncate rounded text-sm font-semibold leading-4 text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">{sender}</span></MessageAuthorIdentity>,
          avatar: <MessageAuthorIdentity target={target} triggerElement="span" triggerClassName={`shrink-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${isSenderAgent ? "rounded-[30%]" : "rounded-full"}`} onOpen={() => setProfileTarget(target)}><span className="inline-flex shrink-0"><MessageAuthorAvatar target={target} profile={{value: authorProfiles(target)}} className="h-9 w-9" displayName={sender} size="md" shape={isSenderAgent ? "squircle" : "circle"} /></span></MessageAuthorIdentity>,
          preview: <MessageContent className="inbox-preview-markdown text-inherit" interactive={false}
            videoReviewCommentRootId={getInboxVideoReviewCommentRootId({item, groupItems: row.items})}
            content={feedPreview(item, locale)} workspaceId={item.channelId} conversationId={conversation?.id} mediaTags={item.tags} />};
      },
    }}
    drafts={{
      hasSelection: drafts.entries.some(entry => entry.key === view.selectedDraftKey),
      renderDetail: ({ onBack }) => draftsPart("detail", onBack),
    }}
    renderMessageDetail={({ visible, auxiliarySinglePanel, onBack }) => {
      if (!snapshot) return null;
      if (chosenProject && visible && onStartDm) return <PulsePane scopeKey={principalId} onStartDm={onStartDm}><ProjectInboxDetail host={projectsHost} key={chosen?.scopeKey} workItem={chosenProject} onBack={onBack} onOpenProject={onOpenProject?()=>onOpenProject(chosenProject.project.id,projectWorkItemTarget(chosenProject)):undefined}/></PulsePane>;
      // The unsent publication owner stays mounted while the single-panel author
      // profile covers the detail column.
      if (chosen && chosen.item.channelId !== null && (visible || auxiliarySinglePanel)) {
        const channelId = chosen.item.channelId;
        const conversation = snapshot.conversations.find(item => item.channelId === channelId);
        const members = snapshot.members.get(channelId) ?? snapshot.people.filter(person => conversation?.participantPrincipalIds.includes(person.principalId));
        return <div className={visible ? "contents" : "hidden"}><InboxThreadPane key={`${principalId}:${chosen.scopeKey}`} principalId={principalId}
          workspaceId={channelId} rootId={inboxThread(chosen.item.tags).rootId ?? chosen.item.id} selectedEventId={chosen.item.id}
          selectionItemId={effectiveSelectedItemId}
          onPublicationPendingChange={pending => setPublicationSelection(pending ? {principalId, event:chosen.item} : null)}
          channelId={snapshot.channelIds.get(channelId)}
          forum={chosen.item.channelType === "forum"}
          conversation={conversation}
          canInteract={!snapshot.hiddenDm.has(channelId)}
          onOpenAuthor={setProfileTarget} onAuthorScopeUnavailable={closeAuthorScope}
          senderLabel={members.find(member => member.pubkeys.includes(chosen.item.pubkey))?.displayName || truncatePubkey(chosen.item.pubkey)}
          channelName={snapshot.workspaces.find((workspace) => workspace.id === channelId)?.name ?? snapshot.people.filter(person => person.principalId !== principalId && conversation?.participantPrincipalIds.includes(person.principalId)).map(person=>person.displayName).join(", ")}
          members={members} onBack={onBack}
          onOpen={hiddenDm.isReopenPending(channelId) ? undefined : () => openItem(chosen.item)} /></div>;
      }
      if (!visible) return null;
      return coldPending ? <HomeLoadingState /> : coldResolutionFailed ? <section role="status">{t("platform.loadFailed")}</section> : <InboxEmptyDetail />;
    }}
    auxiliary={authorTarget && snapshot ? {
      preferredWidthPx: profileWidth,
      render: ({ isSinglePanel }) => <MessageAuthorProfile key={`${principalId}:${authorTarget.workspaceId}:${authorTarget.eventId}`}
        target={authorTarget} onClose={() => setProfileTarget(null)} onWidthChange={setProfileWidth} isSinglePanelView={isSinglePanel} layout="split" transparentChrome
        onStartDm={snapshot.members.get(authorTarget.workspaceId)?.some((member) => member.principalId === principalId && member.pubkeys.includes(authorTarget.pubkey)) ? undefined : onStartDm} />,
    } : null} />;
}
