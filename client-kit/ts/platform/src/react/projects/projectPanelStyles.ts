// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/projectPanelStyles.ts
// (the panel/column/section/picker classes used by the restored repository panels), unchanged.

/**
 * Shared trigger for the selection dropdowns (repository, source, branch) so
 * they read as one consistent control family in the workspace header.
 */
export const PROJECT_PICKER_TRIGGER_CLASS = "h-7 min-w-0 max-w-full gap-1.5 rounded-md px-3 text-sm font-medium hover:border-input";

/** Bordered shell that lets the project page surface show through. */
export const PROJECT_DETAIL_PANEL_CLASS = "overflow-hidden rounded-xl border border-border/60 bg-transparent";

/** Centered, borderless reading column used by selected work-item details. */
export const PROJECT_DETAIL_READING_COLUMN_CLASS = "mx-auto w-full max-w-3xl overflow-hidden";

/** Rounded title row used above repository workspace lists and home sheets. */
export const PROJECT_SECTION_HEADER_CLASS = "mx-4 mb-2 rounded-md bg-muted/40";
