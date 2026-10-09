// Original Buzz message-link UI; only admitted directory/Relay reads and
// clipboard/navigation differ from the Desktop host (DD-39, SS-WEB-RELAY).
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { WebMessageType, type WebMessageCursor, type ConversationView } from "@client-kit/contracts";
import type { BffClient } from "@client-kit/platform/client";
import { useBffClient, useDeviceLocale } from "@client-kit/platform/react/context";
import { getLocale, translateCurrent as t, type PlatformLocale } from "@client-kit/platform/i18n";
import { MessageLinkPillPresentation, summarizeMessageLinkContent, type MessageLinkMetadataState } from "@client-kit/platform/react/messages/message-link";
import { applyMessageEdits } from "@client-kit/platform/react/messages";
import { truncateNpub } from "@client-kit/platform/react/conversations/pubkey";
import type { ParsedMessageLink } from "@client-kit/platform/react/composer/features/messages/lib/messageLink";
import type { RelayEvent } from "@client-kit/platform/react/forum/channelWindowResponse";
import type { loadWebSearchDirectory } from "@/platform/ui/search";

type Directory = Awaited<ReturnType<typeof loadWebSearchDirectory>>;
type Host = {
  scopeKey: string;
  principalId: string;
  directory?: Directory;
  conversations: readonly ConversationView[];
  onOpenChannel: (channelId: string) => void;
  onOpenMessageLink: (link: ParsedMessageLink) => void;
};
const MessageLinkHost = createContext<Host | null>(null);
export function BffMessageLinkHost({children, ...host}: Host & {children: ReactNode}) {
  return <MessageLinkHost.Provider value={host}>{children}</MessageLinkHost.Provider>;
}

export function resolveMessageLinkTarget(host: Pick<Host, "directory" | "conversations" | "principalId">, channelId: string) {
  const channel = host.directory?.channels.find(row => row.id === channelId && row.isMember);
  if (!channel) return null;
  const workspaces = host.directory!.workspaces.filter(row => row.channel.channelId === channelId && row.isMember);
  const conversations = host.conversations.filter(row => row.channelId === channelId && row.state === "ACTIVE" && row.participantPrincipalIds.includes(host.principalId));
  if (workspaces.length + conversations.length !== 1) return null;
  return {channel, ...(workspaces.length ? {workspaceId: workspaces[0]!.id} : {}), ...(conversations.length ? {conversationId: conversations[0]!.id} : {}),
    label: host.directory!.labels[channelId] ?? channel.name};
}
type Target = NonNullable<ReturnType<typeof resolveMessageLinkTarget>>;

/** Exact root and its replies use the existing Core thread route. Arbitrary
 * filters, unscoped event lookup and browser Relay credentials are not exposed.
 * A malformed/missing reply root or HTTP denial is unavailable, never "deleted".
 */
