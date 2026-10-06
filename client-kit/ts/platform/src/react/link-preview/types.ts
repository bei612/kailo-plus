// Original desktop/src/shared/lib/useResolvedLinkPreviews.ts public types,
// Buzz 779af8886caae1317b4de962082429867ab61503. Native metadata I/O stays native.
import type { SupportedLinkPreview } from "./linkPreview";
export type LinkPreviewImageState = "pending" | "image" | "fallback" | "none";
export type ResolvedLinkPreview = SupportedLinkPreview & {
  description?: string | null;
  faviconDataUrl?: string | null;
  imageState: LinkPreviewImageState;
  snapshotReady?: boolean;
};
