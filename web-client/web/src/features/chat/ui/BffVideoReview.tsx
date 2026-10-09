// Host adapters for the complete shared Buzz video review, not another message authority.
import { createContext, useContext, useEffect, useMemo, useRef, type ComponentProps, type ReactNode } from "react";
import { WebMessageType, type WebPublishMessageRequest } from "@client-kit/contracts";
import { newIdempotencyKey } from "@client-kit/platform/governance";
import { BffError, TransportError, isOutcomeUnknown } from "@client-kit/platform/transport";
import { UserAvatar, type TimelineMessage, type UserAvatarProps } from "@client-kit/platform/react/messages";
import { createVideoPlayer, buildVideoReviewPresentationByMessageId, VideoReviewNavigationProvider, useVideoContextMenu, type VideoReviewComposerProps } from "@client-kit/platform/react/video-review";
import { EmojiPicker, useBffCustomEmojiPalette } from "@client-kit/platform/react/custom-emoji";
import { useUiT } from "@client-kit/platform/react/context";
import { bff, mediaUrl, publishMessage, publishConversationMessage, uploadConversationMedia, type MediaDescriptor } from "@/platform/bff-client";
import { MessageAuthorAvatar } from "@/platform/ui/MessageAuthorProfile";
import { toast } from "sonner";

type Submission = { key: string; attachments: readonly MediaDescriptor[]; installations: string[] };
type FrozenReview = { key: string; composerKey?: string; rootId: string; request: WebPublishMessageRequest & Required<Pick<WebPublishMessageRequest, "attachments" | "mentionInstallationIds" | "parentEventId">> };
type Host = {
  Composer: typeof import("@/platform/ui/ChannelPane").Composer;
  mentionPeople: ComponentProps<typeof import("@/platform/ui/ChannelPane").Composer>["mentionPeople"];
  principalId: string;
  workspaceId: string;
  conversationId?: string;
  channelName?: string;
  channelType: "stream" | "forum" | "dm";
  messages: TimelineMessage[];
  available: boolean;
  refresh?: () => unknown;
  onToggleReaction?: (message: TimelineMessage, emoji: string, remove: boolean) => Promise<void>;
  resolveMediaUrl?: (url: string) => string | undefined;
};
type HostValue = Host & {
  submission: { current: Submission | null };
  presentation: ReturnType<typeof buildVideoReviewPresentationByMessageId>;
};
const VideoHost = createContext<HostValue | null>(null);
const eventId = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function readFrozenReview(storageKey: string, rootId: string, unknownMessage: string): FrozenReview | null {
  const encoded = localStorage.getItem(storageKey);
  if (encoded === null) return null;
  let value: FrozenReview;
  try { value = JSON.parse(encoded) as FrozenReview; }
  catch { throw new TransportError(unknownMessage); }
  if (!value || value.rootId !== rootId || !uuid.test(value.key) ||
      value.composerKey !== undefined && !uuid.test(value.composerKey) ||
      typeof value.request?.content !== "string" || !Array.isArray(value.request.attachments) ||
      !Array.isArray(value.request.mentionInstallationIds) || !eventId.test(value.request.parentEventId ?? "") ||
      value.request.editEventId || value.request.deleteEventId) throw new TransportError(unknownMessage);
  return value;
}

