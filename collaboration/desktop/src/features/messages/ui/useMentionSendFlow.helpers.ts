import {
  type ImetaMedia,
  mergeOutgoingTags,
} from "@/features/messages/lib/imetaMediaMarkdown";
import type { QueuedMediaAttachment } from "@/features/messages/lib/backgroundMediaUploadStore";
import type { PreparedBackgroundLinkPreviews } from "@/features/messages/lib/linkPreviewPreparationStore";
import type { DraftMentionRef } from "@/features/messages/lib/useDrafts";
import { resolveLocale, translate } from "@client-kit/platform/i18n";

import { classifyRelayPublishFailure } from "@/shared/api/relayPublishOutcome";
import { normalizePubkey } from "@/shared/lib/pubkey";

/** A single visit to a source draft; returning to the same key is a new owner. */
export type ComposerDraftOwner = {
  channelId: string | null;
  draftKey: string | null | undefined;
  /** Read shared source-key intent, never another visible draft key. */
  getComposerRevision: () => number;
};

export type PendingMentionSend = {
  sourceOwner: ComposerDraftOwner;
  composerRevision: number;
  capturedChannelId: string | null;
  capturedThreadContext: {
    parentEventId: string | null;
    threadHeadId: string | null;
  } | null;
  trimmed: string;
  mentionPubkeys: string[];
  outgoingTags?: string[][];
  preparedLinkPreviews?: PreparedBackgroundLinkPreviews | null;
  savedContent: string;
  savedImeta: ImetaMedia[];
  queuedAttachments: QueuedMediaAttachment[];
  savedSpoileredAttachmentUrls: Set<string>;
  sentDraftKey: string | null | undefined;
  recoveryDraftKey: string | null | undefined;
  savedMentionRefs: DraftMentionRef[];
};

export type SendMessageWithMentionFlowInput = {
  capturedChannelId: string | null;
  capturedThreadContext?: PendingMentionSend["capturedThreadContext"];
  pendingImeta: ImetaMedia[];
  queuedAttachments?: QueuedMediaAttachment[];
  linkPreviewTags?: string[][];
  preparedLinkPreviews?: PreparedBackgroundLinkPreviews | null;
  sentDraftKey: string | null | undefined;
  recoveryDraftKey: string | null | undefined;
  spoileredAttachmentUrls?: ReadonlySet<string>;
  trimmed: string;
};

export async function resolvePreviewTags(
  draft: Pick<PendingMentionSend, "preparedLinkPreviews">,
  mediaTags: string[][] | undefined,
  outgoingTags: string[][] | undefined,
): Promise<string[][] | null> {
  const result = await draft.preparedLinkPreviews?.promise;
  if (result?.status === "cancelled") return null;
  return (
    mergeOutgoingTags(mediaTags, [
      ...(outgoingTags ?? []),
      ...(result?.tags ?? []),
    ]) ?? []
  );
}

export function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }
  return fallback;
}

export function formatMessageSendError(error: unknown) {
  return (
    relayPublishFailureText(error) ??
    `Message failed to send: ${getErrorMessage(error, "Unknown error")}`
  );
}

/**
 * Relay 没有接受这次发送时的确定文案（被拒、限流、未发出、结果不明），取自共享
 * 平台文案目录；Relay 的原文只作诊断，不上屏。不是 Relay 发布失败时返回 null。
 */
export function relayPublishFailureText(
  error: unknown,
  locale = resolveLocale(),
): string | null {
  const failure = classifyRelayPublishFailure(error);
  switch (failure?.kind) {
    case undefined:
      return null;
    case "rejected":
      return translate(locale, "native.send.rejected");
    case "rateLimited":
      return failure.retryAfterSeconds !== null && failure.retryAfterSeconds > 0
        ? translate(locale, "native.send.rateLimited", {
            seconds: failure.retryAfterSeconds,
          })
        : translate(locale, "native.send.rateLimitedNoHint");
    case "notSent":
      return translate(locale, "native.send.notConnected");
    case "outcomeUnknown":
      // 两条发送路径都会原样重发同一个已签名事件（relayPublishOutcome.ts）
      return translate(locale, "native.send.outcomeUnknown");
  }
}

export function uniqueNormalizedPubkeys(pubkeys: Iterable<string>) {
  return [...new Set([...pubkeys].map(normalizePubkey))].filter(Boolean);
}
