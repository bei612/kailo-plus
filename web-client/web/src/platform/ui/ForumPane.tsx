// The original Buzz Forum presentation is shared with Desktop. This host only
// supplies the existing BFF transport, verified Relay-event projection and composer.
import { WebMessageType, WorkspaceMembershipState, type WebMessageCursor } from "@client-kit/contracts";
import { ForumView, useForumLabels, type ForumMessage } from "@client-kit/platform/react/forum/ForumView";
import { DeleteActionMenu } from "@client-kit/platform/react/forum/DeleteActionMenu";
import { parseChannelWindowResponse } from "@client-kit/platform/react/forum/channelWindowResponse";
import { UserAvatar, MessageAuthorText } from "@client-kit/platform/react/messages";
import { TransportError } from "@client-kit/platform/transport";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { MessageContent, type MessageMention } from "@/features/chat/ui/MessageContent";
import { MemberHover, MemberProfilePanel } from "@client-kit/platform/react/members";
import { UserProfilePopoverSurface } from "@client-kit/platform/react/pulse";
import { bff, deleteMessage, openStream, publishMessage, type BuzzEvent } from "@/platform/bff-client";
import { Composer } from "./ChannelPane";
import { relativeTime } from "@/shared/lib/relative-time";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { t } from "@/shared/i18n";
import type { ParsedMessageLink } from "@client-kit/platform/react/composer/features/messages/lib/messageLink";
import { MessageAuthorIdentity, MessageAuthorProfile, type MessageAuthor } from "./MessageAuthorProfile";

function eventsFrom(value: unknown): BuzzEvent[] {
  if (!Array.isArray(value)) throw new Error("Invalid forum event response.");
  for (const event of value) {
    if (!event || typeof event !== "object" || typeof event.id !== "string" || typeof event.pubkey !== "string" ||
      !Number.isSafeInteger(event.created_at) || !Number.isSafeInteger(event.kind) || typeof event.content !== "string" ||
      !Array.isArray(event.tags) || !event.tags.every((tag: unknown) => Array.isArray(tag) && tag.every((part: unknown) => typeof part === "string")))
      throw new Error("Invalid forum event response.");
  }
  return value;
}
const project = (event: BuzzEvent): ForumMessage => ({ eventId: event.id, pubkey: event.pubkey,
  content: event.content, createdAt: event.created_at, tags: event.tags });

