// 频道（SS-WEB-RELAY、SS-WEB-01）：消息、附件、已读位置。
//
// 全部经 BFF：流、发布、媒体上传与读取、已读写入。这里没有 Relay 地址，也没有
// signer——签名由 BFF 以本人身份代做。

import { ReasonCode } from "@kailo/contracts";
import { isOutcomeUnknown } from "@kailo/platform/transport";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageContent, type MessageMention } from "@/features/chat/ui/MessageContent";
import {
  BffError,
  type BuzzEvent,
  type MediaDescriptor,
  markRead,
  openStream,
  publishMessage,
  type StreamFrame,
  uploadMedia,
} from "@/platform/bff-client";
import { platformQueries } from "@/platform/ui/queries";
import { t } from "@/shared/i18n";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { relativeTime } from "@/shared/lib/relative-time";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

const toIso = (unix: number) => new Date(unix * 1_000).toISOString();

/**
 * 断线、续流与重连间隔都由 SSE 协议与服务端决定（见 openStream），这里只把
 * 帧翻成状态。状态只在收到 `live` 时显示为已同步；连接中断期间如实显示为
 * 重连中——结果不明不渲染成成功。
 */
function useChannelStream(workspaceId: string) {
  const [events, setEvents] = useState<BuzzEvent[]>([]);
  const [status, setStatus] = useState(t("platform.stream.connecting"));
  const [live, setLive] = useState(false);

  useEffect(() => {
    let closed = false;
    setEvents([]);
    setLive(false);
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
          setStatus(
            frame.reason === "session-revoked"
              ? t("platform.stream.revoked")
              : `${t("platform.stream.reconnecting")}（${frame.reason}）`,
          );
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
    });
    return () => {
      closed = true;
      stop();
    };
  }, [workspaceId]);

  return { events, status, live };
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
}: {
  workspaceId: string;
  myPrincipalId: string;
}) {
  const queryClient = useQueryClient();
  const { events, status, live } = useChannelStream(workspaceId);
  const visible = useVisible();
  const members = useQuery(platformQueries.members(workspaceId));
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

  const read = useMutation({
    mutationFn: markRead,
    // 成功或冲突都重新取状态：冲突说明别的端先写了，拿新版本再比一次
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: platformQueries.userState.queryKey }),
  });
  const readPending = read.isPending;
  const readMutate = read.mutate;
  useEffect(() => {
    if (!live || !visible || !channelId || !newest || !userState.data || readPending) return;
    if (newest.created_at <= lastRead) return;
    readMutate({
      contextKey: channelId,
      lastReadAt: toIso(newest.created_at),
      version: userState.data.version,
    });
  }, [live, visible, channelId, newest, lastRead, userState.data, readPending, readMutate]);

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
      <ul className="min-h-0 flex-1 space-y-2 overflow-auto" aria-label={t("platform.tab.channel")}>
        {events.map((e, i) => {
          const author = byPubkey.get(e.pubkey);
          const firstUnread =
            anchor !== null &&
            e.created_at > anchor &&
            !mine.has(e.pubkey) &&
            !events.slice(0, i).some((p) => p.created_at > anchor && !mine.has(p.pubkey));
          return (
            <li key={e.id}>
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
              />
            </li>
          );
        })}
      </ul>
      <Composer workspaceId={workspaceId} />
    </div>
  );
}

type Pending = { name: string; descriptor: MediaDescriptor };

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

function Composer({ workspaceId }: { workspaceId: string }) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [uploading, setUploading] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  // 当前发送意图：内容与附件不变时重发沿用同一个键——结果不明之后再点发送，
  // BFF 回答原操作的结论而不是再发一条（DD-81）。确定的结论之后换新键。
  const intent = useRef<{ key: string; signature: string } | null>(null);

  const attach = useCallback(
    async (files: FileList | null) => {
      for (const file of Array.from(files ?? [])) {
        setUploading((n) => n + 1);
        try {
          const descriptor = await uploadMedia(workspaceId, file);
          setPending((p) => [...p, { name: file.name, descriptor }]);
        } catch (e) {
          // 413 是 BFF 侧先行设定的上界，是确定的拒绝；其余是结果不明
          setProblem(
            e instanceof BffError && e.status === 413
              ? t("platform.uploadTooLarge")
              : t("platform.uploadFailed"),
          );
        } finally {
          setUploading((n) => n - 1);
        }
      }
    },
    [workspaceId],
  );

  const send = useCallback(() => {
    const content = draft.trim();
    if (!content && pending.length === 0) return;
    setProblem(null);
    const attachments = pending.map((p) => p.descriptor);
    // 不本地插入这条消息：它要等 Relay 接受并回传 event id 才算发出去。
    // 先渲染再等确认，会让一条被拒绝的消息看起来已经发出。草稿与附件也只在
    // 确认后才清空——发送失败时它们都还在。
    const signature = JSON.stringify([content, attachments.map((a) => a.sha256)]);
    if (intent.current?.signature !== signature) {
      intent.current = { key: newIntentKey(), signature };
    }
    void publishMessage(workspaceId, content, attachments, intent.current.key)
      .then(() => {
        intent.current = null;
        setDraft((current) => (current.trim() === content ? "" : current));
        setPending((current) => current.filter((p) => !attachments.includes(p.descriptor)));
      })
      .catch((e: unknown) => {
        if (isOutcomeUnknown(e)) {
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
  }, [draft, pending, workspaceId]);

  return (
    <div className="flex flex-col gap-1">
      {problem ? (
        <div className="text-xs text-destructive" role="alert">
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
      <div className="flex gap-2">
        <input
          ref={picker}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          data-testid="attach-input"
          onChange={(e) => {
            void attach(e.target.files);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("platform.attach")}
          onClick={() => picker.current?.click()}
        >
          <Paperclip />
        </Button>
        <Input
          aria-label={t("platform.message")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
        />
        <Button type="button" onClick={send} disabled={uploading > 0}>
          {t("platform.send")}
        </Button>
      </div>
    </div>
  );
}
