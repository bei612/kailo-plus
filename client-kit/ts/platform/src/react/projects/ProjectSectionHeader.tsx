// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectSectionHeader.tsx.
import { type LucideIcon, Plus } from "lucide-react";
import type { ReactNode } from "react";

import { twMerge as cn } from "tailwind-merge";
import { Button } from "../profile/buzz/shared/ui/button";

export function ProjectSectionHeader({
  action,
  className,
  icon: Icon,
  testId = "project-section-header",
  title,
  trailing,
}: {
  action?: {
    disabled?: boolean;
    label: string;
    onClick: () => void;
    title?: string;
  };
  className?: string;
  icon: LucideIcon;
  testId?: string;
  title: string;
  trailing?: ReactNode;
}) {
  return (
    <header
      className={cn(
        "flex min-h-12 flex-wrap items-center gap-2 px-4 py-2",
        className,
      )}
      data-testid={testId}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Icon
          className="h-4 w-4 shrink-0 text-muted-foreground"
          data-testid="project-section-header-icon"
        />
        <h2 className="min-w-0 truncate text-sm font-semibold text-foreground">
          {title}
        </h2>
      </div>
      {action ? (
        <Button
          aria-label={action.label}
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
          disabled={action.disabled}
          onClick={action.onClick}
          size="icon"
          title={action.title ?? action.label}
          variant="ghost"
        >
          <Plus className="h-4 w-4" />
        </Button>
      ) : null}
      {trailing}
    </header>
  );
}
