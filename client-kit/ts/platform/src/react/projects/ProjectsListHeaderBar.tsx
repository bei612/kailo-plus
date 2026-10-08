// Original Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectsListHeaderBar.tsx.
import type { ProjectsViewMode } from "./lib/projectsViewHelpers";
import { ProjectsViewModeToggle } from "./ProjectsToolbar";
import { useUiT } from "../context";
export type ProjectsSort = "created" | "name";

type ProjectsListHeaderBarProps = {
  onViewModeChange: (viewMode: ProjectsViewMode) => void;
  viewMode: ProjectsViewMode;
};

/** Shared Projects sort control used by the top navigation/search row. */
export function ProjectsSortSelect({
  onChange,
  sort,
}: {
  onChange: (sort: ProjectsSort) => void;
  sort: ProjectsSort;
}) {
  const t=useUiT();
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="sr-only">{t("projects.sort")}</span>
      <select
        className="h-8 rounded-md bg-transparent px-2 text-xs text-foreground outline-hidden hover:bg-muted/50 focus:ring-1 focus:ring-ring"
        onChange={(event) => onChange(event.target.value as ProjectsSort)}
        value={sort}
      >
        <option value="created">{t("projects.created")}</option>
        <option value="name">{t("projects.name")}</option>
      </select>
    </label>
  );
}

/** Compact layout controls rendered in the Projects section header. */
export function ProjectsListHeaderBar({
  onViewModeChange,
  viewMode,
}: ProjectsListHeaderBarProps) {
  return (
    <div
      className="ml-auto flex flex-wrap items-center justify-end gap-2"
      data-testid="projects-list-header"
    >
      <ProjectsViewModeToggle
        onViewModeChange={onViewModeChange}
        viewMode={viewMode}
      />
    </div>
  );
}
