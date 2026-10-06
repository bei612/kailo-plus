// Web transport adapter only: aggregation and rows are the same TS used by Buzz Desktop Home.
import {
  WorkspaceMembershipState,
  type WorkspaceMemberView,
  type WorkspaceView,
} from "@client-kit/contracts";
import {
  aggregateInbox,
  inboxConversation,
  inboxReply,
  matchesInbox,
} from "@client-kit/platform/inbox";
import { relativeTime, truncatePubkey } from "@client-kit/platform/format";
import { useBffClient, useLocale, useT } from "@client-kit/platform/react/context";
import { InboxRow } from "@client-kit/platform/react/inbox-row";
import { InboxLayout, InboxListHeader, InboxEmptyDetail, InboxRowActionButton, type InboxFilter } from "@client-kit/platform/react/inbox-surface";
import { useResizableInboxListWidth, INBOX_SINGLE_COLUMN_BREAKPOINT_PX, INBOX_COLUMN_MIN_WIDTH_PX } from "@client-kit/platform/react/use-resizable-inbox-list-width";
import { UserAvatar } from "@client-kit/platform/react/messages";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@client-kit/platform/react/sidebar/context-menu";
import { ExternalLink, MailOpen } from "lucide-react";
import { InboxThreadPane } from "./InboxThreadPane";
import { InboxDrafts, useInboxDrafts } from "./InboxDrafts";
import { inboxReadContexts, useInboxState } from "@client-kit/platform/react/use-inbox-state";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hex, inboxEvents, type Event } from "./inbox-events";
export { inboxEvents } from "./inbox-events";
import { MessageContent } from "@/features/chat/ui/MessageContent";
import { Button } from "@/shared/ui/button";

type Snapshot = {
  mentions: Event[];
  activity: Event[];
  workspaces: WorkspaceView[];
  members: Map<string, WorkspaceMemberView[]>;
};

