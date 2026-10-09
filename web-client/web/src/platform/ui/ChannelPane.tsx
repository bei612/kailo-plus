import { PeopleMentionAutocomplete, detectPrefixQuery, selectedMentionLabel, extractMentionPubkeys, mentionMatchCandidates, mentionOccurrences, AmbiguousMentionError, type MentionSuggestion } from "@client-kit/platform/react/pulse";
// 频道（SS-WEB-RELAY、SS-WEB-01）：消息、附件、已读位置。
//
// 全部经 BFF：流、发布、媒体上传与读取、已读写入。这里没有 Relay 地址，也没有
// signer——签名由 BFF 以本人身份代做。

import { AgentTrigger, ReasonCode, WebMessageType, type AgentInstallationView, type ReadMarkRequest, type ConversationView, type ConversationParticipant, type WorkspaceMemberView } from "@client-kit/contracts";
import { MentionAutocomplete } from "@client-kit/platform/react/mention-autocomplete";
import { useBffCustomEmojiPalette } from "@client-kit/platform/react/custom-emoji";
import { ConversationPreparationPending, useConversationInvalidation } from "@client-kit/platform/react/new-message";
import { useMentionSelection } from "@client-kit/platform/react/use-mention-selection";
import { isOutcomeUnknown, TransportError } from "@client-kit/platform/transport";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";
import { useBrowserNotifications } from "./BrowserNotifications";
import { formatMessageNotification } from "@client-kit/platform/react/notifications";
import { MessageContent, type MessageMention } from "@/features/chat/ui/MessageContent";
import {
  BffError,
  bff,
  type BuzzEvent,
  type MediaDescriptor,
  markRead,
  publishMessage,
  publishConversationMessage,
  uploadConversationMedia,
  uploadMedia,
  mediaUrl,
  deleteMessage,
} from "@/platform/bff-client";
import { platformQueries } from "@/platform/ui/queries";
import { t } from "@/shared/i18n";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { toast } from "sonner";
import { MessageRowSurface, MessageActionBarSurface, getThreadReference, useMessageDeleteDialog, reactionThreadInteractionRoots, type TimelineMessage } from "@client-kit/platform/react/messages";
import { buildMessageLink } from "@client-kit/platform/react/composer/features/messages/lib/messageLink";
import { buildMentionClipboardHtml } from "@client-kit/platform/react/composer/features/messages/lib/mentionClipboard";
import { resolveMessageMentionClipboard } from "@client-kit/platform/react/messages/resolveMentionNames";
import { Button } from "@/shared/ui/button";
import { MessageComposerSurface } from "@client-kit/platform/react/composer/MessageComposerSurface";
import { ChannelThreadPane } from "./ChannelThreadPane";
import { useWorkspaceThread } from "./useWorkspaceThread";
import { ChannelTimelineRows } from "./ChannelTimelineRows";
import { useChannelWindow } from "./useChannelWindow";
import { useMessageReactions } from "./useMessageReactions";
import { CHANNEL_TIMELINE_CONTENT_KINDS, isConversationalUnreadKind } from "@client-kit/platform/react/thread/kinds";
import { MessageThreadSummaryRow, ThreadRepliesErrorCard, getThreadRouteTarget, getRouteMainTimelineTargetId, useChannelMessageEdit } from "@client-kit/platform/react/thread";
import { isBroadcastReply, isThreadReply } from "@client-kit/platform/react/messages/threading";
import { SystemMessageRowSurface } from "@client-kit/platform/react/messages/system";
import { MemberHover, MemberProfilePanel } from "@client-kit/platform/react/members";
import { UserProfilePopoverSurface } from "@client-kit/platform/react/pulse";
import { MessageTimelineSurface, type MessageTimelineHandle } from "@client-kit/platform/react/messages/timeline/MessageTimelineSurface";
import { FocusThreadDrawer } from "@client-kit/platform/react/thread/FocusThreadDrawer";
import { useThreadViewMode } from "@client-kit/platform/react/thread/threadViewModePreference";
import { useFocusDrawerPresence, useRoutedMessageEdit } from "@client-kit/platform/react/thread";
import { AnimatePresence } from "motion/react";
import { useIsThreadPanelOverlay } from "@client-kit/platform/react/thread";
import { MessageAuthorAvatar, MessageAuthorIdentity, MessageAuthorProfile } from "./MessageAuthorProfile";
import { resolveConversationHeaderParticipants, formatDmParticipantDisplayName } from "@client-kit/platform/react/conversations/dm-participant-display";
import { UserAvatar } from "@client-kit/platform/react/messages";
import type { MessageTimelineProps } from "@client-kit/platform/react/messages/timeline/types";
import { useUiT } from "@client-kit/platform/react/context";
import { ComposerReplyBanner } from "@client-kit/platform/react/messages";
import { applyMessageEdits, imetaMediaFromTags, restoreImetaMediaDisplayLabels, stripImetaMediaLines, findSpoileredImetaMediaUrls } from "@client-kit/platform/react/messages";
import { ForumComposerSurface } from "@client-kit/platform/react/forum/ForumComposerSurface";
import { useRichTextEditor, type LinkSelectionInfo } from "@client-kit/platform/react/composer/features/messages/lib/useRichTextEditor";
import { useComposerPasteHandler } from "@client-kit/platform/react/composer/features/messages/ui/useComposerPasteHandler";
import { MAX_TRACKED_INTENTS, useMentionPasteBinding } from "@client-kit/platform/react/composer/features/messages/lib/mentionPasteBinding";
import { trimMapToSize } from "@client-kit/platform/react/composer/shared/lib/trimMapToSize";
import { partitionMentionIdentitiesByLocalTrust } from "@client-kit/platform/react/composer/features/messages/lib/mentionIdentityTrust";
import { useLinkEditor } from "@client-kit/platform/react/composer/features/messages/lib/useLinkEditor";
import type { ParsedMessageLink } from "@client-kit/platform/react/composer/features/messages/lib/messageLink";
import { initDraftStore, loadDraftEntry, saveDraftEntry, clearDraftEntry } from "@client-kit/platform/react/composer/features/messages/lib/useDrafts";
import { ComposerAttachments, DropZoneOverlay } from "@client-kit/platform/react/composer/features/messages/ui/ComposerAttachments";
import { useComposerAttachmentSpoilers } from "@client-kit/platform/react/composer/features/messages/ui/useComposerAttachmentSpoilers";
import type { ImetaMedia } from "@client-kit/platform/react/composer/features/messages/lib/imetaMediaMarkdown";

const toIso = (unix: number) => new Date(unix * 1_000).toISOString();

export function mentionPeopleFromMembers(members: readonly (WorkspaceMemberView | ConversationParticipant)[]): MentionSuggestion[] {
  return members.filter(member => !("state" in member) || member.state === "ACTIVE")
    .flatMap(member => member.pubkeys.map(pubkey => ({pubkey, displayName: member.displayName})));
}


/** 页面是否在前台。已读只在用户真的看得见时推进。 */
function useVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

