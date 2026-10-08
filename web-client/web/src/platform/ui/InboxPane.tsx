// Web transport adapter only: aggregation and rows are the same TS used by Buzz Desktop Home.
import {
  WorkspaceMembershipState,
  type WorkspaceMemberView,
  type WorkspaceView,
  type ConversationView, type ConversationParticipant,
} from "@client-kit/contracts";
import {
  aggregateInbox,
  inboxConversation,
  inboxReply,
  inboxReadContext,
  inboxThread,
  matchesInbox,
  loadOwnedAgentIdentities,
} from "@client-kit/platform/inbox";
import { relativeTime, truncatePubkey } from "@client-kit/platform/format";
import { useBffClient, useLocale, useT } from "@client-kit/platform/react/context";
import { loadInboxConversations, useHiddenDmInboxNavigation, useConversationVisibilityHost, type InboxNavigationTarget } from "@client-kit/platform/react/new-message";
import { toast } from "sonner";
import { InboxRow } from "@client-kit/platform/react/inbox-row";
import { HomeLoadingState, InboxLayout, InboxListHeader, InboxEmptyDetail, InboxEmptyList, InboxRowActionButton, InboxReopenStatus, useInboxDraftSelection, type InboxFilter } from "@client-kit/platform/react/inbox-surface";
import { useResizableInboxListWidth, INBOX_SINGLE_COLUMN_BREAKPOINT_PX, INBOX_COLUMN_MIN_WIDTH_PX } from "@client-kit/platform/react/use-resizable-inbox-list-width";
import { AUXILIARY_PANEL_DEFAULT_WIDTH_PX, AUXILIARY_PANEL_SINGLE_COLUMN_BREAKPOINT_PX } from "@client-kit/platform/react/thread";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@client-kit/platform/react/sidebar/context-menu";
import { ExternalLink, MailOpen } from "lucide-react";
import { InboxThreadPane } from "./InboxThreadPane";
import { InboxDrafts, useInboxDrafts } from "./InboxDrafts";
import { inboxReadContexts, useInboxState } from "@client-kit/platform/react/use-inbox-state";
import { useHomeInboxAutoSelection } from "@client-kit/platform/react/use-inbox-auto-selection";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hex, inboxEvents, inboxWindowEvents, type Event } from "./inbox-events";
export { inboxEvents } from "./inbox-events";
import { MessageContent } from "@/features/chat/ui/MessageContent";
import { Button } from "@/shared/ui/button";
import { MessageAuthorAvatar, MessageAuthorIdentity, MessageAuthorProfile, type MessageAuthor } from "./MessageAuthorProfile";

type Snapshot = {
  mentions: Event[];
  activity: Event[];
  workspaces: WorkspaceView[];
  members: Map<string, WorkspaceMemberView[]>;
  agentPubkeys: Set<string>;
  conversations: ConversationView[];
  people: ConversationParticipant[];
  hiddenDm: ReadonlySet<string>;
};

