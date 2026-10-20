// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectDetailUnavailableState.tsx.
// Same three states and layout; copy comes from the shared catalog.
import { ArrowLeft, FolderGit2 } from "lucide-react";
import { useUiT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import type { Project } from "./projectModels";
import { UnavailableProjectRepositories } from "./UnavailableProjectRepositories";

type ProjectDetailUnavailableStateProps =
  | {
      kind: "load-error";
      onBack: () => void;
      onRetry: () => void;
    }
  | {
      kind: "not-found";
      onBack: () => void;
    }
  | {
      kind: "repositories-unavailable";
      project: Project;
    };

export function ProjectDetailUnavailableState(
  props: ProjectDetailUnavailableStateProps,
) {
  const t = useUiT();
  if (props.kind === "load-error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center" data-testid="project-detail-unavailable">
        <FolderGit2 className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-red-400" role="alert">{t("projects.detail.loadFailed")}</p>
        <div className="flex items-center gap-2">
          <Button onClick={props.onRetry} size="sm" variant="outline">
            {t("projects.list.retry")}
          </Button>
          <Button onClick={props.onBack} size="sm" variant="ghost">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            {t("projects.detail.back")}
          </Button>
        </div>
      </div>
    );
  }

  if (props.kind === "not-found") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center" data-testid="project-detail-unavailable">
        <FolderGit2 className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          {t("projects.detail.notFound")}
        </p>
        <Button onClick={props.onBack} size="sm" variant="outline">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t("projects.detail.back")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center" data-testid="project-detail-unavailable">
      <FolderGit2 className="h-10 w-10 text-muted-foreground/40" />
      <p className="text-sm font-medium text-foreground">
        {props.project.name}
      </p>
      <p className="text-sm text-muted-foreground">
        {t("projects.detail.noRepositories")}
      </p>
      <UnavailableProjectRepositories project={props.project} />
    </div>
  );
}