export function ChannelPane({
  workspaceId,
  channelName,
  channelId: admittedChannelId,
  myPrincipalId,
  onReadStateChanged,
  conversation,
  onOpenMessageLink,
  targetMessageId,
  targetThreadRootId,
  autoSendDraftKey,
  archived = false,
  metadataPending = false,
  restoreEditEventId,
  onStartDm,
}: {
  workspaceId: string;
  channelName?: string;
  channelId?: string;
  myPrincipalId: string;
  onReadStateChanged?: () => void | Promise<void>;
  conversation?: ConversationView;
  onOpenMessageLink?: (link: ParsedMessageLink) => void;
  targetMessageId?: string;
  targetThreadRootId?: string;
  autoSendDraftKey?: string;
  archived?: boolean;
  metadataPending?: boolean;
  restoreEditEventId?: string;
  onStartDm?: (pubkey: string) => void;
}) {
  const uiT = useUiT();
  const queryClient = useQueryClient();
  const threadViewMode = useThreadViewMode();
  const threadOverlay = useIsThreadPanelOverlay();
  const focusThread = threadViewMode === "focus" && !threadOverlay;
  const notifications = useBrowserNotifications();
  const window = useChannelWindow({ workspaceId, conversationId: conversation?.id, principalId: myPrincipalId, channelId: conversation?.channelId ?? admittedChannelId, onLiveEvent: (event) => receiveNotification(event), onClosed: () => {
    if (!conversation) void queryClient.invalidateQueries({ queryKey: ["platform", "channel-descriptor", myPrincipalId, workspaceId] });
  }, archived });
  const { events: rawEvents, status, live, denied } = window;
  const messageReactions = useMessageReactions({principalId:myPrincipalId,workspaceId,conversationId:conversation?.id,
    events:rawEvents,available:live && !denied && !archived && !metadataPending});
  const events = useMemo(() => {
    const deleted = new Set(rawEvents.filter(event => event.kind === 5 || event.kind === 9005).flatMap(event => event.tags.filter(tag => tag[0] === "e").map(tag => tag[1])));
    return applyMessageEdits(rawEvents.filter(event => (CHANNEL_TIMELINE_CONTENT_KINDS as readonly number[]).includes(event.kind) && !deleted.has(event.id)), rawEvents.filter(event => !deleted.has(event.id)));
  }, [rawEvents]);
  const ownProfile = useQuery({ queryKey: ["platform", "edit-author", myPrincipalId], queryFn: () => bff.profile() });
  const {editTarget, setEditTarget, handleEdit, handleCancelEdit, requireThreadEditResolution} =
    useChannelMessageEdit<TimelineMessage>(JSON.stringify([myPrincipalId, conversation?.id ?? workspaceId]));
  const mainEditTarget = editTarget && !isThreadReply(editTarget.tags ?? []) ? editTarget : null;
  const threadEditTarget = editTarget && isThreadReply(editTarget.tags ?? []) ? editTarget : null;
  const [composerBusy, setComposerBusy] = useState(false);
  const restoredEdit = useRef(false);
  const timelineRef = useRef<MessageTimelineHandle>(null);
  const onMessageSendingChange = useCallback((sending: boolean) => {
    setComposerBusy(sending);
    if (sending) timelineRef.current?.scrollToBottomOnNextUpdate();
  }, []);
  const [replyTarget, setReplyTarget] = useState<TimelineMessage | null>(null);
  const [profileTarget, setProfileTarget] = useState<TimelineMessage | null>(null);
  const [systemProfileTarget, setSystemProfileTarget] = useState<{workspaceId:string;principalId:string;pubkey:string} | null>(null);
  const closeProfile = useCallback(() => { setProfileTarget(null); setSystemProfileTarget(null); }, []);
  const handleOpenAuthor = useCallback(
    (message: TimelineMessage) => {
      if (!requireThreadEditResolution()) return;
      setProfileTarget(message);
    },
    [requireThreadEditResolution],
  );
  const handleOpenThread = useCallback(
    (message: TimelineMessage) => {
      if (!requireThreadEditResolution()) return;
      handleCancelEdit();
      setProfileTarget(null);
      setSystemProfileTarget(null);
      setReplyTarget(message);
    },
    [handleCancelEdit, requireThreadEditResolution],
  );
  const handleCloseThread = useCallback(() => {
    if (requireThreadEditResolution()) setReplyTarget(null);
  }, [requireThreadEditResolution]);
  const useFocusThreadDrawer = Boolean(!conversation && replyTarget && focusThread && !profileTarget && !systemProfileTarget);
  const { channelIsCovered, markExitComplete } = useFocusDrawerPresence(useFocusThreadDrawer, handleCloseThread);
  const handleEditConfirmed = useCallback(
    (message: TimelineMessage) => {
      setEditTarget((current) => (current?.id === message.id ? null : current));
    },
    [setEditTarget],
  );
  const canDelete = live && !denied && !archived && !metadataPending && !composerBusy &&
    ownProfile.isSuccess && !ownProfile.isFetching && Boolean(ownProfile.data?.pubkey) && (!conversation || conversation.state === "ACTIVE");
  const deleteMessageDialog = useMessageDeleteDialog(
    JSON.stringify([myPrincipalId, ownProfile.data?.pubkey, conversation?.id ?? workspaceId]), canDelete,
    async (message) => {
      if (!canDelete || message.kind !== 9 || message.pending || message.signerPubkey !== ownProfile.data?.pubkey) throw new Error("Deletion identity or scope is unavailable.");
      const receipt = await deleteMessage(workspaceId, message.id, WebMessageType.Stream, conversation?.id);
      if (!receipt?.eventId || !receipt.operationId) throw new TransportError("Deletion has no confirmed receipt.");
    },
    (message) => {
      handleEditConfirmed(message);
      void queryClient.invalidateQueries({queryKey: ["platform", "inbox-thread", myPrincipalId, workspaceId]});
    },
  );
  useEffect(() => {
    if (denied || !live) handleCancelEdit();
  }, [denied, live, handleCancelEdit]);
  useEffect(() => { setProfileTarget(null); }, [workspaceId, conversation?.id, myPrincipalId, denied, live]);
  useEffect(() => { setSystemProfileTarget(null); }, [workspaceId, conversation?.id, myPrincipalId, denied, live]);
  const visible = useVisible();
  const members = useQuery({
    queryKey: ["platform", conversation ? "conversation-members" : "members", workspaceId, myPrincipalId,
      conversation ? {conversationId:conversation.id,participantPrincipalIds:conversation.participantPrincipalIds} : null],
    queryFn: async () => {
      if (!conversation) return bff.members(workspaceId);
      const items: ConversationParticipant[] = [];
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const page = await bff.conversationParticipants(cursor);
        items.push(...page.items.filter((item) => conversation.participantPrincipalIds.includes(item.principalId)));
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor)) throw new TransportError("Recipient cursor did not advance.");
        if (cursor) seen.add(cursor);
      } while (cursor);
      return items;
    },
  });
  const userState = useQuery(platformQueries.userState);
  const mentionPeople = useMemo(() => mentionPeopleFromMembers(members.isSuccess && !members.isError ? members.data ?? [] : []),
    [members.data, members.isSuccess, members.isError]);
  const conversationInvalidation = useConversationInvalidation();
  useEffect(() => {
    if (conversation) void queryClient.invalidateQueries({ queryKey: platformQueries.userState.queryKey });
  }, [conversation?.id, conversationInvalidation?.revision, queryClient]);

  // 作者按成员名显示。一个人可能有多把公钥（Web 与各台原生设备，DD-77），
  // 任一把签发的消息都归到同一个人名下；取不到时退回上游统一的 pubkey 缩写。
  const byPubkey = useMemo(
    () => new Map((members.data ?? []).flatMap((m) => m.pubkeys.map((k) => [k, m] as const))),
    [members.data],
  );
  const mine = useMemo(
    () => new Set((members.data ?? []).find((m) => m.principalId === myPrincipalId)?.pubkeys),
    [members.data, myPrincipalId],
  );
  const timelineMessages = useMemo<TimelineMessage[]>(() => events.map((event) => ({
    id: event.id, createdAt: event.created_at, pubkey: event.pubkey,
    signerPubkey: event.pubkey, author: byPubkey.get(event.pubkey)?.displayName ?? truncatePubkey(event.pubkey),
    body: event.content, tags: event.tags, kind: event.kind, time: "", depth: 0, reactions:messageReactions.reactions.get(event.id),
    ...getThreadReference(event.tags),
  })), [events, byPubkey, messageReactions.reactions]);
  // Original ChannelScreen merges freshly read route context with its channel
  // window. Search results and URL ids are not permission to reuse stale bodies.
  const routeContextEnabled = Boolean(targetMessageId && !conversation && live && !denied && !metadataPending);
  const routeContext = useWorkspaceThread(myPrincipalId, workspaceId, targetThreadRootId ?? targetMessageId ?? "", undefined, undefined, routeContextEnabled);
  useEffect(() => {
    if (routeContextEnabled && !routeContext.denied && !routeContext.thread.isError && routeContext.thread.hasNextPage && !routeContext.thread.isFetchingNextPage) void routeContext.thread.fetchNextPage();
  }, [routeContextEnabled, routeContext.denied, routeContext.thread.isError, routeContext.thread.hasNextPage, routeContext.thread.isFetchingNextPage, routeContext.thread.fetchNextPage]);
  const routeContextReady = routeContextEnabled && !routeContext.denied && !routeContext.interrupted && routeContext.thread.isSuccess && !routeContext.thread.isError && !routeContext.thread.isFetching;
  const routeMessages = useMemo<TimelineMessage[]>(() => routeContextReady ? routeContext.messages.map(event => ({
    id: event.id, createdAt: event.createdAt, pubkey: event.pubkey, signerPubkey: event.pubkey,
    author: byPubkey.get(event.pubkey)?.displayName ?? truncatePubkey(event.pubkey),
    body: event.content, tags: event.tags, kind: event.kind, time: "", depth: 0,
    ...getThreadReference(event.tags),
  })) : [], [routeContextReady, routeContext.messages, byPubkey]);
  const routeMessageById = useMemo(() => new Map([...timelineMessages, ...routeMessages].map(message => [message.id, message])), [timelineMessages, routeMessages]);
  const routeTarget = targetMessageId ? routeMessageById.get(targetMessageId) ?? null : null;
  const mainTimelineTargetMessageId = getRouteMainTimelineTargetId(targetMessageId ?? null, routeTarget);
  const routedTimelineMessages = useMemo(() => {
    if (!routeContextReady || !routeTarget) return timelineMessages;
    const rootId = getRouteMainTimelineTargetId(routeTarget.id, routeTarget);
    const root = rootId ? routeMessageById.get(rootId) : undefined;
    if (!root || timelineMessages.some(message => message.id === root.id)) return timelineMessages;
    return [...timelineMessages, root].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
  }, [routeContextReady, routeTarget, timelineMessages, routeMessageById]);
  const handledRouteTarget = useRef<string | null>(null);
  useEffect(() => {
    if (!targetMessageId) { handledRouteTarget.current = null; return; }
    const key = JSON.stringify([myPrincipalId, workspaceId, targetMessageId]);
    if (handledRouteTarget.current === key || !routeContextReady || !routeTarget || composerBusy) return;
    if (routeTarget.parentId && (isBroadcastReply(routeTarget.tags ?? []) || !getThreadRouteTarget(routeTarget, routeMessageById))) return;
    if (!requireThreadEditResolution()) return;
    // Original root and reply deep links open the existing reply panel. Its
    // exact selected event resolves ancestors and scrolls in the same read cache.
    setProfileTarget(null); setSystemProfileTarget(null); setReplyTarget(routeTarget);
    handleCancelEdit();
    handledRouteTarget.current = key;
  }, [targetMessageId, myPrincipalId, workspaceId, routeContextReady, routeTarget, routeMessageById, composerBusy, editTarget, requireThreadEditResolution, handleCancelEdit]);
  const profiles = useMemo(() => Object.fromEntries([...byPubkey].map(([pubkey, member]) => [pubkey, {displayName:member.displayName, avatarUrl:null, nip05Handle:null, ownerPubkey:null}])), [byPubkey]);
  const directMessageIntro = useMemo<MessageTimelineProps["directMessageIntro"]>(() => {
    if (!conversation || !live || denied || metadataPending || !members.isSuccess || members.isError || members.isFetching) return null;
    const people = resolveConversationHeaderParticipants(conversation, myPrincipalId, members.data ?? []);
    if (!people) return null;
    const participants = people.map(person => ({id:person.principalId,displayName:person.displayName,avatarUrl:null}));
    return {displayName:formatDmParticipantDisplayName(participants, uiT), participants,
      renderParticipant: (participant, className) => {
        // The directory proves recipients, not profile authority. Only an
        // admitted author event can open/read a DM participant's profile.
        const person = people.find(person => person.principalId === participant.id)!;
        const author = timelineMessages.find(message => message.pubkey && person.pubkeys.includes(message.pubkey));
        if (!author?.pubkey) return <UserAvatar avatarUrl={null} className={className} displayName={participant.displayName} shape="circle" size="md"/>;
        const target = {principalId:myPrincipalId,workspaceId,conversationId:conversation.id,eventId:author.id,pubkey:author.pubkey};
        return <MessageAuthorIdentity target={target} onOpen={() => handleOpenAuthor(author)}>
          <MessageAuthorAvatar target={target} className={className} displayName={participant.displayName}/>
        </MessageAuthorIdentity>;
      }};
  }, [conversation, live, denied, metadataPending, members.isSuccess, members.isError, members.isFetching, members.data, myPrincipalId, workspaceId, timelineMessages, handleOpenAuthor, uiT]);
  const { handleEditLastOwnMainMessage, routeEdit: handleRoutedEdit } = useRoutedMessageEdit({
    activeChannelId: JSON.stringify([myPrincipalId, conversation?.id ?? workspaceId]),
    channelIsCovered,
    currentPubkey: ownProfile.isSuccess && !ownProfile.isFetching ? ownProfile.data.pubkey : undefined,
    editTarget: editTarget ? {id: editTarget.id, isThreadReply: isThreadReply(editTarget.tags ?? [])} : null,
    isSinglePanelView: false,
    mainMessages: routedTimelineMessages.filter(message => message.kind === 9),
    onCloseThread: handleCloseThread,
    onEdit: live && !denied && !archived && !metadataPending && !composerBusy ? handleEdit : undefined,
    useFocusThreadDrawer,
  });
  const SystemProfilePopover = useCallback(({pubkey, children, triggerAriaLabel}: {pubkey:string;children:ReactNode;triggerAriaLabel?:string}) => {
    const member = byPubkey.get(pubkey);
    if (conversation || !live || denied || !member || !("state" in member) || member.state !== "ACTIVE") return <>{children}</>;
    const target = {workspaceId, principalId:member.principalId, pubkey};
    return <UserProfilePopoverSurface pubkey={pubkey} triggerElement="span" triggerAriaLabel={triggerAriaLabel ?? t("platform.settings.profile")}
      onOpenProfile={() => {if (!requireThreadEditResolution()) return;setProfileTarget(null);setSystemProfileTarget(target);}}
      renderBody={props=><MemberHover {...props} target={target}/>}>{children}</UserProfilePopoverSurface>;
  }, [byPubkey, conversation, live, denied, workspaceId, requireThreadEditResolution]);
  const selectedSystemMember = systemProfileTarget ? byPubkey.get(systemProfileTarget.pubkey) : undefined;
  const mentions: MessageMention[] = useMemo(() => (members.data ?? []).flatMap(member => member.pubkeys.map(pubkey => {
    let renderProfile: MessageMention["renderProfile"];
    if (members.isSuccess && !members.isError && live && !denied) {
      if (!conversation && "state" in member && member.state === "ACTIVE") {
        const target = {workspaceId, principalId:member.principalId, pubkey};
        renderProfile = children => <UserProfilePopoverSurface pubkey={pubkey} triggerElement="span" triggerClassName="inline"
          onOpenProfile={() => { setProfileTarget(null); setSystemProfileTarget(target); }}
          renderBody={props => <MemberHover {...props} target={target}/>}>{children}</UserProfilePopoverSurface>;
      } else if (conversation) {
        // A private-conversation directory entry is not profile-read authority.
        // Reuse an actual admitted author event, including its exact signer key.
        const author = timelineMessages.find(message => message.pubkey === pubkey);
        if (author) renderProfile = children => <MessageAuthorIdentity
          target={{principalId:myPrincipalId, workspaceId, conversationId:conversation.id, eventId:author.id, pubkey}}
          triggerElement="span" triggerClassName="inline"
          onOpen={() => { setSystemProfileTarget(null); setProfileTarget(author); }}>{children}</MessageAuthorIdentity>;
      }
    }
    return {pubkey, name:member.displayName, isAgent:false, renderProfile};
  })), [members.data, members.isSuccess, members.isError, live, denied, conversation, workspaceId, myPrincipalId, timelineMessages]);
  useEffect(() => {
    if (!restoreEditEventId || restoredEdit.current || !ownProfile.isSuccess) return;
    const message = timelineMessages.find((item) => item.id === restoreEditEventId && item.kind === 9 && item.signerPubkey === ownProfile.data.pubkey);
    if (message) { restoredEdit.current = true; setEditTarget(message); }
  }, [restoreEditEventId, timelineMessages, ownProfile.isSuccess, ownProfile.data]);
  const copyMessage = async (message: TimelineMessage) => {
    const html = buildMentionClipboardHtml(resolveMessageMentionClipboard(message.tags, profiles, message.body));
    try {
    await (html && typeof ClipboardItem !== "undefined"
      ? navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([message.body], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })])
      : navigator.clipboard.writeText(message.body));
    toast.success(t("buzz.copiedMessage"));
    } catch { toast.error(t("buzz.copyFailed")); }
  };

  // 已读：key 是该 Workspace 的 Channel ID，取自消息自身的 h 标签（.design/03）
  const channelId = conversation?.channelId ?? admittedChannelId ?? events
    .find((e) => e.tags.some((tag) => tag[0] === "h"))
    ?.tags.find((tag) => tag[0] === "h")?.[1];
  const copyMessageLink = channelId ? async (target: TimelineMessage) => {
    const { rootId } = getThreadReference(target.tags ?? []);
    try { await navigator.clipboard.writeText(buildMessageLink({ channelId, messageId: target.id, threadRootId: rootId })); toast.success(t("buzz.copiedLink")); }
    catch { toast.error(t("buzz.copyFailed")); }
  } : undefined;
  const lastReadIso = channelId ? userState.data?.readContexts[channelId] : undefined;
  const lastRead = lastReadIso ? Date.parse(lastReadIso) / 1_000 : 0;
  const muted = conversation
    ? !userState.data?.conversationPreferences || userState.isError || userState.isFetching || (userState.data.conversationPreferences[conversation.id]?.muted ?? false)
    : userState.data?.workspacePreferences[workspaceId]?.muted ?? false;
  const receiveNotification = useEffectEvent((event: BuzzEvent) => {
    // No notification from unresolved identity/preferences or stale admission.
    // This path only receives new frames after the actual BFF live fence.
    if ((event.kind !== 9 && event.kind !== 40002) || denied || !members.isSuccess || members.isFetching || !userState.isSuccess || userState.isFetching || userState.isError ||
      mine.size === 0 || mine.has(event.pubkey)) return;
    const mentioned = event.tags.some((tag) => tag[0] === "p" && mine.has(tag[1] ?? ""));
    const thread = getThreadReference(event.tags);
    const participated = thread.rootId !== null && (events.some((prior) => mine.has(prior.pubkey) &&
      (prior.id === thread.rootId || getThreadReference(prior.tags).rootId === thread.rootId)) ||
      (channelId !== undefined && reactionThreadInteractionRoots(rawEvents, mine, channelId).has(thread.rootId)));
    // Original mention precedence and thread-participation semantics. Ordinary
    // channel activity is not falsely promoted into a desktop alert.
    if (conversation ? muted : !mentioned && (muted || !participated || !thread.parentId)) return;
    const slot = conversation ? "dm" : mentioned ? "mention" : "thread_reply";
    const notification = formatMessageNotification({ source: slot, senderName: byPubkey.get(event.pubkey)?.displayName, content: event.content });
    notifications?.notify({ eventId: event.id, ...notification, slot,
      onOpen: () => { const target = document.querySelector(`[data-event-id="${event.id}"]`); if (target instanceof HTMLElement) { target.scrollIntoView({ block: "center" }); target.focus({ preventScroll: true }); } },
    });
  });

  // 分隔线锚定在打开频道时的已读位置：推进已读后它不应立刻消失。
  // 换 Workspace 时由父组件按 key 重建本组件，锚点随之清零。
  const [anchor, setAnchor] = useState<number | null>(null);
  useEffect(() => {
    if (anchor === null && userState.isSuccess && live) setAnchor(lastRead);
  }, [anchor, userState.isSuccess, live, lastRead]);

  const unreadFromOthers = events.filter(
    (e) => isConversationalUnreadKind(e.kind) && e.created_at > lastRead && !mine.has(e.pubkey),
  ).length;
  const newest = events.filter(event => isConversationalUnreadKind(event.kind)).at(-1);

  const attemptedRead = useRef<ReadMarkRequest | null>(null);
  const [readRechecking, setReadRechecking] = useState(false);
  const rechecking = useRef(false);
  const readScope = useRef({ active: true, live, visible, denied, channelId });
  readScope.current = { active: true, live, visible, denied, channelId };
  useEffect(() => {
    readScope.current.active = true;
    return () => { readScope.current.active = false; };
  }, []);
  const read = useMutation({
    retry: false,
    mutationFn: async (request: ReadMarkRequest) => {
      const result = await markRead(request);
      if (result?.version !== request.version + 1)
        throw new TransportError("Invalid user-state CAS response");
      return result;
    },
    // Readback is not permission to resend: only a higher CAS version fences
    // the old request. Never advance lastRead optimistically after an error.
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: platformQueries.userState.queryKey });
      await onReadStateChanged?.();
    },
  });
  const readPending = read.isPending;
  const readMutate = read.mutate;
  useEffect(() => {
    if (!live || !visible || denied || !channelId || !newest || !userState.isSuccess
      || userState.isFetching || !userState.data || readPending || readRechecking) return;
    if (newest.created_at <= lastRead) return;
    if (attemptedRead.current && userState.data.version <= attemptedRead.current.version) return;
    const request = {
      contextKey: channelId,
      lastReadAt: toIso(newest.created_at),
      version: userState.data.version,
    };
    attemptedRead.current = request;
    readMutate(request);
  }, [live, visible, denied, channelId, newest, lastRead, userState.data,
    userState.isSuccess, userState.isFetching, readPending, readRechecking, readMutate]);

  const retryRead = async () => {
    const request = attemptedRead.current;
    if (!request || readPending || rechecking.current) return;
    rechecking.current = true;
    setReadRechecking(true);
    try {
      const observed = await userState.refetch();
      const scope = readScope.current;
      if (!scope.active || !scope.live || !scope.visible || scope.denied
        || scope.channelId !== request.contextKey || !observed.isSuccess) return;
      // Explicit retry with the unchanged CAS version is the unchanged intent,
      // even if newer messages arrived while its result was unknown.
      if (observed.data.version === request.version) readMutate(request);
      else if (observed.data.version > request.version) read.reset();
    } finally {
      rechecking.current = false;
      if (readScope.current.active) setReadRechecking(false);
    }
  };

  // 页面在后台时，未读数进标签页标题；静音的 Workspace 不提示
  useEffect(() => {
    const title = t("app.title");
    document.title =
      !visible && !muted && notifications?.settings.homeBadgeEnabled !== false && unreadFromOthers > 0 ? `(${unreadFromOthers}) ${title}` : title;
    return () => {
      document.title = title;
    };
  }, [visible, muted, unreadFromOthers, notifications?.settings.homeBadgeEnabled]);

  return (
    <div className="relative flex h-full min-h-0 min-w-0 overflow-hidden">
    <div inert={channelIsCovered ? true : undefined} className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 [--channel-top-chrome-height:0px] [--composer-overlay-height:0px] [--buzz-channel-content-top-padding:0px]">
      <div className="text-xs text-muted-foreground" role="status">
        {status}
      </div>
      {read.isError && !denied ? <div role="alert" className="text-sm text-destructive">
        {t(isOutcomeUnknown(read.error) ? "inbox.readUnknown" : "inbox.readUnavailable")}
        <Button disabled={readPending || readRechecking || !live || !visible}
          onClick={() => { void retryRead(); }}>{t("platform.retry")}</Button>
      </div> : null}
      {routeContextEnabled && (routeContext.thread.isError || routeContext.denied || routeContext.interrupted) ? <ThreadRepliesErrorCard
        onRetry={routeContext.denied ? undefined : () => {void routeContext.thread.refetch();}}/> : null}
      {targetMessageId && live && !events.some((event) => event.id === targetMessageId) && !routeTarget && (!routeContextEnabled || (routeContextReady && !routeContext.thread.hasNextPage)) ? <p role="status">{t("platform.linkMessageOutsideHistory")}</p> : null}
      {!denied ? <MessageTimelineSurface
        ref={timelineRef}
        channelId={`${myPrincipalId}:${conversation?.id ?? workspaceId}`}
        channelName={channelName}
        directMessageIntro={directMessageIntro}
        messages={routedTimelineMessages}
        authoritativeRowIds={window.authoritativeRowIds}
        threadSummaries={window.threadSummaries}
        profiles={profiles}
        fetchOlder={window.fetchOlder}
        isFetchingOlder={window.isFetchingOlder}
        hasOlderMessages={window.hasOlderMessages}
        historyExhausted={window.historyExhausted}
        isError={window.error}
        onRetry={window.retry}
        isLoading={window.isLoading && timelineMessages.length === 0}
        targetMessageId={mainTimelineTargetMessageId}
        hasComposerOverlay={false}
        firstUnreadMessageId={anchor === null ? null : timelineMessages.find(message => isConversationalUnreadKind(message.kind) && message.createdAt > anchor && !mine.has(message.pubkey ?? ""))?.id ?? null}
        unreadCount={unreadFromOthers}
        renderList={props => <ChannelTimelineRows {...props} renderItem={(item, highlightedMessageId) => {
          const entries = item.kind === "system-group" ? item.entries : [item.entry];
          if (entries[0]?.message.kind === 40099) return <div className="flex flex-col gap-1 pb-2.5" data-event-id={entries[0].message.id}>
            <SystemMessageRowSurface message={entries[0].message} groupedMessages={entries.map(entry=>entry.message)}
              onToggleReaction={messageReactions.onToggleReaction} customEmoji={messageReactions.customEmoji}
              reactionScope={messageReactions.reactionScope} resolveMediaUrl={messageReactions.resolveMediaUrl}
              currentPubkey={ownProfile.data?.pubkey} profiles={profiles} ProfilePopover={SystemProfilePopover}/>
          </div>;
          return entries.map(entry => {
            const message = entry.message;
            const isContinuation = item.kind === "message" && item.isContinuation;
            const followedByContinuation = item.kind === "message" && item.isFollowedByContinuation;
            return <div key={message.id} data-event-id={message.id} className={`flex flex-col gap-1 ${followedByContinuation ? "pb-0" : "pb-2.5"}`}>
              <MessageRowSurface message={message} isContinuation={isContinuation} showDepthGuides={false} highlighted={highlightedMessageId === message.id}
                onToggleReaction={messageReactions.onToggleReaction} customEmoji={messageReactions.customEmoji}
                reactionScope={messageReactions.reactionScope} resolveMediaUrl={messageReactions.resolveMediaUrl}
                renderIdentity={message.pubkey && live && !denied ? (node,kind) => <MessageAuthorIdentity
                  target={{principalId:myPrincipalId,workspaceId,conversationId:conversation?.id,eventId:message.id,pubkey:message.pubkey!}}
                  onOpen={() => handleOpenAuthor(message)}>{kind === "avatar" ? <div className="relative shrink-0"><MessageAuthorAvatar
                    target={{principalId:myPrincipalId,workspaceId,conversationId:conversation?.id,eventId:message.id,pubkey:message.pubkey!}}
                    accent={message.accent} className="shrink-0" displayName={message.author} testId="message-avatar" /></div> : node}</MessageAuthorIdentity> : undefined}
                renderActions={(ref,reactions) => <MessageActionBarSurface ref={ref} {...reactions} message={message} onCopyMessage={copyMessage}
                  onEdit={message.kind === 9 && live && !denied && !archived && !metadataPending && !composerBusy && ownProfile.isSuccess && !ownProfile.isFetching && message.signerPubkey === ownProfile.data.pubkey ? handleRoutedEdit : undefined}
                  onDelete={canDelete && message.kind === 9 && message.signerPubkey === ownProfile.data?.pubkey ? deleteMessageDialog.requestDelete : undefined}
                  onReply={!conversation && (message.kind === 9 || message.kind === 40002) && live && !denied && !archived && !metadataPending ? handleOpenThread : undefined}
                  onCopyLink={copyMessageLink} />}
                renderBody={(className) => <div className={className}><MessageContent
                content={message.body}
                mediaTags={message.tags}
                mentions={mentions}
                workspaceId={workspaceId}
                conversationId={conversation?.id}
                onOpenMessageLink={onOpenMessageLink}
              /></div>} />
              {entry.summary && !conversation ? <MessageThreadSummaryRow message={message} summary={entry.summary}
                onOpenThread={handleOpenThread} /> : null}
            </div>;
          });
        }} />}
      /> : null}
      {restoreEditEventId && live && !editTarget && !events.some((event) => event.id === restoreEditEventId) ? <p role="status">{t("platform.linkMessageOutsideHistory")}</p> : null}
      {!denied && mainEditTarget ? <Composer key={`edit:${mainEditTarget.id}`} workspaceId={conversation ? undefined : workspaceId}
        mentionPeople={mentionPeople}
        editTarget={mainEditTarget} onCancelEdit={handleCancelEdit} onConfirmed={() => handleEditConfirmed(mainEditTarget)} draftIdentity={myPrincipalId}
        onRequestEmptyEditDelete={deleteMessageDialog.requestDelete}
        draftKey={`edit:${workspaceId}:${mainEditTarget.id}`} draftChannelId={workspaceId}
        autoSendDraftKey={autoSendDraftKey}
        disabled={deleteMessageDialog.pending || denied || !live || archived || metadataPending || !ownProfile.isSuccess || ownProfile.isFetching || ownProfile.data.pubkey !== mainEditTarget.signerPubkey}
        onSendingChange={setComposerBusy} onOpenMessageLink={onOpenMessageLink}
        onUpload={conversation ? (file) => uploadConversationMedia(conversation.id, file) : undefined}
        onMediaUrl={conversation ? (sha) => mediaUrl(conversation.id, sha, conversation.id) : undefined}
        onPublish={async (content, attachments, key, mentions, mentionPubkeys) => {
          const receipt = await (conversation ? publishConversationMessage(conversation.id, content, attachments, key, mainEditTarget.id, undefined, mentionPubkeys)
            : publishMessage(workspaceId, content, attachments, key, mentions, {editEventId: mainEditTarget.id, mentionPubkeys}));
          if (!receipt?.eventId || !receipt.operationId) throw new TransportError("Message edit has no confirmed receipt.");
          return receipt;
        }} /> : null}
      <div hidden={mainEditTarget !== null}>
      {denied ? null : conversation
        ? <Composer disabled={conversation.state !== "ACTIVE"} onSendingChange={onMessageSendingChange} mentionPeople={mentionPeople}
            onEditLastOwnMessage={handleEditLastOwnMainMessage}
            draftIdentity={myPrincipalId} draftKey={conversation.id} autoSendDraftKey={autoSendDraftKey} onOpenMessageLink={onOpenMessageLink}
            onPublish={(content, attachments, key, _installations, mentionPubkeys) => publishConversationMessage(conversation.id, content, attachments, key, undefined, undefined, mentionPubkeys)}
            onMediaUrl={(sha256) => mediaUrl(conversation.id, sha256, conversation.id)}
            onUpload={(file) => uploadConversationMedia(conversation.id, file)} />
        : <>{archived ? <p role="status">{t("channel.archived")}</p> : null}<Composer
            mentionPeople={mentionPeople}
            onEditLastOwnMessage={handleEditLastOwnMainMessage}
            disabled={archived || metadataPending}
            onSendingChange={onMessageSendingChange}
            workspaceId={workspaceId} draftIdentity={myPrincipalId} draftKey={workspaceId}
            autoSendDraftKey={autoSendDraftKey} onOpenMessageLink={onOpenMessageLink} /></>}
      </div>
    </div>
    {systemProfileTarget && systemProfileTarget.workspaceId === workspaceId && selectedSystemMember?.principalId === systemProfileTarget.principalId && "state" in selectedSystemMember && selectedSystemMember.state === "ACTIVE" && live && !denied && !conversation ? <MemberProfilePanel key={`${myPrincipalId}:${systemProfileTarget.workspaceId}:${systemProfileTarget.pubkey}`}
      target={systemProfileTarget} onClose={()=>setSystemProfileTarget(null)} onStartDm={mine.has(systemProfileTarget.pubkey)?undefined:onStartDm}/> : null}
    {profileTarget?.pubkey && live && !denied ? <MessageAuthorProfile key={`${myPrincipalId}:${workspaceId}:${profileTarget.id}`}
      target={{principalId:myPrincipalId,workspaceId,conversationId:conversation?.id,eventId:profileTarget.id,pubkey:profileTarget.pubkey}}
      onClose={()=>setProfileTarget(null)} onStartDm={mine.has(profileTarget.pubkey)?undefined:onStartDm}/> : null}
    <AnimatePresence mode="wait" onExitComplete={markExitComplete}>
    {!conversation && replyTarget ? <div key={`${myPrincipalId}:${workspaceId}:${getThreadReference(replyTarget.tags ?? []).rootId ?? replyTarget.id}`} className={profileTarget || systemProfileTarget ? "hidden" : "contents"}><FocusThreadDrawer active={focusThread && !profileTarget && !systemProfileTarget} channelName={channelName} onClose={handleCloseThread}><ChannelThreadPane key={`${myPrincipalId}:${workspaceId}:${getThreadReference(replyTarget.tags ?? []).rootId ?? replyTarget.id}`}
      channelName={channelName}
      isFocusMode={focusThread}
      workspaceId={workspaceId} principalId={myPrincipalId} selected={replyTarget}
      routeTargetMessageId={replyTarget.id === routeTarget?.id ? targetMessageId : undefined}
      mentions={mentions}
      onOpenAuthor={handleOpenAuthor} onAuthorScopeUnavailable={closeProfile}
      editTarget={threadEditTarget} onEdit={handleRoutedEdit} onCancelEdit={handleCancelEdit} onEditConfirmed={handleEditConfirmed}
      onDelete={canDelete ? deleteMessageDialog.requestDelete : undefined} onRequestEmptyEditDelete={deleteMessageDialog.requestDelete}
      editAuthorPubkey={ownProfile.isSuccess && !ownProfile.isFetching ? ownProfile.data.pubkey : undefined}
      editBusy={composerBusy || deleteMessageDialog.pending} onEditSendingChange={setComposerBusy}
      members={(members.data ?? []).filter((member): member is WorkspaceMemberView => "state" in member)} disabled={archived || metadataPending || denied || !live}
      onClose={handleCloseThread} onCopyMessage={copyMessage} onCopyLink={copyMessageLink} /></FocusThreadDrawer></div> : null}
    </AnimatePresence>
    {deleteMessageDialog.dialog}
    </div>
  );
}

