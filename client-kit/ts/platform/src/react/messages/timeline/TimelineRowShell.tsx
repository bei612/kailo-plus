// Shared from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/messages/ui/TimelineRowShell.tsx.
import type * as React from "react";
import { timelineRowReserveStyle } from "./rowHeightEstimate";
import {
  getTimelineItemKey,
  type TimelineNonDayItem,
} from "./timelineItems";
import { cn } from "../../profile/buzz/shared/lib/cn";

export function TimelineRowShell({
  children,
  item,
  useContentVisibility = true,
}: {
  children: React.ReactNode;
  item: TimelineNonDayItem;
  useContentVisibility?: boolean;
}) {
  return (
    <div
      className={cn(useContentVisibility && "timeline-row-cv")}
      data-timeline-item-key={getTimelineItemKey(item)}
      style={useContentVisibility ? timelineRowReserveStyle(item) : undefined}
    >
      {children}
    </div>
  );
}
