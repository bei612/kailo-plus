// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectWorkItemGroup.tsx.
// Original group select-all over the group's selection items (inside a ProjectSelectionProvider).
import type * as React from "react";
import type { ProjectSelectionItem } from "./lib/projectSelection";

import { ProjectSelectableGroup } from "./ProjectSelectableGroup";

/** Groups related project work-item rows under a subtle status summary. */
export function ProjectWorkItemGroup({
  children,
  count,
  icon,
  items,
  label,
}: {
  children: React.ReactNode;
  count: number;
  icon: React.ReactNode;
  items?: ProjectSelectionItem[];
  label: string;
}) {
  return (
    <ProjectSelectableGroup
      contentClassName="px-4"
      count={count}
      groupKey={label}
      headerClassName="mx-4 gap-3 px-4"
      headerTestId="project-work-item-group-header"
      icon={icon}
      items={items}
      label={label}
      labelTestId="project-work-item-group-label"
      testId="project-work-item-group"
    >
      {children}
    </ProjectSelectableGroup>
  );
}
