// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectsOverviewChromeActions.tsx and
// ProjectsOverviewContextSheet.tsx. The "Chat with an agent" toggle opens the
// original ProjectAgentChatPanel, which has no governed shared consumer yet, so
// only the project-context toggle is rendered.
import * as React from "react";

import { useUiT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import { DrawerPanelIcon } from "../sidebar/DrawerPanelIcon";
import { Sheet, SheetContent, SheetTitle } from "../sidebar/sheet";

export function ProjectsOverviewChromeActions({
  contextOpen,
  onToggleContext,
}: {
  contextOpen: boolean;
  onToggleContext: () => void;
}) {
  const t = useUiT();
  const label = t(contextOpen ? "projects.context.hide" : "projects.context.show");
  return (
    <Button
      aria-label={label}
      aria-pressed={contextOpen}
      className="h-7 w-7 text-sidebar-foreground hover:bg-sidebar-accent"
      data-testid="projects-overview-context-toggle"
      onClick={onToggleContext}
      size="icon"
      title={label}
      type="button"
      variant="ghost"
    >
      <DrawerPanelIcon
        className="-scale-x-100"
        side={contextOpen ? "left" : "right"}
        testId="projects-overview-context-icon"
      />
    </Button>
  );
}

export const ProjectsOverviewNarrowContextToggle = React.forwardRef<
  HTMLButtonElement,
  { onToggle: () => void; open: boolean }
>(({ onToggle, open }, ref) => {
  const t = useUiT();
  const label = t(open ? "projects.context.hide" : "projects.context.show");
  return (
    <Button
      aria-label={label}
      aria-pressed={open}
      className="h-7 w-7 text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      data-testid="projects-overview-context-toggle"
      onClick={onToggle}
      ref={ref}
      size="icon"
      title={label}
      type="button"
      variant="ghost"
    >
      <DrawerPanelIcon
        className="-scale-x-100"
        side={open ? "left" : "right"}
        testId="projects-overview-context-icon"
      />
    </Button>
  );
});
ProjectsOverviewNarrowContextToggle.displayName =
  "ProjectsOverviewNarrowContextToggle";

/**
 * Narrow-layout fallback for the Projects context rail: below the detached
 * breakpoint the rail cannot dock beside the content, so the same
 * section-following context panel opens as a dismissible right-hand sheet.
 * Radix supplies the focus trap, Escape handling, and close button.
 */
export function ProjectsOverviewContextSheet({
  children,
  onCloseAutoFocus,
  onOpenChange,
  open,
}: {
  children: React.ReactNode;
  onCloseAutoFocus?: (event: Event) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const t = useUiT();
  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent
        aria-describedby={undefined}
        className="w-80 overflow-y-auto p-0 pt-10 sm:max-w-none"
        data-testid="projects-overview-context-sheet"
        onCloseAutoFocus={onCloseAutoFocus}
        side="right"
      >
        <SheetTitle className="sr-only">{t("projects.context.title")}</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
