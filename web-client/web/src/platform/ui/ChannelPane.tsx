// 频道（SS-WEB-RELAY、SS-WEB-01）：消息、附件、已读位置。
//
// 全部经 BFF：流、发布、媒体上传与读取、已读写入。这里没有 Relay 地址，也没有
// signer——签名由 BFF 以本人身份代做。

import { AgentTrigger, ReasonCode, type AgentInstallationView, type ReadMarkRequest, type ConversationView, type ConversationParticipant } from "@client-kit/contracts";
import { MentionAutocomplete } from "@client-kit/platform/react/mention-autocomplete";
import { ConversationPreparationPending } from "@client-kit/platform/react/new-message";
import { useMentionSelection } from "@client-kit/platform/react/use-mention-selection";
import { useReasonText } from "@client-kit/platform/react/context";
import { isOutcomeUnknown, TransportError } from "@client-kit/platform/transport";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "@/platform/bff-client";
import { platformQueries } from "@/platform/ui/queries";
import { t } from "@/shared/i18n";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { relativeTime } from "@/shared/lib/relative-time";
import { Button } from "@/shared/ui/button";
import { MessageComposerSurface } from "@client-kit/platform/react/composer/MessageComposerSurface";
import { useRichTextEditor, type LinkSelectionInfo } from "@client-kit/platform/react/composer/features/messages/lib/useRichTextEditor";
import { useLinkEditor } from "@client-kit/platform/react/composer/features/messages/lib/useLinkEditor";
import type { ParsedMessageLink } from "@client-kit/platform/react/composer/features/messages/lib/messageLink";
import { initDraftStore, loadDraftEntry, saveDraftEntry, clearDraftEntry } from "@client-kit/platform/react/composer/features/messages/lib/useDrafts";

const toIso = (unix: number) => new Date(unix * 1_000).toISOString();

/**
 * 断线、续流与重连间隔都由 SSE 协议与服务端决定（见 openStream），这里只把
 * 帧翻成状态。状态只在收到 `live` 时显示为已同步；连接中断期间如实显示为
 * 重连中——结果不明不渲染成成功。
 */
