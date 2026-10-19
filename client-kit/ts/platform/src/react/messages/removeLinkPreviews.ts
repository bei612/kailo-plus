// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/ui/MessageRow.tsx::removeLinkPreviewsForEveryone and
// desktop/src/features/messages/lib/formatTimelineMessages.ts::hasLinkPreviewSuppression.
// The original "Remove preview" re-edits the author's own message with the same body and
// media plus `["link-preview","none"]`. Kailo hosts only offer it; Core re-reads the target,
// checks authorship and signs the 40003 with the suppression marker (DD-125(5)).
import * as React from "react";
import { newIdempotencyKey } from "../../governance";
import { isOutcomeUnknown } from "../../transport";
import type { ImetaMedia } from "../composer/features/messages/lib/imetaMediaMarkdown";
import { hasLinkPreviewSuppression } from "../link-preview/linkPreviewSnapshot";
import {
  findSpoileredImetaMediaUrls,
  imetaMediaFromTags,
  restoreImetaMediaDisplayLabels,
  stripImetaMediaLines,
} from "./editAttachments";
import type { TimelineMessage } from "./types";

const KIND_STREAM_MESSAGE = 9;

/** Original offer condition beyond the host's own edit gating: settled, not yet suppressed. */
export function canRemoveLinkPreviews(message: TimelineMessage): boolean {
  return message.kind === KIND_STREAM_MESSAGE && !message.pending && !hasLinkPreviewSuppression(message.tags);
}

export type LinkPreviewRemovalEdit = {
  content: string;
  attachments: Array<Omit<ImetaMedia, "uploaded"> & { spoiler: boolean }>;
};

/** The same body and media the existing edit flow would resubmit, unchanged. */
export function linkPreviewRemovalEdit(message: Pick<TimelineMessage, "body" | "tags">): LinkPreviewRemovalEdit {
  const media = restoreImetaMediaDisplayLabels(message.body, imetaMediaFromTags(message.tags));
  const spoilered = findSpoileredImetaMediaUrls(message.body, media);
  return {
    content: stripImetaMediaLines(message.body, media).trim(),
    attachments: media.map(({ uploaded: _uploaded, ...descriptor }) => ({
      ...descriptor,
      spoiler: spoilered.has(descriptor.url),
    })),
  };
}

/**
 * One removal intent per message (DD-81): while an attempt's outcome is unknown a retry
 * reuses its idempotency key; a confirmed or refused attempt releases it.
 */
export function useRemoveLinkPreviewsIntent(
  publish: (message: TimelineMessage, edit: LinkPreviewRemovalEdit, idempotencyKey: string) => Promise<unknown>,
): (message: TimelineMessage) => Promise<void> {
  const publishRef = React.useRef(publish);
  React.useLayoutEffect(() => { publishRef.current = publish; }, [publish]);
  const pending = React.useRef(new Map<string, string>());
  return React.useCallback(async (message: TimelineMessage) => {
    const key = pending.current.get(message.id) ?? newIdempotencyKey();
    pending.current.set(message.id, key);
    try {
      await publishRef.current(message, linkPreviewRemovalEdit(message), key);
      pending.current.delete(message.id);
    } catch (error) {
      if (!isOutcomeUnknown(error)) pending.current.delete(message.id);
      throw error;
    }
  }, []);
}
