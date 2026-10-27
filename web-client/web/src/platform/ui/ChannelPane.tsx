import { MessageComposerAutocompletes } from "@client-kit/platform/react/composer/features/messages/ui/MessageComposerAutocompletes";
import { useComposerMentionPicker } from "@client-kit/platform/react/composer/features/messages/ui/useComposerMentionPicker";
import { useComposerFocusOwnership } from "@client-kit/platform/react/composer/features/messages/lib/useComposerFocusOwnership";
import { useComposerMentions } from "@client-kit/platform/react/composer/features/messages/lib/useComposerMentions";
import { isMentionCodeContext } from "@client-kit/platform/react/composer/features/messages/lib/mentionCodeContext";
import { useComposerDraftRestore } from "@client-kit/platform/react/composer/useComposerDraftLifecycle";
import { useComposerContentState } from "@client-kit/platform/react/composer/useComposerContentState";
import { useMessageComposerController, useComposerControls, composerKeyDown, useComposerSubmission, useComposerAutoSubmit } from "@client-kit/platform/react/composer/useMessageComposerController";
import { extractMentionPubkeys, mentionMatchCandidates, mentionOccurrences, AmbiguousMentionError } from "@client-kit/platform/react/pulse";
import { type MentionSuggestion } from "@client-kit/platform/react/composer/features/messages/ui/MentionAutocomplete";
import { useComposerChannelLinkSources } from "@client-kit/platform/react/composer/features/messages/ui/ComposerChannelLinksContext";
import { useChannelLinks, type ChannelSuggestion } from "@client-kit/platform/react/composer/features/messages/lib/useChannelLinks";
import { useEmojiAutocomplete, type EmojiSuggestion } from "@client-kit/platform/react/composer/features/messages/lib/useEmojiAutocomplete";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { useComposerAgentDirectory } from "@client-kit/platform/react/composer/features/messages/ui/useComposerAgentDirectory";
import { useTeamMentionCandidates } from "@client-kit/platform/react/composer/features/messages/ui/useTeamMentionCandidates";
import { isTeamMentionSuggestion } from "@client-kit/platform/react/composer/features/messages/lib/teamMentionCandidates";
import { useDmAgentMentionNames } from "@client-kit/platform/react/composer/dmAgentMention";
import { ComposerPendingSendRecovery, ComposerQueuedSendPill } from "./ComposerQueuedSendPill";
import { getPersistentAgentAudienceScope } from "@client-kit/platform/react/composer/features/messages/lib/persistentAgentAudience";
import { setKeepMentionedAgentsPinned } from "@client-kit/platform/react/composer/features/messages/lib/autoPinMentionedAgentsPreference";
import { useThreadAgentAudience } from "@client-kit/platform/react/composer/features/messages/ui/useThreadAgentAudience";
import { useAgentAddressLockPicker } from "@client-kit/platform/react/composer/features/messages/ui/useAgentAddressLockPicker";
import { useAddressMentionPulse } from "@client-kit/platform/react/composer/features/messages/ui/useAddressMentionPulse";
import { useAutoPinMentionedAgents } from "@client-kit/platform/react/composer/features/messages/ui/useAutoPinMentionedAgents";
import { useAlwaysAddressShortcut } from "@client-kit/platform/react/composer/features/messages/ui/useAlwaysAddressShortcut";
import { useImplicitAgentMentionProvenance } from "@client-kit/platform/react/composer/features/messages/ui/useImplicitAgentMentionProvenance";
import { stripImplicitAgentMentionPrefix } from "@client-kit/platform/react/composer/features/messages/lib/stripImplicitAgentMentions";
// 频道（SS-WEB-RELAY、SS-WEB-01）：消息、附件、已读位置。
//
// 全部经 BFF：流、发布、媒体上传与读取、已读写入。这里没有 Relay 地址，也没有
// signer——签名由 BFF 以本人身份代做。

import { PublishRestrictionKind, ReasonCode, WebMessageType, type ReadMarkRequest, type ConversationView, type ConversationParticipant, type WorkspaceMemberView } from "@client-kit/contracts";
import { useBffCustomEmojiPalette } from "@client-kit/platform/react/custom-emoji";
import { ConversationPreparationPending, useConversationInvalidation } from "@client-kit/platform/react/new-message";
import { isOutcomeUnknown, TransportError } from "@client-kit/platform/transport";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useBrowserNotifications } from "./BrowserNotifications";
import { formatMessageNotification } from "@client-kit/platform/react/notifications";
import { MessageContent, type MessageMention } from "@/features/chat/ui/MessageContent";
import {
  BffError,
  bff,
  type BuzzEvent,
  type MediaDescriptor,
  type MediaUploadOptions,
  markRead,
  publishMessage,
  publishConversationMessage,
  uploadConversationMedia,
  uploadMedia,
  mediaUrl,
  deleteMessage,
  publishTyping,
  prepareLinkPreview,
  publishLinkPreviewRemoval,
  type LinkPreviewPublication,
} from "@/platform/bff-client";
import { useGifCapability } from "@/platform/gif-capability";
import { ComposerLinkPreviewCards, ComposerLinkPreviewPreparing, useComposerLinkPreviews, type PrepareLinkPreview } from "@client-kit/platform/react/link-preview";
import { ComposerGifAttachments, withGifLines } from "@client-kit/platform/react/gifs";
import type { WebGifItem } from "@client-kit/contracts";
import { useTypingBroadcast } from "./useTypingBroadcast";
import { platformQueries } from "@/platform/ui/queries";
import { t } from "@/shared/i18n";
import { toast } from "sonner";
import { AgentMentionStatus, MessageRowSurface, MessageActionBarSurface, SentFromThreadLine, SentFromThreadLink, canManageMessageForCurrentUser, getThreadReference, useMessageDeleteDialog, reactionThreadInteractionRoots, type MessageModerationContext, type TimelineMessage } from "@client-kit/platform/react/messages";
import { ComposerTimeoutBanner, clearTimeoutState, recordTimeoutFromRestriction, useTimeoutState } from "@client-kit/platform/react/moderation";
import { useAgentMentionOutcomes, type MentionableAgent } from "./useAgentMentionOutcomes";
import { useCollaborationPreferences } from "@client-kit/platform/react/collaboration-preferences";
import { buildMessageLink } from "@client-kit/platform/react/composer/features/messages/lib/messageLink";
import { buildMentionClipboardHtml } from "@client-kit/platform/react/composer/features/messages/lib/mentionClipboard";
import { resolveMessageMentionClipboard } from "@client-kit/platform/react/messages/resolveMentionNames";
import { Button } from "@/shared/ui/button";
import { MessageComposerSurface } from "@client-kit/platform/react/composer/MessageComposerSurface";
import { ChannelThreadPane } from "./ChannelThreadPane";
import { useChannelAgentActivityPanel } from "./ChannelAgentActivityPanel";
import { AgentActivityOpenerProvider } from "@client-kit/platform/react/agent-transcript";
import { BffVideoReviewProvider } from "@/features/chat/ui/BffVideoReview";
import { useWorkspaceThread } from "./useWorkspaceThread";
import { ChannelTimelineRows } from "./ChannelTimelineRows";
import { useChannelWindow } from "./useChannelWindow";
// DD-125(6): original ChannelComposerActivityAccessory (working Agents + typing) over the shared signal.
import { ChannelComposerActivityAccessory, useChannelAgentActivity, type BotActivityAgent } from "@client-kit/platform/react/agent-activity";
import { loadWorkspaceAgents } from "@client-kit/platform/react/agent-installation-view";
import { unknownMemberLabel } from "@client-kit/platform/react/messages/system/identity";
import { ComposerDockBackdrop } from "@client-kit/platform/react/thread/ComposerDockBackdrop";
import { useMessageReactions } from "./useMessageReactions";
import { BffAudioAttachment } from "@/features/chat/ui/BffAudioAttachment";
import { CHANNEL_TIMELINE_CONTENT_KINDS, KIND_STREAM_MESSAGE_DIFF, isConversationalUnreadKind } from "@client-kit/platform/react/thread/kinds";
import { MessageThreadSummaryRow, ThreadRepliesErrorCard, getThreadRouteTarget, getRouteMainTimelineTargetId, useChannelMessageEdit, buildThreadPanelIndex } from "@client-kit/platform/react/thread";
import { isBroadcastReply, isThreadReply } from "@client-kit/platform/react/messages/threading";
import { SystemMessageRowSurface } from "@client-kit/platform/react/messages/system";
import { MemberHover, MemberProfilePanel } from "@client-kit/platform/react/members";
import { loadConversationParticipants, type MemberProfileRequest } from "@client-kit/platform/react/channel-members";
import { NonMemberMentionDialog, inviteAndAwaitActive, nonMemberInvitePrincipals, outsideMentionPeople, resolveNonMemberInviteAdmission,
  tenantMentionDirectoryQuery, useNonMemberInvite, useTenantMentionDirectory, withoutInvitingRecipients, type NonMemberInvitePrincipal } from "@client-kit/platform/react/non-member-mentions";
import { useElementWidth } from "@client-kit/platform/react/sidebar/use-mobile";
import { UserProfilePopoverSurface } from "@client-kit/platform/react/pulse";
import { MessageTimelineSurface, type MessageTimelineHandle } from "@client-kit/platform/react/messages/timeline/MessageTimelineSurface";
import { FocusThreadDrawer } from "@client-kit/platform/react/thread/FocusThreadDrawer";
import { useThreadViewMode } from "@client-kit/platform/react/thread/threadViewModePreference";
import { useFocusDrawerPresence, useRoutedMessageEdit, useThreadPanelSurface, useThreadPanelWidth, IdleAuxiliarySurface, shouldPrioritizeIdleAuxiliary, shouldUseFocusIdleDrawer, type IdleAuxiliaryProps } from "@client-kit/platform/react/thread";
import { AnimatePresence } from "motion/react";
import { useIsThreadPanelOverlay } from "@client-kit/platform/react/thread";
import { MessageAuthorAvatar, MessageAuthorIdentity, useMessageAuthorLabels, MessageAuthorProfile } from "./MessageAuthorProfile";
import { resolveConversationHeaderParticipants, formatDmParticipantDisplayName } from "@client-kit/platform/react/conversations/dm-participant-display";
import { UserAvatar, agentAddressHost, useAgentAuthorFacts, withAgentAuthorFacts, type AgentAuthorFacts, type AgentOwnerRenderer } from "@client-kit/platform/react/messages";
import type { MessageTimelineProps } from "@client-kit/platform/react/messages/timeline/types";
import { useSearchHighlightProps } from "@client-kit/platform/react/search/useSearchHighlightProps";
import { useUiT } from "@client-kit/platform/react/context";
import { ComposerReplyBanner } from "@client-kit/platform/react/messages";
import { applyMessageEdits, imetaMediaFromTags, restoreImetaMediaDisplayLabels, stripImetaMediaLines, findSpoileredImetaMediaUrls, canRemoveLinkPreviews, useRemoveLinkPreviewsIntent, type LinkPreviewRemovalEdit } from "@client-kit/platform/react/messages";
import { ForumComposerSurface } from "@client-kit/platform/react/forum/ForumComposerSurface";
import { useComposerPasteHandler } from "@client-kit/platform/react/composer/features/messages/ui/useComposerPasteHandler";
import { useComposerVoiceNote } from "@client-kit/platform/react/composer/features/messages/ui/useComposerVoiceNote";
import { partitionMentionIdentitiesByLocalTrust } from "@client-kit/platform/react/composer/features/messages/lib/mentionIdentityTrust";
import type { ParsedMessageLink } from "@client-kit/platform/react/composer/features/messages/lib/messageLink";
import { initDraftStore, loadDraftEntry, saveDraftEntry, clearDraftEntry, savePendingSend, loadPendingSend, clearPendingSend, subscribeToStore, type PendingSendStage, type PendingSendState } from "@client-kit/platform/react/composer/features/messages/lib/useDrafts";
import { ComposerAttachments, DropZoneOverlay } from "@client-kit/platform/react/composer/features/messages/ui/ComposerAttachments";
import type { UploadingAttachmentPreview } from "@client-kit/platform/react/composer/features/messages/lib/attachmentPreview";
import { useComposerAttachmentSpoilers } from "@client-kit/platform/react/composer/features/messages/ui/useComposerAttachmentSpoilers";
import type { ImetaMedia } from "@client-kit/platform/react/composer/features/messages/lib/imetaMediaMarkdown";

const toIso = (unix: number) => new Date(unix * 1_000).toISOString();
// DD-121 renewal entry: the same governed Installation/delegation dialogs as the Agents page.
const WorkspaceAgentDialogs = lazy(() => import("@client-kit/platform/react/pages").then((module) => ({ default: module.WorkspaceAgentDialogs })));

/** A mentioned Agent is no longer in this member's fresh, authorized directory (05 §2.10). */
class MentionAgentNotAllowedError extends Error {}

/** DD-125(5): the link-preview part frozen in an unresolved send intent's signature, so a
 * retry with the same key names exactly the same snapshots (or suppression) again. */
function frozenLinkPreviews(signature: string | undefined): LinkPreviewPublication | undefined {
  if (!signature) return undefined;
  try {
    const parsed: unknown = JSON.parse(signature);
    const last = Array.isArray(parsed) ? parsed[parsed.length - 1] : undefined;
    if (last && typeof last === "object" && !Array.isArray(last) && "linkPreviews" in last) {
      return (last as { linkPreviews: LinkPreviewPublication }).linkPreviews;
    }
  } catch { /* An unreadable signature names no previews. */ }
  return undefined;
}

/** DD-125(8): the reference-only mentions ("send without inviting") frozen in an unresolved
 * send intent, so a retry with the same key repeats the same choice instead of prompting anew. */
function frozenReferenceMentions(signature: string | undefined): string[] | undefined {
  if (!signature) return undefined;
  try {
    const parsed: unknown = JSON.parse(signature);
    if (!Array.isArray(parsed)) return undefined;
    for (const entry of parsed) {
      if (entry && typeof entry === "object" && !Array.isArray(entry) && "referenceMentionPubkeys" in entry) {
        const keys = (entry as { referenceMentionPubkeys: unknown }).referenceMentionPubkeys;
        return Array.isArray(keys) && keys.every((key) => typeof key === "string") ? keys as string[] : undefined;
      }
    }
  } catch { /* An unreadable signature names no references. */ }
  return undefined;
}

