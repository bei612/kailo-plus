// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/UnavailableProjectRepositories.tsx.
// Same rows; the "Unavailable" word comes from the shared catalog.
import { FolderGit2 } from "lucide-react";
import { useUiT } from "../context";
import type { Project } from "./projectModels";

export function UnavailableProjectRepositories({ project }: { project: Project }) {
  const t = useUiT();
  return (project.unavailableRepositoryAddresses ?? []).map((address) => (
    <div
      className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-xs text-muted-foreground"
      data-testid="project-unavailable-repository"
      key={address}
    >
      <FolderGit2 className="h-3.5 w-3.5" />
      <span className="max-w-80 truncate">
        {address.slice(address.indexOf(":", 6) + 1)}
      </span>
      <span>{t("projects.home.unavailable")}</span>
    </div>
  ));
}
