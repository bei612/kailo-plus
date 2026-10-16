// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectRepositoryUnavailableState.tsx. Same icon/title/copy.
// Retry is the original git fetch and "Ask for access" the original Agent chat; neither consumer
// exists here, and the access-channel variant needs the membership refinement DD-118 forbids.
import { CircleAlert, CloudOff, GitBranch, LockKeyhole } from "lucide-react";
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

export function ProjectRepositoryUnavailableState({ reason = "unknown" }: { reason?: ProjectRepoUnavailableReason }) {
  const unavailable = projectRepoUnavailablePresentation(reason);
  const UnavailableIcon = UNAVAILABLE_ICONS[reason];
  return (
    <div className="flex min-h-[calc(100dvh-7rem)] flex-col items-center justify-center p-8 text-center" data-testid="project-repository-unavailable">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-border/60 bg-muted/40 text-muted-foreground">
        <UnavailableIcon className="h-6 w-6" />
      </div>
      <h3 className="text-base font-semibold text-foreground">{unavailable.title}</h3>
      <p className="mt-1 max-w-lg text-sm text-muted-foreground">{unavailable.description}</p>
    </div>
  );
}