export function BffVideoReviewProvider({children, ...host}: Host & {children: ReactNode}) {
  const t = useUiT();
  const scope = JSON.stringify([host.principalId, host.workspaceId, host.conversationId ?? null]);
  const current = useRef({scope, host, active: true});
  current.current = {scope, host, active: true};
  useEffect(() => {
    current.current.active = true;
    return () => { current.current.active = false; };
  }, []);
  const submission = useRef<Submission | null>(null);
  const pending = useRef(new Set<string>());
  const presentation = useMemo(() => buildVideoReviewPresentationByMessageId({
    channelId: host.workspaceId, channelName: host.channelName, channelType: host.channelType,
    messages: host.messages.map(message => ({...message, reactions: message.reactions?.map(reaction => ({...reaction,
      emojiUrl: reaction.emojiUrl ? host.resolveMediaUrl?.(reaction.emojiUrl) : undefined}))})),
    onToggleReaction: host.available ? host.onToggleReaction : undefined,
    onSendVideoReviewComment: host.available ? async (root, content, mentionPubkeys, mediaTags, parentEventId) => {
      const admitted = () => current.current.active && current.current.scope === scope && current.current.host.available &&
        current.current.host.messages.some(message => message.id === root.id);
      if (!admitted() || !eventId.test(root.id)) throw new BffError(403, t("platform.loadFailed"));
      const storageKey = `kailo:video-review:${scope}:${root.id}`;
      if (pending.current.has(storageKey)) throw new TransportError(t("platform.sendUnknown", {operation: ""}));
      const selectedSubmission = submission.current;
      if (mediaTags?.length && !selectedSubmission) throw new BffError(400, t("platform.loadFailed"));
      pending.current.add(storageKey);
      let prior: FrozenReview | null = null;
      let confirmed = false;
      try {
        prior = readFrozenReview(storageKey, root.id, t("platform.sendUnknown", {operation: ""}));
        // The final stamped body and parent freeze with the original Composer
        // key. Moving playback, choosing another reply or remounting cannot
        // turn an UNKNOWN into a second side effect. Quick reactions use the
        // same existing BFF idempotency boundary and never auto-retry.
        const intent = prior ?? {
          key: selectedSubmission?.key ?? newIdempotencyKey(),
          ...(selectedSubmission ? {composerKey: selectedSubmission.key} : {}),
          rootId: root.id,
          request: {content, attachments: [...(selectedSubmission?.attachments ?? [])],
            mentionInstallationIds: selectedSubmission?.installations ?? [], mentionPubkeys,
            parentEventId: parentEventId ?? root.id,
            messageType: host.channelType === "forum" ? WebMessageType.ForumComment : WebMessageType.Stream},
        } satisfies FrozenReview;
        if (!prior) localStorage.setItem(storageKey, JSON.stringify(intent));
        if (!admitted()) throw new TransportError(t("platform.sendUnknown", {operation: ""}));
        const request = intent.request;
        const receipt = await (host.conversationId
          ? publishConversationMessage(host.conversationId, request.content, request.attachments, intent.key, undefined, request.parentEventId, request.mentionPubkeys)
          : publishMessage(host.workspaceId, request.content, request.attachments, intent.key, request.mentionInstallationIds,
            {messageType: request.messageType, parentEventId: request.parentEventId, mentionPubkeys: request.mentionPubkeys}));
        if (!receipt?.eventId || !receipt.operationId) throw new TransportError(t("platform.sendUnknown", {operation: ""}));
        confirmed = true;
        localStorage.removeItem(storageKey);
        if (admitted()) current.current.host.refresh?.();
        if (prior && (prior.composerKey !== selectedSubmission?.key ||
          !selectedSubmission && (prior.request.content !== content || prior.request.parentEventId !== (parentEventId ?? root.id)))) {
          throw new BffError(409, t("platform.refresh"));
        }
      } catch (error) {
        if (!prior && !isOutcomeUnknown(error) && error instanceof BffError) localStorage.removeItem(storageKey);
        // A later refusal is not evidence that the original unacknowledged
        // publish failed. Keep it available only for same-key reconciliation.
        if (prior && !confirmed && !isOutcomeUnknown(error)) throw new TransportError(t("platform.sendUnknown", {operation: ""}));
        throw error;
      } finally { pending.current.delete(storageKey); }
    } : undefined,
  }), [scope, host.workspaceId, host.channelName, host.channelType, host.conversationId, host.messages, host.available, host.onToggleReaction, host.resolveMediaUrl, t]);
  return <VideoHost.Provider value={{...host, submission, presentation}}><VideoReviewNavigationProvider key={scope}>{children}</VideoReviewNavigationProvider></VideoHost.Provider>;
}

export function useBffVideoReview(messageId?: string) {
  const host = useContext(VideoHost);
  return {reviewContext: messageId ? host?.presentation.contextsByMessageId.get(messageId) : undefined,
    videoReviewCommentRootId: messageId ? host?.presentation.commentRootIdsByMessageId.get(messageId) : undefined};
}

function VideoComposer(props: VideoReviewComposerProps) {
  const t = useUiT();
  const host = useContext(VideoHost);
  if (!host) return null;
  const Composer = host.Composer;
  return <Composer workspaceId={host.conversationId ? undefined : host.workspaceId} draftChannelId={host.workspaceId}
    draftIdentity={host.principalId} draftKey={props.draftKey} channelType={host.channelType}
    mentionPeople={host.mentionPeople} disabled={props.disabled || !host.available}
    containerClassName={props.containerClassName} placeholder={props.placeholder}
    replyTarget={props.replyTarget} onCancelReply={props.onCancelReply}
    onUpload={host.conversationId ? file => uploadConversationMedia(host.conversationId!, file) : undefined}
    onMediaUrl={hash => mediaUrl(host.workspaceId, hash, host.conversationId)}
    onPublish={async (content, attachments, key, installations, mentionPubkeys) => {
      if (!host.available || host.submission.current) throw new TransportError(t("platform.sendUnknown", {operation: ""}));
      host.submission.current = {key, attachments, installations};
      try { await props.onSend(content, mentionPubkeys ?? []); }
      finally { host.submission.current = null; }
    }} />;
}

function VideoEmojiPicker(props: Omit<ComponentProps<typeof EmojiPicker>, "customEmoji">) {
  const customEmoji = useBffCustomEmojiPalette(bff);
  return <EmojiPicker {...props} customEmoji={customEmoji} />;
}

function VideoAvatar({eventId: id, pubkey, avatarUrl: _avatarUrl, ...props}: Omit<UserAvatarProps, "resolveMediaUrl"> & {eventId?: string; pubkey?: string}) {
  const host = useContext(VideoHost);
  if (host?.available && id && pubkey && host.messages.some(message => message.id === id && message.pubkey === pubkey))
    return <MessageAuthorAvatar {...props} target={{principalId: host.principalId, workspaceId: host.workspaceId, conversationId: host.conversationId, eventId: id, pubkey}} />;
  return <UserAvatar {...props} avatarUrl={null} />;
}

function useBffVideoContextMenu(src: string, downloadUrl?: string, filename?: string) {
  const t = useUiT();
  const actions = useMemo(() => ({
    download: async (url: string, name: string) => {
      if (url !== src || url !== downloadUrl) throw new Error(t("platform.loadFailed"));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
    },
    copyLink: async (url: string, success: string) => { await navigator.clipboard.writeText(url); toast.success(success); },
    reportError: (message: string) => { toast.error(message); },
  }), [src, downloadUrl, t]);
  return useVideoContextMenu(src, downloadUrl, filename, actions);
}

export const BffVideoPlayer = createVideoPlayer({MessageComposer: VideoComposer, EmojiPicker: VideoEmojiPicker, UserAvatar: VideoAvatar, useVideoContextMenu: useBffVideoContextMenu});
