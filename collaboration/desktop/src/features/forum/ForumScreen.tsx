// Buzz 779af8886caae1317b4de962082429867ab61503 ForumView host integration.
// Shared presentation consumes the original Relay window/thread read models.
import * as React from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ForumAuthorButton, ForumView, useForumLabels, type ForumMessage } from "@client-kit/platform/react/forum/ForumView";
import { DeleteActionMenu } from "@client-kit/platform/react/forum/DeleteActionMenu";
import { TransportError } from "@client-kit/platform/transport";
import { deleteMessage } from "@/shared/api/tauriMessages";
import { relativeTime } from "@client-kit/platform/format";
import { useLocale } from "@client-kit/platform/react/context";
import { useActiveCommunity } from "@/features/platform/activeCommunity";
import { useProfileQuery, useUsersBatchQuery } from "@/features/profile/hooks";
import { mergeCurrentProfileIntoLookup, resolveUserLabel } from "@/features/profile/lib/identity";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { Markdown } from "@/shared/ui/markdown";
import { parseImetaTags } from "@/shared/ui/markdown/parseImeta";
import { resolveMentionProps, getMentionTagPubkey } from "@/shared/lib/resolveMentionNames";
import { resolveEventAuthorPubkey } from "@/shared/lib/authors";
import { useRelaySelfQuery } from "@/shared/api/relaySelf";
import { getChannelWindowEvents } from "@/shared/api/channelWindow";
import { getEventById, getThreadReplies, sendChannelMessage } from "@/shared/api/tauri";
import type { Channel, RelayEvent, ChannelPageCursor, ThreadCursor } from "@/shared/api/types";
import { parseChannelWindowResponse } from "@/features/messages/lib/channelWindowResponse";
import { getThreadReference } from "@/features/messages/lib/threading";
import { hasLinkPreviewSuppression } from "@/features/messages/lib/formatTimelineMessages";
import { handleTimelineMentionCopy } from "@/features/messages/lib/timelineMentionCopy";
import { useFocusedRefetchInterval } from "@/shared/lib/useDocumentVisible";
import { MessageComposer } from "@/features/messages/ui/MessageComposer";
import { Button } from "@/shared/ui/button";
import { ChannelScreenHeader } from "@/features/channels/ui/ChannelScreenHeader";

function project(event: RelayEvent, relaySelfPubkey: string | null | undefined): ForumMessage {
  return { eventId: event.id, pubkey: resolveEventAuthorPubkey({ event, relaySelfPubkey }),
    content: event.content, createdAt: event.created_at, tags: event.tags };
}
function visible(events: RelayEvent[], channelId: string, kind: number) {
  const deleted = new Set(events.filter((event) => event.kind === 5 || event.kind === 9005)
    .flatMap((event) => event.tags.filter((tag) => tag[0] === "e").map((tag) => tag[1])));
  return events.filter((event) => event.kind === kind && !deleted.has(event.id) &&
    event.tags.some((tag) => tag[0] === "h" && tag[1] === channelId));
}

export function ForumScreen({ channel, currentPubkey, targetMessageId, targetThreadRootId }: {
  channel: Channel; currentPubkey?: string; targetMessageId: string | null; targetThreadRootId: string | null;
}) {
  const community = useActiveCommunity();
  return <ForumVisit key={`${community.relayUrl}:${currentPubkey}:${channel.id}`} channel={channel}
    currentPubkey={currentPubkey} targetMessageId={targetMessageId} targetThreadRootId={targetThreadRootId} />;
}

