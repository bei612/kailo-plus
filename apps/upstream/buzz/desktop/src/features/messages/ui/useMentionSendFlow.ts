import * as React from "react";
import { toast } from "sonner";
import { claimDraftSend } from "@/features/messages/lib/useDrafts";
import {
  prepareBackgroundMediaUpload,
  saveQueuedAttachmentsForDraft,
} from "@/features/messages/lib/backgroundMediaUploadStore";
import {
  buildOutgoingMessage,
  type ImetaMedia,
} from "@/features/messages/lib/imetaMediaMarkdown";
import { useActivePreparedLinkPreviews } from "./useActivePreparedLinkPreviews";
import {
  formatMessageSendError,
  getErrorMessage,
  type PendingMentionSend,
  resolvePreviewTags,
  type SendMessageWithMentionFlowInput,
  uniqueNormalizedPubkeys,
} from "./useMentionSendFlow.helpers";
import type { UseMentionSendFlowOptions } from "./useMentionSendFlow.types";

export function useMentionSendFlow({
  channelId,
  effectiveDraftKey,
  getComposerRevision,
  runComposerUpdate,
  channelLinks,
  contentRef,
  drafts,
  emojiAutocomplete,
  mentions,
  onSendRef,
  richText,
  setContent,
  setPendingImeta,
  hasUnsavedMedia,
  clearQueuedAttachments,
  restoreQueuedAttachments,
  setSpoileredAttachmentUrls,
}: UseMentionSendFlowOptions) {
  const [isMentionSendPending, setIsMentionSendPending] = React.useState(false);
  // Persistence identity is independent of the host component and destination
  // channel. A -> B -> A must not revive A's previous recovery.
  const sourceOwner = React.useMemo(
    () => ({ channelId, draftKey: effectiveDraftKey, getComposerRevision }),
    [channelId, effectiveDraftKey, getComposerRevision],
  );
  const sourceOwnerRef = React.useRef(sourceOwner);
  sourceOwnerRef.current = sourceOwner;
  const isMentionSendPendingRef = React.useRef(false);
  const isMountedRef = React.useRef(false);
  const activePreparedLinkPreviews = useActivePreparedLinkPreviews();

  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const clearComposer = React.useCallback(() => {
    setContent("");
    contentRef.current = "";
    richText.clearContent();
    setPendingImeta([]);
    clearQueuedAttachments();
    setSpoileredAttachmentUrls?.(new Set());
    mentions.clearMentions();
    channelLinks.clearChannels();
    emojiAutocomplete.clearEmojis();
  }, [
    channelLinks.clearChannels,
    contentRef,
    emojiAutocomplete.clearEmojis,
    mentions.clearMentions,
    richText.clearContent,
    setContent,
    setPendingImeta,
    clearQueuedAttachments,
    setSpoileredAttachmentUrls,
  ]);
  const completeSend = React.useCallback(
    async (draft: PendingMentionSend) => {
      const ownsComposer = () => sourceOwnerRef.current === draft.sourceOwner;
      const sendSignal = draft.preparedLinkPreviews?.signal;
      const isSendCancelled = () => sendSignal?.aborted === true;
      if (isSendCancelled()) return;
      const preparedUpload =
        draft.queuedAttachments.length > 0
          ? prepareBackgroundMediaUpload(draft.queuedAttachments)
          : null;
      const persistRecoverableDraft = () => {
        // Link preview cancellation retains its own independent recovery owner.
        if (
          sendSignal?.aborted ||
          !draft.recoveryDraftKey ||
          draft.sourceOwner.getComposerRevision() !== draft.composerRevision
        )
          return false;
        const existing = drafts.loadDraft(draft.recoveryDraftKey);
        if (
          existing &&
          (existing.content !== draft.savedContent ||
            existing.channelId !==
              (draft.capturedChannelId ?? draft.recoveryDraftKey) ||
            JSON.stringify(existing.pendingImeta) !==
              JSON.stringify(draft.savedImeta) ||
            JSON.stringify(existing.spoileredAttachmentUrls) !==
              JSON.stringify([...draft.savedSpoileredAttachmentUrls]) ||
            JSON.stringify(existing.mentionRefs ?? []) !==
              JSON.stringify(draft.savedMentionRefs))
        ) {
          return false;
        }
        drafts.persistDraft(
          draft.recoveryDraftKey,
          draft.savedContent,
          draft.capturedChannelId ?? draft.recoveryDraftKey,
          draft.savedImeta,
          [...draft.savedSpoileredAttachmentUrls],
          draft.savedMentionRefs,
        );
        return true;
      };
      let composerCleared = false;
      let clearedRevision = -1;
      const restoreComposerAfterFailure = () => {
        if (!composerCleared) return;
        composerCleared = false;
        // An authored edit (even edit -> clear) ends optimistic recovery's
        // authority over this key, including its persisted record and files.
        if (draft.sourceOwner.getComposerRevision() !== clearedRevision) return;
        const persisted = persistRecoverableDraft();
        const canRestoreCurrentComposer =
          isMountedRef.current &&
          ownsComposer() &&
          getComposerRevision() === clearedRevision &&
          contentRef.current.trim() === "" &&
          !hasUnsavedMedia();
        if (!canRestoreCurrentComposer && persisted && draft.recoveryDraftKey) {
          saveQueuedAttachmentsForDraft(
            draft.recoveryDraftKey,
            draft.queuedAttachments,
          );
        }
        if (!canRestoreCurrentComposer) {
          return;
        }
        runComposerUpdate(() => {
          setContent(draft.savedContent);
          contentRef.current = draft.savedContent;
          richText.setContent(draft.savedContent);
          setPendingImeta(draft.savedImeta);
          restoreQueuedAttachments(draft.queuedAttachments);
          mentions.restoreDraftMentionRefs(draft.savedMentionRefs);
          setSpoileredAttachmentUrls?.(
            new Set(draft.savedSpoileredAttachmentUrls),
          );
        });
      };
      if (ownsComposer() && getComposerRevision() === draft.composerRevision) {
        runComposerUpdate(clearComposer);
        composerCleared = true;
        clearedRevision = getComposerRevision();
      }
      let uploadStarted = false;
      try {
        const send = onSendRef.current;
        const finishSend = async (
          uploaded: ImetaMedia[],
          signal?: AbortSignal,
        ) => {
          const { content: finalContent, mediaTags } = buildOutgoingMessage(
            draft.trimmed,
            [...draft.savedImeta, ...uploaded],
            new Set([
              ...draft.savedSpoileredAttachmentUrls,
              ...draft.queuedAttachments.flatMap((attachment, index) =>
                attachment.spoilered && uploaded[index]
                  ? [uploaded[index].url]
                  : [],
              ),
            ]),
          );
          const finalOutgoingTags = await resolvePreviewTags(
            draft,
            mediaTags,
            draft.outgoingTags,
          );
          if (!finalOutgoingTags || signal?.aborted || isSendCancelled())
            return restoreComposerAfterFailure();
          await send(
            finalContent,
            draft.mentionPubkeys,
            finalOutgoingTags,
            draft.capturedChannelId,
            draft.capturedThreadContext,
            draft.preparedLinkPreviews != null,
          );
          if (signal?.aborted || isSendCancelled()) return;
          if (
            draft.sentDraftKey &&
            draft.sourceOwner.getComposerRevision() ===
              draft.composerRevision &&
            JSON.stringify(
              drafts.loadDraft(draft.sentDraftKey)?.mentionRefs ?? [],
            ) === JSON.stringify(draft.savedMentionRefs)
          ) {
            drafts.markDraftSent(
              draft.sentDraftKey,
              draft.savedContent,
              draft.capturedChannelId ?? draft.sentDraftKey,
              draft.savedImeta,
              [...draft.savedSpoileredAttachmentUrls],
            );
          }
        };
        if (preparedUpload) {
          let settleUpload!: () => void;
          const uploadSettled = new Promise<void>((resolve) => {
            settleUpload = resolve;
          });
          uploadStarted = preparedUpload.start({
            onComplete: async (uploaded, signal) => {
              try {
                await finishSend(uploaded, signal);
              } catch (error) {
                restoreComposerAfterFailure();
                toast.error(formatMessageSendError(error));
              } finally {
                settleUpload();
              }
            },
            onError: (error) => {
              restoreComposerAfterFailure();
              toast.error(
                `Upload failed: ${getErrorMessage(error, "Unknown error")}`,
              );
              settleUpload();
            },
            onCancel: () => {
              restoreComposerAfterFailure();
              settleUpload();
            },
          });
          if (!uploadStarted) {
            settleUpload();
            return restoreComposerAfterFailure();
          }
          await uploadSettled;
        } else {
          try {
            await finishSend([]);
          } catch (error) {
            restoreComposerAfterFailure();
            toast.error(formatMessageSendError(error));
          }
        }
      } finally {
        if (draft.preparedLinkPreviews) {
          activePreparedLinkPreviews.delete(draft.preparedLinkPreviews);
        }
        draft.preparedLinkPreviews?.release();
        if (!uploadStarted) preparedUpload?.cancel();
      }
    },
    [
      activePreparedLinkPreviews,
      clearComposer,
      contentRef,
      drafts,
      getComposerRevision,
      hasUnsavedMedia,
      mentions.restoreDraftMentionRefs,
      onSendRef,
      restoreQueuedAttachments,
      richText.setContent,
      runComposerUpdate,
      setContent,
      setPendingImeta,
      setSpoileredAttachmentUrls,
    ],
  );
  const sendMessageWithMentionFlow = React.useCallback(
    async ({
      capturedChannelId,
      capturedThreadContext = null,
      pendingImeta,
      queuedAttachments = [],
      linkPreviewTags = [],
      preparedLinkPreviews = null,
      sentDraftKey,
      recoveryDraftKey,
      spoileredAttachmentUrls = new Set(),
      trimmed,
    }: SendMessageWithMentionFlowInput) => {
      if (isMentionSendPendingRef.current) {
        return;
      }
      isMentionSendPendingRef.current = true;
      setIsMentionSendPending(true);
      // Bind settlement to this authored visit before reading its recipients.
      claimDraftSend(effectiveDraftKey);
      const composerRevision = getComposerRevision();
      let sendPromoted = false;
      if (preparedLinkPreviews) {
        activePreparedLinkPreviews.add(preparedLinkPreviews);
      }
      try {
        if (preparedLinkPreviews?.signal.aborted) return;
        // Every extraction below reads the mention map, and a pasted identity
        // can still be verifying. Sending first would publish a readable
        // `@Label` with no `p` tag. Bounded inside, so a lookup that never
        // answers delays the send rather than blocking it.
        await mentions.settlePendingMentionBindings();
        // Settlement may outlive an edit or A → B → A navigation. In that
        // case the live mention maps no longer belong to this send.
        if (
          preparedLinkPreviews?.signal.aborted ||
          !isMountedRef.current ||
          sourceOwnerRef.current !== sourceOwner ||
          getComposerRevision() !== composerRevision
        )
          return;
        sendPromoted = true;
        await completeSend({
          sourceOwner,
          composerRevision,
          capturedChannelId,
          capturedThreadContext,
          trimmed,
          mentionPubkeys: uniqueNormalizedPubkeys(
            mentions.extractMentionPubkeys(trimmed),
          ),
          outgoingTags: linkPreviewTags,
          preparedLinkPreviews,
          savedContent: trimmed,
          savedImeta: [...pendingImeta],
          queuedAttachments: [...queuedAttachments],
          savedSpoileredAttachmentUrls: new Set(spoileredAttachmentUrls),
          sentDraftKey,
          recoveryDraftKey,
          savedMentionRefs: mentions.getDraftMentionRefs(trimmed).slice(),
        });
      } catch (error) {
        toast.error(
          getErrorMessage(error, "Could not prepare mentions. Please retry."),
        );
      } finally {
        if (!sendPromoted) {
          if (preparedLinkPreviews) {
            activePreparedLinkPreviews.delete(preparedLinkPreviews);
          }
          preparedLinkPreviews?.release();
        }
        isMentionSendPendingRef.current = false;
        setIsMentionSendPending(false);
      }
    },
    [
      activePreparedLinkPreviews,
      completeSend,
      effectiveDraftKey,
      getComposerRevision,
      mentions.extractMentionPubkeys,
      mentions.getDraftMentionRefs,
      mentions.settlePendingMentionBindings,
      sourceOwner,
    ],
  );
  return {
    isPreparingMentionSend: isMentionSendPending,
    sendMessageWithMentionFlow,
  };
}
