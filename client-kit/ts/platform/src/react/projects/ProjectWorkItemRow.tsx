// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectWorkItemRow.tsx.
// Original read presentation; selection-to-Agent remains an explicitly missing consumer.
import type * as React from "react";

import { cn } from "../profile/buzz/shared/lib/cn";

export function ProjectWorkItemRow({
  eventId,
  identifier,
  identifierClassName,
  identifierTitle,
  metadata,
  onOpen,
  statusIcon,
  testId,
  title,
  trailing,
}: {
  eventId: string;
  identifier: string;
  identifierClassName?: string;
  identifierTitle?: string;
  metadata?: React.ReactNode;
  onOpen?: () => void;
  statusIcon: React.ReactNode;
  testId: string;
  title: string;
  trailing?: React.ReactNode;
}) {
  return (
    <article
      className={cn(
        "group/work-item mx-2 flex min-h-10 min-w-0 items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/30",
      )}
      data-project-event-id={eventId}
      data-testid={testId}
    >
      <span
        className="relative flex h-4 w-4 shrink-0 items-center justify-center"
        data-testid="project-work-item-leading-icon"
      >
        <span
          className={cn(
            "flex items-center justify-center opacity-80 transition-opacity",
          )}
          data-testid="project-work-item-status-icon"
        >
          {statusIcon}
        </span>
      </span>
      {onOpen ? (
        <button
          className="min-w-0 flex-1 truncate rounded-sm text-left text-sm font-normal text-foreground transition-colors hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          data-projects-text-priority="primary"
          onClick={onOpen}
          title={title}
          type="button"
        >
          {title}
        </button>
      ) : (
        <span
          className="min-w-0 flex-1 truncate text-sm font-normal text-foreground"
          data-projects-text-priority="primary"
        >
          {title}
        </span>
      )}
      {onOpen ? (
        <button
          className={cn(
            "w-[4.75rem] shrink-0 truncate rounded-sm text-left text-xs font-medium tabular-nums text-muted-foreground/55 transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
            identifierClassName,
          )}
          data-projects-text-priority="secondary"
          data-testid="project-work-item-identifier"
          onClick={onOpen}
          title={identifierTitle}
          type="button"
        >
          {identifier}
        </button>
      ) : (
        <span
          className={cn(
            "w-[4.75rem] shrink-0 truncate text-xs font-medium tabular-nums text-muted-foreground/55",
            identifierClassName,
          )}
          data-projects-text-priority="secondary"
          data-testid="project-work-item-identifier"
        >
          {identifier}
        </span>
      )}
      {metadata ? (
        <div
          className="hidden min-w-0 shrink items-center gap-1.5 overflow-hidden text-xs text-muted-foreground/60 lg:flex"
          data-projects-text-priority="secondary"
        >
          <span className="text-muted-foreground/45">›</span>
          {metadata}
        </div>
      ) : null}
      {trailing ? (
        <div
          className="ml-auto flex shrink-0 items-center gap-2 pl-2 text-muted-foreground/60"
          data-projects-text-priority="secondary"
        >
          {trailing}
        </div>
      ) : null}
    </article>
  );
}