export function ForumPane({ workspaceId, channelId, archived, metadataPending = false, myPrincipalId, onOpenMessageLink, target, restoreDraftKey, autoSendDraftKey, onStartDm }: {
  workspaceId: string; channelId: string; archived: boolean; myPrincipalId: string;
  metadataPending?: boolean;
  onOpenMessageLink?: (link: ParsedMessageLink) => void;
  target?: ParsedMessageLink;
  restoreDraftKey?: string;
  autoSendDraftKey?: string;
  onStartDm?: (pubkey: string) => void;
}) {
  const labels = useForumLabels();
  const queryClient = useQueryClient();
  const key = React.useMemo(() => ["platform", "forum", myPrincipalId, workspaceId, channelId] as const, [myPrincipalId, workspaceId, channelId]);
  const [selectedPostId, setSelectedPostId] = React.useState<string | null>(() => {
    const prefix = `forum:${workspaceId}:`;
    const parent = restoreDraftKey?.startsWith(prefix) ? restoreDraftKey.slice(prefix.length) : undefined;
    return parent && /^[0-9a-f]{64}$/.test(parent) ? parent : null;
  });
  const [targetEventId, setTargetEventId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (target?.channelId === channelId) {
      setSelectedPostId(target.threadRootId ?? target.messageId);
      setTargetEventId(target.messageId);
    }
  }, [target, channelId]);
  const [denied, setDenied] = React.useState<string | null>(null);
  const [interrupted, setInterrupted] = React.useState(false);
  const [profileTarget, setProfileTarget] = React.useState<MessageAuthor | null>(null);
  const [memberTarget, setMemberTarget] = React.useState<{workspaceId:string; principalId:string; pubkey:string} | null>(null);
  React.useEffect(() => { setProfileTarget(null); setMemberTarget(null); }, [workspaceId, channelId, myPrincipalId]);
  const mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  React.useEffect(() => {
    if (archived) return;
    return openStream(workspaceId, (frame) => {
    if (frame.type === "live") setInterrupted(false);
    if (frame.type === "closed" || frame.type === "interrupted") { setInterrupted(true); setProfileTarget(null); setMemberTarget(null); }
    if (frame.type === "event" || frame.type === "snapshot" || frame.type === "live") void queryClient.invalidateQueries({ queryKey: key });
    if (frame.type === "closed") void queryClient.invalidateQueries({ queryKey: ["platform", "channel-descriptor", myPrincipalId, workspaceId] });
    if (frame.type === "closed" && ["session-revoked", "scope-revoked", "identity-revoked"].includes(frame.reason)) {
      setDenied(frame.reason); queryClient.removeQueries({ queryKey: key });
    }
    });
  }, [workspaceId, queryClient, key, archived, myPrincipalId]);
  const members = useQuery({ queryKey: ["platform", "members", workspaceId], queryFn: () => bff.members(workspaceId), enabled: !denied });
  const ownProfile = useQuery({ queryKey: ["platform", "edit-author", myPrincipalId], queryFn: () => bff.profile(), enabled: !denied });
  const isMember = !members.isError && (members.data ?? []).some((member) => member.principalId === myPrincipalId && member.state === WorkspaceMembershipState.Active);
  const posts = useInfiniteQuery({ queryKey: [...key, "posts"], initialPageParam: null as WebMessageCursor | null, enabled: !denied,
    queryFn: async ({ pageParam }) => {
      const page = await bff.workspaceMessages(workspaceId, { messageType: WebMessageType.ForumPost,
        ...(pageParam ? { before: pageParam.createdAt, beforeId: pageParam.eventId } : {}) });
      return parseChannelWindowResponse(eventsFrom(page.events), channelId, pageParam, true);
    }, getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const thread = useInfiniteQuery({ queryKey: [...key, "thread", selectedPostId], initialPageParam: null as WebMessageCursor | null,
    enabled: !denied && selectedPostId !== null,
    queryFn: async ({ pageParam }) => {
      const page = await bff.workspaceMessages(workspaceId, { messageType: WebMessageType.ForumComment, parentEventId: selectedPostId!,
        ...(pageParam ? { before: pageParam.createdAt, beforeId: pageParam.eventId } : {}) });
      return { events: eventsFrom(page.events), nextCursor: page.nextCursor };
    }, getNextPageParam: (page) => page.nextCursor,
  });
  const all = [...(posts.data?.pages.flatMap((page) => [...page.rows.map((row) => row.event), ...page.aux]) ?? []),
    ...(thread.data?.pages.flatMap((page) => page.events) ?? [])];
  const deleted = new Set(all.filter((event) => event.kind === 5 || event.kind === 9005)
    .flatMap((event) => event.tags.filter((tag) => tag[0] === "e").map((tag) => tag[1])));
  const inChannel = [...new Map(all.filter((event) => !deleted.has(event.id) && event.tags.some((tag) => tag[0] === "h" && tag[1] === channelId)).map((event) => [event.id, event])).values()];
  const summaries = new Map(posts.data?.pages.flatMap((page) => page.rows.map((row) => [row.event.id, row.thread] as const)));
  const root = inChannel.find((event) => event.id === selectedPostId && event.kind === 45001);
  const replyIds = new Set(thread.data?.pages.flatMap((page) => page.events.map((event) => event.id)));
  const replies = inChannel.filter((event) => replyIds.has(event.id) && (event.kind === 45003 || event.kind === 9))
    .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id)).map(project);
  const authors = new Map((members.data ?? []).flatMap((member) => member.pubkeys.map((pubkey) => [pubkey, member] as const)));
  const selectedQuery = selectedPostId ? thread : posts;
  const error = denied || members.error || selectedQuery.error ? t("buzz.forumUnavailable")
    : selectedPostId && thread.isSuccess && !root ? t("buzz.forumRootUnavailable") : null;
  const authorTarget = !error && !interrupted && profileTarget?.principalId === myPrincipalId && profileTarget.workspaceId === workspaceId
    ? profileTarget : null;
  const mentions: MessageMention[] = (members.data ?? []).flatMap(member => member.pubkeys.map(pubkey => {
    const target = {workspaceId, principalId:member.principalId, pubkey};
    const renderProfile: MessageMention["renderProfile"] = !error && !interrupted && members.isSuccess && member.state === WorkspaceMembershipState.Active
      ? children => <UserProfilePopoverSurface pubkey={pubkey} triggerElement="span" triggerClassName="inline"
          onOpenProfile={() => { setProfileTarget(null); setMemberTarget(target); }}
          renderBody={props => <MemberHover {...props} target={target}/>}>{children}</UserProfilePopoverSurface>
      : undefined;
    return {pubkey, name:member.displayName, isAgent:false, renderProfile};
  }));
  const activeMemberTarget = !error && !interrupted && memberTarget?.workspaceId === workspaceId &&
    members.isSuccess && authors.get(memberTarget.pubkey)?.principalId === memberTarget.principalId &&
    authors.get(memberTarget.pubkey)?.state === WorkspaceMembershipState.Active ? memberTarget : null;
  return <div className="relative flex h-full min-h-0 min-w-0 overflow-hidden"><div className="min-h-0 min-w-0 flex-1"><ForumView channelId={channelId} isMember={isMember} archived={archived} selectedPostId={selectedPostId}
    initialComposerOpen={restoreDraftKey === `forum:${workspaceId}:post`}
    targetEventId={targetEventId} onTargetReached={() => setTargetEventId(null)}
    onSelectPost={(id) => { setProfileTarget(null); setMemberTarget(null); setSelectedPostId(id); }} posts={inChannel.filter((event) => event.kind === 45001).map((event) => ({ ...project(event), threadSummary: summaries.get(event.id) }))}
    post={root ? project(root) : undefined} replies={replies} loading={selectedQuery.isPending} error={error ? String(error) : null}
    hasMore={selectedQuery.hasNextPage} loadingMore={selectedQuery.isFetchingNextPage} onMore={() => { void selectedQuery.fetchNextPage(); }}
    onRetry={() => { void queryClient.invalidateQueries({ queryKey: key }); void members.refetch(); }} labels={labels} formatTime={relativeTime}
    renderDelete={(message, reply) => !error && !interrupted && !metadataPending && isMember && !archived
      && ownProfile.isSuccess && !ownProfile.isError && message.pubkey === ownProfile.data.pubkey
      ? <DeleteActionMenu key={message.eventId} reply={reply} onConfirm={async () => {
        const original = inChannel.find((event) => event.id === message.eventId);
        if (!original) throw new Error("Deletion target unavailable");
        const receipt = await deleteMessage(workspaceId, message.eventId,
          original.kind === 45001 ? WebMessageType.ForumPost : original.kind === 45003 ? WebMessageType.ForumComment : WebMessageType.Stream);
        if (!receipt?.eventId || !receipt.operationId) throw new TransportError("Deletion has no confirmed receipt");
        if (mounted.current && selectedPostId === message.eventId) setSelectedPostId(null);
        void queryClient.invalidateQueries({ queryKey: key });
      }} /> : null}
    renderAuthor={(message, large) => { const name = authors.get(message.pubkey)?.displayName ?? truncatePubkey(message.pubkey);
      const identity = <div className="flex items-center gap-2"><UserAvatar avatarUrl={null} displayName={name} size={large ? "md" : "sm"} /><MessageAuthorText>{name}</MessageAuthorText></div>;
      const target = {principalId:myPrincipalId,workspaceId,eventId:message.eventId,pubkey:message.pubkey};
      return !error && !interrupted ? <MessageAuthorIdentity target={target} onOpen={() => { setMemberTarget(null); setProfileTarget(target); }}>{identity}</MessageAuthorIdentity> : identity; }}
    renderContent={(message, preview) => <MessageContent workspaceId={workspaceId} content={preview && message.content.length > 200 ? `${message.content.slice(0, 200)}...` : message.content}
      mediaTags={message.tags} mentions={preview ? mentions.map(({renderProfile: _profile, ...mention}) => mention) : mentions} onOpenMessageLink={onOpenMessageLink} />}
    renderComposer={(parentId, close) => <Composer key={parentId ?? "post"} workspaceId={workspaceId} surface="forum" disabled={!isMember || archived || metadataPending || Boolean(error)}
      draftIdentity={myPrincipalId} draftKey={`forum:${workspaceId}:${parentId ?? "post"}`} autoSendDraftKey={autoSendDraftKey} placeholder={parentId ? labels.replyPlaceholder : labels.postPlaceholder} onCancel={parentId ? undefined : close}
      onOpenMessageLink={onOpenMessageLink} onPublish={async (content, attachments, idempotencyKey, installationIds) => {
        const receipt = await publishMessage(workspaceId, content, attachments, idempotencyKey, installationIds,
          { messageType: parentId ? WebMessageType.ForumComment : WebMessageType.ForumPost, ...(parentId ? { parentEventId: parentId } : {}) });
        if (!receipt?.eventId || !receipt.operationId) throw new TransportError("Forum publication has no confirmed receipt.");
        void queryClient.invalidateQueries({ queryKey: key });
        if (mounted.current && !parentId) close();
        return receipt;
      }} />}
  /></div>{authorTarget ? <MessageAuthorProfile key={`${myPrincipalId}:${workspaceId}:${authorTarget.eventId}`}
    target={authorTarget} onClose={() => setProfileTarget(null)}
    onStartDm={authors.get(authorTarget.pubkey)?.principalId === myPrincipalId ? undefined : onStartDm} /> : null}
    {activeMemberTarget ? <MemberProfilePanel key={`${myPrincipalId}:${activeMemberTarget.workspaceId}:${activeMemberTarget.pubkey}`}
      target={activeMemberTarget} onClose={() => setMemberTarget(null)}
      onStartDm={activeMemberTarget.principalId === myPrincipalId ? undefined : onStartDm}/> : null}</div>;
}