/** DD-125(8): the person's choice in the non-member prompt for the people it named. */
type NonMemberDecision = { kind: "invited" | "reference"; pubkeys: readonly string[] };
type NonMemberPrompt = { owner: object; workspaceId: string; pubkeys: string[]; principals: NonMemberInvitePrincipal[]; names: string[]; canInvite: boolean };

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
  threadHeadId,
  onThreadHeadIdChange,
  onClearMessageRouteTarget,
  onNavigationGuardChange,
  channelName,
  channelId: admittedChannelId,
  myPrincipalId,
  onReadStateChanged,
  onMarkChannelUnread,
  onClearChannelManualUnread,
  conversation,
  onOpenMessageLink,
  targetMessageId,
  targetThreadRootId,
  targetSearchMessageId,
  targetSearchQuery,
  targetSearchActivationId,
  autoSendDraftKey,
  onAutoSendConsumed,
  restoreDraftKey,
  archived = false,
  metadataPending = false,
  restoreEditEventId,
  onStartDm,
  memberProfileRequest,
  onHeaderActionsCompactChange,
  idleAuxiliaryPanel,
  idleAuxiliaryHeaderActions,
  idleAuxiliaryOverridesThread = false,
  idleAuxiliaryTitle,
  onCloseIdleAuxiliaryPanel,
}: IdleAuxiliaryProps & {
  workspaceId: string;
  threadHeadId: string | null;
  onThreadHeadIdChange: (headId: string | null, options?: import("@client-kit/platform/react/use-history-search-state").HistorySearchSetterOptions) => void;
  onClearMessageRouteTarget: () => void;
  onNavigationGuardChange: (guard: (() => boolean) | null) => void;
  channelName?: string;
  channelId?: string;
  myPrincipalId: string;
  onReadStateChanged?: () => void | Promise<void>;
  onMarkChannelUnread?: (channelId: string) => void;
  onClearChannelManualUnread?: (channelId: string) => void;
  conversation?: ConversationView;
  onOpenMessageLink?: (link: ParsedMessageLink) => void;
  targetMessageId?: string;
  targetThreadRootId?: string;
  targetSearchMessageId?: string;
  targetSearchQuery?: string;
  targetSearchActivationId?: string;
  autoSendDraftKey?: string;
  onAutoSendConsumed?: () => void | Promise<void>;
  restoreDraftKey?: string;
  archived?: boolean;
  metadataPending?: boolean;
  restoreEditEventId?: string;
  onStartDm?: (pubkey: string) => void;
  /** Header members dialog request; rendered only while this member stays ACTIVE here. */
  memberProfileRequest?: MemberProfileRequest;
  /** Original ChannelScreen shouldCompactHeaderActions, reported to the host-owned header. */
  onHeaderActionsCompactChange?: (compact: boolean) => void;
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
  const notifyTyping = useTypingBroadcast(conversation ? `conversation:${conversation.id}` : workspaceId ? `workspace:${workspaceId}` : null,
    () => publishTyping(conversation ? { conversationId: conversation.id } : { workspaceId }));
  const { events: rawEvents, status, live, denied } = window;
  const searchHighlightProps = useSearchHighlightProps(targetSearchMessageId, targetSearchQuery);
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
  useLayoutEffect(() => {
    onNavigationGuardChange(() => denied || requireThreadEditResolution());
    return () => onNavigationGuardChange(null);
  }, [onNavigationGuardChange, denied, requireThreadEditResolution]);
  const [composerBusy, setComposerBusy] = useState(false);
  const restoredEdit = useRef(false);
  const timelineRef = useRef<MessageTimelineHandle>(null);
  const onMessageSendingChange = useCallback((sending: boolean) => {
    setComposerBusy(sending);
    if (sending) timelineRef.current?.scrollToBottomOnNextUpdate();
  }, []);
  const [selectedReplyId, setSelectedReplyId] = useState<string | null>(null);
  const [optimisticThreadHeadId, setOptimisticThreadHeadId] = useState<string | null>();
  const effectiveThreadHeadId = optimisticThreadHeadId === undefined ? threadHeadId : optimisticThreadHeadId;
  const threadScope = JSON.stringify([myPrincipalId, workspaceId, conversation?.id]);
  const previousThreadScope = useRef(threadScope);
  useEffect(() => {
    const changedScope = previousThreadScope.current !== threadScope;
    previousThreadScope.current = threadScope;
    if (changedScope) setSelectedReplyId(null);
    setOptimisticThreadHeadId(current =>
      changedScope || threadHeadId === current ? undefined : current);
  }, [threadScope, threadHeadId]);
  const [profileTarget, setProfileTarget] = useState<TimelineMessage | null>(null);
  const [systemProfileTarget, setSystemProfileTarget] = useState<{workspaceId:string;principalId:string;pubkey:string;alternatePubkeys?:readonly string[];displayName?:string} | null>(null);
  // Original DM member dialog profile: the conversation's participant key is its own proof.
  const [participantProfileTarget, setParticipantProfileTarget] = useState<{conversationId:string;principalId:string;pubkey:string;alternatePubkeys?:readonly string[];displayName?:string} | null>(null);
  const closeProfile = useCallback(() => { setProfileTarget(null); setSystemProfileTarget(null); setParticipantProfileTarget(null); }, []);
  const handleOpenAuthor = useCallback(
    (message: TimelineMessage) => {
      if (!requireThreadEditResolution()) return;
      setParticipantProfileTarget(null);
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
      setParticipantProfileTarget(null);
      const headId = getThreadReference(message.tags ?? []).rootId ?? message.id;
      setSelectedReplyId(message.id);
      setOptimisticThreadHeadId(headId);
      onClearMessageRouteTarget();
      onThreadHeadIdChange(headId);
    },
    [handleCancelEdit, requireThreadEditResolution, onClearMessageRouteTarget, onThreadHeadIdChange],
  );
  const handleCloseThread = useCallback(() => {
    if (!requireThreadEditResolution()) return;
    setSelectedReplyId(null);
    setOptimisticThreadHeadId(null);
    onClearMessageRouteTarget();
    onThreadHeadIdChange(null);
  }, [requireThreadEditResolution, onClearMessageRouteTarget, onThreadHeadIdChange]);
  const handleEditConfirmed = useCallback(
    (message: TimelineMessage) => {
      setEditTarget((current) => (current?.id === message.id ? null : current));
    },
    [setEditTarget],
  );
  // DD-142: owned Agents are known only after the composer directory loads below; the delete
  // callback reads the latest set through this ref.
  const ownedAgentPubkeysRef = useRef<ReadonlySet<string>>(new Set());
  const canDelete = live && !denied && !archived && !metadataPending && !composerBusy &&
    ownProfile.isSuccess && !ownProfile.isFetching && Boolean(ownProfile.data?.pubkey) && (!conversation || conversation.state === "ACTIVE");
  // DD-125(5) original "Remove preview" for everyone: the author's own 40003 with the
  // suppression flag; one idempotency key per message while its outcome is unknown.
  const removeLinkPreviews = useRemoveLinkPreviewsIntent(useCallback(async (message: TimelineMessage, edit: LinkPreviewRemovalEdit, key: string) => {
    if (message.signerPubkey !== ownProfile.data?.pubkey) throw new Error("Preview removal identity is unavailable.");
    await publishLinkPreviewRemoval(conversation ? { conversationId: conversation.id } : { workspaceId }, message.id, edit, key);
  }, [conversation, workspaceId, ownProfile.data?.pubkey]));
  const deleteMessageDialog = useMessageDeleteDialog(
    JSON.stringify([myPrincipalId, ownProfile.data?.pubkey, conversation?.id ?? workspaceId]), canDelete,
    async (message) => {
      if (!canDelete || !canManageMessageForCurrentUser(message, ownProfile.data?.pubkey, conversation ? undefined : ownedAgentPubkeysRef.current)) throw new Error("Deletion identity or scope is unavailable.");
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
  useEffect(() => { setParticipantProfileTarget(null); }, [conversation?.id, myPrincipalId, denied, live]);
  useEffect(() => {
    if (!memberProfileRequest || !conversation || memberProfileRequest.conversationId !== conversation.id) return;
    setProfileTarget(null);
    setParticipantProfileTarget({conversationId: conversation.id, principalId: memberProfileRequest.principalId, pubkey: memberProfileRequest.pubkey,
      alternatePubkeys: memberProfileRequest.alternatePubkeys, displayName: memberProfileRequest.displayName});
  }, [memberProfileRequest, conversation]);
  useEffect(() => {
    if (!memberProfileRequest || conversation || memberProfileRequest.workspaceId !== workspaceId) return;
    setProfileTarget(null);
    setSystemProfileTarget({workspaceId, principalId: memberProfileRequest.principalId, pubkey: memberProfileRequest.pubkey,
      alternatePubkeys: memberProfileRequest.alternatePubkeys, displayName: memberProfileRequest.displayName});
  }, [memberProfileRequest, conversation, workspaceId]);
  const visible = useVisible();
  const members = useQuery({
    queryKey: ["platform", conversation ? "conversation-members" : "members", workspaceId, myPrincipalId,
      conversation ? {conversationId:conversation.id,participantPrincipalIds:conversation.participantPrincipalIds} : null],
    queryFn: async () => {
      if (!conversation) return bff.members(workspaceId);
      return loadConversationParticipants(bff, conversation);
    },
  });
  const userState = useQuery(platformQueries.userState);
  const mentionPeople = useMemo(() => mentionPeopleFromMembers(members.isSuccess && !members.isError ? members.data ?? [] : []),
    [members.data, members.isSuccess, members.isError]);
  // DD-125(8): a Workspace channel judges "outside this channel" only against a resolved roster.
  const nonMemberMentionWorkspaceId = !conversation && members.isSuccess && !members.isError ? workspaceId : undefined;
  const conversationInvalidation = useConversationInvalidation();
  useEffect(() => {
    if (conversation) void queryClient.invalidateQueries({ queryKey: platformQueries.userState.queryKey });
  }, [conversation?.id, conversationInvalidation?.revision, queryClient]);

  // Admitted profile first, then the DD-77 member name and original npub fallback.
  const byPubkey = useMemo(
    () => new Map((members.data ?? []).flatMap((m) => m.pubkeys.map((k) => [k, m] as const))),
    [members.data],
  );
  const mine = useMemo(
    () => new Set((members.data ?? []).find((m) => m.principalId === myPrincipalId)?.pubkeys),
    [members.data, myPrincipalId],
  );
  const typingAgents = useComposerAgentDirectory(bff, {workspaceId, principalId: myPrincipalId}, !conversation && live && !denied && !metadataPending);
  const agentTypingPubkeys = useMemo(() => new Set(typingAgents.data?.agents.map(agent => agent.pubkey.toLowerCase())), [typingAgents.data]);
  // DD-147/148: owner line, owner-only respondTo badge and address prefix from the same directory.
  // DD-147(1): the member-readable author directory, not the read-filtered Installation list.
  const agentFacts: AgentAuthorFacts = useAgentAuthorFacts(bff,
    !conversation && live && !denied && !metadataPending ? {workspaceId, principalId: myPrincipalId} : null);
  const agentAddress = useMemo(() => agentAddressHost(agentFacts), [agentFacts]);
  // Original canManageMessageForCurrentUser "own Agent": Installations this person owns here.
  const ownedAgentPubkeys = useMemo(() => new Set(typingAgents.data?.agents
    .filter(agent => agent.installation.ownerPrincipalId === myPrincipalId).map(agent => agent.pubkey.toLowerCase())),
  [typingAgents.data, myPrincipalId]);
  ownedAgentPubkeysRef.current = ownedAgentPubkeys;
  // DD-125(6): the original Agent activity panel, for Installation `audit` holders only.
  const agentActivityPanel = useChannelAgentActivityPanel({agents: typingAgents.data?.agents, channelName,
    channelId: conversation ? null : admittedChannelId ?? null, scopeId: conversation ? null : workspaceId,
    enabled: !conversation && live && !denied});
  // DD-125(1): thread follow/mute live in Core CollaborationUserState (shared provider).
  const preferences = useCollaborationPreferences();
  // DD-125(6): every Agent this person may read (not only those they may invoke) is an Agent for
  // the working signal; its 20002 never shows as a person typing.
  const channelAgents = useQuery({
    queryKey: ["platform", "channel-agents", workspaceId],
    queryFn: () => loadWorkspaceAgents(bff, workspaceId),
    enabled: !conversation && live && !denied && !metadataPending,
    retry: false,
  });
  const readableAgents = channelAgents.isSuccess && Array.isArray(channelAgents.data) ? channelAgents.data : undefined;
  const agentActivity = useChannelAgentActivity({ client: bff, channelId: conversation ? null : workspaceId,
    agents: readableAgents, typingEntries: window.typing, enabled: !conversation && live && !denied && !metadataPending });
  const { openAgentActivity } = agentActivityPanel.opener;
  const workingAgents = useMemo<BotActivityAgent[]>(() => (readableAgents ?? []).flatMap((row) => row.agentPubkey ? [{
    pubkey: row.agentPubkey,
    name: row.agentDisplayName?.trim() || (typingAgents.data?.agents.find((agent) => agent.installation.resourceId === row.resourceId)?.displayName ?? unknownMemberLabel(uiT)),
    ...(row.canAudit === true ? { auditInstallationId: row.resourceId } : {}),
  }] : []), [readableAgents, typingAgents.data, uiT]);
  const humanTypingEntries = window.typing.filter(entry => !mine.has(entry.pubkey)
    && entry.pubkey !== ownProfile.data?.pubkey && !agentTypingPubkeys.has(entry.pubkey)
    && !agentActivity.agentPubkeys.has(entry.pubkey.toLowerCase()));
  const typingPubkeys = humanTypingEntries
    .filter(entry => entry.threadHeadId === null)
    .map(entry => entry.pubkey);
  const authorLabel = useMessageAuthorLabels({principalId: myPrincipalId, workspaceId, conversationId: conversation?.id},
    events, live && !denied && !metadataPending);
  const timelineMessages = useMemo<TimelineMessage[]>(() => events.map((event) => withAgentAuthorFacts({
    id: event.id, createdAt: event.created_at, pubkey: event.pubkey,
    signerPubkey: event.pubkey, author: authorLabel(event, byPubkey.get(event.pubkey)?.displayName),
    body: event.content, tags: event.tags, kind: event.kind, time: "", depth: 0, reactions:messageReactions.reactions.get(event.id),
    edited: event.edited, isAgent: agentTypingPubkeys.has(event.pubkey.toLowerCase()), ...getThreadReference(event.tags),
  }, agentFacts)), [events, byPubkey, messageReactions.reactions, authorLabel, agentTypingPubkeys, agentFacts]);
  // Original ChannelScreen merges freshly read route context with its channel
  // window. Search results and URL ids are not permission to reuse stale bodies.
  const routeReadId = targetMessageId ?? effectiveThreadHeadId;
  const routeReadRootId = targetMessageId ? targetThreadRootId ?? targetMessageId : effectiveThreadHeadId;
  const routeContextEnabled = Boolean(routeReadId && live && !denied && !metadataPending);
  const routeContext = useWorkspaceThread(myPrincipalId, workspaceId, routeReadRootId ?? "", conversation?.id, undefined, routeContextEnabled, conversation?.channelId);
  useEffect(() => {
    if (routeContextEnabled && !routeContext.denied && !routeContext.thread.isError && routeContext.thread.hasNextPage && !routeContext.thread.isFetchingNextPage) void routeContext.thread.fetchNextPage();
  }, [routeContextEnabled, routeContext.denied, routeContext.thread.isError, routeContext.thread.hasNextPage, routeContext.thread.isFetchingNextPage, routeContext.thread.fetchNextPage]);
  const routeContextReady = routeContextEnabled && !routeContext.denied && !routeContext.interrupted && routeContext.thread.isSuccess && !routeContext.thread.isError && !routeContext.thread.isFetching;
  // A same-key background refetch is not revocation and must not unmount a
  // mounted editor. Never retain this data after an actual read failure.
  const routeContextAvailable = Boolean(routeReadId && live && !denied && !routeContext.denied && !routeContext.interrupted && routeContext.thread.isSuccess && !routeContext.thread.isError);
  const routeAuthorLabel = useMessageAuthorLabels({principalId: myPrincipalId, workspaceId, conversationId: conversation?.id},
    routeContext.messages, routeContextAvailable);
  const routeMessages = useMemo<TimelineMessage[]>(() => routeContextAvailable ? routeContext.messages.map(event => withAgentAuthorFacts({
    id: event.id, createdAt: event.createdAt, pubkey: event.pubkey, signerPubkey: event.pubkey,
    author: routeAuthorLabel(event, byPubkey.get(event.pubkey)?.displayName),
    body: event.content, tags: event.tags, kind: event.kind, time: "", depth: 0,
    edited: event.edited, isAgent: agentTypingPubkeys.has(event.pubkey.toLowerCase()), ...getThreadReference(event.tags),
  }, agentFacts)) : [], [routeContextAvailable, routeContext.messages, byPubkey, routeAuthorLabel, agentTypingPubkeys, agentFacts]);
  const routeMessageById = useMemo(() => new Map([...timelineMessages, ...routeMessages].map(message => [message.id, message])), [timelineMessages, routeMessages]);
  // DD-121: own top-level and open-thread messages that @mention a channel Agent (Workspace channels only).
  const mentionAgents = useMemo<MentionableAgent[]>(() => (typingAgents.data?.agents ?? []).map(agent =>
    ({pubkey: agent.pubkey, displayName: agent.displayName, installationId: agent.installation.resourceId})), [typingAgents.data]);
  const mentionMessages = useMemo(() => [...timelineMessages, ...routeMessages], [timelineMessages, routeMessages]);
  const agentMentions = useAgentMentionOutcomes({workspaceId, principalId: myPrincipalId,
    ownPubkey: ownProfile.isSuccess ? ownProfile.data.pubkey : undefined, agents: mentionAgents, messages: mentionMessages,
    enabled: !conversation && live && !denied && !metadataPending, fallbackName: uiT("agentMention.unknownAgent")});
  const [renewInstallationId, setRenewInstallationId] = useState<string | null>(null);
  const [agentDialogsMounted, setAgentDialogsMounted] = useState(false);
  const renewDelegation = useCallback((installationId: string) => {
    setAgentDialogsMounted(true);
    setRenewInstallationId(installationId);
  }, []);
  const renderAgentMentionStatus = (message: TimelineMessage) => {
    const entries = agentMentions.entriesFor(message.id);
    return entries ? <AgentMentionStatus entries={entries} onRenewDelegation={renewDelegation} /> : undefined;
  };
  const selectedReply = selectedReplyId ? routeMessageById.get(selectedReplyId) : undefined;
  const threadReadUnavailable = !routeContext.thread.isSuccess || routeContext.denied || routeContext.interrupted || routeContext.thread.isError;
  const threadAdmissionAvailable = live && !denied && (!effectiveThreadHeadId || !threadReadUnavailable);
  const replyTarget = effectiveThreadHeadId && threadAdmissionAvailable
    ? selectedReply && (getThreadReference(selectedReply.tags ?? []).rootId ?? selectedReply.id) === effectiveThreadHeadId
      ? selectedReply : routeMessageById.get(effectiveThreadHeadId) ?? null
    : null;
  const useFocusThreadDrawer = Boolean(replyTarget && focusThread && !profileTarget && !systemProfileTarget && !participantProfileTarget);
  const idleWidth = useThreadPanelWidth();
  const hasIdleAuxiliary = Boolean(idleAuxiliaryPanel && onCloseIdleAuxiliaryPanel && live && !denied && !metadataPending);
  const priorityIdleAuxiliary = shouldPrioritizeIdleAuxiliary(idleAuxiliaryOverridesThread, hasIdleAuxiliary);
  const overlayIdleAuxiliaryOverThread = priorityIdleAuxiliary && Boolean(replyTarget) && !threadOverlay;
  const replaceThreadWithIdleAuxiliary = priorityIdleAuxiliary && Boolean(replyTarget) && threadOverlay;
  const useFocusIdleDrawer = shouldUseFocusIdleDrawer({channelManagementOpen:false,hasAgentSession:false,
    hasIdleAuxiliaryPanel:hasIdleAuxiliary,hasIdlePanelCloseHandler:Boolean(onCloseIdleAuxiliaryPanel),
    hasProfilePanel:Boolean(profileTarget||systemProfileTarget||participantProfileTarget),hasThreadSurface:Boolean(replyTarget),
    overrideThread:overlayIdleAuxiliaryOverThread,useSplitAuxiliaryPane:!threadOverlay});
  const showIdleAuxiliaryOverThread = overlayIdleAuxiliaryOverThread && useFocusIdleDrawer;
  const { channelIsCovered, markExitComplete } = useFocusDrawerPresence(useFocusThreadDrawer || useFocusIdleDrawer,
    priorityIdleAuxiliary ? onCloseIdleAuxiliaryPanel ?? handleCloseThread : useFocusThreadDrawer ? handleCloseThread : onCloseIdleAuxiliaryPanel ?? handleCloseThread);
  const threadSurface = useThreadPanelSurface(showIdleAuxiliaryOverThread,markExitComplete);
  const [paneRef, paneWidthPx] = useElementWidth<HTMLDivElement>();
  const compactHeaderActions = Boolean(replyTarget || profileTarget || systemProfileTarget || participantProfileTarget || hasIdleAuxiliary)
    && paneWidthPx > 0 && paneWidthPx < 760;
  useEffect(() => { onHeaderActionsCompactChange?.(compactHeaderActions); }, [compactHeaderActions, onHeaderActionsCompactChange]);
  useEffect(() => () => onHeaderActionsCompactChange?.(false), [onHeaderActionsCompactChange]);
  const idleAuxiliarySurface = hasIdleAuxiliary ? <IdleAuxiliarySurface key="idle-auxiliary-surface"
    idleAuxiliaryPanel={idleAuxiliaryPanel} idleAuxiliaryHeaderActions={idleAuxiliaryHeaderActions}
    idleAuxiliaryTitle={idleAuxiliaryTitle} onCloseIdleAuxiliaryPanel={onCloseIdleAuxiliaryPanel}
    channelName={channelName} isFocusDrawer={useFocusIdleDrawer} isSinglePanelView={false} useSplitAuxiliaryPane={!threadOverlay}
    canResetWidth={idleWidth.canReset} onResetWidth={idleWidth.onResetWidth} onResizeStart={idleWidth.onResizeStart} widthPx={idleWidth.widthPx}
    restoreFocusTarget={threadSurface.restoreFocusTarget}/> : null;
  useLayoutEffect(() => {
    // A revoked/unreadable scope cannot retain exiting content. Its presence
    // owner is removed immediately, so it cannot deliver onExitComplete.
    if (!threadAdmissionAvailable) threadSurface.markExitComplete();
  }, [threadAdmissionAvailable, threadSurface.markExitComplete]);
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
    const key = JSON.stringify([myPrincipalId, workspaceId, targetMessageId, targetSearchActivationId]);
    if (handledRouteTarget.current === key || !routeContextReady || !routeTarget || composerBusy) return;
    if (routeTarget.parentId && (isBroadcastReply(routeTarget.tags ?? []) || !getThreadRouteTarget(routeTarget, routeMessageById))) return;
    if (!requireThreadEditResolution()) return;
    // Original root and reply deep links open the existing reply panel. Its
    // exact selected event resolves ancestors and scrolls in the same read cache.
    const headId = getThreadReference(routeTarget.tags ?? []).rootId ?? routeTarget.id;
    setProfileTarget(null); setSystemProfileTarget(null); setSelectedReplyId(routeTarget.id);
    setOptimisticThreadHeadId(headId);
    onThreadHeadIdChange(headId, { replace: true });
    handleCancelEdit();
    handledRouteTarget.current = key;
  }, [targetMessageId, targetSearchActivationId, myPrincipalId, workspaceId, routeContextReady, routeTarget, routeMessageById, composerBusy, editTarget, requireThreadEditResolution, handleCancelEdit, onThreadHeadIdChange]);
  // Agents of this channel resolve like the original profile lookup (relay thread summaries and
  // typing rows bind names/avatars from here); human members take precedence on a shared key.
  const profiles = useMemo(() => ({
    ...Object.fromEntries((typingAgents.data?.agents ?? []).map(agent => [agent.pubkey.toLowerCase(),
      {displayName: agent.displayName, avatarUrl: null, nip05Handle: null, ownerPubkey: null, isAgent: true}])),
    ...Object.fromEntries([...byPubkey].map(([pubkey, member]) => [pubkey, {displayName:member.displayName, avatarUrl:null, nip05Handle:null, ownerPubkey:null}])),
  }), [byPubkey, typingAgents.data]);
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
          <MessageAuthorAvatar target={target} profile={{value:authorLabel.profile(author.id)}} className={className} displayName={participant.displayName}/>
        </MessageAuthorIdentity>;
      }};
  }, [conversation, live, denied, metadataPending, members.isSuccess, members.isError, members.isFetching, members.data, myPrincipalId, workspaceId, timelineMessages, handleOpenAuthor, uiT, authorLabel]);
  // DD-125(2): the original composer timeout (learned from a send rejection, never a list read).
  const timeoutState = useTimeoutState();
  const moderation = useMemo<MessageModerationContext | undefined>(() => live && !denied
    ? { scope: conversation ? { conversationId: conversation.id } : { workspaceId }, selfPubkey: ownProfile.data?.pubkey }
    : undefined, [live, denied, conversation, workspaceId, ownProfile.data?.pubkey]);
  const composerPlaceholder = timeoutState.active
    ? uiT("moderation.banner.timedOut")
    : archived
    ? uiT("composer.archivedPlaceholder")
    : conversation
      ? directMessageIntro?.displayName.trim()
        ? uiT("composer.dmPlaceholder", { name: directMessageIntro.displayName })
        : uiT("search.message")
      : channelName?.trim()
        ? uiT("composer.channelPlaceholder", { name: channelName })
        : uiT("search.message");
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
  // DD-147(1): the Agent owner's name opens that member's profile card (MemberHover → panel).
  const renderAgentOwner = useCallback<AgentOwnerRenderer>((owner, name) => <SystemProfilePopover pubkey={owner.pubkey}
    triggerAriaLabel={owner.label}>{name}</SystemProfilePopover>, [SystemProfilePopover]);
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
    const message = timelineMessages.find((item) => item.id === restoreEditEventId && canManageMessageForCurrentUser(item, ownProfile.data.pubkey, conversation ? undefined : ownedAgentPubkeys));
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
  const openThreadReference = channelId && live && !denied && !metadataPending && onOpenMessageLink
    ? (link: ParsedMessageLink) => {
      if (link.channelId !== channelId || !requireThreadEditResolution()) return;
      // The original reference carries the native channel ID. The same host
      // navigator freshly resolves either its Workspace or active conversation.
      onOpenMessageLink(link);
    }
    : undefined;
  const copyMessageLink = channelId ? async (target: TimelineMessage) => {
    const { rootId } = getThreadReference(target.tags ?? []);
    try { await writeTextToClipboard(buildMessageLink({ channelId, messageId: target.id, threadRootId: rootId })); toast.success(t("buzz.copiedLink")); }
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
    // Original shouldNotifyForEvent order: broadcast reply, mention, muted channel, then a
    // reply only in a thread that is not muted and is participated, followed or authored.
    const threadMuted = thread.rootId !== null && preferences?.isThreadMuted(thread.rootId) === true;
    const followed = thread.rootId !== null && preferences?.isFollowingThread(thread.rootId) === true;
    const participated = thread.rootId !== null && (events.some((prior) => mine.has(prior.pubkey) &&
      (prior.id === thread.rootId || getThreadReference(prior.tags).rootId === thread.rootId)) ||
      (channelId !== undefined && reactionThreadInteractionRoots(rawEvents, mine, channelId).has(thread.rootId)));
    // Original mention precedence and thread-participation semantics. Ordinary
    // channel activity is not falsely promoted into a desktop alert.
    if (!isBroadcastReply(event.tags) && (conversation
      ? muted || (!mentioned && thread.parentId !== null && threadMuted)
      : !mentioned && (muted || !thread.parentId || threadMuted || !(participated || followed)))) return;
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
  const attemptedReadScope = useRef<string | null>(null);
  const [readRechecking, setReadRechecking] = useState(false);
  const rechecking = useRef(false);
  const readScopeKey = JSON.stringify([myPrincipalId, workspaceId, conversation?.id, channelId]);
  const readScope = useRef({ active: true, live, visible, denied, metadataPending, key: readScopeKey });
  readScope.current = { active: true, live, visible, denied, metadataPending, key: readScopeKey };
  type MessageReadBatch = {scope: string; read: boolean; ids: string[]; contexts: {key: string; seconds: number}[]; index: number; version: number};
  const manualReadBatch = useRef<MessageReadBatch | null>(null);
  const [manualReadPending, setManualReadPending] = useState(false);
  // Original forcedUnreadMsgRef is a view-only overlay ending on channel leave.
  // Core remains the persisted read-state authority; the overlay follows ACKs.
  const [forcedUnread, setForcedUnread] = useState<{scope: string; ids: ReadonlySet<string>}>({scope: readScopeKey, ids: new Set()});
  const forcedUnreadIds = forcedUnread.scope === readScopeKey ? forcedUnread.ids : new Set<string>();
  const openedReadScope = useRef<string | null>(null);
  useEffect(() => {
    attemptedRead.current = null; attemptedReadScope.current = null;
    manualReadBatch.current = null; setManualReadPending(false);
  }, [readScopeKey]);
  useEffect(() => {
    if (!conversation && channelId && live && visible && !denied && !metadataPending && userState.isSuccess && !userState.isError && openedReadScope.current !== readScopeKey) {
      openedReadScope.current = readScopeKey;
      onClearChannelManualUnread?.(channelId);
    }
  }, [conversation, channelId, live, visible, denied, metadataPending, userState.isSuccess, userState.isError, readScopeKey, onClearChannelManualUnread]);
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
    // DD-156(2): one read mark triggers one user-state re-read. Both consumers (this pane's
    // query and the shared Inbox state) start together, so the transport shares one GET.
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: platformQueries.userState.queryKey }),
        onReadStateChanged?.(),
      ]);
    },
  });
  const readPending = read.isPending;
  const readMutate = read.mutate;
  useEffect(() => {
    if (!live || !visible || denied || !channelId || !newest || !userState.isSuccess
      || userState.isFetching || !userState.data || readPending || readRechecking || manualReadPending
      || manualReadBatch.current?.scope === readScopeKey || forcedUnreadIds.size > 0) return;
    if (newest.created_at <= lastRead) return;
    if (attemptedRead.current && userState.data.version <= attemptedRead.current.version) return;
    const request = {
      contextKey: channelId,
      lastReadAt: toIso(newest.created_at),
      version: userState.data.version,
    };
    attemptedRead.current = request;
    attemptedReadScope.current = readScopeKey;
    readMutate(request);
  }, [live, visible, denied, channelId, newest, lastRead, userState.data,
    userState.isSuccess, userState.isFetching, readPending, readRechecking, readMutate, readScopeKey, manualReadPending, forcedUnreadIds.size]);

  const isMessageUnread = (message: TimelineMessage) => {
    if (!userState.isSuccess || userState.isError || !userState.data || mine.has(message.pubkey ?? "")) return false;
    if (forcedUnreadIds.has(message.id)) return true;
    const rootId = getThreadReference(message.tags ?? []).rootId;
    const positions = [channelId, `msg:${message.id}`, rootId ? `thread:${rootId}` : null]
      .flatMap(key => key && userState.data.readContexts[key] ? [Date.parse(userState.data.readContexts[key]) / 1_000] : []);
    return positions.length === 0 || message.createdAt > Math.max(...positions);
  };
  const runMessageReadBatch = async (batch: MessageReadBatch) => {
    setManualReadPending(true);
    try {
      while (batch.index < batch.contexts.length) {
        const scope = readScope.current;
        if (manualReadBatch.current !== batch || !scope.active || scope.key !== batch.scope || !scope.live || !scope.visible || scope.denied || scope.metadataPending) return;
        const context = batch.contexts[batch.index]!;
        const request = {contextKey: context.key, lastReadAt: toIso(context.seconds), version: batch.version};
        attemptedRead.current = request; attemptedReadScope.current = batch.scope;
        const result = await read.mutateAsync(request);
        if (manualReadBatch.current !== batch || !readScope.current.active || readScope.current.key !== batch.scope) return;
        batch.version = result.version; batch.index += 1;
      }
      const scope = readScope.current;
      if (manualReadBatch.current !== batch || !scope.active || scope.key !== batch.scope || !scope.live || !scope.visible || scope.denied || scope.metadataPending) return;
      const ids = new Set(forcedUnreadIds);
      for (const id of batch.ids) { if (batch.read) ids.delete(id); else ids.add(id); }
      setForcedUnread({scope: batch.scope, ids});
      if (!batch.read && channelId) onMarkChannelUnread?.(channelId);
      else if (ids.size === 0 && channelId) onClearChannelManualUnread?.(channelId);
      manualReadBatch.current = null;
    } catch {
      // The mutation's existing error/recheck surface owns this exact CAS intent.
      // UNKNOWN keeps the same position/version and never starts another batch.
    } finally {
      if (readScope.current.key === batch.scope) setManualReadPending(false);
    }
  };
  const canMarkMessage = !conversation && Boolean(onMarkChannelUnread) && live && visible && !denied && !metadataPending && Boolean(channelId) && userState.isSuccess && !userState.isError && !userState.isFetching &&
    !readPending && !readRechecking && !manualReadPending && manualReadBatch.current?.scope !== readScopeKey &&
    (!attemptedRead.current || attemptedReadScope.current !== readScopeKey || userState.data.version > attemptedRead.current.version);
  const markMessageSubtree = (message: TimelineMessage, messages: readonly TimelineMessage[], markAsRead: boolean) => {
    if (!canMarkMessage || manualReadBatch.current?.scope === readScopeKey || !channelId) return;
    const index = buildThreadPanelIndex([...messages]);
    if (!index.messageById.has(message.id)) return;
    // Original subtreeCreatedAt::collectReplyDescendantIds walk over the same
    // shared thread index, including collapsed descendants, not visible rows.
    const ids = [message.id]; const pending = [...(index.directChildrenByParentId.get(message.id) ?? [])];
    while (pending.length) {
      const child = pending.pop()!; ids.push(child.id);
      pending.push(...(index.directChildrenByParentId.get(child.id) ?? []));
    }
    const contexts = new Map<string, number>();
    for (const id of ids) {
      const target = index.messageById.get(id)!;
      // Fixed original ordinary-channel unread is session-local, not a CAS
      // rollback of the whole channel (which would affect unrelated messages).
      if (markAsRead) contexts.set(`msg:${id}`, target.createdAt);
    }
    const batch = {scope: readScopeKey, read: markAsRead, ids, contexts: [...contexts].map(([key, seconds]) => ({key, seconds})), index: 0, version: userState.data!.version};
    manualReadBatch.current = batch;
    void runMessageReadBatch(batch);
  };

  const retryRead = async () => {
    const request = attemptedRead.current;
    if (!request || readPending || rechecking.current) return;
    rechecking.current = true;
    setReadRechecking(true);
    try {
      const observed = await userState.refetch();
      const scope = readScope.current;
      if (!scope.active || !scope.live || !scope.visible || scope.denied || scope.metadataPending
        || scope.key !== attemptedReadScope.current || !observed.isSuccess) return;
      // Explicit retry with the unchanged CAS version is the unchanged intent,
      // even if newer messages arrived while its result was unknown.
      if (observed.data.version === request.version) {
        const batch = manualReadBatch.current;
        if (batch?.scope === scope.key) await runMessageReadBatch(batch);
        else readMutate(request);
      } else if (observed.data.version > request.version) {
        manualReadBatch.current = null;
        read.reset();
      }
    } finally {
      rechecking.current = false;
      if (readScope.current.active) setReadRechecking(false);
    }
  };

  return (
    <BffVideoReviewProvider Composer={Composer} mentionPeople={mentionPeople} principalId={myPrincipalId} workspaceId={workspaceId} conversationId={conversation?.id}
      channelName={channelName} channelType={conversation ? "dm" : "stream"}
      messages={[...routeMessageById.values()]} available={live && !denied && !archived && !metadataPending && members.isSuccess && !members.isError}
      onToggleReaction={messageReactions.onToggleReaction} resolveMediaUrl={messageReactions.resolveMediaUrl}>
    <AgentActivityOpenerProvider value={agentActivityPanel.opener}>
    <div ref={paneRef} className="relative flex h-full min-h-0 min-w-0 overflow-hidden">
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
      {routeReadId && live && !routeMessageById.has(routeReadId) && (!routeContextEnabled || (routeContextReady && !routeContext.thread.hasNextPage)) ? <p role="status">{t("platform.linkMessageOutsideHistory")}</p> : null}
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
        {...searchHighlightProps.timeline}
        hasComposerOverlay={false}
        firstUnreadMessageId={anchor === null || forcedUnreadIds.size > 0 ? null : timelineMessages.find(message => isConversationalUnreadKind(message.kind) && message.createdAt > anchor && !mine.has(message.pubkey ?? ""))?.id ?? null}
        unreadCount={forcedUnreadIds.size > 0 ? 0 : unreadFromOthers}
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
                searchQuery={props.searchMatchingMessageIds?.has(message.id) ? props.searchQuery : undefined}
                agentMentionStatus={renderAgentMentionStatus(message)} agentAddress={agentAddress} renderAgentOwner={renderAgentOwner}
                reference={<SentFromThreadLine channelId={channelId} tags={message.tags}
                  renderLink={(link, threadExcerpt) => <SentFromThreadLink link={link}
                    channelLabel={channelName || link.channelId.slice(0, 8)} threadExcerpt={threadExcerpt}
                    interactive={Boolean(openThreadReference)} onOpenMessageLink={openThreadReference} />} />}
                onToggleReaction={messageReactions.onToggleReaction} customEmoji={messageReactions.customEmoji}
                reactionScope={messageReactions.reactionScope} resolveMediaUrl={messageReactions.resolveMediaUrl}
                renderIdentity={message.pubkey && live && !denied ? (node,kind) => <MessageAuthorIdentity
                  target={{principalId:myPrincipalId,workspaceId,conversationId:conversation?.id,eventId:message.id,pubkey:message.pubkey!}}
                  onOpen={() => handleOpenAuthor(message)}>{kind === "avatar" ? <div className="relative shrink-0"><MessageAuthorAvatar
                    target={{principalId:myPrincipalId,workspaceId,conversationId:conversation?.id,eventId:message.id,pubkey:message.pubkey!}}
                    profile={{value:routeMessages.some(event=>event.id===message.id)?routeAuthorLabel.profile(message.id):authorLabel.profile(message.id)}}
                    accent={message.accent} className="shrink-0" displayName={message.author} shape={message.isAgent ? "squircle" : "circle"}
                    testId="message-avatar" /></div> : node}</MessageAuthorIdentity> : undefined}
                renderActions={(ref,reactions) => <MessageActionBarSurface ref={ref} {...reactions} message={message} onCopyMessage={copyMessage}
                  moderation={moderation}
                  onEdit={live && !denied && !archived && !metadataPending && !composerBusy && ownProfile.isSuccess && !ownProfile.isFetching && canManageMessageForCurrentUser(message, ownProfile.data.pubkey, conversation ? undefined : ownedAgentPubkeys) ? handleRoutedEdit : undefined}
                  onDelete={canDelete && canManageMessageForCurrentUser(message, ownProfile.data?.pubkey, conversation ? undefined : ownedAgentPubkeys) ? deleteMessageDialog.requestDelete : undefined}
                  isUnread={isMessageUnread(message)}
                  onMarkRead={canMarkMessage ? target => markMessageSubtree(target, routedTimelineMessages, true) : undefined}
                  onMarkUnread={canMarkMessage ? target => markMessageSubtree(target, routedTimelineMessages, false) : undefined}
                  onReply={(message.kind === 9 || message.kind === 40002 || message.kind === KIND_STREAM_MESSAGE_DIFF) && live && !denied && !archived && !metadataPending ? handleOpenThread : undefined}
                  // Original TimelineMessageRow: thread heads with a summary carry the explicit follow.
                  isFollowingThread={entry.summary ? preferences?.isFollowingThread(message.id) === true : undefined}
                  onFollowThread={entry.summary && preferences?.writable && live && !denied ? (target) => { void preferences.followThread(target.id); } : undefined}
                  onUnfollowThread={entry.summary && preferences?.writable && live && !denied ? (target) => { void preferences.unfollowThread(target.id); } : undefined}
                  onCopyLink={copyMessageLink} />}
                renderBody={(className) => <div className={className}><MessageContent
                messageId={message.id}
                onRemoveLinkPreviews={message.kind === 9 && live && !denied && !archived && !metadataPending && ownProfile.isSuccess && !ownProfile.isFetching &&
                  message.signerPubkey === ownProfile.data.pubkey && canRemoveLinkPreviews(message) ? () => removeLinkPreviews(message) : undefined}
                searchQuery={props.searchMatchingMessageIds?.has(message.id) ? props.searchQuery : undefined}
                content={message.body}
                mediaTags={message.tags}
                mentions={mentions}
                workspaceId={workspaceId}
                conversationId={conversation?.id}
                onOpenMessageLink={onOpenMessageLink}
              /></div>} />
              {entry.summary ? <MessageThreadSummaryRow message={message} summary={entry.summary}
                onOpenThread={handleOpenThread} /> : null}
            </div>;
          });
        }} />}
      /> : null}
      {restoreEditEventId && live && !editTarget && !events.some((event) => event.id === restoreEditEventId) ? <p role="status">{t("platform.linkMessageOutsideHistory")}</p> : null}
      {!denied && mainEditTarget ? <Composer key={`edit:${mainEditTarget.id}`} workspaceId={conversation ? undefined : workspaceId}
        placeholder={composerPlaceholder}
        mentionPeople={mentionPeople}
        editTarget={mainEditTarget} onCancelEdit={handleCancelEdit} onConfirmed={() => handleEditConfirmed(mainEditTarget)} draftIdentity={myPrincipalId}
        onRequestEmptyEditDelete={deleteMessageDialog.requestDelete}
        draftKey={`edit:${workspaceId}:${mainEditTarget.id}`} draftChannelId={workspaceId}
        autoSendDraftKey={autoSendDraftKey} onAutoSendConsumed={onAutoSendConsumed}
        disabled={deleteMessageDialog.pending || denied || !live || archived || metadataPending || !ownProfile.isSuccess || ownProfile.isFetching || ownProfile.data.pubkey !== mainEditTarget.signerPubkey}
        onSendingChange={setComposerBusy} onOpenMessageLink={onOpenMessageLink}
        onUpload={conversation ? (file, options) => uploadConversationMedia(conversation.id, file, options) : undefined}
        onMediaUrl={conversation ? (sha) => mediaUrl(conversation.id, sha, conversation.id) : undefined}
        onPublish={async (content, attachments, key, mentions, mentionPubkeys) => {
          const receipt = await (conversation ? publishConversationMessage(conversation.id, content, attachments, key, mainEditTarget.id, undefined, mentionPubkeys)
            : publishMessage(workspaceId, content, attachments, key, mentions, {editEventId: mainEditTarget.id, mentionPubkeys}));
          if (!receipt?.eventId || !receipt.operationId) throw new TransportError("Message edit has no confirmed receipt.");
          return receipt;
        }} /> : null}
      <div hidden={mainEditTarget !== null} className={`composer-dock composer-overlay-corner-masks relative pointer-events-auto${typingPubkeys.length || agentActivity.workingBotPubkeys.length ? " composer-dock--with-activity" : ""}`}>
      {timeoutState.active && !denied ? <ComposerTimeoutBanner expiresAtMs={timeoutState.expiresAtMs} /> : null}
      <ComposerDockBackdrop gutterClassName="inset-x-5" />
      {denied ? null : conversation
        ? <Composer disabled={conversation.state !== "ACTIVE" || timeoutState.active} onSendingChange={onMessageSendingChange} mentionPeople={mentionPeople}
            containerClassName="px-5 pb-0" layoutMode="dock"
            channelType="dm"
            onTyping={notifyTyping}
            placeholder={composerPlaceholder}
            onEditLastOwnMessage={handleEditLastOwnMainMessage}
            draftIdentity={myPrincipalId} draftKey={conversation.id} autoSendDraftKey={autoSendDraftKey} onAutoSendConsumed={onAutoSendConsumed} onOpenMessageLink={onOpenMessageLink}
            linkPreviewTarget={{ conversationId: conversation.id }}
            onPublish={(content, attachments, key, _installations, mentionPubkeys, linkPreviews) => linkPreviews
              ? publishConversationMessage(conversation.id, content, attachments, key, undefined, undefined, mentionPubkeys, linkPreviews)
              : publishConversationMessage(conversation.id, content, attachments, key, undefined, undefined, mentionPubkeys)}
            onMediaUrl={(sha256) => mediaUrl(conversation.id, sha256, conversation.id)}
            onUpload={(file, options) => uploadConversationMedia(conversation.id, file, options)} />
        : <>{archived ? <p role="status">{t("channel.archived")}</p> : null}<Composer
            containerClassName="px-5 pb-0" layoutMode="dock"
            onTyping={notifyTyping}
            placeholder={composerPlaceholder}
            mentionPeople={mentionPeople}
            nonMemberMentionWorkspaceId={nonMemberMentionWorkspaceId}
            onEditLastOwnMessage={handleEditLastOwnMainMessage}
            disabled={archived || metadataPending || timeoutState.active}
            onSendingChange={onMessageSendingChange}
            workspaceId={workspaceId} draftIdentity={myPrincipalId} draftKey={workspaceId}
            autoSendDraftKey={autoSendDraftKey} onAutoSendConsumed={onAutoSendConsumed} onOpenMessageLink={onOpenMessageLink} /></>}
      <ChannelComposerActivityAccessory agents={workingAgents} channelId={conversation ? null : workspaceId} channel={null}
        currentPubkey={ownProfile.data?.pubkey} profiles={profiles} resolveMediaUrl={messageReactions.resolveMediaUrl}
        onOpenAgentSession={(pubkey, channelId) => openAgentActivity(pubkey, { channelId: channelId ?? null })}
        openAgentSessionPubkey={null}
        typingPubkeys={typingPubkeys} workingBotPubkeys={agentActivity.workingBotPubkeys}
        visible={typingPubkeys.length > 0 || agentActivity.workingBotPubkeys.length > 0} />
      </div>
    </div>
    {systemProfileTarget && systemProfileTarget.workspaceId === workspaceId && selectedSystemMember?.principalId === systemProfileTarget.principalId && "state" in selectedSystemMember && selectedSystemMember.state === "ACTIVE" && live && !denied && !conversation ? <MemberProfilePanel key={`${myPrincipalId}:${systemProfileTarget.workspaceId}:${systemProfileTarget.pubkey}`}
      target={systemProfileTarget} onClose={()=>setSystemProfileTarget(null)} onStartDm={mine.has(systemProfileTarget.pubkey)?undefined:onStartDm}/> : null}
    {participantProfileTarget && conversation && participantProfileTarget.conversationId === conversation.id
      && byPubkey.get(participantProfileTarget.pubkey)?.principalId === participantProfileTarget.principalId && live && !denied
      ? <MemberProfilePanel key={`${myPrincipalId}:${participantProfileTarget.conversationId}:${participantProfileTarget.pubkey}`}
        target={participantProfileTarget} onClose={()=>setParticipantProfileTarget(null)}
        onStartDm={mine.has(participantProfileTarget.pubkey)?undefined:onStartDm}/> : null}
    {profileTarget?.pubkey && live && !denied ? <MessageAuthorProfile key={`${myPrincipalId}:${workspaceId}:${profileTarget.id}`}
      target={{principalId:myPrincipalId,workspaceId,conversationId:conversation?.id,eventId:profileTarget.id,pubkey:profileTarget.pubkey}}
      onClose={()=>setProfileTarget(null)} onStartDm={mine.has(profileTarget.pubkey)?undefined:onStartDm}
      agentScope={conversation ? undefined : {workspaceId, channelName}}/> : null}
    {agentActivityPanel.panel}
    {agentDialogsMounted && !conversation && live && !denied ? <Suspense fallback={null}>
      <WorkspaceAgentDialogs workspaceId={workspaceId} workspaceName={channelName ?? ""} createOpen={false} onCreateOpenChange={() => {}}
        selectedId={renewInstallationId} onSelectedChange={setRenewInstallationId} manageDelegation />
    </Suspense> : null}
    {threadAdmissionAvailable ? <AnimatePresence mode="wait" onExitComplete={markExitComplete}>
    {replaceThreadWithIdleAuxiliary && !profileTarget && !systemProfileTarget && !participantProfileTarget ? idleAuxiliarySurface : replyTarget ? <div ref={threadSurface.ref} inert={threadSurface.covered || undefined} aria-hidden={threadSurface.covered || undefined} key={`${myPrincipalId}:${workspaceId}:${getThreadReference(replyTarget.tags ?? []).rootId ?? replyTarget.id}`} className={profileTarget || systemProfileTarget || participantProfileTarget ? "hidden" : "contents"}><FocusThreadDrawer escapeEnabled={!threadSurface.covered} hasActiveEdit={threadEditTarget!==null} active={focusThread && !profileTarget && !systemProfileTarget && !participantProfileTarget} channelName={channelName} onClose={handleCloseThread}><ChannelThreadPane key={`${myPrincipalId}:${workspaceId}:${getThreadReference(replyTarget.tags ?? []).rootId ?? replyTarget.id}`}
      channelName={channelName} agentPubkeys={agentTypingPubkeys} agentFacts={agentFacts} renderAgentOwner={renderAgentOwner} ownedAgentPubkeys={ownedAgentPubkeys}
      restoreDraftKey={restoreDraftKey} autoSendDraftKey={autoSendDraftKey} onAutoSendConsumed={onAutoSendConsumed}
      channelId={conversation?.channelId ?? channelId}
      conversation={conversation}
      onOpenMessageLink={openThreadReference}
      isFocusMode={focusThread}
      useSplitAuxiliaryPane={!threadOverlay}
      onThreadViewModeChange={markExitComplete}
      workspaceId={workspaceId} principalId={myPrincipalId} selected={routeMessageById.get(replyTarget.id) ?? replyTarget}
      routeTargetMessageId={replyTarget.id === routeTarget?.id ? targetMessageId : undefined}
      {...searchHighlightProps.thread}
      routeActivationId={targetSearchActivationId}
      mentions={mentions}
      profiles={profiles}
      typingEntries={humanTypingEntries}
      onOpenAuthor={handleOpenAuthor} onAuthorScopeUnavailable={closeProfile}
      renderAgentMentionStatus={conversation ? undefined : renderAgentMentionStatus}
      editTarget={threadEditTarget} onEdit={handleRoutedEdit} onCancelEdit={handleCancelEdit} onEditConfirmed={handleEditConfirmed}
      onDelete={canDelete ? deleteMessageDialog.requestDelete : undefined} onRequestEmptyEditDelete={deleteMessageDialog.requestDelete}
      editAuthorPubkey={ownProfile.isSuccess && !ownProfile.isFetching ? ownProfile.data.pubkey : undefined}
      editBusy={composerBusy || deleteMessageDialog.pending} onEditSendingChange={setComposerBusy}
      members={members.data ?? []} nonMemberMentionWorkspaceId={nonMemberMentionWorkspaceId} disabled={archived || metadataPending || denied || !live}
      onClose={handleCloseThread} onCopyMessage={copyMessage} onCopyLink={copyMessageLink}
      isMessageUnread={isMessageUnread}
      onMarkRead={canMarkMessage ? (message, messages) => markMessageSubtree(message, messages, true) : undefined}
      onMarkUnread={canMarkMessage ? (message, messages) => markMessageSubtree(message, messages, false) : undefined} /></FocusThreadDrawer></div> : !profileTarget && !systemProfileTarget && !participantProfileTarget ? idleAuxiliarySurface : null}
    </AnimatePresence> : null}
    {live && !denied && !metadataPending ? <AnimatePresence onExitComplete={threadSurface.markExitComplete}>{showIdleAuxiliaryOverThread ? idleAuxiliarySurface : null}</AnimatePresence> : null}
    {deleteMessageDialog.dialog}
    </div>
    </AgentActivityOpenerProvider>
    </BffVideoReviewProvider>
  );
}

