// Extracted from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/messages/ui/useVirtualizedViewportResize.ts.
import * as React from "react";

export function shouldSettleVirtualizedViewportResize({
  virtualizerAtBottom,
}: {
  virtualizerAtBottom: boolean;
}): boolean {
  return virtualizerAtBottom;
}

/** Re-settles a bottom-pinned virtualized timeline after viewport reflow. */
export function useVirtualizedViewportResize(
  scrollContainerRef: React.RefObject<HTMLDivElement | null>,
  virtualizerAtBottomRef: React.RefObject<boolean>,
  settleAtBottom?: () => void,
) {
  React.useEffect(() => {
    const container = scrollContainerRef.current;
    if (
      !container ||
      !settleAtBottom ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (
        shouldSettleVirtualizedViewportResize({
          virtualizerAtBottom: virtualizerAtBottomRef.current,
        })
      ) {
        settleAtBottom();
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [scrollContainerRef, settleAtBottom, virtualizerAtBottomRef]);
}
