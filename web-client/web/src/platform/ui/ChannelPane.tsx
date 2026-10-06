// 频道（SS-WEB-RELAY、SS-WEB-01）：消息、附件、已读位置。
//
// 全部经 BFF：流、发布、媒体上传与读取、已读写入。这里没有 Relay 地址，也没有
// signer——签名由 BFF 以本人身份代做。

import { AgentTrigger, ReasonCode, type AgentInstallationView, type ReadMarkRequest, type ConversationView, type ConversationParticipant, type WorkspaceMemberView } from "@client-kit/contracts";
import { MentionAutocomplete } from "@client-kit/platform/react/mention-autocomplete";
import { ConversationPreparationPending, useConversationInvalidation } from "@client-kit/platform/react/new-message";
import { useMentionSelection } from "@client-kit/platform/react/use-mention-selection";
import { useReasonText } from "@client-kit/platform/react/context";
import { isOutcomeUnknown, TransportError } from "@client-kit/platform/transport";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useBrowserNotifications } from "./BrowserNotifications";
import { MessageContent, type MessageMention } from "@/features/chat/ui/MessageContent";
import {
  BffError,
  bff,
  type BuzzEvent,
  type MediaDescriptor,
  markRead,
  openStream,
  publishMessage,
  publishConversationMessage,
  uploadConversationMedia,
  type StreamFrame,
  uploadMedia,
  mediaUrl,
} from "@/platform/bff-client";
import { platformQueries } from "@/platform/ui/queries";
import { t } from "@/shared/i18n";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { toast } from "sonner";
import { MessageRowSurface, MessageActionBarSurface, DayDivider, UnreadDivider, formatDayGroupLabel, isSameDay, hasSameMessageAuthor, isWithinGroupingWindow, startsNewMessageGroup, getThreadReference, type TimelineMessage } from "@client-kit/platform/react/messages";
import { buildMessageLink } from "@client-kit/platform/react/composer/features/messages/lib/messageLink";
import { buildMentionClipboardHtml } from "@client-kit/platform/react/composer/features/messages/lib/mentionClipboard";
import { Button } from "@/shared/ui/button";
import { MessageComposerSurface } from "@client-kit/platform/react/composer/MessageComposerSurface";
import { ChannelThreadPane } from "./ChannelThreadPane";
import { ComposerReplyBanner } from "@client-kit/platform/react/messages";
import { applyMessageEdits, imetaMediaFromTags, restoreImetaMediaDisplayLabels, stripImetaMediaLines, findSpoileredImetaMediaUrls } from "@client-kit/platform/react/messages";
import { ForumComposerSurface } from "@client-kit/platform/react/forum/ForumComposerSurface";
import { useRichTextEditor, type LinkSelectionInfo } from "@client-kit/platform/react/composer/features/messages/lib/useRichTextEditor";
import { useLinkEditor } from "@client-kit/platform/react/composer/features/messages/lib/useLinkEditor";
import type { ParsedMessageLink } from "@client-kit/platform/react/composer/features/messages/lib/messageLink";
import { initDraftStore, loadDraftEntry, saveDraftEntry, clearDraftEntry } from "@client-kit/platform/react/composer/features/messages/lib/useDrafts";
import { ComposerAttachments, DropZoneOverlay } from "@client-kit/platform/react/composer/features/messages/ui/ComposerAttachments";
import { useComposerAttachmentSpoilers } from "@client-kit/platform/react/composer/features/messages/ui/useComposerAttachmentSpoilers";
import type { ImetaMedia } from "@client-kit/platform/react/composer/features/messages/lib/imetaMediaMarkdown";

const toIso = (unix: number) => new Date(unix * 1_000).toISOString();

/**
 * 断线、续流与重连间隔都由 SSE 协议与服务端决定（见 openStream），这里只把
 * 帧翻成状态。状态只在收到 `live` 时显示为已同步；连接中断期间如实显示为
 * 重连中——结果不明不渲染成成功。
 */
