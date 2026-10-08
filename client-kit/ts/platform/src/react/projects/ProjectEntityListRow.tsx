// Original Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectEntityListRow.tsx.
// Original read presentation; selection-to-Agent context remains a separate missing consumer, not a fake control.
import { MessageSquare } from "lucide-react";
import type * as React from "react";
import { relativeTime } from "./lib/projectsViewHelpers";
import { useUiLocale } from "../context";
import { twMerge as cn } from "tailwind-merge";

/** One-line list row: title, optional description column, then trailing metadata. */
export const PROJECT_ENTITY_LIST_ROW_CLASS =
  "mx-2 flex min-h-9 min-w-0 items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/30";

export function ProjectEntityListRow({
  affiliation,
  affiliationClassName,
  affiliationTestId,
  affiliationTitle,
  beforeDate,
  count,
  countSuffix,
  countTestId,
  countTitle,
  dateSeconds,
  dateTestId,
  description,
  descriptionTestId,
  icon,
  onClick,
  peopleSlot,
  peopleTestId,
  testId,
  title,
  titleAttr,
  titleIcon,
  titleSecondary,
  titleSecondaryTestId,
  trailing,
}: {
  affiliation?: React.ReactNode;
  affiliationClassName?: string;
  affiliationTestId?: string;
  affiliationTitle?: string;
  beforeDate?: React.ReactNode;
  count?: number | null;
  countSuffix?: string;
  countTestId?: string;
  countTitle?: string;
  dateSeconds?: number | null;
  dateTestId?: string;
  description?: string;
  descriptionTestId?: string;
  icon: React.ReactNode;
  onClick?: () => void;
  peopleSlot?: React.ReactNode;
  peopleTestId?: string;
  testId?: string;
  title: React.ReactNode;
  titleAttr?: string;
  titleIcon?: React.ReactNode;
  titleSecondary?: string;
  titleSecondaryTestId?: string;
  trailing?: React.ReactNode;
}) {
  const locale = useUiLocale();
  const useOverlay = Boolean(trailing || peopleSlot);
  const peopleContent = peopleSlot;

  const interactiveSlotClass = useOverlay ? "pointer-events-auto" : undefined;
  const body = (
    <>
      <span
        className={cn(
          "relative flex h-4 w-4 shrink-0 items-center justify-center",
          interactiveSlotClass,
        )}
        data-testid="project-entity-leading-icon"
      >
        <span
          className={cn(
            "flex items-center justify-center",
          )}
        >
          {icon}
        </span>
      </span>
      <span
        className={cn(
          "min-w-0 text-sm font-medium text-foreground",
          description ? "flex-1 lg:w-44 lg:flex-none lg:shrink-0" : "flex-1",
        )}
        data-projects-text-priority="primary"
      >
        {titleSecondary ? (
          <span className="flex min-w-0 items-baseline gap-2 overflow-hidden">
            <span
              className="max-w-full shrink-0 truncate"
              data-testid="project-entity-title"
            >
              {title}
            </span>
            <span
              className="min-w-0 flex-1 truncate text-left font-normal text-muted-foreground/65"
              data-projects-text-priority="secondary"
              data-testid={titleSecondaryTestId}
              title={titleSecondary}
            >
              {titleSecondary}
            </span>
          </span>
        ) : (
          <span className="block truncate" data-testid="project-entity-title">
            {title}
          </span>
        )}
      </span>
      {titleIcon ? (
        <span
          className="flex h-4 w-4 shrink-0 items-center justify-center"
          data-testid="project-entity-title-icon"
        >
          {titleIcon}
        </span>
      ) : null}
      {description ? (
        <span
          className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground/65 lg:block"
          data-projects-text-priority="secondary"
          data-testid={descriptionTestId ?? "project-entity-description"}
          title={description}
        >
          {description}
        </span>
      ) : null}
      {affiliation ? (
        <span
          className={cn(
            "hidden w-36 shrink-0 truncate text-left text-xs text-muted-foreground/65 md:block",
            affiliationClassName,
          )}
          data-projects-text-priority="secondary"
          data-testid={affiliationTestId}
          title={
            affiliationTitle ??
            (typeof affiliation === "string" ? affiliation : undefined)
          }
        >
          {affiliation}
        </span>
      ) : null}
      <span
        className={cn("flex w-24 shrink-0 justify-end", interactiveSlotClass)}
        data-testid={peopleTestId}
      >
        {peopleContent}
      </span>
      {count != null || countTestId ? (
        <span
          className="flex w-12 shrink-0 items-center gap-1 text-xs text-muted-foreground/65"
          data-projects-text-priority="secondary"
          data-testid={countTestId}
          title={countTitle}
        >
          {count != null ? (
            <>
              <MessageSquare className="h-3.5 w-3.5" />
              <span className="tabular-nums">
                {count}
                {countSuffix}
              </span>
            </>
          ) : null}
        </span>
      ) : null}
      {beforeDate ? (
        <span
          className="pointer-events-auto relative z-10 shrink-0"
          data-testid="project-entity-before-date"
        >
          {beforeDate}
        </span>
      ) : null}
      {dateSeconds ? (
        <span
          className="hidden w-24 shrink-0 whitespace-nowrap text-right text-xs text-muted-foreground/55 sm:block"
          data-projects-text-priority="secondary"
          data-testid={dateTestId}
          title={new Date(dateSeconds * 1_000).toLocaleString()}
        >
          {relativeTime(dateSeconds,undefined,locale)}
        </span>
      ) : (
        <span className="hidden w-24 shrink-0 sm:block" />
      )}
      {trailing ? (
        <span className="pointer-events-auto relative z-10 shrink-0">
          {trailing}
        </span>
      ) : null}
    </>
  );

  if (useOverlay) {
    return (
      <div
        className="group relative"
        data-testid={testId}
      >
        {onClick ? (
          <button
            className="absolute inset-0"
            onClick={onClick}
            title={titleAttr}
            type="button"
          >
            <span className="sr-only">{titleAttr}</span>
          </button>
        ) : null}
        <div
          className={cn(
            PROJECT_ENTITY_LIST_ROW_CLASS,
            "pointer-events-none relative z-10 group-hover:bg-muted/30",
          )}
        >
          {body}
        </div>
      </div>
    );
  }

  if (onClick) {
    return (
      <button
        className={PROJECT_ENTITY_LIST_ROW_CLASS}
        data-testid={testId}
        onClick={onClick}
        title={titleAttr}
        type="button"
      >
        {body}
      </button>
    );
  }

  return (
    <div className={PROJECT_ENTITY_LIST_ROW_CLASS} data-testid={testId}>
      {body}
    </div>
  );
}