function useChannelStream(workspaceId: string, conversationId?: string) {
  const reasonText = useReasonText();
  const [events, setEvents] = useState<BuzzEvent[]>([]);
  const [status, setStatus] = useState(t("platform.stream.connecting"));
  const [live, setLive] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let closed = false;
    setEvents([]);
    setLive(false);
    setDenied(false);
    setStatus(t("platform.stream.connecting"));
    const stop = openStream(workspaceId, (frame: StreamFrame) => {
      if (closed) return;
      switch (frame.type) {
        case "snapshot":
          setEvents([...frame.events].sort((a, b) => a.created_at - b.created_at));
          break;
        case "event":
          setEvents((prev) =>
            prev.some((e) => e.id === frame.event.id) ? prev : [...prev, frame.event],
          );
          break;
        case "live":
          setLive(true);
          setStatus(t("platform.stream.synced"));
          break;
        case "closed":
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
          setLive(false);
          setStatus(t("platform.stream.reconnecting"));
          break;
        case "ended":
          setLive(false);
          setStatus(t("platform.stream.ended"));
          break;
      }
    }, conversationId);
    return () => {
      closed = true;
      stop();
    };
  }, [workspaceId, conversationId, reasonText]);

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
}: {
  workspaceId: string;
  myPrincipalId: string;
  onReadStateChanged?: () => void | Promise<void>;
  conversation?: ConversationView;
  onOpenMessageLink?: (link: ParsedMessageLink) => void;
  targetMessageId?: string;
}) {
  const queryClient = useQueryClient();
  const { events, status, live, denied } = useChannelStream(workspaceId, conversation?.id);
  const messageList = useRef<HTMLUListElement>(null);
  const anchoredTarget = useRef<string | null>(null);
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

  // 已读：key 是该 Workspace 的 Channel ID，取自消息自身的 h 标签（.design/03）
  const channelId = events
    .find((e) => e.tags.some((tag) => tag[0] === "h"))
    ?.tags.find((tag) => tag[0] === "h")?.[1];
  const lastReadIso = channelId ? userState.data?.readContexts[channelId] : undefined;
  const lastRead = lastReadIso ? Date.parse(lastReadIso) / 1_000 : 0;
  const muted = userState.data?.workspacePreferences[workspaceId]?.muted ?? false;

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
      !visible && !muted && unreadFromOthers > 0 ? `(${unreadFromOthers}) ${title}` : title;
    return () => {
      document.title = title;
    };
  }, [visible, muted, unreadFromOthers]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="text-xs text-muted-foreground" role="status">
        {status}
      </div>
      {read.isError && !denied ? <div role="alert" className="text-sm text-destructive">
        {t(isOutcomeUnknown(read.error) ? "inbox.readUnknown" : "inbox.readUnavailable")}
        <Button disabled={readPending || readRechecking || !live || !visible}
          onClick={() => { void retryRead(); }}>{t("platform.retry")}</Button>
      </div> : null}
      {targetMessageId && live && !events.some((event) => event.id === targetMessageId) ? <p role="status">{t("platform.linkMessageOutsideHistory")}</p> : null}
      <ul ref={messageList} className="min-h-0 flex-1 space-y-2 overflow-auto" aria-label={t("platform.tab.channel")}>
        {events.map((e, i) => {
          const author = byPubkey.get(e.pubkey);
          const firstUnread =
            anchor !== null &&
            e.created_at > anchor &&
            !mine.has(e.pubkey) &&
            !events.slice(0, i).some((p) => p.created_at > anchor && !mine.has(p.pubkey));
          return (
            <li key={e.id} data-event-id={e.id} tabIndex={targetMessageId === e.id ? -1 : undefined} className={targetMessageId === e.id ? "rounded-lg ring-1 ring-ring" : undefined}>
              {firstUnread ? (
                <div className="my-1 border-t border-primary text-xs text-primary">
                  {t("platform.newMessages")}
                </div>
              ) : null}
              <span className="font-medium">{author?.displayName ?? truncatePubkey(e.pubkey)}</span>{" "}
              <span className="text-xs text-muted-foreground" title={toIso(e.created_at)}>
                {relativeTime(e.created_at)}
              </span>
              <MessageContent
                content={e.content}
                mediaTags={e.tags}
                mentions={mentions}
                workspaceId={workspaceId}
                conversationId={conversation?.id}
                onOpenMessageLink={onOpenMessageLink}
              />
            </li>
          );
        })}
      </ul>
      {denied ? null : conversation
        ? <Composer disabled={conversation.state !== "ACTIVE"}
            draftIdentity={myPrincipalId} draftKey={conversation.id} onOpenMessageLink={onOpenMessageLink}
            onPublish={(content, attachments, key) => publishConversationMessage(conversation.id, content, attachments, key)}
            onUpload={(file) => uploadConversationMedia(conversation.id, file)} />
        : <Composer workspaceId={workspaceId} draftIdentity={myPrincipalId} draftKey={workspaceId} onOpenMessageLink={onOpenMessageLink} />}
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

