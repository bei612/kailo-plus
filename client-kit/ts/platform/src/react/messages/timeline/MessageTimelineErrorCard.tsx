// Shared from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/messages/ui/MessageTimelineErrorCard.tsx.
import { Button } from "../../profile/buzz/shared/ui/button";
import { useUiT } from "../../context";

/** Retryable terminal failure for a channel history load with no cached rows. */
export function MessageTimelineErrorCard({
  onRetry,
}: {
  onRetry?: () => void;
}) {
  const t = useUiT();
  return (
    <div
      className="mt-auto rounded-2xl border border-dashed border-destructive/50 bg-destructive/5 px-6 py-10 text-center shadow-xs"
      data-testid="message-timeline-error"
      role="alert"
    >
      <p className="text-base font-semibold tracking-tight">
        {t("timeline.loadError")}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("timeline.loadErrorDescription")}
      </p>
      {onRetry ? (
        <Button
          className="mt-4"
          data-testid="message-timeline-retry"
          onClick={onRetry}
          size="sm"
          type="button"
          variant="outline"
        >
          {t("timeline.retry")}
        </Button>
      ) : null}
    </div>
  );
}
