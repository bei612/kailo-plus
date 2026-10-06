// Extracted from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/messages/lib/useAttachmentEditing.ts.
import * as React from "react";

import type { AttachmentEditingHost } from "./attachmentHost";

type UseAttachmentEditingArgs = {
  revertAttachment: AttachmentEditingHost["revertAttachment"];
  /** Spoiler-set updater; membership follows the attachment across URL swaps. */
  setSpoileredAttachmentUrls: React.Dispatch<React.SetStateAction<Set<string>>>;
  uploadEditedAttachment: AttachmentEditingHost["uploadEditedAttachment"];
};

/**
 * Composer-side glue for the attachment drawing editor: uploads annotated
 * bytes as a replacement / reverts to the pre-edit original, migrating
 * spoiler membership from the replaced URL to its replacement so an edited
 * spoilered image stays spoilered.
 */
export function useAttachmentEditing({
  revertAttachment,
  setSpoileredAttachmentUrls,
  uploadEditedAttachment,
}: UseAttachmentEditingArgs) {
  const migrateSpoileredUrl = React.useCallback(
    (fromUrl: string, toUrl: string) => {
      setSpoileredAttachmentUrls((current) => {
        if (!current.has(fromUrl)) return current;
        const next = new Set(current);
        next.delete(fromUrl);
        next.add(toUrl);
        return next;
      });
    },
    [setSpoileredAttachmentUrls],
  );

  const handleAttachmentEditSave = React.useCallback(
    async (url: string, bytes: Uint8Array) => {
      const descriptor = await uploadEditedAttachment(url, bytes);
      if (descriptor) migrateSpoileredUrl(url, descriptor.url);
    },
    [migrateSpoileredUrl, uploadEditedAttachment],
  );

  const handleAttachmentRevert = React.useCallback(
    (url: string) => {
      const original = revertAttachment(url);
      if (original) migrateSpoileredUrl(url, original.url);
    },
    [migrateSpoileredUrl, revertAttachment],
  );

  return { handleAttachmentEditSave, handleAttachmentRevert };
}
