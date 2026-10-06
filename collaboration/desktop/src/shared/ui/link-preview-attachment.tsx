import { LinkPreviewAttachmentPresentation, LinkPreviewHost } from "@client-kit/platform/react/link-preview";
export { LinkPreviewAttachmentPresentation } from "@client-kit/platform/react/link-preview";
import { useAppShell } from "@/app/AppShellContext";
import {
  useLinkPreviewStyle,
} from "@/shared/lib/linkPreviewStylePreference";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";
import { useMediaProxyPort } from "@/shared/lib/useMediaProxyPort";

type LinkPreviewAttachmentProps = React.ComponentProps<typeof LinkPreviewAttachmentPresentation>;

/** Renders a link preview using the user's saved presentation preference. */
export function LinkPreviewAttachment({
  preview,
  ...props
}: Omit<LinkPreviewAttachmentProps, "style">) {
  const { onOpenSettings } = useAppShell();
  useMediaProxyPort();
  const renderedPreview = {
    ...preview,
    faviconDataUrl: preview.faviconDataUrl
      ? rewriteRelayUrl(preview.faviconDataUrl)
      : null,
    imageDataUrl: preview.imageDataUrl
      ? rewriteRelayUrl(preview.imageDataUrl)
      : null,
  };
  const style = useLinkPreviewStyle();

  return (
    <LinkPreviewHost.Provider value={{ onOpenSettings: onOpenSettings ?? undefined }}><LinkPreviewAttachmentPresentation
      {...props}
      preview={renderedPreview}
      style={style}
    /></LinkPreviewHost.Provider>
  );
}
