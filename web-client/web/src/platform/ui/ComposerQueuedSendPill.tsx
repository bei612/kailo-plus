// DD-146: the original ComposerUploadProgressPill role on Web (fixed Buzz
// 779af8886caae1317b4de962082429867ab61503 desktop/src/features/messages/ui/ComposerUploadProgressPill.tsx):
// a send is held until its attachments are confirmed; the pill shows the aggregate progress and
// cancels the held send (the draft stays). Presentation uses only the shared theme tokens.
import type { UploadingAttachmentPreview } from "@client-kit/platform/react/composer/features/messages/lib/attachmentPreview";
import { t } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";

/** Aggregate percent over the in-flight uploads; a file without byte counts yet counts as 0. */
export function queuedUploadPercent(previews: readonly Pick<UploadingAttachmentPreview, "progress">[]): number {
  if (previews.length === 0) return 100;
  const total = previews.reduce((sum, preview) => sum + Math.max(0, Math.min(100, preview.progress ?? 0)), 0);
  return Math.round(total / previews.length);
}

export function ComposerQueuedSendPill({ previews, onCancel }: {
  previews: readonly UploadingAttachmentPreview[];
  onCancel: () => void;
}) {
  const percent = queuedUploadPercent(previews);
  return <div className="flex items-center justify-center gap-2 pb-2 text-xs text-muted-foreground" role="status"
    aria-live="polite" data-testid="composer-queued-send">
    <span>{t("platform.sendAfterUpload", { percent })}</span>
    <Button type="button" size="sm" variant="ghost" onClick={onCancel} data-testid="composer-queued-send-cancel">
      {t("platform.cancel")}
    </Button>
  </div>;
}
