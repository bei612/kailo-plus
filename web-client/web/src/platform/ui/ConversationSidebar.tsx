// Web data adapter for the shared pinned Buzz DM rows. Core admits, Relay owns messages.
import type { ComponentProps } from "react";
import { useQuery } from "@tanstack/react-query";
import { ConversationList, loadInboxConversations } from "@client-kit/platform/react/new-message";
import { useBffClient } from "@client-kit/platform/react/context";
import type { BffClient } from "@client-kit/platform/client";
import type { ConversationView } from "@client-kit/contracts";
import { hex, inboxReactionEvents, inboxWindowEvents, type Event } from "./inbox-events";
import { KIND_DELETION, KIND_NIP29_DELETE_EVENT } from "@client-kit/platform/react/thread/kinds";

export async function loadConversationSidebarActivity(client: BffClient, principal: string, conversations: readonly ConversationView[], signal: AbortSignal) {
  const own = new Set<string>();
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    signal.throwIfAborted();
    const page = await client.conversationParticipants(cursor);
    signal.throwIfAborted();
    for (const person of page.items) if (person.principalId === principal) {
      if (!person.pubkeys.length || person.pubkeys.some(key => !hex.test(key))) throw new Error("Unverifiable own DM identity");
      person.pubkeys.forEach(key => own.add(key));
    }
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error("Conversation participant cursor did not advance");
    if (cursor) seen.add(cursor);
  } while (cursor);
  if (!own.size) throw new Error("Missing own DM identity");
  const events: Event[] = [];
  const lastMessageAt = new Map<string, string | null>();
  for (const conversation of conversations) {
    signal.throwIfAborted();
    if (conversation.state !== "ACTIVE" || !conversation.participantPrincipalIds.includes(principal)) throw new Error("Conversation not admitted");
    const page = await client.conversationMessages(conversation.id);
    signal.throwIfAborted();
    const windowRows = inboxWindowEvents(page.events, conversation.channelId);
    // As in Buzz formatTimelineMessages, fold only accepted deletion kinds.
    // Core verifies this window's signatures/scope/aux closure; Relay ingest
    // already checks effective authorship/agent ownership (5), or same-channel
    // target and author/admin permission (9005). Client pubkey equality would
    // incorrectly reject legitimate owner and relay-attributed deletions.
    const deleted = new Set(inboxReactionEvents(page.events, conversation.channelId)
      .filter(event => event.kind === KIND_DELETION || event.kind === KIND_NIP29_DELETE_EVENT)
      .flatMap(event => event.tags.filter(tag => tag[0] === "e" && hex.test(tag[1] ?? "")).map(tag => tag[1])));
    const rows = windowRows.filter(row => !deleted.has(row.id));
    const latest = rows.reduce<number | null>((at, row) => Math.max(at ?? row.createdAt, row.createdAt), null);
    lastMessageAt.set(conversation.channelId, latest === null ? null : new Date(latest * 1000).toISOString());
    events.push(...rows.filter(row => !own.has(row.pubkey)).map(row => ({...row, channelType: "dm"})));
  }
  const current = await loadInboxConversations(client, () => !signal.aborted);
  signal.throwIfAborted();
  if (conversations.some(previous => !current.some(item => item.id === previous.id && item.channelId === previous.channelId &&
    item.participantPrincipalIds.length === previous.participantPrincipalIds.length && item.participantPrincipalIds.every(id => previous.participantPrincipalIds.includes(id)))))
    throw new Error("Conversation admission changed during read");
  if ((await client.session({ fresh: true })).tenantPrincipalId !== principal) throw new Error("DM identity changed during read");
  signal.throwIfAborted();
  return {events, lastMessageAt};
}

export function ConversationSidebar(props: ComponentProps<typeof ConversationList>) {
  const client = useBffClient();
  const admitted = props.items.filter(item => item.state === "ACTIVE" && item.participantPrincipalIds.includes(props.currentPrincipalId));
  const activity = useQuery({
    queryKey: ["platform", "conversation-sidebar", props.currentPrincipalId, admitted],
    enabled: !props.loading && !props.error && admitted.length > 0,
    queryFn: ({signal}) => loadConversationSidebarActivity(client, props.currentPrincipalId, admitted, signal),
  });
  return <ConversationList {...props} events={admitted.length > 0 && activity.isSuccess && !activity.isFetching ? activity.data.events : undefined}
    lastMessageAtByChannelId={admitted.length > 0 && activity.isSuccess ? activity.data.lastMessageAt : undefined}
    error={props.error ?? (admitted.length > 0 ? activity.error : null)}
    onReload={() => { props.onReload(); void activity.refetch(); }} />;
}