export function InboxPane({
  principalId,
  onOpen,
  onUnreadCount,
}: {
  principalId: string;
  onOpen: (workspaceId: string) => void;
  onUnreadCount?: (count: number | null) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const reads = useInboxState(client);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedDraft, setSelectedDraft] = useState<string | null>(null);
  const drafts = useInboxDrafts(principalId);
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const resize = useResizableInboxListWidth();
  useEffect(() => { setSelected(null); setSelectedDraft(null); }, [principalId]);
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
      const next: Snapshot = { mentions: [], activity: [], workspaces: joined, members: new Map() };
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
        const events = inboxEvents(
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
        next.members.set(workspace.id, members);
      }
      // A scope removed during aggregation cannot survive as a cached row.
      const visible = new Set((await client.workspaces()).filter((workspace) => workspace.isMember === true).map((workspace) => workspace.id));
      next.mentions = next.mentions.filter((event) => visible.has(event.channelId));
      next.activity = next.activity.filter((event) => visible.has(event.channelId));
      next.workspaces = next.workspaces.filter((workspace) => visible.has(workspace.id));
      if (epoch === generation.current) setSnapshot(next);
    } catch {
      if (epoch === generation.current) setFailed(true);
    }
  }, [client, principalId]);
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
      row.items.some((event) => event.createdAt > (reads.readAt(inboxReply(event.tags) ? `msg:${event.id}` : event.channelId) ?? 0))).length);
  }, [onUnreadCount, failed, reads.failed, reads.unknown, snapshot, reads.state, rows, reads.readAt]);
  useEffect(() => () => onUnreadCount?.(null), [onUnreadCount]);
  if (failed || reads.failed || reads.unknown)
    return (
      <section role="status">
        <p>{t(reads.unknown ? "inbox.readUnknown" : "platform.loadFailed")}</p>
        <Button onClick={refresh}>{t("platform.refresh")}</Button>
      </section>
    );
  if (!snapshot || !reads.state) return <p role="status">{t("platform.loading")}</p>;
  const visibleRows = rows
    .filter((row) => matchesInbox({ categories: row.categories, groupItems: row.items }, filter))
    .filter(
      (row) =>
        !unreadOnly ||
        row.items.some(
          (item) =>
            item.createdAt >
            (reads.readAt(inboxReply(item.tags) ? `msg:${item.id}` : item.channelId) ?? 0),
        ),
    );
  const chosen = rows.find((row) => row.scopeKey === selected);
  const narrow = width !== null && width < INBOX_SINGLE_COLUMN_BREAKPOINT_PX;
  const hasSelection = filter === "drafts" ? drafts.entries.some((entry) => entry.key === selectedDraft) : Boolean(chosen);
  const showList = !narrow || !hasSelection;
  const showDetail = !narrow || hasSelection;
  const listWidth = width === null ? resize.inboxListWidthPx : Math.min(resize.inboxListWidthPx, Math.max(INBOX_COLUMN_MIN_WIDTH_PX, width - INBOX_COLUMN_MIN_WIDTH_PX));
  const isRead = (row: typeof rows[number]) => row.items.every((event) => event.createdAt <= (reads.readAt(inboxReply(event.tags) ? `msg:${event.id}` : event.channelId) ?? 0));
  const header = <InboxListHeader filter={filter} onFilterChange={setFilter} activeDraftCount={drafts.entries.length} unreadOnly={unreadOnly} onUnreadOnlyChange={setUnreadOnly}
    unreadCount={visibleRows.filter((row) => !isRead(row)).length} pending={reads.pending}
    onMarkAllRead={() => reads.write(inboxReadContexts(visibleRows.flatMap((row) => row.items), true))} />;
  if (filter === "drafts") return <InboxLayout containerRef={container} listWidth={listWidth} showList={showList} showDetail={showDetail}
    onResize={resize.handleInboxListResizeStart} onReset={resize.canResetInboxListWidth ? resize.handleInboxListWidthReset : undefined}>
    <InboxDrafts key={principalId} principalId={principalId} workspaces={snapshot.workspaces} members={snapshot.members} entries={drafts.entries}
      selectedKey={selectedDraft} onSelect={setSelectedDraft} onDelete={drafts.remove} showList={showList} showDetail={showDetail} header={header}
      onBack={narrow ? () => setSelectedDraft(null) : undefined} />
  </InboxLayout>;
  return <InboxLayout containerRef={container} listWidth={listWidth} showList={showList} showDetail={showDetail}
    onResize={resize.handleInboxListResizeStart} onReset={resize.canResetInboxListWidth ? resize.handleInboxListWidthReset : undefined}>
    {showList ? <section aria-label={t("inbox.title")} className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-background/60 ${showDetail ? "after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:z-40 after:w-px after:bg-border/35 after:content-['']" : ""}`}>
      {header}
      <div className="-mt-13 min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain pt-13" data-testid="home-inbox-list">
        {visibleRows.map((row) => {
          const item = row.item;
          const member = snapshot.members.get(item.channelId)?.find((candidate) => candidate.pubkeys.includes(item.pubkey));
          const sender = member?.displayName || truncatePubkey(item.pubkey);
          const read = isRead(row);
          const mark = () => reads.write(inboxReadContexts(row.items, !read));
          return <ContextMenu key={row.scopeKey}><ContextMenuTrigger asChild><div>
            <InboxRow id={item.id} selected={row.scopeKey === selected} read={read} sender={sender}
              avatar={<UserAvatar avatarUrl={null} displayName={sender} size="sm" />}
              timestamp={relativeTime(locale, new Date(row.latestActivityAt * 1000).toISOString())}
              unread={row.unreadCount > 1 ? t("inbox.unreadCount", { count: row.unreadCount }) : null}
              label={t(item.category === "mention" ? "inbox.mentionedIn" : "inbox.threadIn")}
              channel={snapshot.workspaces.find((workspace) => workspace.id === item.channelId)?.name ?? null}
              openLabel={t("inbox.openItem", { sender })}
              onSelect={() => { setSelected(row.scopeKey); if (!read) reads.write(inboxReadContexts(row.items, true)); }}
              preview={<MessageContent content={item.content} workspaceId={item.channelId} mediaTags={item.tags} />}
              actions={<>
                <InboxRowActionButton disabled={reads.pending} label={t(read ? "inbox.markUnread" : "inbox.markRead")} onClick={mark}><MailOpen className="h-4 w-4" /></InboxRowActionButton>
                <InboxRowActionButton label={t("inbox.open")} onClick={() => onOpen(item.channelId)}><ExternalLink className="h-4 w-4" /></InboxRowActionButton>
              </>} />
          </div></ContextMenuTrigger><ContextMenuContent>
            <ContextMenuItem disabled={reads.pending} onSelect={mark}><MailOpen className="h-4 w-4" />{t(read ? "inbox.markUnread" : "inbox.markRead")}</ContextMenuItem>
            <ContextMenuSeparator /><ContextMenuItem onSelect={() => onOpen(item.channelId)}><ExternalLink className="h-4 w-4" />{t("inbox.open")}</ContextMenuItem>
          </ContextMenuContent></ContextMenu>;
        })}
        {!visibleRows.length ? <div className="flex h-full min-h-64 items-center justify-center px-6 text-center"><div>
          <p className="text-sm font-medium text-foreground">{t(unreadOnly ? "inbox.noUnread" : "inbox.noActivity")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t(unreadOnly ? "inbox.unreadEmptyHint" : "inbox.emptyHint")}</p>
        </div></div> : null}
      </div>
    </section> : null}
    {showDetail ? chosen ? <InboxThreadPane key={`${principalId}:${chosen.scopeKey}`} principalId={principalId}
      workspaceId={chosen.item.channelId} rootId={chosen.conversationId} selectedEventId={chosen.item.id}
      channelName={snapshot.workspaces.find((workspace) => workspace.id === chosen.item.channelId)?.name ?? ""}
      members={snapshot.members.get(chosen.item.channelId) ?? []} onBack={narrow ? () => setSelected(null) : undefined}
      onOpen={() => onOpen(chosen.item.channelId)} /> : <InboxEmptyDetail /> : null}
  </InboxLayout>;
}
