// DD-146: the original ComposerUploadProgressPill role on Web (fixed Buzz
// 779af8886caae1317b4de962082429867ab61503 desktop/src/features/messages/ui/ComposerUploadProgressPill.tsx):
// Send has already cleared the composer; the pill shows the aggregate progress of the uploads the
// message waits for, and Cancel returns the message to the composer. A send left pending by
// another visit or a reload is offered for restore or discard. Presentation uses only the shared
// DD-141 Kailo theme roles and base components.
import type { PendingSendStage } from "@client-kit/platform/react/composer/features/messages/lib/useDrafts";
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
  // DD-141 §9: an overlay chip with a 2px brand progress bar (loading spec), not a Buzz pill.
  return <div className="flex justify-center pb-2" role="status" aria-live="polite" data-testid="composer-queued-send">
    <div className="relative flex items-center gap-2 overflow-hidden rounded-full border border-border bg-popover py-0.5 pr-1 pl-3 text-xs text-muted-foreground shadow-sm">
      <span className="tabular-nums">{t("platform.sendAfterUpload", { percent })}</span>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel} data-testid="composer-queued-send-cancel">
        {t("platform.cancel")}
      </Button>
      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-muted">
        <span className="block h-full bg-primary transition-[width] duration-200 ease-out-expo" style={{ width: `${percent}%` }} />
      </span>
    </div>
  </div>;
}

/** A pending send this composer no longer holds: never resent by itself, restored or discarded by the user. */
export function ComposerPendingSendRecovery({ stage, missingFiles, canRestore, onRestore, onDiscard, uploadUnknown = false }: {
  stage: PendingSendStage;
  uploadUnknown?: boolean;
  missingFiles: number;
  canRestore: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  if (stage === "publishing" || stage === "uploading") {
    return <div className="flex justify-center pb-2" role="status" aria-live="polite" data-testid="composer-pending-send">
      <span className="rounded-full border border-border bg-popover px-3 py-1 text-xs text-muted-foreground shadow-sm">{t("platform.pendingSendPublishing")}</span>
    </div>;
  }
  // DD-141 §2.4/§9: soft status pair — unknown outcome in warning, a definite failure in danger.
  const tone = stage === "unknown" ? "bg-warning-soft text-warning-text" : "bg-danger-soft text-danger-text";
  return <div className={`mx-auto mb-2 flex w-fit max-w-full flex-wrap items-center justify-center gap-2 rounded-lg py-1 pr-1 pl-3 text-xs ${tone}`} role="status"
    aria-live="polite" data-testid="composer-pending-send" data-stage={stage}>
    <span>{t(uploadUnknown ? "platform.uploadFailed" : stage === "unknown" ? "platform.pendingSendUnknown" : "platform.pendingSendFailed")}</span>
    {missingFiles > 0 ? <span>{t("platform.pendingSendMissingFiles", { count: missingFiles })}</span> : null}
    {canRestore ? null : <span>{t("platform.pendingSendRestoreBlocked")}</span>}
    <Button type="button" size="sm" variant="ghost" disabled={!canRestore} onClick={onRestore} data-testid="composer-pending-send-restore">
      {t("platform.pendingSendRestore")}
    </Button>
    <Button type="button" size="sm" variant="ghost" onClick={onDiscard} data-testid="composer-pending-send-discard">
      {t("platform.pendingSendDiscard")}
    </Button>
  </div>;
}
