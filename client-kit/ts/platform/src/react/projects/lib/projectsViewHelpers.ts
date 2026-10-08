// Called presentation helpers from Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/lib/projectsViewHelpers.ts. No access decision
// or missing Git activity producer is migrated into this presentation module.
export type ProjectsViewMode = "grid" | "list";
const PROJECTS_VIEW_MODE_STORAGE_KEY = "buzz.projects.viewMode";

export function readStoredViewMode(): ProjectsViewMode | null {
  try {
    const value = globalThis.localStorage?.getItem(PROJECTS_VIEW_MODE_STORAGE_KEY);
    return value === "grid" || value === "list" ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredViewMode(viewMode: ProjectsViewMode) {
  try {
    globalThis.localStorage?.setItem(PROJECTS_VIEW_MODE_STORAGE_KEY, viewMode);
  } catch {
    // Persistence is best-effort; the in-memory toggle still works.
  }
}

export function markdownToPlainText(input: string): string {
  return input
    .replace(/```[^\n]*\n?/g, "")
    .replace(/```/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]{0,3}(?:#{1,6}|>|[-*+]|\d+[.)])[ \t]+/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/([*_])(.+?)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

export function listRowDescription(
  value: string | null | undefined,
  title?: string,
): string | undefined {
  const text = markdownToPlainText(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length === 0) return undefined;
  if (title && text.localeCompare(title.trim(), undefined, { sensitivity: "accent" }) === 0) {
    return undefined;
  }
  return text;
}
