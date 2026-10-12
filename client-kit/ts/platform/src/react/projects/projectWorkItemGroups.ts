// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/projectWorkItemGroups.ts.
import type { Project } from "./projectModels";

export function groupProjectWorkItemsByProject<T extends { project: Project }>(
  rows: T[],
) {
  const groups = new Map<string, { project: Project; rows: T[] }>();
  for (const row of rows) {
    const existing = groups.get(row.project.id);
    if (existing) {
      existing.rows.push(row);
    } else {
      groups.set(row.project.id, { project: row.project, rows: [row] });
    }
  }
  return [...groups.values()];
}
