import * as React from "react";
import { useBffClient } from "@client-kit/platform/react/context";
import { useNativeSession } from "@/features/platform/activeCommunity";
import { nativeApplicationWorkspace, useWorkspaceChannelDirectory } from "@/features/channels/hooks";
import { useComposerAgentDirectory } from "@client-kit/platform/react/composer/features/messages/ui/useComposerAgentDirectory";
import { getPersistentAgentAudienceScope } from "@client-kit/platform/react/composer/features/messages/lib/persistentAgentAudience";
import { setKeepMentionedAgentsPinned } from "@client-kit/platform/react/composer/features/messages/lib/autoPinMentionedAgentsPreference";
import { useThreadAgentAudience } from "@client-kit/platform/react/composer/features/messages/ui/useThreadAgentAudience";
import { useAgentAddressLockPicker } from "@client-kit/platform/react/composer/features/messages/ui/useAgentAddressLockPicker";
import { useAddressMentionPulse } from "@client-kit/platform/react/composer/features/messages/ui/useAddressMentionPulse";
import { useAutoPinMentionedAgents } from "@client-kit/platform/react/composer/features/messages/ui/useAutoPinMentionedAgents";
import { useAlwaysAddressShortcut } from "@client-kit/platform/react/composer/features/messages/ui/useAlwaysAddressShortcut";
import { useImplicitAgentMentionProvenance } from "@client-kit/platform/react/composer/features/messages/ui/useImplicitAgentMentionProvenance";
import { focusMentionOptionsTrigger } from "@client-kit/platform/react/composer/features/messages/ui/MentionAutocomplete";
import { useCustomEmojiPalette } from "../lib/useCustomEmojiPalette";
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
  audienceContext = null,
  surface = "stream",
  compact = false,
  autocompleteBelow = false,
  composerHeader,
  channelId = null,
  channelType = null,
  channelName,
  containerClassName,
  layoutMode = "standalone",
  disabled = false,
  editTarget,
  onRequestEmptyEditDelete,
  onCancelEdit,
  onEditLastOwnMessage,
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
  const customEmoji = useCustomEmojiPalette();
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
  const bff = useBffClient();
  const session = useNativeSession();
  const workspaces = useWorkspaceChannelDirectory({ enabled: channelType !== "dm" && channelId !== null });
  const workspace = nativeApplicationWorkspace(workspaces.data, { channelId });
  const agentDirectory = useComposerAgentDirectory(bff, {
    workspaceId: workspace?.id, channelId: channelId ?? undefined, ownerPubkey: session.devicePubkey,
  }, channelType !== "dm" && channelId !== null && workspace !== undefined && !editTarget);
  const agents = React.useMemo(() => agentDirectory.data?.agents.map(agent => ({
    pubkey: agent.pubkey, displayName: agent.displayName, avatarUrl: agent.avatarUrl, isAgent: true,
  })) ?? [], [agentDirectory.data]);
  const knownAgentKeys = React.useMemo(() => new Set<string>(), [session.devicePubkey, channelId, effectiveDraftKey]);
  for (const agent of agents) knownAgentKeys.add(agent.pubkey);
  const isAgentPubkey = React.useCallback((pubkey: string) => agents.some(agent => agent.pubkey === pubkey.toLowerCase()), [agents]);
  const audienceScope = !editTarget && audienceContext && channelId && channelType !== "dm"
    ? getPersistentAgentAudienceScope({ ownerPubkey: session.devicePubkey, channelId, composerKey: effectiveDraftKey }) : null;
  const implicitAgentMentionProvenance = useImplicitAgentMentionProvenance(audienceScope);
  const { audience, keepMentionedAgentsPinned } = useThreadAgentAudience({
    isAgentPubkey, rootTags: audienceContext?.rootTags ?? [], scope: audienceScope,
  });
  const admittedPeople = React.useMemo(() => mentionPeople ?? (workspace ? agentDirectory.data?.members.flatMap(member => member.pubkeys.map(pubkey => ({pubkey, displayName: member.displayName}))) ?? [] : undefined), [mentionPeople, workspace?.id, agentDirectory.data]);
  const mentions = useMentions(channelId, profiles, admittedPeople, agents, session.devicePubkey);
  for (const ref of mentions.getDraftMentionRefs(contentRef.current)) if (ref.isAgent === true) knownAgentKeys.add(ref.pubkey);
  const getAgentDraftMentionRefs = React.useCallback((content: string) => mentions.getDraftMentionRefs(content).map(ref => ({...ref, isAgent: ref.isAgent === true || knownAgentKeys.has(ref.pubkey)})), [mentions.getDraftMentionRefs, knownAgentKeys]);
  const agentMentions = {...mentions, getDraftMentionRefs: getAgentDraftMentionRefs};
  const verifyMentionRecipients = React.useCallback(async (pubkeys: readonly string[]) => {
    const selected = pubkeys.filter(pubkey => knownAgentKeys.has(pubkey) || audience.pubkeys.includes(pubkey));
    if (!selected.length) return;
    const fresh = await agentDirectory.verify();
    if (fresh.channelId !== channelId || fresh.ownerPubkey !== session.devicePubkey ||
        selected.some(pubkey => !fresh.agents.some(agent => agent.pubkey === pubkey))) {
      throw new Error("Agent mention admission changed before publication");
    }
  }, [knownAgentKeys, audience.pubkeys, agentDirectory.verify, channelId, session.devicePubkey]);
  const syncAddressedAgentsFromTextRef = React.useRef<(text: string) => void>(() => {});
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
      getImplicitAgentMentionPrefix: implicitAgentMentionProvenance.getPrefix,
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
  const onEditLastOwnMessageRef = React.useRef(onEditLastOwnMessage);
  onEditLastOwnMessageRef.current = onEditLastOwnMessage;
  const editTargetRef = React.useRef(editTarget);
  editTargetRef.current = editTarget;
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
    customEmoji,
    placeholder: computedPlaceholder,
    editable: !composerDisabled,
    restoreFocusOnEnable: () => !compact || Boolean(contentRef.current.trim() || media.pendingImetaRef.current.length || media.queuedAttachmentsRef.current.length),
    mentionNames: mentions.knownNames,
    agentMentionNames: mentions.getDraftMentionRefs(contentRef.current).filter(ref => ref.isAgent === true).map(ref => ref.displayName),
    channelNames: channelLinks.knownChannelNames,
    messageLinkChannels: channelLinks.channels,
    getMentionIdentities: mentions.getMentionIdentities,
    onSubmit: () => submitMessageRef.current(),
    onEditLastOwnMessage: () => {
      if (editTargetRef.current) return false;
      const handler = onEditLastOwnMessageRef.current;
      return handler ? handler() : false;
    },
    isAutocompleteOpen: isAutocompleteOpenRef,
    onEditLink: (info) => onEditLinkRef.current?.(info),
    onLinkSelectionChange: (info) => onLinkSelectionChangeRef.current?.(info),
    onLinkShortcut: () => onLinkShortcutRef.current?.() ?? false,
    onUpdate: ({ cursor, linkPreviewContent, text }) => {
      trackAuthoredContent(text);
      contentRef.current = text;
      setComposerContentFromText(text);
      setPreviewContent(linkPreviewContent);
      if (!isSubmitLockedRef.current && !editTargetRef.current) syncAddressedAgentsFromTextRef.current(text);
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
  useComposerAutofocus(richText.focus, effectiveDraftKey, composerDisabled || compact);
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
  const addressPulse = useAddressMentionPulse();
  const autoPin = useAutoPinMentionedAgents({ audienceScope, enabled: keepMentionedAgentsPinned,
    getDisplayName: mentions.getMentionDisplayName, onPulse: addressPulse.pulseOne,
    onTurnOff: () => setKeepMentionedAgentsPinned(false), onTurnOn: () => setKeepMentionedAgentsPinned(true),
  });
  const addressLock = useAgentAddressLockPicker({ applyAutocompleteEdit, audience, audienceScope, mentions: agentMentions,
    onAddressAgentMention: suggestion => autoPin.promoteExplicitlyAddressedAgents({pubkeys: [suggestion.pubkey]}),
    onAutoPinAgentMention: (suggestion, options) => autoPin.promoteMentionedAgents({pubkeys: [suggestion.pubkey], ...options}),
    onImplicitPrefixInserted: implicitAgentMentionProvenance.add,
    onImplicitPrefixRemoved: implicitAgentMentionProvenance.remove,
    onPulseAddressLock: addressPulse.pulseOne, profiles, richText,
  });
  const selectMentionSuggestion = addressLock.selectMentionSuggestion;
  syncAddressedAgentsFromTextRef.current = addressLock.syncAddressedAgentsFromText;
  React.useEffect(() => {
    if (!editTarget) addressLock.restoreAddressedAgentMentions();
  }, [audienceScope, editTarget, addressLock.restoreAddressedAgentMentions]);
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
  const mentionPicker = useComposerMentionPicker({ mentions, richText, onTurnOffAutoPinConfirmation: autoPin.turnOffConfirmation });
  const getDefaultAgentSuggestion = React.useCallback(() => agents[0], [agents]);
  const handleAlwaysAddressShortcut = useAlwaysAddressShortcut({
    enabled: Boolean(audienceScope && !editTarget), lockedAgent: addressLock.lockedAgents[0],
    mentions: {...mentions, getDefaultAgentSuggestion}, onOpenPicker: mentionPicker.openMentionPicker,
    onToggle: addressLock.toggleAlwaysAddressAgent,
  });
  const submitMessage = React.useCallback(async () => {
    const trimmed = syncComposerContentFromEditor().trim();
    // Normal send
    const currentPendingImeta = media.pendingImetaRef.current;
    const currentQueuedAttachments = media.queuedAttachmentsRef.current;
    const hasMedia =
      currentPendingImeta.length > 0 || currentQueuedAttachments.length > 0;
    if (
      (!trimmed && !hasMedia && !(editTarget && onRequestEmptyEditDelete)) ||
      disabledRef.current ||
      voiceNote.statusRef.current !== "idle" ||
      isSendingRef.current ||
      isSubmitLockedRef.current ||
      isUploadingRef.current ||
      mentionSendFlow.isPreparingMentionSend
    ) {
      return;
    }
    if (!trimmed && !hasMedia && editTarget && onRequestEmptyEditDelete) {
      onRequestEmptyEditDelete(editTarget);
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
        addressedAgentPubkeys: audience.pubkeys,
        verifyMentionRecipients,
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
    editTarget,
    onRequestEmptyEditDelete,
    audience.pubkeys,
    verifyMentionRecipients,
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
      if (handleAlwaysAddressShortcut(event)) return;
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
      if (event.key === "Tab" && event.shiftKey && mentions.isMentionOpen && focusMentionOptionsTrigger(formRef.current)) {
        event.preventDefault();
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
      handleAlwaysAddressShortcut,
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
    (!(editTarget && onRequestEmptyEditDelete) && isContentEmpty &&
      media.pendingImeta.length === 0 &&
      media.queuedAttachments.length === 0);
  // Pinned Buzz MessageComposer.tsx keeps this callback empty; Tiptap owns selection.
  const handleCaptureSelection = React.useCallback(() => {}, []);
  const handlePaperclipClick = React.useCallback(() => {
    if (!voiceNote.hasAttachmentRef.current) void media.handlePaperclip();
  }, [media.handlePaperclip, voiceNote.hasAttachmentRef]);
  const acceptsDrop = ownsDropZone && voiceNote.acceptsAttachment;
  const ComposerSurface = surface === "forum" ? ForumComposerSurface : MessageComposerSurface;
  return <ComposerSurface
    {...(surface === "forum" ? { compact, confirmedSendRevision: mentionSendFlow.confirmedSendRevision,
      hasComposerContent: !isContentEmpty || media.pendingImeta.length > 0 || media.queuedAttachments.length > 0 ||
        media.uploadState.status === "error" || Boolean(mentionSendFlow.sendOutcome) || media.isDragOver,
      autocompleteOpen: mentions.isMentionOpen || channelLinks.isChannelOpen || emojiAutocomplete.isEmojiAutocompleteOpen,
    } : {})}
    submitLocked={isSubmitLocked}
    containerClassName={containerClassName} showTopBorder={showTopBorder}
    formRef={formRef} scrollRef={composerScrollRef} onEditorKeyDown={handleEditorKeyDown}
    header={<>
          {composerHeader}
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
    toolbar={{ layoutMode, composerDisabled, editor: richText.editor, customEmoji,
      addressedAgents: editTarget || composerDisabled ? [] : addressLock.lockedAgents,
      autoPinConfirmationTitle: autoPin.confirmationTitle,
      onAutoPinConfirmationDismiss: autoPin.dismissConfirmation,
      onAutoPinConfirmationHoverChange: autoPin.setConfirmationHovered,
      onAutoPinConfirmationTurnOff: mentionPicker.turnOff,
      onRemoveAddressedAgent: addressLock.removeAddressedAgent,
      pulseVersionByPubkey: addressPulse.pulseVersionByPubkey,
      shakeVersionByPubkey: addressPulse.shakeVersionByPubkey,
      extraActions: toolbarExtraActions, formattingDisabled: composerDisabled,
      isFormattingOpen, isSending: isSending || mentionSendFlow.isPreparingMentionSend,
      isUploading: media.isUploading, isVoiceNoteProcessing: voiceNote.status !== "recording",
      isVoiceNoteRecording: voiceNote.status !== "idle", hasVoiceNoteAttachment: voiceNote.hasAttachment,
      voiceNoteRecorder: voiceNote.recorderElement,
      onCaptureSelection: handleCaptureSelection,
      onFormattingToggle: setIsFormattingOpen, onLinkButton: linkEditor.openFromToolbar,
      onOpenMentionPicker: mentionPicker.openMentionSettings, onPaperclip: handlePaperclipClick,
      onFinishVoiceNote: () => void voiceNote.finish(), onVoiceNote: voiceNote.toggle, sendDisabled,
    }}>
            {acceptsDrop && media.isDragOver && <DropZoneOverlay />}
            <MessageComposerAutocompletes
              audienceControlsEnabled={Boolean(audienceScope && !editTarget)}
              lockedAgentPubkeys={addressLock.lockedAgentPubkeys}
              onToggleAlwaysAddressAgent={suggestion => addressLock.toggleAlwaysAddressAgent(suggestion, {preserveMention: true})}
              keepMentionedAgentsPinned={keepMentionedAgentsPinned}
              onKeepMentionedAgentsPinnedChange={setKeepMentionedAgentsPinned}
              openOptionsRequest={autoPin.openOptionsRequest}
              onOptionsRevealComplete={autoPin.completeOptionsReveal}
              position={autocompleteBelow ? "below" : "above"}
              channelLinks={channelLinks}
              composerOwnsFocus={composerOwnsFocus}
              emojiAutocomplete={emojiAutocomplete}
              mentions={mentions}
              onChannelSelect={applyChannelInsert}
              onEmojiSelect={applyEmojiInsert}
              onMentionSelect={selectMentionSuggestion}
            />
            <output aria-live="polite" className="sr-only" data-testid="composer-address-lock-status">{addressLock.announcement}</output>
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
