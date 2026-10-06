import type { ReactNode } from "react";

import type { MediaUploadController } from "@/features/messages/lib/useMediaUpload";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import type { TimelineMessage } from "@/features/messages/types";

export type MessageComposerProps = {
  surface?: "stream" | "forum";
  channelId?: string | null;
  channelName: string;
  containerClassName?: string;
  /**
   * `dock` delegates backdrop blur and bottom-rail geometry to a surrounding
   * composer dock. `standalone` keeps both concerns inside this component.
   */
  layoutMode?: "dock" | "standalone";
  disabled?: boolean;
  editTarget?: TimelineMessage;
  onCancelEdit?: () => void;
  draftKey?: string;
  /**
   * When provided, the composer fires `submitMessage` once on mount after
   * the draft matching this key has been loaded into the editor. This powers
   * the "Send message" confirm-dialog flow in the Drafts panel. The callback
   * `onAutoSubmitComplete` must clear the trigger (e.g. remove `?autoSend`
   * from the URL) — it is called synchronously before `submitMessage` fires
   * so the param is gone before any navigation the send might cause.
   *
   * Fires at most once per mount: a stable key value that persists across
   * re-renders does NOT re-fire.
   */
  autoSubmitDraftKey?: string | null;
  /** Called when the auto-submit fires so the parent can clear the trigger. */
  onAutoSubmitComplete?: () => void;
  isSending?: boolean;
  mediaController?: MediaUploadController;
  /** Reports whether a surrounding drop zone may add an attachment. */
  onAttachmentAcceptanceChange?: (acceptsAttachment: boolean) => void;
  onCancelReply?: () => void;
  /** Captures send context synchronously before awaits can change navigation. */
  onCaptureSendContext?: () => {
    parentEventId: string | null;
    threadHeadId: string | null;
  } | null;
  onPreparingMentionSendChange?: (isPreparing: boolean) => void;
  onSend: (
    content: string,
    mentionPubkeys: string[],
    mediaTags?: string[][],
    channelId?: string | null,
    threadContext?: {
      parentEventId: string | null;
      threadHeadId: string | null;
    } | null,
    /** Route through the REST publisher even when best-effort enrichment settled empty. */
    forceRest?: boolean,
  ) => Promise<void>;
  placeholder?: string;
  profiles?: UserProfileLookup;
  replyTarget?: {
    author: string;
    body: string;
    id: string;
  } | null;
  showTopBorder?: boolean;
  /** Render the app-wide upload queue above this composer dock. */
  showBackgroundUploadProgress?: boolean;
  toolbarExtraActions?: ReactNode;
};