export function InboxPane({
  principalId,
  onOpen,
  onUnreadCount,
  onStartDm,
}: {
  principalId: string;
  onOpen: (channelId: string, target?: InboxNavigationTarget) => void | Promise<void>;
  onUnreadCount?: (count: number | null) => void;
  onStartDm?: (pubkey: string) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const reads = useInboxState(client);
  const visibility = useConversationVisibilityHost();
  const hiddenDm = useHiddenDmInboxNavigation({ scopeKey: principalId, conversations: reads.conversations,
    onOpenContext: target => onOpen(target.channelId, target), onError: message => toast.error(message) });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedDraft, setSelectedDraft] = useState<string | null>(null);
  const [profileTarget, setProfileTarget] = useState<MessageAuthor | null>(null);
  const [profileWidth, setProfileWidth] = useState(AUXILIARY_PANEL_DEFAULT_WIDTH_PX);
  const closeAuthorScope = useCallback((workspaceId: string) => {
    setProfileTarget((target) => target?.workspaceId === workspaceId ? null : target);
  }, []);
  const drafts = useInboxDrafts(principalId);
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const resize = useResizableInboxListWidth();
  useEffect(() => { setSelected(null); setSelectedDraft(null); setProfileTarget(null); }, [principalId]);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(entry.contentRect.width); });
    observer.observe(node);
    return () => observer.disconnect();
  }, [snapshot !== null, reads.state !== null, failed, reads.failed, reads.unknown]);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const epoch = ++generation.current;
    setSnapshot(null);
    setFailed(false);
    try {
      const workspaces = await client.workspaces();
      if (
        !Array.isArray(workspaces) ||
        new Set(workspaces.map((workspace) => workspace.id)).size !== workspaces.length
      )
        throw new Error("Invalid Workspace directory");
      const joined = workspaces.filter((workspace) => workspace.isMember === true);
      const conversations = await loadInboxConversations(client, () => epoch === generation.current);
      if (epoch !== generation.current) return;
      const people: ConversationParticipant[] = [];
      if (conversations.length) {
        let cursor: string | undefined; const seen = new Set<string>();
        do {
          const page = await client.conversationParticipants(cursor);
          if (epoch !== generation.current) return;
          if (!Array.isArray(page.items)) throw new Error("Invalid Conversation participants");
          people.push(...page.items); cursor = page.nextCursor;
          if (cursor && seen.has(cursor)) throw new Error("Participant cursor did not advance");
          if (cursor) seen.add(cursor);
        } while (cursor);
      }
      if (conversations.length && !visibility) throw new Error("Conversation visibility unavailable");
      const hiddenDm = conversations[0] ? await visibility!.read(conversations[0]) : new Set<string>();
      const next: Snapshot = { mentions: [], activity: [], workspaces: joined, members: new Map(), agentPubkeys: new Set(), conversations, people, hiddenDm };
      // One HTTP read at a time. No browser Relay filter, signer or unbounded SSE fan-out.
      for (const workspace of joined) {
        if (epoch !== generation.current) return;
        const members = await client.members(workspace.id);
        if (
          !Array.isArray(members) ||
          members.some(
            (member) =>
              typeof member.principalId !== "string" ||
              typeof member.displayName !== "string" ||
              !Array.isArray(member.pubkeys) ||
              member.pubkeys.some((key) => !hex.test(key)),
          )
        )
          throw new Error("Invalid member page");
        const identities = members.filter(
          (member) =>
            member.principalId === principalId && member.state === WorkspaceMembershipState.Active,
        );
        if (identities.length !== 1) throw new Error("Unverifiable own identity");
        const self = identities[0];
        if (
          !self ||
          !Array.isArray(self.pubkeys) ||
          self.pubkeys.length === 0 ||
          self.pubkeys.some((key) => !hex.test(key))
        )
          throw new Error("Unverifiable own identity");
        const own = new Set(self.pubkeys);
        const events = inboxWindowEvents(
          (await client.workspaceMessages(workspace.id)).events,
          workspace.id,
        );
        const mentioned = (event: Event) =>
          event.tags.some((tag) => tag[0] === "p" && own.has(tag[1]));
        // Same upstream interest rule: authored/participated/mentioned roots, not all channel traffic.
        const roots = new Set(
          events
            .filter((event) => own.has(event.pubkey) || mentioned(event))
            .map(inboxConversation),
        );
        next.mentions.push(
          ...events
            .filter((event) => !own.has(event.pubkey) && mentioned(event))
            .map((event) => ({ ...event, category: "mention" as const })),
        );
        next.activity.push(
          ...events.filter(
            (event) =>
              !own.has(event.pubkey) &&
              inboxReply(event.tags) &&
              roots.has(inboxConversation(event)),
          ),
        );
        const agents = await loadOwnedAgentIdentities(client, workspace.id, principalId);
        for (const [installationId, pubkey] of agents) {
          if (epoch !== generation.current) return;
          const activity = inboxEvents((await client.workspaceMessages(workspace.id, { agentInstallationId: installationId })).events, workspace.id);
          if (activity.some((event) => event.pubkey !== pubkey)) throw new Error("Unverifiable Agent author");
          next.activity.push(...activity);
          next.agentPubkeys.add(pubkey);
        }
        next.members.set(workspace.id, members);
      }
      for (const conversation of conversations) {
        if (epoch !== generation.current) return;
        if (!conversation.participantPrincipalIds.includes(principalId)) throw new Error("Conversation participant changed");
        const self = people.find(person => person.principalId === principalId);
        if (!self?.pubkeys.length || self.pubkeys.some(key => !hex.test(key))) throw new Error("Unverifiable Conversation identity");
        const own = new Set(self.pubkeys);
        const events = inboxWindowEvents((await client.conversationMessages(conversation.id)).events, conversation.channelId).map(event => ({...event, channelType: "dm"}));
        // Original Inbox includes ordinary incoming DMs, not only mentions or
        // replies. Sidebar hidden_at is not loss of read participation.
        const mentioned = (event: Event) => event.tags.some(tag => tag[0] === "p" && own.has(tag[1]));
        next.mentions.push(...events.filter(event => !own.has(event.pubkey) && mentioned(event)).map(event => ({...event,category:"mention" as const})));
        next.activity.push(...events.filter(event => !own.has(event.pubkey)));
      }
      // A scope removed during aggregation cannot survive as a cached row.
      if (epoch !== generation.current) return;
      const visible = new Set((await client.workspaces()).filter((workspace) => workspace.isMember === true).map((workspace) => workspace.id));
      const currentConversations = await loadInboxConversations(client, () => epoch === generation.current);
      next.conversations = next.conversations.filter(item => currentConversations.some(current => current.id === item.id && current.channelId === item.channelId && current.participantPrincipalIds.includes(principalId)));
      next.conversations.forEach(item => visible.add(item.channelId));
      next.mentions = next.mentions.filter((event) => visible.has(event.channelId));
      next.activity = next.activity.filter((event) => visible.has(event.channelId));
      next.workspaces = next.workspaces.filter((workspace) => visible.has(workspace.id));
      if (epoch === generation.current) setSnapshot(next);
    } catch {
      if (epoch === generation.current) setFailed(true);
    }
  }, [client, principalId, visibility]);
  useEffect(() => {
    void load();
    const refresh = () => {
      void load();
    };
    window.addEventListener("focus", refresh);
    return () => {
      generation.current += 1;
      window.removeEventListener("focus", refresh);
    };
  }, [load]);
  const rows = useMemo(
    () =>
      snapshot
        ? aggregateInbox(
            {
              mentions: snapshot.mentions.filter((event) =>
                reads.visibleChannels.has(event.channelId),
              ),
              activity: snapshot.activity.filter((event) =>
                reads.visibleChannels.has(event.channelId),
              ),
            },
            (id) => reads.readAt(`msg:${id}`),
            (root) => reads.readAt(`thread:${root}`),
            reads.readAt,
          )
        : [],
    [snapshot, reads.readAt, reads.visibleChannels],
  );
  const refresh = () => {
    void load();
    void reads.refresh();
  };
  useEffect(() => {
    onUnreadCount?.(failed || reads.failed || reads.unknown || !snapshot || !reads.state ? null : rows.filter((row) =>
      row.items.some((event) => event.createdAt > (reads.readAt(inboxReadContext(event)!) ?? 0))).length);
  }, [onUnreadCount, failed, reads.failed, reads.unknown, snapshot, reads.state, rows, reads.readAt]);
  useEffect(() => () => onUnreadCount?.(null), [onUnreadCount]);
  const visibleRows = rows
    .filter((row) => matchesInbox({ categories: row.categories, groupItems: row.items, item: row.item }, filter, snapshot?.agentPubkeys))
    .filter(
      (row) =>
        !unreadOnly || row.scopeKey === selected ||
        row.items.some(
          (item) =>
            item.createdAt >
            (reads.readAt(inboxReadContext(item)!) ?? 0),
        ),
    );
  const narrow = width !== null && width < INBOX_SINGLE_COLUMN_BREAKPOINT_PX;
  useInboxDraftSelection({ items: drafts.entries.map(entry => ({ entry })), selectedKey: selectedDraft, setSelectedKey: setSelectedDraft,
    autoSelect: filter === "drafts", selectionEnabled: filter === "drafts", viewportWidthPx: width ?? 0, isNarrowHomeViewport: narrow });
  // The original selection hook receives the admitted scope key as its stable
  // identity; equal Relay root IDs in different channels must not share a pane.
  const selectionItems = useMemo(() => visibleRows.map(row => ({ id: row.scopeKey, conversationId: row.scopeKey })), [visibleRows]);
  useHomeInboxAutoSelection({
    coldResolutionPending: false,
    filteredItems: selectionItems,
    hasFeed: Boolean(snapshot && reads.state),
    hasPersonalSelection: filter === "drafts" && selectedDraft !== null,
    homeInboxWidthPx: width ?? 0,
    isLoading: failed || reads.failed || reads.unknown || !snapshot || !reads.state,
    isMessagesMode: filter !== "drafts",
    isNarrowHomeViewport: narrow,
    selectedConversationId: selected,
    setAutoSelectedEventId: setSelected,
    urlSelectedItemId: null,
  });
  if (failed || reads.failed || reads.unknown)
    return (
      <section role="status">
        <p>{t(reads.unknown ? "inbox.readUnknown" : "platform.loadFailed")}</p>
        <Button onClick={refresh}>{t("platform.refresh")}</Button>
      </section>
    );
  if (!snapshot || !reads.state) return <HomeLoadingState />;
  const chosen = visibleRows.find((row) => row.scopeKey === selected);
  const authorTarget = profileTarget?.principalId === principalId && reads.visibleChannels.has(profileTarget.workspaceId) &&
    (snapshot.workspaces.some((workspace) => workspace.id === profileTarget.workspaceId) || snapshot.conversations.some(item => item.channelId === profileTarget.workspaceId && item.id === profileTarget.conversationId)) ? profileTarget : null;
  const openItem = (event: Event) => { void hiddenDm.openContext({channelId:event.channelId,messageId:event.id,threadRootId:inboxThread(event.tags).rootId}); };
  const singleAuxiliary = Boolean(authorTarget) && width !== null && width < AUXILIARY_PANEL_SINGLE_COLUMN_BREAKPOINT_PX;
  const hasSelection = filter === "drafts" ? drafts.entries.some((entry) => entry.key === selectedDraft) : Boolean(chosen);
  const showList = !singleAuxiliary && (!narrow || !hasSelection);
  const showDetail = !singleAuxiliary && (!narrow || hasSelection);
  const listWidth = width === null ? resize.inboxListWidthPx : Math.min(resize.inboxListWidthPx, Math.max(INBOX_COLUMN_MIN_WIDTH_PX, width - INBOX_COLUMN_MIN_WIDTH_PX));
  const isRead = (row: typeof rows[number]) => row.items.every((event) => event.createdAt <= (reads.readAt(inboxReadContext(event)!) ?? 0));
  const header = <InboxListHeader filter={filter} onFilterChange={(next) => {setProfileTarget(null);setFilter(next);}} activeDraftCount={drafts.entries.length} unreadOnly={unreadOnly} onUnreadOnlyChange={setUnreadOnly}
    unreadCount={visibleRows.filter((row) => !isRead(row)).length} pending={reads.pending}
    onMarkAllRead={() => reads.write(inboxReadContexts(visibleRows.flatMap((row) => row.items), true))} />;
  if (filter === "drafts") return <InboxLayout containerRef={container} listWidth={listWidth} showList={showList} showDetail={showDetail}
    onResize={resize.handleInboxListResizeStart} onReset={resize.canResetInboxListWidth ? resize.handleInboxListWidthReset : undefined}>
    <InboxDrafts key={principalId} principalId={principalId} workspaces={snapshot.workspaces} members={snapshot.members} participants={snapshot.people} entries={drafts.entries}
      selectedKey={selectedDraft} onSelect={setSelectedDraft} onDelete={drafts.remove} showList={showList} showDetail={showDetail} header={header}
      onStartDm={onStartDm}
      onBack={narrow ? () => setSelectedDraft(null) : undefined} />
  </InboxLayout>;
  return <InboxLayout containerRef={container} listWidth={listWidth} showList={showList} showDetail={showDetail}
    hasAuxiliary={Boolean(authorTarget)} singleAuxiliary={singleAuxiliary} auxiliaryWidth={profileWidth}
    onResize={resize.handleInboxListResizeStart} onReset={resize.canResetInboxListWidth ? resize.handleInboxListWidthReset : undefined}>
    {showList ? <section aria-label={t("inbox.title")} className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-background/60 ${showDetail ? "after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:z-40 after:w-px after:bg-border/35 after:content-['']" : ""}`}>
      {header}
      <div className="-mt-13 min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain pt-13" data-testid="home-inbox-list">
        {visibleRows.map((row) => {
          const item = row.item;
          const conversation = snapshot.conversations.find(value => value.channelId === item.channelId);
          const member = (conversation ? snapshot.people.filter(person => conversation.participantPrincipalIds.includes(person.principalId)) : snapshot.members.get(item.channelId))?.find((candidate) => candidate.pubkeys.includes(item.pubkey));
          const sender = member?.displayName || truncatePubkey(item.pubkey);
          const isSenderAgent = snapshot.agentPubkeys.has(item.pubkey);
          const read = isRead(row);
          const mark = () => reads.write(inboxReadContexts(row.items, !read));
          const target = {principalId,workspaceId:item.channelId,eventId:item.id,pubkey:item.pubkey,...(conversation ? {conversationId:conversation.id} : {})};
          return <ContextMenu key={row.scopeKey}><ContextMenuTrigger asChild><div>
            <InboxRow id={item.id} selected={row.scopeKey === selected} read={read}
              sender={<MessageAuthorIdentity target={target} triggerElement="span" triggerClassName="min-w-0 max-w-full" onOpen={() => setProfileTarget(target)}><span className="block max-w-full truncate rounded text-sm font-semibold leading-4 text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">{sender}</span></MessageAuthorIdentity>}
              avatar={<MessageAuthorIdentity target={target} triggerElement="span" triggerClassName={`shrink-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${isSenderAgent ? "rounded-[30%]" : "rounded-full"}`} onOpen={() => setProfileTarget(target)}><span className="inline-flex shrink-0"><MessageAuthorAvatar target={target} className="h-9 w-9" displayName={sender} size="md" shape={isSenderAgent ? "squircle" : "circle"} /></span></MessageAuthorIdentity>}
              timestamp={relativeTime(locale, new Date(row.latestActivityAt * 1000).toISOString())}
              unread={row.unreadCount > 1 ? t("inbox.unreadCount", { count: row.unreadCount }) : null}
              label={item.channelType === "dm" ? t("inbox.dmFrom", { sender }) : t(item.category === "mention" ? "inbox.mentionedIn" : "inbox.threadIn")}
              channel={snapshot.workspaces.find((workspace) => workspace.id === item.channelId)?.name ?? null}
              openLabel={t("inbox.openItem", { sender })}
              onSelect={() => { setProfileTarget(null);setSelected(row.scopeKey); if (!read) reads.write(inboxReadContexts(row.items, true)); }}
              preview={<><MessageContent content={item.content} workspaceId={item.channelId} conversationId={conversation?.id} mediaTags={item.tags} /><InboxReopenStatus id={item.id} pending={hiddenDm.isReopenPending(item.channelId)} error={hiddenDm.isReopenErrored(item.channelId)} unknown={hiddenDm.isReopenUnknown(item.channelId)} onRetry={()=>openItem(item)}/></>}
              actions={<>
                <InboxRowActionButton disabled={reads.pending} label={t(read ? "inbox.markUnread" : "inbox.markRead")} onClick={mark}><MailOpen className="h-4 w-4" /></InboxRowActionButton>
                <InboxRowActionButton disabled={hiddenDm.isReopenPending(item.channelId)} label={t(hiddenDm.isReopenPending(item.channelId) ? "inbox.reopening" : "inbox.open")} onClick={() => openItem(item)}><ExternalLink className="h-4 w-4" /></InboxRowActionButton>
              </>} />
          </div></ContextMenuTrigger><ContextMenuContent>
            <ContextMenuItem disabled={reads.pending} onSelect={mark}><MailOpen className="h-4 w-4" />{t(read ? "inbox.markUnread" : "inbox.markRead")}</ContextMenuItem>
            <ContextMenuSeparator /><ContextMenuItem disabled={hiddenDm.isReopenPending(item.channelId)} onSelect={() => openItem(item)}><ExternalLink className="h-4 w-4" />{t("inbox.open")}</ContextMenuItem>
          </ContextMenuContent></ContextMenu>;
        })}
        {!visibleRows.length ? <InboxEmptyList filter={filter} unreadOnly={unreadOnly} /> : null}
      </div>
    </section> : null}
    {chosen && (showDetail || singleAuxiliary) ? <div className={singleAuxiliary ? "hidden" : "contents"}><InboxThreadPane key={`${principalId}:${chosen.scopeKey}`} principalId={principalId}
      workspaceId={chosen.item.channelId} rootId={inboxThread(chosen.item.tags).rootId ?? chosen.item.id} selectedEventId={chosen.item.id}
      conversation={snapshot.conversations.find(item => item.channelId === chosen.item.channelId)}
      canInteract={!snapshot.hiddenDm.has(chosen.item.channelId)}
      onOpenAuthor={setProfileTarget} onAuthorScopeUnavailable={closeAuthorScope}
      channelName={snapshot.workspaces.find((workspace) => workspace.id === chosen.item.channelId)?.name ?? snapshot.people.filter(person => person.principalId !== principalId && snapshot.conversations.find(item => item.channelId === chosen.item.channelId)?.participantPrincipalIds.includes(person.principalId)).map(person=>person.displayName).join(", ")}
      members={snapshot.members.get(chosen.item.channelId) ?? snapshot.people.filter(person => snapshot.conversations.find(item => item.channelId === chosen.item.channelId)?.participantPrincipalIds.includes(person.principalId))} onBack={narrow ? () => setSelected(null) : undefined}
      onOpen={hiddenDm.isReopenPending(chosen.item.channelId) ? undefined : () => openItem(chosen.item)} /></div> : showDetail ? <InboxEmptyDetail /> : null}
    {authorTarget ? <MessageAuthorProfile key={`${principalId}:${authorTarget.workspaceId}:${authorTarget.eventId}`}
      target={authorTarget} onClose={() => setProfileTarget(null)} onWidthChange={setProfileWidth} isSinglePanelView={singleAuxiliary}
      onStartDm={snapshot.members.get(authorTarget.workspaceId)?.some((member) => member.principalId === principalId && member.pubkeys.includes(authorTarget.pubkey)) ? undefined : onStartDm} /> : null}
  </InboxLayout>;
}