type Pending = { name: string; descriptor: MediaDescriptor; receivedAt: number };

/**
 * 一次发送意图的幂等键（UUID v4）。不用 crypto.randomUUID：它只在安全上下文中
 * 存在，而 getRandomValues 在任何上下文都可用。
 */
function newIntentKey(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function Composer({ mentionPeople, workspaceId, onPublish, onUpload, onMediaUrl, disabled = false, placeholder, onOpenMessageLink, draftIdentity, draftKey, surface = "stream", compact = false, autocompleteBelow = false, composerHeader, onCancel, autoSendDraftKey, replyTarget, onCancelReply, containerClassName, layoutMode = "standalone", onSendingChange, editTarget, onCancelEdit, onEditLastOwnMessage, onConfirmed, draftChannelId, onRequestEmptyEditDelete }: {
  mentionPeople?: readonly MentionSuggestion[];
  editTarget?: TimelineMessage;
  onCancelEdit?: () => void;
  onRequestEmptyEditDelete?: (message: TimelineMessage) => void;
  onEditLastOwnMessage?: () => boolean;
  onConfirmed?: () => void;
  draftChannelId?: string;
  surface?: "stream" | "forum";
  compact?: boolean;
  autocompleteBelow?: boolean;
  composerHeader?: React.ReactNode;
  workspaceId?: string;
  onPublish?: (content: string, attachments: readonly MediaDescriptor[], idempotencyKey: string, mentionInstallationIds: string[], humanMentionPubkeys?: string[]) => Promise<unknown>;
  onCancel?: () => void;
  containerClassName?: string;
  layoutMode?: "standalone" | "dock";
  onSendingChange?: (sending: boolean) => void;
  replyTarget?: { author: string; body: string; id: string } | null;
  onCancelReply?: () => void;
  onUpload?: (file: File) => Promise<MediaDescriptor>;
  onMediaUrl?: (sha256: string) => string;
  disabled?: boolean;
  placeholder?: string;
  onOpenMessageLink?: (link: ParsedMessageLink) => void;
  draftIdentity?: string;
  draftKey?: string;
  /** Original Inbox sends only after its explicit confirmation, using this editor's existing intent. */
  autoSendDraftKey?: string;
}) {
  const customEmoji = useBffCustomEmojiPalette(bff);
  const [confirmedSendRevision, setConfirmedSendRevision] = useState(0);
  const [humanQuery, setHumanQuery] = useState<{query:string;startIndex:number;cursor:number}|null>(null);
  const humanBindings = useRef(new Map<string,string>());
  const mentionPeopleRef = useRef(mentionPeople);
  mentionPeopleRef.current = mentionPeople;
  const [humanNames,setHumanNames] = useState<string[]>([]);
  const humanSuggestions = useMemo(()=>mentionPeople?.filter(person=>humanQuery!==null && person.displayName.toLowerCase().includes(humanQuery.query.toLowerCase()))??[],[mentionPeople,humanQuery]);
  const {mentionSelectedIndex:humanIndex,setMentionSelectedIndex:setHumanIndex}=useMentionSelection(humanSuggestions);
  const [draft, setDraft] = useState("");
  const [draftRevision, setDraftRevision] = useState(0);
  const [pending, setPending] = useState<Pending[]>([]);
  const [uploading, setUploading] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [problemNeutral, setProblemNeutral] = useState(false);
  const [mentionInstallationIds, setMentionInstallationIds] = useState<string[]>([]);
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [sending, setSending] = useState(false);
  useEffect(() => { onSendingChange?.(sending); }, [sending, onSendingChange]);
  useEffect(() => () => { onSendingChange?.(false); }, [onSendingChange]);
  const [dragging, setDragging] = useState(false);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const [originals, setOriginals] = useState<Map<string, Pending>>(() => new Map());
  const originalsRef = useRef(originals);
  originalsRef.current = originals;
  const installations = useInfiniteQuery({
    queryKey: ["platform", "mention-installations", workspaceId],
    queryFn: ({ pageParam }) => bff.agentInstallations(workspaceId!, pageParam),
    enabled: workspaceId !== undefined,
    initialPageParam: 0,
    getNextPageParam: (page) => page.nextOffset ?? undefined,
  });
  const mentionable = useMemo(() => {
    const byId = new Map<string, AgentInstallationView>();
    const invalid = new Set<string>();
    for (const installation of installations.data?.pages.flatMap((page) => page.installations) ?? []) {
      if (installation.workspaceId !== workspaceId || installation.state !== "ACTIVE" ||
          installation.resourceState !== "ACTIVE" || installation.agentPrincipalState !== "ACTIVE" ||
          installation.executionPermission?.effective !== true ||
          installation.channelBinding?.status !== "ACTIVE" ||
          !installation.channelBinding.triggers.includes(AgentTrigger.Mention)) {
        invalid.add(installation.resourceId);
      }
      byId.set(installation.resourceId, installation);
    }
    // Overlapping offset pages cannot let an old ACTIVE row conceal a revoked one.
    return [...byId.values()].filter((installation) => !invalid.has(installation.resourceId));
  }, [installations.data, workspaceId]);
  const mentionVerified = mentionInstallationIds.length === 0 || (installations.isSuccess &&
    mentionInstallationIds.every((id) => mentionable.some((installation) => installation.resourceId === id)));
  const suggestions = useMemo(() => mentionable.filter((installation) =>
    !mentionInstallationIds.includes(installation.resourceId)), [mentionable, mentionInstallationIds]);
  const { mentionSelectedIndex, setMentionSelectedIndex } = useMentionSelection(suggestions);
  const selectMention = (installation: AgentInstallationView) => {
    if (sending || !installations.isSuccess || !mentionable.includes(installation)) return;
    setMentionInstallationIds((current) => [...new Set([...current, installation.resourceId])].sort());
    setMentionPickerOpen(false);
    setMentionSelectedIndex(0);
  };
  const picker = useRef<HTMLInputElement>(null);
  // 当前发送意图：内容与附件不变时重发沿用同一个键——结果不明之后再点发送，
  // BFF 回答原操作的结论而不是再发一条（DD-81）。确定的结论之后换新键。
  const intent = useRef<{ key: string; signature: string } | null>(null);
  const owner = useMemo(() => ({ active: true, sending: false }), [workspaceId, draftIdentity, draftKey]);
  useEffect(() => { owner.active = true; return () => { owner.active = false; }; }, [owner]);
  const asBlob = (entry: Pending): ImetaMedia => ({ ...entry.descriptor, uploaded: entry.receivedAt });
  const removeAttachment = useCallback((url: string) => {
    setPending((items) => items.filter((item) => item.descriptor.url !== url));
    setOriginals((current) => { const next = new Map(current); next.delete(url); return next; });
  }, []);
  const revertAttachment = useCallback((url: string) => {
    const original = originalsRef.current.get(url);
    if (!original) return null;
    setPending((items) => items.map((item) => item.descriptor.url === url ? original : item));
    setOriginals((current) => { const next = new Map(current); next.delete(url); return next; });
    return asBlob(original);
  }, []);
  const uploadEditedAttachment = useCallback(async (url: string, bytes: Uint8Array) => {
    const source = pendingRef.current.find((item) => item.descriptor.url === url);
    if (!source || !owner.active) throw new Error("Attachment is no longer in this draft.");
    setUploading((count) => count + 1);
    try {
      const file = new File([new Uint8Array(bytes)], `${source.name.replace(/\.[^.]*$/, "")}.png`, { type: "image/png" });
      const descriptor = await (onUpload ? onUpload(file) : uploadMedia(workspaceId!, file));
      if (!owner.active || !pendingRef.current.includes(source)) throw new Error("Attachment draft changed during upload.");
      const replacement = { name: file.name, descriptor: { ...descriptor, filename: file.name }, receivedAt: Date.now() };
      setPending((items) => items.map((item) => item === source ? replacement : item));
      setOriginals((current) => {
        const next = new Map(current);
        next.delete(url);
        next.set(descriptor.url, current.get(url) ?? source);
        return next;
      });
      return asBlob(replacement);
    } finally { if (owner.active) setUploading((count) => count - 1); }
  }, [onUpload, workspaceId, owner]);
  const attachmentActions = useComposerAttachmentSpoilers({ removeAttachment, revertAttachment, uploadEditedAttachment });
  const resolveMediaUrl = useCallback((url: string) => {
    const descriptor = pendingRef.current.find((item) => item.descriptor.url === url)?.descriptor;
    // AnimatePresence retains a removed thumbnail while it exits. Resolve its
    // hash only to the same admitted BFF scope; never load the source origin.
    const media = new URL(url).pathname.match(/^\/media\/([a-f\d]{64})(\.thumb\.jpg|\.[a-z\d]+)$/i);
    const sha256 = descriptor?.sha256 ?? media?.[1];
    if (!sha256) throw new Error("Attachment media reference is invalid.");
    const mediaRef = media?.[2]?.toLowerCase() === ".thumb.jpg" ? `${sha256}.thumb.jpg` : sha256;
    if (onMediaUrl) return onMediaUrl(mediaRef);
    if (!workspaceId) throw new Error("Attachment media scope is unavailable.");
    return mediaUrl(workspaceId, mediaRef);
  }, [workspaceId, onMediaUrl]);
  const fetchMediaBytes = useCallback(async (url: string) => {
    const response = await fetch(resolveMediaUrl(url), { credentials: "same-origin" });
    if (!response.ok) throw new Error(`Attachment read failed (${response.status}).`);
    return new Uint8Array(await response.arrayBuffer());
  }, [resolveMediaUrl]);

  const attach = useCallback(
    async (files: FileList | readonly File[] | null) => {
      for (const file of Array.from(files ?? [])) {
        if (!owner.active) return;
        setUploading((n) => n + 1);
        try {
          if (!onUpload && !workspaceId) throw new Error("Message destination is unavailable.");
          const descriptor = await (onUpload ? onUpload(file) : uploadMedia(workspaceId!, file));
          if (owner.active) setPending((p) => [...p, { name: file.name, descriptor: { ...descriptor, filename: file.name }, receivedAt: Date.now() }]);
        } catch (e) {
          if (!owner.active) return;
          setProblemNeutral(e instanceof ConversationPreparationPending || isOutcomeUnknown(e));
          // 413 是 BFF 侧先行设定的上界，是确定的拒绝；其余是结果不明
          setProblem(
            e instanceof ConversationPreparationPending ? e.message : e instanceof BffError && e.status === 413
              ? t("platform.uploadTooLarge")
              : t("platform.uploadFailed"),
          );
        } finally {
          if (owner.active) setUploading((n) => n - 1);
        }
      }
    },
    [workspaceId, onUpload, owner],
  );

  const [isFormattingOpen, setIsFormattingOpen] = useState(false);
  const sendRef = useRef<() => void>(() => {});
  const onEditLastOwnMessageRef = useRef(onEditLastOwnMessage);
  onEditLastOwnMessageRef.current = onEditLastOwnMessage;
  const editTargetRef = useRef(editTarget);
  editTargetRef.current = editTarget;
  const editLinkRef = useRef<(info: LinkSelectionInfo) => void>(() => {});
  const linkSelectionRef = useRef<(info: LinkSelectionInfo | null) => void>(() => {});
  const linkShortcutRef = useRef<() => boolean>(() => false);
  const autocompleteOpenRef = useRef(mentionPickerOpen);
  autocompleteOpenRef.current = mentionPickerOpen || humanSuggestions.length > 0;
  const pasteBinding = useMentionPasteBinding({
    registerVerifiedMentionPubkey: (label, pubkey) => {
      if (!owner.active) return;
      humanBindings.current.set(label, pubkey);
      trimMapToSize(humanBindings.current, MAX_TRACKED_INTENTS);
      setHumanNames([...humanBindings.current.keys()]);
    },
    verifyMentionIdentities: async (records) => partitionMentionIdentitiesByLocalTrust(records,
      (pubkey) => mentionPeopleRef.current?.filter(person => person.pubkey.toLowerCase() === pubkey)
        .map(person => person.displayName) ?? []).trusted,
  });
  useEffect(() => () => pasteBinding.clearMentionIntents(), [owner, pasteBinding.clearMentionIntents]);
  const richText = useRichTextEditor({
    placeholder: placeholder ?? t("platform.message"), editable: !disabled && !sending,
    restoreFocusOnEnable: () => !compact || Boolean(draft.trim() || pending.length || problem),
    readClipboardText: () => navigator.clipboard.readText(),
    customEmoji,
    mentionNames:humanNames,
    getMentionIdentities:()=>[...humanBindings.current].map(([label,pubkey])=>({label,pubkey})),
    onUpdate: ({ text, cursor }) => {
      setDraft(text); setDraftRevision((value) => value + 1);
      const query=mentionPeople?detectPrefixQuery("@",text,cursor,mentionPeople.map(person=>person.displayName.toLowerCase())):null;
      setHumanQuery(query?{...query,cursor}:null);
    }, onSubmit: () => sendRef.current(),
    onEditLastOwnMessage: () => {
      if (editTargetRef.current) return false;
      const handler = onEditLastOwnMessageRef.current;
      return handler ? handler() : false;
    },
    isAutocompleteOpen: autocompleteOpenRef,
    onEditLink: (info) => editLinkRef.current(info),
    onLinkSelectionChange: (info) => linkSelectionRef.current(info),
    onLinkShortcut: () => linkShortcutRef.current(),
  });
  const selectHuman = (person:MentionSuggestion) => {
    if(disabled||sending||!mentionPeople?.some(candidate=>candidate.pubkey===person.pubkey))return;
    const position=richText.getPlainTextAndCursor();
    const label=selectedMentionLabel(person.displayName,person.pubkey,humanBindings.current);
    pasteBinding.claimMentionIntent(label);
    humanBindings.current.set(label,person.pubkey);
    trimMapToSize(humanBindings.current, MAX_TRACKED_INTENTS);
    setHumanNames([...humanBindings.current.keys()]);
    richText.replacePlainTextRange(humanQuery?.startIndex??position.cursor,humanQuery?.cursor??position.cursor,"@"+label+" ");
    setHumanQuery(null);setHumanIndex(0);
  };
  const openPeople=()=>{
    const position=richText.getPlainTextAndCursor();
    setHumanQuery({query:"",startIndex:position.cursor,cursor:position.cursor});
    richText.editor?.commands.focus();
  };
  const scrollAfterPaste = useCallback(() => {
    const view = richText.editor?.view;
    if (view) view.dispatch(view.state.tr.scrollIntoView());
  }, [richText.editor]);
  useComposerPasteHandler({ editor: richText.editor,
    bindMentionIdentities: pasteBinding.bindPastedMentionIdentities,
    scrollToBottom: scrollAfterPaste, uploadFile: (file) => attach([file]),
  });
  const linkEditor = useLinkEditor(richText, {
    openExternal: (url) => { window.open(url, "_blank", "noopener,noreferrer"); },
    openMessageLink: (link) => { if (onOpenMessageLink) onOpenMessageLink(link); else setProblem(t("platform.linkOpenFromChannel")); },
  });
  editLinkRef.current = linkEditor.openFromClick;
  linkSelectionRef.current = linkEditor.showFromCursor;
  linkShortcutRef.current = linkEditor.openFromShortcut;
  const draftReady = useRef(false);
  const [loadedDraftOwner, setLoadedDraftOwner] = useState<typeof owner | null>(null);
  useEffect(() => {
    if (!richText.editor) return;
    if (draftIdentity && draftKey) initDraftStore(draftIdentity, window.location.origin);
    const saved = draftIdentity && draftKey ? loadDraftEntry(draftKey) : undefined;
    const editableMedia = editTarget ? restoreImetaMediaDisplayLabels(editTarget.body, imetaMediaFromTags(editTarget.tags)) : [];
    const content = saved?.content ?? (editTarget ? stripImetaMediaLines(editTarget.body, editableMedia) : "");
    richText.setContent(content);
    setDraft(content);
    setPending((saved?.pendingImeta ?? editableMedia).map(({ uploaded, ...descriptor }) => ({
      name: descriptor.filename ?? descriptor.sha256,
      receivedAt: uploaded,
      descriptor,
    })));
    intent.current = saved?.sendIntent ?? null;
    setMentionInstallationIds(saved?.mentionInstallationIds ?? []);
    setMentionPickerOpen(false);
    setMentionSelectedIndex(0);
    pasteBinding.clearMentionIntents();
    humanBindings.current = new Map((saved?.mentionRefs ?? []).map(ref => [ref.displayName, ref.pubkey]));
    setHumanNames([...humanBindings.current.keys()]);setHumanQuery(null);
    setSending(false);
    setUploading(0);
    setProblem(null);
    setProblemNeutral(false);
    setDragging(false);
    setOriginals(new Map());
    attachmentActions.setSpoileredAttachmentUrls(new Set(saved?.spoileredAttachmentUrls ?? (editTarget ? findSpoileredImetaMediaUrls(editTarget.body, editableMedia) : [])));
    draftReady.current = Boolean(draftIdentity && draftKey);
    setLoadedDraftOwner(owner);
    return () => { draftReady.current = false; };
  }, [draftIdentity, draftKey, richText.editor, richText.setContent, owner, setMentionSelectedIndex]);
  const persistDraft = useCallback((content: string, attachments: Pending[]) => {
    if (!draftReady.current || !draftKey || !owner.active || loadedDraftOwner !== owner) return;
    if (!content.trim() && attachments.length === 0 && !intent.current) { clearDraftEntry(draftKey); return; }
    const previous = loadDraftEntry(draftKey);
    const timestamp = new Date().toISOString();
    saveDraftEntry(draftKey, {
      content, channelId: workspaceId ?? draftChannelId ?? draftKey, selectionStart: content.length, selectionEnd: content.length,
      createdAt: previous?.createdAt ?? timestamp, updatedAt: timestamp, status: "active",
      pendingImeta: attachments.map(asBlob),
      spoileredAttachmentUrls: [...attachmentActions.spoileredAttachmentUrls], ...(intent.current ? { sendIntent: intent.current } : {}),
      mentionInstallationIds,
      mentionRefs: [...humanBindings.current].map(([displayName, pubkey]) => ({displayName, pubkey})),
    });
  }, [draftKey, workspaceId, draftChannelId, owner, loadedDraftOwner, mentionInstallationIds, attachmentActions.spoileredAttachmentUrls]);
  useEffect(() => { persistDraft(richText.getMarkdown(), pending); }, [draftRevision, pending, persistDraft, richText.getMarkdown]);

  const send = useCallback(async () => {
    if (sending || owner.sending || disabled || uploading > 0 || !mentionVerified) return;
    if (editTarget && onRequestEmptyEditDelete && !richText.getMarkdown().trim() && pending.length === 0) {
      if (!intent.current) onRequestEmptyEditDelete(editTarget);
      else {setProblemNeutral(true);setProblem(t("platform.sendUnknown", {operation: ""}));}
      return;
    }
    owner.sending = true;
    setSending(true);
    try {
    await pasteBinding.settlePendingMentionBindings();
    if (!owner.active) return;
    const content = richText.getMarkdown().trim();
    if (!content && pending.length === 0) return;
    setProblem(null);
    setProblemNeutral(false);
    const attachments = pending.map((p) => ({ ...p.descriptor, spoiler: attachmentActions.spoileredAttachmentUrls.has(p.descriptor.url) }));
    // 不本地插入这条消息：它要等 Relay 接受并回传 event id 才算发出去。
    // 先渲染再等确认，会让一条被拒绝的消息看起来已经发出。草稿与附件也只在
    // 确认后才清空——发送失败时它们都还在。
    let humanMentionPubkeys:string[]=[];
    try {
      const memberCandidates=mentionPeopleRef.current?.map(person=>({...person,isMember:true}))??[];
      humanMentionPubkeys=extractMentionPubkeys({text:content,selectedMentions:humanBindings.current,
        memberCandidates});
      if(humanMentionPubkeys.some(pubkey=>!mentionPeopleRef.current?.some(person=>person.pubkey.toLowerCase()===pubkey)))throw new Error(t("platform.loadFailed"));
      // Freeze typed labels as well as picker selections into the original draft
      // references before publication. Renaming a member must not retarget an
      // UNKNOWN retry; keep the original recipient order in its signature.
      const occurrences=mentionOccurrences(content,mentionMatchCandidates({selectedMentions:humanBindings.current,memberCandidates}));
      for(const pubkey of humanMentionPubkeys) for(const {candidates} of occurrences) {
        for(const candidate of candidates) if(candidate.pubkey===pubkey) humanBindings.current.set(candidate.displayName,pubkey);
      }
    } catch(error) {setProblem(error instanceof AmbiguousMentionError?t("pulse.mentionAmbiguous",{name:error.displayName}):t("platform.loadFailed"));return;}
    const messagePayload = [
      content,
      attachments.map((a) => {
        const metadata = { displayLabel: a.displayLabel, dim: a.dim, blurhash: a.blurhash, thumb: a.thumb, duration: a.duration, image: a.image };
        // Keep the existing signature for legacy attachments with no extended
        // metadata; every newly supported published field is part of intent.
        return [a.sha256, a.filename, a.spoiler, ...(Object.values(metadata).some((value) => value !== undefined) ? [metadata] : [])];
      }),
      mentionInstallationIds,
    ];
    const signature = JSON.stringify([
      ...messagePayload,
      ...(humanMentionPubkeys.length?[humanMentionPubkeys]:[]),
    ]);
    if (intent.current && intent.current.signature !== signature) {
      let unchangedMessage = true;
      try {
        const previous: unknown = JSON.parse(intent.current.signature);
        unchangedMessage = !Array.isArray(previous) || JSON.stringify(previous.slice(0, messagePayload.length)) === JSON.stringify(messagePayload);
      } catch { /* An unreadable unresolved intent is not permission to repeat it. */ }
      if (editTarget || unchangedMessage) {
        // A legacy UNKNOWN draft may lack mentionRefs. Directory refresh alone
        // cannot create a new command or silently change its human recipients.
        setProblemNeutral(true);
        setProblem(t("platform.sendUnknown", {operation: ""}));
        return;
      }
    }
    if (intent.current?.signature !== signature) {
      intent.current = { key: newIntentKey(), signature };
    }
    const key = intent.current.key;
    persistDraft(content, pending);
    const publish = onPublish
      ? onPublish(content, attachments, key, mentionInstallationIds, humanMentionPubkeys)
      : workspaceId
        ? publishMessage(workspaceId, content, attachments, key, mentionInstallationIds, {mentionPubkeys: humanMentionPubkeys}).then((receipt) => {
            if (!receipt?.eventId || !receipt.operationId) throw new TransportError("Message has no confirmed receipt.");
            return receipt;
          })
        : Promise.reject(new Error("Message destination is unavailable."));
    await publish
      .then(() => {
        if (!owner.active) return;
        if (intent.current?.key === key) intent.current = null;
        if (richText.getMarkdown().trim() === content) {
          richText.setContent("");
          setDraft("");
          pasteBinding.clearMentionIntents();
          humanBindings.current.clear();setHumanNames([]);setHumanQuery(null);
        }
        setPending((current) => current.filter((p) => !pending.includes(p)));
        setOriginals((current) => new Map([...current].filter(([url]) => !pending.some((entry) => entry.descriptor.url === url))));
        attachmentActions.setSpoileredAttachmentUrls((current) => new Set([...current].filter((url) => !pending.some((entry) => entry.descriptor.url === url))));
        setMentionInstallationIds((current) => current.filter((id) => !mentionInstallationIds.includes(id)));
        if (editTarget && draftKey) clearDraftEntry(draftKey);
        onConfirmed?.();
        setConfirmedSendRevision((revision) => revision + 1);
      })
      .catch((e: unknown) => {
        if (!owner.active) return;
        setProblemNeutral(e instanceof ConversationPreparationPending || isOutcomeUnknown(e));
        if (e instanceof ConversationPreparationPending) {
          setProblem(e.message);
        } else if (isOutcomeUnknown(e)) {
          // 结果不明（没有回应，或 BFF 明说 UNKNOWN）：可能已送达。不说成功也不说
          // 失败，草稿保留；若消息随后出现在频道里，它就已送达（06 §4、DD-81）
          setProblem(
            t("platform.sendUnknown", {
              operation: e instanceof BffError ? (e.operationId ?? "") : "",
            }),
          );
        } else if (e instanceof BffError && e.reason === ReasonCode.PublishRejected) {
          intent.current = null;
          setProblem(t("platform.sendRejected"));
        } else {
          setProblem(t("platform.sendFailed"));
        }
      });
    } finally {
      owner.sending = false;
      if (owner.active) setSending(false);
    }
  }, [pending, workspaceId, mentionInstallationIds, mentionVerified, sending, uploading, disabled, onPublish, richText.getMarkdown, richText.setContent, owner, persistDraft, attachmentActions.spoileredAttachmentUrls, attachmentActions.setSpoileredAttachmentUrls, editTarget, draftKey, onConfirmed, pasteBinding, onRequestEmptyEditDelete]);
  sendRef.current = send;

  const autoSent = useRef<typeof owner | null>(null);
  useEffect(() => {
    if (!autoSendDraftKey || autoSendDraftKey !== draftKey || autoSent.current === owner ||
        loadedDraftOwner !== owner || !draftReady.current || !owner.active || disabled || sending || uploading > 0 || !mentionVerified ||
        (!richText.getMarkdown().trim() && pending.length === 0)) return;
    autoSent.current = owner;
    if (intent.current) {
      // A restored UNKNOWN intent may predate complete draft metadata. Opening
      // it must not derive a new signature/key and dispatch another effect.
      setProblemNeutral(true);
      setProblem(t("platform.sendUnknown", { operation: "" }));
      return;
    }
    send();
  }, [autoSendDraftKey, draftKey, owner, loadedDraftOwner, disabled, sending, uploading, mentionVerified, pending.length, richText.getMarkdown, send]);

  const ComposerSurface = surface === "forum" ? ForumComposerSurface : MessageComposerSurface;
  return <ComposerSurface
    {...(surface === "forum" ? { compact, confirmedSendRevision,
      hasComposerContent: Boolean(draft.trim() || pending.length || problem || dragging),
      autocompleteOpen: humanSuggestions.length > 0 || mentionPickerOpen,
    } : {})}
    containerClassName={containerClassName}
    header={<>{composerHeader}<ComposerReplyBanner replyTarget={replyTarget} onCancelReply={sending ? undefined : onCancelReply}
      isEditing={editTarget !== undefined} isEditCancelDisabled={sending} onCancelEdit={onCancelEdit} /></>}
    overlays={<>{linkEditor.card}{linkEditor.dialog}</>}
    formProps={{
      onSubmit: (event) => { event.preventDefault(); send(); },
      onPasteCapture: (event) => {
        if (disabled || sending || !event.clipboardData.files.length) return;
        event.preventDefault(); void attach(event.clipboardData.files);
      },
      onDragOver: (event) => { if (!disabled && !sending && event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } },
      onDragLeave: (event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); },
      onDrop: (event) => { setDragging(false); if (!disabled && !sending && event.dataTransfer.files.length) { event.preventDefault(); void attach(event.dataTransfer.files); } },
    }}
    onEditorKeyDown={(event) => {
      if(humanSuggestions.length){
        if(event.key==="Escape"){event.preventDefault();setHumanQuery(null);return;}
        if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();setHumanIndex(index=>(index+(event.key==="ArrowDown"?1:humanSuggestions.length-1))%humanSuggestions.length);return;}
        if((event.key==="Enter"||event.key==="Tab")&&humanSuggestions[humanIndex]){event.preventDefault();selectHuman(humanSuggestions[humanIndex]);return;}
      }
      if (event.key === "Tab" && !event.shiftKey && linkEditor.isCardOpen) {
        event.preventDefault(); linkEditor.focusCardFirstControl();
      }
    }}
    toolbar={{ layoutMode, composerDisabled: disabled || sending, customEmoji,
      extraActions: onCancel ? <Button type="button" variant="ghost" disabled={sending} onClick={onCancel}>{t("platform.cancel")}</Button> : undefined,
      editor: richText.editor, formattingDisabled: disabled || sending, isFormattingOpen,
      isSending: sending, isUploading: uploading > 0,
      onFormattingToggle: setIsFormattingOpen,
      onLinkButton: linkEditor.openFromToolbar,
      onOpenMentionPicker: mentionPeople ? openPeople : workspaceId ? () => setMentionPickerOpen((open) => !open) : undefined,
      onPaperclip: () => picker.current?.click(),
      sendDisabled: disabled || sending || uploading > 0 || !mentionVerified || (!(editTarget && onRequestEmptyEditDelete) && !draft.trim() && pending.length === 0),
    }}>
      {dragging ? <DropZoneOverlay /> : null}
      {mentionPeople?<div className={surface === "forum" ? undefined : "relative"}><PeopleMentionAutocomplete suggestions={humanSuggestions} selectedIndex={humanIndex}
        position={autocompleteBelow ? "below" : "above"}
        composerOwnsFocus={!disabled&&!sending&&humanQuery!==null}
        onSelect={selectHuman} onDismiss={()=>setHumanQuery(null)}/></div>:null}
      {workspaceId !== undefined ? <div className="relative flex flex-wrap items-center gap-2 text-xs">
        <Button type="button" variant="ghost" data-mention-picker-trigger=""
        onKeyDown={(event) => {
          if (!mentionPickerOpen) return;
          if (event.key === "Escape") { event.preventDefault(); setMentionPickerOpen(false); }
          else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setMentionSelectedIndex((current) => Math.max(0, Math.min(suggestions.length - 1,
              current + (event.key === "ArrowDown" ? 1 : -1))));
          } else if (event.key === "Enter" && suggestions[mentionSelectedIndex]) {
            event.preventDefault(); selectMention(suggestions[mentionSelectedIndex]);
          }
        }}
          aria-expanded={mentionPickerOpen}
          onClick={() => setMentionPickerOpen((current) => !current)}
          disabled={sending || installations.isPending || installations.isError}>
          {t("platform.mentionAgent")}
        </Button>
        {mentionInstallationIds.map((id) => <Button key={id} type="button" variant="ghost"
          disabled={sending} aria-pressed="true"
          onClick={() => setMentionInstallationIds((current) => current.filter((value) => value !== id))}>
          {id}<X className="h-3 w-3" aria-hidden="true" />
        </Button>)}
        <MentionAutocomplete suggestions={suggestions} selectedIndex={mentionSelectedIndex}
          composerOwnsFocus={mentionPickerOpen && !sending && installations.isSuccess}
          suggestionKey={(installation) => installation.resourceId}
          suggestionLabel={(installation) => `${t("platform.mentionAgent")} ${installation.resourceId}`}
          renderSuggestion={(installation) => <span className="break-all">{installation.resourceId}</span>}
          onSelect={selectMention} onDismiss={() => setMentionPickerOpen(false)} />
        {installations.hasNextPage ? (
          <Button type="button" variant="ghost" disabled={installations.isFetchingNextPage}
            onClick={() => void installations.fetchNextPage()}>{t("platform.moreMentionAgents")}</Button>
        ) : null}
      </div> : null}
      {installations.isError || !mentionVerified ? (
        <div role="alert">{t("platform.mentionAgentsUnavailable")}</div>
      ) : null}
      {problem ? (
        <div className={problemNeutral ? "text-xs text-muted-foreground" : "text-xs text-destructive"} role={problemNeutral ? "status" : "alert"}>
          {problem}
        </div>
      ) : null}
      <ComposerAttachments attachments={pending.map(asBlob)} resolveMediaUrl={resolveMediaUrl}
        fetchMediaBytes={fetchMediaBytes} isUploading={uploading > 0} uploadingCount={uploading}
        onRemove={attachmentActions.handleRemoveAttachment} onEditSave={attachmentActions.handleAttachmentEditSave}
        onRevert={attachmentActions.handleAttachmentRevert} onToggleSpoiler={attachmentActions.handleToggleAttachmentSpoiler}
        spoileredUrls={attachmentActions.spoileredAttachmentUrls}
        originalUrlByUrl={new Map([...originals].map(([url, entry]) => [url, entry.descriptor.url]))} />
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          data-testid="attach-input"
          disabled={disabled || sending}
          onChange={(e) => {
            void attach(e.target.files);
            e.target.value = "";
          }}
        />
  </ComposerSurface>;
}