export async function readMessageLinkMetadata(client: BffClient, target: Target, link: ParsedMessageLink, check: () => void, locale: PlatformLocale = getLocale()): Promise<MessageLinkMetadataState> {
  let cursor: WebMessageCursor | undefined;
  do {
    check();
    const query = {messageType: target.channel.channelType === "forum" ? WebMessageType.ForumComment : WebMessageType.Stream,
      parentEventId: link.threadRootId ?? link.messageId,
      ...(cursor ? {before: cursor.createdAt, beforeId: cursor.eventId} : {})};
    const page = await (target.conversationId ? client.conversationMessages(target.conversationId, query) : client.workspaceMessages(target.workspaceId!, query));
    check();
    if (!Array.isArray(page.events)) throw new Error("Invalid message-link page");
    const events = page.events as RelayEvent[];
    for (const event of events) {
      if (!event || !/^[0-9a-f]{64}$/.test(event.id) || !/^[0-9a-f]{64}$/.test(event.pubkey)
        || !Number.isSafeInteger(event.created_at) || event.created_at < 0 || !Number.isFinite(new Date(event.created_at * 1000).getTime())
        || typeof event.content !== "string" || !Array.isArray(event.tags)
        || event.tags.some(tag => !Array.isArray(tag) || tag.some(part => typeof part !== "string"))) throw new Error("Invalid message-link event");
      const scopes = event.tags.filter(tag => tag[0] === "h");
      const targetScopedAux = [5,7].includes(event.kind) && scopes.length === 0;
      if (!targetScopedAux && (scopes.length !== 1 || scopes[0]?.[1] !== link.channelId)) throw new Error("Invalid message-link scope");
    }
    // Core has verified signature and target closure; do not infer deletion from
    // empty results, interrupted queries or a revoked binding.
    if (events.some(event => [5,9005].includes(event.kind) && event.tags.some(tag => tag[0] === "e" && tag[1] === link.messageId))) return {kind:"deleted"};
    const event = events.find(row => row.id === link.messageId && [9,40002,45001,45003].includes(row.kind));
    if (event) {
      const profile = await (target.conversationId ? client.conversationMessageAuthorProfile(target.conversationId, event.id) : client.messageAuthorProfile(target.workspaceId!, event.id));
      check();
      const edited = applyMessageEdits([event], events)[0]!;
      return {kind:"ready", author:profile.displayName?.trim() || profile.nip05Handle?.trim() || truncateNpub(profile.pubkey),
        createdAt:event.created_at, snippet:summarizeMessageLinkContent(edited.content, locale)};
    }
    const next = page.nextCursor;
    if (next && (!Number.isSafeInteger(next.createdAt) || next.createdAt < 0 || !/^[0-9a-f]{64}$/.test(next.eventId))) throw new Error("Invalid message-link cursor");
    if (next && cursor && (next.createdAt < cursor.createdAt || (next.createdAt === cursor.createdAt && next.eventId <= cursor.eventId))) throw new Error("Message-link cursor did not advance");
    cursor = next;
  } while (cursor);
  return {kind:"unavailable"};
}

export function BffMessageLinkPill({href, link}: {href?: string; link: ParsedMessageLink}) {
  const host = useContext(MessageLinkHost);
  if (!host) return <MessageLinkPillPresentation href={href} link={link} interactive={false} openable={false}
    metadata={{state:{kind:"idle"}}} onOpenChannel={() => {}} onOpenMessageLink={() => {}} copyLink={() => {}} />;
  return <ResolvedBffMessageLinkPill href={href} link={link} host={host} />;
}

function ResolvedBffMessageLinkPill({href, link, host}: {href?: string; link:ParsedMessageLink; host:Host}) {
  const client = useBffClient();
  const locale = useDeviceLocale();
  const target = resolveMessageLinkTarget(host, link.channelId);
  const owner = useMemo(() => ({active:true}), [host?.scopeKey, client]);
  useEffect(() => {owner.active = true; return () => {owner.active = false;};}, [owner]);
  const query = useQuery({
    queryKey:["platform",host?.scopeKey,"message-link",locale,link.channelId,link.messageId,link.threadRootId ?? null,target?.workspaceId,target?.conversationId],
    enabled: !!target && !!host, retry:false,
    queryFn:({signal}) => readMessageLinkMetadata(client,target!,link,() => {
      signal.throwIfAborted();
      if (!owner.active) throw new Error("Message-link scope changed");
    }, locale),
  });
  const state: MessageLinkMetadataState = !target ? {kind:"idle"} : query.isFetching ? {kind:"loading"} : query.isError ? {kind:"unavailable"} : query.data ?? {kind:"loading"};
  return <MessageLinkPillPresentation href={href} link={link} channel={target?.channel} channelLabel={target?.label}
    interactive={!!host && !!target} openable={!!target} metadata={{state}}
    onOpenChannel={id => host?.onOpenChannel(id)} onOpenMessageLink={value => host?.onOpenMessageLink(value)}
    copyLink={url => {void navigator.clipboard.writeText(url).then(() => toast.success(t("video.linkCopied")),() => toast.error(t("platform.profile.copyFailed")));}} />;
}