function ForumVisit({ channel, currentPubkey, targetMessageId, targetThreadRootId }: React.ComponentProps<typeof ForumScreen>) {
  const { relayUrl } = useActiveCommunity();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const key = ["forum", relayUrl, currentPubkey, channel.id] as const;
  const [selectedPostId, setSelectedPostId] = React.useState<string | null>(targetThreadRootId);
  const [targetEventId, setTargetEventId] = React.useState<string | null>(targetMessageId);
  const mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const relaySelf = useRelaySelfQuery(true).data;
  const postInterval = useFocusedRefetchInterval(15_000);
  const replyInterval = useFocusedRefetchInterval(10_000);
  const posts = useInfiniteQuery({ queryKey: [...key, "posts"], initialPageParam: null as ChannelPageCursor | null,
    enabled: Boolean(currentPubkey),
    queryFn: async ({ pageParam }) => parseChannelWindowResponse(
      await getChannelWindowEvents(channel.id, pageParam, undefined, true, { relayUrl, signerPubkey: currentPubkey! }), channel.id, pageParam, true),
    getNextPageParam: (page) => page.nextCursor ?? undefined, refetchInterval: postInterval,
    staleTime: 5 * 60_000, refetchOnWindowFocus: false,
  });
  const root = useQuery({ queryKey: [...key, "post", selectedPostId], enabled: selectedPostId !== null,
    queryFn: async () => {
      const event = await getEventById(selectedPostId!);
      if (event.kind !== 45001 || !event.tags.some((tag) => tag[0] === "h" && tag[1] === channel.id))
        throw new Error("Forum post does not belong to the selected channel.");
      return event;
    }, refetchInterval: replyInterval,
  });
  const replies = useInfiniteQuery({ queryKey: [...key, "replies", selectedPostId], enabled: selectedPostId !== null,
    initialPageParam: null as ThreadCursor | null,
    queryFn: ({ pageParam }) => getThreadReplies(selectedPostId!, channel.id, { cursor: pageParam, forumThread: true, relayUrl, signerPubkey: currentPubkey }),
    getNextPageParam: (page) => page.nextCursor ?? undefined, refetchInterval: replyInterval,
  });
  const target = useQuery({ queryKey: [...key, "target", targetMessageId], enabled: targetMessageId !== null,
    queryFn: () => getEventById(targetMessageId!),
  });
  React.useEffect(() => {
    const event = target.data;
    if (!event || !event.tags.some((tag) => tag[0] === "h" && tag[1] === channel.id)) return;
    setSelectedPostId(event.kind === 45001 ? event.id : getThreadReference(event.tags).rootId);
    setTargetEventId(event.id);
  }, [target.data, channel.id]);

  const allEvents = [...(posts.data?.pages.flatMap((page) => [...page.rows.map((row) => row.event), ...page.aux]) ?? []),
    ...(root.data ? [root.data] : []), ...(replies.data?.pages.flatMap((page) => page.events) ?? [])];
  const pubkeys = [...new Set(allEvents.flatMap((event) => [event.pubkey,
    ...event.tags.map(getMentionTagPubkey).filter((value): value is string => Boolean(value))]))];
  const profile = useProfileQuery();
  const profilesQuery = useUsersBatchQuery(pubkeys, { enabled: pubkeys.length > 0 });
  const profiles = mergeCurrentProfileIntoLookup(profilesQuery.data?.profiles, profile.data);
  const posted = useMutation({ mutationFn: async ({ content, mentions, mediaTags, parentId }: {
    content: string; mentions: string[]; mediaTags?: string[][]; parentId: string | null;
  }) => {
    if (!currentPubkey || !channel.isMember || channel.archivedAt !== null) throw new Error("Forum publication is not admitted.");
    await sendChannelMessage(channel.id, content, parentId, mediaTags, mentions,
      undefined, undefined, undefined, undefined, relayUrl, currentPubkey, parentId, parentId ? "reply" : "post");
  }, onSuccess: () => { void queryClient.invalidateQueries({ queryKey: key }); } });
  const summaries = new Map(posts.data?.pages.flatMap((page) => page.rows.map((row) => [row.event.id, row.thread] as const)));
  const unique = (events: RelayEvent[]) => [...new Map(events.map((event) => [event.id, event])).values()];
  const postMessages = unique(visible(allEvents, channel.id, 45001)).map((event) => ({ ...project(event, relaySelf), threadSummary: summaries.get(event.id) }));
  const replyEvents = replies.data?.pages.flatMap((page) => page.events) ?? [];
  const replyMessages = unique([...visible(replyEvents, channel.id, 45003), ...visible(replyEvents, channel.id, 9)])
    .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id)).map((event) => project(event, relaySelf));
  const labels = useForumLabels();
  const selectedQuery = selectedPostId ? replies : posts;
  const error = selectedPostId ? (root.error ?? replies.error) : posts.error;
  return <div className="relative flex h-full min-h-0 flex-col">
    <ChannelScreenHeader activeChannel={channel} activeChannelEphemeralDisplay={null} />
    <ForumView channelId={channel.id} isMember={channel.isMember} archived={channel.archivedAt !== null}
      posts={postMessages} post={root.data ? project(root.data, relaySelf) : undefined} replies={replyMessages}
      selectedPostId={selectedPostId} onSelectPost={setSelectedPostId} targetEventId={targetEventId}
      onTargetReached={() => setTargetEventId(null)} loading={selectedPostId ? root.isPending || replies.isPending : posts.isPending}
      error={error instanceof Error ? error.message : error ? String(error) : null}
      hasMore={selectedQuery.hasNextPage} loadingMore={selectedQuery.isFetchingNextPage}
      onMore={() => { void selectedQuery.fetchNextPage(); }} onRetry={() => { void queryClient.invalidateQueries({ queryKey: key }); }}
      labels={labels} formatTime={(time) => relativeTime(locale, new Date(time * 1000).toISOString())} onCopy={handleTimelineMentionCopy}
      renderDelete={(message, reply) => currentPubkey && allEvents.some((event) => event.id === message.eventId && event.pubkey === currentPubkey) && channel.isMember && channel.archivedAt === null
        ? <DeleteActionMenu key={message.eventId} reply={reply} onConfirm={async () => {
          let receipt: RelayEvent;
          try { receipt = await deleteMessage(channel.id, message.eventId, relayUrl, currentPubkey); }
          catch (error) {
            if (String(error).includes("relay publish outcome unknown")) throw new TransportError("Deletion outcome unknown");
            throw error;
          }
          if (receipt.kind !== 5 || !receipt.tags.some((tag) => tag[0] === "e" && tag[1] === message.eventId))
            throw new TransportError("Deletion receipt mismatch");
          if (mounted.current && selectedPostId === message.eventId) setSelectedPostId(null);
          void queryClient.invalidateQueries({ queryKey: key });
        }} /> : null}
      renderAuthor={(message, large, preview) => {
        const label = resolveUserLabel({ pubkey: message.pubkey, currentPubkey, profiles, preferResolvedSelfLabel: true });
        const author = profiles?.[message.pubkey.toLowerCase()];
        return <UserProfilePopover pubkey={message.pubkey}>
          <ForumAuthorButton displayName={label} large={large} preview={preview}
            avatar={<UserAvatar accent={author?.isAgent} avatarUrl={author?.avatarUrl ?? null} displayName={label}
              shape={author?.isAgent ? "squircle" : "circle"} size={large ? undefined : "sm"} />} />
        </UserProfilePopover>;
      }} renderContent={(message, preview) => <Markdown className="text-sm" messageId={message.eventId}
        content={preview && message.content.length > 200 ? `${message.content.slice(0, 200)}...` : message.content}
        imetaByUrl={parseImetaTags(message.tags)} linkPreviewTags={message.tags}
        linkPreviewsSuppressed={hasLinkPreviewSuppression(message.tags)} {...resolveMentionProps(message.tags, profiles, message.content)} />}
      renderComposer={(parentId, close) => <MessageComposer key={parentId ?? channel.id} surface="forum"
        channelId={channel.id} channelName={channel.name} draftKey={`forum:${relayUrl}:${currentPubkey}:${channel.id}:${parentId ?? "post"}`}
        profiles={profiles} isSending={posted.isPending} placeholder={parentId ? labels.replyPlaceholder : labels.postPlaceholder}
        toolbarExtraActions={!parentId ? <Button type="button" variant="ghost" onClick={close} disabled={posted.isPending}>{labels.cancel}</Button> : undefined}
        onSend={async (content, mentions, mediaTags) => {
          await posted.mutateAsync({ content, mentions, mediaTags, parentId });
          if (mounted.current && !parentId) close();
        }} />}
    />
  </div>;
}
