// Buzz 779af8886caae1317b4de962082429867ab61503 HomeScreen activity and
// useInboxThreadContext fullChannel. Core supplies admission, Relay the body.
import type { NativeSession } from "@client-kit/platform/react/NativeBootstrap";
import { loadInboxConversations } from "@client-kit/platform/react/new-message";
import { parseChannelWindowResponse } from "@/features/messages/lib/channelWindowResponse";
import { getChannelWindowEvents } from "@/shared/api/channelWindow";
import type { FeedItem, RelayEvent } from "@/shared/api/types";
import { CHANNEL_MESSAGE_EVENT_KINDS, KIND_DELETION, KIND_NIP29_DELETE_EVENT } from "@/shared/constants/kinds";
import { verifyEvent } from "nostr-tools/pure";

export async function loadNativeDmFeed(session: NativeSession, signal: AbortSignal) {
  const principal = (await session.client.session()).tenantPrincipalId;
  signal.throwIfAborted();
  const conversations = await loadInboxConversations(session.client, () => !signal.aborted);
  signal.throwIfAborted();
  const activity: FeedItem[] = [];
  const windows = new Map<string, RelayEvent[]>();
  if (conversations.length === 0) return { activity, windows };
  const own = new Set<string>();
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await session.client.conversationParticipants(cursor);
    signal.throwIfAborted();
    for (const participant of page.items) {
      if (participant.principalId === principal) participant.pubkeys.forEach(key => own.add(key));
    }
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error("Conversation participant cursor did not advance");
    if (cursor) seen.add(cursor);
  } while (cursor);
  if (!own.has(session.devicePubkey)) throw new Error("Native Inbox identity is not admitted");
  const limit = session.facts.relayQueryLimit;
  if (!Number.isSafeInteger(limit) || !limit || limit <= 0) throw new Error("Missing Relay read bound");
  for (const conversation of conversations) {
    signal.throwIfAborted();
    if (!conversation.participantPrincipalIds.includes(principal)) throw new Error("Conversation participant changed");
    const events = await getChannelWindowEvents(conversation.channelId, null, limit, false, {
      relayUrl: session.facts.relayUrl, signerPubkey: session.devicePubkey,
    });
    signal.throwIfAborted();
    if (events.some(event => !verifyEvent(event))) throw new Error("Unverifiable Conversation window");
    const page = parseChannelWindowResponse(events, conversation.channelId, null);
    const deleted = new Set(page.aux.filter(event => event.kind === KIND_DELETION || event.kind === KIND_NIP29_DELETE_EVENT)
      .flatMap(event => event.tags.filter(tag => tag[0] === "e").map(tag => tag[1])));
    for (const {event} of page.rows) {
      if (!verifyEvent(event) || event.tags.filter(tag => tag[0] === "h").length !== 1 ||
        !event.tags.some(tag => tag[0] === "h" && tag[1] === conversation.channelId)) throw new Error("Unverifiable Conversation event");
      if (own.has(event.pubkey) || deleted.has(event.id) || !(CHANNEL_MESSAGE_EVENT_KINDS as readonly number[]).includes(event.kind)) continue;
      activity.push({ ...event, createdAt: event.created_at, channelId: conversation.channelId,
        channelName: "", channelType: "dm", category: "activity" });
    }
    windows.set(conversation.channelId, events);
  }
  const current = await loadInboxConversations(session.client, () => !signal.aborted);
  signal.throwIfAborted();
  if (conversations.some(previous => !current.some(item => item.id === previous.id && item.channelId === previous.channelId &&
    item.participantPrincipalIds.length === previous.participantPrincipalIds.length &&
    item.participantPrincipalIds.every(id => previous.participantPrincipalIds.includes(id))))) throw new Error("Conversation admission changed during read");
  const currentSession = await session.client.session();
  signal.throwIfAborted();
  if (currentSession.tenantPrincipalId !== principal) throw new Error("Inbox identity changed during read");
  return {activity, windows};
}