export function Composer({ workspaceId, onPublish, onUpload, disabled = false, placeholder, onOpenMessageLink, draftIdentity, draftKey }: {
  workspaceId?: string;
  onPublish?: (content: string, attachments: readonly MediaDescriptor[], idempotencyKey: string) => Promise<unknown>;
  onUpload?: (file: File) => Promise<MediaDescriptor>;
  disabled?: boolean;
  placeholder?: string;
  onOpenMessageLink?: (link: ParsedMessageLink) => void;
  draftIdentity?: string;
  draftKey?: string;
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
    richText.setContent(saved?.content ?? "");
    setDraft(saved?.content ?? "");
    setPending((saved?.pendingImeta ?? []).map(({ uploaded, filename, sha256, size, type, url }) => ({
        name: filename ?? sha256, receivedAt: uploaded, descriptor: { sha256, size, type, url },
    })));
    intent.current = saved?.sendIntent ?? null;
    setMentionInstallationIds(saved?.mentionInstallationIds ?? []);
    setMentionPickerOpen(false);
    setMentionSelectedIndex(0);
    setSending(false);
    setUploading(0);
    setProblem(null);
    setProblemNeutral(false);
    draftReady.current = Boolean(draftIdentity && draftKey);
    setLoadedDraftOwner(owner);
    return () => { draftReady.current = false; };
  }, [draftIdentity, draftKey, richText.editor, richText.setContent, owner, setMentionSelectedIndex]);
  const persistDraft = useCallback((content: string, attachments: Pending[]) => {
    if (!draftReady.current || !draftKey || !owner.active || loadedDraftOwner !== owner) return;
    if (!content.trim() && attachments.length === 0) { clearDraftEntry(draftKey); return; }
    const previous = loadDraftEntry(draftKey);
    const timestamp = new Date().toISOString();
    saveDraftEntry(draftKey, {
      content, channelId: workspaceId ?? draftKey, selectionStart: content.length, selectionEnd: content.length,
      createdAt: previous?.createdAt ?? timestamp, updatedAt: timestamp, status: "active",
      pendingImeta: attachments.map(({ descriptor, name, receivedAt }) => ({ ...descriptor, filename: name, uploaded: receivedAt })),
      spoileredAttachmentUrls: [], ...(intent.current ? { sendIntent: intent.current } : {}),
      mentionInstallationIds,
    });
  }, [draftKey, workspaceId, owner, loadedDraftOwner, mentionInstallationIds]);
  useEffect(() => { persistDraft(richText.getMarkdown(), pending); }, [draftRevision, pending, persistDraft, richText.getMarkdown]);

  const send = useCallback(() => {
    if (sending || disabled || uploading > 0 || !mentionVerified) return;
    const content = richText.getMarkdown().trim();
    if (!content && pending.length === 0) return;
    setProblem(null);
    setProblemNeutral(false);
    const attachments = pending.map((p) => p.descriptor);
    // 不本地插入这条消息：它要等 Relay 接受并回传 event id 才算发出去。
    // 先渲染再等确认，会让一条被拒绝的消息看起来已经发出。草稿与附件也只在
    // 确认后才清空——发送失败时它们都还在。
    const signature = JSON.stringify([
      content,
      attachments.map((a) => a.sha256),
      mentionInstallationIds,
    ]);
    if (intent.current?.signature !== signature) {
      intent.current = { key: newIntentKey(), signature };
    }
    const key = intent.current.key;
    persistDraft(content, pending);
    setSending(true);
    const publish = onPublish
      ? onPublish(content, attachments, key)
      : workspaceId
        ? publishMessage(workspaceId, content, attachments, key, mentionInstallationIds)
        : Promise.reject(new Error("Message destination is unavailable."));
    void publish
      .then(() => {
        if (!owner.active) return;
        if (intent.current?.key === key) intent.current = null;
        if (richText.getMarkdown().trim() === content) {
          richText.setContent("");
          setDraft("");
        }
        setPending((current) => current.filter((p) => !attachments.includes(p.descriptor)));
        setMentionInstallationIds((current) => current.filter((id) => !mentionInstallationIds.includes(id)));
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
  }, [pending, workspaceId, mentionInstallationIds, mentionVerified, sending, uploading, disabled, onPublish, richText.getMarkdown, richText.setContent, owner, persistDraft]);
  sendRef.current = send;

  return <MessageComposerSurface
    overlays={<>{linkEditor.card}{linkEditor.dialog}</>}
    formProps={{
      onSubmit: (event) => { event.preventDefault(); send(); },
      onPasteCapture: (event) => {
        if (disabled || sending || !event.clipboardData.files.length) return;
        event.preventDefault(); void attach(event.clipboardData.files);
      },
      onDragOver: (event) => { if (!disabled && !sending && event.dataTransfer.types.includes("Files")) event.preventDefault(); },
      onDrop: (event) => { if (!disabled && !sending && event.dataTransfer.files.length) { event.preventDefault(); void attach(event.dataTransfer.files); } },
    }}
    onEditorKeyDown={(event) => {
      if (event.key === "Tab" && !event.shiftKey && linkEditor.isCardOpen) {
        event.preventDefault(); linkEditor.focusCardFirstControl();
      }
    }}
    toolbar={{ layoutMode: "standalone", composerDisabled: disabled || sending,
      editor: richText.editor, formattingDisabled: disabled || sending, isFormattingOpen,
      isSending: sending, isUploading: uploading > 0,
      onFormattingToggle: setIsFormattingOpen,
      onLinkButton: linkEditor.openFromToolbar,
      onOpenMentionPicker: workspaceId ? () => setMentionPickerOpen((open) => !open) : undefined,
      onPaperclip: () => picker.current?.click(),
      sendDisabled: disabled || sending || uploading > 0 || !mentionVerified || (!draft.trim() && pending.length === 0),
    }}>
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
      {pending.length > 0 || uploading > 0 ? (
        <ul className="flex flex-wrap gap-2 text-xs" aria-label={t("platform.attachments")}>
          {pending.map((p) => (
            <li
              key={p.descriptor.sha256}
              className="flex items-center gap-1 rounded border px-2 py-0.5"
            >
              {p.name}
              <button
                type="button"
                aria-label={`${t("platform.removeAttachment")} ${p.name}`}
                onClick={() => setPending((cur) => cur.filter((x) => x !== p))}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
          {uploading > 0 ? (
            <li className="text-muted-foreground">{t("platform.uploading")}</li>
          ) : null}
        </ul>
      ) : null}
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
  </MessageComposerSurface>;
}
