import * as React from "react";
import { MessageComposerSurface } from "@client-kit/platform/react/composer/MessageComposerSurface";
import { ForumComposerSurface } from "@client-kit/platform/react/forum/ForumComposerSurface";
import { imetaMediaFromTags, restoreImetaMediaDisplayLabels, stripImetaMediaLines, findSpoileredImetaMediaUrls } from "@client-kit/platform/react/messages";
import {
  useChannelLinks,
  type ChannelSuggestion,
} from "@/features/messages/lib/useChannelLinks";
import { useComposerAutofocus } from "@/features/messages/lib/useComposerAutofocus";
import { useDrafts } from "@/features/messages/lib/useDrafts";
import { resolveSentDraftKey } from "@/features/messages/ui/draftSubmitKey";
import {
  useEmojiAutocomplete,
  type EmojiSuggestion,
} from "@/features/messages/lib/useEmojiAutocomplete";
import { useMediaUpload } from "@/features/messages/lib/useMediaUpload";
import {
  cancelBackgroundMediaUploads,
  saveQueuedAttachmentsForDraft,
  takeQueuedAttachmentsForDraft,
  useBackgroundMediaUpload,
} from "@/features/messages/lib/backgroundMediaUploadStore";
import { useComposerFocusOwnership } from "@/features/messages/lib/useComposerFocusOwnership";
import { isMentionCodeContext } from "@/features/messages/lib/mentionCodeContext";
import { useMentions } from "@/features/messages/lib/useMentions";
import {
  type AutocompleteEdit,
  type LinkSelectionInfo,
  useRichTextEditor,
} from "@/features/messages/lib/useRichTextEditor";
import { useLinkEditor } from "@/features/messages/lib/useLinkEditor";
import { useComposerSpoilerParticles } from "@/features/messages/lib/useComposerSpoilerParticles";
import { cn } from "@/shared/lib/cn";
import { ComposerReplyBanner } from "./ComposerReplyBanner";
import { ComposerAttachments, DropZoneOverlay } from "./ComposerAttachments";
import type { MentionSuggestion } from "./MentionAutocomplete";
import { MessageComposerAutocompletes } from "./MessageComposerAutocompletes";
import { ComposerUploadProgressPill } from "./ComposerUploadProgressPill";
import { useComposerVoiceNote } from "./useComposerVoiceNote";
import { useMentionSendFlow } from "./useMentionSendFlow";
import { useComposerMentionPicker } from "./useComposerMentionPicker";
import { useComposerAttachmentSpoilers } from "./useComposerAttachmentSpoilers";
import { useComposerContentState } from "./useComposerContentState";
import { useComposerPasteHandler } from "./useComposerPasteHandler";
import { useDraftPersistLifecycle } from "./useDraftPersistSnapshot";
import { prepareBackgroundLinkPreviews } from "@/features/messages/lib/linkPreviewPreparationStore";
import { useComposerLinkPreviews } from "./useComposerLinkPreviews";
import { scheduleSettleGatedAutoSubmit } from "./messageComposerAutoSubmit";
import type { MessageComposerProps } from "./MessageComposer.types";
function MessageComposerImpl({
  surface = "stream",
  channelId = null,
  channelName,
  containerClassName,
  layoutMode = "standalone",
  disabled = false,
  editTarget,
  onCancelEdit,
  draftKey,
  autoSubmitDraftKey = null,
  onAutoSubmitComplete,
  isSending = false,
  onAttachmentAcceptanceChange,
  onCancelReply,
  onCaptureSendContext,
  onPreparingMentionSendChange,
  onSend,
  placeholder,
  profiles,
  mentionPeople,
  replyTarget = null,
  mediaController,
  showBackgroundUploadProgress = true,
  showTopBorder = false,
  toolbarExtraActions,
}: MessageComposerProps) {
  const {
    contentRef,
    isContentEmpty,
    setComposerContent,
    setComposerContentFromText,
    syncComposerContentFromEditor,
    syncContentRefFromEditorRef,
  } = useComposerContentState();
  const [previewContent, setPreviewContent] = React.useState("");
  const {
    previewList: composerLinkPreviews,
    getLiveCandidates: getLiveLinkPreviewCandidates,
    getReadyTags: getReadyLinkPreviewTags,
  } = useComposerLinkPreviews(previewContent);
  const [isFormattingOpen, setIsFormattingOpen] = React.useState(false);
  const drafts = useDrafts();
  const effectiveDraftKey = editTarget ? null : (draftKey ?? channelId);
  const effectiveDraftKeyRef = React.useRef(effectiveDraftKey);
  effectiveDraftKeyRef.current = effectiveDraftKey;
  const mentions = useMentions(channelId, profiles, mentionPeople);
  const channelLinks = useChannelLinks();
  const emojiAutocomplete = useEmojiAutocomplete();
  const internalMedia = useMediaUpload({ deferUploadsUntilSend: true });
  const media = mediaController ?? internalMedia;
  const voiceNote = useComposerVoiceNote({
    draftKey: effectiveDraftKey,
    media,
    setFormattingOpen: setIsFormattingOpen,
  });
  React.useEffect(() => {
    onAttachmentAcceptanceChange?.(voiceNote.acceptsAttachment);
  }, [onAttachmentAcceptanceChange, voiceNote.acceptsAttachment]);
  const {
    handleAttachmentEditSave,
    handleAttachmentRevert,
    handleRemoveAttachment,
    handleToggleAttachmentSpoiler,
    setSpoileredAttachmentUrls,
    spoileredAttachmentUrls,
    spoileredAttachmentUrlsRef,
  } = useComposerAttachmentSpoilers({
    removeAttachment: media.removeAttachment,
    revertAttachment: media.revertAttachment,
    uploadEditedAttachment: media.uploadEditedAttachment,
  });
  const composerDisabled = disabled;
  const ownsDropZone = mediaController === undefined;
  const backgroundUpload = useBackgroundMediaUpload();
  const { trackAuthoredContent, getComposerRevision, runComposerUpdate } =
    useDraftPersistLifecycle({
      effectiveDraftKey,
      channelId,
      loadDraft: drafts.loadDraft,
      persistDraft: drafts.persistDraft,
      getMentionRefs: mentions.getDraftMentionRefs,
      restoreMentionRefs: mentions.restoreDraftMentionRefs,
      livePendingImeta: media.pendingImeta,
      setPendingImeta: media.setPendingImeta,
      getQueuedAttachments: () => media.queuedAttachmentsRef.current,
      saveQueuedAttachmentsForDraft,
      clearQueuedAttachments: media.clearQueuedAttachments,
      restoreQueuedAttachments: media.restoreQueuedAttachments,
      takeQueuedAttachmentsForDraft,
      setContent: (content) => {
        setComposerContent(content);
        richText.setContent(content);
      },
      clearContent: () => {
        setComposerContent("");
        richText.clearContent();
      },
      setSpoileredAttachmentUrls,
      spoileredAttachmentUrlsRef,
      syncComposerContentFromEditor,
    });
  // biome-ignore lint/correctness/useExhaustiveDependencies: effectiveDraftKey is the sole trigger
  React.useEffect(() => {
    media.setUploadState({ status: "idle" });
    channelLinks.clearChannels();
    emojiAutocomplete.clearEmojis();
  }, [effectiveDraftKey]);
  const disabledRef = React.useRef(disabled);
  const isSendingRef = React.useRef(isSending);
  const isUploadingRef = React.useRef(media.isUploading);
  const isSubmitLockedRef = React.useRef(false);
  const [isSubmitLocked, setIsSubmitLocked] = React.useState(false);
  const onSendRef = React.useRef(onSend);
  disabledRef.current = disabled;
  isSendingRef.current = isSending;
  isUploadingRef.current = media.isUploading;
  onSendRef.current = onSend;
  const isAutocompleteOpenRef = React.useRef(false);
  isAutocompleteOpenRef.current =
    mentions.isMentionOpen ||
    channelLinks.isChannelOpen ||
    emojiAutocomplete.isEmojiAutocompleteOpen;
  const submitMessageRef = React.useRef<() => void>(() => {});
  const composerScrollRef = React.useRef<HTMLDivElement>(null);
  const formRef = React.useRef<HTMLFormElement>(null);
  const composerOwnsFocus = useComposerFocusOwnership(formRef);
  const onEditLinkRef = React.useRef<
    ((info: LinkSelectionInfo) => void) | null
  >(null);
  const onLinkSelectionChangeRef = React.useRef<
    ((info: LinkSelectionInfo | null) => void) | null
  >(null);
  const onLinkShortcutRef = React.useRef<(() => boolean) | null>(null);
  const scrollComposerToBottom = React.useCallback(() => {
    window.requestAnimationFrame(() => {
      const scrollElement = composerScrollRef.current;
      if (!scrollElement) return;
      scrollElement.scrollTop = scrollElement.scrollHeight;
    });
  }, []);
  const computedPlaceholder =
    placeholder ??
    (replyTarget
      ? `Reply to ${replyTarget.author} in #${channelName}`
      : `Message #${channelName}`);
  const richText = useRichTextEditor({
    placeholder: computedPlaceholder,
    editable: !composerDisabled,
    mentionNames: mentions.knownNames,
    channelNames: channelLinks.knownChannelNames,
    messageLinkChannels: channelLinks.channels,
    getMentionIdentities: mentions.getMentionIdentities,
    onSubmit: () => submitMessageRef.current(),
    isAutocompleteOpen: isAutocompleteOpenRef,
    onEditLink: (info) => onEditLinkRef.current?.(info),
    onLinkSelectionChange: (info) => onLinkSelectionChangeRef.current?.(info),
    onLinkShortcut: () => onLinkShortcutRef.current?.() ?? false,
    onUpdate: ({ cursor, linkPreviewContent, text }) => {
      trackAuthoredContent(text);
      contentRef.current = text;
      setComposerContentFromText(text);
      setPreviewContent(linkPreviewContent);
      mentions.updateMentionQuery(text, cursor);
      channelLinks.updateChannelQuery(text, cursor);
      emojiAutocomplete.updateEmojiQuery(text, cursor);
    },
  });
  const linkEditor = useLinkEditor(richText);
  // Original edit hydration: retain attachment labels/spoilers and edit only
  // the body. The ordinary composer stays mounted with its own draft owner.
  const hydratedEdit = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!editTarget || !richText.editor || hydratedEdit.current === editTarget.id) return;
    hydratedEdit.current = editTarget.id;
    const attachments = restoreImetaMediaDisplayLabels(editTarget.body, imetaMediaFromTags(editTarget.tags));
    const content = stripImetaMediaLines(editTarget.body, attachments);
    runComposerUpdate(() => {
      setComposerContent(content);
      richText.setContent(content);
      media.setPendingImeta(attachments);
      setSpoileredAttachmentUrls(new Set(findSpoileredImetaMediaUrls(editTarget.body, attachments)));
    }, attachments);
    richText.focus();
  }, [editTarget, richText.editor, richText.setContent, richText.focus, media.setPendingImeta, runComposerUpdate, setComposerContent, setSpoileredAttachmentUrls]);
  syncContentRefFromEditorRef.current = () => {
    const markdown = richText.getMarkdown();
    contentRef.current = markdown;
    return markdown;
  };
  onEditLinkRef.current = linkEditor.openFromClick;
  onLinkSelectionChangeRef.current = linkEditor.showFromCursor;
  onLinkShortcutRef.current = linkEditor.openFromShortcut;
  useComposerSpoilerParticles(richText.editor, composerScrollRef);
  const mentionSendFlow = useMentionSendFlow({
    getComposerRevision,
    runComposerUpdate,
    channelId,
    effectiveDraftKey,
    channelLinks,
    contentRef,
    drafts,
    emojiAutocomplete,
    mentions,
    onSendRef,
    richText,
    setContent: setComposerContent,
    setPendingImeta: media.setPendingImeta,
    hasUnsavedMedia: () =>
      media.pendingImetaRef.current.length > 0 ||
      media.queuedAttachmentsRef.current.length > 0,
    clearQueuedAttachments: media.clearQueuedAttachments,
    restoreQueuedAttachments: media.restoreQueuedAttachments,
    setSpoileredAttachmentUrls,
  });
  React.useEffect(() => {
    if (!replyTarget || composerDisabled) return;
    richText.focusPreserve();
  }, [composerDisabled, replyTarget, richText.focusPreserve]);
  useComposerAutofocus(richText.focus, effectiveDraftKey, composerDisabled);
  const applyAutocompleteEdit = React.useCallback(
    (edit: AutocompleteEdit) => {
      richText.replacePlainTextRange(
        edit.replaceFromOffset,
        edit.replaceToOffset,
        edit.insertText,
        edit.preserveSelection,
        edit.reassertMentionCaret,
      );
    },
    [richText.replacePlainTextRange],
  );
  const selectMentionSuggestion = React.useCallback(
    (suggestion: MentionSuggestion) => {
      const { cursor } = richText.getPlainTextAndCursor();
      applyAutocompleteEdit(mentions.insertMention(suggestion, cursor));
    },
    [
      applyAutocompleteEdit,
      mentions.insertMention,
      richText.getPlainTextAndCursor,
    ],
  );
  const applyChannelInsert = React.useCallback(
    (suggestion: ChannelSuggestion) => {
      const { cursor } = richText.getPlainTextAndCursor();
      applyAutocompleteEdit(channelLinks.insertChannel(suggestion, cursor));
    },
    [
      applyAutocompleteEdit,
      channelLinks.insertChannel,
      richText.getPlainTextAndCursor,
    ],
  );
  const applyEmojiInsert = React.useCallback(
    (suggestion: EmojiSuggestion) => {
      const { cursor } = richText.getPlainTextAndCursor();
      applyAutocompleteEdit(emojiAutocomplete.insertEmoji(suggestion, cursor));
    },
    [
      applyAutocompleteEdit,
      emojiAutocomplete.insertEmoji,
      richText.getPlainTextAndCursor,
    ],
  );
  const openMentionPicker = useComposerMentionPicker({ mentions, richText });
  const submitMessage = React.useCallback(async () => {
    const trimmed = syncComposerContentFromEditor().trim();
    // Normal send
    const currentPendingImeta = media.pendingImetaRef.current;
    const currentQueuedAttachments = media.queuedAttachmentsRef.current;
    const hasMedia =
      currentPendingImeta.length > 0 || currentQueuedAttachments.length > 0;
    if (
      (!trimmed && !hasMedia) ||
      disabledRef.current ||
      voiceNote.statusRef.current !== "idle" ||
      isSendingRef.current ||
      isSubmitLockedRef.current ||
      isUploadingRef.current ||
      mentionSendFlow.isPreparingMentionSend
    ) {
      return;
    }
    const capturedThreadContext = onCaptureSendContext?.() ?? null;
    if (
      capturedThreadContext !== null &&
      !capturedThreadContext.parentEventId
    ) {
      return;
    }
    isSubmitLockedRef.current = true;
    setIsSubmitLocked(true);
    onPreparingMentionSendChange?.(true);
    try {
      const preparedLinkPreviews = getReadyLinkPreviewTags().some(
        (tag) => tag[1] === "none",
      )
        ? null
        : prepareBackgroundLinkPreviews(getLiveLinkPreviewCandidates());
      await mentionSendFlow.sendMessageWithMentionFlow({
        capturedChannelId: channelId,
        capturedThreadContext,
        pendingImeta: currentPendingImeta,
        queuedAttachments: currentQueuedAttachments,
        linkPreviewTags: preparedLinkPreviews ? [] : getReadyLinkPreviewTags(),
        preparedLinkPreviews,
        sentDraftKey: resolveSentDraftKey(
          effectiveDraftKeyRef.current,
          drafts.loadDraft,
        ),
        recoveryDraftKey: effectiveDraftKey,
        spoileredAttachmentUrls,
        trimmed,
      });
    } finally {
      isSubmitLockedRef.current = false;
      setIsSubmitLocked(false);
      onPreparingMentionSendChange?.(false);
    }
  }, [
    channelId,
    drafts.loadDraft,
    getLiveLinkPreviewCandidates,
    getReadyLinkPreviewTags,
    media.pendingImetaRef,
    media.queuedAttachmentsRef,
    mentionSendFlow.isPreparingMentionSend,
    mentionSendFlow.sendMessageWithMentionFlow,
    spoileredAttachmentUrls,
    syncComposerContentFromEditor,
    onCaptureSendContext,
    onPreparingMentionSendChange,
    effectiveDraftKey,
    voiceNote.statusRef,
  ]);

  submitMessageRef.current = submitMessage;
  // Draft auto-submit runs once after persisted editor state loads.
  const onAutoSubmitCompleteRef = React.useRef(onAutoSubmitComplete);
  onAutoSubmitCompleteRef.current = onAutoSubmitComplete;
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally fires once on mount only
  React.useEffect(() => {
    if (
      autoSubmitDraftKey === null ||
      autoSubmitDraftKey !== effectiveDraftKey
    ) {
      return;
    }
    // Clear the trigger BEFORE firing so any navigation from the send cannot
    // loop back with the param still present.
    onAutoSubmitCompleteRef.current?.();
    return scheduleSettleGatedAutoSubmit({
      submit: () => submitMessageRef.current(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-only
  const handleSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void submitMessage();
    },
    [submitMessage],
  );
  // Tiptap handles formatting shortcuts (⌘B, ⌘I, etc.) natively.
  // Plain Enter → submit is now handled inside the Tiptap `submitOnEnter`
  // extension (fires before ProseMirror's splitBlock). This wrapper only
  // handles autocomplete arrow/enter keys and the link card's Tab.
  const handleEditorKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // Let autocomplete handle keys first
      const emojiResult = emojiAutocomplete.handleEmojiKeyDown(event);
      if (emojiResult.handled) {
        if (emojiResult.suggestion) {
          applyEmojiInsert(emojiResult.suggestion);
        }
        return;
      }
      const channelResult = channelLinks.handleChannelKeyDown(event);
      if (channelResult.handled) {
        if (channelResult.suggestion) {
          applyChannelInsert(channelResult.suggestion);
        }
        return;
      }
      const { handled, suggestion } = mentions.handleMentionKeyDown(event, {
        isCodeContext: () => isMentionCodeContext(richText.editor),
      });
      if (handled) {
        if (suggestion) {
          selectMentionSuggestion(suggestion);
        }
        return;
      }
      if (event.key === "Tab" && !event.shiftKey && linkEditor.isCardOpen) {
        event.preventDefault();
        if (!linkEditor.focusCardFirstControl()) {
          requestAnimationFrame(linkEditor.focusCardFirstControl);
        }
        return;
      }
    },
    [
      emojiAutocomplete.handleEmojiKeyDown,
      applyEmojiInsert,
      channelLinks.handleChannelKeyDown,
      applyChannelInsert,
      mentions.handleMentionKeyDown,
      richText.editor,
      selectMentionSuggestion,
      linkEditor.isCardOpen,
      linkEditor.focusCardFirstControl,
    ],
  );
  useComposerPasteHandler({
    editor: richText.editor,
    bindMentionIdentities: mentions.bindPastedMentionIdentities,
    scrollToBottom: scrollComposerToBottom,
    uploadFile: voiceNote.uploadFileWhenIdle,
  });
  const sendDisabled =
    composerDisabled ||
    media.isUploading ||
    voiceNote.status !== "idle" ||
    mentionSendFlow.isPreparingMentionSend ||
    (isContentEmpty &&
      media.pendingImeta.length === 0 &&
      media.queuedAttachments.length === 0);
  const handlePaperclipClick = React.useCallback(() => {
    if (!voiceNote.hasAttachmentRef.current) void media.handlePaperclip();
  }, [media.handlePaperclip, voiceNote.hasAttachmentRef]);
  const acceptsDrop = ownsDropZone && voiceNote.acceptsAttachment;
  const ComposerSurface = surface === "forum" ? ForumComposerSurface : MessageComposerSurface;
  return <ComposerSurface
    submitLocked={isSubmitLocked}
    containerClassName={containerClassName} showTopBorder={showTopBorder}
    formRef={formRef} scrollRef={composerScrollRef} onEditorKeyDown={handleEditorKeyDown}
    header={<>
          <ComposerReplyBanner
            isEditing={editTarget !== undefined}
            isEditCancelDisabled={isSubmitLocked || isSending}
            onCancelEdit={onCancelEdit}
            replyTarget={replyTarget}
            onCancelReply={onCancelReply}
          />
          {showBackgroundUploadProgress ? (
            <ComposerUploadProgressPill
              canCancel={backgroundUpload.canCancel}
              isUploading={backgroundUpload.isUploading}
              onCancel={cancelBackgroundMediaUploads}
              phase={backgroundUpload.phase}
              percentage={backgroundUpload.percentage}
            />
          ) : null}
    </>}
    overlays={<>{linkEditor.card}{linkEditor.dialog}</>}
    formProps={{
      onDragEnter: acceptsDrop ? media.handleDragEnter : undefined,
      onDragLeave: acceptsDrop ? media.handleDragLeave : undefined,
      onDragOver: acceptsDrop ? media.handleDragOver : undefined,
      onDrop: acceptsDrop ? (event) => { void media.handleDrop(event); } : undefined,
      onSubmit: handleSubmit,
    }}
    toolbar={{ layoutMode, composerDisabled, editor: richText.editor,
      extraActions: toolbarExtraActions, formattingDisabled: composerDisabled,
      isFormattingOpen, isSending: isSending || mentionSendFlow.isPreparingMentionSend,
      isUploading: media.isUploading, isVoiceNoteProcessing: voiceNote.status !== "recording",
      isVoiceNoteRecording: voiceNote.status !== "idle", hasVoiceNoteAttachment: voiceNote.hasAttachment,
      voiceNoteRecorder: voiceNote.recorderElement,
      onFormattingToggle: setIsFormattingOpen, onLinkButton: linkEditor.openFromToolbar,
      onOpenMentionPicker: openMentionPicker, onPaperclip: handlePaperclipClick,
      onFinishVoiceNote: () => void voiceNote.finish(), onVoiceNote: voiceNote.toggle, sendDisabled,
    }}>
            {acceptsDrop && media.isDragOver && <DropZoneOverlay />}
            <MessageComposerAutocompletes
              channelLinks={channelLinks}
              composerOwnsFocus={composerOwnsFocus}
              emojiAutocomplete={emojiAutocomplete}
              mentions={mentions}
              onChannelSelect={applyChannelInsert}
              onEmojiSelect={applyEmojiInsert}
              onMentionSelect={selectMentionSuggestion}
            />
            {media.uploadState.status === "error" ? (
              <div className="mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                Upload failed: {media.uploadState.message}
                <button
                  className="ml-2 underline"
                  onClick={() => media.setUploadState({ status: "idle" })}
                  type="button"
                >
                  Dismiss
                </button>
              </div>
            ) : null}
            {mentionSendFlow.sendOutcome ? (
              <div
                aria-live="polite"
                className={cn(
                  "mb-2 rounded-lg px-3 py-2 text-xs",
                  mentionSendFlow.sendOutcome.unknown || mentionSendFlow.sendOutcome.pending
                    ? "bg-muted text-muted-foreground"
                    : "bg-destructive/10 text-destructive",
                )}
                data-outcome={
                  mentionSendFlow.sendOutcome.pending ? "pending" : mentionSendFlow.sendOutcome.unknown ? "unknown" : "not-sent"
                }
                data-testid="composer-send-outcome"
                role="status"
              >
                {mentionSendFlow.sendOutcome.text}
              </div>
            ) : null}
            {composerLinkPreviews}
            {(media.pendingImeta.length > 0 ||
              media.queuedAttachments.length > 0 ||
              media.isUploading) && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {media.pendingImeta.length > 0 ||
                media.queuedAttachments.length > 0 ||
                media.isUploading ? (
                  <ComposerAttachments
                    attachments={media.pendingImeta}
                    isUploading={media.isUploading}
                    onCancelUpload={media.cancelUpload}
                    onRemoveQueued={media.removeQueuedAttachment}
                    onToggleQueuedSpoiler={media.toggleQueuedAttachmentSpoiler}
                    queuedPreviews={media.queuedPreviews}
                    uploadingCount={media.uploadingCount}
                    uploadingPreviews={media.uploadingPreviews}
                    onEditSave={handleAttachmentEditSave}
                    onRemove={handleRemoveAttachment}
                    onRevert={handleAttachmentRevert}
                    originalUrlByUrl={media.originalUrlByUrl}
                    onToggleSpoiler={handleToggleAttachmentSpoiler}
                    spoileredUrls={spoileredAttachmentUrls}
                  />
                ) : null}
              </div>
            )}
  </ComposerSurface>;
}
export const MessageComposer = React.memo(MessageComposerImpl);
