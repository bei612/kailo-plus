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
import { inboxReadContexts, useInboxState } from "@client-kit/platform/react/use-inbox-state";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BuzzEvent } from "@/platform/bff-client";
import { MessageContent } from "@/features/chat/ui/MessageContent";
import { Button } from "@/shared/ui/button";

type Event = BuzzEvent & { createdAt: number; channelId: string; category: "mention" | "activity" };
type Snapshot = {
  mentions: Event[];
  activity: Event[];
  workspaces: WorkspaceView[];
  members: Map<string, WorkspaceMemberView[]>;
};
const hex = /^[0-9a-f]{64}$/;

/** The query is already scope-filtered by Core; mismatched/unverifiable data is never shown. */
export function inboxEvents(raw: unknown, workspace: string): Event[] {
  if (!Array.isArray(raw)) throw new Error("Invalid message page");
  return raw.map((value: unknown) => {
    const event = value as BuzzEvent;
    if (
      !event ||
      !hex.test(event.id) ||
      !hex.test(event.pubkey) ||
      event.kind !== 9 ||
      !Number.isSafeInteger(event.created_at) ||
      event.created_at < 0 ||
      !Number.isFinite(new Date(event.created_at * 1000).getTime()) ||
      typeof event.content !== "string" ||
      !Array.isArray(event.tags) ||
      event.tags.some(
        (tag) => !Array.isArray(tag) || tag.some((part) => typeof part !== "string"),
      ) ||
      event.tags.filter((tag) => tag[0] === "h").length !== 1 ||
      !event.tags.some((tag) => tag[0] === "h" && tag[1] === workspace)
    ) {
      throw new Error("Unverifiable message scope");
    }
    return { ...event, createdAt: event.created_at, channelId: workspace, category: "activity" };
  });
}

export function InboxPane({
  principalId,
  onOpen,
}: {
  principalId: string;
  onOpen: (workspaceId: string) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const reads = useInboxState(client);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
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
      const next: Snapshot = { mentions: [], activity: [], workspaces, members: new Map() };
      // One HTTP read at a time. No browser Relay filter, signer or unbounded SSE fan-out.
      for (const workspace of workspaces) {
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
      const visible = new Set((await client.workspaces()).map((workspace) => workspace.id));
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
  return (
    <section aria-label={t("inbox.title")} className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border p-3">
        <h1 className="font-semibold">{t("inbox.title")}</h1>
        <select
          aria-label={t("inbox.title")}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          {(["all", "mention", "thread"] as const).map((value) => (
            <option key={value} value={value}>
              {t(`inbox.${value}`)}
            </option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(event) => setUnreadOnly(event.target.checked)}
          />{" "}
          {t("inbox.unreadOnly")}
        </label>
        <Button onClick={refresh}>{t("platform.refresh")}</Button>
        <p className="w-full text-xs text-muted-foreground">{t("inbox.scope")}</p>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {visibleRows.map((row) => {
          const item = row.item;
          const member = snapshot.members
            .get(item.channelId)
            ?.find((candidate) => candidate.pubkeys.includes(item.pubkey));
          const sender = member?.displayName || truncatePubkey(item.pubkey);
          const read = row.items.every(
            (event) =>
              event.createdAt <=
              (reads.readAt(inboxReply(event.tags) ? `msg:${event.id}` : event.channelId) ?? 0),
          );
          return (
            <InboxRow
              key={row.scopeKey}
              id={item.id}
              selected={false}
              read={read}
              sender={sender}
              timestamp={relativeTime(locale, new Date(row.latestActivityAt * 1000).toISOString())}
              unread={
                row.unreadCount > 1 ? t("inbox.unreadCount", { count: row.unreadCount }) : null
              }
              label={t(item.category === "mention" ? "inbox.mentionedIn" : "inbox.threadIn")}
              channel={
                snapshot.workspaces.find((workspace) => workspace.id === item.channelId)?.name ??
                null
              }
              openLabel={t("inbox.openItem", { sender })}
              onSelect={() => onOpen(item.channelId)}
              preview={
                <MessageContent
                  content={item.content}
                  workspaceId={item.channelId}
                  mediaTags={item.tags}
                />
              }
              actions={
                <>
                  <Button
                    disabled={reads.pending}
                    onClick={() => reads.write(inboxReadContexts(row.items, !read))}
                  >
                    {t(read ? "inbox.markUnread" : "inbox.markRead")}
                  </Button>
                  <Button onClick={() => onOpen(item.channelId)}>{t("inbox.open")}</Button>
                </>
              }
            />
          );
        })}
        {visibleRows.length === 0 ? (
          <p className="p-6 text-muted-foreground">{t("inbox.empty")}</p>
        ) : null}
      </div>
    </section>
  );
}