function useChannelStream(workspaceId: string, conversationId?: string, onLiveEvent?: (event: BuzzEvent) => void, onClosed?: () => void, archived = false) {
  const reasonText = useReasonText();
  const [events, setEvents] = useState<BuzzEvent[]>([]);
  const [status, setStatus] = useState(t("platform.stream.connecting"));
  const [live, setLive] = useState(false);
  const [denied, setDenied] = useState(false);
  const seen = useRef(new Set<string>());
  const receiveLive = useEffectEvent((event: BuzzEvent) => onLiveEvent?.(event));
  const refreshMetadata = useEffectEvent(() => onClosed?.());

  useEffect(() => {
    if (archived) {
      setLive(false);
      setStatus(t("channel.archived"));
      return;
    }
    let closed = false;
    let ready = false;
    setEvents([]);
    setLive(false);
    setDenied(false);
    setStatus(t("platform.stream.connecting"));
    const stop = openStream(workspaceId, (frame: StreamFrame) => {
      if (closed) return;
      switch (frame.type) {
        case "snapshot":
          ready = false;
          for (const event of frame.events) seen.current.add(event.id);
          setEvents([...frame.events].sort((a, b) => a.created_at - b.created_at));
          break;
        case "event":
          if (!seen.current.has(frame.event.id)) {
            seen.current.add(frame.event.id);
            if (ready) receiveLive(frame.event);
          }
          setEvents((prev) =>
            prev.some((e) => e.id === frame.event.id) ? prev : [...prev, frame.event],
          );
          break;
        case "live":
          ready = true;
          setLive(true);
          setStatus(t("platform.stream.synced"));
          break;
        case "closed":
          ready = false;
          refreshMetadata();
          setLive(false);
          if (
            frame.reason === "session-revoked" ||
            frame.reason === "scope-revoked" ||
            frame.reason === "identity-revoked"
          ) {
            closed = true;
            setDenied(true);
            setEvents([]);
            setStatus(
              reasonText(
                frame.reason === "session-revoked"
                  ? ReasonCode.SessionNotActive
                  : ReasonCode.PermissionDenied,
              ),
            );
          } else {
            setStatus(`${t("platform.stream.reconnecting")}（${frame.reason}）`);
          }
          break;
        case "interrupted":
          ready = false;
          setLive(false);
          setStatus(t("platform.stream.reconnecting"));
          break;
        case "ended":
          ready = false;
          setLive(false);
          setStatus(t("platform.stream.ended"));
          break;
      }
    }, conversationId);
    return () => {
      closed = true;
      stop();
    };
  }, [workspaceId, conversationId, reasonText, archived]);

  return { events, status, live, denied };
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
  myPrincipalId,
  onReadStateChanged,
  conversation,
  onOpenMessageLink,
  targetMessageId,
  autoSendDraftKey,
  archived = false,
  metadataPending = false,
  restoreEditEventId,
}: {
  workspaceId: string;
  myPrincipalId: string;
  onReadStateChanged?: () => void | Promise<void>;
  conversation?: ConversationView;
  onOpenMessageLink?: (link: ParsedMessageLink) => void;
  targetMessageId?: string;
  autoSendDraftKey?: string;
  archived?: boolean;
  metadataPending?: boolean;
  restoreEditEventId?: string;
}) {
  const queryClient = useQueryClient();
  const notifications = useBrowserNotifications();
  const { events: rawEvents, status, live, denied } = useChannelStream(workspaceId, conversation?.id, (event) => receiveNotification(event), () => {
    if (!conversation) void queryClient.invalidateQueries({ queryKey: ["platform", "channel-descriptor", myPrincipalId, workspaceId] });
  }, archived);
  const events = useMemo(() => applyMessageEdits(rawEvents.filter((event) => event.kind === 9), rawEvents), [rawEvents]);
  const ownProfile = useQuery({ queryKey: ["platform", "edit-author", myPrincipalId], queryFn: () => bff.profile() });
  const [editTarget, setEditTarget] = useState<TimelineMessage | null>(null);
  const [composerBusy, setComposerBusy] = useState(false);
  const restoredEdit = useRef(false);
  const messageList = useRef<HTMLUListElement>(null);
  const anchoredTarget = useRef<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<TimelineMessage | null>(null);
  useEffect(() => {
    if (!targetMessageId || anchoredTarget.current === targetMessageId) return;
    const target = [...(messageList.current?.children ?? [])].find((item) => item.getAttribute("data-event-id") === targetMessageId);
    if (target instanceof HTMLElement) { target.scrollIntoView({ block: "center" }); target.focus({ preventScroll: true }); anchoredTarget.current = targetMessageId; }
  }, [targetMessageId, events]);
  const visible = useVisible();
  const members = useQuery({
    queryKey: ["platform", conversation ? "conversation-members" : "members", workspaceId],
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
  const mentions: MessageMention[] = useMemo(
    () =>
      (members.data ?? []).flatMap((m) =>
        m.pubkeys.length > 0
          ? [{ pubkey: m.pubkeys[0] as string, name: m.displayName, isAgent: false }]
          : [],
      ),
    [members.data],
  );
  const mine = useMemo(
    () => new Set((members.data ?? []).find((m) => m.principalId === myPrincipalId)?.pubkeys),
    [members.data, myPrincipalId],
  );
  const timelineMessages = useMemo<TimelineMessage[]>(() => events.map((event) => ({
    id: event.id, createdAt: event.created_at, pubkey: event.pubkey,
    signerPubkey: event.pubkey, author: byPubkey.get(event.pubkey)?.displayName ?? truncatePubkey(event.pubkey),
    body: event.content, tags: event.tags, kind: event.kind, time: "", depth: 0,
  })), [events, byPubkey]);
  useEffect(() => {
    if (!restoreEditEventId || restoredEdit.current || !ownProfile.isSuccess) return;
    const message = timelineMessages.find((item) => item.id === restoreEditEventId && item.signerPubkey === ownProfile.data.pubkey);
    if (message) { restoredEdit.current = true; setEditTarget(message); }
  }, [restoreEditEventId, timelineMessages, ownProfile.isSuccess, ownProfile.data]);
  const copyMessage = async (message: TimelineMessage) => {
    const taggedKeys = new Set(message.tags?.filter((tag) => tag[0] === "p").map((tag) => tag[1]));
    const identities = (members.data ?? []).flatMap((member) => member.pubkeys.filter((key) => taggedKeys.has(key)).map((pubkey) => ({ pubkey, label: member.displayName })));
    const html = buildMentionClipboardHtml({ identities, text: message.body });
    try {
    await (html && typeof ClipboardItem !== "undefined"
      ? navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([message.body], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })])
      : navigator.clipboard.writeText(message.body));
    toast.success(t("buzz.copiedMessage"));
    } catch { toast.error(t("buzz.copyFailed")); }
  };

  // 已读：key 是该 Workspace 的 Channel ID，取自消息自身的 h 标签（.design/03）
  const channelId = events
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
    if (event.kind !== 9 || denied || !members.isSuccess || members.isFetching || !userState.isSuccess || userState.isFetching || userState.isError ||
      mine.size === 0 || mine.has(event.pubkey)) return;
    const mentioned = event.tags.some((tag) => tag[0] === "p" && mine.has(tag[1] ?? ""));
    const thread = getThreadReference(event.tags);
    const participated = thread.rootId !== null && events.some((prior) => mine.has(prior.pubkey) &&
      (prior.id === thread.rootId || getThreadReference(prior.tags).rootId === thread.rootId));
    // Original mention precedence and thread-participation semantics. Ordinary
    // channel activity is not falsely promoted into a desktop alert.
    if (!mentioned && (muted || !participated || !thread.parentId)) return;
    notifications?.notify({ eventId: event.id, title: byPubkey.get(event.pubkey)?.displayName ?? t("platform.title"),
      body: event.content, slot: mentioned ? "mention" : "thread_reply",
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
    (e) => e.created_at > lastRead && !mine.has(e.pubkey),
  ).length;
  const newest = events[events.length - 1];

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
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="text-xs text-muted-foreground" role="status">
        {status}
      </div>
      {read.isError && !denied ? <div role="alert" className="text-sm text-destructive">
        {t(isOutcomeUnknown(read.error) ? "inbox.readUnknown" : "inbox.readUnavailable")}
        <Button disabled={readPending || readRechecking || !live || !visible}
          onClick={() => { void retryRead(); }}>{t("platform.retry")}</Button>
      </div> : null}
      {targetMessageId && live && !events.some((event) => event.id === targetMessageId) ? <p role="status">{t("platform.linkMessageOutsideHistory")}</p> : null}
      <ul ref={messageList} className="min-h-0 flex-1 overflow-auto" aria-label={t("platform.tab.channel")}>
        {timelineMessages.map((message, i) => {
          const previous = timelineMessages[i - 1];
          const next = timelineMessages[i + 1];
          const firstUnread =
            anchor !== null &&
            message.createdAt > anchor &&
            !mine.has(message.pubkey ?? "") &&
            !events.slice(0, i).some((p) => p.created_at > anchor && !mine.has(p.pubkey));
          const newDay = !previous || !isSameDay(previous.createdAt, message.createdAt);
          const isContinuation = !newDay && !firstUnread && !startsNewMessageGroup(message) && hasSameMessageAuthor(previous, message) && isWithinGroupingWindow(previous?.createdAt, message.createdAt);
          const followedByContinuation = next && isSameDay(message.createdAt, next.createdAt) && !startsNewMessageGroup(next) && hasSameMessageAuthor(message, next) && isWithinGroupingWindow(message.createdAt, next.createdAt);
          return (
            <li key={message.id} data-event-id={message.id} tabIndex={targetMessageId === message.id ? -1 : undefined}>
              {newDay ? <DayDivider label={formatDayGroupLabel(message.createdAt)} sticky={false} /> : null}
              {firstUnread ? <UnreadDivider /> : null}
              <div className={`flex flex-col gap-1 ${followedByContinuation ? "pb-0" : "pb-2.5"}`}>
              <MessageRowSurface message={message} isContinuation={isContinuation} showDepthGuides={false} highlighted={targetMessageId === message.id}
                renderActions={(ref) => <MessageActionBarSurface ref={ref} message={message} onCopyMessage={copyMessage}
                  onEdit={message.kind === 9 && live && !denied && !archived && !metadataPending && !composerBusy && ownProfile.isSuccess && !ownProfile.isFetching && message.signerPubkey === ownProfile.data.pubkey ? setEditTarget : undefined}
                  onReply={!conversation && message.kind === 9 && live && !denied && !archived && !metadataPending ? setReplyTarget : undefined}
                  onCopyLink={copyMessageLink} />}
                renderBody={(className) => <div className={className}><MessageContent
                content={message.body}
                mediaTags={message.tags}
                mentions={mentions}
                workspaceId={workspaceId}
                conversationId={conversation?.id}
                onOpenMessageLink={onOpenMessageLink}
              /></div>} />
              </div>
            </li>
          );
        })}
      </ul>
      {restoreEditEventId && live && !editTarget && !events.some((event) => event.id === restoreEditEventId) ? <p role="status">{t("platform.linkMessageOutsideHistory")}</p> : null}
      {!denied && editTarget ? <Composer key={`edit:${editTarget.id}`} workspaceId={conversation ? undefined : workspaceId}
        editTarget={editTarget} onCancelEdit={() => setEditTarget(null)} onConfirmed={() => setEditTarget(null)} draftIdentity={myPrincipalId}
        draftKey={`edit:${workspaceId}:${editTarget.id}`} draftChannelId={workspaceId}
        autoSendDraftKey={autoSendDraftKey}
        disabled={denied || !live || archived || metadataPending || !ownProfile.isSuccess || ownProfile.isFetching || ownProfile.data.pubkey !== editTarget.signerPubkey}
        onSendingChange={setComposerBusy} onOpenMessageLink={onOpenMessageLink}
        onUpload={conversation ? (file) => uploadConversationMedia(conversation.id, file) : undefined}
        onMediaUrl={conversation ? (sha) => mediaUrl(conversation.id, sha, conversation.id) : undefined}
        onPublish={async (content, attachments, key, mentions) => {
          const receipt = await (conversation ? publishConversationMessage(conversation.id, content, attachments, key, editTarget.id)
            : publishMessage(workspaceId, content, attachments, key, mentions, {editEventId: editTarget.id}));
          if (!receipt?.eventId || !receipt.operationId) throw new TransportError("Message edit has no confirmed receipt.");
          return receipt;
        }} /> : null}
      <div hidden={editTarget !== null}>
      {denied ? null : conversation
        ? <Composer disabled={conversation.state !== "ACTIVE"} onSendingChange={setComposerBusy}
            draftIdentity={myPrincipalId} draftKey={conversation.id} autoSendDraftKey={autoSendDraftKey} onOpenMessageLink={onOpenMessageLink}
            onPublish={(content, attachments, key) => publishConversationMessage(conversation.id, content, attachments, key)}
            onMediaUrl={(sha256) => mediaUrl(conversation.id, sha256, conversation.id)}
            onUpload={(file) => uploadConversationMedia(conversation.id, file)} />
        : <>{archived ? <p role="status">{t("channel.archived")}</p> : null}<Composer
            disabled={archived || metadataPending}
            onSendingChange={setComposerBusy}
            workspaceId={workspaceId} draftIdentity={myPrincipalId} draftKey={workspaceId}
            autoSendDraftKey={autoSendDraftKey} onOpenMessageLink={onOpenMessageLink} /></>}
      </div>
    </div>
    {!conversation && replyTarget ? <ChannelThreadPane key={`${myPrincipalId}:${workspaceId}:${getThreadReference(replyTarget.tags ?? []).rootId ?? replyTarget.id}`}
      workspaceId={workspaceId} principalId={myPrincipalId} selected={replyTarget}
      members={(members.data ?? []).filter((member): member is WorkspaceMemberView => "state" in member)} disabled={archived || metadataPending || denied || !live}
      onClose={() => setReplyTarget(null)} onCopyMessage={copyMessage} onCopyLink={copyMessageLink} /> : null}
    </div>
  );
}