type Pending = { name: string; descriptor: MediaDescriptor; receivedAt: number };
/** One attach() call: its files upload one after another; a queued send owns the batches in flight at Send. */
type UploadBatch = { remaining: File[]; active: Map<number, File>; canceled: boolean };
/** DD-146: the message a Send froze. `cleared` while the composer no longer shows it. */
type SendSnapshot = {
  content: string; pending: Pending[]; gifs: WebGifItem[]; bindings: Map<string, string>; installationIds: string[];
  spoilers: ReadonlySet<string>; intent: { current: { key: string; signature: string } | null };
  linkPreviews?: LinkPreviewPublication; cleared: boolean;
  batches: ReadonlySet<UploadBatch>; remainingFiles: File[]; failed: boolean;
};
/** Draft keys whose cleared send is being published by this page (a revisit shows it as in flight). */
const publishingPendingSends = new Set<string>();

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

export function Composer({ audienceContext = null, channelType, mentionPeople, nonMemberMentionWorkspaceId, workspaceId, linkPreviewTarget, onPublish, onUpload, onMediaUrl, disabled = false, placeholder, onOpenMessageLink, draftIdentity, draftKey, surface = "stream", compact = false, autocompleteBelow = false, composerHeader, onCancel, toolbarExtraActions, autoSendDraftKey, onAutoSendConsumed, replyTarget, onCancelReply, containerClassName, layoutMode = "standalone", onSendingChange, editTarget, onCancelEdit, onEditLastOwnMessage, onConfirmed, draftChannelId, onRequestEmptyEditDelete, onTyping }: {
  audienceContext?: {type: "thread"; rootTags: readonly string[][]} | null;
  channelType?: "stream" | "forum" | "dm" | null;
  mentionPeople?: readonly MentionSuggestion[];
  /** DD-125(8): set once this Workspace channel's ACTIVE members (`mentionPeople`) are resolved,
   * for new messages and thread replies only. The @ picker then also lists same-Tenant people
   * outside the channel, and sending to them asks to invite, send without inviting, or cancel. */
  nonMemberMentionWorkspaceId?: string;
  editTarget?: TimelineMessage;
  onCancelEdit?: () => void;
  onRequestEmptyEditDelete?: (message: TimelineMessage) => void;
  /** Original useTypingBroadcast trigger (main channel, or the thread head inside a thread). */
  onTyping?: () => void;
  onEditLastOwnMessage?: () => boolean;
  onConfirmed?: () => void;
  draftChannelId?: string;
  surface?: "stream" | "forum";
  compact?: boolean;
  autocompleteBelow?: boolean;
  composerHeader?: React.ReactNode;
  /** Host toolbar actions after Cancel (original ForumComposer secondary submit menu). */
  toolbarExtraActions?: React.ReactNode;
  workspaceId?: string;
  /** DD-125(5): where the BFF fetches composer link previews. Only hosts whose onPublish
   * forwards the preview intent pass it; the built-in Workspace publication needs none. */
  linkPreviewTarget?: { workspaceId: string } | { conversationId: string };
  /** `referenceMentionPubkeys` (DD-125(8)) is passed only when the person chose to send without inviting. */
  onPublish?: (content: string, attachments: readonly MediaDescriptor[], idempotencyKey: string, mentionInstallationIds: string[], humanMentionPubkeys?: string[], linkPreviews?: LinkPreviewPublication, referenceMentionPubkeys?: string[],
    /** DD-148: the address-tray subset of mentionInstallationIds (original agent-address tags). */
    addressedInstallationIds?: string[]) => Promise<unknown>;
  onCancel?: () => void;
  containerClassName?: string;
  layoutMode?: "standalone" | "dock";
  onSendingChange?: (sending: boolean) => void;
  replyTarget?: { author: string; body: string; id: string } | null;
  onCancelReply?: () => void;
  /** Host upload; forwarding `options` gives the original per-file progress and cancel. */
  onUpload?: (file: File, options?: MediaUploadOptions) => Promise<MediaDescriptor>;
  onMediaUrl?: (sha256: string) => string;
  disabled?: boolean;
  placeholder?: string;
  onOpenMessageLink?: (link: ParsedMessageLink) => void;
  draftIdentity?: string;
  draftKey?: string;
  /** Original Inbox sends only after its explicit confirmation, using this editor's existing intent. */
  autoSendDraftKey?: string;
  onAutoSendConsumed?: () => void | Promise<void>;
}) {
  const customEmoji = useBffCustomEmojiPalette(bff);
  const [confirmedSendRevision, setConfirmedSendRevision] = useState(0);
  const humanBindings = useRef(new Map<string,string>());
  const mentionPeopleRef = useRef(mentionPeople);
  mentionPeopleRef.current = mentionPeople;
  const agentDirectory = useComposerAgentDirectory(bff, {workspaceId, principalId: draftIdentity}, workspaceId !== undefined && channelType !== "dm" && !editTarget);
  const agentPeople = useMemo(() => agentDirectory.data?.agents.map(agent => ({pubkey: agent.pubkey, displayName: agent.displayName, avatarUrl: agent.avatarUrl, isAgent: true})) ?? [], [agentDirectory.data]);
  // DD-125(8): only a Workspace channel's new message or thread reply looks outside the channel.
  const nonMemberFlow = nonMemberMentionWorkspaceId !== undefined && channelType !== "dm" && !editTarget;
  // The Tenant directory is read once this composer's @ picker is first used (or at send time).
  const [outsideDirectoryWanted, setOutsideDirectoryWanted] = useState(false);
  const tenantDirectory = useTenantMentionDirectory(bff, draftIdentity ?? "", nonMemberFlow && outsideDirectoryWanted);
  const outsidePeople = useMemo<MentionSuggestion[]>(() => !nonMemberFlow || !tenantDirectory.data ? [] : outsideMentionPeople({
    directory: tenantDirectory.data, memberPubkeys: (mentionPeople ?? []).map(person => person.pubkey),
  }).filter(person => !agentPeople.some(agent => agent.pubkey === person.pubkey))
    .map(person => ({pubkey: person.pubkey, displayName: person.displayName, notInChannel: true})), [nonMemberFlow, tenantDirectory.data, mentionPeople, agentPeople]);
  const mentionCandidates = useMemo<MentionSuggestion[]>(() => [...(mentionPeople ?? []).filter(person => !agentPeople.some(agent => agent.pubkey === person.pubkey)), ...agentPeople, ...outsidePeople], [mentionPeople, agentPeople, outsidePeople]);
  // DD-131(1) original buildTeamMentionCandidates: "@team" rows are autocomplete-only; selecting one
  // inserts ordinary mentions of the members' Installations in this channel (never a team identity).
  const teamMentions = useTeamMentionCandidates(bff, {principal: draftIdentity, workspaceId}, agentDirectory.data?.agents,
    workspaceId !== undefined && channelType !== "dm" && !editTarget);
  const knownAgentKeys = useMemo(() => new Set<string>(), [workspaceId, draftIdentity, draftKey]);
  const knownAgentInstallations = useMemo(() => new Map<string,string>(), [workspaceId, draftIdentity, draftKey]);
  for (const agent of agentPeople) knownAgentKeys.add(agent.pubkey);
  for (const agent of agentDirectory.data?.agents ?? []) knownAgentInstallations.set(agent.pubkey, agent.installation.resourceId);
  const isAgentPubkey = useCallback((pubkey: string) => agentPeople.some(agent => agent.pubkey === pubkey.toLowerCase()), [agentPeople]);
  const audienceScope = audienceContext && !editTarget && agentDirectory.data && channelType !== "dm"
    ? getPersistentAgentAudienceScope({ownerPubkey: agentDirectory.data.ownerPubkey, channelId: agentDirectory.data.channelId, composerKey: draftKey}) : null;
  const implicitAgentMentionProvenance = useImplicitAgentMentionProvenance(audienceScope);
  const {audience, keepMentionedAgentsPinned} = useThreadAgentAudience({isAgentPubkey, rootTags: audienceContext?.rootTags ?? [], scope: audienceScope});
  const composerMentions = useComposerMentions({
    candidates: useMemo(() => mentionCandidates.map(person => ({ ...person, isMember: person.notInChannel !== true,
      role: person.role === "admin" ? "admin" as const : null })), [mentionCandidates]),
    teams: teamMentions, scope: JSON.stringify([workspaceId, draftIdentity, draftKey]), selectedMentions: humanBindings,
    verifyMentionIdentities: async records => partitionMentionIdentitiesByLocalTrust(records,
      pubkey => mentionPeopleRef.current?.filter(person => person.pubkey.toLowerCase() === pubkey).map(person => person.displayName) ?? []).trusted,
  });
  const { suggestions: humanSuggestions, knownNames: humanNames, mentionSelectedIndex: humanIndex,
    pasteBinding, registerMentionPubkey, insertMention,
    openMentionPicker, getMentionDisplayName, isInlineMentionSelection } = composerMentions;
  const humanQuery = composerMentions.mentionQuery === null ? null : { query: composerMentions.mentionQuery, startIndex: composerMentions.mentionStartIndex };
  useEffect(() => { if (nonMemberFlow && humanQuery !== null) setOutsideDirectoryWanted(true); }, [nonMemberFlow, composerMentions.mentionQuery]);
  // Original MessageComposer `#channel` and `:shortcode` autocompletes (shared with Desktop).
  const channelLinks = useChannelLinks(useComposerChannelLinkSources());
  const emojiAutocomplete = useEmojiAutocomplete();
  const { content: draft, revision: draftRevision, setComposerContent: setDraft } = useComposerContentState();
  // DD-125(5) original composer link previews (BFF fetch host) and GIF chips. Only new STREAM
  // messages carry them; an edit names neither (original edit mode turns previews off).
  const [previewContent, setPreviewContent] = useState("");
  const previewTarget = editTarget || surface !== "stream" ? undefined
    : linkPreviewTarget ?? (!onPublish && workspaceId ? { workspaceId } : undefined);
  const previewTargetKey = previewTarget ? JSON.stringify(previewTarget) : "";
  const preparePreview = useMemo<PrepareLinkPreview | undefined>(
    () => previewTarget ? (url) => prepareLinkPreview(previewTarget, url) : undefined,
    // The target is compared by value; a re-created literal is the same fetch host.
    [previewTargetKey]);
  const linkPreviews = useComposerLinkPreviews({ content: previewContent, enabled: previewTarget !== undefined, prepare: preparePreview });
  const resolvePreviewMedia = useCallback((sha256: string) => onMediaUrl ? onMediaUrl(sha256) : mediaUrl(workspaceId ?? "", sha256), [onMediaUrl, workspaceId]);
  const gifsEnabled = previewTarget !== undefined;
  const gifCapability = useGifCapability(gifsEnabled);
  const [pendingGifs, setPendingGifs] = useState<WebGifItem[]>([]);
  const gifOption = useMemo(() => gifsEnabled && gifCapability.data?.available === true && gifCapability.data.imageOrigins.length > 0 ? {
    search: (query: string) => bff.gifSearch({ query, locale: navigator.language || "en-US" }),
    onSelect: (gif: WebGifItem) => {
      setPendingGifs((current) => [...current, gif]);
      // Original best-effort share report at selection time; its failure changes nothing.
      void bff.gifShare({ slug: gif.slug }).catch(() => {});
    },
  } : undefined, [gifsEnabled, gifCapability.data]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [uploading, setUploading] = useState(0);
  // Original useMediaUpload uploadingPreviews/cancelUpload: one preview per in-flight file with
  // its byte progress; cancel aborts that request and drops its preview at once.
  const [uploadingPreviews, setUploadingPreviews] = useState<UploadingAttachmentPreview[]>([]);
  const activeUploads = useRef(new Map<number, AbortController>());
  const nextUploadPreviewId = useRef(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [problemNeutral, setProblemNeutral] = useState(false);
  const [mentionInstallationIds, setMentionInstallationIds] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  // DD-146 original send-then-upload (useMentionSendFlow): Send while attachments upload freezes
  // the message and clears the composer at once; it is published once every attachment has a
  // BFF-confirmed descriptor, so nothing references unconfirmed media. A failed or canceled upload,
  // or a definite publish failure, restores the draft (or keeps it as a recovery when the composer
  // has moved on). The pending send is persisted beside the draft, so a reload offers it again;
  // an UNKNOWN outcome keeps its DD-81 key and is never resent by itself.
  const [queued, setQueued] = useState<SendSnapshot | null>(null);
  const queuedRef = useRef<SendSnapshot | null>(null);
  const activeBatches = useRef(new Set<UploadBatch>());
  const [batchRevision, setBatchRevision] = useState(0);
  const [recovery, setRecovery] = useState<{ record: PendingSendState; files: File[] } | null>(null);
  const [clearedPublishing, setClearedPublishing] = useState(0);
  // DD-144: an Agent mention in a DM is refused before sending, with the draft kept.
  const dmAgentNames = useDmAgentMentionNames(bff, channelType === "dm" && !editTarget);
  // A cleared message is still being sent until the Relay confirms it.
  useEffect(() => { onSendingChange?.(sending || clearedPublishing > 0); }, [sending, clearedPublishing, onSendingChange]);
  useEffect(() => () => { onSendingChange?.(false); }, [onSendingChange]);
  const [dragging, setDragging] = useState(false);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const pendingGifsRef = useRef(pendingGifs);
  pendingGifsRef.current = pendingGifs;
  const [originals, setOriginals] = useState<Map<string, Pending>>(() => new Map());
  const originalsRef = useRef(originals);
  originalsRef.current = originals;
  const mentionVerified = mentionInstallationIds.length === 0 || (agentDirectory.data !== undefined &&
    mentionInstallationIds.every(id => agentDirectory.data!.agents.some(agent => agent.installation.resourceId === id)));
  const picker = useRef<HTMLInputElement>(null);
  // 当前发送意图：内容与附件不变时重发沿用同一个键——结果不明之后再点发送，
  // BFF 回答原操作的结论而不是再发一条（DD-81）。确定的结论之后换新键。
  const intent = useRef<{ key: string; signature: string } | null>(null);
  const owner = useMemo(() => ({ active: true, sending: false }), [workspaceId, draftIdentity, draftKey, editTarget?.id]);
  useEffect(() => { owner.active = true; return () => { owner.active = false; }; }, [owner]);
  // Files awaiting this owner's real BFF upload receipt are not yet imeta.
  const queuedAttachmentsRef = useMemo(() => ({ current: [] as { file: File }[] }), [owner]);
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

  const finishUpload = useCallback((previewId: number) => {
    if (!activeUploads.current.delete(previewId)) return;
    setUploading((n) => Math.max(0, n - 1));
    setUploadingPreviews((previews) => previews.filter((preview) => preview.id !== previewId));
  }, []);
  const cancelUpload = useCallback((previewId: number) => {
    const upload = activeUploads.current.get(previewId);
    if (!upload) return;
    upload.abort();
    finishUpload(previewId);
  }, [finishUpload]);
  // Set below, once the pending-send record can be written (an upload extends a queued send).
  const persistQueuedRef = useRef<(snapshot: SendSnapshot) => void>(() => {});
  const attach = useCallback(
    async (files: FileList | readonly File[] | null) => {
      const batch: UploadBatch = { remaining: Array.from(files ?? []), active: new Map(), canceled: false };
      activeBatches.current.add(batch);
      try {
      while (batch.remaining.length && !batch.canceled) {
        const file = batch.remaining.shift()!;
        if (!owner.active) return;
        const queuedAttachment = { file };
        queuedAttachmentsRef.current.push(queuedAttachment);
        const previewId = nextUploadPreviewId.current++;
        const upload = new AbortController();
        activeUploads.current.set(previewId, upload);
        batch.active.set(previewId, file);
        setUploading((n) => n + 1);
        setUploadingPreviews((previews) => [...previews, { id: previewId, filename: file.name, type: file.type || undefined, progress: null }]);
        const options: MediaUploadOptions = { signal: upload.signal, onProgress: (progress) => {
          if (!owner.active || upload.signal.aborted) return;
          setUploadingPreviews((previews) => previews.map((preview) => preview.id === previewId ? { ...preview, progress } : preview));
        } };
        try {
          if (!onUpload && !workspaceId) throw new Error("Message destination is unavailable.");
          const descriptor = await (onUpload ? onUpload(file, options) : uploadMedia(workspaceId!, file, options));
          if (owner.active && !upload.signal.aborted) {
            const entry = { name: file.name, descriptor: { ...descriptor, filename: file.name }, receivedAt: Date.now() };
            // A queued send owns the uploads it was waiting for; the cleared composer does not.
            const target = queuedRef.current?.batches.has(batch) ? queuedRef.current : null;
            if (target) { target.pending = [...target.pending, entry]; batch.active.delete(previewId); persistQueuedRef.current(target); }
            else setPending((p) => [...p, entry]);
          }
        } catch (e) {
          if (!owner.active) return;
          // Original cancelUpload: a canceled file raises no problem and never becomes imeta.
          if (upload.signal.aborted) continue;
          const target = queuedRef.current?.batches.has(batch) ? queuedRef.current : null;
          if (target) target.failed = true;
          setProblemNeutral(e instanceof ConversationPreparationPending || isOutcomeUnknown(e));
          // 413 是 BFF 侧先行设定的上界，是确定的拒绝；其余是结果不明
          setProblem(
            e instanceof ConversationPreparationPending ? e.message : e instanceof BffError && e.status === 413
              ? t("platform.uploadTooLarge")
              : t("platform.uploadFailed"),
          );
        } finally {
          batch.active.delete(previewId);
          queuedAttachmentsRef.current = queuedAttachmentsRef.current.filter((entry) => entry !== queuedAttachment);
          if (owner.active) finishUpload(previewId);
          else activeUploads.current.delete(previewId);
        }
      }
      } finally {
        activeBatches.current.delete(batch);
        if (owner.active) setBatchRevision((revision) => revision + 1);
      }
    },
    [workspaceId, onUpload, owner, queuedAttachmentsRef, finishUpload],
  );

  const { isEmojiPickerOpen, setIsEmojiPickerOpen, isFormattingOpen, setIsFormattingOpen, handleFormattingToggle } = useComposerControls();
  const pendingImetaRef = useRef<readonly ImetaMedia[]>([]);
  pendingImetaRef.current = pending.map(asBlob);
  const uploadVoiceFile = useCallback((file: File) => attach([file]), [attach]);
  const voiceNote = useComposerVoiceNote({
    // Original recording context is also partitioned by this BFF actor/scope.
    draftKey: JSON.stringify([workspaceId, draftIdentity, draftKey]),
    editTargetId: editTarget?.id ?? null,
    media: { pendingImetaRef, queuedAttachmentsRef, uploadFile: uploadVoiceFile },
    setEmojiPickerOpen: setIsEmojiPickerOpen,
    setFormattingOpen: setIsFormattingOpen,
  });
  const attachFilesWhenIdle = useCallback(async (files: FileList | readonly File[] | null) => {
    for (const file of Array.from(files ?? [])) await voiceNote.uploadFileWhenIdle(file);
  }, [voiceNote.uploadFileWhenIdle]);
  const sendRef = useRef<(decision?: NonMemberDecision) => void>(() => {});
  const syncAddressedAgentsFromTextRef = useRef<(text: string) => void>(() => {});
  useEffect(() => () => pasteBinding.clearMentionIntents(), [owner, pasteBinding.clearMentionIntents]);
  const onTypingRef = useRef(onTyping);
  onTypingRef.current = onTyping;
  const { richText, linkEditor, composerScrollRef, formRef, focusComposerEnd,
    applyAutocompleteEdit, handleSubmit, handleCaptureSelection } = useMessageComposerController({
    links: {
      openExternal: url => { window.open(url, "_blank", "noopener,noreferrer"); },
      openMessageLink: link => { if (onOpenMessageLink) onOpenMessageLink(link); else setProblem(t("platform.linkOpenFromChannel")); },
    },
    draftKey, autofocusDisabled: disabled || sending || compact,
    editing: Boolean(editTarget), replyTarget,
    autocompleteOpen: humanSuggestions.length > 0 || channelLinks.isChannelOpen || emojiAutocomplete.isEmojiAutocompleteOpen,
    onEditLastOwnMessage, submit: () => sendRef.current(),
    editor: {
    placeholder: placeholder ?? t("platform.message"), editable: !disabled && !sending,
    restoreFocusOnEnable: () => !compact || Boolean(draft.trim() || pending.length || problem),
    readClipboardText: () => navigator.clipboard.readText(),
    customEmoji,
    mentionNames:humanNames,
    channelNames: channelLinks.knownChannelNames,
    agentMentionNames:humanNames.filter(name => knownAgentKeys.has(humanBindings.current.get(name) ?? "")),
    getMentionIdentities:()=>[...humanBindings.current].map(([label,pubkey])=>({label,pubkey})),
    onUpdate: ({ text, cursor, linkPreviewContent }) => {
      setDraft(text); setPreviewContent(linkPreviewContent);
      if (!editTarget && text.trim().length > 0) onTypingRef.current?.();
      if (!sending && !editTarget) syncAddressedAgentsFromTextRef.current(text);
      composerMentions.updateMentionQuery(text, cursor);
      channelLinks.updateChannelQuery(text, cursor);
      emojiAutocomplete.updateEmojiQuery(text, cursor);
    },
  }});
  const getDraftMentionRefs = useCallback((content: string) => composerMentions.getLiveMentionRefs(content)
    .map(ref => ({ ...ref, isAgent: ref.isAgent === true || knownAgentKeys.has(ref.pubkey) })), [composerMentions.getLiveMentionRefs, knownAgentKeys]);
  const applyChannelInsert = useCallback((suggestion: ChannelSuggestion) => {
    const { cursor } = richText.getPlainTextAndCursor();
    applyAutocompleteEdit(channelLinks.insertChannel(suggestion, cursor));
  }, [applyAutocompleteEdit, channelLinks.insertChannel, richText.getPlainTextAndCursor]);
  const applyEmojiInsert = useCallback((suggestion: EmojiSuggestion) => {
    const { cursor } = richText.getPlainTextAndCursor();
    applyAutocompleteEdit(emojiAutocomplete.insertEmoji(suggestion, cursor));
  }, [applyAutocompleteEdit, emojiAutocomplete.insertEmoji, richText.getPlainTextAndCursor]);
  const addressPulse = useAddressMentionPulse();
  const autoPin = useAutoPinMentionedAgents({audienceScope, enabled:keepMentionedAgentsPinned, getDisplayName:getMentionDisplayName,
    onPulse:addressPulse.pulseOne, onTurnOff:() => setKeepMentionedAgentsPinned(false), onTurnOn:() => setKeepMentionedAgentsPinned(true)});
  const mentionPicker = useComposerMentionPicker({ mentions: composerMentions, richText, onTurnOffAutoPinConfirmation: autoPin.turnOffConfirmation });
  const openPeople = mentionPicker.openMentionSettings;
  const composerOwnsFocus = useComposerFocusOwnership(formRef);
  const addressLock = useAgentAddressLockPicker({audience, audienceScope, applyAutocompleteEdit, richText,
    onImplicitPrefixInserted: implicitAgentMentionProvenance.add,
    onImplicitPrefixRemoved: implicitAgentMentionProvenance.remove,
    mentions:{getDraftMentionRefs, getMentionDisplayName, isInlineMentionSelection, isMentionOpen:humanQuery !== null && humanSuggestions.length > 0,
      mentionStartIndex:humanQuery?.startIndex ?? 0, openMentionPicker, registerMentionPubkey, insertMention},
    onAddressAgentMention:suggestion => autoPin.promoteExplicitlyAddressedAgents({pubkeys:[suggestion.pubkey]}),
    onAutoPinAgentMention:(suggestion, options) => autoPin.promoteMentionedAgents({pubkeys:[suggestion.pubkey], ...options}),
    onPulseAddressLock:addressPulse.pulseOne});
  syncAddressedAgentsFromTextRef.current = addressLock.syncAddressedAgentsFromText;
  const removeAddressedAgent = useCallback((pubkey: string) => {
    // Retained IDs are unresolved draft intent, not a live authorization cache.
    // An explicit removal must retire that intent as well as the original pin.
    const installationId = knownAgentInstallations.get(pubkey);
    if (installationId) setMentionInstallationIds(ids => ids.filter(id => id !== installationId));
    addressLock.removeAddressedAgent(pubkey);
  }, [knownAgentInstallations, addressLock.removeAddressedAgent]);
  const getDefaultAgentSuggestion = useCallback(() => agentPeople[0], [agentPeople]);
  const handleAlwaysAddressShortcut = useAlwaysAddressShortcut({enabled: Boolean(audienceScope && !editTarget), lockedAgent:addressLock.lockedAgents[0],
    mentions:{getDefaultAgentSuggestion, isMentionOpen:humanQuery !== null && humanSuggestions.length > 0, mentionSelectedIndex:humanIndex, suggestions:humanSuggestions},
    onOpenPicker:openPeople, onToggle:addressLock.toggleAlwaysAddressAgent});
  const selectHuman = (person: MentionSuggestion) => {
    if (isTeamMentionSuggestion(person)) {
      if (!disabled && !sending && teamMentions.some(team => team.teamId === person.teamId)) {
        applyAutocompleteEdit(composerMentions.insertMention(person, richText.getPlainTextAndCursor().cursor));
      }
      return;
    }
    if (disabled || sending || !mentionCandidates.some(candidate => candidate.pubkey === person.pubkey && Boolean(candidate.isAgent) === Boolean(person.isAgent))) return;
    addressLock.selectMentionSuggestion(person);
  };
  const scrollAfterPaste = useCallback(() => {
    const view = richText.editor?.view;
    if (view) view.dispatch(view.state.tr.scrollIntoView());
  }, [richText.editor]);
  useComposerPasteHandler({ editor: richText.editor,
    bindMentionIdentities: pasteBinding.bindPastedMentionIdentities,
    scrollToBottom: scrollAfterPaste, uploadFile: voiceNote.uploadFileWhenIdle,
  });
  const draftReady = useRef(false);
  const [loadedDraftOwner, setLoadedDraftOwner] = useState<typeof owner | null>(null);
  useComposerDraftRestore({ owner, ready: richText.editor !== null, restore: () => {
    if (draftIdentity && draftKey) initDraftStore(draftIdentity, window.location.origin);
    const saved = draftIdentity && draftKey ? loadDraftEntry(draftKey) : undefined;
    const editableMedia = editTarget ? restoreImetaMediaDisplayLabels(editTarget.body, imetaMediaFromTags(editTarget.tags)) : [];
    const content = saved?.content ?? (editTarget ? stripImetaMediaLines(editTarget.body, editableMedia) : "");
    richText.setContent(content);
    setDraft(content);
    setPreviewContent(content);
    setPendingGifs([]);
    setPending((saved?.pendingImeta ?? editableMedia).map(({ uploaded, ...descriptor }) => ({
      name: descriptor.filename ?? descriptor.sha256,
      receivedAt: uploaded,
      descriptor,
    })));
    intent.current = saved?.sendIntent ?? null;
    setMentionInstallationIds(saved?.mentionInstallationIds ?? []);
    pasteBinding.clearMentionIntents();
    humanBindings.current = new Map((saved?.mentionRefs ?? []).map(ref => [ref.displayName, ref.pubkey]));
    for (const ref of saved?.mentionRefs ?? []) if (ref.isAgent === true) knownAgentKeys.add(ref.pubkey);
    composerMentions.refreshSelectedNames();composerMentions.cancelMentionAutocomplete();
    channelLinks.clearChannels(); emojiAutocomplete.clearEmojis();
    setSending(false);
    setUploading(0);
    // Original beginNewDraftEpoch: uploads of the previous draft can never land in this one.
    for (const upload of activeUploads.current.values()) upload.abort();
    activeUploads.current.clear();
    for (const batch of activeBatches.current) batch.canceled = true;
    activeBatches.current.clear();
    setUploadingPreviews([]);
    // DD-146: a send this draft key left pending (another visit or before a reload) is offered
    // again. Without this page's upload or publication it cannot resume by itself: an upload
    // that never finished is a failed send, a publication without its answer is UNKNOWN.
    queuedRef.current = null;
    setQueued(null);
    setClearedPublishing(0);
    const pendingSend = draftIdentity && draftKey && !editTarget ? loadPendingSend(draftKey) : undefined;
    setRecovery(pendingSend ? { files: [], record: { ...pendingSend, stage: publishingPendingSends.has(draftKey!) ? "publishing"
      : pendingSend.stage === "publishing" ? "unknown" : pendingSend.stage === "uploading" ? "failed" : pendingSend.stage } } : null);
    setIsEmojiPickerOpen(false);
    setProblem(null);
    setProblemNeutral(false);
    setDragging(false);
    setOriginals(new Map());
    attachmentActions.setSpoileredAttachmentUrls(new Set(saved?.spoileredAttachmentUrls ?? (editTarget ? findSpoileredImetaMediaUrls(editTarget.body, editableMedia) : [])));
    draftReady.current = Boolean(draftIdentity && draftKey);
    setLoadedDraftOwner(owner);
    return () => { draftReady.current = false; };
  }});
  useEffect(() => {
    if (loadedDraftOwner === owner && !editTarget) addressLock.restoreAddressedAgentMentions();
  }, [loadedDraftOwner, owner, editTarget, audienceScope, addressLock.restoreAddressedAgentMentions]);
  const persistDraft = useCallback((editorContent: string, attachments: Pending[], installationIds = mentionInstallationIds) => {
    if (!draftReady.current || !draftKey || !owner.active || loadedDraftOwner !== owner) return;
    // Normal drafts retain authored text, not the original addressing prefix.
    // A captured publication/UNKNOWN retry retains its exact content and key.
    const content = intent.current ? editorContent : stripImplicitAgentMentionPrefix(editorContent, implicitAgentMentionProvenance.getPrefix());
    if (!content.trim() && attachments.length === 0 && !intent.current) { clearDraftEntry(draftKey); return; }
    const previous = loadDraftEntry(draftKey);
    const timestamp = new Date().toISOString();
    saveDraftEntry(draftKey, {
      content, channelId: workspaceId ?? draftChannelId ?? draftKey, selectionStart: content.length, selectionEnd: content.length,
      createdAt: previous?.createdAt ?? timestamp, updatedAt: timestamp, status: "active",
      pendingImeta: attachments.map(asBlob),
      spoileredAttachmentUrls: [...attachmentActions.spoileredAttachmentUrls], ...(intent.current ? { sendIntent: intent.current } : {}),
      mentionInstallationIds: installationIds,
      mentionRefs: [...humanBindings.current].map(([displayName, pubkey]) => ({displayName, pubkey, ...(knownAgentKeys.has(pubkey) ? {isAgent:true} : {})})),
    });
  }, [draftKey, workspaceId, draftChannelId, owner, loadedDraftOwner, mentionInstallationIds, attachmentActions.spoileredAttachmentUrls, knownAgentKeys, implicitAgentMentionProvenance.getPrefix]);
  useEffect(() => { persistDraft(richText.getMarkdown(), pending); }, [draftRevision, pending, persistDraft, richText.getMarkdown]);

  // DD-146 pending send: the frozen message as a draft-store record (original
  // saveQueuedAttachmentsForDraft keeps its local files; Kailo keeps only their names).
  const pendingSendRecord = useCallback((snapshot: SendSnapshot, stage: PendingSendStage): PendingSendState => {
    const timestamp = new Date().toISOString();
    return { stage, extras: { gifs: snapshot.gifs },
      missingFileNames: [...snapshot.batches].flatMap(batch => [...batch.active.values(), ...batch.remaining]).concat(snapshot.remainingFiles).map(file => file.name),
      draft: { content: snapshot.content, channelId: workspaceId ?? draftChannelId ?? draftKey ?? "", selectionStart: snapshot.content.length,
        selectionEnd: snapshot.content.length, createdAt: timestamp, updatedAt: timestamp, status: "active",
        pendingImeta: snapshot.pending.map(asBlob), spoileredAttachmentUrls: [...snapshot.spoilers],
        ...(snapshot.intent.current ? { sendIntent: snapshot.intent.current } : {}), mentionInstallationIds: snapshot.installationIds,
        mentionRefs: [...snapshot.bindings].map(([displayName, pubkey]) => ({displayName, pubkey, ...(knownAgentKeys.has(pubkey) ? {isAgent: true} : {})})) } };
  }, [workspaceId, draftChannelId, draftKey, knownAgentKeys]);
  const persistPendingSend = useCallback((snapshot: SendSnapshot, stage: PendingSendStage) => {
    if (draftIdentity && draftKey) savePendingSend(draftKey, pendingSendRecord(snapshot, stage));
  }, [draftIdentity, draftKey, pendingSendRecord]);
  persistQueuedRef.current = (snapshot) => persistPendingSend(snapshot, "uploading");
  const clearComposer = useCallback(() => {
    richText.setContent("");
    setDraft("");
    setPreviewContent("");
    pasteBinding.clearMentionIntents();
    humanBindings.current = new Map(); composerMentions.refreshSelectedNames(); composerMentions.cancelMentionAutocomplete();
    channelLinks.clearChannels(); emojiAutocomplete.clearEmojis();
    setPending([]);
    setPendingGifs([]);
    setOriginals(new Map());
    attachmentActions.setSpoileredAttachmentUrls(new Set());
    setMentionInstallationIds([]);
    intent.current = null;
  }, [richText.setContent, pasteBinding, channelLinks.clearChannels, emojiAutocomplete.clearEmojis, attachmentActions.setSpoileredAttachmentUrls]);
  // Original restoreComposerAfterFailure: the frozen message returns to the composer, its key
  // with it (an UNKNOWN retry stays the same publication), and its canceled files upload again.
  const applyPendingSend = useCallback(({ record, files }: { record: PendingSendState; files: File[] }) => {
    const { draft: saved } = record;
    richText.setContent(saved.content);
    setDraft(saved.content);
    setPreviewContent(saved.content);
    const extras = record.extras as { gifs?: unknown } | undefined;
    setPendingGifs(Array.isArray(extras?.gifs) ? extras.gifs as WebGifItem[] : []);
    setPending(saved.pendingImeta.map(({ uploaded, ...descriptor }) => ({ name: descriptor.filename ?? descriptor.sha256, receivedAt: uploaded, descriptor })));
    attachmentActions.setSpoileredAttachmentUrls(new Set(saved.spoileredAttachmentUrls));
    intent.current = saved.sendIntent ?? null;
    setMentionInstallationIds(saved.mentionInstallationIds ?? []);
    humanBindings.current = new Map((saved.mentionRefs ?? []).map(ref => [ref.displayName, ref.pubkey]));
    for (const ref of saved.mentionRefs ?? []) if (ref.isAgent === true) knownAgentKeys.add(ref.pubkey);
    composerMentions.refreshSelectedNames();
    if (draftKey) clearPendingSend(draftKey);
    if (files.length) void attach(files);
  }, [richText.setContent, attachmentActions.setSpoileredAttachmentUrls, knownAgentKeys, draftKey, attach]);
  const composerIsEmpty = useCallback(() => !richText.getMarkdown().trim() && pendingRef.current.length === 0 &&
    pendingGifsRef.current.length === 0 && [...activeBatches.current].every(batch => batch.canceled), [richText.getMarkdown]);
  /** Returns whether the message is back in the composer (otherwise it waits as a recovery). */
  const restoreSnapshot = useCallback((snapshot: SendSnapshot, stage: "failed" | "unknown"): boolean => {
    if (!snapshot.cleared) return true;
    snapshot.cleared = false;
    const record = pendingSendRecord(snapshot, stage);
    if (owner.active && composerIsEmpty()) {
      applyPendingSend({ record, files: snapshot.remainingFiles });
      return true;
    }
    if (draftIdentity && draftKey) savePendingSend(draftKey, record);
    if (owner.active) setRecovery({ record, files: snapshot.remainingFiles });
    return false;
  }, [owner, composerIsEmpty, pendingSendRecord, applyPendingSend, draftIdentity, draftKey]);
  // Another visit's publication settling (or a discard elsewhere) updates the offered recovery.
  useEffect(() => draftKey ? subscribeToStore(() => setRecovery((current) => {
    if (!current) return current;
    const record = loadPendingSend(draftKey);
    if (!record) return null;
    return record.stage === current.record.stage && record.draft.updatedAt === current.record.draft.updatedAt ? current
      : { ...current, record: { ...record, stage: record.stage === "uploading" ? "failed" : record.stage } };
  })) : undefined, [draftKey]);
  const restoreRecovery = useCallback(() => {
    if (!recovery || !composerIsEmpty()) return;
    applyPendingSend(recovery);
    setRecovery(null);
    if (recovery.record.stage === "unknown") { setProblemNeutral(true); setProblem(t("platform.sendUnknown", { operation: "" })); }
  }, [recovery, composerIsEmpty, applyPendingSend]);
  const discardRecovery = useCallback(() => {
    if (draftKey) clearPendingSend(draftKey);
    setRecovery(null);
  }, [draftKey]);

  // DD-125(8) original non-member prompt. The draft is never cleared by it: Cancel keeps it,
  // "Invite" publishes only after every invited membership is ACTIVE, and "send without
  // inviting" moves these people to reference-only mentions.
  const queryClient = useQueryClient();
  const [nonMemberPrompt, setNonMemberPrompt] = useState<NonMemberPrompt | null>(null);
  const [nonMemberError, setNonMemberError] = useState<string | null>(null);
  useEffect(() => { setNonMemberPrompt(null); setNonMemberError(null); }, [owner]);
  const promptNonMembers = useCallback(async (pubkeys: string[]) => {
    if (!nonMemberMentionWorkspaceId) return;
    const directory: ConversationParticipant[] = await queryClient.ensureQueryData(tenantMentionDirectoryQuery(bff, draftIdentity ?? "")).catch(() => []);
    if (!owner.active) return;
    const {principals, unresolved} = nonMemberInvitePrincipals(directory, pubkeys);
    // "Invite" only when the BFF admits adding every one of them (canAddToWorkspace).
    const canInvite = unresolved.length === 0 &&
      await resolveNonMemberInviteAdmission(bff, nonMemberMentionWorkspaceId, principals.map(principal => principal.principalId));
    if (!owner.active) return;
    const names = pubkeys.map(pubkey => getMentionDisplayName(pubkey)
      ?? directory.find(person => person.pubkeys.some(key => key.toLowerCase() === pubkey))?.displayName ?? unknownMemberLabel());
    setNonMemberError(null);
    setNonMemberPrompt({owner, workspaceId: nonMemberMentionWorkspaceId, pubkeys, principals, names, canInvite});
  }, [nonMemberMentionWorkspaceId, queryClient, draftIdentity, owner, getMentionDisplayName]);
  const runNonMemberInvite = useCallback((prompt: NonMemberPrompt, signal: AbortSignal) =>
    inviteAndAwaitActive({client: bff, workspaceId: prompt.workspaceId, principals: prompt.principals, signal}), []);
  const completeInvitedSend = useCallback(async (prompt: NonMemberPrompt, signal: AbortSignal) => {
    // The roster read after convergence admits them; the choice covers them until it renders.
    await queryClient.invalidateQueries({queryKey: ["platform", "members", prompt.workspaceId]}).catch(() => {});
    void queryClient.invalidateQueries({queryKey: ["platform", "channel-members", prompt.workspaceId]});
    if (signal.aborted || prompt.owner !== owner || !owner.active) return;
    setNonMemberPrompt(null);
    sendRef.current({kind: "invited", pubkeys: prompt.pubkeys});
  }, [queryClient, owner]);
  const invitation = useNonMemberInvite({draft: nonMemberPrompt, canInvite: nonMemberPrompt?.canInvite ?? false,
    run: runNonMemberInvite, onActive: completeInvitedSend, setError: setNonMemberError});
  const sendWithoutInviting = useCallback(() => {
    if (!nonMemberPrompt) return;
    invitation.cancel();
    setNonMemberPrompt(null);
    setNonMemberError(null);
    sendRef.current({kind: "reference", pubkeys: nonMemberPrompt.pubkeys});
  }, [nonMemberPrompt, invitation.cancel]);
  const dismissNonMemberPrompt = useCallback(() => {
    invitation.cancel();
    setNonMemberPrompt(null);
    setNonMemberError(null);
  }, [invitation.cancel]);

  // The publication of one frozen message (DD-81 intent, DD-125 mentions and previews). A cleared
  // DD-146 snapshot is no longer in the composer: every outcome but success restores it.
  const dispatch = useCallback(async (snapshot: SendSnapshot, decision?: NonMemberDecision) => {
    const { content, pending, gifs, installationIds: mentionInstallationIds, intent } = snapshot;
    const humanBindings = { current: snapshot.bindings };
    const restore = (stage: "failed" | "unknown" = "failed") => restoreSnapshot(snapshot, stage);
    if (!content && pending.length === 0 && gifs.length === 0) { restore(); return; }
    setProblem(null);
    setProblemNeutral(false);
    const attachments = pending.map((p) => ({ ...p.descriptor, spoiler: snapshot.spoilers.has(p.descriptor.url) }));
    // 不本地插入这条消息：它要等 Relay 接受并回传 event id 才算发出去。
    // 先渲染再等确认，会让一条被拒绝的消息看起来已经发出。草稿与附件也只在
    // 确认后才清空——发送失败时它们都还在。DD-146 在发送时已清空的消息，未确认的
    // 每种结局都把它整条恢复到输入框（或作为待恢复的发送保留）。
    let humanMentionPubkeys:string[]=[];
    let nonMemberPubkeys: string[] = [];
    let selectedInstallationIds: string[] = [];
    // DD-148 original buildAgentAddressMentionTags input: the tray-addressed Agents that are delivered.
    let addressedInstallationIds: string[] = [];
    try {
      // A typed label binds only channel members; people outside are mentioned by explicit selection.
      const memberCandidates=mentionCandidates.map(person=>({...person,isMember:person.notInChannel!==true}));
      const recipients=[...new Set([...extractMentionPubkeys({text:content,selectedMentions:humanBindings.current, memberCandidates}), ...audience.pubkeys])];
      const agentRecipients = recipients.filter(pubkey => knownAgentKeys.has(pubkey) || audience.pubkeys.includes(pubkey));
      if (agentRecipients.length || mentionInstallationIds.length) {
        const fresh = await agentDirectory.verify();
        if (!owner.active) { restore(); return; }
        if (agentRecipients.some(pubkey => !fresh.agents.some(agent => agent.pubkey === pubkey)) ||
            mentionInstallationIds.some(id => !fresh.agents.some(agent => agent.installation.resourceId === id))) throw new MentionAgentNotAllowedError();
        selectedInstallationIds = [...new Set([...mentionInstallationIds, ...agentRecipients.map(pubkey => fresh.agents.find(agent => agent.pubkey === pubkey)!.installation.resourceId)])].sort();
        addressedInstallationIds = [...new Set(audience.pubkeys.flatMap(pubkey => {
          const agent = fresh.agents.find(candidate => candidate.pubkey === pubkey);
          return agent && selectedInstallationIds.includes(agent.installation.resourceId) ? [agent.installation.resourceId] : [];
        }))].sort();
      }
      humanMentionPubkeys=recipients.filter(pubkey => !agentRecipients.includes(pubkey));
      // DD-125(8): people who are not ACTIVE members of this channel's Workspace. Outside the
      // Workspace channel flow they are never published (the directory no longer admits them).
      nonMemberPubkeys=humanMentionPubkeys.filter(pubkey=>!mentionPeopleRef.current?.some(person=>person.pubkey.toLowerCase()===pubkey));
      if(nonMemberPubkeys.length&&!nonMemberFlow)throw new Error(t("platform.loadFailed"));
      // Freeze typed labels as well as picker selections into the original draft
      // references before publication. Renaming a member must not retarget an
      // UNKNOWN retry; keep the original recipient order in its signature.
      const occurrences=mentionOccurrences(content,mentionMatchCandidates({selectedMentions:humanBindings.current,memberCandidates}));
      for(const pubkey of humanMentionPubkeys) for(const {candidates} of occurrences) {
        for(const candidate of candidates) if(candidate.pubkey===pubkey) humanBindings.current.set(candidate.displayName,pubkey);
      }
    } catch(error) {setProblem(error instanceof AmbiguousMentionError?t("pulse.mentionAmbiguous",{name:error.displayName})
      :error instanceof MentionAgentNotAllowedError?t("platform.mentionAgentNotAllowed"):t("platform.loadFailed"));restore();return;}
    // Original buildOutgoingMessage: chosen GIFs are body lines, not imeta.
    const published = withGifLines(content, gifs);
    const messagePayload = [
      published,
      attachments.map((a) => {
        const metadata = { displayLabel: a.displayLabel, dim: a.dim, blurhash: a.blurhash, thumb: a.thumb, duration: a.duration, image: a.image };
        // Keep the existing signature for legacy attachments with no extended
        // metadata; every newly supported published field is part of intent.
        return [a.sha256, a.filename, a.spoiler, ...(Object.values(metadata).some((value) => value !== undefined) ? [metadata] : [])];
      }),
      selectedInstallationIds,
      ...(addressedInstallationIds.length ? [addressedInstallationIds] : []),
    ];
    // DD-125(5): an unresolved intent for this same message keeps the previews it first named
    // (same key, same publication); otherwise wait for this draft's previews (original 10 s
    // budget with Skip).
    const unresolvedSameMessage = (() => {
      if (!intent.current) return false;
      try {
        const previous: unknown = JSON.parse(intent.current.signature);
        return Array.isArray(previous) && JSON.stringify(previous.slice(0, messagePayload.length)) === JSON.stringify(messagePayload);
      } catch { return false; }
    })();
    // DD-125(8) original non-member prompt, before link previews are awaited. A choice made in
    // the prompt (or frozen in this message's unresolved intent) covers exactly these people.
    let referenceMentionPubkeys: string[] = [];
    if (nonMemberPubkeys.length) {
      const covers = (keys: readonly string[] | undefined) => keys !== undefined && nonMemberPubkeys.every(pubkey => keys.includes(pubkey));
      // DD-125(8), V-SCN-164: an unresolved (UNKNOWN) intent keeps its recipients. Only an intent
      // that froze these people as reference mentions is re-queried under the same key; one that
      // froze them as `p` recipients who are no longer members fails closed below, with no prompt,
      // no replay and no silently dropped recipient.
      const choice = unresolvedSameMessage
        ? covers(frozenReferenceMentions(intent.current?.signature)) ? "reference" : undefined
        : decision && covers(decision.pubkeys) ? decision.kind : undefined;
      if (!choice) {
        // An unresolved intent cannot gain a new recipient decision; nor is it silently replayed.
        if (unresolvedSameMessage) { setProblem(t("platform.loadFailed")); restore("unknown"); return; }
        // The prompt's decision re-sends from the composer; a recovery waits for its restore.
        if (!restore()) return;
        await promptNonMembers(nonMemberPubkeys);
        return;
      }
      if (choice === "reference") {
        ({mentionPubkeys: humanMentionPubkeys, referenceMentionPubkeys} = withoutInvitingRecipients({mentionPubkeys: humanMentionPubkeys, nonMemberPubkeys}));
      }
    }
    const linkPreviewIntent = unresolvedSameMessage
      ? frozenLinkPreviews(intent.current?.signature)
      : snapshot.cleared ? snapshot.linkPreviews : await linkPreviews.prepareSubmit();
    if (!owner.active) { restore(); return; }
    // The reference choice is part of the intent: "invite" and "send without inviting" never share a key.
    const signature = JSON.stringify([
      ...messagePayload,
      ...(humanMentionPubkeys.length?[humanMentionPubkeys]:[]),
      ...(referenceMentionPubkeys.length ? [{ referenceMentionPubkeys }] : []),
      ...(linkPreviewIntent ? [{ linkPreviews: linkPreviewIntent }] : []),
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
        restore("unknown");
        return;
      }
    }
    if (intent.current?.signature !== signature) {
      intent.current = { key: newIntentKey(), signature };
    }
    const key = intent.current.key;
    if (snapshot.cleared) {
      // Persisted before dispatch: a reload during publication finds this key, never a new one.
      snapshot.installationIds = selectedInstallationIds;
      persistPendingSend(snapshot, "publishing");
      if (draftKey) publishingPendingSends.add(draftKey);
    } else {
      setMentionInstallationIds(selectedInstallationIds);
      persistDraft(content, pending, selectedInstallationIds);
    }
    const publish = onPublish
      ? addressedInstallationIds.length
        ? onPublish(published, attachments, key, selectedInstallationIds, humanMentionPubkeys, linkPreviewIntent, referenceMentionPubkeys, addressedInstallationIds)
      : referenceMentionPubkeys.length
        ? onPublish(published, attachments, key, selectedInstallationIds, humanMentionPubkeys, linkPreviewIntent, referenceMentionPubkeys)
        : linkPreviewIntent
          ? onPublish(published, attachments, key, selectedInstallationIds, humanMentionPubkeys, linkPreviewIntent)
          : onPublish(published, attachments, key, selectedInstallationIds, humanMentionPubkeys)
      : workspaceId
        ? publishMessage(workspaceId, published, attachments, key, selectedInstallationIds, {mentionPubkeys: humanMentionPubkeys,
            ...(referenceMentionPubkeys.length ? {referenceMentionPubkeys} : {}),
            ...(addressedInstallationIds.length ? {addressedInstallationIds} : {}), ...linkPreviewIntent}).then((receipt) => {
            if (!receipt?.eventId || !receipt.operationId) throw new TransportError("Message has no confirmed receipt.");
            return receipt;
          })
        : Promise.reject(new Error("Message destination is unavailable."));
    await publish
      .then(() => {
        // An accepted send proves the community write-block is lifted (original clearTimeoutState).
        clearTimeoutState();
        if (snapshot.cleared) {
          if (draftKey) {
            publishingPendingSends.delete(draftKey);
            if (loadPendingSend(draftKey)?.draft.sendIntent?.key === key) clearPendingSend(draftKey);
          }
          if (!owner.active) return;
          onConfirmed?.();
          setConfirmedSendRevision((revision) => revision + 1);
          return;
        }
        if (!owner.active) return;
        if (intent.current?.key === key) intent.current = null;
        if (richText.getMarkdown().trim() === content) {
          richText.setContent("");
          setDraft("");
          setPreviewContent("");
          pasteBinding.clearMentionIntents();
          humanBindings.current.clear();composerMentions.refreshSelectedNames();composerMentions.cancelMentionAutocomplete();
          channelLinks.clearChannels(); emojiAutocomplete.clearEmojis();
        }
        setPending((current) => current.filter((p) => !pending.includes(p)));
        setPendingGifs((current) => current.filter((gif) => !gifs.includes(gif)));
        setOriginals((current) => new Map([...current].filter(([url]) => !pending.some((entry) => entry.descriptor.url === url))));
        attachmentActions.setSpoileredAttachmentUrls((current) => new Set([...current].filter((url) => !pending.some((entry) => entry.descriptor.url === url))));
        setMentionInstallationIds((current) => current.filter((id) => !selectedInstallationIds.includes(id)));
        if (editTarget && draftKey) clearDraftEntry(draftKey);
        onConfirmed?.();
        setConfirmedSendRevision((revision) => revision + 1);
      })
      .catch((e: unknown) => {
        if (snapshot.cleared && draftKey) publishingPendingSends.delete(draftKey);
        // A definite rejection ends this intent; any other outcome keeps its key for the same retry.
        if (e instanceof BffError && e.reason === ReasonCode.PublishRejected) intent.current = null;
        restore(isOutcomeUnknown(e) ? "unknown" : "failed");
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
          // DD-125(2): a community timeout shows the original banner instead of a generic error.
          if (recordTimeoutFromRestriction(e.restriction)) setProblem(null);
          else setProblem(t(e.restriction?.kind === PublishRestrictionKind.Banned ? "moderation.banned" : "platform.sendRejected"));
        } else {
          setProblem(t("platform.sendFailed"));
        }
      });
  }, [restoreSnapshot, persistPendingSend, linkPreviews.prepareSubmit, workspaceId, onPublish, richText.getMarkdown, richText.setContent, owner, persistDraft, attachmentActions.setSpoileredAttachmentUrls, editTarget, draftKey, onConfirmed, pasteBinding, mentionCandidates, knownAgentKeys, audience.pubkeys, agentDirectory.verify, channelLinks.clearChannels, emojiAutocomplete.clearEmojis, nonMemberFlow, promptNonMembers]);
  const prepareSend = async ({ release, decision }: { release: () => void; decision?: NonMemberDecision }) => {
    if (!editTarget) {
      // Original useMentionSendFlow: Send freezes the message and clears the composer before it is
      // published; uploads still in flight hold the frozen message, not the composer (DD-146).
      let snapshot: SendSnapshot | null = null;
      owner.sending = true;
      setSending(true);
      try {
        await pasteBinding.settlePendingMentionBindings();
        if (!owner.active) return;
        // Previews belong to the text being cleared; they are prepared before it goes.
        const linkPreviewIntent = await linkPreviews.prepareSubmit();
        if (!owner.active) return;
        const content = richText.getMarkdown().trim();
        if (!content && pendingRef.current.length === 0 && pendingGifsRef.current.length === 0 && activeBatches.current.size === 0) return;
        snapshot = { content, pending: pendingRef.current, gifs: pendingGifsRef.current,
          bindings: new Map(humanBindings.current), installationIds: mentionInstallationIds, spoilers: new Set(attachmentActions.spoileredAttachmentUrls),
          intent: { current: intent.current }, linkPreviews: linkPreviewIntent, cleared: true,
          batches: new Set(activeBatches.current), remainingFiles: [], failed: false };
        clearComposer();
        setProblem(null);
        setProblemNeutral(false);
        // Persisted at once: a reload before publication offers it back as not sent.
        persistPendingSend(snapshot, "uploading");
        if (snapshot.batches.size) {
          queuedRef.current = snapshot;
          setQueued(snapshot);
          snapshot = null;
        }
      } finally {
        owner.sending = false;
        if (owner.active) setSending(false);
      }
      release();
      if (!snapshot) return;
      setClearedPublishing((count) => count + 1);
      try { await dispatch(snapshot, decision); }
      finally { if (owner.active) setClearedPublishing((count) => Math.max(0, count - 1)); }
      return;
    }
    owner.sending = true;
    setSending(true);
    try {
      await pasteBinding.settlePendingMentionBindings();
      if (!owner.active) return;
      await dispatch({ content: richText.getMarkdown().trim(), pending, gifs: pendingGifs, bindings: humanBindings.current,
        installationIds: mentionInstallationIds, spoilers: attachmentActions.spoileredAttachmentUrls, intent, cleared: false,
        batches: new Set(), remainingFiles: [], failed: false }, decision);
    } finally {
      owner.sending = false;
      if (owner.active) setSending(false);
    }
  };
  const { submit: send } = useComposerSubmission<null, NonMemberDecision>({
    getContent: richText.getMarkdown,
    hasMedia: () => pendingRef.current.length > 0 || pendingGifsRef.current.length > 0 || activeBatches.current.size > 0,
    canSubmit: () => owner.active && !sending && !owner.sending && !disabled && !queuedRef.current && voiceNote.statusRef.current === "idle" && mentionVerified && !(editTarget && uploading > 0),
    isEditing: Boolean(editTarget), isDm: channelType === "dm", dmAgentNames,
    refuseDmAgent: refused => { if (refused) { setProblemNeutral(false); setProblem(t("dm.agentMentionRefused")); } },
    requestEmptyEdit: editTarget && onRequestEmptyEditDelete ? () => {
      if (!intent.current) onRequestEmptyEditDelete(editTarget);
      else { setProblemNeutral(true); setProblem(t("platform.sendUnknown", { operation: "" })); }
    } : undefined,
    capture: () => null, prepare: prepareSend,
  });
  sendRef.current = send;
  // DD-146: a queued send is released once none of its uploads is in flight — published if each
  // was confirmed, otherwise (failed or canceled) its draft returns with the remaining files.
  useEffect(() => {
    const snapshot = queuedRef.current;
    // A canceled batch is released at once; its aborted request can no longer land anywhere.
    if (!snapshot || queued !== snapshot || [...snapshot.batches].some(batch => !batch.canceled && activeBatches.current.has(batch))) return;
    queuedRef.current = null;
    setQueued(null);
    if (snapshot.failed) { restoreSnapshot(snapshot, "failed"); return; }
    // Its publication is not shown in the timeline before the Relay confirms it; the pill says it is on its way.
    setClearedPublishing((count) => count + 1);
    void dispatch(snapshot).finally(() => { if (owner.active) setClearedPublishing((count) => Math.max(0, count - 1)); });
  }, [queued, batchRevision, uploadingPreviews, restoreSnapshot, dispatch, owner]);
  const cancelQueuedSend = useCallback(() => {
    const snapshot = queuedRef.current;
    if (!snapshot) return;
    snapshot.failed = true;
    for (const batch of snapshot.batches) {
      batch.canceled = true;
      snapshot.remainingFiles.push(...batch.active.values(), ...batch.remaining.splice(0));
      for (const id of [...batch.active.keys()]) cancelUpload(id);
    }
    setBatchRevision((revision) => revision + 1);
  }, [cancelUpload]);
  const queuedPreviewIds = new Set(queued ? [...queued.batches].flatMap(batch => [...batch.active.keys()]) : []);
  const queuedPreviews = uploadingPreviews.filter(preview => queuedPreviewIds.has(preview.id));
  const composerPreviews = uploadingPreviews.filter(preview => !queuedPreviewIds.has(preview.id));
  const composerUploading = Math.max(0, uploading - queuedPreviews.length);

  useComposerAutoSubmit({
    owner, enabled: Boolean(autoSendDraftKey && autoSendDraftKey === draftKey),
    ready: loadedDraftOwner === owner && draftReady.current && !disabled && !sending && uploading === 0 && voiceNote.status === "idle" && mentionVerified && Boolean(richText.getMarkdown().trim() || pending.length),
    active: () => owner.active, consume: onAutoSendConsumed,
    beforeSubmit: () => {
      if (!intent.current) return true;
      // Restored UNKNOWN retains its exact existing operation; opening a draft
      // cannot derive another signature or automatically retry it.
      setProblemNeutral(true); setProblem(t("platform.sendUnknown", { operation: "" }));
      return false;
    },
    submit: send,
    onError: () => setProblem(t("platform.sendFailed")),
  });

  const ComposerSurface = surface === "forum" ? ForumComposerSurface : MessageComposerSurface;
  return <ComposerSurface
    {...(surface === "forum" ? { compact, confirmedSendRevision,
      hasComposerContent: Boolean(draft.trim() || pending.length || problem || dragging),
      autocompleteOpen: humanSuggestions.length > 0 || channelLinks.isChannelOpen || emojiAutocomplete.isEmojiAutocompleteOpen,
    } : {})}
    containerClassName={containerClassName} scrollRef={composerScrollRef} formRef={formRef}
    header={<>{composerHeader}<ComposerReplyBanner replyTarget={replyTarget} onCancelReply={sending ? undefined : onCancelReply}
      isEditing={editTarget !== undefined} isEditCancelDisabled={sending} onCancelEdit={onCancelEdit} /></>}
    overlays={<>{linkEditor.card}{linkEditor.dialog}</>}
    formProps={{
      onSubmit: handleSubmit,
      onPasteCapture: (event) => {
        if (disabled || sending || !event.clipboardData.files.length) return;
        event.preventDefault();
        void attachFilesWhenIdle(event.clipboardData.files);
      },
      onDragOver: (event) => { if (!disabled && !sending && voiceNote.acceptsAttachment && event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } },
      onDragLeave: (event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); },
      onDrop: (event) => { setDragging(false); if (!disabled && !sending && event.dataTransfer.files.length) { event.preventDefault(); void attachFilesWhenIdle(event.dataTransfer.files); } },
    }}
    onEditorKeyDown={composerKeyDown({
      alwaysAddress: handleAlwaysAddressShortcut,
      emoji: emojiAutocomplete.handleEmojiKeyDown, selectEmoji: applyEmojiInsert,
      channel: channelLinks.handleChannelKeyDown, selectChannel: applyChannelInsert,
      mentionOpen: humanSuggestions.length > 0,
      mention: event => composerMentions.handleMentionKeyDown(event, { isCodeContext: () => isMentionCodeContext(richText.editor) }),
      selectMention: selectHuman, linkEditor,
    })}
    toolbar={{ layoutMode, composerDisabled: disabled || sending, customEmoji,
      addressedAgents: disabled || sending || editTarget ? [] : addressLock.lockedAgents,
      autoPinConfirmationTitle: autoPin.confirmationTitle,
      onAutoPinConfirmationDismiss: autoPin.dismissConfirmation,
      onAutoPinConfirmationHoverChange: autoPin.setConfirmationHovered,
      onAutoPinConfirmationTurnOff: mentionPicker.turnOff,
      onRemoveAddressedAgent: removeAddressedAgent,
      pulseVersionByPubkey: addressPulse.pulseVersionByPubkey,
      shakeVersionByPubkey: addressPulse.shakeVersionByPubkey,
      extraActions: onCancel || toolbarExtraActions ? <>{onCancel ? <Button type="button" variant="ghost" disabled={sending} onClick={onCancel}>{t("platform.cancel")}</Button> : null}{toolbarExtraActions}</> : undefined,
      editor: richText.editor, formattingDisabled: disabled || sending, isEmojiPickerOpen, isFormattingOpen,
      isSending: sending, isUploading: composerUploading > 0,
      isVoiceNoteProcessing: voiceNote.status !== "recording",
      isVoiceNoteRecording: voiceNote.status !== "idle",
      hasVoiceNoteAttachment: voiceNote.hasAttachment,
      voiceNoteRecorder: voiceNote.recorderElement,
      onEmojiPickerOpenChange: setIsEmojiPickerOpen,
      onFormattingToggle: handleFormattingToggle,
      onCaptureSelection: handleCaptureSelection,
      onLinkButton: linkEditor.openFromToolbar,
      onOpenMentionPicker: mentionPeople || workspaceId ? openPeople : undefined,
      onPaperclip: () => { if (!voiceNote.hasAttachmentRef.current) picker.current?.click(); },
      onFinishVoiceNote: () => void voiceNote.finish(), onVoiceNote: voiceNote.toggle,
      sendDisabled: disabled || sending || queued !== null || voiceNote.status !== "idle" || !mentionVerified || (!(editTarget && onRequestEmptyEditDelete) && !draft.trim() && pending.length === 0 && pendingGifs.length === 0),
      gifs: gifOption,
    }}>
      {dragging ? <DropZoneOverlay /> : null}
      <div className={surface === "forum" ? undefined : "relative"}>
      <MessageComposerAutocompletes
        position={autocompleteBelow ? "below" : "above"}
        composerOwnsFocus={composerOwnsFocus && !disabled && !sending}
        emojiAutocomplete={emojiAutocomplete} channelLinks={channelLinks} mentions={composerMentions}
        onEmojiSelect={applyEmojiInsert} onChannelSelect={applyChannelInsert} onMentionSelect={selectHuman}
        audienceControlsEnabled={Boolean(audienceScope && !editTarget)}
        lockedAgentPubkeys={addressLock.lockedAgentPubkeys}
        onToggleAlwaysAddressAgent={suggestion => addressLock.toggleAlwaysAddressAgent(suggestion, {preserveMention: true})}
        keepMentionedAgentsPinned={keepMentionedAgentsPinned}
        onKeepMentionedAgentsPinnedChange={setKeepMentionedAgentsPinned}
        openOptionsRequest={autoPin.openOptionsRequest}
        onOptionsRevealComplete={autoPin.completeOptionsReveal}
      />
      </div>
      <output aria-live="polite" className="sr-only" data-testid="composer-address-lock-status">{addressLock.announcement}</output>
      {!mentionVerified ? (
        <div role="alert">{t("platform.mentionAgentsUnavailable")}</div>
      ) : null}
      {problem ? (
        <div className={problemNeutral ? "text-xs text-muted-foreground" : "text-xs text-destructive"} role={problemNeutral ? "status" : "alert"}>
          {problem}
        </div>
      ) : null}
      {queued ? <ComposerQueuedSendPill previews={queuedPreviews} onCancel={cancelQueuedSend} />
        : clearedPublishing > 0 ? <ComposerPendingSendRecovery stage="publishing" missingFiles={0} canRestore={false} onRestore={() => {}} onDiscard={() => {}} /> : null}
      {recovery ? <ComposerPendingSendRecovery stage={recovery.record.stage} missingFiles={recovery.record.missingFileNames.length}
        canRestore={!draft.trim() && pending.length === 0 && pendingGifs.length === 0 && composerUploading === 0}
        onRestore={restoreRecovery} onDiscard={discardRecovery} /> : null}
      <ComposerLinkPreviewPreparing previews={linkPreviews} />
      <ComposerLinkPreviewCards previews={linkPreviews} resolveMedia={resolvePreviewMedia} />
      <ComposerGifAttachments gifs={pendingGifs} onRemove={(gif) => setPendingGifs((current) => current.filter((entry) => entry !== gif))} />
      <ComposerAttachments attachments={pending.map(asBlob)} resolveMediaUrl={resolveMediaUrl}
        fetchMediaBytes={fetchMediaBytes} AudioAttachment={BffAudioAttachment} isUploading={composerUploading > 0} uploadingCount={composerUploading}
        uploadingPreviews={composerPreviews} onCancelUpload={cancelUpload}
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
          disabled={disabled || sending || !voiceNote.acceptsAttachment}
          onChange={(e) => {
            void attachFilesWhenIdle(e.target.files);
            e.target.value = "";
          }}
        />
      {nonMemberMentionWorkspaceId !== undefined ? <NonMemberMentionDialog canInvite={nonMemberPrompt?.canInvite ?? false} error={nonMemberError}
        isInvitePending={invitation.isPending || sending} names={nonMemberPrompt?.names ?? []}
        onDismiss={dismissNonMemberPrompt} onDoNothing={sendWithoutInviting} onInvite={invitation.invite}
        open={nonMemberPrompt !== null && nonMemberPrompt.owner === owner} onRestoreFocus={focusComposerEnd} /> : null}
  </ComposerSurface>;
}
