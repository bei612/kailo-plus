// Original desktop/src/shared/ui/link-preview-attachment.tsx presentation.
import type { ResolvedLinkPreview } from "./types";
import type { LinkPreviewStyle } from "./linkPreviewStylePreference";
import { CompactLinkPreviewAttachment } from "./compact-link-preview-attachment";
import { RichLinkPreviewAttachment, type LinkPreviewImageLightboxComponent } from "./rich-link-preview-attachment";
export function LinkPreviewAttachmentPresentation({ style, ...props }: {
  style: LinkPreviewStyle; preview: ResolvedLinkPreview; className?: string;
  ImageLightbox?: LinkPreviewImageLightboxComponent; onOpen?: () => void; onRemove?: () => void;
  showControls?: boolean; showExpandControl?: boolean;
}) {
  return style === "rich" ? <RichLinkPreviewAttachment {...props} /> : <CompactLinkPreviewAttachment {...props} />;
}
