import { cn } from "../profile/buzz/shared/lib/cn";
import { channelChrome } from "./chromeLayout";

export function DayDivider({
  label,
  sticky = true,
  testId = "message-timeline-day-divider",
}: {
  label: string;
  sticky?: boolean;
  testId?: string;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        // DD-141 §10: a left-aligned overline on a hairline, not a centered pill.
        sticky
          ? cn(
              "pointer-events-none sticky z-20 flex items-center gap-2.5 px-5",
              channelChrome.stickyTimelineTop,
            )
          : "pointer-events-none flex items-center gap-2.5 px-5",
      )}
      data-testid={testId}
      data-day-label={label}
    >
      <p className="relative z-10 shrink-0 rounded-sm bg-background py-1 pr-1 text-2xs font-semibold tracking-[0.04em] text-muted-foreground">
        {label}
      </p>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </section>
  );
}
