// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/lib/projectGitError.ts (projectCloneErrorPresentation) and
// desktop/src/features/projects/ui/projectGitErrorToast.ts (showProjectCloneErrorToast).
// DD-160(1): the Desktop host answers a failed clone with fixed codes instead of git stderr, and
// every 401/403/404 is the same "unreadable" answer, so the original "access restricted" and
// "not found" branches collapse into one presentation and the GitHub-credential branch does not
// apply. DD-160(3): the checkout directory is app-managed per Community and coordinate, so the
// original "local folder already exists" branch cannot arise.
import { toast } from "sonner";
import { translateCurrent as t } from "../../../i18n";
import { TransportError } from "../../../transport";

export type ProjectGitErrorPresentation = { title: string; description: string };

function errorCode(error: unknown): string {
  if (typeof error === "string") return error;
  return error instanceof Error ? error.message : "";
}

/** User-facing copy for a failed clone; the conflict and unknown cases are handled by the caller. */
export function projectCloneErrorPresentation(error: unknown): ProjectGitErrorPresentation {
  const code = errorCode(error);
  if (code === "project_repo_not_found" || code === "project_repo_unavailable") {
    return {
      title: t("projects.git.unavailable.unknownTitle"),
      description: t("projects.git.unavailable.unknown"),
    };
  }
  if (code === "project_repo_timeout" || error instanceof TransportError) {
    return {
      title: t("projects.git.unavailable.networkTitle"),
      description: t("projects.git.unavailable.network"),
    };
  }
  return {
    title: t("projects.checkout.cloneFailedTitle"),
    description: t("projects.checkout.cloneFailed"),
  };
}

export function showProjectCloneErrorToast(error: unknown): void {
  const presentation = projectCloneErrorPresentation(error);
  toast.error(presentation.title, { description: presentation.description });
}
