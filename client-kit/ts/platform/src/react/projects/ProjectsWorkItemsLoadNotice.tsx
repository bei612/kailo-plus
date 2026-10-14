// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectsWorkItemsLoadNotice.tsx. The shared
// work-item read fails as a whole instead of returning partial sections (a
// failed page never becomes an empty history), so only the original full-failure
// branch has a producer. Relay detail text stays out of the user-facing copy.
import { AlertCircle } from "lucide-react";

import { useUiT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";

type ProjectsWorkItemsLoadNoticeProps = {
  error: unknown;
  isRetrying: boolean;
  onRetry: () => void;
};

/** Displays an aggregate work-item failure with a retry action. */
export function ProjectsWorkItemsLoadNotice({
  error,
  isRetrying,
  onRetry,
}: ProjectsWorkItemsLoadNoticeProps) {
  const t = useUiT();
  if (!error) return null;

  return (
    <div
      className="flex items-start gap-3 border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm"
      role="alert"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{t("projects.activity.loadFailed")}</p>
        <p className="mt-0.5 text-muted-foreground">{t("projects.list.relayFailed")}</p>
      </div>
      <Button
        disabled={isRetrying}
        onClick={onRetry}
        size="sm"
        variant="outline"
      >
        {t(isRetrying ? "projects.list.retrying" : "projects.list.retry")}
      </Button>
    </div>
  );
}
