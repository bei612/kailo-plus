import type * as React from "react";
import type { ImetaMedia } from "@/features/messages/lib/imetaMediaMarkdown";
import type { QueuedMediaAttachment } from "@/features/messages/lib/backgroundMediaUploadStore";
import type { UseChannelLinksResult } from "@/features/messages/lib/useChannelLinks";
import type { UseEmojiAutocompleteResult } from "@/features/messages/lib/useEmojiAutocomplete";
import type { UseMentionsResult } from "@/features/messages/lib/useMentions";
import type { UseRichTextEditorResult } from "@/features/messages/lib/useRichTextEditor";
import type { UseDraftsResult } from "@/features/messages/lib/useDrafts";
import type {
  NonMemberInvitePrincipal,
  NonMemberInviteResult,
} from "@client-kit/platform/react/non-member-mentions/logic";

/** DD-125(8): the Workspace channel's non-member mention flow (omitted elsewhere). */
export type NonMemberMentionOptions = {
  /** ACTIVE member keys of this Workspace; null while unresolved (never judged then). */
  memberPubkeys: ReadonlySet<string> | null;
  /** Agents follow their own admission chain and are never prompted for. */
  isAgentPubkey: (pubkey: string) => boolean;
  getDisplayName: (pubkey: string) => string | undefined;
  /** The Principals behind the keys and whether the viewer may add every one of them. */
  prepare: (pubkeys: readonly string[]) => Promise<{ principals: NonMemberInvitePrincipal[]; canInvite: boolean }>;
  invite: (principals: readonly NonMemberInvitePrincipal[], signal: AbortSignal) => Promise<NonMemberInviteResult>;
  /** Refresh the roster once the invited memberships are ACTIVE. */
  onInvited?: () => void;
};

export type UseMentionSendFlowOptions = {
  /** Visit-bound accessor reading shared source-key intent, even after exit. */
  getComposerRevision: () => number;
  runComposerUpdate: (update: () => void) => void;
  channelId: string | null;
  /** The actual persistence key, including same-channel thread identity. */
  effectiveDraftKey: string | null | undefined;
  channelLinks: Pick<UseChannelLinksResult, "clearChannels">;
  contentRef: React.MutableRefObject<string>;
  drafts: Pick<UseDraftsResult, "loadDraft" | "markDraftSent" | "persistDraft">;
  emojiAutocomplete: Pick<UseEmojiAutocompleteResult, "clearEmojis">;
  mentions: UseMentionsResult;
  onSendRef: React.MutableRefObject<
    (
      content: string,
      mentionPubkeys: string[],
      mediaTags?: string[][],
      channelId?: string | null,
      threadContext?: {
        parentEventId: string | null;
        threadHeadId: string | null;
      } | null,
      forceRest?: boolean,
    ) => Promise<void>
  >;
  richText: Pick<UseRichTextEditorResult, "clearContent" | "setContent">;
  setContent: (content: string) => void;
  setPendingImeta: (pendingImeta: ImetaMedia[]) => void;
  hasUnsavedMedia: () => boolean;
  clearQueuedAttachments: () => void;
  restoreQueuedAttachments: (attachments: QueuedMediaAttachment[]) => void;
  setSpoileredAttachmentUrls?: React.Dispatch<
    React.SetStateAction<Set<string>>
  >;
  nonMemberMentions?: NonMemberMentionOptions;
};
