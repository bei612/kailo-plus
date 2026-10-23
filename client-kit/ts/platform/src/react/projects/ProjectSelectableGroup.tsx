// Original Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectSelectableGroup.tsx.
// Original group header select-all: with `items` inside a ProjectSelectionProvider the leading icon
// becomes the all/partial checkbox on hover (or while any of the group is selected).
import * as React from "react";

import { twMerge as cn } from "tailwind-merge";
import { useUiT } from "../context";
import type { ProjectSelectionItem } from "./lib/projectSelection";
import { useProjectSelection } from "./lib/useProjectSelection";
import { ProjectEntitySelectControl } from "./ProjectEntityListRow";

export function ProjectSelectableGroup({
  children,
  contentClassName,
  count,
  groupKey,
  headerClassName,
  headerTestId,
  icon,
  items,
  label,
  labelClassName,
  labelTestId,
  testId,
}: {
  children: React.ReactNode;
  contentClassName?: string;
  count: number;
  groupKey: string;
  headerClassName?: string;
  headerTestId: string;
  icon: React.ReactNode;
  items?: ProjectSelectionItem[];
  label: string;
  labelClassName?: string;
  labelTestId?: string;
  testId: string;
}) {
  const [expanded, setExpanded] = React.useState(true);
  const t = useUiT();
  const selection = useProjectSelection();
  const selectable = selection && items && items.length > 0 ? items : null;
  const selectedCount = selectable
    ? selection!.items.filter(selected => selectable.some(item => item.id === selected.id)).length : 0;
  const allSelected = selectable !== null && selectedCount === selectable.length;
  const partiallySelected = selectedCount > 0 && !allSelected;
  const showSelectControl = allSelected || partiallySelected;

  return (
    <section
      className="pt-2 first:pt-0"
      data-project-group={groupKey}
      data-project-group-size={count}
      data-testid={testId}
    >
      <div
        className={cn(
          "group/header mx-2 flex h-9 items-center gap-1.5 rounded-md bg-muted/40 px-2 text-xs text-muted-foreground",
          headerClassName,
        )}
        data-testid={headerTestId}
      >
        <span
          className="relative flex h-4 w-4 shrink-0 items-center justify-center"
          data-testid="project-group-leading-icon"
        >
          <span
            className={cn(
              "flex items-center justify-center transition-opacity",
              selectable && "group-focus-within/header:opacity-0 group-hover/header:opacity-0",
              showSelectControl && "opacity-0",
            )}
            data-testid="project-group-icon"
          >
            {icon}
          </span>
          {selectable ? (
            <span
              className={cn(
                "absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-focus-within/header:opacity-100 group-hover/header:opacity-100",
                showSelectControl && "opacity-100",
              )}
            >
              <ProjectEntitySelectControl
                checked={allSelected}
                indeterminate={partiallySelected}
                label={t(allSelected ? "projects.selection.clearAll" : "projects.selection.selectAll", { name: label })}
                onToggle={() => selection!.toggleGroup(selectable)}
                testId="projects-group-select"
              />
            </span>
          ) : null}
        </span>
        <button
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          <span
            className={cn(
              "min-w-0 truncate font-medium text-muted-foreground",
              labelClassName,
            )}
            data-testid={labelTestId}
          >
            {label}
          </span>
          {!expanded ? (
            <span className="shrink-0 tabular-nums text-muted-foreground/65">
              {count}
            </span>
          ) : null}
        </button>
      </div>
      {expanded ? (
        <div className={cn("mt-1 space-y-0.5", contentClassName)}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