type Pending = { name: string; descriptor: MediaDescriptor; receivedAt: number; nativeMetadata?: ImetaMedia };

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

export function Composer({ workspaceId, onPublish, onUpload, onMediaUrl, disabled = false, placeholder, onOpenMessageLink, draftIdentity, draftKey, surface = "stream", onCancel, autoSendDraftKey, replyTarget, onCancelReply, containerClassName, layoutMode = "standalone", onSendingChange, editTarget, onCancelEdit, onConfirmed, draftChannelId }: {
  editTarget?: TimelineMessage;
  onCancelEdit?: () => void;
  onConfirmed?: () => void;
  draftChannelId?: string;
  surface?: "stream" | "forum";
  workspaceId?: string;
  onPublish?: (content: string, attachments: readonly MediaDescriptor[], idempotencyKey: string, mentionInstallationIds: string[]) => Promise<unknown>;
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
  const owner = useMemo(() => ({ active: true }), [workspaceId, draftIdentity, draftKey]);
  useEffect(() => { owner.active = true; return () => { owner.active = false; }; }, [owner]);
  const asBlob = (entry: Pending): ImetaMedia => ({ ...entry.nativeMetadata, ...entry.descriptor, filename: entry.name, uploaded: entry.receivedAt });
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
      const replacement = { name: file.name, descriptor, receivedAt: Date.now() };
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
    const sha256 = descriptor?.sha256 ?? new URL(url).pathname.match(/^\/media\/([a-f\d]{64})\.[a-z\d]+$/i)?.[1];
    if (!sha256) throw new Error("Attachment media reference is invalid.");
    if (onMediaUrl) return onMediaUrl(sha256);
    if (!workspaceId) throw new Error("Attachment media scope is unavailable.");
    return mediaUrl(workspaceId, sha256);
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
          if (owner.active) setPending((p) => [...p, { name: file.name, descriptor, receivedAt: Date.now() }]);
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
  const editLinkRef = useRef<(info: LinkSelectionInfo) => void>(() => {});
  const linkSelectionRef = useRef<(info: LinkSelectionInfo | null) => void>(() => {});
  const linkShortcutRef = useRef<() => boolean>(() => false);
  const autocompleteOpenRef = useRef(mentionPickerOpen);
  autocompleteOpenRef.current = mentionPickerOpen;
  const richText = useRichTextEditor({
    placeholder: placeholder ?? t("platform.message"), editable: !disabled && !sending,
    readClipboardText: () => navigator.clipboard.readText(),
    onUpdate: ({ text }) => { setDraft(text); setDraftRevision((value) => value + 1); }, onSubmit: () => sendRef.current(),
    isAutocompleteOpen: autocompleteOpenRef,
    onEditLink: (info) => editLinkRef.current(info),
    onLinkSelectionChange: (info) => linkSelectionRef.current(info),
    onLinkShortcut: () => linkShortcutRef.current(),
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
    setPending((saved?.pendingImeta ?? editableMedia).map((media) => ({
      name: media.filename ?? media.sha256,
      receivedAt: media.uploaded,
      descriptor: { sha256: media.sha256, size: media.size, type: media.type, url: media.url },
      nativeMetadata: media,
    })));
    intent.current = saved?.sendIntent ?? null;
    setMentionInstallationIds(saved?.mentionInstallationIds ?? []);
    setMentionPickerOpen(false);
    setMentionSelectedIndex(0);
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
    });
  }, [draftKey, workspaceId, draftChannelId, owner, loadedDraftOwner, mentionInstallationIds, attachmentActions.spoileredAttachmentUrls]);
  useEffect(() => { persistDraft(richText.getMarkdown(), pending); }, [draftRevision, pending, persistDraft, richText.getMarkdown]);

  const send = useCallback(() => {
    if (sending || disabled || uploading > 0 || !mentionVerified) return;
    const content = richText.getMarkdown().trim();
    if (!content && pending.length === 0) return;
    setProblem(null);
    setProblemNeutral(false);
    const attachments = pending.map((p) => ({ ...p.descriptor, filename: p.name, spoiler: attachmentActions.spoileredAttachmentUrls.has(p.descriptor.url) }));
    // 不本地插入这条消息：它要等 Relay 接受并回传 event id 才算发出去。
    // 先渲染再等确认，会让一条被拒绝的消息看起来已经发出。草稿与附件也只在
    // 确认后才清空——发送失败时它们都还在。
    const signature = JSON.stringify([
      content,
      attachments.map((a) => [a.sha256, a.filename, a.spoiler]),
      mentionInstallationIds,
    ]);
    if (editTarget && intent.current && intent.current.signature !== signature) {
      // An earlier edit may already exist on the Relay. Changing its payload
      // cannot silently replace that unresolved intent with a fresh command.
      setProblemNeutral(true);
      setProblem(t("platform.sendUnknown", {operation: ""}));
      return;
    }
    if (intent.current?.signature !== signature) {
      intent.current = { key: newIntentKey(), signature };
    }
    const key = intent.current.key;
    persistDraft(content, pending);
    setSending(true);
    const publish = onPublish
      ? onPublish(content, attachments, key, mentionInstallationIds)
      : workspaceId
        ? publishMessage(workspaceId, content, attachments, key, mentionInstallationIds).then((receipt) => {
            if (!receipt?.eventId || !receipt.operationId) throw new TransportError("Message has no confirmed receipt.");
            return receipt;
          })
        : Promise.reject(new Error("Message destination is unavailable."));
    void publish
      .then(() => {
        if (!owner.active) return;
        if (intent.current?.key === key) intent.current = null;
        if (richText.getMarkdown().trim() === content) {
          richText.setContent("");
          setDraft("");
        }
        setPending((current) => current.filter((p) => !pending.includes(p)));
        setOriginals((current) => new Map([...current].filter(([url]) => !pending.some((entry) => entry.descriptor.url === url))));
        attachmentActions.setSpoileredAttachmentUrls((current) => new Set([...current].filter((url) => !pending.some((entry) => entry.descriptor.url === url))));
        setMentionInstallationIds((current) => current.filter((id) => !mentionInstallationIds.includes(id)));
        if (editTarget && draftKey) clearDraftEntry(draftKey);
        onConfirmed?.();
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
      })
      .finally(() => { if (owner.active) setSending(false); });
  }, [pending, workspaceId, mentionInstallationIds, mentionVerified, sending, uploading, disabled, onPublish, richText.getMarkdown, richText.setContent, owner, persistDraft, attachmentActions.spoileredAttachmentUrls, attachmentActions.setSpoileredAttachmentUrls, editTarget, draftKey, onConfirmed]);
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
    containerClassName={containerClassName}
    header={<ComposerReplyBanner replyTarget={replyTarget} onCancelReply={sending ? undefined : onCancelReply}
      isEditing={editTarget !== undefined} isEditCancelDisabled={sending} onCancelEdit={onCancelEdit} />}
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
      if (event.key === "Tab" && !event.shiftKey && linkEditor.isCardOpen) {
        event.preventDefault(); linkEditor.focusCardFirstControl();
      }
    }}
    toolbar={{ layoutMode, composerDisabled: disabled || sending,
      extraActions: onCancel ? <Button type="button" variant="ghost" disabled={sending} onClick={onCancel}>{t("platform.cancel")}</Button> : undefined,
      editor: richText.editor, formattingDisabled: disabled || sending, isFormattingOpen,
      isSending: sending, isUploading: uploading > 0,
      onFormattingToggle: setIsFormattingOpen,
      onLinkButton: linkEditor.openFromToolbar,
      onOpenMentionPicker: workspaceId ? () => setMentionPickerOpen((open) => !open) : undefined,
      onPaperclip: () => picker.current?.click(),
      sendDisabled: disabled || sending || uploading > 0 || !mentionVerified || (!draft.trim() && pending.length === 0),
    }}>
      {dragging ? <DropZoneOverlay /> : null}
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
