// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectRepositoryUnavailableState.tsx. Same icon/title/copy and the
// original Retry (the repository Fetch of the detail page). "Ask for access" opens the original
// project Agent chat, which has no governed consumer here, and the access-channel variant needs the
// membership refinement DD-118 forbids.
import { CircleAlert, CloudOff, GitBranch, Loader2, LockKeyhole, RefreshCw } from "lucide-react";
import { useUiT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import { type ProjectRepoUnavailableReason, projectRepoUnavailablePresentation } from "./lib/projectRepoAvailability";

const UNAVAILABLE_ICONS = {
  authentication: LockKeyhole,
  missing: CircleAlert,
  access: LockKeyhole,
  unbound: LockKeyhole,
  network: CloudOff,
  ref: GitBranch,
  unknown: CircleAlert,
} satisfies Record<ProjectRepoUnavailableReason, typeof CircleAlert>;

export function ProjectRepositoryUnavailableState({ reason = "unknown", onRetry, retryPending = false }: {
  reason?: ProjectRepoUnavailableReason;
  onRetry?: () => void;
  retryPending?: boolean;
}) {
  const t = useUiT();
  const unavailable = projectRepoUnavailablePresentation(reason);
  const UnavailableIcon = UNAVAILABLE_ICONS[reason];
  return (
    <div className="flex min-h-[calc(100dvh-7rem)] flex-col items-center justify-center p-8 text-center" data-testid="project-repository-unavailable">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-border/60 bg-muted/40 text-muted-foreground">
        <UnavailableIcon className="h-6 w-6" />
      </div>
      <h3 className="text-base font-semibold text-foreground">{unavailable.title}</h3>
      <p className="mt-1 max-w-lg text-sm text-muted-foreground">{unavailable.description}</p>
      {onRetry ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button disabled={retryPending} onClick={onRetry} size="sm" variant="outline">
            {retryPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {retryPending ? t("projects.repository.retrying") : t("projects.list.retry")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
