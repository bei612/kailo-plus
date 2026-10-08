// Original Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectSelectableGroup.tsx.
// Original read presentation; selection-to-Agent context remains a separate missing consumer, not a fake control.
import * as React from "react";

import { twMerge as cn } from "tailwind-merge";

export function ProjectSelectableGroup({
  children,
  contentClassName,
  count,
  groupKey,
  headerClassName,
  headerTestId,
  icon,
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
  label: string;
  labelClassName?: string;
  labelTestId?: string;
  testId: string;
}) {
  const [expanded, setExpanded] = React.useState(true);

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
            )}
            data-testid="project-group-icon"
          >
            {icon}
          </span>
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
