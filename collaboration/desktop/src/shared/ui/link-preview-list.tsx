import { useState } from "react";
import { useUiT } from "@client-kit/platform/react/context";

import { useLinkPreviewStyle } from "@/shared/lib/linkPreviewStylePreference";
import type { ResolvedLinkPreview } from "@/shared/lib/useResolvedLinkPreviews";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { AttachmentGroup } from "@/shared/ui/attachment";
import { Button } from "@/shared/ui/button";
import { LinkPreviewAttachment } from "@/shared/ui/link-preview-attachment";
import type { LinkPreviewImageLightboxComponent } from "@/shared/ui/rich-link-preview-attachment";

export function LinkPreviewList({
  ImageLightbox,
  onOpenByHref,
  onRemoveForEveryone,
  previews,
}: {
  ImageLightbox: LinkPreviewImageLightboxComponent;
  onOpenByHref?: ReadonlyMap<string, () => void>;
  onRemoveForEveryone?: () => Promise<void>;
  previews: ResolvedLinkPreview[];
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [removed, setRemoved] = useState(false);
  const style = useLinkPreviewStyle();
  const t = useUiT();
  if (removed || previews.length === 0) return null;

  const one = previews.length === 1;
  const controlsIndex = 0;
  return (
    <>
      <AttachmentGroup
        className={
          style === "compact"
            ? "max-w-full flex-row flex-wrap items-start overflow-visible pb-0"
            : "max-w-full flex-col items-start overflow-visible pb-0"
        }
        data-link-preview-list=""
      >
        {previews.map((preview, index) => (
          <LinkPreviewAttachment
            key={preview.href}
            ImageLightbox={ImageLightbox}
            onOpen={onOpenByHref?.get(preview.href)}
            onRemove={
              onRemoveForEveryone && index === controlsIndex
                ? () => setDialogOpen(true)
                : undefined
            }
            preview={preview}
            showControls={index === controlsIndex}
          />
        ))}
      </AttachmentGroup>
      {onRemoveForEveryone ? (
        <AlertDialog onOpenChange={setDialogOpen} open={dialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t(one ? "linkPreview.removeTitleOne" : "linkPreview.removeTitleMany")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t(one ? "linkPreview.removeBodyOne" : "linkPreview.removeBodyMany")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button type="button" variant="outline">
                  {t("platform.cancel")}
                </Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button
                  onClick={() => {
                    setRemoved(true);
                    void onRemoveForEveryone().catch(() => setRemoved(false));
                  }}
                  type="button"
                  variant="destructive"
                >
                  {t(one ? "linkPreview.remove" : "linkPreview.removeConfirmMany")}
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}
